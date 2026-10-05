-- TENH Telegram Personal: the same message buttons as Telegram Bot chats
-- (edit, delete for everyone, typing indicator) (owner request 2026-10-05).
-- Requires 20261020 to 20261024. Run as ONE script in the SQL Editor with nothing highlighted.
--
-- Holder only, shared chats only. Edit and delete act on the real Telegram
-- message through the holder account; both are safe to repeat, so a retry after
-- a worker restart cannot do harm. Typing is at most one request per 4 seconds.

begin;

alter table public.telegram_personal_commands drop constraint if exists telegram_personal_commands_kind_check;
alter table public.telegram_personal_commands add constraint telegram_personal_commands_kind_check
  check (kind in ('pause','logout','list_chats','import_history','send_text','send_media','edit_text','delete_messages','typing'));

-- p_action: edit (p_message, p_text) | delete (p_message) | typing (no message).
create or replace function public.tgp_enqueue_action(
  p_conversation uuid, p_business uuid, p_user uuid, p_member uuid, p_action text, p_message uuid, p_text text)
returns jsonb language plpgsql set search_path = '' as $fn$
declare c record; s public.telegram_personal_sessions; ch public.telegram_personal_chats; m record; v_id uuid;
  v_tg bigint; v_kind text; v_payload jsonb;
begin
  if p_action not in ('edit','delete','typing') then return jsonb_build_object('ok', false, 'code', 'INVALID_ACTION'); end if;
  select id, business_id, social_account_id, platform into c from public.conversations where id = p_conversation and business_id = p_business;
  if not found or c.platform <> 'telegram_personal' then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into s from public.telegram_personal_sessions where social_account_id = c.social_account_id order by created_at desc limit 1;
  if not found or s.holder_user_id <> p_user or not public.tgp_member_can_see(c.social_account_id, p_user) then
    return jsonb_build_object('ok', false, 'code', 'HOLDER_ONLY');
  end if;
  if s.status not in ('connected','reconnecting') then return jsonb_build_object('ok', false, 'code', 'NOT_CONNECTED'); end if;
  select * into ch from public.telegram_personal_chats where conversation_id = p_conversation and unshared_at is null;
  if not found then return jsonb_build_object('ok', false, 'code', 'CHAT_NOT_SHARED'); end if;

  if p_action = 'typing' then
    if exists (select 1 from public.telegram_personal_commands where session_id = s.id and kind = 'typing'
                 and created_at > now() - interval '4 seconds') then
      return jsonb_build_object('ok', true, 'skipped', true);
    end if;
    delete from public.telegram_personal_commands where session_id = s.id and kind = 'typing' and created_at < now() - interval '1 hour';
    v_kind := 'typing';
    v_payload := jsonb_build_object('chat_id', ch.chat_id);
  else
    select id, platform_message_id, direction, message_type, raw_payload into m from public.messages
     where id = p_message and conversation_id = p_conversation;
    if not found then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;
    v_tg := nullif(substring(m.platform_message_id from '^tgp:[0-9a-f-]+:-?[0-9]+:([0-9]+)$'), '')::bigint;
    if v_tg is null then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;
    if coalesce(m.raw_payload, '{}'::jsonb) ? 'tenh_deleted' then
      return jsonb_build_object('ok', false, 'code', 'ALREADY_DELETED');
    end if;
    if p_action = 'edit' then
      if m.direction <> 'outgoing' or m.message_type <> 'text' or coalesce(m.raw_payload, '{}'::jsonb) ? 'tgp_placeholder' then
        return jsonb_build_object('ok', false, 'code', 'NOT_EDITABLE');
      end if;
      if length(btrim(coalesce(p_text, ''))) = 0 or length(p_text) > 4096 then return jsonb_build_object('ok', false, 'code', 'INVALID_TEXT'); end if;
      v_kind := 'edit_text';
      v_payload := jsonb_build_object('chat_id', ch.chat_id, 'message_id', v_tg, 'text', p_text, 'member_id', p_member);
    else
      v_kind := 'delete_messages';
      v_payload := jsonb_build_object('chat_id', ch.chat_id, 'message_ids', jsonb_build_array(v_tg), 'member_id', p_member);
    end if;
  end if;

  insert into public.telegram_personal_commands (session_id, business_id, requested_by_member_id, kind, client_request_id, conversation_id, payload, message_id)
  values (s.id, p_business, p_member, v_kind, gen_random_uuid(), p_conversation, v_payload, p_message)
  returning id into v_id;
  perform public.tgp_wake(s.id);
  return jsonb_build_object('ok', true, 'command_id', v_id);
end $fn$;

-- Outcome of an edit or delete, for the person who asked.
create or replace function public.tgp_action_state(p_command uuid, p_business uuid, p_user uuid)
returns jsonb language plpgsql stable set search_path = '' as $fn$
declare k record;
begin
  select c.status, c.error_code, c.conversation_id, s.holder_user_id into k
    from public.telegram_personal_commands c join public.telegram_personal_sessions s on s.id = c.session_id
   where c.id = p_command and c.business_id = p_business and c.kind in ('edit_text','delete_messages');
  if not found or k.holder_user_id <> p_user then return jsonb_build_object('state', 'not_found'); end if;
  return jsonb_build_object('state', k.status, 'code', k.error_code);
end $fn$;

-- Deleted from TENH by the holder: attribute it to that member (not to Telegram).
create or replace function public.tgp_mark_deleted_by_member(
  p_session uuid, p_worker text, p_epoch bigint, p_message uuid, p_member uuid)
returns boolean language plpgsql set search_path = '' as $fn$
declare v_account uuid := public.tgp_worker_account(p_session, p_worker, p_epoch); v_name text;
begin
  if v_account is null then return false; end if;
  select full_name into v_name from public.team_members where id = p_member;
  update public.messages
     set message_text = 'Message deleted', attachment_url = null,
         raw_payload = (coalesce(raw_payload, '{}'::jsonb) - 'tenh_attachment' - 'tenh_reply')
                       || jsonb_build_object('tenh_deleted', jsonb_build_object('source', 'tenh', 'deleted_at', now(),
                            'deleted_by_member_id', p_member, 'deleted_by_name', coalesce(nullif(btrim(v_name), ''), 'TENH team member')))
   where id = p_message and platform_message_id like 'tgp:' || v_account::text || ':%';
  return found;
end $fn$;

do $grants$
declare f text;
begin
  foreach f in array array['tgp_enqueue_action(uuid,uuid,uuid,uuid,text,uuid,text)','tgp_action_state(uuid,uuid,uuid)',
    'tgp_mark_deleted_by_member(uuid,text,bigint,uuid,uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$grants$;

commit;
