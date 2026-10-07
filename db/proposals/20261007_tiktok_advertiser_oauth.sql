-- PROPOSAL ONLY. Not installed; requires explicit schema approval and live preflight.
-- No changes to social_accounts, channel counting, Inbox or account-holder OAuth.
-- service_role is the only API role allowed to access credentials. Route guards
-- enforce active membership and channels/manage and scope all writes by business_id.
-- Business deletion remains restricted even after disconnect. No fingerprint cleanup.
begin;

-- Coordination only: no archive, deletion tombstone or automatic fence expiry.
alter table public.businesses
  add column tiktok_advertiser_closure_operation_id uuid,
  add column tiktok_advertiser_closure_user_id uuid,
  add constraint tiktok_advertiser_closure_binding check (
    (tiktok_advertiser_closure_operation_id is null) = (tiktok_advertiser_closure_user_id is null));

create table public.tiktok_advertiser_connections (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  member_id uuid not null,
  user_id uuid not null,
  app_id text not null check (app_id ~ '^[0-9]{1,32}$'),
  status text not null check (status in ('pending','exchanging','connected','failed','revocation_pending','disconnected')),
  state_hash text check (state_hash ~ '^[a-f0-9]{64}$'),
  state_expires_at timestamptz,
  access_token_encrypted text,
  token_hash text check (token_hash ~ '^[a-f0-9]{64}$'),
  advertiser_ids text[] not null default '{}',
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  connected_at timestamptz,
  disconnected_at timestamptz,
  revoke_operation_id uuid,
  revoke_started_at timestamptz,
  revoke_confirmed_at timestamptz,
  check ((status = 'pending') = (state_hash is not null and state_expires_at is not null)),
  check (status = 'pending' or (state_hash is null and state_expires_at is null)),
  check ((status in ('connected','revocation_pending')) = (access_token_encrypted is not null)),
  check ((status in ('connected','revocation_pending','disconnected')) = (token_hash is not null)),
  check ((status in ('revocation_pending','disconnected')) = (revoke_operation_id is not null and revoke_started_at is not null)),
  check (status in ('revocation_pending','disconnected') or
    (revoke_operation_id is null and revoke_started_at is null and revoke_confirmed_at is null)),
  check (status <> 'disconnected' or revoke_confirmed_at is not null),
  check (access_token_encrypted is null or access_token_encrypted ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  check (cardinality(advertiser_ids) <= 1000 and cardinality(scopes) <= 1000),
  check (status not in ('connected','revocation_pending') or (cardinality(advertiser_ids) > 0 and connected_at is not null))
);

-- Permanent ownership/tombstone, even after credentials are cleared. Do not delete these
-- rows or release fingerprints without controlled reconciliation of all in-flight attempts.
create unique index tiktok_advertiser_token_unique on public.tiktok_advertiser_connections(app_id,token_hash)
  where token_hash is not null;
create index tiktok_advertiser_tenant_lookup on public.tiktok_advertiser_connections(business_id,id);
alter table public.tiktok_advertiser_connections enable row level security;
revoke all on public.tiktok_advertiser_connections from public,anon,authenticated,service_role;
grant select,insert,update on public.tiktok_advertiser_connections to service_role;

-- Saves and disconnect claims share a transaction advisory lock for the app/token pair.
-- Hash collisions only serialize unrelated grants. These are invoker functions, service-role only.
create function public.tenh_save_tiktok_advertiser_grant(
  p_id uuid, p_business_id uuid, p_member_id uuid, p_user_id uuid, p_app_id text,
  p_token_hash text, p_encrypted text, p_advertiser_ids text[], p_scopes text[]
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid;
  owner_status text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid grant fingerprint';
  end if;
  if exists(select 1 from public.businesses where id=p_business_id
    and tiktok_advertiser_closure_operation_id is not null) then return 'closure_in_progress'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_app_id || ':' || p_token_hash, 0));
  -- Lock the attempt after the fingerprint, consistently with the disconnect claim.
  perform 1 from public.tiktok_advertiser_connections
    where id=p_id and business_id=p_business_id and member_id=p_member_id and user_id=p_user_id and app_id=p_app_id
    for update;
  if not found then return 'invalid_attempt'; end if;
  select id,status into owner_id,owner_status from public.tiktok_advertiser_connections
    where app_id=p_app_id and token_hash=p_token_hash;
  if owner_id is not null then
    if owner_id=p_id and owner_status='connected' then return 'connected'; end if;
    return 'conflict';
  end if;
  update public.tiktok_advertiser_connections set status='connected', token_hash=p_token_hash,
    access_token_encrypted=p_encrypted, advertiser_ids=p_advertiser_ids, scopes=p_scopes, connected_at=now()
    where id=p_id and business_id=p_business_id and member_id=p_member_id and user_id=p_user_id
      and app_id=p_app_id and status='exchanging';
  if not found then return 'invalid_attempt'; end if;
  return 'connected';
end;
$$;

create function public.tenh_claim_tiktok_advertiser_disconnect(
  p_id uuid, p_business_id uuid, p_app_id text, p_operation_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  grant_row public.tiktok_advertiser_connections%rowtype;
begin
  if p_operation_id is null then raise exception 'Invalid operation'; end if;
  select * into grant_row from public.tiktok_advertiser_connections
    where id=p_id and business_id=p_business_id and app_id=p_app_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if grant_row.token_hash is null then return jsonb_build_object('outcome','not_ready'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_app_id || ':' || grant_row.token_hash, 0));
  select * into grant_row from public.tiktok_advertiser_connections
    where id=p_id and business_id=p_business_id and app_id=p_app_id for update;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if grant_row.status='disconnected' then return jsonb_build_object('outcome','disconnected'); end if;
  if grant_row.status='revocation_pending' then
    if grant_row.revoke_confirmed_at is not null then
      return jsonb_build_object('outcome','confirmed','operation_id',grant_row.revoke_operation_id,'token_hash',grant_row.token_hash);
    end if;
    -- Never steal/expire an owner. A crashed request and a slow provider request are indistinguishable.
    return jsonb_build_object('outcome','busy');
  end if;
  if grant_row.status<>'connected' then return jsonb_build_object('outcome','not_ready'); end if;
  update public.tiktok_advertiser_connections set status='revocation_pending',
    revoke_operation_id=p_operation_id,revoke_started_at=now() where id=p_id and business_id=p_business_id and app_id=p_app_id;
  return jsonb_build_object('outcome','claimed','operation_id',p_operation_id,
    'token_hash',grant_row.token_hash,'access_token_encrypted',grant_row.access_token_encrypted);
end;
$$;

revoke all on function public.tenh_save_tiktok_advertiser_grant(uuid,uuid,uuid,uuid,text,text,text,text[],text[]) from public,anon,authenticated;
revoke all on function public.tenh_claim_tiktok_advertiser_disconnect(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.tenh_save_tiktok_advertiser_grant(uuid,uuid,uuid,uuid,text,text,text,text[],text[]) to service_role;
grant execute on function public.tenh_claim_tiktok_advertiser_disconnect(uuid,uuid,text,uuid) to service_role;
-- Inserts and exchange commencement share the business row lock with closure.
-- Pending/exchanging/failed attempts remain unresolved even without a received token.
create function public.tenh_guard_tiktok_advertiser_attempt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare fence uuid;
begin
  if TG_OP='UPDATE' and new.status<>'exchanging' then return new; end if;
  select tiktok_advertiser_closure_operation_id into fence from public.businesses
    where id=new.business_id for update;
  if not found or fence is not null then
    raise exception using errcode='23514', message='TikTok advertiser workspace closure is pending.';
  end if;
  if not exists(select 1 from public.team_members where business_id=new.business_id
    and role='owner' and is_active=true and user_id is not null) then
    raise exception using errcode='23514', message='TikTok advertiser work requires an active Owner.';
  end if;
  if not exists(select 1 from public.team_members where id=new.member_id and business_id=new.business_id
    and user_id=new.user_id and is_active=true and (role='owner' or permissions->>'channels'='manage')) then
    raise exception using errcode='23514', message='TikTok advertiser attempt membership is unavailable.';
  end if;
  return new;
end;
$$;
create trigger tenh_tiktok_advertiser_attempt_guard
before insert or update of status on public.tiktok_advertiser_connections
for each row execute function public.tenh_guard_tiktok_advertiser_attempt();

-- Existing business table grants must not let a browser clear or replace a fence.
create function public.tenh_guard_tiktok_advertiser_closure_fence()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP='UPDATE' and new.tiktok_advertiser_closure_operation_id is not distinct from old.tiktok_advertiser_closure_operation_id
    and new.tiktok_advertiser_closure_user_id is not distinct from old.tiktok_advertiser_closure_user_id then return new; end if;
  if TG_OP='INSERT' and new.tiktok_advertiser_closure_operation_id is null
    and new.tiktok_advertiser_closure_user_id is null then return new; end if;
  if current_user<>'service_role' then
    raise exception using errcode='42501', message='Advertiser closure coordination is service-only.';
  end if;
  if TG_OP='UPDATE' and old.tiktok_advertiser_closure_operation_id is not null then
    raise exception using errcode='23514', message='Advertiser closure requires controlled reconciliation.';
  end if;
  return new;
end;
$$;
create trigger tenh_tiktok_advertiser_closure_fence_guard
before insert or update of tiktok_advertiser_closure_operation_id,tiktok_advertiser_closure_user_id on public.businesses
for each row execute function public.tenh_guard_tiktok_advertiser_closure_fence();

-- Protect direct deletion, deactivation, demotion and workspace reassignment.
create function public.tenh_guard_tiktok_advertiser_owner_removal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role<>'owner' or old.is_active is not true or old.user_id is null then
    if TG_OP='DELETE' then return old; else return new; end if;
  end if;
  if TG_OP='UPDATE' and new.business_id=old.business_id and new.role='owner'
    and new.is_active=true and new.user_id is not null then return new; end if;
  perform 1 from public.businesses where id=old.business_id for update;
  if exists(select 1 from public.tiktok_advertiser_connections
      where business_id=old.business_id and status<>'disconnected')
    and not exists(select 1 from public.team_members where business_id=old.business_id
      and id<>old.id and role='owner' and is_active=true and user_id is not null) then
    raise exception using errcode='23514',
      message='Reconcile TikTok advertiser work or transfer Owner access before removing the last Owner.';
  end if;
  if TG_OP='DELETE' then return old; else return new; end if;
end;
$$;
create trigger tenh_tiktok_advertiser_owner_removal_guard
before update or delete on public.team_members
for each row execute function public.tenh_guard_tiktok_advertiser_owner_removal();

-- Reserve affected fences in one transaction before account staging. Auth deletion is
-- external. Crashes retain the operation owner; there is no TTL or automatic takeover.
create function public.tenh_begin_tiktok_advertiser_account_deletion(
  p_user_id uuid, p_operation_id uuid, p_closing_business_ids uuid[], p_transferring_business_ids uuid[]
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare business_row public.businesses%rowtype; affected uuid[] := '{}';
begin
  if p_user_id is null or p_operation_id is null then return jsonb_build_object('outcome','invalid_scope'); end if;
  if exists(select 1 from unnest(coalesce(p_closing_business_ids,'{}') || coalesce(p_transferring_business_ids,'{}')) as requested(business_id)
    where not exists(select 1 from public.team_members t where t.business_id=requested.business_id and t.user_id=p_user_id
      and t.role='owner' and t.is_active=true)) then return jsonb_build_object('outcome','invalid_scope'); end if;
  for business_row in select b.* from public.businesses b where b.id in
    (select business_id from public.team_members where user_id=p_user_id and is_active=true)
    order by b.id for update loop
    if business_row.id=any(coalesce(p_transferring_business_ids,'{}')) then continue; end if;
    if not exists(select 1 from public.team_members where business_id=business_row.id
      and user_id=p_user_id and role='owner' and is_active=true) then continue; end if;
    if exists(select 1 from public.team_members where business_id=business_row.id
      and user_id<>p_user_id and user_id is not null and role='owner' and is_active=true) then continue; end if;
    if business_row.tiktok_advertiser_closure_operation_id is not null
      and (business_row.tiktok_advertiser_closure_operation_id<>p_operation_id
        or business_row.tiktok_advertiser_closure_user_id<>p_user_id) then
      return jsonb_build_object('outcome','busy');
    end if;
    if exists(select 1 from public.tiktok_advertiser_connections where business_id=business_row.id
      and status<>'disconnected') then return jsonb_build_object('outcome','blocked'); end if;
    affected := array_append(affected,business_row.id);
  end loop;
  update public.businesses set tiktok_advertiser_closure_operation_id=p_operation_id,
    tiktok_advertiser_closure_user_id=p_user_id where id=any(affected);
  return jsonb_build_object('outcome','reserved','business_ids',to_jsonb(affected));
end;
$$;
revoke all on function public.tenh_guard_tiktok_advertiser_attempt() from public,anon,authenticated,service_role;
revoke all on function public.tenh_guard_tiktok_advertiser_closure_fence() from public,anon,authenticated,service_role;
revoke all on function public.tenh_guard_tiktok_advertiser_owner_removal() from public,anon,authenticated,service_role;
revoke all on function public.tenh_begin_tiktok_advertiser_account_deletion(uuid,uuid,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.tenh_begin_tiktok_advertiser_account_deletion(uuid,uuid,uuid[],uuid[]) to service_role;
-- No browser policies, publication, provider settings or default-on switch.

commit;
