-- LOCAL CANDIDATE ONLY. Requires both earlier Auto Reply migrations; do not apply without approval.
set lock_timeout='2s';
set statement_timeout='60s';
begin;
-- Constant true is metadata-only on supported PostgreSQL: existing messages are NOT backfilled.
-- Changing the default in this same transaction makes every future INSERT discoverable, even a late commit.
alter table public.messages add column if not exists facebook_auto_reply_processed boolean not null default true;
alter table public.messages alter column facebook_auto_reply_processed set default false;
commit;
-- Outside a transaction. An interrupted/invalid index must be repaired before enabling the worker.
create index concurrently if not exists facebook_auto_reply_unprocessed
  on public.messages(created_at,id)
  where not facebook_auto_reply_processed and direction='incoming'
    and raw_payload->>'item'='comment' and raw_payload->>'verb'='add';
begin;
create or replace function public.facebook_auto_reply_repair(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=public,pg_temp set enable_seqscan=off as $$
declare m record; processed integer=0;
begin
  -- Never silently fall back to a full scan if the required index is missing/invalid.
  if not exists(select 1 from pg_catalog.pg_index where indexrelid=to_regclass('public.facebook_auto_reply_unprocessed')
    and indrelid='public.messages'::regclass and indisvalid and indnkeyatts=2
    and indkey[0]=(select attnum from pg_catalog.pg_attribute where attrelid='public.messages'::regclass and attname='created_at')
    and indkey[1]=(select attnum from pg_catalog.pg_attribute where attrelid='public.messages'::regclass and attname='id')
    and regexp_replace(regexp_replace(pg_get_expr(indpred,indrelid),'::[a-z_][a-z_0-9.]*','','g'),'[[:space:]()]','','g')=
      'NOTfacebook_auto_reply_processedANDdirection=''incoming''ANDraw_payload->>''item''=''comment''ANDraw_payload->>''verb''=''add''') then
    raise exception 'Auto Reply pending index unavailable; recovery stopped';
  end if;
  for m in select id from messages where not facebook_auto_reply_processed and direction='incoming'
    and raw_payload->>'item'='comment' and raw_payload->>'verb'='add'
    order by created_at,id limit least(greatest(p_limit,1),100) for update skip locked loop
    perform facebook_auto_reply_enqueue_message(m.id);
    update messages set facebook_auto_reply_processed=true where id=m.id;
    processed=processed+1;
  end loop;
  -- Jobs and marker commit together. Failure leaves the message pending and fails the worker observably.
  -- No timestamp high-water mark, age horizon, transaction-order assumption, or old-row rescan.
  return processed;
end $$;

create table if not exists public.facebook_auto_reply_test_gates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  page_platform_id text not null check(page_platform_id ~ '^[0-9]+$'),
  post_id text not null check(post_id ~ '^[0-9]+_[0-9]+$'),
  comment_id text not null check(comment_id ~ '^[0-9_]+$'),
  enabled boolean not null default false,
  public_cap smallint not null default 0 check(public_cap between 0 and 1),
  private_cap smallint not null default 0 check(private_cap between 0 and 1),
  public_attempts smallint not null default 0 check(public_attempts between 0 and public_cap),
  private_attempts smallint not null default 0 check(private_attempts between 0 and private_cap),
  armed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(business_id,social_account_id,post_id,comment_id),
  check(not enabled or (armed_at is not null and expires_at is not null and public_cap+private_cap>0))
);
-- Only one active live-test gate for this worker deployment: other tenants' queued jobs are held, not sent.
create unique index if not exists facebook_auto_reply_one_test_gate on public.facebook_auto_reply_test_gates((true)) where enabled;
alter table public.facebook_auto_reply_test_gates enable row level security;
revoke all on public.facebook_auto_reply_test_gates from public,anon,authenticated,service_role;
grant select,insert,update on public.facebook_auto_reply_test_gates to service_role;

create or replace function public.facebook_auto_reply_test_gate_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from social_accounts a where a.id=new.social_account_id and a.business_id=new.business_id
    and a.platform='facebook' and a.is_active and a.platform_account_id=new.page_platform_id) or
    split_part(new.post_id,'_',1)<>new.page_platform_id then raise exception 'Test target Page/post does not belong to tenant'; end if;
  if tg_op='INSERT' then
    new.enabled=false; new.armed_at=null; new.public_attempts=0; new.private_attempts=0;
  else
    if new.public_attempts<old.public_attempts or new.private_attempts<old.private_attempts then raise exception 'Test budget cannot be refunded'; end if;
    if old.armed_at is not null and (new.business_id<>old.business_id or new.social_account_id<>old.social_account_id or
      new.page_platform_id<>old.page_platform_id or new.post_id<>old.post_id or new.comment_id<>old.comment_id or
      new.public_cap<>old.public_cap or new.private_cap<>old.private_cap or new.expires_at is distinct from old.expires_at or
      new.armed_at is distinct from old.armed_at) then raise exception 'Armed test scope, expiry and caps are immutable'; end if;
    if new.enabled and not old.enabled and old.armed_at is null then
      if new.expires_at is null or new.expires_at<=clock_timestamp() or new.expires_at>clock_timestamp()+interval '15 minutes' then
        raise exception 'Test expiry must be within the next 15 minutes'; end if;
      new.armed_at=clock_timestamp();
    end if;
    -- Disarming removes test-only restrictions: require the global stop first, never silently return to normal sending.
    if old.enabled and not new.enabled and not coalesce((select paused from facebook_auto_reply_controls where business_id=old.business_id),true) then
      raise exception 'Global pause is required before disarming a test'; end if;
  end if;
  return new;
end $$;
drop trigger if exists facebook_auto_reply_test_gate_guard on public.facebook_auto_reply_test_gates;
create trigger facebook_auto_reply_test_gate_guard before insert or update on public.facebook_auto_reply_test_gates
  for each row execute function public.facebook_auto_reply_test_gate_guard();

create or replace function public.facebook_auto_reply_begin_send(p_job uuid,p_claim uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare ctl facebook_auto_reply_controls; gate facebook_auto_reply_test_gates; j facebook_auto_reply_jobs;
  source_post text; gate_reason text; permitted boolean;
begin
  -- Same global->gate->rule->job order for all sends. Gate budget is durable before any external POST.
  select * into ctl from facebook_auto_reply_controls where business_id=(select business_id from facebook_auto_reply_jobs where id=p_job) for update;
  if not found or ctl.paused or ctl.circuit_until>clock_timestamp() or
    exists(select 1 from facebook_auto_reply_jobs where id=p_job and created_at<ctl.resumed_at) then return false; end if;
  select * into j from facebook_auto_reply_jobs where id=p_job;
  if not found or j.status<>'claimed' or j.claim_token is distinct from p_claim or j.lease_until<clock_timestamp() then return false; end if;
  select * into gate from facebook_auto_reply_test_gates where enabled for update;
  if found then
    select m.raw_payload->>'post_id' into source_post from messages m join conversations c on c.id=m.conversation_id
      where m.id=j.message_id and m.business_id=j.business_id and c.business_id=j.business_id
        and c.social_account_id=j.social_account_id;
    gate_reason=case
      when gate.expires_at<=clock_timestamp() then 'live_test_expired'
      when gate.business_id<>j.business_id or gate.social_account_id<>j.social_account_id or gate.comment_id<>j.comment_id or source_post is distinct from gate.post_id or
        not exists(select 1 from social_accounts where id=j.social_account_id and business_id=j.business_id and platform_account_id=gate.page_platform_id) then 'live_test_not_allowlisted'
      when j.action='public' and gate.public_attempts>=gate.public_cap then 'live_test_public_cap_exhausted'
      when j.action='private' and gate.private_attempts>=gate.private_cap then 'live_test_private_cap_exhausted'
    end;
    if gate_reason is not null then
      update facebook_auto_reply_jobs set status='skipped',reason=gate_reason,updated_at=clock_timestamp()
        where id=j.id and status='claimed' and claim_token=p_claim;
      return false;
    end if;
  end if;
  permitted=facebook_auto_reply_begin_send_legacy(p_job,p_claim);
  if permitted and gate.id is not null then
    update facebook_auto_reply_test_gates set
      public_attempts=public_attempts+case when j.action='public' then 1 else 0 end,
      private_attempts=private_attempts+case when j.action='private' then 1 else 0 end where id=gate.id;
  end if;
  -- A crash, timeout or definitive rejection NEVER refunds a test attempt. Caps bound POST attempts, not just successes.
  -- An enabled expired/exhausted gate remains restrictive; it never auto-disarms to normal sending.
  return permitted;
end $$;
create or replace function public.facebook_auto_reply_claim(p_limit integer default 5)
returns setof public.facebook_auto_reply_jobs language plpgsql set search_path=public as $$
begin
  with capped as (select j.id from facebook_auto_reply_jobs j join facebook_auto_reply_test_gates g on g.enabled
    and g.business_id=j.business_id and g.social_account_id=j.social_account_id and g.comment_id=j.comment_id
    where j.status in ('pending','retry') and ((j.action='public' and g.public_attempts>=g.public_cap)
      or (j.action='private' and g.private_attempts>=g.private_cap))
    order by j.created_at limit 10 for update of j skip locked)
  update facebook_auto_reply_jobs j set status='skipped',reason='live_test_cap_exhausted',updated_at=now() from capped c where j.id=c.id;
  with stopped as (select j.id from facebook_auto_reply_jobs j join facebook_auto_reply_rules r on r.id=j.rule_id
    left join facebook_auto_reply_controls ctl on ctl.business_id=j.business_id
    where j.status in ('pending','retry','claimed') and (not r.enabled or r.activated_at<>j.activation
      or coalesce(ctl.paused,true) or j.created_at<ctl.resumed_at)
    order by j.created_at limit 10 for update of j skip locked)
  update facebook_auto_reply_jobs j set status='skipped',reason='rule_or_global_paused',updated_at=now() from stopped s where j.id=s.id;
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
      and (not exists(select 1 from facebook_auto_reply_test_gates where enabled) or exists(
        select 1 from facebook_auto_reply_test_gates g where g.enabled and g.expires_at>clock_timestamp()
          and g.business_id=j.business_id and g.social_account_id=j.social_account_id and g.comment_id=j.comment_id
          and exists(select 1 from messages m where m.id=j.message_id and m.business_id=j.business_id and m.raw_payload->>'post_id'=g.post_id)
          and ((j.action='public' and g.public_attempts<g.public_cap) or (j.action='private' and g.private_attempts<g.private_cap))))
      and not exists(select 1 from facebook_auto_reply_jobs other where other.social_account_id=j.social_account_id
        and other.comment_id=j.comment_id and other.id<>j.id and (other.status in ('claimed','sending') or
        (j.action='private' and other.action='public' and other.status in ('pending','retry'))))
    order by j.created_at,j.action desc limit least(greatest(p_limit,1),5) for update of j skip locked
  ) update facebook_auto_reply_jobs j set status='claimed',claim_token=gen_random_uuid(),attempts=attempts+1,
    lease_until=now()+interval '2 minutes',updated_at=now() from due where j.id=due.id returning j.*;
end $$;
revoke all on function public.facebook_auto_reply_test_gate_guard(),public.facebook_auto_reply_repair(integer),
  public.facebook_auto_reply_begin_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.facebook_auto_reply_repair(integer),public.facebook_auto_reply_begin_send(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
reset lock_timeout;
reset statement_timeout;
