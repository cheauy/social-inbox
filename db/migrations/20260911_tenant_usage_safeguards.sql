-- Application traffic measurements, not a replica of Supabase billing.
-- Additive migration. No existing customer rows, plans or quotas are changed.
begin;

create table if not exists public.tenh_usage_daily (
  business_id uuid not null references public.businesses(id) on delete cascade,
  day date not null,
  route text not null,
  requests bigint not null default 0,
  database_requests bigint not null default 0,
  database_bytes bigint not null default 0,
  storage_bytes bigint not null default 0,
  upload_bytes bigint not null default 0,
  primary key (business_id, day, route)
);
create index if not exists tenh_usage_daily_day_idx on public.tenh_usage_daily(day);

create table if not exists public.tenh_usage_policies (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  -- NULL/zero = no limit. Opt in only after measuring real usage.
  read_requests_per_minute integer check (read_requests_per_minute > 0),
  monthly_observed_bytes_budget bigint check (monthly_observed_bytes_budget > 0),
  enforce_read_limit boolean not null default false
);
create table if not exists public.tenh_read_rate_windows (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  window_start timestamptz not null,
  requests bigint not null
);

alter table public.tenh_usage_daily enable row level security;
alter table public.tenh_usage_policies enable row level security;
alter table public.tenh_read_rate_windows enable row level security;
revoke all on public.tenh_usage_daily, public.tenh_usage_policies, public.tenh_read_rate_windows from anon, authenticated;
grant all on public.tenh_usage_daily, public.tenh_usage_policies, public.tenh_read_rate_windows to service_role;

create or replace function public.tenh_record_request_usage(
  p_business_id uuid, p_route text, p_database_requests bigint,
  p_database_bytes bigint, p_storage_bytes bigint, p_upload_bytes bigint
) returns void language sql security invoker set search_path = public as $$
  insert into public.tenh_usage_daily as totals
    (business_id, day, route, requests, database_requests, database_bytes, storage_bytes, upload_bytes)
  values (p_business_id, (now() at time zone 'UTC')::date, left(p_route, 160), 1,
    greatest(0,p_database_requests), greatest(0,p_database_bytes), greatest(0,p_storage_bytes), greatest(0,p_upload_bytes))
  on conflict (business_id, day, route) do update set
    requests = totals.requests + 1,
    database_requests = totals.database_requests + excluded.database_requests,
    database_bytes = totals.database_bytes + excluded.database_bytes,
    storage_bytes = totals.storage_bytes + excluded.storage_bytes,
    upload_bytes = totals.upload_bytes + excluded.upload_bytes;
$$;

-- Atomic, shared across server instances. Incoming webhooks/sending are never
-- rate limited here. A busy tenant cannot consume another tenant's allowance.
create or replace function public.tenh_check_read_budget(p_business_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  policy public.tenh_usage_policies;
  current_window timestamptz := date_trunc('minute', clock_timestamp());
  used bigint;
begin
  select * into policy from public.tenh_usage_policies where business_id = p_business_id;
  if not found or not policy.enforce_read_limit or policy.read_requests_per_minute is null then
    return jsonb_build_object('allowed', true, 'retryAfter', 0);
  end if;
  insert into public.tenh_read_rate_windows as windows (business_id, window_start, requests)
  values (p_business_id, current_window, 1)
  on conflict (business_id) do update set
    window_start = excluded.window_start,
    requests = case when windows.window_start = excluded.window_start then windows.requests + 1 else 1 end
  returning requests into used;
  return jsonb_build_object('allowed', used <= policy.read_requests_per_minute,
    'retryAfter', greatest(1,ceil(extract(epoch from current_window + interval '1 minute' - clock_timestamp()))::int));
end;
$$;

create or replace function public.tenh_usage_report(p_start date, p_end date, p_offset integer default 0)
returns table (business_id uuid, requests bigint, database_requests bigint, database_bytes bigint,
  storage_bytes bigint, upload_bytes bigint, observed_bytes_budget bigint, read_limit integer, enforced boolean)
language sql stable security invoker set search_path = public as $$
  select d.business_id, sum(d.requests)::bigint, sum(d.database_requests)::bigint,
    sum(d.database_bytes)::bigint, sum(d.storage_bytes)::bigint, sum(d.upload_bytes)::bigint,
    p.monthly_observed_bytes_budget, p.read_requests_per_minute, coalesce(p.enforce_read_limit,false)
  from public.tenh_usage_daily d left join public.tenh_usage_policies p on p.business_id=d.business_id
  where d.day >= p_start and d.day <= least(p_end, p_start + 31)
  group by d.business_id, p.monthly_observed_bytes_budget, p.read_requests_per_minute, p.enforce_read_limit
  order by sum(d.database_bytes)+sum(d.storage_bytes) desc, d.business_id
  limit 51 offset greatest(0,p_offset);
$$;

revoke all on function public.tenh_record_request_usage(uuid,text,bigint,bigint,bigint,bigint) from public, anon, authenticated;
revoke all on function public.tenh_check_read_budget(uuid) from public, anon, authenticated;
revoke all on function public.tenh_usage_report(date,date,integer) from public, anon, authenticated;
grant execute on function public.tenh_record_request_usage(uuid,text,bigint,bigint,bigint,bigint) to service_role;
grant execute on function public.tenh_check_read_budget(uuid) to service_role;
grant execute on function public.tenh_usage_report(date,date,integer) to service_role;
commit;
