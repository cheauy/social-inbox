-- TENH Telegram Personal: unified inbox (owner decision 2026-10-05) and D2 sending.
-- Requires 20261020_telegram_personal_draft.sql and 20261021_telegram_personal_d1.sql.
-- Status: tested on scratch Postgres 16 with copies of the live inbox functions.
-- Run as ONE script in the SQL Editor with nothing highlighted.
--
-- Personal chats become ordinary inbox conversations (contacts, conversations,
-- messages). Privacy is kept by:
--  * tgp_member_can_see in tenh_inbox_page (patched in place from its LIVE text)
--    and in every server read path (web app code);
--  * RESTRICTIVE row level security policies that only narrow the existing
--    workspace rules for browsers and Realtime;
--  * identity keys that carry the Personal account id:
--    contacts.platform_user_id = <account id>:<telegram user id>
--    messages.platform_message_id = tgp:<account id>:<chat id>:<message id>
-- Pilot messages from telegram_personal_messages are moved, then that table is removed.

begin;

-- 0. Install guard: ingest relies on these unique keys (ON CONFLICT). Refuse otherwise.
do $keys$
declare k record;
begin
  for k in select * from (values
      ('contacts', array['business_id','platform','platform_user_id']),
      ('conversations', array['social_account_id','contact_id']),
      ('messages', array['business_id','platform_message_id'])) as t(tbl, cols) loop
    if not exists (
      select 1 from pg_index i
       where i.indrelid = format('public.%I', k.tbl)::regclass and i.indisunique and i.indpred is null
         and (select array_agg(a.attname::text order by a.attname)
                from unnest(i.indkey) as u(attnum)
                join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum)
             = (select array_agg(c order by c) from unnest(k.cols) as c)) then
      raise exception 'Missing unique key on %(%). Review before installing.', k.tbl, array_to_string(k.cols, ',');
    end if;
  end loop;
end
$keys$;

-- 1. Allow the platform on contacts and conversations (exact live definitions only) ----
do $platforms$
declare v_def text; t text;
begin
  foreach t in array array['contacts','conversations'] loop
    select pg_get_constraintdef(oid) into v_def from pg_constraint
     where conrelid = format('public.%I', t)::regclass and conname = t || '_platform_check';
    if v_def = 'CHECK ((platform = ANY (ARRAY[''facebook''::text, ''instagram''::text, ''telegram''::text])))' then
      execute format('alter table public.%I drop constraint %I, add constraint %I check (platform = any (array[''facebook''::text, ''instagram''::text, ''telegram''::text, ''telegram_personal''::text]))',
        t, t || '_platform_check', t || '_platform_check');
    elsif v_def is null or v_def not ilike '%telegram_personal%' then
      raise exception 'Unexpected % platform constraint (%). Review before installing.', t, v_def;
    end if;
  end loop;
end
$platforms$;

-- 2. Share registry links to the inbox conversation ------------------------------------
alter table public.telegram_personal_chats
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

-- 3. Visibility helpers for row level security (always the signed-in caller) ----------
create or replace function public.tgp_account_from_key(p_key text)
returns uuid language sql immutable set search_path = '' as $fn$
  select case when p_key like 'tgp:%' and substr(p_key, 5, 36) ~ '^[0-9a-f-]{36}'
              then substr(p_key, 5, 36)::uuid end
$fn$;

create or replace function public.tgp_rls_can_see_key(p_key text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select case when p_key is null or p_key not like 'tgp:%' then true
              else public.tgp_member_can_see(public.tgp_account_from_key(p_key), auth.uid()) end
$fn$;

create or replace function public.tgp_rls_conversation_visible(p_conversation uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce((select case when c.platform = 'telegram_personal'
                               then public.tgp_member_can_see(c.social_account_id, auth.uid()) else true end
                     from public.conversations c where c.id = p_conversation), true)
$fn$;

create or replace function public.tgp_rls_contact_visible(p_contact uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce((select case when c.platform = 'telegram_personal'
                               then public.tgp_member_can_see(public.tgp_account_from_key('tgp:' || c.platform_user_id), auth.uid()) else true end
                     from public.contacts c where c.id = p_contact), true)
$fn$;

-- 4. Restrictive policies: only narrow existing access, never widen it ----------------
do $policies$
declare
  spec text[];
  specs text[][] := array[
    array['conversations',          'social_account_id', 'platform <> ''telegram_personal'' or public.tgp_rls_can_see(social_account_id)'],
    array['messages',               'platform_message_id', 'public.tgp_rls_can_see_key(platform_message_id)'],
    array['conversation_activity',  'conversation_id',   'conversation_id is null or public.tgp_rls_conversation_visible(conversation_id)'],
    array['conversation_reminders', 'conversation_id',   'conversation_id is null or public.tgp_rls_conversation_visible(conversation_id)'],
    array['customer_files',         'contact_id',        'contact_id is null or public.tgp_rls_contact_visible(contact_id)']
  ];
begin
  foreach spec slice 1 in array specs loop
    if to_regclass('public.' || spec[1]) is null then continue; end if;
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = spec[1] and column_name = spec[2]) then
      raise notice 'Skipping % (no % column)', spec[1], spec[2];
      continue;
    end if;
    execute format('drop policy if exists tgp_personal_visibility on public.%I', spec[1]);
    execute format('create policy tgp_personal_visibility on public.%I as restrictive for select to authenticated using (%s)', spec[1], spec[3]);
  end loop;
end
$policies$;

-- 5. Patch the LIVE tenh_inbox_page in place --------------------------------------------
do $inbox$
declare
  v_def text;
  v_channel text := $s1$WHEN lower(btrim(COALESCE(c.source_type,''))) = 'telegram' OR a.platform = 'telegram' THEN 'telegram'$s1$;
  v_search text := $s2$CASE WHEN a.platform = 'telegram' THEN regexp_replace($s2$;
  v_scope text := $s3$AND (NULLIF(p_request->>'channelId','') IS NULL OR c.social_account_id = (p_request->>'channelId')::uuid)$s3$;
  v_count int;
begin
  select pg_get_functiondef('public.tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)'::regprocedure) into v_def;
  if v_def like '%tgp_member_can_see%' then
    raise notice 'tenh_inbox_page already patched';
    return;
  end if;
  foreach v_count in array array[
    (length(v_def) - length(replace(v_def, v_channel, ''))) / length(v_channel),
    (length(v_def) - length(replace(v_def, v_search, ''))) / length(v_search),
    (length(v_def) - length(replace(v_def, v_scope, ''))) / length(v_scope)]
  loop
    if v_count <> 1 then
      raise exception 'tenh_inbox_page differs from the reviewed live version; not patched. Send its current definition for review.';
    end if;
  end loop;
  v_def := replace(v_def, v_channel,
    $r1$WHEN lower(btrim(COALESCE(c.source_type,''))) = 'telegram' OR a.platform IN ('telegram','telegram_personal') THEN 'telegram'$r1$);
  v_def := replace(v_def, v_search, $r2$CASE WHEN a.platform IN ('telegram','telegram_personal') THEN regexp_replace($r2$);
  v_def := replace(v_def, v_scope, v_scope ||
    $r3$ AND (a.platform <> 'telegram_personal' OR public.tgp_member_can_see(c.social_account_id, p_user_id))$r3$);
  execute v_def;
end
$inbox$;

-- 6. Ingest into the inbox tables ---------------------------------------------------------
create or replace function public.tgp_ingest_inbox_message(
  p_session uuid, p_worker text, p_epoch bigint, p_chat_id text, p_message_id bigint,
  p_direction text, p_type text, p_body text, p_placeholder text, p_sent_at timestamptz,
  p_count_unread boolean, p_client_request_id text default null, p_sent_by_member uuid default null)
returns jsonb language plpgsql set search_path = '' as $fn$
declare
  s public.telegram_personal_sessions; ch public.telegram_personal_chats; a record;
  v_contact uuid; v_conversation uuid; v_message uuid; v_text text; v_label text; v_key text;
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return jsonb_build_object('result', 'LEASE_LOST'); end if;
  if p_direction not in ('incoming','outgoing') or p_type not in ('text','placeholder') then
    return jsonb_build_object('result', 'INVALID');
  end if;
  select * into s from public.telegram_personal_sessions where id = p_session;
  if s.social_account_id is null or s.status not in ('connected','reconnecting') then return jsonb_build_object('result', 'NOT_LIVE'); end if;
  select id, business_id, platform_account_id into a from public.social_accounts where id = s.social_account_id;

  select * into ch from public.telegram_personal_chats
   where social_account_id = s.social_account_id and chat_id = p_chat_id and unshared_at is null for update;
  if not found then
    if p_direction = 'incoming' then
      insert into public.telegram_personal_unshared_activity (social_account_id, chat_hash)
      values (s.social_account_id, public.tgp_chat_hash(s.social_account_id, p_chat_id))
      on conflict (social_account_id, chat_hash) do update set last_seen_at = now();
    end if;
    return jsonb_build_object('result', 'NOT_SHARED');
  end if;

  -- One contact per Personal account and Telegram user: never merged across accounts.
  insert into public.contacts (business_id, platform, platform_user_id, full_name, last_contact_at, updated_at)
  values (a.business_id, 'telegram_personal', s.social_account_id::text || ':' || p_chat_id, ch.title, p_sent_at, now())
  on conflict (business_id, platform, platform_user_id) do update
    set full_name = excluded.full_name,
        last_contact_at = greatest(public.contacts.last_contact_at, excluded.last_contact_at), updated_at = now()
  returning id into v_contact;

  insert into public.conversations (business_id, social_account_id, contact_id, platform, status, updated_at)
  values (a.business_id, s.social_account_id, v_contact, 'telegram_personal', 'open', now())
  on conflict (social_account_id, contact_id) do update set updated_at = now()
  returning id into v_conversation;

  if ch.conversation_id is distinct from v_conversation or ch.contact_id is distinct from v_contact then
    update public.telegram_personal_chats set conversation_id = v_conversation, contact_id = v_contact, updated_at = now() where id = ch.id;
  end if;

  v_label := case p_placeholder
    when 'photo' then '📷 Photo' when 'video' then '🎬 Video' when 'voice' then '🎤 Voice message'
    when 'video_note' then '🎥 Video message' when 'sticker' then '🙂 Sticker' when 'file' then '📎 File'
    when 'audio' then '🎵 Audio' when 'gif' then '🎞️ GIF' when 'location' then '📍 Location'
    when 'contact' then '👤 Contact' when 'poll' then '📊 Poll' else '💬 Message' end;
  -- Media is not downloaded: placeholders are text so no broken image is shown.
  v_text := case when p_type = 'text' then left(p_body, 4096)
                 else left(v_label || ' (open Telegram to view)' || coalesce(E'\n' || nullif(p_body, ''), ''), 4096) end;
  v_key := 'tgp:' || s.social_account_id::text || ':' || p_chat_id || ':' || p_message_id::text;

  insert into public.messages (business_id, conversation_id, platform_message_id, sender_platform_id, recipient_platform_id,
    direction, message_type, message_text, attachment_url, is_echo, raw_payload, platform_created_at, sent_by_member_id, delivery_status)
  values (a.business_id, v_conversation, v_key,
    case when p_direction = 'incoming' then p_chat_id else a.platform_account_id end,
    case when p_direction = 'incoming' then a.platform_account_id else p_chat_id end,
    p_direction, 'text', v_text, null, false,
    jsonb_strip_nulls(jsonb_build_object('source', 'telegram_personal', 'tgp_placeholder', case when p_type = 'placeholder' then p_placeholder end,
      'tenh_client_request_id', p_client_request_id)),
    p_sent_at, p_sent_by_member, case when p_direction = 'outgoing' then 'sent' end)
  on conflict (business_id, platform_message_id) do nothing
  returning id into v_message;
  if v_message is null then
    select id into v_message from public.messages where business_id = a.business_id and platform_message_id = v_key;
    return jsonb_build_object('result', 'DUPLICATE', 'message_id', v_message, 'conversation_id', v_conversation);
  end if;

  update public.conversations set
    last_message_text = case when last_message_at is null or p_sent_at >= last_message_at then left(v_text, 200) else last_message_text end,
    last_message_at = case when last_message_at is null or p_sent_at >= last_message_at then p_sent_at else last_message_at end,
    unread_count = unread_count + case when p_direction = 'incoming' and p_count_unread then 1 else 0 end,
    status = case when p_direction = 'incoming' and p_count_unread and status in ('resolved','closed') then 'open' else status end,
    updated_at = now()
  where id = v_conversation;
  update public.telegram_personal_chats set
    last_message_at = case when last_message_at is null or p_sent_at >= last_message_at then p_sent_at else last_message_at end,
    updated_at = now()
  where id = ch.id;
  return jsonb_build_object('result', 'INSERTED', 'message_id', v_message, 'conversation_id', v_conversation);
end $fn$;

-- 7. Move pilot messages from the separate D1 table, then remove it ----------------------
do $migrate$
declare ch record; m record; v_contact uuid; v_conversation uuid; v_account text;
begin
  if to_regclass('public.telegram_personal_messages') is null then return; end if;
  for ch in select c.* from public.telegram_personal_chats c
            where exists (select 1 from public.telegram_personal_messages x where x.chat_row_id = c.id) loop
    select platform_account_id into v_account from public.social_accounts where id = ch.social_account_id;
    insert into public.contacts (business_id, platform, platform_user_id, full_name, last_contact_at, updated_at)
    values (ch.business_id, 'telegram_personal', ch.social_account_id::text || ':' || ch.chat_id, ch.title, ch.last_message_at, now())
    on conflict (business_id, platform, platform_user_id) do update set updated_at = now()
    returning id into v_contact;
    insert into public.conversations (business_id, social_account_id, contact_id, platform, status, unread_count,
      last_message_text, last_message_at, updated_at)
    values (ch.business_id, ch.social_account_id, v_contact, 'telegram_personal', 'open', ch.unread_count,
      left(ch.last_message_preview, 200), ch.last_message_at, now())
    on conflict (social_account_id, contact_id) do update set updated_at = now()
    returning id into v_conversation;
    update public.telegram_personal_chats set conversation_id = v_conversation, contact_id = v_contact where id = ch.id;
    for m in select * from public.telegram_personal_messages where chat_row_id = ch.id loop
      insert into public.messages (business_id, conversation_id, platform_message_id, sender_platform_id, recipient_platform_id,
        direction, message_type, message_text, is_echo, raw_payload, platform_created_at, delivery_status)
      values (ch.business_id, v_conversation, 'tgp:' || ch.social_account_id::text || ':' || ch.chat_id || ':' || m.telegram_message_id::text,
        case when m.direction = 'incoming' then ch.chat_id else v_account end,
        case when m.direction = 'incoming' then v_account else ch.chat_id end,
        m.direction, 'text',
        case when m.message_type = 'text' then m.body
             else coalesce('[' || m.placeholder_kind || '] (open Telegram to view)', '[message]') || coalesce(E'\n' || nullif(m.body, ''), '') end,
        false, jsonb_strip_nulls(jsonb_build_object('source', 'telegram_personal', 'tgp_placeholder', m.placeholder_kind, 'migrated_from', 'telegram_personal_messages')),
        m.sent_at, case when m.direction = 'outgoing' then 'sent' end)
      on conflict (business_id, platform_message_id) do nothing;
    end loop;
  end loop;
  drop table public.telegram_personal_messages;
end
$migrate$;

-- The chat registry is server-only again (it held the old Personal inbox page).
drop policy if exists tgp_chats_visible on public.telegram_personal_chats;
revoke select on public.telegram_personal_chats from authenticated;
do $pub$
begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
             and tablename = 'telegram_personal_chats') then
    alter publication supabase_realtime drop table public.telegram_personal_chats;
  end if;
end
$pub$;
drop function if exists public.tgp_ingest_message(uuid,text,bigint,text,bigint,text,text,text,text,timestamptz);
drop function if exists public.tgp_mark_chat_read(uuid,uuid,uuid);

-- 8. Unshare / remove data now act on the inbox tables ------------------------------------
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
    delete from public.telegram_personal_chats where id = c.id;
  else
    update public.telegram_personal_chats set unshared_at = coalesce(unshared_at, now()), updated_at = now() where id = c.id;
  end if;
  return 'OK';
end $fn$;

create or replace function public.tgp_remove_imported_data(p_session uuid, p_business uuid, p_user uuid)
returns text language plpgsql set search_path = '' as $fn$
declare s public.telegram_personal_sessions;
begin
  select * into s from public.telegram_personal_sessions where id = p_session and business_id = p_business;
  if not found or s.social_account_id is null then return 'NOT_FOUND'; end if;
  if s.holder_user_id <> p_user and not public.tgp_is_active_owner(p_business, p_user) then return 'FORBIDDEN'; end if;
  delete from public.conversations where social_account_id = s.social_account_id and platform = 'telegram_personal';
  delete from public.contacts where business_id = p_business and platform = 'telegram_personal'
    and platform_user_id like s.social_account_id::text || ':%';
  delete from public.telegram_personal_chats where social_account_id = s.social_account_id;
  delete from public.telegram_personal_unshared_activity where social_account_id = s.social_account_id;
  return 'OK';
end $fn$;

-- 8b. Shared chats for the worker, now with the share time. Catch-up after a
-- restart imports only messages newer than the share (history none means none).
drop function if exists public.tgp_worker_shared_chats(uuid,text,bigint);
create function public.tgp_worker_shared_chats(p_session uuid, p_worker text, p_epoch bigint)
returns table (chat_id text, chat_row_id uuid, last_message_at timestamptz, shared_at timestamptz)
language plpgsql stable set search_path = '' as $fn$
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return; end if;
  return query
    select c.chat_id, c.id, c.last_message_at, c.shared_at
      from public.telegram_personal_chats c
      join public.telegram_personal_sessions s on s.social_account_id = c.social_account_id
     where s.id = p_session and c.unshared_at is null;
end $fn$;

-- 9. D2: sending text replies (holder only; owner decision 2=b) ------------------------
alter table public.telegram_personal_commands drop constraint if exists telegram_personal_commands_kind_check;
alter table public.telegram_personal_commands add constraint telegram_personal_commands_kind_check
  check (kind in ('pause','logout','list_chats','import_history','send_text'));
alter table public.telegram_personal_commands drop constraint if exists telegram_personal_commands_status_check;
alter table public.telegram_personal_commands add constraint telegram_personal_commands_status_check
  check (status in ('queued','claimed','sending','done','failed','uncertain'));
alter table public.telegram_personal_commands
  add column if not exists conversation_id uuid,
  add column if not exists temp_message_id bigint,
  add column if not exists message_id uuid;
create index if not exists telegram_personal_commands_send_rate
  on public.telegram_personal_commands (session_id, created_at desc) where kind = 'send_text';
create index if not exists telegram_personal_commands_temp
  on public.telegram_personal_commands (session_id, temp_message_id) where temp_message_id is not null;

-- Queue one reply. Idempotent per client_request_id (the optimistic bubble id).
-- Limits per account: 1 per second, 20 per minute. Only into shared chats.
create or replace function public.tgp_enqueue_send(
  p_conversation uuid, p_business uuid, p_user uuid, p_member uuid, p_client_request_id uuid, p_text text)
returns jsonb language plpgsql set search_path = '' as $fn$
declare c record; s public.telegram_personal_sessions; ch public.telegram_personal_chats; v_id uuid; v_existing record;
begin
  if p_text is null or length(btrim(p_text)) = 0 or length(p_text) > 4096 then return jsonb_build_object('ok', false, 'code', 'INVALID_TEXT'); end if;
  select id, business_id, social_account_id, platform into c from public.conversations where id = p_conversation and business_id = p_business;
  if not found or c.platform <> 'telegram_personal' then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into s from public.telegram_personal_sessions where social_account_id = c.social_account_id order by created_at desc limit 1;
  if not found or s.holder_user_id <> p_user or not public.tgp_member_can_see(c.social_account_id, p_user) then
    return jsonb_build_object('ok', false, 'code', 'HOLDER_ONLY');
  end if;
  if s.status not in ('connected','reconnecting') then return jsonb_build_object('ok', false, 'code', 'NOT_CONNECTED'); end if;
  select * into ch from public.telegram_personal_chats where conversation_id = p_conversation and unshared_at is null;
  if not found then return jsonb_build_object('ok', false, 'code', 'CHAT_NOT_SHARED'); end if;

  perform pg_advisory_xact_lock(hashtextextended('tgp:send:' || s.id::text, 0));
  select id, status, error_code, message_id into v_existing from public.telegram_personal_commands
   where session_id = s.id and client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('ok', true, 'command_id', v_existing.id, 'state', v_existing.status, 'duplicate', true);
  end if;
  if exists (select 1 from public.telegram_personal_commands where session_id = s.id and kind = 'send_text' and created_at > now() - interval '1 second')
     or (select count(*) from public.telegram_personal_commands where session_id = s.id and kind = 'send_text' and created_at > now() - interval '60 seconds') >= 20 then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;
  insert into public.telegram_personal_commands (session_id, business_id, requested_by_member_id, kind, client_request_id, conversation_id, payload)
  values (s.id, p_business, p_member, 'send_text', p_client_request_id, p_conversation,
          jsonb_build_object('chat_id', ch.chat_id, 'text', p_text, 'member_id', p_member, 'client_request_id', p_client_request_id))
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
     and k.kind = 'send_text';
  if not found then return jsonb_build_object('state', 'not_found'); end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation and public.tgp_member_can_see(c.social_account_id, p_user)) then
    return jsonb_build_object('state', 'not_found');
  end if;
  return jsonb_build_object('state', r.status, 'code', r.error_code, 'message_id', r.message_id, 'platform_message_id', r.platform_message_id);
end $fn$;

-- Worker: mark a claimed send as in flight BEFORE calling Telegram. A command in
-- this state is never claimed again, so a crash can never cause a resend.
create or replace function public.tgp_send_begin(p_command uuid, p_session uuid, p_worker text, p_epoch bigint)
returns boolean language plpgsql set search_path = '' as $fn$
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return false; end if;
  update public.telegram_personal_commands set status = 'sending', updated_at = now()
   where id = p_command and session_id = p_session and kind = 'send_text' and status = 'claimed';
  return found;
end $fn$;

create or replace function public.tgp_send_accepted(p_command uuid, p_session uuid, p_worker text, p_epoch bigint, p_temp_message_id bigint)
returns boolean language plpgsql set search_path = '' as $fn$
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return false; end if;
  update public.telegram_personal_commands set temp_message_id = p_temp_message_id, updated_at = now()
   where id = p_command and session_id = p_session and status in ('sending','uncertain');
  return found;
end $fn$;

-- Finish by temporary id (TDLib updateMessageSendSucceeded/Failed). Works after a
-- restart and also turns an earlier uncertain send into its real outcome.
create or replace function public.tgp_send_finish(
  p_session uuid, p_worker text, p_epoch bigint, p_temp_message_id bigint, p_status text, p_error_code text, p_message_id uuid)
returns jsonb language plpgsql set search_path = '' as $fn$
declare k record;
begin
  if p_status not in ('done','failed') then return null; end if;
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return null; end if;
  update public.telegram_personal_commands set status = p_status, error_code = p_error_code, message_id = p_message_id, updated_at = now()
   where session_id = p_session and kind = 'send_text' and temp_message_id = p_temp_message_id and status in ('sending','uncertain')
  returning id, payload, conversation_id into k;
  if not found then return null; end if;
  return jsonb_build_object('command_id', k.id, 'payload', k.payload, 'conversation_id', k.conversation_id);
end $fn$;

create or replace function public.tgp_send_fail(p_command uuid, p_session uuid, p_worker text, p_epoch bigint, p_status text, p_error_code text)
returns boolean language plpgsql set search_path = '' as $fn$
begin
  if p_status not in ('failed','uncertain') then return false; end if;
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return false; end if;
  update public.telegram_personal_commands set status = p_status, error_code = p_error_code, updated_at = now()
   where id = p_command and session_id = p_session and status in ('claimed','sending');
  return found;
end $fn$;

-- Sends left in flight without an outcome (crash, lost update) become uncertain.
create or replace function public.tgp_send_mark_stale(p_session uuid, p_worker text, p_epoch bigint, p_older_than_seconds int)
returns int language plpgsql set search_path = '' as $fn$
declare v int;
begin
  if not public.tgp_holds_lease(p_session, p_worker, p_epoch) then return 0; end if;
  update public.telegram_personal_commands set status = 'uncertain', error_code = coalesce(error_code, 'OUTCOME_UNKNOWN'), updated_at = now()
   where session_id = p_session and kind = 'send_text' and status = 'sending'
     and updated_at < now() - make_interval(secs => p_older_than_seconds);
  get diagnostics v = row_count;
  return v;
end $fn$;

-- 10. Privileges -----------------------------------------------------------------------
do $grants$
declare f text;
begin
  foreach f in array array[
    'tgp_account_from_key(text)','tgp_rls_can_see_key(text)','tgp_rls_conversation_visible(uuid)','tgp_rls_contact_visible(uuid)',
    'tgp_ingest_inbox_message(uuid,text,bigint,text,bigint,text,text,text,text,timestamptz,boolean,text,uuid)',
    'tgp_unshare_chat(uuid,uuid,uuid,boolean)','tgp_remove_imported_data(uuid,uuid,uuid)',
    'tgp_enqueue_send(uuid,uuid,uuid,uuid,uuid,text)','tgp_send_state(uuid,uuid,uuid,uuid)',
    'tgp_send_begin(uuid,uuid,text,bigint)','tgp_send_accepted(uuid,uuid,text,bigint,bigint)',
    'tgp_send_finish(uuid,text,bigint,bigint,text,text,uuid)','tgp_send_fail(uuid,uuid,text,bigint,text,text)',
    'tgp_send_mark_stale(uuid,text,bigint,int)','tgp_worker_shared_chats(uuid,text,bigint)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- Evaluated inside row level security for signed-in browsers (caller-bound, boolean only).
  execute 'grant execute on function public.tgp_rls_can_see_key(text) to authenticated';
  execute 'grant execute on function public.tgp_rls_conversation_visible(uuid) to authenticated';
  execute 'grant execute on function public.tgp_rls_contact_visible(uuid) to authenticated';
end
$grants$;

commit;
