-- Classes last one day. At midnight Brisbane time (Queensland: no daylight saving) every
-- class still running ends and its logins return to the pool, even if nobody pressed End class.
--  1. A nightly pg_cron job runs at 14:00 UTC = 00:00 AEST. Ending the class fires the usual
--     stage signal, so trainee screens left open switch to "Your class has finished".
--  2. Every API call also runs tc.expire(), which ends anything started on an earlier day,
--     so nothing from yesterday stays live even if the job were ever missed.

create or replace function tc.expire() returns void
language plpgsql set search_path = '' as $$
begin
  update tc.classes set state = 'ended', ended_at = now()
  where state = 'active'
    and (created_at at time zone 'Australia/Brisbane')::date < (now() at time zone 'Australia/Brisbane')::date;
  update tc.allocations a set released_at = now()
  from tc.classes c
  where a.class_id = c.id and c.state = 'ended' and a.released_at is null;
  delete from tc.sessions where expires_at < now();
  delete from tc.attempts where at < now() - interval '1 day';
end $$;
revoke execute on function tc.expire() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('tc-midnight-reset', '0 14 * * *', $job$select tc.expire()$job$);
