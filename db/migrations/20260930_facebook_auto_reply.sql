-- Apply only after backup/review. Does not activate rules or backfill messages.
-- INITIAL SCHEMA ONLY; not rerunnable. Never deploy this without the 20261001 safety migration.
-- No messages trigger is attached on fresh installs. The safety migration detaches any older copy.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
create table public.facebook_auto_reply_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  post_id text,
  post_url text,
  public_template text check (length(public_template) between 1 and 8000),
  private_template text check (length(private_template) between 1 and 2000),
  enabled boolean not null default false,
  starts_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (public_template is not null or private_template is not null),
  check (not enabled or (starts_at is not null and activated_at is not null))
);
create unique index facebook_auto_reply_scope on public.facebook_auto_reply_rules
  (social_account_id, coalesce(post_id, '*'));
create index facebook_auto_reply_tenant on public.facebook_auto_reply_rules(business_id, created_at desc);
create table public.facebook_auto_reply_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  rule_id uuid not null references public.facebook_auto_reply_rules(id),
  message_id uuid references public.messages(id) on delete set null,
  comment_id text not null,
  recipient_id text not null,
  action text not null check (action in ('public','private')),
  activation timestamptz not null,
  status text not null default 'pending' check (status in ('pending','claimed','sending','retry','sent','skipped','failed','needs_review')),
  reason text,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  claim_token uuid,
  send_started_at timestamptz,
  send_template text,
  reconciliation_attempted_at timestamptz,
  platform_reply_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(social_account_id, comment_id, action)
);
create index facebook_auto_reply_due on public.facebook_auto_reply_jobs(available_at,created_at)
  where status in ('pending','retry');
create index facebook_auto_reply_leases on public.facebook_auto_reply_jobs(lease_until)
  where status in ('claimed','sending');
create index facebook_auto_reply_history on public.facebook_auto_reply_jobs(business_id,created_at desc);
create index facebook_auto_reply_review on public.facebook_auto_reply_jobs(created_at)
  where status='needs_review' and reconciliation_attempted_at is null;
-- One durable reservation per Page/customer prevents concurrent initial private replies.
create table public.facebook_auto_reply_recipients (
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  recipient_id text not null,
  job_id uuid not null references public.facebook_auto_reply_jobs(id) on delete cascade,
  primary key(social_account_id, recipient_id)
);
alter table public.facebook_auto_reply_rules enable row level security;
alter table public.facebook_auto_reply_jobs enable row level security;
alter table public.facebook_auto_reply_recipients enable row level security;
revoke all on public.facebook_auto_reply_rules, public.facebook_auto_reply_jobs,
  public.facebook_auto_reply_recipients from anon, authenticated;
grant all on public.facebook_auto_reply_rules, public.facebook_auto_reply_jobs,
  public.facebook_auto_reply_recipients to service_role;

create function public.facebook_auto_reply_rule_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from social_accounts a where a.id=new.social_account_id
    and a.business_id=new.business_id and a.platform='facebook' and a.is_active) then
    raise exception 'Connected Facebook Page does not belong to this workspace';
  end if;
  new.updated_at=now();
  if tg_op='INSERT' then
    new.enabled=false; new.activated_at=null;
  elsif new.enabled and not old.enabled then
    -- Activation is always now; a requested older start never backfills.
    new.activated_at=clock_timestamp();
  elsif new.enabled and (new.post_id is distinct from old.post_id or
    new.starts_at is distinct from old.starts_at or new.public_template is distinct from old.public_template or
    new.private_template is distinct from old.private_template or new.social_account_id<>old.social_account_id) then
    raise exception 'Pause the rule before editing it';
  end if;
  if tg_op='UPDATE' and not new.enabled then
    update facebook_auto_reply_jobs set status='skipped',reason='rule_paused',updated_at=now()
      where rule_id=new.id and status in ('pending','retry','claimed');
  end if;
  return new;
end $$;
create trigger facebook_auto_reply_rule_guard before insert or update on public.facebook_auto_reply_rules
for each row execute function public.facebook_auto_reply_rule_guard();

create function public.facebook_auto_reply_enqueue() returns trigger
language plpgsql set search_path = public as $$
declare c record; r facebook_auto_reply_rules; a record; stamp timestamptz;
begin
  if new.direction<>'incoming' or new.is_echo or new.platform_message_id is null or
    new.raw_payload->>'item' is distinct from 'comment' or new.raw_payload->>'verb' is distinct from 'add' then return new; end if;
  select cv.social_account_id, cv.business_id, sa.platform_account_id, sa.platform, sa.is_active into c
    from conversations cv join social_accounts sa on sa.id=cv.social_account_id
    where cv.id=new.conversation_id and cv.business_id=new.business_id and sa.business_id=new.business_id;
  if not found or c.platform<>'facebook' or not c.is_active or new.sender_platform_id=c.platform_account_id then return new; end if;
  -- Missing original timestamps are unsafe: ingestion time is not comment creation time.
  if not (new.raw_payload ? 'created_time') or new.raw_payload->>'created_time' is null then return new; end if;
  stamp=new.platform_created_at;
  if stamp is null then return new; end if;
  select * into r from facebook_auto_reply_rules where social_account_id=c.social_account_id
    and business_id=new.business_id and enabled
    and (post_id is null or post_id=new.raw_payload->>'post_id')
    order by (post_id is not null) desc,created_at,id limit 1;
  if not found then return new; end if;
  for a in select 'public' as action where r.public_template is not null
    union all select 'private' where r.private_template is not null loop
    insert into facebook_auto_reply_jobs(business_id,social_account_id,rule_id,message_id,
      comment_id,recipient_id,action,activation,status,reason)
      values(new.business_id,c.social_account_id,r.id,new.id,new.platform_message_id,
        new.sender_platform_id,a.action,r.activated_at,
        case when stamp>=greatest(r.starts_at,r.activated_at) then 'pending' else 'skipped' end,
        case when stamp<greatest(r.starts_at,r.activated_at) then 'before_start' end)
      on conflict(social_account_id,comment_id,action) do nothing;
  end loop;
  return new;
end $$;
-- Deliberately do NOT attach this legacy helper to messages. Core inbox persistence is independent.
-- The safety migration provides bounded background enqueue from durable comment records.

create function public.facebook_auto_reply_claim(p_limit integer default 5)
returns setof public.facebook_auto_reply_jobs language plpgsql set search_path = public as $$
begin
  -- A worker dying after the send boundary is uncertain, never blindly retry it.
  update facebook_auto_reply_jobs set status='needs_review',reason='send_outcome_unknown',updated_at=now()
    where status='sending' and lease_until<now();
  update facebook_auto_reply_jobs set status=case when attempts>=4 then 'failed' else 'retry' end,
    reason=case when attempts>=4 then 'retry_limit_reached' else 'worker_recovered' end,updated_at=now()
    where status='claimed' and lease_until<now();
  return query
    with due as (
      select j.id from facebook_auto_reply_jobs j
      join facebook_auto_reply_rules r on r.id=j.rule_id
      where j.status in ('pending','retry') and j.available_at<=now() and r.enabled
      and r.activated_at=j.activation
      and not exists (select 1 from facebook_auto_reply_jobs other where
        other.social_account_id=j.social_account_id and other.comment_id=j.comment_id and other.id<>j.id
        and (other.status in ('claimed','sending') or
          (j.action='private' and other.action='public' and other.status in ('pending','retry'))))
      order by j.created_at, j.action desc limit least(greatest(p_limit,1),10)
      for update of j skip locked
    )
    update facebook_auto_reply_jobs j set status='claimed',claim_token=gen_random_uuid(),attempts=attempts+1,
      lease_until=now()+interval '2 minutes',updated_at=now() from due where j.id=due.id returning j.*;
end $$;

create function public.facebook_auto_reply_begin_send(p_job uuid,p_claim uuid) returns boolean
language plpgsql set search_path = public as $$
declare j facebook_auto_reply_jobs; r facebook_auto_reply_rules; reserved uuid;
begin
  -- Lock in the same order as pause: rule, then job.
  select * into r from facebook_auto_reply_rules where id=(select rule_id from facebook_auto_reply_jobs where id=p_job) for update;
  select * into j from facebook_auto_reply_jobs where id=p_job for update;
  if not found or j.status<>'claimed' or j.claim_token is distinct from p_claim or j.lease_until<now() then return false; end if;
  if not r.enabled or r.activated_at<>j.activation then
    update facebook_auto_reply_jobs set status='skipped',reason='rule_paused',updated_at=now() where id=j.id;
    return false;
  end if;
  if not exists(select 1 from social_accounts a where a.id=j.social_account_id
    and a.business_id=j.business_id and a.is_active and a.platform='facebook') then
    update facebook_auto_reply_jobs set status='skipped',reason='page_disconnected',updated_at=now() where id=j.id;
    return false;
  end if;
  if j.action='private' then
    -- A confirmed customer response permits a later initial reply. Uncertain reservations stay held.
    delete from facebook_auto_reply_recipients reservation using facebook_auto_reply_jobs previous
      where reservation.social_account_id=j.social_account_id and reservation.recipient_id=j.recipient_id
      and previous.id=reservation.job_id and previous.status='sent'
      and exists(select 1 from messages response where response.business_id=j.business_id
        and response.conversation_id=(select conversation_id from messages where id=j.message_id)
        and response.direction='incoming' and response.sender_platform_id=j.recipient_id
        and response.raw_payload->'message'->>'mid' is not null
        and coalesce((response.raw_payload->'message'->>'is_echo')::boolean,false)=false
        and response.platform_created_at>previous.send_started_at);
    insert into facebook_auto_reply_recipients(social_account_id,recipient_id,job_id)
      values(j.social_account_id,j.recipient_id,j.id) on conflict do nothing;
    select job_id into reserved from facebook_auto_reply_recipients
      where social_account_id=j.social_account_id and recipient_id=j.recipient_id;
    if reserved<>j.id then
      update facebook_auto_reply_jobs set status='skipped',reason='private_reply_already_reserved',updated_at=now() where id=j.id;
      return false;
    end if;
  end if;
  update facebook_auto_reply_jobs set status='sending',send_started_at=clock_timestamp(),
    send_template=case when j.action='public' then r.public_template else r.private_template end,
    lease_until=now()+interval '2 minutes',updated_at=now() where id=j.id;
  return true;
end $$;
revoke all on function public.facebook_auto_reply_rule_guard(),public.facebook_auto_reply_enqueue(),
  public.facebook_auto_reply_claim(integer),public.facebook_auto_reply_begin_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.facebook_auto_reply_claim(integer),public.facebook_auto_reply_begin_send(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
