// Synthetic, in-memory PostgreSQL tests. No production connection or credentials.
// Uses an already-installed PGlite package; does not install dependencies.
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test harness, matching the existing tests. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loader } = require('./tenh-seven/harness.cjs');
const { PGlite } = require(process.env.TENH_PGLITE_MODULE ||
  'C:/Users/TUF/AppData/Local/Temp/tenh-branch-sql-check/node_modules/@electric-sql/pglite');
const read = name => fs.readFileSync(path.resolve(name), 'utf8');
const migrations = [
  'db/migrations/20261010_payway_single_pending_checkout.sql',
  'db/migrations/20261012_custom_capacity_price_alignment.sql',
  'db/migrations/20261011_custom_upgrade_optional_extension.sql',
];
const original = read('.codex/payway-production-ddl-review.sql');
const functions = original.match(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$function\$[\s\S]*?\$function\$/g);
const schema = `
create role anon; create role authenticated; create role service_role;
create table business_subscriptions (
 id uuid default gen_random_uuid(), business_id uuid primary key,
 plan_code text, status text, billing_cycle text, member_limit integer, channel_limit integer,
 current_period_start timestamptz, current_period_end timestamptz,
 last_paid_amount numeric, last_paid_currency text, pricing_version text, pricing_snapshot jsonb default '{}',
 payment_provider text, provider_customer_id text, provider_subscription_id text,
 cancel_at_period_end boolean default false, cancellation_requested_at timestamptz,
 cancellation_effective_at timestamptz, cancellation_requested_by_member_id uuid, cancellation_reason text,
 pending_plan_code text, pending_billing_cycle text, pending_plan_change_type text,
 pending_plan_requested_at timestamptz, pending_plan_effective_at timestamptz,
 pending_plan_requested_by_member_id uuid, suspended_at timestamptz, updated_at timestamptz,
 constraint business_subscriptions_custom_capacity_check check
 (plan_code <> 'custom' or (channel_limit between 1 and 30 and member_limit between 3 and 100))
);
create table billing_transactions (
 id uuid primary key default gen_random_uuid(), business_id uuid, provider text,
 provider_transaction_id text unique, plan_code text, billing_cycle text,
 amount numeric, currency text, status text, target_member_limit integer, target_channel_limit integer,
 renew_same boolean default false, pricing_version text, pricing_snapshot jsonb default '{}',
 metadata jsonb default '{}', requested_by_member_id uuid, created_at timestamptz default now(),
 callback_received_at timestamptz, verified_at timestamptz, provider_status_code text,
 provider_status text, provider_approval_code text, provider_original_amount numeric,
 provider_payment_amount numeric, provider_payment_currency text
);
create table manual_payment_requests (
 id uuid primary key default gen_random_uuid(), business_id uuid, plan_code text, billing_cycle text,
 amount numeric, currency text, status text, target_member_limit integer, target_channel_limit integer,
 renew_same boolean default false, pricing_version text, pricing_snapshot jsonb default '{}',
 requested_by_member_id uuid, reviewed_by_user_id uuid, reviewed_by_email text,
 reviewed_at timestamptz, review_note text, approved_at timestamptz, created_at timestamptz default now()
);
create table team_members (id uuid, user_id uuid, business_id uuid, full_name text, email text, role text, is_active boolean);
create table social_accounts (business_id uuid, is_active boolean);
create table businesses (id uuid, name text);
create table tenh_billing_invoices (
 id uuid primary key default gen_random_uuid(), invoice_number text, business_id uuid,
 source_type text, source_payment_id uuid, source_transaction_id text, workspace_name text,
 customer_name text, billing_email text, plan_code text, plan_name text, billing_cycle text,
 billing_cycle_label text, amount numeric, currency text, payment_method text, provider text,
 provider_approval_code text, status text, paid_at timestamptz, period_start timestamptz,
 period_end timestamptz, issued_at timestamptz, snapshot jsonb,
 unique(source_type,source_payment_id)
);
create function tenh_plan_rank(text) returns integer language sql immutable as
 $$select case $1 when 'mini' then 1 when 'standard' then 2 when 'pro' then 3 when 'custom' then 4 else 0 end$$;
create function tenh_plan_monthly_cents(text) returns integer language sql immutable as
 $$select case $1 when 'mini' then 1300 when 'standard' then 2500 when 'pro' then 5900 end$$;
create function tenh_plan_member_limit(text) returns integer language sql immutable as
 $$select case $1 when 'mini' then 1 when 'standard' then 3 when 'pro' then 8 end$$;
create function tenh_plan_channel_limit(text) returns integer language sql immutable as
 $$select case $1 when 'mini' then 3 when 'standard' then 5 when 'pro' then 12 end$$;
create function tenh_expected_subscription_cents(text,text,integer,integer) returns integer language plpgsql as
 $$begin return case when $1='custom' then tenh_custom_monthly_cents($3,$4) else tenh_plan_monthly_cents($1) end; end$$;
create function tenh_invoice_period_end(timestamptz,text) returns timestamptz language sql as
 $$select $1+make_interval(months=>case $2 when 'monthly' then 1 when '3-months' then 3 when '6-months' then 6 when '12-months' then 12 end)$$;
create function tenh_next_billing_invoice_number(timestamptz) returns text language sql as $$select gen_random_uuid()::text$$;
`;

async function setup(options = {}) {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(read('.codex/payway-original-capacity-pricing.sql') + ';');
  assert.equal(functions.length, 4);
  for (const fn of functions) await db.exec(fn + ';');
  const args = [
    'tenh_validate_plan_purchase()',
    'tenh_activate_verified_payway_payment(text,numeric,numeric,text,text,integer,text,jsonb,boolean)',
    'tenh_approve_manual_payment(uuid,uuid,text,text)',
    'tenh_issue_billing_invoice(text,uuid)',
  ];
  for (const name of args) await db.exec(`revoke all on function ${name} from public,anon,authenticated; grant execute on function ${name} to service_role;`);
  // Synthetic invoice trigger wiring calls the captured production invoice body.
  await db.exec(`create function fixture_invoice_trigger() returns trigger language plpgsql as $$begin
    if new.status='approved' and old.status is distinct from 'approved' then
      perform tenh_issue_billing_invoice(case when tg_table_name='billing_transactions' then 'payway' else 'manual' end,new.id);
    end if; return new; end$$;
    create trigger fixture_payway_invoice after update of status on billing_transactions for each row execute function fixture_invoice_trigger();
    create trigger fixture_manual_invoice after update of status on manual_payment_requests for each row execute function fixture_invoice_trigger();`);
  if (options.install !== false) for (const file of migrations) await db.exec(read(file));
  return db;
}

async function seed(db, patch = {}) {
  const businessId = (await db.query('select gen_random_uuid() as id')).rows[0].id;
  const now = new Date((await db.query('select clock_timestamp() as t')).rows[0].t);
  const start = new Date(now.getTime() - 15 * 86400000).toISOString();
  const end = new Date(now.getTime() + 15 * 86400000).toISOString();
  const subscription = { status: 'active', plan_code: 'mini', billing_cycle: 'monthly',
    member_limit: 1, channel_limit: 3, current_period_start: start,
    current_period_end: end, pricing_snapshot: {}, ...patch };
  await db.query(`insert into business_subscriptions(business_id,status,plan_code,billing_cycle,member_limit,channel_limit,current_period_start,current_period_end,pricing_snapshot)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [businessId, subscription.status, subscription.plan_code, subscription.billing_cycle,
    subscription.member_limit, subscription.channel_limit, subscription.current_period_start, subscription.current_period_end, subscription.pricing_snapshot]);
  return { businessId, subscription, now };
}

async function purchase(db, extension, options = {}) {
  const fixture = options.fixture || await seed(db);
  const cycle = extension && extension !== 'none' ? extension : fixture.subscription.billing_cycle;
  const { buildCustomUpgradeQuote } = loader()('lib/subscription/custom-upgrade.ts');
  const quote = buildCustomUpgradeQuote({ subscription: fixture.subscription,
    targetConnections: options.connections ?? 5, targetUsers: options.users ?? 3, targetBillingCycle: cycle,
    extensionBillingCycle: extension, now: fixture.now });
  const snapshot = { purchase_type: 'custom-upgrade', custom_upgrade_version: 2,
    quoted_at: quote.quotedAt, extension_billing_cycle: extension, ...options.snapshot };
  const manual = options.manual;
  const table = manual ? 'manual_payment_requests' : 'billing_transactions';
  const extraColumns = manual ? '' : ',provider,provider_transaction_id';
  const extraValues = manual ? '' : ",'payway',gen_random_uuid()::text";
  const result = await db.query(`insert into ${table}(business_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,pricing_snapshot${extraColumns})
    values($1,'custom',$2,$3,$4,$5,$7,$8,$6${extraValues}) returning *`,
  [fixture.businessId, cycle, Object.hasOwn(options,'amount') ? options.amount : quote.totalCents / 100, options.currency ?? 'USD', manual ? 'submitted' : 'pending', snapshot, options.users ?? 3, options.connections ?? 5]);
  return { ...fixture, quote, tx: result.rows[0], table };
}

async function activate(db, purchase, amount = purchase.tx.amount) {
  return purchase.table === 'manual_payment_requests'
    ? db.query('select * from tenh_approve_manual_payment($1)', [purchase.tx.id])
    : db.query("select * from tenh_activate_verified_payway_payment($1,$2,$2,'USD','APPROVED',0,'synthetic','{}',true)", [purchase.tx.provider_transaction_id, amount]);
}

test('isolated PostgreSQL billing migrations and captured activation functions', async t => {
  const db = await setup();
  try {
    await t.test('all three migrations rerun successfully', async () => {
      for (const file of migrations) await db.exec(read(file));
    });
    await t.test('database matches app at every published capacity', async () => {
      const { calculateCapacityMonthlyCents } = loader()('lib/subscription/plan-catalog.ts');
      const rows = (await db.query('select c,u,tenh_custom_monthly_cents(c,u) as price from generate_series(3,30)c cross join generate_series(1,100)u')).rows;
      assert.equal(rows.length, 2800);
      for (const row of rows) assert.equal(row.price, calculateCapacityMonthlyCents(row.c,row.u), `${row.c}/${row.u}`);
    });
    for (const manual of [false,true]) for (const extension of [null,'none','monthly','3-months','6-months','12-months']) {
      await t.test(`${manual ? 'manual' : 'payway'} ${extension ?? 'JSON null'} activates once with correct invoice period`, async () => {
        const p = await purchase(db,extension,{manual});
        assert.equal(p.tx.pricing_snapshot.extension_months,p.quote.extensionMonths);
        assert.equal(p.tx.pricing_snapshot.total_cents,p.quote.totalCents);
        const first = (await activate(db,p)).rows[0];
        assert.equal(new Date(first.current_period_end).toISOString(),p.quote.newPeriodEnd);
        assert.equal(first.already_approved,false);
        assert.equal((await activate(db,p)).rows[0].already_approved,true);
        const invoices = (await db.query('select * from tenh_billing_invoices where source_payment_id=$1',[p.tx.id])).rows;
        assert.equal(invoices.length,1);
        assert.equal(new Date(invoices[0].period_end).toISOString(),p.quote.newPeriodEnd);
      });
    }
    await t.test('wrong quoted amount fails before payment insert', async () => {
      await assert.rejects(()=>purchase(db,'monthly',{amount:1}),/amount mismatch/);
    });
    await t.test('unversioned extension then capacity-only history cannot invent a single paid term', async () => {
      const fixture = await seed(db, {plan_code:'custom', billing_cycle:'3-months', member_limit:3, channel_limit:5,
        pricing_snapshot:{purchase_type:'custom-upgrade', extension_months:1}});
      // Legacy capacity-only approval overwrote the extension marker and had
      // no lineage segments. The next quote must not assume a single 3-month term.
      fixture.subscription.pricing_snapshot={purchase_type:'custom-upgrade',extension_months:0};
      await db.query('update business_subscriptions set pricing_snapshot=$2 where business_id=$1',
        [fixture.businessId,fixture.subscription.pricing_snapshot]);
      await assert.rejects(() => purchase(db,'none',{fixture,connections:6}), /combined paid terms/);
      await assert.rejects(() => db.query(`insert into billing_transactions
        (business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,target_member_limit,target_channel_limit,pricing_snapshot)
        values($1,'payway',gen_random_uuid()::text,'custom','3-months',1,'USD','pending',3,6,$2)`,
        [fixture.businessId,{purchase_type:'custom-upgrade',custom_upgrade_version:2,quoted_at:fixture.now.toISOString(),extension_billing_cycle:'none'}]), /authoritative segment pricing/);
    });
    for (const zone of ['UTC','Asia/Phnom_Penh','America/New_York']) for (const manual of [false,true]) {
      await t.test(`${manual?'manual':'payway'} UTC month-end extension under ${zone}`, async () => {
        await db.exec(`set timezone = '${zone}'`);
        try {
          const fixture = await seed(db,{current_period_start:'2026-01-30T20:00:00.000Z',current_period_end:'2027-01-30T20:00:00.000Z',billing_cycle:'12-months'});
          const p = await purchase(db,'monthly',{fixture,manual});
          assert.equal(p.quote.newPeriodEnd,'2027-02-28T20:00:00.000Z');
          assert.equal(new Date(p.tx.pricing_snapshot.new_period_end).toISOString(),p.quote.newPeriodEnd);
          // Approval is a later request and may use a different pooled session.
          await db.exec(`set timezone = '${zone === 'UTC' ? 'Asia/Phnom_Penh' : 'UTC'}'`);
          assert.equal(new Date((await activate(db,p)).rows[0].current_period_end).toISOString(),p.quote.newPeriodEnd);
          assert.equal(new Date((await db.query('select period_end from tenh_billing_invoices where source_payment_id=$1',[p.tx.id])).rows[0].period_end).toISOString(),p.quote.newPeriodEnd);
        } finally { await db.exec("set timezone = 'UTC'"); }
      });
    }
    for (const manual of [false,true]) await t.test(`${manual?'manual':'payway'} annual-plus-monthly basis survives another capacity upgrade`,async()=>{
      const instant=new Date((await db.query('select clock_timestamp() as t')).rows[0].t);
      const fixture=await seed(db,{billing_cycle:'12-months',
        current_period_start:new Date(instant.getTime()-180*86400000).toISOString(),
        current_period_end:new Date(instant.getTime()+185*86400000).toISOString()});
      const first=await purchase(db,'monthly',{fixture,manual});
      await activate(db,first);
      const stored=(await db.query('select * from business_subscriptions where business_id=$1',[fixture.businessId])).rows[0];
      assert.equal(stored.pricing_snapshot.paid_term_basis_version,1);
      const segments=stored.pricing_snapshot.paid_term_segments;
      assert.equal(segments.length,2);
      assert.equal(segments[0].months,12);
      assert.equal(segments[0].discount_basis_points,2000);
      assert.equal(segments[1].months,1);
      assert.equal(segments[1].discount_basis_points,0);
      assert.equal(segments[1].source_payment_id,first.tx.id);
      const repeatFixture={businessId:fixture.businessId,
        now:new Date((await db.query('select clock_timestamp() as t')).rows[0].t),
        subscription:{...stored,current_period_start:new Date(stored.current_period_start).toISOString(),current_period_end:new Date(stored.current_period_end).toISOString()}};
      const repeat=await purchase(db,'none',{fixture:repeatFixture,manual,connections:6});
      const annualRemaining=(Date.parse(segments[0].end_at)-repeatFixture.now.getTime())/(Date.parse(segments[0].end_at)-Date.parse(segments[0].start_at));
      assert.equal(repeat.quote.capacityProrationCents,Math.round(400*12*0.8*annualRemaining)+400);
      const activated=(await activate(db,repeat)).rows[0];
      assert.equal(new Date(activated.current_period_end).toISOString(),repeatFixture.subscription.current_period_end);
      const final=(await db.query('select pricing_snapshot from business_subscriptions where business_id=$1',[fixture.businessId])).rows[0];
      assert.deepEqual(final.pricing_snapshot.paid_term_segments,segments);
    });
    await t.test('wrong original approved amount leaves payment pending', async () => {
      const p=await purchase(db,'monthly');
      await assert.rejects(()=>activate(db,p,1),/amount mismatch/);
      assert.equal((await db.query('select status from billing_transactions where id=$1',[p.tx.id])).rows[0].status,'pending');
    });
    await t.test('non-USD quote is rejected',async()=>{
      await assert.rejects(()=>purchase(db,'monthly',{currency:'KHR'}),/currency/i);
    });
    await t.test('fractional cents and null amounts are rejected',async()=>{
      await assert.rejects(()=>purchase(db,'monthly',{amount:31.001}),/two decimals/);
      await assert.rejects(()=>purchase(db,'monthly',{amount:null}),/two decimals/);
    });
    for (const manual of [false,true]) await t.test(`${manual?'manual':'payway'} stale baseline leaves payment and invoice unchanged`,async()=>{
      const p=await purchase(db,'monthly',{manual});
      await db.query('update business_subscriptions set channel_limit=4 where business_id=$1',[p.businessId]);
      await assert.rejects(()=>activate(db,p),/changed after/);
      assert.equal((await db.query(`select status from ${p.table} where id=$1`,[p.tx.id])).rows[0].status,manual?'submitted':'pending');
      assert.equal((await db.query('select count(*)::int as n from tenh_billing_invoices where source_payment_id=$1',[p.tx.id])).rows[0].n,0);
    });
    await t.test('scheduled cancellation and downgrade block SQL purchase before insert',async()=>{
      for(const change of ["cancel_at_period_end=true","pending_plan_change_type='downgrade'"]){
        const fixture=await seed(db);
        await db.query(`update business_subscriptions set ${change} where business_id=$1`,[fixture.businessId]);
        await assert.rejects(()=>purchase(db,'monthly',{fixture}),/scheduled subscription change/);
      }
    });
    for(const manual of [false,true]) await t.test(`${manual?'manual':'payway'} scheduled change after quote remains intact when approval is blocked`,async()=>{
      const p=await purchase(db,'monthly',{manual});
      await db.query("update business_subscriptions set cancel_at_period_end=true,pending_plan_change_type='downgrade' where business_id=$1",[p.businessId]);
      await assert.rejects(()=>activate(db,p),/changed after/);
      const row=(await db.query('select cancel_at_period_end,pending_plan_change_type from business_subscriptions where business_id=$1',[p.businessId])).rows[0];
      assert.equal(row.cancel_at_period_end,true); assert.equal(row.pending_plan_change_type,'downgrade');
    });
    await t.test('legacy and expired quotes fail closed',async()=>{
      await assert.rejects(()=>purchase(db,'monthly',{snapshot:{custom_upgrade_version:null}}),/Refresh checkout/);
      await assert.rejects(()=>purchase(db,'monthly',{snapshot:{quoted_at:'2000-01-01T00:00:00Z'}}),/expired/);
      await assert.rejects(()=>purchase(db,'monthly',{snapshot:{extension_billing_cycle:'2-months'}}),/duration is invalid/);
    });
    await t.test('database uses the bound quote instant rather than a later clock value',async()=>{
      const instant=new Date((await db.query('select clock_timestamp() as t')).rows[0].t);
      const fixture=await seed(db,{
        current_period_start:new Date(instant.getTime()-5000).toISOString(),
        current_period_end:new Date(instant.getTime()+5000).toISOString(),
      });
      fixture.now=new Date(instant.getTime()-2000);
      const p=await purchase(db,'monthly',{fixture});
      assert.equal(p.quote.capacityProrationCents,840);
      assert.equal(p.tx.pricing_snapshot.capacity_proration_cents,840);
    });
    await t.test('single pending index rejects duplicate checkout',async()=>{
      const p=await purchase(db,'monthly');
      await assert.rejects(()=>purchase(db,'monthly',{fixture:p}),/duplicate key/);
    });
    await t.test('new privileged functions deny anonymous and authenticated execution',async()=>{
      const rows=(await db.query(`select proname,pg_get_userbyid(proowner) as owner,
        has_function_privilege('anon',oid,'EXECUTE') as anon,
        has_function_privilege('authenticated',oid,'EXECUTE') as authenticated,
        has_function_privilege('service_role',oid,'EXECUTE') as service
        from pg_proc where proname in ('tenh_validate_custom_upgrade_purchase','tenh_guard_custom_upgrade_approval','tenh_set_custom_upgrade_invoice_period')`)).rows;
      assert.equal(rows.length,3);
      for(const row of rows){ assert.equal(row.owner,'postgres'); assert.equal(row.anon,false); assert.equal(row.authenticated,false); assert.equal(row.service,true); }
    });
    await t.test('legacy pending payment blocks migration and approval without fabricated baseline',async()=>{
      const fixture=await seed(db);
      await db.exec('alter table billing_transactions disable trigger tenh_validate_payway_custom_upgrade');
      const p=await purchase(db,'monthly',{fixture,snapshot:{custom_upgrade_version:null,extension_months:1}});
      await db.exec('alter table billing_transactions enable trigger tenh_validate_payway_custom_upgrade');
      await assert.rejects(()=>activate(db,p),/Legacy Custom Upgrade/);
      await assert.rejects(()=>db.exec(read(migrations[2])),/Drain unresolved legacy/);
      await db.exec('rollback');
      assert.equal((await db.query('select status from billing_transactions where id=$1',[p.tx.id])).rows[0].status,'pending');
    });
    await t.test('aligned capacity constraint rejects invalid connection minimum',async()=>{
      await assert.rejects(()=>seed(db,{plan_code:'custom',member_limit:3,channel_limit:2}),/check constraint/);
    });
    await t.test('clean rollback restores old triggers and constraint',async()=>{
      const clean=await setup();
      try { await clean.exec(read('docs/sql/payway-optional-extension-rollback.sql'));
        assert.equal((await clean.query("select count(*)::int as n from pg_trigger where tgname like 'tenh_validate_%custom_upgrade'")).rows[0].n,0);
        await seed(clean,{plan_code:'custom',member_limit:3,channel_limit:2});
        await assert.rejects(()=>clean.exec(read(migrations[2])),/capacities require review/);
        await clean.exec('rollback');
      } finally {await clean.close();}
    });
    await t.test('rollback refuses active mixed terms even after its payment is approved',async()=>{
      const clean=await setup();
      try {
        const p=await purchase(clean,'monthly'); await activate(clean,p);
        await assert.rejects(()=>clean.exec(read('docs/sql/payway-optional-extension-rollback.sql')),/Active mixed paid terms/);
        await clean.exec('rollback');
      } finally { await clean.close(); }
    });
    await t.test('rollback refuses unresolved v2 payments',async()=>{
      await assert.rejects(()=>db.exec(read('docs/sql/payway-optional-extension-rollback.sql')),/Drain version 2/);
      await db.exec('rollback');
    });
  } finally { await db.close(); }
});

test('combined installer draft is atomic and fails closed on reviewed baseline drift', async t => {
  const {build,triggerPlaceholder,triggerFingerprintQuery,pricingAclPlaceholder,pricingAclFingerprintQuery} = require('./build-payway-installer-draft.cjs');
  const draft = build();
  assert.equal(read('docs/sql/payway-combined-installer-draft.sql'),draft);
  assert.equal((draft.match(/^begin;$/gm)||[]).length,1);
  assert.equal((draft.match(/^commit;$/gm)||[]).length,1);
  assert.match(draft,/in access exclusive mode nowait;/);
  assert.doesNotMatch(draft,/in share row exclusive mode;/i);
  for (const scenario of ['production-baseline-mismatch','missing-capture','missing-pricing-acl','success','source','acl','pricing-acl','trigger','legacy','capacity','duplicate','late-failure']) {
    await t.test(scenario, async () => {
      const db = await setup({install:false});
      try {
        const expectedTriggerHash = (await db.query(triggerFingerprintQuery)).rows[0].md5;
        const expectedPricingAclHash = (await db.query(pricingAclFingerprintQuery)).rows[0].md5;
        // Only isolated fixture copies get synthetic baselines. The checked-in
        // installer retains the production capture and must reject this fixture.
        let sql = draft;
        if(scenario!=='production-baseline-mismatch') {
          sql=sql.replaceAll(pricingAclPlaceholder,scenario==='missing-pricing-acl'?'NOT_CAPTURED':expectedPricingAclHash);
          sql=sql.replaceAll(triggerPlaceholder,scenario==='missing-capture'?'NOT_CAPTURED':expectedTriggerHash);
        }
        if (scenario==='source') await db.exec(functions[0].replace('PayWay transaction ID is required.','Unexpected reviewed source drift.')+';');
        if (scenario==='acl') await db.exec('grant execute on function tenh_approve_manual_payment(uuid,uuid,text,text) to authenticated;');
        if (scenario==='pricing-acl') await db.exec('revoke execute on function tenh_custom_monthly_cents(integer,integer) from public;');
        if (scenario==='trigger') await db.exec('alter table billing_transactions disable trigger fixture_payway_invoice;');
        if (scenario==='capacity') await seed(db,{plan_code:'custom',channel_limit:2,member_limit:3});
        if (scenario==='legacy' || scenario==='duplicate') {
          const {businessId} = await seed(db);
          const snapshot = scenario==='legacy' ? {purchase_type:'custom-upgrade'} : {};
          for(let i=0;i<(scenario==='duplicate'?2:1);i++) await db.query(`insert into billing_transactions
            (business_id,provider,provider_transaction_id,status,pricing_snapshot) values($1,'payway',gen_random_uuid()::text,'pending',$2)`,[businessId,snapshot]);
        }
        if(scenario==='late-failure') sql=sql.replace(/\ncommit;\n$/,"\nselect 1/0;\ncommit;\n");
        const pricingBefore=(await db.query("select pg_get_functiondef('tenh_custom_monthly_cents(integer,integer)'::regprocedure) as definition")).rows[0].definition;
        if(scenario==='success') {
          await db.exec(sql);
          const p=await purchase(db,'monthly');
          await activate(db,p);
          assert.equal((await db.query('select count(*)::int as n from tenh_billing_invoices where source_payment_id=$1',[p.tx.id])).rows[0].n,1);
        } else {
          const errors={ 'production-baseline-mismatch':/fingerprint missing or differs/,'missing-capture':/trigger fingerprint missing/,'missing-pricing-acl':/Pricing ACL fingerprint missing/,source:/FULL function source/,acl:/ACL differs/,'pricing-acl':/Pricing ACL fingerprint missing/,trigger:/trigger fingerprint missing/,legacy:/Drain unresolved legacy/,capacity:/capacities require review/,duplicate:/Duplicate pending/, 'late-failure':/division by zero/ };
          await assert.rejects(()=>db.exec(sql),errors[scenario]);
          // Explicit same-session rollback releases every partial lock/change.
          await db.exec('rollback');
          assert.equal((await db.query("select pg_get_functiondef('tenh_custom_monthly_cents(integer,integer)'::regprocedure) as definition")).rows[0].definition,pricingBefore);
          assert.equal((await db.query("select to_regclass('billing_transactions_one_pending_payway_per_business_idx') as index")).rows[0].index,null);
          assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgname='tenh_validate_payway_custom_upgrade'")).rows[0].n,0);
        }
      } finally {await db.close();}
    });
  }
});
