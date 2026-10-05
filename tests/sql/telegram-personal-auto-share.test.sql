-- Assertions for db/proposals/20261023_telegram_personal_auto_share.sql (scratch DB only).
-- Run after the unified test (same database).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.k(p text) returns uuid language sql as $$ select v from tgp_test_ids where name = p $$;
create or replace function pg_temp.ep() returns bigint language sql as $$ select lease_epoch from telegram_personal_sessions where id = (select v from tgp_test_ids where name='sess') $$;

do $$ declare r jsonb; begin
  -- Off by default: nothing is shared automatically.
  assert (select auto_share from telegram_personal_sessions where id = pg_temp.k('sess')) = false;
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep(),'8001','New Person','np') = 'OFF';
  -- Only the holder may switch it on.
  assert tgp_set_auto_share(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('owner2'), true) = 'FORBIDDEN';
  assert tgp_set_auto_share(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('agent'), true) = 'FORBIDDEN';
  assert tgp_set_auto_share(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), true) = 'OK';
  -- Fenced, validated, then shared with history none.
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep()-1,'8001','New Person','np') = 'LEASE_LOST';
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep(),'80x1','Bad','x') = 'NOT_LIVE';
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep(),'8001','New Person','np') = 'SHARED';
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep(),'8001','New Person','np') = 'SHARED', 'idempotent';
  assert (select history_import from telegram_personal_chats where chat_id = '8001') = 'none';
  assert (select shared_by_user_id from telegram_personal_chats where chat_id = '8001') = pg_temp.k('holder');
  r := tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'8001',1,'incoming','text','hello',null,now(),true);
  assert r->>'result' = 'INSERTED', r::text;
  -- Stop sharing with history deleted: data gone, a nameless marker keeps it stopped.
  assert tgp_unshare_chat((select id from telegram_personal_chats where chat_id = '8001'), pg_temp.k('b'), pg_temp.k('holder'), true) = 'OK';
  assert not exists (select 1 from messages where message_text = 'hello');
  assert (select title from telegram_personal_chats where chat_id = '8001') = '-';
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep(),'8001','New Person','np') = 'EXCLUDED';
  -- Removing imported data switches automatic sharing off.
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep(),'8002','Another','a') = 'SHARED';
  assert tgp_remove_imported_data(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder')) = 'OK';
  assert (select auto_share from telegram_personal_sessions where id = pg_temp.k('sess')) = false;
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep(),'8003','Third','t') = 'OFF';
  -- Browsers cannot call these functions.
  assert not has_function_privilege('authenticated', 'public.tgp_set_auto_share(uuid,uuid,uuid,boolean)', 'execute');
  assert not has_function_privilege('authenticated', 'public.tgp_worker_auto_share(uuid,text,bigint,text,text,text)', 'execute');
end $$;

select 'telegram-personal auto-share SQL: all assertions passed' as result;
