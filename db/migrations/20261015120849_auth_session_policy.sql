-- Forward-only preparation. This does NOT activate legacy-session enforcement,
-- change Auth configuration, or install/replace the PostgREST pre-request hook.
begin;

create schema if not exists tenh_auth_private;
revoke all on schema tenh_auth_private from public, anon, authenticated;

create table tenh_auth_private.session_settings (
  singleton boolean primary key default true check (singleton),
  remember_days integer not null default 30 check (remember_days between 1 and 90),
  updated_at timestamptz not null default clock_timestamp(),
  enforcement_enabled boolean not null default false,
  native_rollout_approval text,
  legacy_created_before timestamptz,
  legacy_grace_until timestamptz,
  check (not enforcement_enabled or
    (legacy_created_before is not null and legacy_grace_until is not null
     and legacy_grace_until > legacy_created_before
     and legacy_grace_until <= legacy_created_before + interval '30 days'
     and nullif(btrim(native_rollout_approval),'') is not null))
);
insert into tenh_auth_private.session_settings(singleton) values (true);

create table tenh_auth_private.session_settings_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  previous_remember_days integer not null check (previous_remember_days between 1 and 90),
  remember_days integer not null check (remember_days between 1 and 90),
  changed_at timestamptz not null default clock_timestamp()
);

create table tenh_auth_private.session_policies (
  session_id uuid primary key,
  user_id uuid not null,
  authenticated_at timestamptz not null,
  expires_at timestamptz not null,
  remembered boolean not null,
  kind text not null check (kind in ('normal', 'recovery')),
  revoked_at timestamptz,
  bound_at timestamptz not null default clock_timestamp(),
  check (expires_at > authenticated_at)
);
create index session_policies_user_idx on tenh_auth_private.session_policies(user_id);

create table tenh_auth_private.rate_windows (
  action text not null,
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null,
  primary key (action, key_hash)
);
create index rate_windows_expiry_idx on tenh_auth_private.rate_windows(expires_at);
alter table tenh_auth_private.session_settings enable row level security;
alter table tenh_auth_private.session_settings_audit enable row level security;
alter table tenh_auth_private.session_policies enable row level security;
alter table tenh_auth_private.rate_windows enable row level security;
revoke all on all tables in schema tenh_auth_private from public, anon, authenticated, service_role;

-- Protect immutable expiry snapshots even from accidental server-side UPDATEs.
create function tenh_auth_private.preserve_session_snapshot() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.session_id, new.user_id, new.authenticated_at, new.expires_at,
      new.remembered, new.kind, new.bound_at) is distinct from
     (old.session_id, old.user_id, old.authenticated_at, old.expires_at,
      old.remembered, old.kind, old.bound_at) or
     (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'Session policy snapshots and revocations are immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger preserve_session_snapshot before update on tenh_auth_private.session_policies
for each row execute function tenh_auth_private.preserve_session_snapshot();

create function tenh_auth_private.inspect_session(p_user_id uuid, p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  provider auth.sessions%rowtype;
  account auth.users%rowtype;
  policy tenh_auth_private.session_policies%rowtype;
  settings tenh_auth_private.session_settings%rowtype;
  moment timestamptz := statement_timestamp();
begin
  select * into account from auth.users where id=p_user_id;
  if not found or account.deleted_at is not null or account.banned_until > moment then
    return jsonb_build_object('status','account-disabled');
  end if;
  if account.email_confirmed_at is null then return jsonb_build_object('status','email-unverified'); end if;
  select * into provider from auth.sessions where id = p_session_id and user_id = p_user_id;
  if not found then return jsonb_build_object('status','provider-session-missing'); end if;
  if provider.created_at is null or provider.created_at > moment then
    return jsonb_build_object('status','invalid-provider-time');
  end if;
  if provider.not_after is not null and provider.not_after <= moment then
    return jsonb_build_object('status','provider-session-expired');
  end if;
  select * into policy from tenh_auth_private.session_policies where session_id = p_session_id;
  if found then
    if policy.user_id <> p_user_id then return jsonb_build_object('status','session-user-mismatch'); end if;
    if policy.revoked_at is not null then return jsonb_build_object('status','revoked'); end if;
    if policy.expires_at <= moment then return jsonb_build_object('status','expired'); end if;
    return jsonb_build_object('status','allowed','kind',policy.kind,
      'authenticated_at',policy.authenticated_at,'expires_at',least(policy.expires_at,provider.not_after),
      'remembered',policy.remembered,'server_time',moment);
  end if;
  select * into strict settings from tenh_auth_private.session_settings where singleton;
  if settings.enforcement_enabled and not (
      provider.created_at < settings.legacy_created_before and moment < settings.legacy_grace_until
  ) then return jsonb_build_object('status','unbound-session'); end if;
  return jsonb_build_object('status','allowed','kind','legacy',
    'authenticated_at',provider.created_at,'expires_at',
      least(case when settings.enforcement_enabled then settings.legacy_grace_until else null end,provider.not_after),
    'remembered',null,'server_time',moment);
end;
$$;

create function public.tenh_inspect_session_policy(p_user_id uuid, p_session_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select tenh_auth_private.inspect_session(p_user_id, p_session_id);
$$;

create function public.tenh_bind_session_policy(
  p_user_id uuid, p_session_id uuid, p_remember_me boolean, p_kind text default 'normal'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  provider auth.sessions%rowtype;
  days integer;
  moment timestamptz := clock_timestamp();
begin
  if p_kind not in ('normal','recovery') or p_remember_me is null then
    raise exception 'Invalid session policy' using errcode = '22023';
  end if;
  -- No update on conflict: refresh, re-binding, and changed settings cannot extend expiry.
  if exists(select 1 from tenh_auth_private.session_policies where session_id = p_session_id) then
    return tenh_auth_private.inspect_session(p_user_id, p_session_id);
  end if;
  select * into provider from auth.sessions where id = p_session_id and user_id = p_user_id;
  if not found then return jsonb_build_object('status','provider-session-missing'); end if;
  if provider.created_at is null or provider.created_at > moment or
     provider.created_at < moment - interval '10 minutes' then
    return jsonb_build_object('status','fresh-authentication-required');
  end if;
  if provider.not_after is not null and provider.not_after <= moment then
    return jsonb_build_object('status','provider-session-expired');
  end if;
  select remember_days into strict days from tenh_auth_private.session_settings where singleton;
  insert into tenh_auth_private.session_policies
    (session_id,user_id,authenticated_at,expires_at,remembered,kind)
  values (p_session_id,p_user_id,provider.created_at,
    least(provider.created_at + make_interval(secs => case when p_remember_me then days * 86400 else 86400 end),provider.not_after),
    p_remember_me,p_kind)
  on conflict (session_id) do nothing;
  return tenh_auth_private.inspect_session(p_user_id, p_session_id);
end;
$$;

create function public.tenh_revoke_session_policies(
  p_user_id uuid, p_session_id uuid default null, p_except_session_id uuid default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare changed integer; inserted integer; moment timestamptz := clock_timestamp();
begin
  -- Tombstone unbound provider sessions too; a late bind cannot revive them.
  insert into tenh_auth_private.session_policies
    (session_id,user_id,authenticated_at,expires_at,remembered,kind,revoked_at)
  select id,user_id,created_at,created_at + interval '1 day',false,'normal',moment
  from auth.sessions where user_id = p_user_id and created_at is not null
    and (p_session_id is null or id = p_session_id)
    and (p_except_session_id is null or id <> p_except_session_id)
  on conflict (session_id) do nothing;
  get diagnostics inserted = row_count;
  update tenh_auth_private.session_policies set revoked_at = moment
    where user_id = p_user_id and revoked_at is null
      and (p_session_id is null or session_id = p_session_id)
      and (p_except_session_id is null or session_id <> p_except_session_id);
  get diagnostics changed = row_count;
  return changed + inserted;
end;
$$;

create function public.tenh_claim_recovery_session(p_user_id uuid,p_session_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  -- Consume before the provider password update; failure requires a new recovery link.
  update tenh_auth_private.session_policies policy set revoked_at=clock_timestamp()
  where policy.user_id=p_user_id and policy.session_id=p_session_id
    and policy.kind='recovery' and policy.revoked_at is null
    and policy.expires_at>clock_timestamp()
    and exists(select 1 from auth.sessions provider where provider.id=policy.session_id
      and provider.user_id=policy.user_id and
        (provider.not_after is null or provider.not_after>clock_timestamp()))
    and exists(select 1 from auth.users account where account.id=policy.user_id
      and account.deleted_at is null and account.email_confirmed_at is not null
      and (account.banned_until is null or account.banned_until<=clock_timestamp()));
  return found;
end;
$$;

create function public.tenh_get_session_policy_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('remember_days',remember_days,'updated_at',updated_at)
  from tenh_auth_private.session_settings where singleton;
$$;
create function public.tenh_set_session_policy_settings(p_remember_days integer, p_actor_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare previous integer;
begin
  if p_remember_days is null or p_remember_days not between 1 and 90 then
    raise exception 'Remembered session duration must be 1 to 90 days' using errcode='22023';
  end if;
  if p_actor_user_id is null then
    raise exception 'Verified administrator actor is required' using errcode='22023';
  end if;
  select remember_days into strict previous from tenh_auth_private.session_settings where singleton for update;
  update tenh_auth_private.session_settings set remember_days = p_remember_days,
    updated_at = clock_timestamp() where singleton;
  insert into tenh_auth_private.session_settings_audit(actor_user_id,previous_remember_days,remember_days)
  values (p_actor_user_id,previous,p_remember_days);
  return public.tenh_get_session_policy_settings();
end;
$$;

create function public.tenh_consume_auth_rate_limit(
  p_action text, p_ip_hash text, p_identity_hash text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  period_seconds integer := 900; ip_limit integer; identity_limit integer;
  moment timestamptz := clock_timestamp(); starts timestamptz; ends timestamptz;
  bucket text; bucket_limit integer; used integer; allowed boolean := true;
begin
  case p_action
    when 'login' then ip_limit:=30; identity_limit:=5;
    when 'signup' then ip_limit:=10; identity_limit:=3; period_seconds:=3600;
    when 'confirm' then ip_limit:=60; identity_limit:=12;
    when 'resend' then ip_limit:=20; identity_limit:=3;
    when 'recover' then ip_limit:=20; identity_limit:=3;
    when 'reset-password' then ip_limit:=20; identity_limit:=5;
    when 'password-update' then ip_limit:=20; identity_limit:=5;
    when 'recovery-email' then ip_limit:=10; identity_limit:=3; period_seconds:=3600;
    when 'oauth' then ip_limit:=60; identity_limit:=20;
    when 'admin-session-policy' then ip_limit:=30; identity_limit:=10;
    else raise exception 'Unknown authentication action' using errcode='22023';
  end case;
  if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' or
     (p_identity_hash is not null and p_identity_hash !~ '^[a-f0-9]{64}$') then
    raise exception 'Expected opaque rate-limit keys' using errcode='22023';
  end if;
  starts := to_timestamp(floor(extract(epoch from moment) / period_seconds) * period_seconds);
  ends := starts + make_interval(secs => period_seconds);
  foreach bucket in array array[p_ip_hash,p_identity_hash] loop
    if bucket is null then continue; end if;
    bucket_limit := case when bucket = p_ip_hash then ip_limit else identity_limit end;
    insert into tenh_auth_private.rate_windows as windows(action,key_hash,window_start,attempts,expires_at)
    values (p_action,bucket,starts,1,ends)
    on conflict(action,key_hash) do update set
      attempts = case when windows.window_start = excluded.window_start
        then least(windows.attempts + 1, bucket_limit + 1) else 1 end,
      window_start = excluded.window_start, expires_at = excluded.expires_at
    returning attempts into used;
    if used > bucket_limit then
      allowed := false;
      -- Do not create endless new identity rows behind an already blocked IP.
      exit;
    end if;
  end loop;
  -- Bounded work per request, including when an attacker continually rotates identities.
  delete from tenh_auth_private.rate_windows where (action,key_hash) in (
    select action,key_hash from tenh_auth_private.rate_windows
    where expires_at < moment - interval '1 day' order by expires_at limit 100 for update skip locked
  );
  return jsonb_build_object('allowed',allowed,'retry_after_seconds',
    case when allowed then 0 else greatest(1,ceil(extract(epoch from ends - moment))::integer) end);
end;
$$;

-- This predicate only adds a conjunct; it grants no tenant or object access.
create function public.tenh_session_is_authorized() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare claims jsonb := auth.jwt(); sid text; result jsonb;
begin
  sid := claims->>'session_id';
  if auth.uid() is null or sid is null or
     sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  result := tenh_auth_private.inspect_session(auth.uid(),sid::uuid);
  return result->>'status' = 'allowed' and result->>'kind' <> 'recovery';
end;
$$;

create function public.tenh_auth_pre_request() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  -- PostgREST invokes this before RLS-bypassing RPCs and views as well as tables.
  if current_setting('role',true) = 'service_role' then return; end if;
  if auth.uid() is null and current_setting('role',true) = 'anon' then return; end if;
  if not public.tenh_session_is_authorized() then
    raise exception 'Application session is not authorized' using errcode='42501';
  end if;
end;
$$;

-- Restrictive policies preserve every existing permissive business/role policy.
-- Tables without RLS, invoker/owner views and future tables require preflight review.
do $$
declare target record;
begin
  for target in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and c.relrowsecurity
      and (n.nspname='public' or (n.nspname='storage' and c.relname='objects')
        or (n.nspname='realtime' and c.relname='messages'))
  loop
    execute format('create policy tenh_session_policy_guard on %I.%I as restrictive for all to anon, authenticated using (((select auth.uid()) is null and (select current_setting(''role'',true)) = ''anon'') or (select public.tenh_session_is_authorized())) with check (((select auth.uid()) is null and (select current_setting(''role'',true)) = ''anon'') or (select public.tenh_session_is_authorized()))',target.nspname,target.relname);
  end loop;
end;
$$;

revoke all on all functions in schema tenh_auth_private from public, anon, authenticated, service_role;
revoke all on function public.tenh_inspect_session_policy(uuid,uuid),
  public.tenh_bind_session_policy(uuid,uuid,boolean,text),
  public.tenh_revoke_session_policies(uuid,uuid,uuid),
  public.tenh_claim_recovery_session(uuid,uuid),
  public.tenh_get_session_policy_settings(),public.tenh_set_session_policy_settings(integer,uuid),
  public.tenh_consume_auth_rate_limit(text,text,text) from public, anon, authenticated;
grant execute on function public.tenh_inspect_session_policy(uuid,uuid),
  public.tenh_bind_session_policy(uuid,uuid,boolean,text),
  public.tenh_revoke_session_policies(uuid,uuid,uuid),
  public.tenh_claim_recovery_session(uuid,uuid),
  public.tenh_get_session_policy_settings(),public.tenh_set_session_policy_settings(integer,uuid),
  public.tenh_consume_auth_rate_limit(text,text,text) to service_role;
revoke all on function public.tenh_session_is_authorized(),public.tenh_auth_pre_request() from public;
grant execute on function public.tenh_session_is_authorized(),public.tenh_auth_pre_request() to anon,authenticated,service_role;
commit;
