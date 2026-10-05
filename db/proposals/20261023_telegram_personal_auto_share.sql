-- TENH Telegram Personal: automatic sharing of one-to-one chats (owner decision 2026-10-05).
-- Requires 20261020, 20261021 and 20261022. Run as ONE script in the SQL Editor with nothing highlighted.
--
-- The account holder may switch on Share all my one-to-one chats automatically.
-- Then a chat appears in TENH when a message arrives in it: new messages only,
-- nothing older is copied. Groups, channels, bots and Saved Messages stay out
-- (the worker filters them). Teammates still see only what team access allows.
-- A chat the holder stopped sharing stays stopped. Removing imported data also
-- switches automatic sharing off. Off by default; reconnecting starts off again.

begin;

alter table public.telegram_personal_sessions
  add column if not exists auto_share boolean not null default false;

-- Holder only, while connected.
create or replace function public.tgp_set_auto_share(p_session uuid, p_business uuid, p_user uuid, p_enabled boolean)
returns text language plpgsql set search_path = '' as $fn$
declare s public.telegram_personal_sessions;
begin
  select * into s from public.tgp_live_holder_session(p_session, p_business, p_user);
  if s.id is null then return 'FORBIDDEN'; end if;
  update public.telegram_personal_sessions set auto_share = coalesce(p_enabled, false), updated_at = now() where id = s.id;
  if coalesce(p_enabled, false) then
    -- Waiting chats are not imported retroactively: start counting afresh.
    delete from public.telegram_personal_unshared_activity where social_account_id = s.social_account_id;
  end if;
  perform public.tgp_wake(s.id);
  return 'OK';
end $fn$;

-- Worker: share a chat a message just arrived in, if automatic sharing is on.
-- SHARED (new or already shared), OFF, EXCLUDED (holder stopped sharing it), NOT_LIVE, LEASE_LOST.
create or replace function public.tgp_worker_auto_share(
  p_session uuid, p_worker text, p_epoch bigint, p_chat_id text, p_title text, p_username text)
returns text language plpgsql set search_path = '' as $fn$
declare s public.telegram_personal_sessions; c public.telegram_personal_chats;
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return 'LEASE_LOST'; end if;
  select * into s from public.telegram_personal_sessions where id = p_session;
  if s.social_account_id is null or s.status not in ('connected','reconnecting') then return 'NOT_LIVE'; end if;
  if not s.auto_share then return 'OFF'; end if;
  if p_chat_id is null or length(p_chat_id) not between 1 and 21 or p_chat_id ~ '[^0-9-]' then return 'NOT_LIVE'; end if;
  select * into c from public.telegram_personal_chats where social_account_id = s.social_account_id and chat_id = p_chat_id;
  if found then
    return case when c.unshared_at is null then 'SHARED' else 'EXCLUDED' end;
  end if;
  insert into public.telegram_personal_chats (business_id, social_account_id, chat_id, title, username, history_import, shared_by_user_id)
  values (s.business_id, s.social_account_id, p_chat_id, left(coalesce(nullif(btrim(p_title), ''), 'Telegram user'), 200),
          left(nullif(btrim(p_username), ''), 64), 'none', s.holder_user_id)
  on conflict (social_account_id, chat_id) do nothing;
  delete from public.telegram_personal_unshared_activity
   where social_account_id = s.social_account_id and chat_hash = public.tgp_chat_hash(s.social_account_id, p_chat_id);
  return 'SHARED';
end $fn$;

-- Stop sharing: when history is deleted, keep a nameless marker row so automatic
-- sharing does not bring the chat back.
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
    if c.conversation_id is not null then delete from public.conversations where id = c.conversation_id; end if;
    if c.contact_id is not null then
      delete from public.contacts x where x.id = c.contact_id
        and not exists (select 1 from public.conversations y where y.contact_id = x.id);
    end if;
    update public.telegram_personal_chats
       set unshared_at = coalesce(unshared_at, now()), title = '-', username = null, last_message_preview = null,
           last_direction = null, last_message_at = null, unread_count = 0, conversation_id = null, contact_id = null,
           updated_at = now()
     where id = c.id;
  else
    update public.telegram_personal_chats set unshared_at = coalesce(unshared_at, now()), updated_at = now() where id = c.id;
  end if;
  return 'OK';
end $fn$;

-- Remove imported data also switches automatic sharing off (otherwise it refills).
create or replace function public.tgp_remove_imported_data(p_session uuid, p_business uuid, p_user uuid)
returns text language plpgsql set search_path = '' as $fn$
declare s public.telegram_personal_sessions;
begin
  select * into s from public.telegram_personal_sessions where id = p_session and business_id = p_business;
  if not found or s.social_account_id is null then return 'NOT_FOUND'; end if;
  if s.holder_user_id <> p_user and not public.tgp_is_active_owner(p_business, p_user) then return 'FORBIDDEN'; end if;
  update public.telegram_personal_sessions set auto_share = false, updated_at = now()
   where social_account_id = s.social_account_id and auto_share;
  delete from public.conversations where social_account_id = s.social_account_id and platform = 'telegram_personal';
  delete from public.contacts where business_id = p_business and platform = 'telegram_personal'
    and platform_user_id like s.social_account_id::text || ':%';
  delete from public.telegram_personal_chats where social_account_id = s.social_account_id;
  delete from public.telegram_personal_unshared_activity where social_account_id = s.social_account_id;
  return 'OK';
end $fn$;

do $grants$
declare f text;
begin
  foreach f in array array['tgp_set_auto_share(uuid,uuid,uuid,boolean)',
    'tgp_worker_auto_share(uuid,text,bigint,text,text,text)',
    'tgp_unshare_chat(uuid,uuid,uuid,boolean)','tgp_remove_imported_data(uuid,uuid,uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$grants$;

commit;
