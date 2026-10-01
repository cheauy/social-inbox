-- REVIEW ONLY: apply after the original schema has been verified, never reapply the original.
-- Concurrent index creation must run outside a transaction and may need retry/invalid-index repair.
set lock_timeout = '2s';
set statement_timeout = '60s';
create index concurrently if not exists facebook_auto_reply_message_recovery
  on public.messages(created_at,id)
  where direction='incoming' and raw_payload->>'item'='comment' and raw_payload->>'verb'='add';
begin;
create table if not exists public.facebook_auto_reply_controls (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  paused boolean not null default true,
  resumed_at timestamptz,
  circuit_until timestamptz,
  consecutive_errors integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.facebook_auto_reply_recovery (
  singleton boolean primary key default true check(singleton),
  cursor_at timestamptz not null,
  cursor_id uuid not null default '00000000-0000-0000-0000-000000000000'
);
insert into public.facebook_auto_reply_recovery(singleton,cursor_at)
  values(true,clock_timestamp()) on conflict do nothing;
alter table public.facebook_auto_reply_controls enable row level security;
alter table public.facebook_auto_reply_recovery enable row level security;
revoke all on public.facebook_auto_reply_controls,public.facebook_auto_reply_recovery from anon,authenticated;
grant all on public.facebook_auto_reply_controls,public.facebook_auto_reply_recovery to service_role;

create or replace function public.facebook_auto_reply_pause(p_business uuid,p_paused boolean)
returns void language plpgsql set search_path=public as $$
begin
  insert into facebook_auto_reply_controls(business_id,paused,resumed_at) values(p_business,p_paused,case when not p_paused then clock_timestamp() end)
  on conflict(business_id) do update set paused=excluded.paused,
    resumed_at=case when not excluded.paused and facebook_auto_reply_controls.paused then clock_timestamp() else facebook_auto_reply_controls.resumed_at end,
    updated_at=clock_timestamp();
  -- Resume is deliberate, but never resets a safety cooldown or rule activation.
end $$;

create or replace function public.facebook_auto_reply_note_result(p_business uuid,p_failed boolean)
returns void language plpgsql set search_path=public as $$
begin
  insert into facebook_auto_reply_controls(business_id) values(p_business) on conflict do nothing;
  update facebook_auto_reply_controls set
    consecutive_errors=case when p_failed then consecutive_errors+1 else 0 end,
    circuit_until=case when p_failed and consecutive_errors>=4 then clock_timestamp()+interval '15 minutes' else circuit_until end,
    updated_at=clock_timestamp() where business_id=p_business;
end $$;

create or replace function public.facebook_auto_reply_enqueue_message(p_message uuid)
returns void language plpgsql set search_path=public as $$
declare m messages; c record; r facebook_auto_reply_rules; a text; ctl facebook_auto_reply_controls;
begin
  select * into m from messages where id=p_message;
  if not found or m.direction<>'incoming' or m.is_echo or m.platform_message_id is null or
    m.raw_payload->>'item' is distinct from 'comment' or m.raw_payload->>'verb' is distinct from 'add' or
    m.raw_payload->>'created_time' is null or m.platform_created_at is null then return; end if;
  select * into ctl from facebook_auto_reply_controls where business_id=m.business_id;
  if not found or ctl.paused or m.platform_created_at<ctl.resumed_at then return; end if;
  select cv.social_account_id,sa.platform_account_id into c
    from conversations cv join social_accounts sa on sa.id=cv.social_account_id
    where cv.id=m.conversation_id and cv.business_id=m.business_id and sa.business_id=m.business_id
      and sa.platform='facebook' and sa.is_active;
  if not found or m.sender_platform_id=c.platform_account_id then return; end if;
  select * into r from facebook_auto_reply_rules where social_account_id=c.social_account_id
    and business_id=m.business_id and enabled and (post_id is null or post_id=m.raw_payload->>'post_id')
    order by (post_id is not null) desc,created_at,id limit 1;
  if not found then return; end if;
  foreach a in array array['public','private'] loop
    if (a='public' and r.public_template is null) or (a='private' and r.private_template is null) then continue; end if;
    insert into facebook_auto_reply_jobs(business_id,social_account_id,rule_id,message_id,comment_id,recipient_id,action,activation,status,reason)
    values(m.business_id,c.social_account_id,r.id,m.id,m.platform_message_id,m.sender_platform_id,a,r.activated_at,
      case when m.platform_created_at>=greatest(r.starts_at,r.activated_at) then 'pending' else 'skipped' end,
      case when m.platform_created_at<greatest(r.starts_at,r.activated_at) then 'before_start' end)
    on conflict(social_account_id,comment_id,action) do nothing;
  end loop;
end $$;

create or replace function public.facebook_auto_reply_enqueue() returns trigger
language plpgsql set search_path=public as $$
begin
  -- Isolate ALL feature SQL inside a subtransaction. Never reject normal inbox persistence.
  begin
    perform facebook_auto_reply_enqueue_message(new.id);
  exception when others then
    raise warning 'Auto Reply enqueue deferred; SQLSTATE %',sqlstate;
  end;
  return new;
end $$;
-- Core inbox insertion must not run feature SQL at all. Durable recovery below is now the enqueue path.
-- Dropping this trigger takes a brief messages lock, bounded by lock_timeout above.
drop trigger if exists facebook_auto_reply_enqueue on public.messages;

create or replace function public.facebook_auto_reply_repair(p_limit integer default 100)
returns integer language plpgsql set search_path=public as $$
declare cursor_row facebook_auto_reply_recovery; m record; processed integer=0;
begin
  select * into cursor_row from facebook_auto_reply_recovery where singleton for update skip locked;
  if not found then return 0; end if;
  -- Indexed durable message recovery, NOT a scan of posts, media, or all inbox reads.
  -- Thirty-second lag avoids usual in-flight inserts; unusually long transactions still need operator review.
  for m in select id,created_at from messages where direction='incoming'
    and raw_payload->>'item'='comment' and raw_payload->>'verb'='add'
    and (created_at,id)>(cursor_row.cursor_at,cursor_row.cursor_id)
    and created_at<clock_timestamp()-interval '30 seconds'
    order by created_at,id limit least(greatest(p_limit,1),100) loop
    perform facebook_auto_reply_enqueue_message(m.id);
    update facebook_auto_reply_recovery set cursor_at=m.created_at,cursor_id=m.id where singleton;
    processed=processed+1;
  end loop;
  -- On failure the transaction rolls back; the cursor never passes an unrepaired row.
  return processed;
end $$;

create or replace function public.facebook_auto_reply_rule_guard() returns trigger
language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from social_accounts a where a.id=new.social_account_id and a.business_id=new.business_id
    and a.platform='facebook' and a.is_active) then raise exception 'Connected Facebook Page does not belong to this workspace'; end if;
  new.updated_at=now();
  if tg_op='INSERT' then new.enabled=false; new.activated_at=null;
  elsif new.enabled and not old.enabled then new.activated_at=clock_timestamp();
  elsif new.enabled and (new.post_id is distinct from old.post_id or new.starts_at is distinct from old.starts_at or
    new.public_template is distinct from old.public_template or new.private_template is distinct from old.private_template or
    new.social_account_id<>old.social_account_id) then raise exception 'Pause the rule before editing it'; end if;
  -- No unbounded queued-job update on a customer's pause request. Claim/begin_send enforce pause.
  return new;
end $$;

create or replace function public.facebook_auto_reply_claim(p_limit integer default 5)
returns setof public.facebook_auto_reply_jobs language plpgsql set search_path=public as $$
begin
  with stopped as (select j.id from facebook_auto_reply_jobs j join facebook_auto_reply_rules r on r.id=j.rule_id
    left join facebook_auto_reply_controls ctl on ctl.business_id=j.business_id
    where j.status in ('pending','retry','claimed') and (not r.enabled or r.activated_at<>j.activation
      or coalesce(ctl.paused,true) or j.created_at<ctl.resumed_at)
    order by j.created_at limit 10 for update of j skip locked)
  update facebook_auto_reply_jobs j set status='skipped',reason='rule_or_global_paused',updated_at=now()
    from stopped s where j.id=s.id;
  with expired as (select id from facebook_auto_reply_jobs where status in ('sending','claimed')
    and lease_until<now() order by lease_until limit 10 for update skip locked)
  update facebook_auto_reply_jobs j set
    status=case when j.status='sending' then 'needs_review' when attempts>=4 then 'failed' else 'retry' end,
    reason=case when j.status='sending' then 'send_outcome_unknown' when attempts>=4 then 'retry_limit_reached' else 'worker_recovered' end,
    updated_at=now() from expired e where j.id=e.id;
  return query with due as (
    select j.id from facebook_auto_reply_jobs j join facebook_auto_reply_rules r on r.id=j.rule_id
    join facebook_auto_reply_controls ctl on ctl.business_id=j.business_id
    where j.status in ('pending','retry') and j.available_at<=now() and r.enabled and r.activated_at=j.activation
      and not ctl.paused and (ctl.circuit_until is null or ctl.circuit_until<=now())
      and not exists(select 1 from facebook_auto_reply_jobs other where other.social_account_id=j.social_account_id
        and other.comment_id=j.comment_id and other.id<>j.id and (other.status in ('claimed','sending') or
        (j.action='private' and other.action='public' and other.status in ('pending','retry'))))
    order by j.created_at,j.action desc limit least(greatest(p_limit,1),5) for update of j skip locked
  ) update facebook_auto_reply_jobs j set status='claimed',claim_token=gen_random_uuid(),attempts=attempts+1,
    lease_until=now()+interval '2 minutes',updated_at=now() from due where j.id=due.id returning j.*;
end $$;

-- Preserve the existing private-reservation/send logic; add a serialized global gate around it.
do $$ begin
  if to_regprocedure('public.facebook_auto_reply_begin_send_legacy(uuid,uuid)') is null then
    alter function public.facebook_auto_reply_begin_send(uuid,uuid) rename to facebook_auto_reply_begin_send_legacy;
  end if;
end $$;
create or replace function public.facebook_auto_reply_begin_send(p_job uuid,p_claim uuid)
returns boolean language plpgsql set search_path=public as $$
declare ctl facebook_auto_reply_controls;
begin
  select * into ctl from facebook_auto_reply_controls where business_id=(select business_id from facebook_auto_reply_jobs where id=p_job) for update;
  if not found or ctl.paused or ctl.circuit_until>clock_timestamp() or
    exists(select 1 from facebook_auto_reply_jobs where id=p_job and created_at<ctl.resumed_at) then return false; end if;
  return facebook_auto_reply_begin_send_legacy(p_job,p_claim);
end $$;
revoke all on function public.facebook_auto_reply_begin_send_legacy(uuid,uuid),public.facebook_auto_reply_enqueue_message(uuid),
  public.facebook_auto_reply_begin_send(uuid,uuid),public.facebook_auto_reply_repair(integer),public.facebook_auto_reply_pause(uuid,boolean),public.facebook_auto_reply_note_result(uuid,boolean)
  from public,anon,authenticated;
-- The legacy function must NOT be directly callable by the worker, bypassing the new gate.
revoke all on function public.facebook_auto_reply_begin_send_legacy(uuid,uuid) from service_role;
-- Invoker needs the legacy call, so wrapper is narrowly SECURITY DEFINER with fixed search path.
alter function public.facebook_auto_reply_begin_send(uuid,uuid) security definer;
alter function public.facebook_auto_reply_repair(integer) security definer;
alter function public.facebook_auto_reply_begin_send(uuid,uuid) set search_path=public,pg_temp;
alter function public.facebook_auto_reply_repair(integer) set search_path=public,pg_temp;
grant execute on function public.facebook_auto_reply_begin_send(uuid,uuid),public.facebook_auto_reply_repair(integer),
  public.facebook_auto_reply_pause(uuid,boolean),public.facebook_auto_reply_note_result(uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
reset lock_timeout;
reset statement_timeout;
