-- UNAPPLIED execution ledger proposal. No trigger/cron/activation is installed.
-- Exact security grants require action-time approval. Disabled rules cannot claim.
begin;
set local lock_timeout='2s';set local statement_timeout='60s';
create table public.tenh_bot_execution_controls(business_id uuid primary key references businesses(id),paused boolean not null default true);
create table public.tenh_bot_recipient_state(
 business_id uuid not null references businesses(id),social_account_id uuid not null references social_accounts(id),recipient_id text not null,
 generation bigint not null default 0,human_hold boolean not null default false,last_event_at timestamptz,last_event_id uuid,
 primary key(business_id,social_account_id,recipient_id));
create table public.tenh_bot_events(message_id uuid primary key references messages(id),business_id uuid not null references businesses(id),created_at timestamptz not null default clock_timestamp());
create table public.tenh_bot_execution_jobs(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references businesses(id),social_account_id uuid not null references social_accounts(id),
 conversation_id uuid not null references conversations(id),recipient_id text not null,message_id uuid not null references messages(id),rule_id text not null,
 rule_revision bigint not null,generation bigint not null,action_key text not null unique,action jsonb not null,
 due_at timestamptz not null,expires_at timestamptz not null,status text not null default 'queued' check(status in ('queued','claimed','sending','sent','completed','cancelled','unsupported','rejected','needs_review')),
 claim_token uuid,claimed_at timestamptz,send_started_at timestamptz,provider_id text,reason text,created_at timestamptz not null default clock_timestamp());
create index tenh_bot_jobs_due on tenh_bot_execution_jobs(due_at,id) where status='queued';
create index tenh_bot_jobs_recipient on tenh_bot_execution_jobs(business_id,social_account_id,recipient_id,status);

create function public.tenh_bot_record_event(p_message uuid,p_revision bigint,p_actions jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m messages;c conversations;ch social_accounts;ct contacts;rs tenh_bot_rule_sets;s tenh_bot_recipient_state;a jsonb;stamp timestamptz;inserted uuid;
begin
 if jsonb_typeof(p_actions) is distinct from 'array' or jsonb_array_length(p_actions)>50 or octet_length(p_actions::text)>131072 then raise exception 'invalid_actions';end if;
 select * into m from messages where id=p_message;if not found then raise exception 'missing_message';end if;
 select * into c from conversations where id=m.conversation_id and business_id=m.business_id;
 select * into ch from social_accounts where id=c.social_account_id and business_id=m.business_id and is_active and platform='facebook';
 select * into ct from contacts where id=c.contact_id and business_id=m.business_id;
 if c.id is null or ch.id is null or ct.id is null or ct.platform_user_id is null or m.platform_message_id is null
  or (m.direction='incoming' and not coalesce(m.is_echo,false) and m.sender_platform_id is distinct from ct.platform_user_id) then raise exception 'invalid_scope';end if;
 if c.source_type='comment' and (m.raw_payload->>'item' is distinct from 'comment' or m.raw_payload->>'verb' is distinct from 'add' or m.raw_payload->>'comment_id' is distinct from m.platform_message_id or coalesce(m.raw_payload->>'post_id','') !~ ('^'||ch.platform_account_id||'_[0-9]+$')) then raise exception 'invalid_comment_scope';end if;
 stamp=m.platform_created_at;if stamp is null or stamp>clock_timestamp()+interval '1 minute' then raise exception 'invalid_time';end if;
 insert into tenh_bot_events(message_id,business_id) values(m.id,m.business_id) on conflict do nothing returning message_id into inserted;
 if inserted is null then return jsonb_build_object('duplicate',true,'queued',0);end if;
 if coalesce(m.is_echo,false) then return jsonb_build_object('echo',true,'queued',0);end if;
 insert into tenh_bot_recipient_state(business_id,social_account_id,recipient_id) values(m.business_id,ch.id,ct.platform_user_id) on conflict do nothing;
 select * into s from tenh_bot_recipient_state where business_id=m.business_id and social_account_id=ch.id and recipient_id=ct.platform_user_id for update;
 if s.last_event_at>stamp then return jsonb_build_object('older',true,'queued',0);end if;
 update tenh_bot_recipient_state set generation=generation+1,human_hold=human_hold or (m.direction='outgoing' and not coalesce(m.is_echo,false)),last_event_at=stamp,last_event_id=m.id
  where business_id=m.business_id and social_account_id=ch.id and recipient_id=ct.platform_user_id returning * into s;
 update tenh_bot_execution_jobs set status='cancelled',reason='New customer/staff event cancels pending work.'
  where business_id=m.business_id and social_account_id=ch.id and recipient_id=ct.platform_user_id and status in ('queued','claimed');
 if m.direction<>'incoming' or coalesce(m.is_echo,false) or m.sender_platform_id is distinct from ct.platform_user_id or s.human_hold then return jsonb_build_object('held',s.human_hold,'queued',0);end if;
 select * into rs from tenh_bot_rule_sets where business_id=m.business_id and social_account_id=ch.id;
 if not found or not rs.enabled or rs.activated_at is null or stamp<rs.activated_at or rs.revision<>p_revision or not exists(select 1 from tenh_bot_execution_controls where business_id=m.business_id and not paused)
  then return jsonb_build_object('paused',true,'queued',0);end if;
 for a in select value from jsonb_array_elements(p_actions) loop
  if not exists(select 1 from jsonb_array_elements(rs.rules) r where r->>'id'=a->>'ruleId') or a->>'kind' not in ('reply','followup','assign','alert','handoff','context','health','filter','flow','hide_comment')
   or length(a->>'key')>512 or (c.source_type='comment' and a->>'kind' not in ('filter','hide_comment','health')) then raise exception 'invalid_action';end if;
  insert into tenh_bot_execution_jobs(business_id,social_account_id,conversation_id,recipient_id,message_id,rule_id,rule_revision,generation,action_key,action,due_at,expires_at)
  values(m.business_id,ch.id,c.id,ct.platform_user_id,m.id,a->>'ruleId',rs.revision,s.generation,a->>'key',a,
   coalesce((a->>'dueAt')::timestamptz,clock_timestamp()),least(stamp+interval '24 hours',clock_timestamp()+interval '24 hours')) on conflict do nothing;
 end loop;
 return jsonb_build_object('recorded',true);
end $$;

create function public.tenh_bot_pending_event_ids(p_limit integer default 10) returns setof uuid
language sql stable security invoker set search_path=public,pg_temp as $$
 select m.id from messages m join conversations c on c.id=m.conversation_id and c.business_id=m.business_id
 join tenh_bot_rule_sets r on r.business_id=m.business_id and r.social_account_id=c.social_account_id and r.enabled and r.activated_at is not null
 join tenh_bot_execution_controls ctl on ctl.business_id=m.business_id and not ctl.paused
 where m.platform_created_at>=r.activated_at and m.platform_created_at>clock_timestamp()-interval '24 hours'
 and m.platform_created_at<=clock_timestamp() and m.platform_message_id is not null and not coalesce(m.is_echo,false)
 and not exists(select 1 from tenh_bot_events e where e.message_id=m.id)
 order by m.platform_created_at,m.id limit least(10,greatest(1,p_limit));
$$;
create function public.tenh_bot_claim_jobs(p_limit integer default 10) returns setof tenh_bot_execution_jobs
language sql security invoker set search_path=public,pg_temp as $$
 with eligible as (select j.id from tenh_bot_execution_jobs j
 join tenh_bot_rule_sets r on r.business_id=j.business_id and r.social_account_id=j.social_account_id and r.enabled and r.activated_at is not null and r.revision=j.rule_revision
 join tenh_bot_execution_controls ctl on ctl.business_id=j.business_id and not ctl.paused
 join tenh_bot_recipient_state s on s.business_id=j.business_id and s.social_account_id=j.social_account_id and s.recipient_id=j.recipient_id and not s.human_hold and s.generation=j.generation
 where j.status='queued' and j.due_at<=clock_timestamp() and j.expires_at>clock_timestamp()
 order by j.due_at,j.id limit least(10,greatest(1,p_limit)) for update of j skip locked)
 update tenh_bot_execution_jobs j set status='claimed',claim_token=gen_random_uuid(),claimed_at=clock_timestamp()
 from eligible e where j.id=e.id returning j.*;
$$;

create function public.tenh_bot_reserve_job(p_job uuid,p_claim uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare j tenh_bot_execution_jobs;s tenh_bot_recipient_state;r tenh_bot_rule_sets;rule jsonb;last_customer timestamptz;cooldown integer;
begin
 select * into j from tenh_bot_execution_jobs where id=p_job and claim_token=p_claim and status='claimed';
 if not found then return jsonb_build_object('allowed',false,'reason','Claim unavailable.');end if;
 select * into s from tenh_bot_recipient_state where business_id=j.business_id and social_account_id=j.social_account_id and recipient_id=j.recipient_id for update;
 select * into j from tenh_bot_execution_jobs where id=p_job and claim_token=p_claim and status='claimed' for update;
 if not found or s.human_hold or s.generation<>j.generation or j.due_at>clock_timestamp() or j.expires_at<=clock_timestamp()
  then return jsonb_build_object('allowed',false,'reason','Cancelled, held or expired.');end if;
 select * into r from tenh_bot_rule_sets where business_id=j.business_id and social_account_id=j.social_account_id and enabled and revision=j.rule_revision;
 if not found or not exists(select 1 from tenh_bot_execution_controls where business_id=j.business_id and not paused)
  or not exists(select 1 from conversations c join social_accounts ch on ch.id=c.social_account_id and ch.business_id=c.business_id
   join contacts ct on ct.id=c.contact_id and ct.business_id=c.business_id where c.id=j.conversation_id and c.business_id=j.business_id
    and ch.id=j.social_account_id and ch.is_active and ch.platform='facebook' and ct.platform_user_id=j.recipient_id)
  then return jsonb_build_object('allowed',false,'reason','Rule/channel unavailable.');end if;
 select value into rule from jsonb_array_elements(r.rules) where value->>'id'=j.rule_id;
 if rule is null then return jsonb_build_object('allowed',false,'reason','Rule removed.');end if;
 cooldown=greatest(0,least(10080,coalesce((rule->>'cooldownMinutes')::integer,60)));
 -- Serialize tenant rate admission as well as per-recipient safety.
 perform 1 from tenh_bot_execution_controls where business_id=j.business_id and not paused for update;
 if not found then return jsonb_build_object('allowed',false,'reason','Worker paused.');end if;
 if (select count(*) from tenh_bot_execution_jobs where business_id=j.business_id and send_started_at>clock_timestamp()-interval '1 minute')>=10
  or exists(select 1 from tenh_bot_execution_jobs where business_id=j.business_id and social_account_id=j.social_account_id and recipient_id=j.recipient_id
   and rule_id=j.rule_id and id<>j.id and send_started_at>clock_timestamp()-make_interval(mins=>cooldown))
  then return jsonb_build_object('allowed',false,'reason','Rate/cooldown budget reached.');end if;
 select max(platform_created_at) into last_customer from messages where business_id=j.business_id and conversation_id=j.conversation_id
  and direction='incoming' and not coalesce(is_echo,false) and sender_platform_id=j.recipient_id and platform_created_at<=clock_timestamp();
 if j.action->>'kind' in ('reply','followup') and (last_customer is null or last_customer<=clock_timestamp()-interval '24 hours')
  then return jsonb_build_object('allowed',false,'reason','Standard customer window closed.','standardWindowOpen',false);end if;
 update tenh_bot_execution_jobs set status='sending',send_started_at=clock_timestamp() where id=j.id;
 return jsonb_build_object('allowed',true,'reason','Reserved.','standardWindowOpen',last_customer>clock_timestamp()-interval '24 hours');
end $$;
create function public.tenh_bot_finish_job(p_job uuid,p_claim uuid,p_status text,p_reason text,p_provider text default null) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare changed uuid;
begin
 if p_status not in ('sent','completed','cancelled','unsupported','rejected','needs_review') or length(p_reason)>240 then raise exception 'invalid_result';end if;
 update tenh_bot_execution_jobs set status=p_status,reason=p_reason,provider_id=p_provider where id=p_job and claim_token=p_claim and status in ('claimed','sending') returning id into changed;
 return changed is not null or exists(select 1 from tenh_bot_execution_jobs where id=p_job and claim_token=p_claim and status=p_status);
end $$;

create function public.tenh_bot_set_human_hold(p_business uuid,p_conversation uuid,p_hold boolean) returns boolean
language plpgsql security invoker set search_path=public,pg_temp as $$
declare c conversations;ct contacts;
begin
 select * into c from conversations where id=p_conversation and business_id=p_business;
 select * into ct from contacts where id=c.contact_id and business_id=p_business;
 if c.id is null or ct.platform_user_id is null then return false;end if;
 insert into tenh_bot_recipient_state(business_id,social_account_id,recipient_id,human_hold,generation)
 values(p_business,c.social_account_id,ct.platform_user_id,p_hold,1)
 on conflict(business_id,social_account_id,recipient_id) do update set human_hold=p_hold,generation=tenh_bot_recipient_state.generation+1;
 update tenh_bot_execution_jobs set status='cancelled',reason='Explicit operator hold/resume; old work never resurrects.'
 where business_id=p_business and social_account_id=c.social_account_id and recipient_id=ct.platform_user_id and status in ('queued','claimed');
 return true;
end $$;

create function public.tenh_bot_recover_jobs(p_limit integer default 10) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare n integer;
begin
 with stale as (select id from tenh_bot_execution_jobs where (status='claimed' and claimed_at<clock_timestamp()-interval '2 minutes')
  or (status='sending' and send_started_at<clock_timestamp()-interval '2 minutes') or (status='queued' and expires_at<=clock_timestamp())
  order by created_at,id limit least(10,greatest(1,p_limit)) for update skip locked)
 update tenh_bot_execution_jobs j set status=case when j.status='sending' then 'needs_review' else 'cancelled' end,
 reason='Abandoned/expired job; no automatic effect replay.' from stale where j.id=stale.id;
 get diagnostics n=row_count;return n;
end $$;

create function public.tenh_bot_execute_internal(p_job uuid,p_claim uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare j tenh_bot_execution_jobs;r tenh_bot_rule_sets;rule jsonb;member uuid;
begin
 select * into j from tenh_bot_execution_jobs where id=p_job and claim_token=p_claim and status='sending';
 if not found then return jsonb_build_object('confirmed',false,'definitiveRejection',true);end if;
 perform 1 from tenh_bot_recipient_state where business_id=j.business_id and social_account_id=j.social_account_id and recipient_id=j.recipient_id for update;
 select * into j from tenh_bot_execution_jobs where id=p_job and claim_token=p_claim and status='sending' for update;
 if not found or not exists(select 1 from tenh_bot_recipient_state where business_id=j.business_id and social_account_id=j.social_account_id and recipient_id=j.recipient_id and generation=j.generation and not human_hold)
  or not exists(select 1 from tenh_bot_execution_controls where business_id=j.business_id and not paused) then return jsonb_build_object('confirmed',false,'definitiveRejection',true);end if;
 select * into r from tenh_bot_rule_sets where business_id=j.business_id and social_account_id=j.social_account_id and enabled and revision=j.rule_revision;
 if not found then return jsonb_build_object('confirmed',false);end if;
 select value into rule from jsonb_array_elements(r.rules) where value->>'id'=j.rule_id;
 if j.action->>'kind' in ('assign','alert') then
  member=(j.action->>'memberId')::uuid;
  if not exists(select 1 from team_members where id=member and business_id=j.business_id and is_active)
   or not (coalesce(rule->'memberIds','[]'::jsonb) ? member::text) then return jsonb_build_object('confirmed',false);end if;
 end if;
 if j.action->>'kind'='assign' then
  update conversations set assigned_to=member,updated_at=clock_timestamp() where id=j.conversation_id and business_id=j.business_id and assigned_to is null;
 elsif j.action->>'kind'='handoff' then
  update tenh_bot_recipient_state set human_hold=true,generation=generation+1 where business_id=j.business_id and social_account_id=j.social_account_id and recipient_id=j.recipient_id;
  update tenh_bot_execution_jobs set status='cancelled',reason='Human takeover.' where business_id=j.business_id and social_account_id=j.social_account_id and recipient_id=j.recipient_id and id<>j.id and status in ('queued','claimed');
 elsif j.action->>'kind'='alert' then
  insert into team_notifications(business_id,recipient_member_id,actor_member_id,notification_type,title,body,link,conversation_id)
  values(j.business_id,member,null,'bot_unanswered','Customer waiting for a reply','An enabled Bot detected an unanswered conversation.','/dashboard/inbox?conversationId='||j.conversation_id::text,j.conversation_id);
 elsif j.action->>'kind' not in ('context','health','filter','flow') then return jsonb_build_object('confirmed',false);
 end if;
 -- Ledger and internal effect commit together: retries cannot duplicate notifications.
 update tenh_bot_execution_jobs set status='completed',reason='Internal action completed.' where id=j.id;
 return jsonb_build_object('confirmed',true);
end $$;
alter table tenh_bot_execution_controls enable row level security;alter table tenh_bot_recipient_state enable row level security;
alter table tenh_bot_events enable row level security;alter table tenh_bot_execution_jobs enable row level security;
revoke all on tenh_bot_execution_controls,tenh_bot_recipient_state,tenh_bot_events,tenh_bot_execution_jobs from public,anon,authenticated;
grant select,insert,update on tenh_bot_execution_controls,tenh_bot_recipient_state,tenh_bot_events,tenh_bot_execution_jobs to service_role;
revoke all on function tenh_bot_record_event(uuid,bigint,jsonb),tenh_bot_claim_jobs(integer),tenh_bot_pending_event_ids(integer),tenh_bot_reserve_job(uuid,uuid),tenh_bot_set_human_hold(uuid,uuid,boolean),tenh_bot_recover_jobs(integer),tenh_bot_execute_internal(uuid,uuid),tenh_bot_finish_job(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function tenh_bot_record_event(uuid,bigint,jsonb),tenh_bot_claim_jobs(integer),tenh_bot_pending_event_ids(integer),tenh_bot_reserve_job(uuid,uuid),tenh_bot_set_human_hold(uuid,uuid,boolean),tenh_bot_recover_jobs(integer),tenh_bot_execute_internal(uuid,uuid),tenh_bot_finish_job(uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';commit;
