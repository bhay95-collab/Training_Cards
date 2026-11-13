-- Training Card live classes: the only way in.
-- Every public.tc_* function is SECURITY DEFINER with an empty search_path, checks
-- who is calling (a staff token, or a trainee device id) and returns only what that
-- caller may see. Expected failures return {ok:false, error} instead of raising, so
-- rate-limit records are kept.

-- ================= Internal helpers (schema tc, not callable from the API) =================

create or replace function tc.ip() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(trim(split_part(coalesce(
    (nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for'), ''), ',', 1)), ''), 'unknown')
$$;

create or replace function tc.too_many(p_kind text, p_limit int, p_window interval) returns boolean
language sql stable set search_path = '' as $$
  select count(*) >= p_limit from tc.attempts
  where kind = p_kind and ip = tc.ip() and at > now() - p_window
$$;

create or replace function tc.hash(p text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex')
$$;

create or replace function tc.err(p_message text) returns json
language sql immutable set search_path = '' as $$
  select json_build_object('ok', false, 'error', p_message)
$$;

-- Role behind a staff token, or null. Admin can do everything an instructor can.
create or replace function tc.role_of(p_token text) returns text
language sql stable set search_path = '' as $$
  select role from tc.sessions where token_hash = tc.hash(p_token) and expires_at > now()
$$;

create or replace function tc.is_instructor(p_token text) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(tc.role_of(p_token) in ('instructor', 'admin'), false)
$$;

-- Classes run for a day at most; anything older is ended and its logins freed.
create or replace function tc.expire() returns void
language plpgsql set search_path = '' as $$
begin
  update tc.classes set state = 'ended', ended_at = now()
  where state = 'active' and created_at < now() - interval '16 hours';
  update tc.allocations a set released_at = now()
  from tc.classes c
  where a.class_id = c.id and c.state = 'ended' and a.released_at is null;
  delete from tc.sessions where expires_at < now();
  delete from tc.attempts where at < now() - interval '1 day';
end $$;

create or replace function tc.new_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea; v text;
begin
  loop
    b := extensions.gen_random_bytes(6);
    v := '';
    for i in 0..5 loop
      v := v || substr(alphabet, 1 + (get_byte(b, i) % length(alphabet)), 1);
    end loop;
    exit when not exists (select 1 from tc.classes where code = v and state = 'active');
  end loop;
  return v;
end $$;

-- Parts in the order they first appear in the course's data.
create or replace function tc.parts(p_course text) returns json
language sql stable set search_path = '' as $$
  select coalesce(json_agg(part order by first_seen), '[]'::json) from (
    select p.part, min(l.sort * 100 + p.sort) as first_seen
    from tc.patients p join tc.logins l on l.id = p.login_id
    where l.course_id = p_course and p.part <> ''
    group by p.part
  ) s
$$;

-- Give a class up to p_n more logins of the given kind: the next free logins of the
-- course (and facility), checked across every live class at every site.
create or replace function tc.allocate(p_class uuid, p_kind text, p_n int) returns int
language plpgsql set search_path = '' as $$
declare v_course text; v_facility text; v_login bigint; v_done int := 0;
begin
  select course_id, facility into v_course, v_facility from tc.classes where id = p_class;
  for v_login in
    select l.id from tc.logins l
    where l.course_id = v_course
      and (v_facility = '' or l.facility = v_facility)
      and not exists (select 1 from tc.allocations a where a.login_id = l.id and a.released_at is null)
    order by l.sort
    limit greatest(p_n, 0)
    for update of l skip locked
  loop
    insert into tc.allocations (class_id, login_id, kind) values (p_class, v_login, p_kind);
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;

-- Everything one screen shows: its login, and only the patients for the class's current part and mode.
create or replace function tc.card(p_alloc bigint) returns json
language sql stable set search_path = '' as $$
  select json_build_object(
    'ok', true,
    'role', a.kind,
    'class', json_build_object('id', c.id, 'code', c.code, 'channel', c.channel, 'site', c.site,
                               'part', c.part, 'mode', c.mode, 'parts', tc.parts(c.course_id)),
    'course', json_build_object('id', co.id, 'name', co.name, 'profession', co.profession,
                                'barcode', co.barcode, 'bloodBag', co.blood_bag, 'accessUrl', co.access_url),
    'login', json_build_object('login', l.login, 'password', l.password, 'facility', l.facility),
    'doctor', case when coalesce(nullif(l.doctor_user, ''), co.doctor_user) <> ''
                   then json_build_object('username', coalesce(nullif(l.doctor_user, ''), co.doctor_user),
                                          'password', co.doctor_pass) end,
    'witness', case when co.witness_user <> ''
                    then json_build_object('username', co.witness_user, 'password', co.witness_pass) end,
    'second', case when l.second is not null and coalesce(l.second ->> 'part', '') in ('', c.part)
                   then l.second end,
    'hbcis', l.hbcis,
    'patients', coalesce((
        select json_agg(json_build_object('mode', p.mode, 'part', p.part, 'role', p.role,
                                          'last', p.last, 'first', p.first, 'dob', p.dob, 'mrn', p.mrn,
                                          'fin', p.fin, 'ward', p.ward, 'ioms', p.ioms) order by p.sort)
        from tc.patients p
        where p.login_id = l.id and (p.mode = 'always' or (p.mode = c.mode and p.part = c.part))
      ), '[]'::json)
  )
  from tc.allocations a
  join tc.classes c on c.id = a.class_id
  join tc.logins l on l.id = a.login_id
  join tc.courses co on co.id = c.course_id
  where a.id = p_alloc
$$;

-- Tell every screen in a class that something changed. Carries no patient data.
create or replace function tc.signal(p_class uuid, p_event text) returns void
language plpgsql set search_path = '' as $$
declare v_channel uuid; v_class tc.classes;
begin
  select * into v_class from tc.classes where id = p_class;
  if v_class.id is null then return; end if;
  perform realtime.send(
    jsonb_build_object('part', v_class.part, 'mode', v_class.mode, 'state', v_class.state),
    p_event, 'tc-' || v_class.channel::text, false);
end $$;

create or replace function tc.on_class_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.part is distinct from old.part or new.mode is distinct from old.mode or new.state is distinct from old.state then
    perform tc.signal(new.id, 'stage');
  end if;
  return new;
end $$;

drop trigger if exists class_change on tc.classes;
create trigger class_change after update on tc.classes
for each row execute function tc.on_class_change();

create or replace function tc.class_json(p_class uuid) returns json
language sql stable set search_path = '' as $$
  select json_build_object(
    'ok', true,
    'class', json_build_object('id', c.id, 'code', c.code, 'channel', c.channel, 'site', c.site,
                               'facility', c.facility, 'planned', c.planned, 'part', c.part, 'mode', c.mode,
                               'state', c.state, 'createdAt', c.created_at, 'parts', tc.parts(c.course_id),
                               'hasProficiency', exists (
                                 select 1 from tc.patients p join tc.logins l on l.id = p.login_id
                                 where l.course_id = c.course_id and p.mode = 'proficiency' and p.part = c.part)),
    'course', json_build_object('id', co.id, 'name', co.name, 'profession', co.profession),
    'roster', coalesce((
        select json_agg(json_build_object('id', a.id, 'kind', a.kind, 'login', l.login, 'facility', l.facility,
                                          'joined', a.claimed_at is not null, 'joinedAt', a.claimed_at)
                        order by a.kind, length(l.login), l.login)
        from tc.allocations a join tc.logins l on l.id = a.login_id
        where a.class_id = c.id and a.released_at is null), '[]'::json),
    'free', (select count(*) from tc.logins l
             where l.course_id = c.course_id and (c.facility = '' or l.facility = c.facility)
               and not exists (select 1 from tc.allocations a where a.login_id = l.id and a.released_at is null)),
    'card', (select tc.card(a.id) from tc.allocations a
             where a.class_id = c.id and a.kind = 'instructor' and a.released_at is null limit 1)
  )
  from tc.classes c join tc.courses co on co.id = c.course_id
  where c.id = p_class
$$;

-- ================= Public API =================

-- Staff sign-in. Returns a token valid for 14 hours.
create or replace function public.tc_staff_login(p_role text, p_password text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_token text;
begin
  perform tc.expire();
  if tc.too_many('login', 8, interval '15 minutes') then
    return tc.err('Too many tries. Wait 15 minutes, then try again.');
  end if;
  select pass_hash into v_hash from tc.staff where role = p_role;
  if v_hash is null or extensions.crypt(coalesce(p_password, ''), v_hash) <> v_hash then
    insert into tc.attempts (kind, ip) values ('login', tc.ip());
    return tc.err('That password isn''t right.');
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into tc.sessions (token_hash, role, expires_at) values (tc.hash(v_token), p_role, now() + interval '14 hours');
  return json_build_object('ok', true, 'token', v_token, 'role', p_role);
end $$;

create or replace function public.tc_staff_logout(p_token text) returns json
language sql security definer set search_path = '' as $$
  delete from tc.sessions where token_hash = tc.hash(p_token);
  select json_build_object('ok', true);
$$;

-- Courses an instructor can start, with free logins, plus every live class (all sites).
create or replace function public.tc_overview(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  perform tc.expire();
  return json_build_object(
    'ok', true,
    'role', tc.role_of(p_token),
    'courses', coalesce((
      select json_agg(json_build_object(
        'id', co.id, 'name', co.name, 'profession', co.profession,
        'facilities', (select coalesce(json_agg(distinct l.facility), '[]'::json)
                       from tc.logins l where l.course_id = co.id and l.facility <> ''),
        'logins', (select count(*) from tc.logins l where l.course_id = co.id),
        'free', (select count(*) from tc.logins l where l.course_id = co.id
                 and not exists (select 1 from tc.allocations a where a.login_id = l.id and a.released_at is null))
      ) order by co.sort)
      from tc.courses co
      where co.show and exists (select 1 from tc.logins l where l.course_id = co.id)), '[]'::json),
    'classes', coalesce((
      select json_agg(json_build_object(
        'id', c.id, 'code', c.code, 'course', co.name, 'site', c.site, 'facility', c.facility,
        'createdAt', c.created_at,
        'places', (select count(*) from tc.allocations a where a.class_id = c.id and a.released_at is null and a.kind = 'trainee'),
        'joined', (select count(*) from tc.allocations a where a.class_id = c.id and a.released_at is null
                   and a.kind = 'trainee' and a.claimed_at is not null)
      ) order by c.created_at desc)
      from tc.classes c join tc.courses co on co.id = c.course_id
      where c.state = 'active'), '[]'::json)
  );
end $$;

create or replace function public.tc_start_class(p_token text, p_course text, p_facility text, p_site text, p_trainees int)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_class uuid; v_got int; v_parts json; v_facilities int;
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  perform tc.expire();
  if p_trainees is null or p_trainees < 1 or p_trainees > 40 then
    return tc.err('Enter between 1 and 40 trainees.');
  end if;
  if not exists (select 1 from tc.courses where id = p_course and show) then
    return tc.err('That course isn''t available.');
  end if;
  select count(distinct facility) into v_facilities from tc.logins where course_id = p_course and facility <> '';
  if v_facilities > 1 and coalesce(p_facility, '') = '' then
    return tc.err('Choose the facility for this class.');
  end if;
  v_parts := tc.parts(p_course);
  insert into tc.classes (code, course_id, facility, site, planned, part)
  values (tc.new_code(), p_course, case when v_facilities > 1 then p_facility else '' end,
          left(coalesce(trim(p_site), ''), 60), p_trainees, coalesce(v_parts ->> 0, ''))
  returning id into v_class;
  if tc.allocate(v_class, 'instructor', 1) = 0 then
    delete from tc.classes where id = v_class;
    return tc.err('Every login for this course is in use by other classes right now.');
  end if;
  v_got := tc.allocate(v_class, 'trainee', p_trainees);
  return json_build_object('ok', true, 'id', v_class, 'short', p_trainees - v_got);
end $$;

create or replace function public.tc_class(p_token text, p_class uuid) returns json
language plpgsql security definer set search_path = '' as $$
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  perform tc.expire();
  if not exists (select 1 from tc.classes where id = p_class and state = 'active') then
    return tc.err('ended');
  end if;
  return tc.class_json(p_class);
end $$;

create or replace function public.tc_set_stage(p_token text, p_class uuid, p_part text, p_mode text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  if p_mode not in ('instructor', 'proficiency') then return tc.err('Unknown mode.'); end if;
  update tc.classes c set part = coalesce(p_part, ''), mode = p_mode
  where c.id = p_class and c.state = 'active'
    and (coalesce(p_part, '') = '' and tc.parts(c.course_id)::jsonb = '[]'::jsonb
         or tc.parts(c.course_id)::jsonb ? coalesce(p_part, ''));
  if not found then return tc.err('That class or part doesn''t exist.'); end if;
  return tc.class_json(p_class);
end $$;

create or replace function public.tc_add_places(p_token text, p_class uuid, p_n int) returns json
language plpgsql security definer set search_path = '' as $$
declare v_got int;
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  if not exists (select 1 from tc.classes where id = p_class and state = 'active') then return tc.err('ended'); end if;
  v_got := tc.allocate(p_class, 'trainee', least(greatest(coalesce(p_n, 1), 1), 20));
  if v_got = 0 then return tc.err('No free logins left for this course. Every one is in a live class.'); end if;
  perform tc.signal(p_class, 'roster');
  return tc.class_json(p_class);
end $$;

-- Free a place's PC so a different PC can take it (the login stays in the class).
create or replace function public.tc_reset_place(p_token text, p_alloc bigint) returns json
language plpgsql security definer set search_path = '' as $$
declare v_class uuid;
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  update tc.allocations set device_hash = null, claimed_at = null
  where id = p_alloc and kind = 'trainee' and released_at is null
  returning class_id into v_class;
  if v_class is null then return tc.err('That place doesn''t exist.'); end if;
  perform tc.signal(v_class, 'roster');
  return tc.class_json(v_class);
end $$;

-- Give a place's login back to the pool.
create or replace function public.tc_remove_place(p_token text, p_alloc bigint) returns json
language plpgsql security definer set search_path = '' as $$
declare v_class uuid;
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  update tc.allocations set released_at = now()
  where id = p_alloc and kind = 'trainee' and released_at is null
  returning class_id into v_class;
  if v_class is null then return tc.err('That place doesn''t exist.'); end if;
  perform tc.signal(v_class, 'roster');
  return tc.class_json(v_class);
end $$;

create or replace function public.tc_end_class(p_token text, p_class uuid) returns json
language plpgsql security definer set search_path = '' as $$
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  update tc.classes set state = 'ended', ended_at = now() where id = p_class and state = 'active';
  update tc.allocations set released_at = now() where class_id = p_class and released_at is null;
  return json_build_object('ok', true);
end $$;

-- Trainee PC joins with the class code. p_device is a random id the browser keeps.
create or replace function public.tc_join(p_code text, p_device text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_class tc.classes; v_dev text; v_alloc bigint;
begin
  perform tc.expire();
  if length(coalesce(p_device, '')) < 20 then return tc.err('This browser can''t join. Try reloading the page.'); end if;
  if tc.too_many('join', 30, interval '15 minutes') then
    return tc.err('Too many wrong codes. Wait 15 minutes, then try again.');
  end if;
  select * into v_class from tc.classes
  where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) and state = 'active';
  if v_class.id is null then
    insert into tc.attempts (kind, ip) values ('join', tc.ip());
    return tc.err('No live class has that code. Check the code on your instructor''s screen.');
  end if;
  v_dev := tc.hash(p_device);
  select id into v_alloc from tc.allocations
  where class_id = v_class.id and device_hash = v_dev and released_at is null;
  if v_alloc is null then
    update tc.allocations set device_hash = v_dev, claimed_at = now()
    where id = (select id from tc.allocations
                where class_id = v_class.id and kind = 'trainee' and device_hash is null and released_at is null
                order by id limit 1 for update skip locked)
    returning id into v_alloc;
    if v_alloc is null then
      return tc.err('This class is full. Ask your instructor to add a place, then try again.');
    end if;
    -- One PC, one live place: leave any other class this PC was in.
    update tc.allocations set device_hash = null, claimed_at = null
    where device_hash = v_dev and released_at is null and id <> v_alloc;
    perform tc.signal(v_class.id, 'roster');
  end if;
  return tc.card(v_alloc);
end $$;

-- The trainee's card, for the class's current part and mode.
create or replace function public.tc_card(p_device text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_alloc bigint;
begin
  perform tc.expire();
  select a.id into v_alloc from tc.allocations a join tc.classes c on c.id = a.class_id
  where a.device_hash = tc.hash(p_device) and a.released_at is null and c.state = 'active'
  order by a.claimed_at desc limit 1;
  if v_alloc is null then return tc.err('not_joined'); end if;
  return tc.card(v_alloc);
end $$;

create or replace function public.tc_leave(p_device text) returns json
language plpgsql security definer set search_path = '' as $$
declare v_class uuid;
begin
  update tc.allocations set device_hash = null, claimed_at = null
  where device_hash = tc.hash(p_device) and released_at is null
  returning class_id into v_class;
  if v_class is not null then perform tc.signal(v_class, 'roster'); end if;
  return json_build_object('ok', true);
end $$;

-- ---------- Admin ----------

create or replace function public.tc_admin_export(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  if tc.role_of(p_token) is distinct from 'admin' then return tc.err('signed_out'); end if;
  return json_build_object('ok', true, 'data', json_build_object('courses', coalesce((
    select json_agg(json_build_object(
      'id', co.id, 'tab', co.tab, 'name', co.name, 'group', co.profession, 'show', co.show,
      'barcode', co.barcode, 'bloodBag', co.blood_bag,
      'doctor', case when co.doctor_user <> '' then json_build_object('username', co.doctor_user, 'password', co.doctor_pass) end,
      'witness', case when co.witness_user <> '' then json_build_object('username', co.witness_user, 'password', co.witness_pass) end,
      'accessUrl', co.access_url, 'notes', co.notes,
      'logins', coalesce((
        select json_agg(json_build_object(
          'login', l.login, 'password', l.password, 'facility', l.facility, 'doctor', l.doctor_user,
          'second', l.second, 'hbcis', l.hbcis,
          'patients', coalesce((
            select json_agg(json_build_object('part', p.part, 'mode', p.mode, 'role', p.role, 'last', p.last,
                                              'first', p.first, 'dob', p.dob, 'mrn', p.mrn, 'fin', p.fin,
                                              'ward', p.ward, 'ioms', p.ioms) order by p.sort)
            from tc.patients p where p.login_id = l.id), '[]'::json)
        ) order by l.sort)
        from tc.logins l where l.course_id = co.id), '[]'::json)
    ) order by co.sort)
    from tc.courses co), '[]'::json)));
end $$;

-- Replace all course data. Refused while any class is live, so no PC loses its login.
create or replace function public.tc_admin_import(p_token text, p_data jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare c jsonb; l jsonb; p jsonb; ci int := 0; li int; pi int; v_login bigint; n_logins int := 0; n_patients int := 0;
begin
  if tc.role_of(p_token) is distinct from 'admin' then return tc.err('signed_out'); end if;
  perform tc.expire();
  if exists (select 1 from tc.classes where state = 'active') then
    return tc.err('Classes are running right now. End every live class, then load the data.');
  end if;
  if jsonb_typeof(p_data -> 'courses') <> 'array' then return tc.err('The data is missing its courses.'); end if;
  delete from tc.classes where true;   -- the API's safe-update guard needs a WHERE
  delete from tc.courses where true;
  for c in select * from jsonb_array_elements(p_data -> 'courses') loop
    ci := ci + 1;
    insert into tc.courses (id, tab, name, profession, show, barcode, blood_bag, doctor_user, doctor_pass,
                            witness_user, witness_pass, access_url, notes, sort)
    values (c ->> 'id', coalesce(c ->> 'tab', c ->> 'name'), c ->> 'name', coalesce(c ->> 'group', 'nursing'),
            coalesce((c ->> 'show')::boolean, true), coalesce((c ->> 'barcode')::boolean, false),
            coalesce((c ->> 'bloodBag')::boolean, false),
            coalesce(c #>> '{doctor,username}', ''), coalesce(c #>> '{doctor,password}', ''),
            coalesce(c #>> '{witness,username}', ''), coalesce(c #>> '{witness,password}', ''),
            coalesce(c ->> 'accessUrl', ''), coalesce(c ->> 'notes', ''), ci);
    li := 0;
    for l in select * from jsonb_array_elements(coalesce(c -> 'logins', '[]'::jsonb)) loop
      li := li + 1;
      insert into tc.logins (course_id, login, password, facility, doctor_user, second, hbcis, sort)
      values (c ->> 'id', l ->> 'login', coalesce(l ->> 'password', ''), coalesce(l ->> 'facility', ''),
              coalesce(l ->> 'doctor', ''), nullif(l -> 'second', 'null'::jsonb), nullif(l -> 'hbcis', 'null'::jsonb), li)
      returning id into v_login;
      n_logins := n_logins + 1;
      pi := 0;
      for p in select * from jsonb_array_elements(coalesce(l -> 'patients', '[]'::jsonb)) loop
        pi := pi + 1;
        insert into tc.patients (login_id, sort, part, mode, role, last, first, dob, mrn, fin, ward, ioms)
        values (v_login, pi, coalesce(p ->> 'part', ''), coalesce(nullif(p ->> 'mode', ''), 'instructor'),
                coalesce(p ->> 'role', ''), coalesce(p ->> 'last', ''), coalesce(p ->> 'first', ''),
                coalesce(p ->> 'dob', ''), coalesce(p ->> 'mrn', ''), coalesce(p ->> 'fin', ''),
                coalesce(p ->> 'ward', ''), coalesce(p ->> 'ioms', ''));
        n_patients := n_patients + 1;
      end loop;
    end loop;
  end loop;
  return json_build_object('ok', true, 'courses', ci, 'logins', n_logins, 'patients', n_patients);
end $$;

create or replace function public.tc_set_password(p_token text, p_role text, p_new text) returns json
language plpgsql security definer set search_path = '' as $$
begin
  if tc.role_of(p_token) is distinct from 'admin' then return tc.err('signed_out'); end if;
  if p_role not in ('instructor', 'admin') then return tc.err('Unknown role.'); end if;
  if length(coalesce(p_new, '')) < 10 then return tc.err('Use at least 10 characters.'); end if;
  insert into tc.staff (role, pass_hash, updated_at) values (p_role, extensions.crypt(p_new, extensions.gen_salt('bf', 10)), now())
  on conflict (role) do update set pass_hash = excluded.pass_hash, updated_at = now();
  -- Changing a password signs everyone with that role out.
  delete from tc.sessions where role = p_role and token_hash <> tc.hash(p_token);
  return json_build_object('ok', true);
end $$;

-- ================= Grants: only the public.tc_* functions, nothing else =================
revoke execute on all functions in schema tc from public, anon, authenticated;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'tc\_%' loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
