-- Assertions for db/proposals/20261024_telegram_personal_media.sql (scratch DB only).
-- Run after the auto-share test (same database).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.k(p text) returns uuid language sql as $$ select v from tgp_test_ids where name = p $$;
create or replace function pg_temp.ep() returns bigint language sql as $$ select lease_epoch from telegram_personal_sessions where id = (select v from tgp_test_ids where name='sess') $$;

do $$ declare r jsonb; conv uuid; m1 uuid; m2 uuid; acc text := pg_temp.k('acc')::text; req uuid := gen_random_uuid(); n int; begin
  -- Sends queued by earlier tests in this database would count toward the rate limit.
  delete from telegram_personal_commands where kind in ('send_text','send_media');
  -- A shared chat with two messages.
  perform tgp_set_auto_share(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), true);
  assert tgp_worker_auto_share(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001','Media Person','mp') = 'SHARED';
  r := tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001',100,'incoming','text','first',null,now() - interval '1 minute',true);
  m1 := (r->>'message_id')::uuid; conv := (r->>'conversation_id')::uuid;
  r := tgp_ingest_inbox_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001',101,'incoming','placeholder','look','photo',now(),true);
  m2 := (r->>'message_id')::uuid;

  -- Media: the message becomes an image with the inbox media link; fenced; only own account.
  assert not tgp_set_message_media(pg_temp.k('sess'),'w1',pg_temp.ep()-1,m2,'image','look','{}');
  assert not tgp_set_message_media(pg_temp.k('sess'),'w1',pg_temp.ep(),m2,'voice','look','{}'), 'type checked';
  assert not tgp_set_message_media(pg_temp.k('sess'),'w1',pg_temp.ep(),pg_temp.k('fbconv'),'image','x','{}');
  assert tgp_set_message_media(pg_temp.k('sess'),'w1',pg_temp.ep(),m2,'image','look','{"mime_type":"image/jpeg","size":1000}');
  assert (select message_type from messages where id = m2) = 'image';
  assert (select attachment_url from messages where id = m2) = '/api/messages/' || m2::text || '/media';
  assert (select message_text from messages where id = m2) = 'look';
  assert (select raw_payload->'tenh_attachment'->>'mime_type' from messages where id = m2) = 'image/jpeg';

  -- Reply: quotes the earlier message in the inbox format; unknown target gets a neutral preview.
  assert tgp_set_message_reply(pg_temp.k('sess'),'w1',pg_temp.ep(),m2,'9001',100);
  assert (select raw_payload->'tenh_reply'->>'reply_to_local_message_id' from messages where id = m2) = m1::text;
  assert (select raw_payload->'tenh_reply'->>'preview_text' from messages where id = m2) = 'first';
  assert tgp_set_message_reply(pg_temp.k('sess'),'w1',pg_temp.ep(),m1,'9001',5);
  assert (select raw_payload->'tenh_reply'->>'preview_text' from messages where id = m1) = 'Earlier message';

  -- Edit: newer edit wins, older is ignored, last message text follows.
  assert tgp_edit_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001',101,'look again',now()) = 'OK';
  assert tgp_edit_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001',101,'stale',now() - interval '1 hour') = 'OLDER';
  assert (select message_text from messages where id = m2) = 'look again';
  assert (select raw_payload->'tenh_edit'->>'source' from messages where id = m2) = 'telegram';
  assert (select last_message_text from conversations where id = conv) = 'look again';
  assert tgp_edit_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001',999,'x',now()) = 'NOT_FOUND';

  -- Delete: shown as deleted, media link and text removed, idempotent, other accounts untouched.
  n := tgp_delete_messages(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001',array[101,999]::bigint[]);
  assert n = 1, n::text;
  assert (select attachment_url from messages where id = m2) is null;
  assert (select message_text from messages where id = m2) = 'Message deleted';
  assert (select raw_payload->'tenh_deleted'->>'source' from messages where id = m2) = 'telegram';
  assert tgp_delete_messages(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001',array[101]::bigint[]) = 0;
  assert tgp_delete_messages(pg_temp.k('sess'),'w1',pg_temp.ep()-1,'9001',array[100]::bigint[]) = 0;

  -- Profile photo.
  r := tgp_worker_chat_contact(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001');
  assert (r->>'business_id')::uuid = pg_temp.k('b');
  assert tgp_set_contact_photo(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001',true);
  assert (select profile_picture_url from contacts where id = (r->>'contact_id')::uuid) = '/api/contacts/' || (r->>'contact_id') || '/telegram-avatar';
  assert tgp_set_contact_photo(pg_temp.k('sess'),'w1',pg_temp.ep(),'9001',false);
  assert (select profile_picture_url from contacts where id = (r->>'contact_id')::uuid) is null;
  assert tgp_worker_chat_contact(pg_temp.k('sess'),'w1',pg_temp.ep(),'7777') is null;

  -- Send media and replies: validated, holder only, shared rate limit.
  r := tgp_enqueue_send_v2(conv, pg_temp.k('b'), pg_temp.k('agent'), pg_temp.k('m_agent'), req, 'hi', null, null);
  assert r->>'code' = 'HOLDER_ONLY', r::text;
  r := tgp_enqueue_send_v2(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), req, 'cap',
        jsonb_build_object('kind','photo','storage_path', pg_temp.k('b')::text || '/tgp-outbox/other/x.jpg','size',10,'mime_type','image/jpeg','name','x.jpg'), null);
  assert r->>'code' = 'INVALID_MEDIA', 'path must belong to this request';
  r := tgp_enqueue_send_v2(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), req, 'cap',
        jsonb_build_object('kind','exe','storage_path', pg_temp.k('b')::text || '/tgp-outbox/' || req::text || '/x','size',10,'mime_type','a/b','name','x'), null);
  assert r->>'code' = 'INVALID_MEDIA';
  r := tgp_enqueue_send_v2(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), req, 'x', null, pg_temp.k('fbconv'));
  assert r->>'code' = 'REPLY_NOT_FOUND', 'reply target must be in this chat';
  r := tgp_enqueue_send_v2(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), req, 'cap',
        jsonb_build_object('kind','photo','storage_path', pg_temp.k('b')::text || '/tgp-outbox/' || req::text || '/x.jpg','size',10,'mime_type','image/jpeg','name','x.jpg'), m1);
  assert (r->>'ok')::boolean, r::text;
  assert (select kind from telegram_personal_commands where client_request_id = req) = 'send_media';
  assert (select payload->>'reply_to_message_id' from telegram_personal_commands where client_request_id = req) = '100';
  assert (select payload->'media'->>'kind' from telegram_personal_commands where client_request_id = req) = 'photo';
  r := tgp_enqueue_send_v2(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), req, 'cap', null, null);
  assert (r->>'duplicate')::boolean, 'same request id not queued again';
  r := tgp_enqueue_send_v2(conv, pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), gen_random_uuid(), 'again', null, null);
  assert r->>'code' = 'RATE_LIMITED', 'text and media share the limit';

  -- The worker lifecycle accepts send_media.
  update telegram_personal_commands set status = 'claimed' where client_request_id = req;
  assert tgp_send_begin((select id from telegram_personal_commands where client_request_id = req), pg_temp.k('sess'), 'w1', pg_temp.ep());
  assert tgp_send_accepted((select id from telegram_personal_commands where client_request_id = req), pg_temp.k('sess'), 'w1', pg_temp.ep(), 555);
  r := tgp_send_finish(pg_temp.k('sess'), 'w1', pg_temp.ep(), 555, 'done', null, null);
  assert r->'payload'->'media'->>'storage_path' like '%/x.jpg';
  assert (tgp_send_state(conv, pg_temp.k('b'), pg_temp.k('holder'), req)->>'state') = 'done';

  assert not has_function_privilege('authenticated', 'public.tgp_enqueue_send_v2(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid)', 'execute');
  assert not has_function_privilege('authenticated', 'public.tgp_set_message_media(uuid,text,bigint,uuid,text,text,jsonb)', 'execute');
end $$;

select 'telegram-personal media SQL: all assertions passed' as result;
