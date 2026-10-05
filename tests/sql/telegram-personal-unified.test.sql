-- Assertions for db/proposals/20261022_telegram_personal_unified_inbox.sql (scratch DB only).
-- Run after: stub schema, 20261020 draft, 20261021 D1, live inbox functions, the pilot seed below, then the unified file.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.k(p text) returns uuid language sql as $$ select v from tgp_test_ids where name = p $$;
create or replace function pg_temp.ep() returns bigint language sql as $$ select lease_epoch from telegram_personal_sessions where id = (select v from tgp_test_ids where name='sess') $$;

-- 1. Constraints and the patched inbox function.
do $$ begin
  assert pg_get_constraintdef((select oid from pg_constraint where conname='contacts_platform_check')) like '%telegram_personal%';
  assert pg_get_constraintdef((select oid from pg_constraint where conname='conversations_platform_check')) like '%telegram_personal%';
  assert pg_get_functiondef('public.tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)'::regprocedure) like '%tgp_member_can_see%';
  assert to_regclass('public.telegram_personal_messages') is null, 'separate table removed';
end $$;

-- 2. Pilot messages were migrated into the inbox tables.
do $$ declare conv uuid; begin
  select conversation_id into conv from telegram_personal_chats where chat_id = '5001';
  assert conv is not null;
  assert (select platform from conversations where id = conv) = 'telegram_personal';
  assert (select count(*) from messages where conversation_id = conv) = 2;
  assert (select unread_count from conversations where id = conv) = 1;
  assert exists (select 1 from messages where conversation_id = conv and platform_message_id = 'tgp:' || pg_temp.k('acc') || ':5001:10');
  assert exists (select 1 from messages where conversation_id = conv and message_text like '[photo]%');
end $$;

-- 2b. The worker learns each chat's share time (catch-up never imports older history).
do $$ declare r record; begin
  select * into r from tgp_worker_shared_chats(pg_temp.k('sess'),'w1',pg_temp.ep()) where chat_id = '5001';
  assert r.shared_at is not null, 'shared_at returned';
  assert not exists (select 1 from tgp_worker_shared_chats(pg_temp.k('sess'),'w1',pg_temp.ep()-1)), 'fenced';
end $$;

-- 3. Ingest into inbox tables.
do $$ declare r jsonb; conv uuid := (select conversation_id from telegram_personal_chats where chat_id='5001'); begin
  r := tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',20,'incoming','text','new hello',null,now(),true);
  assert r->>'result' = 'INSERTED', r::text;
  assert (r->>'conversation_id')::uuid = conv;
  assert (tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',20,'incoming','text','new hello',null,now(),true)->>'result') = 'DUPLICATE';
  assert (select unread_count from conversations where id = conv) = 2;
  assert (select last_message_text from conversations where id = conv) = 'new hello';
  r := tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',21,'incoming','placeholder','cute','photo',now(),false);
  assert (select message_text from messages where id = (r->>'message_id')::uuid) like '📷 Photo (open Telegram to view)%cute';
  assert (select message_type from messages where id = (r->>'message_id')::uuid) = 'text', 'no broken image bubble';
  assert (select unread_count from conversations where id = conv) = 2, 'history/catch-up flag false does not count';
  r := tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',22,'outgoing','text','from phone',null,now(),true);
  assert (select delivery_status from messages where id = (r->>'message_id')::uuid) = 'sent';
  assert (tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'7777',1,'incoming','text','private',null,now(),true)->>'result') = 'NOT_SHARED';
  assert not exists (select 1 from messages where message_text = 'private');
  assert (tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep()-1,'5001',23,'incoming','text','x',null,now(),true)->>'result') = 'LEASE_LOST';
  assert (select platform_user_id from contacts where id = (select contact_id from conversations where id = conv)) = pg_temp.k('acc')::text || ':5001';
end $$;

-- 4. Patched tenh_inbox_page: holder sees, teammate does not until allowed; Facebook unaffected.
do $$ declare r jsonb; conv uuid := (select conversation_id from telegram_personal_chats where chat_id='5001'); fb uuid := pg_temp.k('fbconv'); begin
  r := tenh_inbox_page(pg_temp.k('holder'), array[pg_temp.k('b')], '{"size":30}'::jsonb);
  assert r->'ids' ? conv::text and r->'ids' ? fb::text, r::text;
  r := tenh_inbox_page(pg_temp.k('agent'), array[pg_temp.k('b')], '{"size":30}'::jsonb);
  assert not (r->'ids' ? conv::text), 'agent must not see holder-only chat';
  assert r->'ids' ? fb::text, 'agent still sees Facebook';
  assert (r->>'total')::int = 1, 'counts exclude hidden chats';
  assert (tenh_inbox_page(pg_temp.k('agent'), array[pg_temp.k('b')], '{"size":30,"search":"new hello"}'::jsonb)->>'total')::int = 0, 'search does not reveal hidden chats';
  assert tgp_set_team_access(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), 'all_inbox_members', null) = 'OK';
  r := tenh_inbox_page(pg_temp.k('agent'), array[pg_temp.k('b')], '{"size":30}'::jsonb);
  assert r->'ids' ? conv::text;
  r := tenh_inbox_page(pg_temp.k('agent'), array[pg_temp.k('b')], '{"size":30,"view":"all","status":"all"}'::jsonb);
  assert tgp_set_team_access(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), 'holder_only', null) = 'OK';
end $$;

-- 5. Restrictive row level security for browsers and Realtime.
insert into conversation_activity (business_id, conversation_id) select business_id, id from conversations;
insert into conversation_reminders (business_id, conversation_id) select business_id, id from conversations;
insert into customer_files (business_id, contact_id) select business_id, id from contacts;
grant select on contacts to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', false); -- agent
do $$ begin
  assert (select count(*) from conversations) = 1, 'agent: only the Facebook conversation';
  assert (select count(*) from messages where platform_message_id like 'tgp:%') = 0;
  assert (select count(*) from messages where platform_message_id not like 'tgp:%') = 1;
  assert (select count(*) from conversation_activity) = 1;
  assert (select count(*) from conversation_reminders) = 1;
  assert (select count(*) from customer_files) = 1;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false); -- holder
do $$ begin
  assert (select count(*) from conversations) = 2;
  assert (select count(*) from messages where platform_message_id like 'tgp:%') >= 4;
  assert (select count(*) from customer_files) = 2;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c9', false); -- outsider
do $$ begin assert (select count(*) from conversations) = 0, 'workspace rule still applies'; end $$;
reset role;
revoke select on contacts from authenticated;
select set_config('request.jwt.claim.sub', '', false);

-- 6. D2 send queue.
do $$ declare conv uuid := (select conversation_id from telegram_personal_chats where chat_id='5001'); r jsonb; req uuid := gen_random_uuid(); cmd uuid; c record; f jsonb; begin
  assert (tgp_enqueue_send(conv, pg_temp.k('b'), pg_temp.k('owner2'), pg_temp.k('m_owner2'), gen_random_uuid(), 'hi')->>'code') = 'HOLDER_ONLY';
  assert (tgp_enqueue_send(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), gen_random_uuid(), '   ')->>'code') = 'INVALID_TEXT';
  assert (tgp_enqueue_send(pg_temp.k('fbconv'), pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), gen_random_uuid(), 'hi')->>'code') = 'NOT_FOUND';
  r := tgp_enqueue_send(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), req, 'Hello from TENH');
  assert (r->>'ok')::boolean and r->>'state' = 'queued', r::text;
  cmd := (r->>'command_id')::uuid;
  assert (tgp_enqueue_send(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), req, 'Hello from TENH')->>'duplicate')::boolean, 'same request id is idempotent';
  assert (tgp_enqueue_send(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), gen_random_uuid(), 'again')->>'code') = 'RATE_LIMITED';
  select * into c from tgp_claim_commands_v2(pg_temp.k('sess'),'w1',pg_temp.ep(),10) where kind = 'send_text';
  assert c.id = cmd and c.payload->>'text' = 'Hello from TENH';
  assert tgp_send_begin(cmd, pg_temp.k('sess'),'w1',pg_temp.ep());
  assert not tgp_send_begin(cmd, pg_temp.k('sess'),'w1',pg_temp.ep()), 'begin only once';
  assert not exists (select 1 from tgp_claim_commands_v2(pg_temp.k('sess'),'w1',pg_temp.ep(),10) where id = cmd), 'in-flight send is never claimed again';
  assert tgp_send_accepted(cmd, pg_temp.k('sess'),'w1',pg_temp.ep(), -555);
  r := tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',30,'outgoing','text','Hello from TENH',null,now(),false, req::text, pg_temp.k('m_holder'));
  f := tgp_send_finish(pg_temp.k('sess'),'w1',pg_temp.ep(), -555, 'done', null, (r->>'message_id')::uuid);
  assert f->>'command_id' = cmd::text;
  assert (tgp_send_state(conv, pg_temp.k('b'), pg_temp.k('holder'), req)->>'state') = 'done';
  assert (select raw_payload->>'tenh_client_request_id' from messages where id = (r->>'message_id')::uuid) = req::text, 'reconciles the optimistic bubble';
  assert (select sent_by_member_id from messages where id = (r->>'message_id')::uuid) = pg_temp.k('m_holder');
  assert (tgp_send_state(conv, pg_temp.k('b'), pg_temp.k('agent'), req)->>'state') = 'not_found', 'hidden from teammates';
end $$;

-- Stale in-flight send becomes uncertain, and a late success still completes it.
do $$ declare conv uuid := (select conversation_id from telegram_personal_chats where chat_id='5001'); req uuid := gen_random_uuid(); cmd uuid; begin
  update telegram_personal_commands set created_at = now() - interval '2 minutes' where kind = 'send_text';
  cmd := (tgp_enqueue_send(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), req, 'second')->>'command_id')::uuid;
  perform tgp_claim_commands_v2(pg_temp.k('sess'),'w1',pg_temp.ep(),10);
  assert tgp_send_begin(cmd, pg_temp.k('sess'),'w1',pg_temp.ep());
  assert tgp_send_accepted(cmd, pg_temp.k('sess'),'w1',pg_temp.ep(), -556);
  update telegram_personal_commands set updated_at = now() - interval '5 minutes' where id = cmd;
  assert tgp_send_mark_stale(pg_temp.k('sess'),'w1',pg_temp.ep(), 120) = 1;
  assert (tgp_send_state(conv, pg_temp.k('b'), pg_temp.k('holder'), req)->>'state') = 'uncertain';
  assert tgp_send_finish(pg_temp.k('sess'),'w1',pg_temp.ep(), -556, 'done', null, null) is not null, 'late confirmation resolves uncertain';
  assert (tgp_send_state(conv, pg_temp.k('b'), pg_temp.k('holder'), req)->>'state') = 'done';
end $$;

-- 7. Unshare with history and remove data act on the inbox tables.
do $$ declare row1 uuid := (select id from telegram_personal_chats where chat_id='5001'); conv uuid := (select conversation_id from telegram_personal_chats where chat_id='5001'); begin
  assert tgp_unshare_chat(row1, pg_temp.k('b'), pg_temp.k('holder'), true) = 'OK';
  assert not exists (select 1 from conversations where id = conv);
  assert not exists (select 1 from messages where conversation_id = conv);
  assert not exists (select 1 from contacts where platform = 'telegram_personal');
  assert exists (select 1 from conversations where id = pg_temp.k('fbconv')), 'Facebook untouched';
  assert tgp_remove_imported_data(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('owner2')) = 'OK';
end $$;

select 'telegram-personal unified SQL: all assertions passed' as result;
