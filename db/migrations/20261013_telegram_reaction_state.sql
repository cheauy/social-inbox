-- PROPOSAL ONLY: not applied. No publication, trigger, cron or activation.
-- Review service-role grants and backup before applying. Both rollout gates default off.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';

create table public.telegram_reaction_controls (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled boolean not null default false
);
create table public.telegram_reaction_state (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  chat_id text not null check (chat_id ~ '^[1-9][0-9]{0,15}$'),
  group_key text not null check (group_key ~ '^(m:[1-9][0-9]{0,15}|a:[0-9]{1,64})$'),
  target_message_id uuid not null,
  status text not null default 'idle' check (status in ('idle','confirmed','pending','uncertain')),
  confirmed_emoji text,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991),
  pending_request_id uuid,
  updated_at timestamptz not null default clock_timestamp(),
  unique (business_id,social_account_id,chat_id,group_key),
  check ((status in ('pending','uncertain')) = (pending_request_id is not null))
);
create index telegram_reaction_conversation on public.telegram_reaction_state(business_id,social_account_id,conversation_id,group_key);
-- Leading child-FK indexes bound account/conversation cascade lookups. New tables only.
create index telegram_reaction_state_social_account_id on public.telegram_reaction_state(social_account_id);
create index telegram_reaction_state_conversation_id on public.telegram_reaction_state(conversation_id);
create table public.telegram_reaction_operations (
  request_id uuid primary key,
  state_id uuid not null references public.telegram_reaction_state(id) on delete cascade,
  member_id uuid not null,
  selected_message_id uuid not null,
  requested_emoji text,
  expected_revision bigint not null check (expected_revision >= 0),
  previous_status text not null check (previous_status in ('idle','confirmed')),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','uncertain')),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);

create index telegram_reaction_operations_state_id on public.telegram_reaction_operations(state_id);

create function public.tenh_telegram_reaction_ready(p_business uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('version',1,'enabled',coalesce((select enabled from telegram_reaction_controls where business_id=p_business),false));
$$;

create function public.tenh_telegram_reaction_public_state(p_state public.telegram_reaction_state) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('status',p_state.status,'emoji',p_state.confirmed_emoji,'revision',p_state.revision,
  'updatedAt',p_state.updated_at,'groupKey',p_state.group_key,'chatId',p_state.chat_id,'targetMessageId',p_state.target_message_id);
$$;

-- Merge into current JSON under PostgreSQL row locks; unrelated metadata survives.
-- Existing messages realtime supplies display updates; the new tables stay private.
create function public.tenh_telegram_reaction_publish(p_state public.telegram_reaction_state) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 -- Separate statements keep direct MID equality indexable under generic plans.
 if p_state.group_key like 'm:%' then
 update messages m set raw_payload=coalesce(m.raw_payload,'{}'::jsonb)||jsonb_build_object('tenh_telegram_reaction',tenh_telegram_reaction_public_state(p_state))
 where m.business_id=p_state.business_id and m.conversation_id=p_state.conversation_id
 and m.platform_message_id ~ ('^telegram:'||p_state.chat_id||':[1-9][0-9]{0,15}$')
 and coalesce(m.raw_payload->'tenh_deleted','null'::jsonb)='null'::jsonb
 and m.platform_message_id='telegram:'||p_state.chat_id||':'||substring(p_state.group_key from 3);
 else
 update messages m set raw_payload=coalesce(m.raw_payload,'{}'::jsonb)||jsonb_build_object('tenh_telegram_reaction',tenh_telegram_reaction_public_state(p_state))
 where m.business_id=p_state.business_id and m.conversation_id=p_state.conversation_id
 and m.platform_message_id ~ ('^telegram:'||p_state.chat_id||':[1-9][0-9]{0,15}$')
 and coalesce(m.raw_payload->'tenh_deleted','null'::jsonb)='null'::jsonb
 and ((case when jsonb_typeof((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->'media_group_id')='string' then case when length((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id') between 1 and 64 then case when length(translate((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id','0123456789',''))=0 then (case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id' else null end else null end else null end) COLLATE pg_catalog."C")=substring(p_state.group_key from 3);
 end if;
end
$$;

-- Normalized scoped membership uses the exact separately reviewed index expression.
-- LIMIT 11 supplies an overflow sentinel; index plans, not LIMIT, constrain history work.
create function public.tenh_telegram_reaction_album(p_business uuid,p_conversation uuid,p_album text) returns setof public.messages
language sql stable security invoker set search_path=public,pg_temp as $$
 select m.* from messages m where m.business_id=p_business and m.conversation_id=p_conversation
 and length(p_album) between 1 and 64 and length(translate(p_album,'0123456789',''))=0
 and ((case when jsonb_typeof((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->'media_group_id')='string' then case when length((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id') between 1 and 64 then case when length(translate((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id','0123456789',''))=0 then (case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id' else null end else null end else null end) COLLATE pg_catalog."C")=p_album limit 11;
$$;

create function public.tenh_telegram_reaction_claim(p_scope jsonb,p_request uuid,p_member uuid,p_emoji text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare b uuid; a uuid; c uuid; selected uuid; target uuid; chat text; grp text; expected bigint;
 s telegram_reaction_state; op telegram_reaction_operations; first_id uuid;
begin
 b=(p_scope->>'businessId')::uuid; a=(p_scope->>'accountId')::uuid; c=(p_scope->>'conversationId')::uuid;
 selected=(p_scope->>'messageId')::uuid; target=(p_scope->>'targetMessageId')::uuid; chat=p_scope->>'chatId'; grp=p_scope->>'groupKey';
 expected=(p_scope->>'expectedRevision')::bigint;
 if expected is null or expected < 0 or p_request is null or p_member is null or chat !~ '^[1-9][0-9]{0,15}$' or grp !~ '^(m:[1-9][0-9]{0,15}|a:[0-9]{1,64})$'
  or not exists(select 1 from telegram_reaction_controls where business_id=b and enabled)
  or not exists(select 1 from team_members where id=p_member and business_id=b and is_active)
  or not exists(select 1 from conversations co join social_accounts sa on sa.id=co.social_account_id and sa.business_id=co.business_id
     join contacts ct on ct.id=co.contact_id and ct.business_id=co.business_id
     where co.id=c and co.business_id=b and sa.id=a and sa.platform='telegram' and sa.platform_account_id=p_scope->>'botId' and sa.is_active and sa.telegram_token_status='verified'
     and ct.platform='telegram' and ct.platform_user_id=chat)
  then raise exception 'invalid_scope'; end if;
 -- Check selected row and canonical album target independently of page boundaries.
 if not exists(select 1 from messages m where m.id=selected and m.business_id=b and m.conversation_id=c
  and m.platform_message_id ~ ('^telegram:'||chat||':[1-9][0-9]{0,15}$')
  and coalesce(m.raw_payload->'tenh_deleted','null'::jsonb)='null'::jsonb
  and ((m.direction='incoming' and m.sender_platform_id=chat and m.recipient_platform_id=p_scope->>'botId')
    or (m.direction='outgoing' and m.sender_platform_id=p_scope->>'botId' and m.recipient_platform_id=chat))
  and (case when grp like 'm:%' then m.platform_message_id='telegram:'||chat||':'||substring(grp from 3)
       else ((case when jsonb_typeof((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->'media_group_id')='string' then case when length((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id') between 1 and 64 then case when length(translate((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id','0123456789',''))=0 then (case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id' else null end else null end else null end) COLLATE pg_catalog."C")=substring(grp from 3) end))
  then raise exception 'invalid_message'; end if;
 -- Single-message lookup is bounded by the existing business/native-MID unique index.
 if grp like 'm:%' then
 select m.id into first_id from messages m where m.business_id=b and m.conversation_id=c
  and m.platform_message_id ~ ('^telegram:'||chat||':[1-9][0-9]{0,15}$')
  and coalesce(m.raw_payload->'tenh_deleted','null'::jsonb)='null'::jsonb
  and m.platform_message_id='telegram:'||chat||':'||substring(grp from 3)
  order by split_part(m.platform_message_id,':',3)::bigint,m.id limit 1;
 else
 select m.id into first_id from messages m where m.business_id=b and m.conversation_id=c
  and m.platform_message_id ~ ('^telegram:'||chat||':[1-9][0-9]{0,15}$')
  and coalesce(m.raw_payload->'tenh_deleted','null'::jsonb)='null'::jsonb
  and ((case when jsonb_typeof((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->'media_group_id')='string' then case when length((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id') between 1 and 64 then case when length(translate((case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id','0123456789',''))=0 then (case when jsonb_typeof(m.raw_payload->'message')='object' then m.raw_payload->'message' else m.raw_payload end)->>'media_group_id' else null end else null end else null end) COLLATE pg_catalog."C")=substring(grp from 3)
  order by split_part(m.platform_message_id,':',3)::bigint,m.id limit 1;
 end if;
 if first_id is distinct from target then return jsonb_build_object('kind','target_changed'); end if;
 insert into telegram_reaction_state(business_id,social_account_id,conversation_id,chat_id,group_key,target_message_id)
  values(b,a,c,chat,grp,target) on conflict(business_id,social_account_id,chat_id,group_key) do nothing;
 select * into s from telegram_reaction_state where business_id=b and social_account_id=a and chat_id=chat and group_key=grp for update;
 if s.conversation_id is distinct from c then raise exception 'conversation_mismatch'; end if;
 select * into op from telegram_reaction_operations where request_id=p_request;
 if found then
  if op.state_id is distinct from s.id or op.member_id is distinct from p_member or op.selected_message_id is distinct from selected or op.requested_emoji is distinct from p_emoji or op.expected_revision is distinct from expected
   then return jsonb_build_object('kind','request_conflict'); end if;
  -- Replay never calls Telegram and returns CURRENT state, not a stale receipt emoji.
  return jsonb_build_object('kind','replay','operationStatus',op.status,'state',tenh_telegram_reaction_public_state(s));
 end if;
 -- No expiring lease: an old HTTP request may complete after a worker crash.
 if s.status in ('pending','uncertain') then return jsonb_build_object('kind','blocked','state',tenh_telegram_reaction_public_state(s)); end if;
 if s.revision is distinct from expected then return jsonb_build_object('kind','revision_changed'); end if;
 insert into telegram_reaction_operations(request_id,state_id,member_id,selected_message_id,requested_emoji,expected_revision,previous_status)
  values(p_request,s.id,p_member,selected,p_emoji,expected,s.status);
 update telegram_reaction_state set status='pending',pending_request_id=p_request,target_message_id=target,revision=revision+1,updated_at=clock_timestamp()
  where id=s.id returning * into s;
 perform tenh_telegram_reaction_publish(s);
 return jsonb_build_object('kind','claimed','state',tenh_telegram_reaction_public_state(s));
end $$;

create function public.tenh_telegram_reaction_finish(p_request uuid,p_outcome text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare op telegram_reaction_operations; s telegram_reaction_state;
begin
 if p_outcome not in ('confirmed','rejected','uncertain') then raise exception 'invalid_outcome'; end if;
 select * into op from telegram_reaction_operations where request_id=p_request;
 if not found then raise exception 'missing_operation'; end if;
 select * into s from telegram_reaction_state where id=op.state_id for update;
 select * into op from telegram_reaction_operations where request_id=p_request for update;
 if s.pending_request_id is distinct from p_request or op.status not in ('pending','uncertain') then
  return jsonb_build_object('state',tenh_telegram_reaction_public_state(s),'operationStatus',op.status);
 end if;
 -- A late result may resolve the SAME fenced operation; no newer action is admitted.
 update telegram_reaction_operations set status=p_outcome,finished_at=clock_timestamp() where request_id=p_request;
 update telegram_reaction_state set
  status=case when p_outcome='rejected' then op.previous_status else p_outcome end,
  confirmed_emoji=case when p_outcome='confirmed' then op.requested_emoji else confirmed_emoji end,
  pending_request_id=case when p_outcome='uncertain' then p_request else null end,
  updated_at=clock_timestamp() where id=s.id returning * into s;
 perform tenh_telegram_reaction_publish(s);
 return jsonb_build_object('state',tenh_telegram_reaction_public_state(s),'operationStatus',p_outcome);
end $$;

alter table public.telegram_reaction_controls enable row level security;
alter table public.telegram_reaction_state enable row level security;
alter table public.telegram_reaction_operations enable row level security;
revoke all on public.telegram_reaction_controls,public.telegram_reaction_state,public.telegram_reaction_operations from public,anon,authenticated,service_role;
grant select,insert,update on public.telegram_reaction_controls,public.telegram_reaction_state,public.telegram_reaction_operations to service_role;
revoke all on function public.tenh_telegram_reaction_ready(uuid),public.tenh_telegram_reaction_public_state(public.telegram_reaction_state),
 public.tenh_telegram_reaction_publish(public.telegram_reaction_state),public.tenh_telegram_reaction_claim(jsonb,uuid,uuid,text),public.tenh_telegram_reaction_finish(uuid,text) from public,anon,authenticated;
grant execute on function public.tenh_telegram_reaction_ready(uuid),public.tenh_telegram_reaction_public_state(public.telegram_reaction_state),
 public.tenh_telegram_reaction_publish(public.telegram_reaction_state),public.tenh_telegram_reaction_claim(jsonb,uuid,uuid,text),public.tenh_telegram_reaction_finish(uuid,text) to service_role;
revoke all on function public.tenh_telegram_reaction_album(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.tenh_telegram_reaction_album(uuid,uuid,text) to service_role;
commit;
