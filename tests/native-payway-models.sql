-- SYNTHETIC activation models, not captured production function bodies.
-- The exact compatibility core is exercised unchanged. Native concurrency
-- results with these models alone do not certify production activation code.
create function native_fixture.issue_invoice() returns trigger
language plpgsql security definer set search_path=public as $$begin
 if new.status='approved' and old.status is distinct from 'approved' then
   insert into tenh_billing_invoices(business_id,source_type,source_payment_id,source_transaction_id,
     amount,currency,status,paid_at,period_start,period_end)
   values(new.business_id,case when tg_table_name='billing_transactions' then 'payway' else 'manual' end,
     new.id,case when tg_table_name='billing_transactions' then to_jsonb(new)->>'provider_transaction_id' else null end,
     new.amount,new.currency,'paid',now(),now(),now()+interval '1 month')
   on conflict(source_type,source_payment_id) do nothing;
 end if;
 return new;
end$$;
create trigger native_fixture_payway_invoice after update of status on public.billing_transactions
for each row execute function native_fixture.issue_invoice();
create trigger native_fixture_manual_invoice after update of status on public.manual_payment_requests
for each row execute function native_fixture.issue_invoice();

create function tenh_billing_private.activate_payway_v1(
 p_provider_transaction_id text,p_original_amount numeric,p_payment_amount numeric default null,
 p_payment_currency text default null,p_payment_status text default null,p_payment_status_code integer default null,
 p_approval_code text default null,p_provider_payload jsonb default '{}',p_callback_received boolean default false)
returns table(business_id uuid,plan_code text,subscription_status text,current_period_end timestamptz,
 member_limit integer,channel_limit integer,already_approved boolean)
language plpgsql security definer set search_path=public as $$begin
 raise exception 'Synthetic packet intentionally has no captured-v1 activation body.';
end$$;

create function tenh_billing_private.activate_payway_v2(
 p_provider_transaction_id text,p_original_amount numeric,p_payment_amount numeric default null,
 p_payment_currency text default null,p_payment_status text default null,p_payment_status_code integer default null,
 p_approval_code text default null,p_provider_payload jsonb default '{}',p_callback_received boolean default false)
returns table(business_id uuid,plan_code text,subscription_status text,current_period_end timestamptz,
 member_limit integer,channel_limit integer,already_approved boolean)
language plpgsql security definer set search_path=public as $$
declare b billing_transactions%rowtype;s business_subscriptions%rowtype;
begin
 -- Deliberately retains the legacy internal payment->subscription order.
 -- The public wrapper must already own both rows in subscription->payment order.
 perform pg_advisory_xact_lock(hashtext('tenh-payway-activate:'||p_provider_transaction_id));
 select * into b from billing_transactions t where t.provider_transaction_id=p_provider_transaction_id for update;
 select * into s from business_subscriptions x where x.business_id=b.business_id for update;
 if b.status<>'pending' or b.amount is distinct from p_original_amount then raise exception 'Synthetic activation rejected'; end if;
 update billing_transactions set status='approved',verified_at=now(),provider_status='APPROVED',provider_status_code='0',
   callback_received_at=case when p_callback_received then now() else callback_received_at end where id=b.id;
 update business_subscriptions x set status='active',plan_code=b.plan_code,billing_cycle=b.billing_cycle,
   current_period_start=now(),current_period_end=now()+interval '1 month',
   member_limit=b.target_member_limit,channel_limit=b.target_channel_limit,last_paid_amount=b.amount,
   last_paid_currency=b.currency,payment_provider='payway',updated_at=now()
 where x.business_id=b.business_id returning * into s;
 return query select s.business_id,s.plan_code,s.status,s.current_period_end,s.member_limit,s.channel_limit,false;
end$$;

create function tenh_billing_private.approve_manual_v2(
 p_request_id uuid,p_reviewed_by_user_id uuid default null,p_reviewed_by_email text default null,p_review_note text default null)
returns table(request_id uuid,business_id uuid,plan_code text,subscription_status text,current_period_end timestamptz,
 member_limit integer,channel_limit integer,already_approved boolean)
language plpgsql security definer set search_path=public as $$
declare m manual_payment_requests%rowtype;s business_subscriptions%rowtype;
begin
 select * into m from manual_payment_requests x where x.id=p_request_id for update;
 select * into s from business_subscriptions x where x.business_id=m.business_id for update;
 if m.status<>'submitted' then raise exception 'Synthetic manual activation rejected'; end if;
 update manual_payment_requests set status='approved',approved_at=now(),reviewed_at=now() where id=m.id;
 update business_subscriptions x set status='active',plan_code=m.plan_code,billing_cycle=m.billing_cycle,
   current_period_start=now(),current_period_end=now()+interval '1 month',
   member_limit=m.target_member_limit,channel_limit=m.target_channel_limit,last_paid_amount=m.amount,
   last_paid_currency=m.currency,payment_provider='manual',updated_at=now()
 where x.business_id=m.business_id returning * into s;
 return query select m.id,s.business_id,s.plan_code,s.status,s.current_period_end,s.member_limit,s.channel_limit,false;
end$$;
revoke all on all functions in schema tenh_billing_private from public,anon,authenticated,service_role;
