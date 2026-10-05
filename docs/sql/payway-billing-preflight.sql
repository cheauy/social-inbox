-- READ ONLY. Resolve every returned blocker before approved installation.
-- COORDINATED ROLLOUT (requires the separately reviewed SQL approval):
-- 1. Build/review the new app and all three migrations. Keep live money disabled.
-- 2. Pause creation of Custom Upgrade checkouts and manual submissions in a
--    maintenance window; allow existing provider verification/admin review.
-- 3. Run these reads. Drain all legacy pending/submitted upgrades through the
--    existing flow. A paid stale/late payment requires explicit recovery;
--    never fabricate baseline fields, cancel it blindly, or rewrite pricing.
-- 4. Quiesce ALL billing writes: new checkouts, callbacks/status finalization,
--    scheduled recovery jobs, subscription lifecycle jobs, manual approvals
--    and subscription changes. Wait for in-flight DB transactions to finish.
--    Queue callback delivery for retry; do not discard payment notifications.
--    The SHARE ROW EXCLUSIVE locks alone DO NOT prevent RPC/DDL deadlocks.
--    Verify no active billing writer sessions remain using approved read-only
--    database inspection. If quiescence cannot be demonstrated, stop installation.
-- 5. With zero legacy blockers, apply approved migrations 20261010,
--    20261012 (price alignment), then 20261011 (optional extension).
--    The transaction locks repeat the drain checks atomically.
--    Old app Custom Upgrade inserts now fail closed with VERSION_REQUIRED.
-- 6. Deploy the reviewed v2 app with new checkout creation still paused.
--    New app/old DB is unsupported; do not deploy v2 before its migration.
-- 7. Verify all three installed definitions, pricing grid parity, ownership/
--    grants/indexes/triggers, and the versioned app contract BEFORE reopening.
--    Run version-2 inserts, null/none extension, stale rejection, invoice periods,
--    duplicate activation and authorized saved-transaction returns in an isolated
--    database/sandbox. Reopen activation/recovery writes and replay queued
--    callbacks; then reopen new checkout creation after verification passes.
-- ROLLBACK: pause creation, drain unresolved v2 payments under v2 rules,
-- quiesce ALL billing writes as above, review
-- docs/sql/payway-optional-extension-rollback.sql, then restore the old app.
-- Restore the original pricing definition from
-- .codex/payway-original-capacity-pricing.sql only after separately draining
-- ALL pending payments priced under 20261012. Never rewrite saved payment prices.
-- Do not roll back the single-pending index without separate review.
-- Production DDL reference: .codex/payway-production-ddl-review.sql (private).
-- Isolated SQL validation uses the existing PGlite v0.5.8 installation at
-- C:/Users/TUF/AppData/Local/Temp/tenh-branch-sql-check/node_modules/@electric-sql/pglite.
-- Run: node --test tests/payway-sql-isolated.test.cjs
-- This executes real PostgreSQL functions against synthetic in-memory tables
-- and captured production function bodies; helper functions and invoice trigger
-- wiring are fixtures. It does not prove native multi-session lock/concurrency
-- behavior, production schema parity, or merchant approval/settlement.
select 'payway' as source, status, count(*) as unresolved_legacy_custom_upgrades
from public.billing_transactions
where status='pending' and pricing_snapshot->>'purchase_type'='custom-upgrade'
  and (coalesce(pricing_snapshot->>'custom_upgrade_version','') <> '2'
    or coalesce(pricing_snapshot->>'paid_term_basis_version','') <> '1')
group by status
union all
select 'manual', status, count(*) from public.manual_payment_requests
where status in ('submitted','pending','draft')
  and pricing_snapshot->>'purchase_type'='custom-upgrade'
  and (coalesce(pricing_snapshot->>'custom_upgrade_version','') <> '2'
    or coalesce(pricing_snapshot->>'paid_term_basis_version','') <> '1')
group by status;

select count(*) as custom_capacity_constraint_blockers
from public.business_subscriptions where plan_code='custom'
and (channel_limit is null or member_limit is null
  or channel_limit not between 3 and 30 or member_limit not between 1 and 100);

select count(*) as workspaces_with_duplicate_pending_payway
from (select business_id from public.billing_transactions
  where provider='payway' and status='pending' group by business_id having count(*)>1) duplicates;

select p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('tenh_validate_plan_purchase',
  'tenh_activate_verified_payway_payment','tenh_approve_manual_payment','tenh_issue_billing_invoice');

select c.relname, t.tgname, pg_get_triggerdef(t.oid)
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where not t.tgisinternal and c.relnamespace='public'::regnamespace
and c.relname in ('billing_transactions','manual_payment_requests','tenh_billing_invoices');
