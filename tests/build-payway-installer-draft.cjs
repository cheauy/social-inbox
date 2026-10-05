// Mechanical draft assembly only. Never connects to a database.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const crypto = require('node:crypto');
const output = 'docs/sql/payway-combined-installer-draft.sql';
// Parent supplied authenticated read-only production captures on 2026-10-02.
// Fingerprints are change detectors, not installation approval or secrets.
const triggerPlaceholder = '65f3cac91e74c9bccee66866fd629b68';
const pricingAclPlaceholder = '791d2b1e22edbb03f97770724fbb588b';
const pricingAclFingerprintQuery = "select md5(coalesce(proacl::text,'<DEFAULT>')) from pg_proc where oid='public.tenh_custom_monthly_cents(integer,integer)'::regprocedure";
const triggerFingerprintQuery = `select md5(coalesce(string_agg(c.relname||':'||t.tgname||':'||t.tgenabled::text||':'||pg_get_triggerdef(t.oid), E'\\n' order by c.relname,t.tgname),''))
  from pg_trigger t join pg_class c on c.oid=t.tgrelid
  where not t.tgisinternal and c.relnamespace='public'::regnamespace
    and c.relname in ('billing_transactions','manual_payment_requests','business_subscriptions','tenh_billing_invoices')`;
function build() {
  const read = file => fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
  const captures = read('.codex/payway-production-ddl-review.sql') + '\n' + read('.codex/payway-original-capacity-pricing.sql');
  const functions = captures.match(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$function\$[\s\S]*?\$function\$/g);
  if (functions?.length !== 5) throw new Error('Expected five reviewed function captures.');
  const fingerprints = functions.map(fn => {
    const name = fn.match(/FUNCTION public\.(\w+)/)[1];
    const hash = crypto.createHash('md5').update(fn+'\n').digest('hex');
    return `('${name}','${hash}')`;
  }).join(',\n      ');
  const files = ['20261010_payway_single_pending_checkout.sql','20261012_custom_capacity_price_alignment.sql','20261011_custom_upgrade_optional_extension.sql'];
  const bodies = files.map(file => {
    let sql = read('db/migrations/'+file).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'');
    sql = sql.replace(/lock table public\.billing_transactions, public\.manual_payment_requests,\s*public\.business_subscriptions in share row exclusive mode;/i,'-- Outer NOWAIT locks already held.');
    if (/^\s*(begin|commit|rollback)\s*;/mi.test(sql)) throw new Error('Unexpected nested transaction boundary.');
    return `-- BEGIN REVIEWED BODY: ${file}\n${sql}\n-- END REVIEWED BODY: ${file}`;
  }).join('\n\n');
  return `-- GENERATED REVIEW DRAFT ONLY. NOT APPROVED FOR PRODUCTION EXECUTION.
-- Rebuild: node tests/build-payway-installer-draft.cjs
-- Trigger and pricing ACL fingerprints are pinned to authenticated read-only
-- production captures supplied by the parent on 2026-10-02. Independently review
-- those captures and this exact draft hash before installation; drift aborts.
-- Never substitute a newly observed mismatch merely to make installation pass.
-- No source bodies, payments, invoices, or historical pricing are exported here.
-- Run ONLY with a fail-fast SQL client (psql -X -v ON_ERROR_STOP=1 -f ...).
-- On ANY error: issue ROLLBACK on the same session, or close that session.
-- Never continue to COMMIT, retry individual bodies, or remove NOWAIT/timeouts.
-- Transaction abort immediately releases acquired locks; ROLLBACK clears the
-- failed transaction state. SET LOCAL timeouts revert on abort: the 15-second
-- idle timeout does NOT guarantee cleanup of an aborted session.
-- SQL Editor: submit this ENTIRE script once, only with verified request/backend
-- connection cleanup. A later editor ROLLBACK may run on a different backend
-- and therefore cannot be relied on to clean up the original failed session.
-- ALL known billing entry points should first be paused and in-flight writes drained.
-- NOWAIT is the enforceable contention gate, not a claim that traffic was paused.
-- Old-app Custom Upgrade inserts fail VERSION_REQUIRED after this commit until
-- the new app is deployed. Keep purchase creation paused across that brief window.
-- New-app/old-DB is unsupported. Verify installation before reopening billing.
-- Rollback is separately reviewed: drain v2 payments; mixed paid terms/old capacity
-- incompatibility prevent old-model rollback. Never rewrite saved payment records.
-- Functions are fingerprinted in full (pg_get_functiondef), not by a substring.
-- Freeze administrative/schema DDL during installation as well as billing traffic.
-- Pricing ACL fingerprint capture query (read only):
-- ${pricingAclFingerprintQuery};
-- Trigger fingerprint capture query (read only):
-- ${triggerFingerprintQuery.replace(/\n/g,'\n-- ')};

begin;
set local lock_timeout = '1s';
set local statement_timeout = '60s';
set local idle_in_transaction_session_timeout = '15s';
set local timezone = 'UTC';
-- Fixed order; a single statement either obtains the complete set or errors.
lock table public.billing_transactions, public.manual_payment_requests,
  public.business_subscriptions, public.tenh_billing_invoices
  in access exclusive mode nowait;

do $locked_preflight$
declare v_expected record; v_oid oid; v_actual text;
begin
  if current_user <> 'postgres' then raise exception 'Installer requires reviewed postgres role.'; end if;
  for v_expected in select * from (values
      ${fingerprints}
    ) as expected(name,fingerprint) loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=v_expected.name) <> 1 then
      raise exception 'Missing or overloaded reviewed function: %',v_expected.name;
    end if;
    select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=v_expected.name;
    if md5(replace(pg_get_functiondef(v_oid),chr(13),'')) <> v_expected.fingerprint then
      raise exception 'FULL function source fingerprint differs: %',v_expected.name;
    end if;
    if pg_get_userbyid((select proowner from pg_proc where oid=v_oid)) <> 'postgres' then
      raise exception 'Function ownership differs: %',v_expected.name;
    end if;
    if v_expected.name <> 'tenh_custom_monthly_cents' and (
      not (select prosecdef from pg_proc where oid=v_oid)
      or has_function_privilege('anon',v_oid,'EXECUTE')
      or has_function_privilege('authenticated',v_oid,'EXECUTE')
      or not has_function_privilege('service_role',v_oid,'EXECUTE')
      or (select count(*) from aclexplode(coalesce((select proacl from pg_proc where oid=v_oid),acldefault('f',(select proowner from pg_proc where oid=v_oid))))
          where privilege_type='EXECUTE' and (grantee not in ((select oid from pg_roles where rolname='postgres'),(select oid from pg_roles where rolname='service_role')) or is_grantable))>0
    ) then raise exception 'Function ACL differs: %',v_expected.name; end if;
    if v_expected.name='tenh_custom_monthly_cents' and (select prosecdef from pg_proc where oid=v_oid) then
      raise exception 'Pricing function must remain SECURITY INVOKER.';
    end if;
    if v_expected.name='tenh_custom_monthly_cents' and (
      '${pricingAclPlaceholder}' !~ '^[0-9a-f]{32}$'
      or (select md5(coalesce(proacl::text,'<DEFAULT>')) from pg_proc where oid=v_oid)<>'${pricingAclPlaceholder}') then
      raise exception 'Pricing ACL fingerprint missing or differs; stop for read-only capture/review.';
    end if;
  end loop;
  ${triggerFingerprintQuery} into v_actual;
  if '${triggerPlaceholder}' !~ '^[0-9a-f]{32}$' or v_actual <> '${triggerPlaceholder}' then
    raise exception 'Production trigger fingerprint missing or differs; stop for read-only capture/review.';
  end if;
  if exists(select 1 from public.billing_transactions where status='pending'
      and pricing_snapshot->>'purchase_type'='custom-upgrade'
      and (coalesce(pricing_snapshot->>'custom_upgrade_version','')<>'2' or coalesce(pricing_snapshot->>'paid_term_basis_version','')<>'1'))
    or exists(select 1 from public.manual_payment_requests where status in ('submitted','pending','draft')
      and pricing_snapshot->>'purchase_type'='custom-upgrade'
      and (coalesce(pricing_snapshot->>'custom_upgrade_version','')<>'2' or coalesce(pricing_snapshot->>'paid_term_basis_version','')<>'1')) then
    raise exception 'Drain unresolved legacy Custom Upgrade payments before installer.';
  end if;
  if exists(select 1 from public.business_subscriptions where plan_code='custom'
    and (channel_limit is null or member_limit is null or channel_limit not between 3 and 30 or member_limit not between 1 and 100)) then
    raise exception 'Existing Custom capacities require review before installer.';
  end if;
  if exists(select 1 from public.billing_transactions where provider='payway' and status='pending'
    group by business_id having count(*)>1) then raise exception 'Duplicate pending PayWay rows block installer.'; end if;
end;
$locked_preflight$;

${bodies}

commit;
`;
}
module.exports = {build,triggerPlaceholder,triggerFingerprintQuery,pricingAclPlaceholder,pricingAclFingerprintQuery};
if (require.main === module) fs.writeFileSync(output,build());
