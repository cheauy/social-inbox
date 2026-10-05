-- Pilot-like state before the unified install: a connected session, a shared chat
-- with two messages in the D1 table, a Facebook conversation. Scratch DB only.
\set ON_ERROR_STOP 1
create table tgp_test_ids (name text primary key, v uuid);
insert into tgp_test_ids values ('b','00000000-0000-0000-0000-0000000000b1'),
 ('holder','00000000-0000-0000-0000-0000000000c1'),('owner2','00000000-0000-0000-0000-0000000000c2'),
 ('agent','00000000-0000-0000-0000-0000000000c3'),
 ('m_holder','00000000-0000-0000-0000-00000000a001'),('m_owner2','00000000-0000-0000-0000-00000000a002'),('m_agent','00000000-0000-0000-0000-00000000a003');
grant select on tgp_test_ids to authenticated;
insert into businesses (id) values ('00000000-0000-0000-0000-0000000000b1');
insert into team_members (id, business_id, user_id, role) values
 ('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','owner'),
 ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c2','owner'),
 ('00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c3','agent');
insert into tgp_test_ids select 'sess', tgp_begin_login('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000a001','qr');
select count(*) from tgp_claim_sessions('w1', 600, 10);
select tgp_activate((select v from tgp_test_ids where name='sess'), 'w1',
  (select lease_epoch from telegram_personal_sessions where id = (select v from tgp_test_ids where name='sess')), '7001', 'Holder', 'holder', '+855');
insert into tgp_test_ids select 'acc', social_account_id from telegram_personal_sessions where id = (select v from tgp_test_ids where name='sess');
-- shared chat with pilot messages in the D1 table
insert into telegram_personal_chats (business_id, social_account_id, chat_id, title, shared_by_user_id, unread_count, last_message_at, last_message_preview)
values ('00000000-0000-0000-0000-0000000000b1', (select v from tgp_test_ids where name='acc'), '5001', 'Customer A', '00000000-0000-0000-0000-0000000000c1', 1, now() - interval '1 hour', 'hi');
insert into telegram_personal_messages (business_id, social_account_id, chat_row_id, telegram_message_id, direction, message_type, body, placeholder_kind, sent_at)
select c.business_id, c.social_account_id, c.id, 10, 'incoming', 'text', 'hi', null, now() - interval '1 hour' from telegram_personal_chats c
union all
select c.business_id, c.social_account_id, c.id, 11, 'incoming', 'placeholder', null, 'photo', now() - interval '59 minutes' from telegram_personal_chats c;
-- a Facebook conversation in the same workspace
insert into social_accounts (id, business_id, platform, platform_account_id, is_active) values ('00000000-0000-0000-0000-00000000fb01','00000000-0000-0000-0000-0000000000b1','facebook','page1',true);
insert into contacts (id, business_id, platform, platform_user_id, full_name) values ('00000000-0000-0000-0000-00000000fc01','00000000-0000-0000-0000-0000000000b1','facebook','psid1','FB Customer');
insert into conversations (id, business_id, social_account_id, contact_id, platform, last_message_at) values ('00000000-0000-0000-0000-00000000f001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000fb01','00000000-0000-0000-0000-00000000fc01','facebook', now());
insert into messages (business_id, conversation_id, platform_message_id, direction, message_text) values ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000f001','mid.1','incoming','fb hello');
insert into tgp_test_ids values ('fbconv','00000000-0000-0000-0000-00000000f001');
