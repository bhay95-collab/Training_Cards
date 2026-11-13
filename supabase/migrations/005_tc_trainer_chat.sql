-- Trainer chat: one shared log for every signed-in instructor, all sites.
-- * Read and sent only with an instructor/admin token. Trainee PCs never get the channel id.
-- * The realtime signal carries only the new message id; the text is fetched through tc_chat.
-- * Wiped every Friday at 22:00 Brisbane time (12:00 UTC), and the live channel id is rotated.

create table tc.messages (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  name       text not null check (length(name) between 1 and 40),
  class_id   uuid references tc.classes(id) on delete set null,
  label      text not null default '',          -- e.g. "MO FirstNet ED, RBWH Room 3 (H7G8WB)", fixed when sent
  body       text not null check (length(body) between 1 and 500),
  token_hash text not null
);
create index on tc.messages (id);
alter table tc.messages enable row level security;
revoke all on tc.messages from public, anon, authenticated;

create table tc.settings (key text primary key, value text not null);
alter table tc.settings enable row level security;
revoke all on tc.settings from public, anon, authenticated;
insert into tc.settings (key, value) values ('staff_channel', gen_random_uuid()::text)
on conflict (key) do nothing;

create or replace function tc.on_message() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('id', new.id), 'message',
    'tcstaff-' || (select value from tc.settings where key = 'staff_channel'), false);
  return new;
end $$;
create trigger message_sent after insert on tc.messages for each row execute function tc.on_message();

create or replace function tc.chat_json(p_after bigint) returns json
language sql stable set search_path = '' as $$
  select json_build_object(
    'ok', true,
    'channel', (select value from tc.settings where key = 'staff_channel'),
    'messages', coalesce((
      select json_agg(json_build_object('id', m.id, 'at', m.at, 'name', m.name, 'label', m.label, 'body', m.body) order by m.id)
      from (select * from tc.messages where id > coalesce(p_after, 0) order by id desc limit 200) m), '[]'::json))
$$;

-- Messages after p_after (0 for the latest 200), plus the live channel id.
create or replace function public.tc_chat(p_token text, p_after bigint) returns json
language plpgsql security definer set search_path = '' as $$
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  return tc.chat_json(p_after);
end $$;

create or replace function public.tc_chat_send(p_token text, p_name text, p_body text, p_class uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare v_name text := left(trim(coalesce(p_name, '')), 40);
        v_body text := left(trim(coalesce(p_body, '')), 500);
        v_label text := '';
begin
  if not tc.is_instructor(p_token) then return tc.err('signed_out'); end if;
  if v_name = '' then return tc.err('Add your name for today first.'); end if;
  if v_body = '' then return tc.err('Type a message first.'); end if;
  if (select count(*) from tc.messages where token_hash = tc.hash(p_token) and at > now() - interval '1 minute') >= 20 then
    return tc.err('That’s a lot of messages. Wait a minute, then try again.');
  end if;
  if p_class is not null then
    select co.name || coalesce(nullif(', ' || c.site, ', '), '') || ' (' || c.code || ')' into v_label
    from tc.classes c join tc.courses co on co.id = c.course_id
    where c.id = p_class and c.state = 'active';
  end if;
  insert into tc.messages (name, class_id, label, body, token_hash)
  values (v_name, case when v_label <> '' then p_class end, coalesce(v_label, ''), v_body, tc.hash(p_token));
  return json_build_object('ok', true);
end $$;

create or replace function tc.wipe_chat() returns void
language plpgsql set search_path = '' as $$
begin
  delete from tc.messages where true;
  update tc.settings set value = gen_random_uuid()::text where key = 'staff_channel';
end $$;

revoke execute on all functions in schema tc from public, anon, authenticated;
revoke execute on function public.tc_chat(text, bigint) from public, authenticated;
revoke execute on function public.tc_chat_send(text, text, text, uuid) from public, authenticated;
grant execute on function public.tc_chat(text, bigint) to anon;
grant execute on function public.tc_chat_send(text, text, text, uuid) to anon;

-- Fridays 22:00 AEST = Fridays 12:00 UTC.
select cron.schedule('tc-friday-chat-wipe', '0 12 * * 5', $job$select tc.wipe_chat()$job$);
