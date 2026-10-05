-- Assertions for db/proposals/20261025_telegram_personal_actions.sql (scratch DB only).
-- Run after the media test (same database).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.k(p text) returns uuid language sql as $$ select v from tgp_test_ids where name = p $$;
create or replace function pg_temp.ep() returns bigint language sql as $$ select lease_epoch from telegram_personal_sessions where id = (select v from tgp_test_ids where name='sess') $$;

do $$ declare r jsonb; conv uuid; mine uuid; theirs uuid; photo uuid; cmd uuid; begin
  update team_members set full_name = 'Holder Name' where id = pg_temp.k('m_holder');
  perform tgp_set_auto_share(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), true);
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep(),'9101','Action Person','ap') = 'SHARED';
  r := tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'9101',1,'outgoing','text','my text',null,now(),false);
  mine := (r->>'message_id')::uuid; conv := (r->>'conversation_id')::uuid;
  theirs := (tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'9101',2,'incoming','text','their text',null,now(),true)->>'message_id')::uuid;
  photo := (tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'9101',3,'outgoing','placeholder','',  'photo',now(),false)->>'message_id')::uuid;

  -- Holder only.
  assert tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('agent'), pg_temp.k('m_agent'), 'edit', mine, 'x')->>'code' = 'HOLDER_ONLY';
  assert tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('owner2'), pg_temp.k('m_owner2'), 'delete', mine, null)->>'code' = 'HOLDER_ONLY';
  -- Edit: only own text messages, with text.
  assert tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'edit', theirs, 'x')->>'code' = 'NOT_EDITABLE';
  assert tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'edit', photo, 'x')->>'code' = 'NOT_EDITABLE';
  assert tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'edit', mine, '  ')->>'code' = 'INVALID_TEXT';
  assert tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'edit', pg_temp.k('fbconv'), 'x')->>'code' = 'MESSAGE_NOT_FOUND';
  r := tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'edit', mine, 'fixed text');
  assert (r->>'ok')::boolean, r::text;
  cmd := (r->>'command_id')::uuid;
  assert (select kind from telegram_personal_commands where id = cmd) = 'edit_text';
  assert (select (payload->>'message_id')::bigint from telegram_personal_commands where id = cmd) = 1;
  assert (select payload->>'chat_id' from telegram_personal_commands where id = cmd) = '9101';
  assert tgp_action_state(cmd, pg_temp.k('b'), pg_temp.k('holder'))->>'state' = 'queued';
  assert tgp_action_state(cmd, pg_temp.k('b'), pg_temp.k('agent'))->>'state' = 'not_found', 'state only for the holder';
  -- Delete: any message (for everyone in a private chat), attributed to the member.
  r := tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'delete', theirs, null);
  assert (select payload->'message_ids'->>0 from telegram_personal_commands where id = (r->>'command_id')::uuid) = '2';
  assert tgp_mark_deleted_by_member(pg_temp.k('sess'),'w1',pg_temp.ep(),theirs,pg_temp.k('m_holder'));
  assert (select raw_payload->'tenh_deleted'->>'deleted_by_name' from messages where id = theirs) = 'Holder Name';
  assert (select raw_payload->'tenh_deleted'->>'source' from messages where id = theirs) = 'tenh';
  assert tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'delete', theirs, null)->>'code' = 'ALREADY_DELETED';
  assert not tgp_mark_deleted_by_member(pg_temp.k('sess'),'w1',pg_temp.ep()-1,mine,pg_temp.k('m_holder')), 'fenced';
  -- Typing: at most one per 4 seconds.
  assert (tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'typing', null, null)->>'ok')::boolean;
  assert (tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'typing', null, null)->>'skipped')::boolean;
  assert (select count(*) from telegram_personal_commands where kind = 'typing') = 1;
  assert tgp_enqueue_action(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'react', mine, null)->>'code' = 'INVALID_ACTION';
  assert not has_function_privilege('authenticated', 'public.tgp_enqueue_action(uuid,uuid,uuid,uuid,text,uuid,text)', 'execute');
end $$;

select 'telegram-personal actions SQL: all assertions passed' as result;
