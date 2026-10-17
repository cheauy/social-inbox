-- Additive identity ledger only. No payment, provider identifier or entitlement changes.
begin;

create table public.customer_payment_references (
  source_type text not null check (source_type in ('manual', 'payway', 'bakong')),
  payment_id uuid not null,
  reference text not null unique check (reference ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (source_type, payment_id)
);
alter table public.customer_payment_references enable row level security;
revoke all on public.customer_payment_references from public, anon, authenticated;
grant select, insert on public.customer_payment_references to service_role;

-- Only the server proposes random candidates, after authorizing the original payment.
-- Existing rows are immutable and survive payment archival; retries return their saved reference.
create function public.tenh_claim_customer_payment_references(p_candidates jsonb)
returns table (source_type text, payment_id uuid, reference text, outcome text)
language plpgsql security invoker set search_path = '' as $$
declare
  v_item jsonb; v_source text; v_id uuid; v_candidate text; v_saved text;
begin
  if jsonb_typeof(p_candidates) is distinct from 'array' then
    raise exception 'Invalid payment reference batch' using errcode = '22023';
  end if;
  if jsonb_array_length(p_candidates) > 600 then
    raise exception 'Payment reference batch too large' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_candidates) loop
    v_source := v_item->>'source'; v_id := (v_item->>'paymentId')::uuid; v_candidate := v_item->>'reference';
    if v_source is null or v_source not in ('manual', 'payway', 'bakong') or v_id is null
       or v_candidate is null or v_candidate !~ '^[A-HJ-NP-Z2-9]{8}$' then
      raise exception 'Invalid payment reference candidate' using errcode = '22023';
    end if;
    source_type := v_source; payment_id := v_id;
    select r.reference into v_saved from public.customer_payment_references r
      where r.source_type = v_source and r.payment_id = v_id;
    if found then reference := v_saved; outcome := 'existing'; return next; continue; end if;
    if not ((v_source = 'manual' and (
        exists(select 1 from public.manual_payment_requests p where p.id = v_id) or
        exists(select 1 from public.manual_payment_uploads p where p.id = v_id))) or
      (v_source in ('payway', 'bakong') and exists(select 1 from public.billing_transactions p
        where p.id = v_id and p.provider = v_source))) then
      reference := null; outcome := 'missing'; return next; continue;
    end if;
    insert into public.customer_payment_references as r (source_type, payment_id, reference)
      values (v_source, v_id, v_candidate) on conflict do nothing returning r.reference into v_saved;
    if found then reference := v_saved; outcome := 'created'; return next; continue; end if;
    -- A competing request may have assigned this payment while our insert waited.
    select r.reference into v_saved from public.customer_payment_references r
      where r.source_type = v_source and r.payment_id = v_id;
    reference := v_saved; outcome := case when found then 'existing' else 'collision' end;
    return next;
  end loop;
end;
$$;
revoke all on function public.tenh_claim_customer_payment_references(jsonb) from public, anon, authenticated;
grant execute on function public.tenh_claim_customer_payment_references(jsonb) to service_role;
comment on table public.customer_payment_references is 'Customer-facing references, separate from immutable payment/provider identifiers. Never grants payment access.';
commit;
