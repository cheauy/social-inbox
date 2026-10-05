-- Assertions for db/proposals/20261021_telegram_personal_d1.sql on a scratch database
-- (after stub schema + 20261020 draft + D1). Never run against TENH.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

insert into businesses (id) values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2');
insert into team_members (id, business_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000f1','owner'),  -- holder
  ('00000000-0000-0000-0000-00000000e002','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000f2','owner'),  -- other owner
  ('00000000-0000-0000-0000-00000000e003','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000f3','agent'),  -- agent
  ('00000000-0000-0000-0000-00000000e004','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000f4','owner');  -- other workspace

create temp table k (name text primary key, v uuid);
insert into k values ('b','00000000-0000-0000-0000-0000000000d1'),('b2','00000000-0000-0000-0000-0000000000d2'),
 ('holder','00000000-0000-0000-0000-0000000000f1'),('owner','00000000-0000-0000-0000-0000000000f2'),
 ('agent','00000000-0000-0000-0000-0000000000f3'),('outsider','00000000-0000-0000-0000-0000000000f4'),
 ('m_holder','00000000-0000-0000-0000-00000000e001'),('m_agent','00000000-0000-0000-0000-00000000e003');
create or replace function pg_temp.k(p text) returns uuid language sql as $$ select v from k where name = p $$;

-- Connected session for the holder (via the real RPCs).
insert into k select 'sess', tgp_begin_login(pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), 'qr');
create temp table lease as select * from tgp_claim_sessions('w1', 60, 10);
create or replace function pg_temp.ep() returns bigint language sql as $$ select lease_epoch from telegram_personal_sessions where id = (select v from k where name='sess') $$;
do $$ begin assert (tgp_activate(pg_temp.k('sess'), 'w1', pg_temp.ep(), '7001', 'Holder', 'holder', '+855 1')->>'ok')::boolean; end $$;
insert into k select 'acc', social_account_id from telegram_personal_sessions where id = pg_temp.k('sess');

-- 1. Chat list: only the holder may request; sharing requires a listed chat.
do $$ declare cmd uuid; r jsonb; c record; begin
  assert tgp_request_chat_list(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('owner'), pg_temp.k('m_holder')) is null, 'other owner cannot list chats';
  cmd := tgp_request_chat_list(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'));
  assert cmd is not null;
  assert tgp_request_chat_list(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder')) = cmd, 'debounced';
  assert (tgp_read_chat_list(cmd, pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'))->>'state') = 'pending';
  select * into c from tgp_claim_commands_v2(pg_temp.k('sess'), 'w1', pg_temp.ep(), 10);
  assert c.kind = 'list_chats';
  assert tgp_finish_command_result(cmd, pg_temp.k('sess'), 'w1', pg_temp.ep(), 'done', null,
    '{"chats":[{"chat_id":"5001","title":"Customer A","username":"cust_a"},{"chat_id":"5002","title":"Customer B","username":null}]}');
  r := tgp_read_chat_list(cmd, pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'));
  assert r->>'state' = 'ready' and jsonb_array_length(r->'chats') = 2, r::text;
  assert (tgp_read_chat_list(cmd, pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('agent'))->>'state') = 'forbidden';
  assert (tgp_share_chat(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), '9999', 'none')->>'code') = 'CHAT_NOT_LISTED';
  assert (tgp_share_chat(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('agent'), pg_temp.k('m_agent'), '5001', 'none')->>'code') = 'FORBIDDEN';
  r := tgp_share_chat(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), '5001', 'none');
  assert (r->>'ok')::boolean, r::text;
  assert (select title from telegram_personal_chats where chat_id = '5001') = 'Customer A', 'title from worker result';
  r := tgp_share_chat(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'), pg_temp.k('m_holder'), '5002', 'last_50');
  assert (r->>'ok')::boolean;
  assert exists (select 1 from telegram_personal_commands where kind = 'import_history' and payload->>'chat_id' = '5002');
end $$;

-- 2. Ingest: duplicates, out-of-order, unread rules, unshared hash only.
do $$ declare row1 uuid := (select id from telegram_personal_chats where chat_id='5001'); begin
  update telegram_personal_chats set last_read_at = '2026-10-05 10:00:00+00' where id = row1;
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',10,'incoming','text','hello',null,'2026-10-05 10:05:00+00') = 'INSERTED';
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',10,'incoming','text','hello',null,'2026-10-05 10:05:00+00') = 'DUPLICATE';
  -- older message arriving later (out of order) must not replace the preview
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',9,'incoming','placeholder','nice view','photo','2026-10-05 10:04:00+00') = 'INSERTED';
  -- history before the read point does not count as unread
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',2,'incoming','text','old',null,'2026-10-01 08:00:00+00') = 'INSERTED';
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',11,'outgoing','text','reply from phone',null,'2026-10-05 10:06:00+00') = 'INSERTED';
  assert (select unread_count from telegram_personal_chats where id = row1) = 2, 'two new incoming after read point';
  assert (select last_message_preview from telegram_personal_chats where id = row1) = 'reply from phone';
  assert (select last_direction from telegram_personal_chats where id = row1) = 'outgoing';
  assert (select count(*) from telegram_personal_messages where chat_row_id = row1) = 4;
  -- same Telegram message id in another chat is a different message
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5002',10,'incoming','text','other chat',null,'2026-10-05 10:07:00+00') = 'INSERTED';
  -- unshared chat: nothing stored except an account-scoped hash
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'6001',1,'incoming','text','secret',null,'2026-10-05 10:08:00+00') = 'NOT_SHARED';
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'6001',2,'incoming','text','secret 2',null,'2026-10-05 10:09:00+00') = 'NOT_SHARED';
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'6002',1,'outgoing','text','mine',null,'2026-10-05 10:09:00+00') = 'NOT_SHARED';
  assert (select count(*) from telegram_personal_unshared_activity) = 1, 'one waiting chat (outgoing does not count)';
  assert not exists (select 1 from telegram_personal_messages where body like 'secret%');
  assert not exists (select 1 from telegram_personal_unshared_activity where chat_hash like '%6001%');
  -- stale lease cannot write
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep()-1,'5001',99,'incoming','text','x',null,now()) = 'LEASE_LOST';
  -- workers of other sessions see only their own shares
  assert (select count(*) from tgp_worker_shared_chats(pg_temp.k('sess'),'w1',pg_temp.ep())) = 2;
end $$;

-- 3. Visibility matrix (service-side function and browser RLS).
do $$ declare acc uuid := pg_temp.k('acc'); sess uuid := pg_temp.k('sess'); begin
  assert tgp_member_can_see(acc, pg_temp.k('holder'));
  assert not tgp_member_can_see(acc, pg_temp.k('owner')), 'default: holder only';
  assert not tgp_member_can_see(acc, pg_temp.k('agent'));
  assert not tgp_member_can_see(acc, pg_temp.k('outsider'));
  assert tgp_set_team_access(sess, pg_temp.k('b'), pg_temp.k('holder'), 'owners', null) = 'OK';
  assert tgp_member_can_see(acc, pg_temp.k('owner')) and not tgp_member_can_see(acc, pg_temp.k('agent'));
  assert tgp_set_team_access(sess, pg_temp.k('b'), pg_temp.k('holder'), 'selected_members', array[pg_temp.k('m_agent')]) = 'OK';
  assert tgp_member_can_see(acc, pg_temp.k('agent')) and not tgp_member_can_see(acc, pg_temp.k('owner'));
  assert tgp_set_team_access(sess, pg_temp.k('b'), pg_temp.k('holder'), 'all_inbox_members', null) = 'OK';
  assert tgp_member_can_see(acc, pg_temp.k('agent')) and not tgp_member_can_see(acc, pg_temp.k('outsider'));
  update team_members set is_active = false where id = pg_temp.k('m_agent');
  assert not tgp_member_can_see(acc, pg_temp.k('agent')), 'removed member loses access';
  update team_members set is_active = true where id = pg_temp.k('m_agent');
  assert tgp_set_team_access(sess, pg_temp.k('b'), pg_temp.k('holder'), 'holder_only', null) = 'OK';
end $$;

-- Browser view through row level security
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f3', false); -- agent
do $$ begin
  assert (select count(*) from public.telegram_personal_messages) = 0, 'agent sees nothing while holder_only';
  assert (select count(*) from public.telegram_personal_chats) = 0;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false); -- holder
do $$ begin
  assert (select count(*) from public.telegram_personal_messages) = 5, 'holder sees shared messages';
end $$;
do $$ begin
  begin
    perform count(*) from public.telegram_personal_unshared_activity;
    raise exception 'browser must not read unshared activity';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.tgp_member_can_see(gen_random_uuid(), gen_random_uuid());
    raise exception 'browser must not call tgp_member_can_see with arbitrary users';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.telegram_personal_messages (business_id, social_account_id, chat_row_id, telegram_message_id, direction, message_type, sent_at)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'incoming', 'text', now());
    raise exception 'browser must not write messages';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- 4. Read, unshare, remove data.
do $$ declare row1 uuid := (select id from telegram_personal_chats where chat_id='5001'); row2 uuid := (select id from telegram_personal_chats where chat_id='5002'); begin
  assert not tgp_mark_chat_read(row1, pg_temp.k('b'), pg_temp.k('agent')), 'agent cannot mark read without access';
  assert tgp_mark_chat_read(row1, pg_temp.k('b'), pg_temp.k('holder'));
  assert (select unread_count from telegram_personal_chats where id = row1) = 0;
  assert not tgp_mark_chat_read(row1, pg_temp.k('b2'), pg_temp.k('holder')), 'cross-workspace id rejected';
  assert tgp_unshare_chat(row1, pg_temp.k('b'), pg_temp.k('owner'), false) = 'FORBIDDEN', 'only the holder unshares';
  assert tgp_unshare_chat(row1, pg_temp.k('b'), pg_temp.k('holder'), false) = 'OK';
  assert tgp_ingest_message(pg_temp.k('sess'),'w1',pg_temp.ep(),'5001',50,'incoming','text','after unshare',null,now()) = 'NOT_SHARED';
  assert (select count(*) from telegram_personal_messages where chat_row_id = row1) = 4, 'history kept';
  assert tgp_unshare_chat(row2, pg_temp.k('b'), pg_temp.k('holder'), true) = 'OK';
  assert not exists (select 1 from telegram_personal_chats where id = row2), 'deleted with history';
  assert tgp_dismiss_unshared(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('holder'));
  assert tgp_remove_imported_data(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('agent')) = 'FORBIDDEN';
  assert tgp_remove_imported_data(pg_temp.k('sess'), pg_temp.k('b'), pg_temp.k('owner')) = 'OK';
  assert (select count(*) from telegram_personal_messages) = 0 and (select count(*) from telegram_personal_chats) = 0;
end $$;

-- 5. Existing inbox tables are untouched by D1.
do $$ begin
  assert pg_get_constraintdef((select oid from pg_constraint where conname='conversations_platform_check')) not like '%telegram_personal%';
  assert pg_get_constraintdef((select oid from pg_constraint where conname='contacts_platform_check')) not like '%telegram_personal%';
end $$;

select 'telegram-personal D1 SQL: all assertions passed' as result;
