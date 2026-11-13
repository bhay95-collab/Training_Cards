-- Allocation hands out logins in number order (01, 02, ...) whatever order the sheet lists them.
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
    order by length(l.login), l.login
    limit greatest(p_n, 0)
    for update of l skip locked
  loop
    insert into tc.allocations (class_id, login_id, kind) values (p_class, v_login, p_kind);
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;
revoke execute on function tc.allocate(uuid, text, int) from public, anon, authenticated;

-- The site never uses Supabase sign-in, so signed-in users get nothing extra.
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'tc\_%' loop
    execute format('revoke execute on function %s from authenticated', f);
  end loop;
end $$;
-- Event-trigger helper left from the old project: never needs to be called through the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Rate limits key on the caller's address. Prefer headers set by the edge (Cloudflare),
-- which a caller can't forge, before the client-extendable X-Forwarded-For.
create or replace function tc.ip() returns text
language sql stable set search_path = '' as $$
  with h as (select nullif(current_setting('request.headers', true), '')::json as j)
  select coalesce(
    nullif(trim(j ->> 'cf-connecting-ip'), ''),
    nullif(trim(j ->> 'x-real-ip'), ''),
    nullif(trim(split_part(coalesce(j ->> 'x-forwarded-for', ''), ',', 1)), ''),
    'unknown')
  from h
$$;
revoke execute on function tc.ip() from public, anon, authenticated;

-- Roster lists logins in number order.
-- (tc.class_json: order by a.kind, length(l.login), l.login — see 002.)

-- Passwords: minimum length 8 (set from the admin screen). The instructor password itself is
-- never stored in this repo; only its bcrypt hash lives in tc.staff.
