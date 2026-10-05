-- REVIEW PROPOSAL ONLY. Do not execute or include in any Billing installer.
-- Exact FKs/types/ACLs require Billing-owner schema capture and approval.
-- Separate KHQR state; no billing_transactions CHECK or PayWay/Manual changes.
-- No activation functions, grants or provider configuration are implemented here.
begin;

create schema tenh_khqr_private;
revoke all on schema tenh_khqr_private from public, anon, authenticated, service_role;

create table tenh_khqr_private.intents (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  requested_by_member_id uuid references public.team_members(id) on delete set null,
  requester_snapshot jsonb not null,
  environment text not null check (environment in ('mock', 'sit', 'production')),
  merchant_config_version text not null,
  receiver_account_id text not null,
  idempotency_key text not null check (length(idempotency_key) between 16 and 128),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  bill_number text not null unique check (length(bill_number) between 1 and 25),
  currency text not null check (currency in ('USD', 'KHR')),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  plan_code text not null,
  billing_cycle text not null,
  pricing_snapshot jsonb not null,
  subscription_baseline jsonb not null,
  qr_payload text not null,
  qr_md5 text not null check (qr_md5 ~ '^[a-f0-9]{32}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null default 'pending' check (state in ('pending', 'approved', 'recovery_required', 'cancelled')),
  activated_at timestamptz,
  invoice_id uuid unique,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check (case when state = 'approved' then activated_at is not null and invoice_id is not null
    else activated_at is null and invoice_id is null end),
  unique (business_id, environment, idempotency_key),
  unique (environment, qr_md5),
  unique (id, environment)
);
-- Database uniqueness arbitrates competing mock/real creators; all creation
-- still needs the SAME shared workspace lock/blocker used by PayWay/Manual.
create unique index khqr_one_unresolved_intent_per_business
  on tenh_khqr_private.intents(business_id)
  where state in ('pending', 'recovery_required');

create table tenh_khqr_private.payment_claims (
  environment text not null,
  transaction_hash text not null check (transaction_hash ~ '^[a-f0-9]{64}$'),
  intent_id uuid not null unique,
  receiver_account_id text not null,
  currency text not null check (currency in ('USD', 'KHR')),
  amount_minor bigint not null check (amount_minor > 0),
  observed_at timestamptz not null,
  authoritative_paid_at timestamptz,
  verified_contract_version text not null,
  primary key (environment, transaction_hash),
  foreign key (intent_id, environment) references tenh_khqr_private.intents(id, environment) on delete restrict
);
create table tenh_khqr_private.observations (
  id bigint generated always as identity primary key,
  intent_id uuid not null references tenh_khqr_private.intents(id) on delete restrict,
  observed_at timestamptz not null,
  outcome text not null,
  reason text,
  request_qr_md5 text not null check (request_qr_md5 ~ '^[a-f0-9]{32}$'),
  normalized_evidence jsonb not null
);

alter table tenh_khqr_private.intents enable row level security;
alter table tenh_khqr_private.payment_claims enable row level security;
alter table tenh_khqr_private.observations enable row level security;
revoke all on all tables in schema tenh_khqr_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema tenh_khqr_private from public, anon, authenticated, service_role;

-- Unimplemented review requirements: immutable intent identity/quote/QR guards;
-- append-only claims/observations; tenant-authorized service-only RPCs; matching
-- deployed workspace lock order; cross-provider creation/approval/retention guards;
-- shared verified quote and activation facade; atomic hash claim, entitlement,
-- approval and one invoice; invoice source extension to khqr without changing
-- existing PayWay/Manual behavior; deletion and authoritative reconciliation rules.
-- No default grants or policies may be added until those owners approve them.
-- A separately named migration must include native concurrency/rollback proof.
rollback;
