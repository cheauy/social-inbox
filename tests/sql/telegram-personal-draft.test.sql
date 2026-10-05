-- Assertions for db/proposals/20261020_telegram_personal_draft.sql.
-- Runs on a scratch database after telegram-personal-stub-schema.sql and the draft.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error matching % but statement succeeded: %', p_pattern, p_sql;
exception when others then
  if sqlerrm not like p_pattern then raise exception 'expected % got %', p_pattern, sqlerrm; end if;
end $$;

-- Fixtures ---------------------------------------------------------------------
insert into businesses (id, name) values
  ('00000000-0000-0000-0000-0000000000b1','Workspace One'),
  ('00000000-0000-0000-0000-0000000000b2','Workspace Two'),
  ('00000000-0000-0000-0000-0000000000b3','Full Workspace'),
  ('00000000-0000-0000-0000-0000000000b4','Locked Workspace');
insert into team_members (id, business_id, user_id, role) values
  ('00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','owner'),
  ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c2','owner'),
  ('00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c3','agent'),
  ('00000000-0000-0000-0000-00000000a004','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000c4','owner'),
  ('00000000-0000-0000-0000-00000000a005','00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c5','owner'),
  ('00000000-0000-0000-0000-00000000a006','00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000c6','owner');
insert into business_subscriptions (business_id, status, channel_limit, current_period_end) values
  ('00000000-0000-0000-0000-0000000000b1','active',3, now() + interval '30 days'),
  ('00000000-0000-0000-0000-0000000000b3','active',1, now() + interval '30 days'),
  ('00000000-0000-0000-0000-0000000000b4','expired',5, now() - interval '1 day');
-- b2 has no subscription row (legacy/unmanaged) -> allowed.
insert into social_accounts (business_id, platform, platform_account_id, is_active) values
  ('00000000-0000-0000-0000-0000000000b3','telegram','777000111', true); -- full workspace: Bot uses its only slot

-- Short aliases
create temp table ids (k text primary key, v uuid);
insert into ids values ('b1','00000000-0000-0000-0000-0000000000b1'),('b2','00000000-0000-0000-0000-0000000000b2'),
 ('b3','00000000-0000-0000-0000-0000000000b3'),('b4','00000000-0000-0000-0000-0000000000b4'),
 ('u1','00000000-0000-0000-0000-0000000000c1'),('u2','00000000-0000-0000-0000-0000000000c2'),
 ('u3','00000000-0000-0000-0000-0000000000c3'),('u4','00000000-0000-0000-0000-0000000000c4'),
 ('u5','00000000-0000-0000-0000-0000000000c5'),('u6','00000000-0000-0000-0000-0000000000c6'),
 ('m1','00000000-0000-0000-0000-00000000a001'),('m2','00000000-0000-0000-0000-00000000a002'),
 ('m3','00000000-0000-0000-0000-00000000a003'),('m4','00000000-0000-0000-0000-00000000a004');

-- 1. begin_login permission & limits -------------------------------------------
select pg_temp.expect_error($$select tgp_begin_login('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-00000000a003','qr')$$, '%TGP_NOT_OWNER%');
select pg_temp.expect_error($$select tgp_begin_login('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-00000000a004','qr')$$, '%TGP_NOT_OWNER%'); -- owner of another workspace
select pg_temp.expect_error($$select tgp_begin_login('00000000-0000-0000-0000-0000000000b3','00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-00000000a005','qr')$$, '%TGP_CHANNEL_LIMIT_REACHED%');
select pg_temp.expect_error($$select tgp_begin_login('00000000-0000-0000-0000-0000000000b4','00000000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-00000000a006','qr')$$, '%TGP_SUBSCRIPTION_LOCKED%');
select pg_temp.expect_error($$select tgp_begin_login('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000a001','sms')$$, '%TGP_BAD_METHOD%');

create temp table s (k text primary key, v uuid);
insert into s select 'a', tgp_begin_login((select v from ids where k='b1'),(select v from ids where k='u1'),(select v from ids where k='m1'),'qr');
select pg_temp.expect_error($$select tgp_begin_login('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000a001','phone')$$, '%TGP_LOGIN_ALREADY_OPEN%');
insert into s select 'b2', tgp_begin_login((select v from ids where k='b2'),(select v from ids where k='u4'),(select v from ids where k='m4'),'phone');
do $$ begin
  assert (select status from telegram_personal_sessions where id=(select v from s where k='a')) = 'connecting';
  assert (select count(*) from telegram_personal_logins where session_id=(select v from s where k='a')) = 1;
end $$;

-- 2. Lease claim, isolation and fencing -----------------------------------------
create temp table lease as select * from tgp_claim_sessions('worker-A', 30, 10);
do $$ begin
  assert (select count(*) from lease) = 2, 'worker A claims both open logins';
  assert (select count(*) from tgp_claim_sessions('worker-B', 30, 10)) = 0, 'worker B cannot claim leased sessions';
end $$;
-- Simulate expiry: B still cannot take A's pinned sessions (local TDLib data lives on A).
update telegram_personal_sessions set lease_expires_at = now() - interval '1 second';
do $$ declare old_epoch bigint; begin
  assert (select count(*) from tgp_claim_sessions('worker-B', 30, 10)) = 0, 'sessions pinned to worker A';
  select lease_epoch into old_epoch from lease where id=(select v from s where k='a');
  assert not tgp_renew_lease((select v from s where k='a'),'worker-A',old_epoch,30), 'expired lease cannot be renewed';
  assert (select count(*) from tgp_claim_sessions('worker-A', 30, 10)) = 2, 'A re-claims after restart';
  assert not tgp_worker_update((select v from s where k='a'),'worker-A',old_epoch,'{"last_error_code":"X"}'), 'stale epoch write fenced';
  assert not tgp_worker_login_update((select v from s where k='a'),'worker-A',old_epoch,'waiting_qr','tg://login?token=AAA',null,null), 'stale epoch login write fenced';
end $$;
create temp table ep as select id, lease_epoch from telegram_personal_sessions;

-- 3. Login progress, delayed QR after cancel ------------------------------------
do $$ declare sa uuid := (select v from s where k='a'); e bigint := (select lease_epoch from ep where id=(select v from s where k='a')); begin
  assert tgp_worker_login_update(sa,'worker-A',e,'waiting_qr','tg://login?token=AAA',null,null);
  assert (select qr_link from telegram_personal_logins where session_id=sa) = 'tg://login?token=AAA';
  -- not in waiting_code: code input refused
  assert not tgp_submit_login_input(sa,(select v from ids where k='b1'),(select v from ids where k='u1'),'code','sealed');
  -- other owner cannot submit or cancel the holder's login
  assert not tgp_cancel_login(sa,(select v from ids where k='b1'),(select v from ids where k='u2'));
  assert tgp_cancel_login(sa,(select v from ids where k='b1'),(select v from ids where k='u1'));
  assert (select status from telegram_personal_sessions where id=sa) = 'cancelled';
  assert not exists (select 1 from telegram_personal_logins where session_id=sa), 'QR link removed on cancel';
  -- delayed QR refresh from TDLib after cancel is dropped
  assert not tgp_worker_login_update(sa,'worker-A',e,'waiting_qr','tg://login?token=BBB',null,null);
  assert not tgp_worker_update(sa,'worker-A',e,'{"status":"waiting_qr"}');
  assert (tgp_activate(sa,'worker-A',e,'5550001','Late','late','+855 •• 1')->>'code') = 'LOGIN_NOT_OPEN';
  assert (select status from telegram_personal_sessions where id=sa) = 'cancelled';
  -- cleanup fields still writable on a terminal session
  assert tgp_worker_update(sa,'worker-A',e,'{"local_state":"removed","db_key_wrapped":null}');
end $$;

-- 4. Phone/code/password inputs are single-use ------------------------------------
do $$ declare sb uuid := (select v from s where k='b2'); e bigint := (select lease_epoch from ep where id=(select v from s where k='b2')); r record; begin
  assert tgp_worker_update(sb,'worker-A',e,'{"db_key_wrapped":"v1.wrapped","local_state":"present"}');
  assert not tgp_worker_update(sb,'worker-A',e,'{"db_key_wrapped":"v1.other"}'), 'key set once';
  assert tgp_worker_login_update(sb,'worker-A',e,'waiting_phone',null,null,null);
  assert tgp_submit_login_input(sb,(select v from ids where k='b2'),(select v from ids where k='u4'),'phone','sealed-phone');
  select * into r from tgp_take_login_input(sb,'worker-A',e);
  assert r.input_kind = 'phone' and r.input_sealed = 'sealed-phone';
  select * into r from tgp_take_login_input(sb,'worker-A',e);
  assert r.input_sealed is null, 'input consumed once';
  assert tgp_worker_login_update(sb,'worker-A',e,'waiting_password',null,'my hint',null);
  assert (select password_hint from telegram_personal_logins where session_id=sb) = 'my hint';
  assert tgp_worker_login_update(sb,'worker-A',e,'waiting_password',null,'my hint','PASSWORD_INVALID');
  assert (select last_error_code from telegram_personal_sessions where id=sb) = 'PASSWORD_INVALID';
  assert not tgp_worker_login_update(sb,'worker-A',e,'connected',null,null,null), 'login update cannot mark connected';
end $$;

-- 5. Activation: creates channel, counts against limit ---------------------------
do $$ declare sb uuid := (select v from s where k='b2'); e bigint := (select lease_epoch from ep where id=(select v from s where k='b2')); r jsonb; begin
  r := tgp_activate(sb,'worker-A',e,'5550001','Holder Four','holder4','+855 •• ••• 001');
  assert (r->>'ok')::boolean, r::text;
  assert (select platform from social_accounts where id=(r->>'social_account_id')::uuid) = 'telegram_personal';
  assert (select is_active from social_accounts where id=(r->>'social_account_id')::uuid);
  assert (select status from telegram_personal_sessions where id=sb) = 'connected';
  assert not exists (select 1 from telegram_personal_logins where session_id=sb);
  assert (select count(*) from social_accounts where business_id=(select v from ids where k='b2') and is_active) = 1;
end $$;

-- 6. Same Telegram account in another workspace / same workspace ------------------
insert into s select 'c', tgp_begin_login((select v from ids where k='b1'),(select v from ids where k='u1'),(select v from ids where k='m1'),'qr');
insert into s select 'd', tgp_begin_login((select v from ids where k='b1'),(select v from ids where k='u2'),(select v from ids where k='m2'),'qr');
create temp table ep2 as select * from tgp_claim_sessions('worker-A', 30, 10);
do $$ declare sc uuid := (select v from s where k='c'); sd uuid := (select v from s where k='d'); r jsonb; begin
  r := tgp_activate(sc,'worker-A',(select lease_epoch from ep2 where id=sc),'5550001','Dup','dup','+1');
  assert r->>'code' = 'ACCOUNT_IN_OTHER_WORKSPACE', r::text;
  assert (select status from telegram_personal_sessions where id=sc) = 'failed';
  r := tgp_activate(sd,'worker-A',(select lease_epoch from ep2 where id=sd),'5550002','Two','two','+2');
  assert (r->>'ok')::boolean, r::text;
end $$;
insert into s select 'e', tgp_begin_login((select v from ids where k='b1'),(select v from ids where k='u1'),(select v from ids where k='m1'),'qr');
create temp table ep3 as select * from tgp_claim_sessions('worker-A', 30, 10);
do $$ declare se uuid := (select v from s where k='e'); r jsonb; begin
  r := tgp_activate(se,'worker-A',(select lease_epoch from ep3 where id=se),'5550002','Same','same','+2');
  assert r->>'code' = 'ACCOUNT_ALREADY_CONNECTED', r::text;
end $$;

-- 7. Capacity is re-checked at activation (race between two logins) ---------------
update business_subscriptions set channel_limit = 2 where business_id = (select v from ids where k='b1');
insert into s select 'f', tgp_begin_login((select v from ids where k='b1'),(select v from ids where k='u1'),(select v from ids where k='m1'),'qr');
update business_subscriptions set channel_limit = 1 where business_id = (select v from ids where k='b1');
create temp table ep4 as select * from tgp_claim_sessions('worker-A', 30, 10);
do $$ declare sf uuid := (select v from s where k='f'); r jsonb; begin
  r := tgp_activate(sf,'worker-A',(select lease_epoch from ep4 where id=sf),'5550003','Three','three','+3');
  assert r->>'code' = 'CHANNEL_LIMIT_REACHED', r::text;
end $$;
update business_subscriptions set channel_limit = 3 where business_id = (select v from ids where k='b1');

-- 8. Holder demoted mid-login --------------------------------------------------
insert into s select 'g', tgp_begin_login((select v from ids where k='b1'),(select v from ids where k='u1'),(select v from ids where k='m1'),'qr');
update team_members set role = 'agent' where id = (select v from ids where k='m1');
create temp table ep5 as select * from tgp_claim_sessions('worker-A', 30, 10);
do $$ declare sg uuid := (select v from s where k='g'); begin
  assert (tgp_activate(sg,'worker-A',(select lease_epoch from ep5 where id=sg),'5550004','X','x','+4')->>'code') = 'HOLDER_NO_LONGER_OWNER';
end $$;
update team_members set role = 'owner' where id = (select v from ids where k='m1');

-- 9. Lifecycle actions & permissions ---------------------------------------------
do $$ declare sd uuid := (select v from s where k='d'); acc uuid; req uuid := gen_random_uuid(); begin
  acc := (select social_account_id from telegram_personal_sessions where id=sd);
  assert tgp_request_action(sd,(select v from ids where k='b1'),(select v from ids where k='u3'),(select v from ids where k='m3'),'logout',gen_random_uuid()) = 'FORBIDDEN', 'agent cannot revoke';
  assert tgp_request_action(sd,(select v from ids where k='b2'),(select v from ids where k='u4'),(select v from ids where k='m4'),'logout',gen_random_uuid()) = 'NOT_FOUND', 'cross-workspace id rejected';
  assert tgp_request_action(sd,(select v from ids where k='b1'),(select v from ids where k='u2'),(select v from ids where k='m2'),'pause',req) = 'OK';
  assert tgp_request_action(sd,(select v from ids where k='b1'),(select v from ids where k='u2'),(select v from ids where k='m2'),'pause',req) = 'DUPLICATE';
  assert (select status from telegram_personal_sessions where id=sd) = 'pausing';
  assert not (select is_active from social_accounts where id=acc), 'pause frees the slot immediately';
end $$;
-- worker processes the pause
create temp table ep6 as select * from telegram_personal_sessions where id=(select v from s where k='d');
do $$ declare sd uuid := (select v from s where k='d'); e bigint := (select lease_epoch from ep6); c record; begin
  select * into c from tgp_claim_commands(sd,'worker-A',e,10);
  assert c.kind = 'pause';
  assert not tgp_worker_update(sd,'worker-A',e,'{"status":"connected"}'), 'pausing cannot be revived';
  assert tgp_worker_update(sd,'worker-A',e,'{"status":"paused"}');
  assert tgp_finish_command(c.id,sd,'worker-A',e,'done',null);
  assert not tgp_finish_command(c.id,sd,'worker-A',e,'done',null), 'command finishes once';
  assert tgp_release_lease(sd,'worker-A',e,'clean');
  assert (select last_shutdown from telegram_personal_sessions where id=sd) = 'clean';
  -- another owner may not resume the holder's account
  assert tgp_request_action(sd,(select v from ids where k='b1'),(select v from ids where k='u1'),(select v from ids where k='m1'),'resume',gen_random_uuid()) = 'FORBIDDEN';
  update business_subscriptions set channel_limit = 0 where business_id=(select v from ids where k='b1');
  assert tgp_request_action(sd,(select v from ids where k='b1'),(select v from ids where k='u2'),(select v from ids where k='m2'),'resume',gen_random_uuid()) = 'CHANNEL_LIMIT_REACHED';
  update business_subscriptions set channel_limit = 3 where business_id=(select v from ids where k='b1');
  assert tgp_request_action(sd,(select v from ids where k='b1'),(select v from ids where k='u2'),(select v from ids where k='m2'),'resume',gen_random_uuid()) = 'OK';
  assert (select is_active from social_accounts where id=(select social_account_id from telegram_personal_sessions where id=sd));
  -- any owner can sign the account out (revocation)
  assert tgp_request_action(sd,(select v from ids where k='b1'),(select v from ids where k='u1'),(select v from ids where k='m1'),'logout',gen_random_uuid()) = 'OK';
  assert (select status from telegram_personal_sessions where id=sd) = 'disconnect_pending';
end $$;
create temp table ep7 as select * from tgp_claim_sessions('worker-A', 30, 10) where id=(select v from s where k='d');
do $$ declare sd uuid := (select v from s where k='d'); e bigint := (select lease_epoch from ep7); begin
  assert e is not null, 'disconnect_pending session is claimable';
  assert tgp_worker_update(sd,'worker-A',e,'{"status":"disconnected","local_state":"removed","db_key_wrapped":null}');
  assert not tgp_worker_update(sd,'worker-A',e,'{"status":"connected"}'), 'terminal is final';
  assert (select db_key_wrapped from telegram_personal_sessions where id=sd) is null;
end $$;

-- 10. Reconnect same account after disconnect reuses the channel row (history kept)
insert into s select 'h', tgp_begin_login((select v from ids where k='b1'),(select v from ids where k='u2'),(select v from ids where k='m2'),'qr');
create temp table ep8 as select * from tgp_claim_sessions('worker-A', 30, 10) where id=(select v from s where k='h');
do $$ declare sh uuid := (select v from s where k='h'); r jsonb; begin
  r := tgp_activate(sh,'worker-A',(select lease_epoch from ep8),'5550002','Two again','two','+2');
  assert (r->>'ok')::boolean, r::text;
  assert (select count(*) from social_accounts where platform='telegram_personal' and platform_account_id='5550002') = 1;
end $$;

-- 11. Remote revocation deactivates the channel -----------------------------------
do $$ declare sh uuid := (select v from s where k='h'); e bigint := (select lease_epoch from ep8); begin
  assert tgp_worker_update(sh,'worker-A',e,'{"status":"reconnecting"}');
  assert tgp_worker_update(sh,'worker-A',e,'{"status":"revoked","last_error_code":"SESSION_REVOKED"}');
  assert not (select is_active from social_accounts where id=(select social_account_id from telegram_personal_sessions where id=sh));
end $$;

-- 12. Team access controls -------------------------------------------------------
do $$ declare sb uuid := (select v from s where k='b2'); begin
  assert tgp_set_team_access(sb,(select v from ids where k='b2'),(select v from ids where k='u4'),'selected_members',array[(select v from ids where k='m3')]) = 'INVALID_MEMBER', 'member of another workspace rejected';
  assert tgp_set_team_access(sb,(select v from ids where k='b2'),(select v from ids where k='u4'),'selected_members',array[(select v from ids where k='m4')]) = 'OK';
  assert (select count(*) from telegram_personal_member_access where session_id=sb) = 1;
  assert tgp_set_team_access(sb,(select v from ids where k='b2'),(select v from ids where k='u4'),'holder_only',null) = 'OK';
  assert (select count(*) from telegram_personal_member_access where session_id=sb) = 0;
end $$;
do $$ declare sd uuid := (select v from s where k='h'); begin
  assert tgp_set_team_access(sd,(select v from ids where k='b1'),(select v from ids where k='u1'),'owners',null) = 'FORBIDDEN', 'only the holder sets team access';
end $$;

-- 13. Client roles have no access --------------------------------------------------
set role authenticated;
select pg_temp.expect_error($$select count(*) from public.telegram_personal_sessions$$, '%permission denied%');
select pg_temp.expect_error($$select public.tgp_cancel_login(gen_random_uuid(),gen_random_uuid(),gen_random_uuid())$$, '%permission denied%');
reset role;
set role anon;
select pg_temp.expect_error($$select count(*) from public.telegram_personal_logins$$, '%permission denied%');
reset role;
set role service_role;
select count(*) >= 0 as service_role_can_read from public.telegram_personal_sessions;
reset role;

select 'telegram-personal draft SQL: all assertions passed' as result;
