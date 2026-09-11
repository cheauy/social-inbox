-- Run as the database owner. Retain this anti-abuse ledger independently of
-- deleted users/workspaces. Stores hashed platform asset IDs.
-- Install BEFORE deploying the matching API changes. Existing deleted channel
-- rows cannot be recovered by this backfill; it covers retained history only.
begin;
create table if not exists public.tenh_trial_channel_claims (
  platform text not null check (platform in ('facebook','telegram')),
  account_hash text not null,
  first_business_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (platform,account_hash)
);
alter table public.tenh_trial_channel_claims enable row level security;
revoke all on public.tenh_trial_channel_claims from public,anon,authenticated;
grant select,insert on public.tenh_trial_channel_claims to service_role;

-- Include disconnected historical rows and trials which later became paid.
insert into public.tenh_trial_channel_claims(platform,account_hash,first_business_id,claimed_at)
select distinct on(sa.platform,btrim(sa.platform_account_id)) sa.platform,
  encode(sha256(convert_to(sa.platform || ':' || btrim(sa.platform_account_id),'UTF8')),'hex'),
  sa.business_id,sa.created_at
from public.social_accounts sa
where sa.platform in ('facebook','telegram') and nullif(btrim(sa.platform_account_id),'') is not null
and exists(select 1 from public.business_subscriptions bs where bs.business_id=sa.business_id and (bs.plan_code='trial' or bs.trial_started_at is not null))
order by sa.platform,btrim(sa.platform_account_id),sa.created_at,sa.id
on conflict do nothing;

create or replace function public.check_tenh_trial_channel_access(p_business_id uuid,p_platform text,p_account_id text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare s public.business_subscriptions%rowtype; v_hash text;
begin
  if p_platform not in ('facebook','telegram') or nullif(btrim(p_account_id),'') is null then return false; end if;
  select * into s from public.business_subscriptions where business_id=p_business_id order by created_at desc limit 1;
  if not found then raise exception 'Workspace subscription not found'; end if;
  if s.status <> 'trialing' then return true; end if;
  if coalesce(s.trial_ends_at,s.current_period_end) is null or coalesce(s.trial_ends_at,s.current_period_end)<=now() then
    raise exception using errcode='P0001',message='The free trial has expired.',detail='TENH_TRIAL_EXPIRED';
  end if;
  v_hash:=encode(sha256(convert_to(p_platform || ':' || btrim(p_account_id),'UTF8')),'hex');
  return not exists(select 1 from public.tenh_trial_channel_claims where platform=p_platform and account_hash=v_hash and first_business_id<>p_business_id);
end;
$$;
revoke all on function public.check_tenh_trial_channel_access(uuid,text,text) from public,anon,authenticated;
grant execute on function public.check_tenh_trial_channel_access(uuid,text,text) to service_role;

create or replace function public.tenh_guard_trial_channel_reuse()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s public.business_subscriptions%rowtype; v_hash text; v_owner uuid;
begin
  if not coalesce(new.is_active,false) or new.platform not in ('facebook','telegram') then return new; end if;
  select * into s from public.business_subscriptions where business_id=new.business_id order by created_at desc limit 1;
  if not found or s.status<>'trialing' then return new; end if;
  if nullif(btrim(new.platform_account_id),'') is null then raise exception 'Channel identity is required'; end if;
  if coalesce(s.trial_ends_at,s.current_period_end) is null or coalesce(s.trial_ends_at,s.current_period_end)<=now() then
    raise exception using errcode='P0001',message='The free trial has expired. Buy a subscription to connect this channel.';
  end if;
  v_hash:=encode(sha256(convert_to(new.platform || ':' || btrim(new.platform_account_id),'UTF8')),'hex');
  -- Unique insertion waits for competing transactions; failed channel saves
  -- roll back their reservation in the same transaction.
  insert into public.tenh_trial_channel_claims(platform,account_hash,first_business_id)
    values(new.platform,v_hash,new.business_id) on conflict do nothing;
  select first_business_id into v_owner from public.tenh_trial_channel_claims where platform=new.platform and account_hash=v_hash;
  if v_owner is distinct from new.business_id then
    raise exception using errcode='P0001',message='This channel has already used a free trial in another workspace. Buy a subscription to connect it here.',detail='TENH_CHANNEL_TRIAL_ALREADY_USED';
  end if;
  return new;
end;
$$;
revoke all on function public.tenh_guard_trial_channel_reuse() from public,anon,authenticated;
drop trigger if exists tenh_guard_trial_channel_reuse on public.social_accounts;
create trigger tenh_guard_trial_channel_reuse before insert or update of business_id,platform,platform_account_id,is_active on public.social_accounts for each row execute function public.tenh_guard_trial_channel_reuse();

-- Close simultaneous registrations slipping past the application's IP count.
create or replace function public.tenh_guard_trial_ip_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.ip_hash is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('tenh-trial-ip:' || new.ip_hash,0));
  if exists(select 1 from public.tenh_trial_claims where user_id=new.user_id) then return new; end if;
  if (select count(*) from public.tenh_trial_claims where ip_hash=new.ip_hash and claimed_at>=now()-interval '30 days')>=2 then
    raise exception using errcode='P0001',message='Network trial limit reached',detail='TENH_TRIAL_IP_LIMIT';
  end if;
  return new;
end;
$$;
revoke all on function public.tenh_guard_trial_ip_limit() from public,anon,authenticated;
drop trigger if exists tenh_guard_trial_ip_limit on public.tenh_trial_claims;
create trigger tenh_guard_trial_ip_limit before insert on public.tenh_trial_claims for each row execute function public.tenh_guard_trial_ip_limit();
commit;
