-- TENH Telegram Personal: real media, profile photos, edits, deletions, replies,
-- and sending photos or files (owner request 2026-10-05).
-- Requires 20261020, 20261021, 20261022 and 20261023. Run as ONE script in the SQL Editor
-- with nothing highlighted.
--
-- Files live in the existing private buckets, under the same paths as the Bot:
--   tenh-message-media   <business>/<message id>/<photo|video|audio|voice|file>
--   tenh-contact-avatars <business>/<contact id>/telegram-avatar
-- The worker uploads them; browsers only receive short-lived signed links from TENH.
-- Every worker function is fenced by the session lease and can only touch rows of
-- that session account (message keys start with tgp:<account id>:).

begin;

-- 1. Sending media and replies -------------------------------------------------------------
alter table public.telegram_personal_commands drop constraint if exists telegram_personal_commands_kind_check;
alter table public.telegram_personal_commands add constraint telegram_personal_commands_kind_check
  check (kind in ('pause','logout','list_chats','import_history','send_text','send_media'));

-- Queue one reply (text, or a file with an optional caption), optionally quoting a message
-- of the same chat. Holder only, shared chats only, idempotent per request id,
-- 1 per second and 20 per minute across text and media.
create or replace function public.tgp_enqueue_send_v2(
  p_conversation uuid, p_business uuid, p_user uuid, p_member uuid, p_client_request_id uuid,
  p_text text, p_media jsonb, p_reply_to uuid)
returns jsonb language plpgsql set search_path = '' as $fn$
declare c record; s public.telegram_personal_sessions; ch public.telegram_personal_chats; v_id uuid;
  v_existing record; v_reply bigint; v_key text; v_kind text; v_media jsonb;
begin
  if length(coalesce(p_text, '')) > 4096 then return jsonb_build_object('ok', false, 'code', 'INVALID_TEXT'); end if;
  if p_media is null and length(btrim(coalesce(p_text, ''))) = 0 then return jsonb_build_object('ok', false, 'code', 'INVALID_TEXT'); end if;
  if p_media is not null and length(coalesce(p_text, '')) > 1024 then return jsonb_build_object('ok', false, 'code', 'CAPTION_TOO_LONG'); end if;
  select id, business_id, social_account_id, platform into c from public.conversations where id = p_conversation and business_id = p_business;
  if not found or c.platform <> 'telegram_personal' then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into s from public.telegram_personal_sessions where social_account_id = c.social_account_id order by created_at desc limit 1;
  if not found or s.holder_user_id <> p_user or not public.tgp_member_can_see(c.social_account_id, p_user) then
    return jsonb_build_object('ok', false, 'code', 'HOLDER_ONLY');
  end if;
  if s.status not in ('connected','reconnecting') then return jsonb_build_object('ok', false, 'code', 'NOT_CONNECTED'); end if;
  select * into ch from public.telegram_personal_chats where conversation_id = p_conversation and unshared_at is null;
  if not found then return jsonb_build_object('ok', false, 'code', 'CHAT_NOT_SHARED'); end if;

  if p_media is not null then
    v_kind := p_media->>'kind';
    if v_kind not in ('photo','video','document','audio','voice')
       or coalesce(p_media->>'storage_path', '') not like p_business::text || '/tgp-outbox/' || p_client_request_id::text || '/%'
       or (p_media->>'storage_path') ~ '[.][.]'
       or coalesce((p_media->>'size')::bigint, 0) not between 1 and 52428800
       or length(coalesce(p_media->>'mime_type', '')) not between 3 and 100
       or length(coalesce(p_media->>'name', '')) not between 1 and 200 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_MEDIA');
    end if;
    v_media := jsonb_build_object('kind', v_kind, 'storage_path', p_media->>'storage_path', 'size', (p_media->>'size')::bigint,
      'mime_type', p_media->>'mime_type', 'name', p_media->>'name');
  end if;

  if p_reply_to is not null then
    select platform_message_id into v_key from public.messages where id = p_reply_to and conversation_id = p_conversation;
    v_reply := nullif(substring(coalesce(v_key, '') from '^tgp:[0-9a-f-]+:-?[0-9]+:([0-9]+)$'), '')::bigint;
    if v_reply is null then return jsonb_build_object('ok', false, 'code', 'REPLY_NOT_FOUND'); end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tgp:send:' || s.id::text, 0));
  select id, status into v_existing from public.telegram_personal_commands
   where session_id = s.id and client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('ok', true, 'command_id', v_existing.id, 'state', v_existing.status, 'duplicate', true);
  end if;
  if exists (select 1 from public.telegram_personal_commands where session_id = s.id and kind in ('send_text','send_media')
               and created_at > now() - interval '1 second')
     or (select count(*) from public.telegram_personal_commands where session_id = s.id and kind in ('send_text','send_media')
           and created_at > now() - interval '60 seconds') >= 20 then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;
  insert into public.telegram_personal_commands (session_id, business_id, requested_by_member_id, kind, client_request_id, conversation_id, payload)
  values (s.id, p_business, p_member, case when v_media is null then 'send_text' else 'send_media' end, p_client_request_id, p_conversation,
          jsonb_strip_nulls(jsonb_build_object('chat_id', ch.chat_id, 'text', coalesce(p_text, ''), 'member_id', p_member,
            'client_request_id', p_client_request_id, 'reply_to_message_id', v_reply, 'media', v_media)))
  returning id into v_id;
  perform public.tgp_wake(s.id);
  return jsonb_build_object('ok', true, 'command_id', v_id, 'state', 'queued');
end $fn$;

create or replace function public.tgp_send_state(p_conversation uuid, p_business uuid, p_user uuid, p_client_request_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $fn$
declare r record;
begin
  select k.status, k.error_code, k.message_id, m.platform_message_id into r
    from public.telegram_personal_commands k
    left join public.messages m on m.id = k.message_id
   where k.conversation_id = p_conversation and k.business_id = p_business and k.client_request_id = p_client_request_id
     and k.kind in ('send_text','send_media');
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation and public.tgp_member_can_see(c.social_account_id, p_user)) then
    return jsonb_build_object('state', 'not_found');
  end if;
  return jsonb_build_object('state', r.status, 'code', r.error_code, 'message_id', r.message_id, 'platform_message_id', r.platform_message_id);
end $fn$;

create or replace function public.tgp_send_begin(p_command uuid, p_session uuid, p_worker text, p_epoch bigint)
returns boolean language plpgsql set search_path = '' as $fn$
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return false; end if;
  update public.telegram_personal_commands set status = 'sending', updated_at = now()
   where id = p_command and session_id = p_session and kind in ('send_text','send_media') and status = 'claimed';
  return found;
end $fn$;

create or replace function public.tgp_send_finish(
  p_session uuid, p_worker text, p_epoch bigint, p_temp_message_id bigint, p_status text, p_error_code text, p_message_id uuid)
returns jsonb language plpgsql set search_path = '' as $fn$
declare k record;
begin
  if p_status not in ('done','failed') then return null; end if;
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return null; end if;
  update public.telegram_personal_commands set status = p_status, error_code = p_error_code, message_id = p_message_id, updated_at = now()
   where session_id = p_session and kind in ('send_text','send_media') and temp_message_id = p_temp_message_id and status in ('sending','uncertain')
  returning id, payload, conversation_id into k;
  if not found then return null; end if;
  return jsonb_build_object('command_id', k.id, 'payload', k.payload, 'conversation_id', k.conversation_id);
end $fn$;

create or replace function public.tgp_send_mark_stale(p_session uuid, p_worker text, p_epoch bigint, p_older_than_seconds int)
returns int language plpgsql set search_path = '' as $fn$
declare v int;
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return 0; end if;
  update public.telegram_personal_commands set status = 'uncertain', error_code = coalesce(error_code, 'OUTCOME_UNKNOWN'), updated_at = now()
   where session_id = p_session and kind in ('send_text','send_media') and status = 'sending'
     and updated_at < now() - make_interval(secs => p_older_than_seconds);
  get diagnostics v = row_count;
  return v;
end $fn$;

-- 2. Worker helpers: a message or contact of this session account -----------------------
create or replace function public.tgp_worker_account(p_session uuid, p_worker text, p_epoch bigint)
returns uuid language plpgsql stable set search_path = '' as $fn$
declare v uuid;
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return null; end if;
  select social_account_id into v from public.telegram_personal_sessions where id = p_session and status in ('connected','reconnecting');
  return v;
end $fn$;

-- Media saved by the worker: the message shows the real photo, video, audio or file.
create or replace function public.tgp_set_message_media(
  p_session uuid, p_worker text, p_epoch bigint, p_message uuid, p_message_type text, p_text text, p_attachment jsonb)
returns boolean language plpgsql set search_path = '' as $fn$
declare v_account uuid := public.tgp_worker_account(p_session, p_worker, p_epoch);
begin
  if v_account is null or p_message_type not in ('image','video','audio','file','sticker') then return false; end if;
  update public.messages m
     set message_type = p_message_type,
         attachment_url = '/api/messages/' || m.id::text || '/media',
         message_text = left(coalesce(p_text, ''), 4096),
         raw_payload = coalesce(m.raw_payload, '{}'::jsonb) || jsonb_build_object('tenh_attachment', coalesce(p_attachment, '{}'::jsonb))
                       || case when p_message_type = 'sticker' then jsonb_build_object('tenh_sticker', jsonb_build_object('format', 'static', 'preview_kind', 'file')) else '{}'::jsonb end
   where m.id = p_message and m.platform_message_id like 'tgp:' || v_account::text || ':%';
  return found;
end $fn$;

-- The quoted message of an incoming or outgoing reply (same chat), in the inbox format.
create or replace function public.tgp_set_message_reply(
  p_session uuid, p_worker text, p_epoch bigint, p_message uuid, p_chat_id text, p_reply_to bigint)
returns boolean language plpgsql set search_path = '' as $fn$
declare v_account uuid := public.tgp_worker_account(p_session, p_worker, p_epoch); t record;
begin
  if v_account is null then return false; end if;
  select id, platform_message_id, message_text, message_type into t from public.messages
   where platform_message_id = 'tgp:' || v_account::text || ':' || p_chat_id || ':' || p_reply_to::text
     and business_id = (select business_id from public.social_accounts where id = v_account);
  update public.messages m
     set raw_payload = coalesce(m.raw_payload, '{}'::jsonb) || jsonb_build_object('tenh_reply',
           case when t.id is null then jsonb_build_object('preview_text', 'Earlier message', 'preview_type', 'text', 'scope', 'telegram')
                else jsonb_build_object('reply_to_local_message_id', t.id, 'reply_to_platform_message_id', t.platform_message_id,
                       'preview_text', left(coalesce(nullif(t.message_text, ''), 'Message'), 500), 'preview_type', t.message_type, 'scope', 'telegram') end)
   where m.id = p_message and m.platform_message_id like 'tgp:' || v_account::text || ':' || p_chat_id || ':%';
  return found;
end $fn$;

-- Edited in Telegram (by either side).
create or replace function public.tgp_edit_message(
  p_session uuid, p_worker text, p_epoch bigint, p_chat_id text, p_message_id bigint, p_text text, p_edited_at timestamptz)
returns text language plpgsql set search_path = '' as $fn$
declare v_account uuid := public.tgp_worker_account(p_session, p_worker, p_epoch); m record;
begin
  if v_account is null then return 'NOT_LIVE'; end if;
  select id, conversation_id, message_type, raw_payload into m from public.messages
   where platform_message_id = 'tgp:' || v_account::text || ':' || p_chat_id || ':' || p_message_id::text
     and business_id = (select business_id from public.social_accounts where id = v_account) for update;
  if not found then return 'NOT_FOUND'; end if;
  if (m.raw_payload->'tenh_edit'->>'edited_at')::timestamptz > p_edited_at then return 'OLDER'; end if;
  update public.messages
     set message_text = left(coalesce(p_text, ''), 4096),
         raw_payload = coalesce(raw_payload, '{}'::jsonb) || jsonb_build_object('tenh_edit', jsonb_build_object('source', 'telegram', 'edited_at', p_edited_at))
   where id = m.id;
  update public.conversations c set last_message_text = left(p_text, 200), updated_at = now()
   where c.id = m.conversation_id
     and not exists (select 1 from public.messages x where x.conversation_id = c.id
                     and coalesce(x.platform_created_at, x.created_at) > (select coalesce(platform_created_at, created_at) from public.messages where id = m.id));
  return 'OK';
end $fn$;

-- Deleted in Telegram for everyone. The row stays, shown as Message deleted, text removed.
create or replace function public.tgp_delete_messages(
  p_session uuid, p_worker text, p_epoch bigint, p_chat_id text, p_message_ids bigint[])
returns int language plpgsql set search_path = '' as $fn$
declare v_account uuid := public.tgp_worker_account(p_session, p_worker, p_epoch); v int;
begin
  if v_account is null or coalesce(array_length(p_message_ids, 1), 0) = 0 or array_length(p_message_ids, 1) > 100 then return 0; end if;
  update public.messages
     set message_text = 'Message deleted', attachment_url = null,
         raw_payload = (coalesce(raw_payload, '{}'::jsonb) - 'tenh_attachment' - 'tenh_reply')
                       || jsonb_build_object('tenh_deleted', jsonb_build_object('source', 'telegram', 'deleted_at', now()))
   where business_id = (select business_id from public.social_accounts where id = v_account)
     and platform_message_id = any (select 'tgp:' || v_account::text || ':' || p_chat_id || ':' || x::text from unnest(p_message_ids) x)
     and not (coalesce(raw_payload, '{}'::jsonb) ? 'tenh_deleted');
  get diagnostics v = row_count;
  return v;
end $fn$;

-- Profile photo: the contact of a shared chat (for the storage path), then the link.
create or replace function public.tgp_worker_chat_contact(p_session uuid, p_worker text, p_epoch bigint, p_chat_id text)
returns jsonb language plpgsql stable set search_path = '' as $fn$
declare v_account uuid := public.tgp_worker_account(p_session, p_worker, p_epoch); r record;
begin
  if v_account is null then return null; end if;
  select c.contact_id, c.business_id into r from public.telegram_personal_chats c
   where c.social_account_id = v_account and c.chat_id = p_chat_id and c.unshared_at is null and c.contact_id is not null;
  if not found then return null; end if;
  return jsonb_build_object('contact_id', r.contact_id, 'business_id', r.business_id);
end $fn$;

create or replace function public.tgp_set_contact_photo(p_session uuid, p_worker text, p_epoch bigint, p_chat_id text, p_has_photo boolean)
returns boolean language plpgsql set search_path = '' as $fn$
declare v_account uuid := public.tgp_worker_account(p_session, p_worker, p_epoch); v_contact uuid;
begin
  if v_account is null then return false; end if;
  select contact_id into v_contact from public.telegram_personal_chats
   where social_account_id = v_account and chat_id = p_chat_id and unshared_at is null;
  if v_contact is null then return false; end if;
  update public.contacts
     set profile_picture_url = case when p_has_photo then '/api/contacts/' || id::text || '/telegram-avatar' else null end,
         updated_at = now()
   where id = v_contact and platform = 'telegram_personal' and platform_user_id like v_account::text || ':%';
  return found;
end $fn$;

-- 3. Privileges ----------------------------------------------------------------------------
do $grants$
declare f text;
begin
  foreach f in array array[
    'tgp_enqueue_send_v2(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid)','tgp_send_state(uuid,uuid,uuid,uuid)',
    'tgp_send_begin(uuid,uuid,text,bigint)','tgp_send_finish(uuid,text,bigint,bigint,text,text,uuid)',
    'tgp_send_mark_stale(uuid,text,bigint,int)','tgp_worker_account(uuid,text,bigint)',
    'tgp_set_message_media(uuid,text,bigint,uuid,text,text,jsonb)','tgp_set_message_reply(uuid,text,bigint,uuid,text,bigint)',
    'tgp_edit_message(uuid,text,bigint,text,bigint,text,timestamptz)','tgp_delete_messages(uuid,text,bigint,text,bigint[])',
    'tgp_worker_chat_contact(uuid,text,bigint,text)','tgp_set_contact_photo(uuid,text,bigint,text,boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$grants$;

commit;
