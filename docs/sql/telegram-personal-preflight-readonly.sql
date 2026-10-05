-- TENH Telegram Personal — Phase A preflight. READ-ONLY. Changes nothing.
-- Run in Supabase SQL Editor and send back the results before Phase B SQL is finalised.

-- 1. Is social_accounts.platform constrained (check constraint / enum)?
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.social_accounts'::regclass, 'public.contacts'::regclass,
                   'public.conversations'::regclass, 'public.messages'::regclass)
  and contype in ('c','u','p','f')
order by conrelid::regclass::text, conname;

-- 2. Unique / partial indexes on the inbox tables (incl. telegram_verified_bot_unique).
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('social_accounts','contacts','conversations','messages')
order by tablename, indexname;

-- 3. Column types used by the proposal.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('social_accounts','messages','conversations','contacts')
  and column_name in ('platform','platform_account_id','platform_message_id','platform_user_id',
                      'unread_count','is_active','social_account_id','raw_payload')
order by table_name, column_name;

-- 4. Triggers on social_accounts (channel limit / trial guards).
select tgname, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'public.social_accounts'::regclass and not tgisinternal;

-- 5. Existing platform values in use (no PII; counts only).
select platform, is_active, count(*) from public.social_accounts group by 1,2 order by 1,2;

-- 6. Pre-existing Bot message-key collisions across connections (diagnostic for the
--    issue noted in docs/telegram-personal-phase-a.md §1). Counts only.
select count(*) as workspaces_with_multiple_active_bots
from (select business_id from public.social_accounts
      where platform = 'telegram' and is_active group by business_id having count(*) > 1) s;

-- 7. Realtime publication contents.
select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1;
