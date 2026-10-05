-- TENH Telegram Personal: why are messages not arriving / why can I not reply?
-- READ-ONLY. Changes nothing. Statuses and counts only: no message text, names or phone numbers.
select jsonb_build_object(
  'sessions', (select jsonb_agg(jsonb_build_object(
      'status', s.status, 'auto_share', s.auto_share, 'has_account', s.social_account_id is not null,
      'worker_holds_it', s.lease_owner is not null and s.lease_expires_at > now(),
      'last_error', s.last_error_code, 'created', s.created_at) order by s.created_at desc)
    from public.telegram_personal_sessions s where s.created_at > now() - interval '30 days'),
  'chats', (select jsonb_agg(jsonb_build_object(
      'shared', c.unshared_at is null, 'has_conversation', c.conversation_id is not null,
      'belongs_to_live_session', exists (select 1 from public.telegram_personal_sessions s
         where s.social_account_id = c.social_account_id and s.status in ('connected','reconnecting')),
      'last_message_at', c.last_message_at, 'shared_at', c.shared_at))
    from public.telegram_personal_chats c),
  'waiting_unshared_chats', (select count(*) from public.telegram_personal_unshared_activity),
  'personal_conversations', (select count(*) from public.conversations where platform = 'telegram_personal'),
  'personal_messages', (select count(*) from public.messages where platform_message_id like 'tgp:%'),
  'newest_personal_message_at', (select max(coalesce(platform_created_at, created_at)) from public.messages where platform_message_id like 'tgp:%'),
  'recent_commands', (select jsonb_agg(x) from (select jsonb_build_object('kind', kind, 'status', status, 'error', error_code, 'at', created_at) x
      from public.telegram_personal_commands order by created_at desc limit 8) t),
  'installed', jsonb_build_object(
      'auto_share', to_regprocedure('public.tgp_worker_auto_share(uuid,text,bigint,text,text,text)') is not null,
      'media', to_regprocedure('public.tgp_enqueue_send_v2(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid)') is not null)
) as telegram_personal_diagnosis;
