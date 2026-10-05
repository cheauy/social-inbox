-- TENH Telegram Personal D1: shared chats and incoming messages (read-only inbox).
-- Status: tested only on scratch Postgres 16 (tests/sql/telegram-personal-d1.test.sql).
-- Requires 20261020_telegram_personal_draft.sql (already installed 2026-10-05).
-- Run as ONE script in the SQL Editor with nothing highlighted.
--
-- Design (owner decision 2026-10-05): Personal chats are stored in their OWN
-- tables, not in conversations/messages, so none of the existing inbox,
-- customer, search or analytics code paths can show them. Visibility follows
-- the account team-access setting through tgp_member_can_see, which the web
-- API and Realtime row level security both use.
-- Only chats the holder explicitly shares are stored. For other chats only an
-- account-scoped hash of the chat id is kept, to show a count of waiting chats
-- (no names, no text). This minimizes data; it is not secret from someone with
-- database access, because numeric ids can be guessed.

begin;

-- 1. Lifecycle commands gain chat listing and history import ---------------------
alter table public.telegram_personal_commands
  drop constraint if exists telegram_personal_commands_kind_check;
alter table public.telegram_personal_commands
  add constraint telegram_personal_commands_kind_check
  check (kind in ('pause','logout','list_chats','import_history'));
alter table public.telegram_personal_commands
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists result jsonb,
  add column if not exists result_expires_at timestamptz;

-- 2. Shared chats -------------------------------------------------------------------
create table if not exists public.telegram_personal_chats (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  chat_id text not null check (length(chat_id) between 1 and 21 and chat_id !~ '[^0-9-]'),
  title text not null,
  username text,
  history_import text not null default 'none' check (history_import in ('none','last_50')),
  shared_by_user_id uuid not null,
  shared_at timestamptz not null default now(),
  unshared_at timestamptz,
  last_read_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_preview text,
  last_direction text check (last_direction in ('incoming','outgoing')),
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (social_account_id, chat_id)
);
create index if not exists telegram_personal_chats_business_recent
  on public.telegram_personal_chats (business_id, last_message_at desc nulls last);

-- 3. Messages of shared chats. Telegram message ids are unique only per chat. -------
create table if not exists public.telegram_personal_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  chat_row_id uuid not null references public.telegram_personal_chats(id) on delete cascade,
  telegram_message_id bigint not null,
  direction text not null check (direction in ('incoming','outgoing')),
  message_type text not null check (message_type in ('text','placeholder')),
  body text check (body is null or length(body) <= 4096),
  placeholder_kind text check (placeholder_kind is null or placeholder_kind in
    ('photo','video','voice','video_note','sticker','file','audio','gif','location','contact','poll','other')),
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (chat_row_id, telegram_message_id)
);
create index if not exists telegram_personal_messages_chat_recent
  on public.telegram_personal_messages (chat_row_id, sent_at desc, telegram_message_id desc);

-- 4. Waiting (unshared) chats: hash only ----------------------------------------------
create table if not exists public.telegram_personal_unshared_activity (
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  chat_hash text not null,
  last_seen_at timestamptz not null default now(),
  primary key (social_account_id, chat_hash)
);

create or replace function public.tgp_chat_hash(p_social_account uuid, p_chat_id text)
returns text language sql immutable set search_path = '' as $fn$
  select encode(sha256(convert_to(p_social_account::text || ':' || p_chat_id, 'UTF8')), 'hex')
$fn$;

-- 5. Visibility -------------------------------------------------------------------------
-- True when p_user may see chats of this Personal account: the holder, or a
-- member allowed by the current team access setting. Removed members never see.
create or replace function public.tgp_member_can_see(p_social_account uuid, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $fn$
declare s record; m record;
begin
  if p_social_account is null or p_user is null then return false; end if;
  select id, business_id, holder_user_id, team_access into s
    from public.telegram_personal_sessions
   where social_account_id = p_social_account
   order by created_at desc limit 1;
  if not found then return false; end if;
  select id, role into m from public.team_members
   where business_id = s.business_id and user_id = p_user and is_active
   order by created_at desc limit 1;
  if not found then return false; end if;
  if s.holder_user_id = p_user then return true; end if;
  return case s.team_access
    when 'owners' then m.role = 'owner'
    when 'all_inbox_members' then true
    when 'selected_members' then exists (
      select 1 from public.telegram_personal_member_access a where a.session_id = s.id and a.member_id = m.id)
    else false
  end;
end $fn$;

-- Row level security helper for signed-in browsers: always the caller, never a parameter.
create or replace function public.tgp_rls_can_see(p_social_account uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.tgp_member_can_see(p_social_account, auth.uid())
$fn$;

alter table public.telegram_personal_chats enable row level security;
alter table public.telegram_personal_messages enable row level security;
alter table public.telegram_personal_unshared_activity enable row level security;
revoke all on public.telegram_personal_chats, public.telegram_personal_messages,
  public.telegram_personal_unshared_activity from public, anon, authenticated;
grant select, insert, update, delete on public.telegram_personal_chats,
  public.telegram_personal_messages, public.telegram_personal_unshared_activity to service_role;
-- Browsers only receive Realtime change events for rows they may see.
grant select on public.telegram_personal_chats, public.telegram_personal_messages to authenticated;
drop policy if exists tgp_chats_visible on public.telegram_personal_chats;
create policy tgp_chats_visible on public.telegram_personal_chats
  for select to authenticated using (public.tgp_rls_can_see(social_account_id));
drop policy if exists tgp_messages_visible on public.telegram_personal_messages;
create policy tgp_messages_visible on public.telegram_personal_messages
  for select to authenticated using (public.tgp_rls_can_see(social_account_id));

-- 6. API-side RPCs (service_role; the API has authenticated the caller) ---------------
create or replace function public.tgp_live_holder_session(p_session uuid, p_business uuid, p_user uuid)
returns public.telegram_personal_sessions language sql stable set search_path = '' as $fn$
  select s.* from public.telegram_personal_sessions s
   where s.id = p_session and s.business_id = p_business and s.holder_user_id = p_user
     and s.status in ('connected','reconnecting') and s.social_account_id is not null
     and public.tgp_is_active_owner(p_business, p_user)
$fn$;

-- Ask the worker for the holder recent one-to-one chats (not stored as shares).
create or replace function public.tgp_request_chat_list(p_session uuid, p_business uuid, p_user uuid, p_member uuid)
returns uuid language plpgsql set search_path = '' as $fn$
declare s public.telegram_personal_sessions; v_id uuid;
begin
  select * into s from public.tgp_live_holder_session(p_session, p_business, p_user);
  if s.id is null then return null; end if;
  select id into v_id from public.telegram_personal_commands
   where session_id = p_session and kind = 'list_chats'
     and (status in ('queued','claimed') or (status = 'done' and result_expires_at > now()))
     and created_at > now() - interval '30 seconds'
   order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.telegram_personal_commands (session_id, business_id, requested_by_member_id, kind, client_request_id)
  values (p_session, p_business, p_member, 'list_chats', gen_random_uuid())
  returning id into v_id;
  perform public.tgp_wake(p_session);
  return v_id;
end $fn$;

create or replace function public.tgp_read_chat_list(p_command uuid, p_session uuid, p_business uuid, p_user uuid)
returns jsonb language plpgsql stable set search_path = '' as $fn$
declare s public.telegram_personal_sessions; c record;
begin
  select * into s from public.tgp_live_holder_session(p_session, p_business, p_user);
  if s.id is null then return jsonb_build_object('state', 'forbidden'); end if;
  select status, result, result_expires_at, error_code into c from public.telegram_personal_commands
   where id = p_command and session_id = p_session and kind = 'list_chats';
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if c.status in ('queued','claimed') then return jsonb_build_object('state', 'pending'); end if;
  if c.status = 'failed' then return jsonb_build_object('state', 'failed', 'code', c.error_code); end if;
  if c.result_expires_at is null or c.result_expires_at <= now() then return jsonb_build_object('state', 'expired'); end if;
  return jsonb_build_object('state', 'ready', 'chats', coalesce(c.result->'chats', '[]'::jsonb));
end $fn$;

-- Share one chat from the latest chat list. Title and username come from the
-- worker result, never from the browser.
create or replace function public.tgp_share_chat(
  p_session uuid, p_business uuid, p_user uuid, p_member uuid, p_chat_id text, p_history text)
returns jsonb language plpgsql set search_path = '' as $fn$
declare s public.telegram_personal_sessions; v_chat jsonb; v_row uuid;
begin
  if p_history not in ('none','last_50') then return jsonb_build_object('ok', false, 'code', 'INVALID_HISTORY'); end if;
  select * into s from public.tgp_live_holder_session(p_session, p_business, p_user);
  if s.id is null then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select e into v_chat
    from public.telegram_personal_commands c, jsonb_array_elements(coalesce(c.result->'chats', '[]'::jsonb)) e
   where c.session_id = p_session and c.kind = 'list_chats' and c.status = 'done'
     and c.result_expires_at > now() and e->>'chat_id' = p_chat_id
   order by c.created_at desc limit 1;
  if v_chat is null then return jsonb_build_object('ok', false, 'code', 'CHAT_NOT_LISTED'); end if;

  insert into public.telegram_personal_chats as t
    (business_id, social_account_id, chat_id, title, username, history_import, shared_by_user_id)
  values (p_business, s.social_account_id, p_chat_id, left(v_chat->>'title', 200), left(v_chat->>'username', 64), p_history, p_user)
  on conflict (social_account_id, chat_id) do update
    set title = excluded.title, username = excluded.username, history_import = excluded.history_import,
        shared_by_user_id = excluded.shared_by_user_id,
        shared_at = case when t.unshared_at is null
                         then t.shared_at else now() end,
        last_read_at = case when t.unshared_at is null
                            then t.last_read_at else now() end,
        unshared_at = null, updated_at = now()
  returning id into v_row;

  delete from public.telegram_personal_unshared_activity
   where social_account_id = s.social_account_id and chat_hash = public.tgp_chat_hash(s.social_account_id, p_chat_id);
  if p_history = 'last_50' then
    insert into public.telegram_personal_commands (session_id, business_id, requested_by_member_id, kind, client_request_id, payload)
    values (p_session, p_business, p_member, 'import_history', gen_random_uuid(), jsonb_build_object('chat_id', p_chat_id, 'limit', 50));
  end if;
  perform public.tgp_wake(p_session);
  return jsonb_build_object('ok', true, 'chat_row_id', v_row);
end $fn$;

-- Stop sharing. Only the account holder decides. History is kept unless asked.
create or replace function public.tgp_unshare_chat(p_chat_row uuid, p_business uuid, p_user uuid, p_delete_history boolean)
returns text language plpgsql set search_path = '' as $fn$
declare c public.telegram_personal_chats; v_holder uuid;
begin
  select * into c from public.telegram_personal_chats where id = p_chat_row and business_id = p_business for update;
  if not found then return 'NOT_FOUND'; end if;
  select holder_user_id into v_holder from public.telegram_personal_sessions
   where social_account_id = c.social_account_id order by created_at desc limit 1;
  if v_holder is distinct from p_user then return 'FORBIDDEN'; end if;
  if p_delete_history then
    delete from public.telegram_personal_chats where id = c.id;
  else
    update public.telegram_personal_chats set unshared_at = coalesce(unshared_at, now()), updated_at = now() where id = c.id;
  end if;
  return 'OK';
end $fn$;

-- Delete everything this account imported into TENH (holder or any owner).
create or replace function public.tgp_remove_imported_data(p_session uuid, p_business uuid, p_user uuid)
returns text language plpgsql set search_path = '' as $fn$
declare s public.telegram_personal_sessions;
begin
  select * into s from public.telegram_personal_sessions where id = p_session and business_id = p_business;
  if not found or s.social_account_id is null then return 'NOT_FOUND'; end if;
  if s.holder_user_id <> p_user and not public.tgp_is_active_owner(p_business, p_user) then return 'FORBIDDEN'; end if;
  delete from public.telegram_personal_chats where social_account_id = s.social_account_id;
  delete from public.telegram_personal_unshared_activity where social_account_id = s.social_account_id;
  return 'OK';
end $fn$;

create or replace function public.tgp_mark_chat_read(p_chat_row uuid, p_business uuid, p_user uuid)
returns boolean language plpgsql set search_path = '' as $fn$
declare c public.telegram_personal_chats;
begin
  select * into c from public.telegram_personal_chats where id = p_chat_row and business_id = p_business;
  if not found or not public.tgp_member_can_see(c.social_account_id, p_user) then return false; end if;
  update public.telegram_personal_chats
     set unread_count = 0, last_read_at = greatest(last_read_at, coalesce(last_message_at, now())), updated_at = now()
   where id = c.id and (unread_count <> 0 or last_read_at < coalesce(last_message_at, last_read_at));
  return true;
end $fn$;

create or replace function public.tgp_dismiss_unshared(p_session uuid, p_business uuid, p_user uuid)
returns boolean language plpgsql set search_path = '' as $fn$
declare s public.telegram_personal_sessions;
begin
  select * into s from public.tgp_live_holder_session(p_session, p_business, p_user);
  if s.id is null then return false; end if;
  delete from public.telegram_personal_unshared_activity where social_account_id = s.social_account_id;
  return true;
end $fn$;

-- 7. Worker-side RPCs (fenced by lease) ---------------------------------------------
create or replace function public.tgp_worker_shared_chats(p_session uuid, p_worker text, p_epoch bigint)
returns table (chat_id text, chat_row_id uuid, last_message_at timestamptz)
language plpgsql stable set search_path = '' as $fn$
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return; end if;
  return query
    select c.chat_id, c.id, c.last_message_at
      from public.telegram_personal_chats c
      join public.telegram_personal_sessions s on s.social_account_id = c.social_account_id
     where s.id = p_session and c.unshared_at is null;
end $fn$;

-- Idempotent ingest keyed by (chat, Telegram message id). Unread counts only
-- incoming messages newer than the last read point, so history imports and
-- repeated or out-of-order updates never inflate it.
create or replace function public.tgp_ingest_message(
  p_session uuid, p_worker text, p_epoch bigint, p_chat_id text, p_message_id bigint,
  p_direction text, p_type text, p_body text, p_placeholder text, p_sent_at timestamptz)
returns text language plpgsql set search_path = '' as $fn$
declare s public.telegram_personal_sessions; c public.telegram_personal_chats; v_id uuid; v_preview text;
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return 'LEASE_LOST'; end if;
  select * into s from public.telegram_personal_sessions where id = p_session;
  if s.social_account_id is null or s.status not in ('connected','reconnecting') then return 'NOT_LIVE'; end if;

  select * into c from public.telegram_personal_chats
   where social_account_id = s.social_account_id and chat_id = p_chat_id and unshared_at is null
   for update;
  if not found then
    if p_direction = 'incoming' then
      insert into public.telegram_personal_unshared_activity (social_account_id, chat_hash)
      values (s.social_account_id, public.tgp_chat_hash(s.social_account_id, p_chat_id))
      on conflict (social_account_id, chat_hash) do update set last_seen_at = now();
    end if;
    return 'NOT_SHARED';
  end if;

  insert into public.telegram_personal_messages
    (business_id, social_account_id, chat_row_id, telegram_message_id, direction, message_type, body, placeholder_kind, sent_at)
  values (c.business_id, c.social_account_id, c.id, p_message_id, p_direction, p_type,
          left(p_body, 4096), case when p_type = 'placeholder' then coalesce(p_placeholder, 'other') end, p_sent_at)
  on conflict (chat_row_id, telegram_message_id) do nothing
  returning id into v_id;
  if v_id is null then return 'DUPLICATE'; end if;

  v_preview := left(coalesce(nullif(p_body, ''), '[' || coalesce(p_placeholder, 'message') || ']'), 140);
  update public.telegram_personal_chats set
    last_message_at = case when last_message_at is null or p_sent_at >= last_message_at then p_sent_at else last_message_at end,
    last_message_preview = case when last_message_at is null or p_sent_at >= last_message_at then v_preview else last_message_preview end,
    last_direction = case when last_message_at is null or p_sent_at >= last_message_at then p_direction else last_direction end,
    unread_count = unread_count + case when p_direction = 'incoming' and p_sent_at > last_read_at then 1 else 0 end,
    updated_at = now()
  where id = c.id;
  return 'INSERTED';
end $fn$;

create or replace function public.tgp_finish_command_result(
  p_command uuid, p_session uuid, p_worker text, p_epoch bigint, p_status text, p_error_code text, p_result jsonb)
returns boolean language plpgsql set search_path = '' as $fn$
begin
  if p_status not in ('done','failed') then return false; end if;
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return false; end if;
  update public.telegram_personal_commands
     set status = p_status, error_code = p_error_code, result = p_result,
         result_expires_at = case when p_result is not null then now() + interval '10 minutes' end,
         updated_at = now()
   where id = p_command and session_id = p_session and status = 'claimed';
  return found;
end $fn$;

-- Claimed commands now carry their payload for the worker.
create or replace function public.tgp_claim_commands_v2(p_session uuid, p_worker text, p_epoch bigint, p_limit int)
returns table (id uuid, kind text, payload jsonb)
language plpgsql set search_path = '' as $fn$
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return; end if;
  return query
  update public.telegram_personal_commands c set status = 'claimed', updated_at = now()
   where c.id in (select x.id from public.telegram_personal_commands x
                  where x.session_id = p_session and x.status in ('queued','claimed')
                  order by x.created_at limit greatest(p_limit, 0) for update skip locked)
  returning c.id, c.kind, c.payload;
end $fn$;

-- 8. Privileges -------------------------------------------------------------------------
do $grants$
declare f text;
begin
  foreach f in array array[
    'tgp_chat_hash(uuid,text)','tgp_member_can_see(uuid,uuid)','tgp_rls_can_see(uuid)',
    'tgp_live_holder_session(uuid,uuid,uuid)','tgp_request_chat_list(uuid,uuid,uuid,uuid)',
    'tgp_read_chat_list(uuid,uuid,uuid,uuid)','tgp_share_chat(uuid,uuid,uuid,uuid,text,text)',
    'tgp_unshare_chat(uuid,uuid,uuid,boolean)','tgp_remove_imported_data(uuid,uuid,uuid)',
    'tgp_mark_chat_read(uuid,uuid,uuid)','tgp_dismiss_unshared(uuid,uuid,uuid)',
    'tgp_worker_shared_chats(uuid,text,bigint)',
    'tgp_ingest_message(uuid,text,bigint,text,bigint,text,text,text,text,timestamptz)',
    'tgp_finish_command_result(uuid,uuid,text,bigint,text,text,jsonb)',
    'tgp_claim_commands_v2(uuid,text,bigint,int)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Needed for row level security evaluation by signed-in browsers.
  execute 'grant execute on function public.tgp_rls_can_see(uuid) to authenticated';
end
$grants$;

-- 9. Realtime (change events, filtered by the policies above) -------------------------
do $realtime$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    foreach t in array array['telegram_personal_chats','telegram_personal_messages'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$realtime$;

commit;
