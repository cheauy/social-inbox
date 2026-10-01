-- PROPOSAL: requires read-only dependency review and explicit grant approval.
-- Stores all twelve validated configurations; never activates a worker or sends.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '60s';
create table public.tenh_bot_rule_sets (
  business_id uuid not null references public.businesses(id),
  social_account_id uuid not null references public.social_accounts(id),
  rules jsonb not null default '[]' check(jsonb_typeof(rules)='array' and jsonb_array_length(rules)<=20),
  revision bigint not null default 1 check(revision>0),
  enabled boolean not null default false check(enabled=false),
  activated_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(business_id,social_account_id)
);
alter table public.tenh_bot_rule_sets enable row level security;
revoke all on public.tenh_bot_rule_sets from public,anon,authenticated;
grant select,insert,update on public.tenh_bot_rule_sets to service_role;
create function public.tenh_bot_save_rule_set(p_business uuid,p_channel uuid,p_revision bigint,p_rules jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare next_revision bigint;
begin
  if p_revision<0 or jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules)>20
    or octet_length(p_rules::text)>262144 then raise exception 'invalid_configuration'; end if;
  if not exists(select 1 from social_accounts where id=p_channel and business_id=p_business and is_active and platform='facebook')
    then raise exception 'invalid_channel'; end if;
  if exists(select 1 from jsonb_array_elements(p_rules) r where r->>'businessId' is distinct from p_business::text
    or r->>'channelId' is distinct from p_channel::text or r->>'mode' is distinct from 'draft')
    then raise exception 'invalid_scope'; end if;
  if p_revision=0 then
    insert into tenh_bot_rule_sets(business_id,social_account_id,rules) values(p_business,p_channel,p_rules)
      on conflict do nothing returning revision into next_revision;
  else
    update tenh_bot_rule_sets set rules=p_rules,revision=revision+1,updated_at=clock_timestamp()
      where business_id=p_business and social_account_id=p_channel and revision=p_revision and not enabled
      returning revision into next_revision;
  end if;
  return jsonb_build_object('saved',next_revision is not null,'revision',next_revision);
end $$;
revoke all on function public.tenh_bot_save_rule_set(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.tenh_bot_save_rule_set(uuid,uuid,bigint,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
