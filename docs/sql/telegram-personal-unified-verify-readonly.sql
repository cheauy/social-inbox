-- TENH Telegram Personal: check after installing 20261022_telegram_personal_unified_inbox.sql.
-- READ-ONLY. Changes nothing. Returns one row of JSON; counts only, no message text or names.
select jsonb_build_object(
  'platform_checks', (select jsonb_object_agg(conname, pg_get_constraintdef(oid) like '%telegram_personal%')
                        from pg_constraint where conname in ('contacts_platform_check','conversations_platform_check')),
  'inbox_page_patched', (select pg_get_functiondef(p.oid) like '%tgp_member_can_see%'
                           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'tenh_inbox_page'),
  'd2_functions', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('tgp_ingest_inbox_message','tgp_enqueue_send','tgp_send_state',
                      'tgp_send_begin','tgp_send_accepted','tgp_send_finish','tgp_send_fail','tgp_send_mark_stale')),
  'restrictive_policies', (select count(*) from pg_policies where schemaname = 'public'
                            and policyname = 'tgp_personal_visibility' and permissive = 'RESTRICTIVE'),
  'old_table_removed', to_regclass('public.telegram_personal_messages') is null,
  'old_ingest_removed', not exists (select 1 from pg_proc where proname = 'tgp_ingest_message'),
  'personal_conversations', (select count(*) from public.conversations where platform = 'telegram_personal'),
  'personal_messages', (select count(*) from public.messages where platform_message_id like 'tgp:%'),
  'browser_can_execute_send', has_function_privilege('authenticated', 'public.tgp_enqueue_send(uuid,uuid,uuid,uuid,uuid,text)', 'execute')
) as unified_inbox_check;
-- Expected: both platform checks true, inbox_page_patched true, d2_functions 8,
-- restrictive_policies 5, old_table_removed true, old_ingest_removed true,
-- personal_conversations equal to the number of shared chats that have messages,
-- browser_can_execute_send false.
