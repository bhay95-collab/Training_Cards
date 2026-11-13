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
