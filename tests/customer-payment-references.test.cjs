/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated PostgreSQL and synthetic UI/transports; no hosted data or provider requests.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require(process.env.TENH_PGLITE_MODULE || 'C:/Users/TUF/AppData/Local/Temp/tenh-branch-sql-check/node_modules/@electric-sql/pglite');
const { loader, database } = require('./tenh-seven/harness.cjs');
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client'), { JSDOM } = require('jsdom');
const migration = fs.readFileSync('db/migrations/20261017122923_customer_payment_references.sql', 'utf8');
const payment = (source = 'payway') => ({ source, paymentId: randomUUID() });

test('database claims are globally unique, stable, service-only and leave every original/provider field intact', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table billing_transactions(id uuid primary key, provider text, provider_transaction_id text, status text);
      create table manual_payment_requests(id uuid primary key, status text);
      create table manual_payment_uploads(id uuid primary key, state text);
      grant select on billing_transactions,manual_payment_requests,manual_payment_uploads to service_role;`);
    await db.exec(migration);
    const a = payment(), b = payment('manual'), c = payment('bakong');
    const providerId = 'FULL_ABA_1234567890';
    await db.query("insert into billing_transactions values($1,'payway',$2,'pending'),($3,'bakong','FULL_BAKONG_CORRELATION','pending')", [a.paymentId, providerId, c.paymentId]);
    await db.query("insert into manual_payment_uploads values($1,'prepared')", [b.paymentId]);
    const before = (await db.query('select * from billing_transactions order by id')).rows;
    const claim = async (...rows) => (await db.query('select * from tenh_claim_customer_payment_references($1::jsonb)', [JSON.stringify(rows)])).rows;
    assert.equal((await claim({ ...a, reference: 'T7K9M2XP' }))[0].reference, 'T7K9M2XP');
    assert.equal((await claim({ ...b, reference: 'T7K9M2XP' }))[0].outcome, 'collision');
    assert.equal((await claim({ ...b, reference: 'P6M4K8RT' }))[0].reference, 'P6M4K8RT');
    assert.equal((await claim({ ...a, reference: 'A2B3C4D5' }))[0].reference, 'T7K9M2XP');
    const retries = await Promise.all(Array.from({ length: 12 }, () => claim({ ...c, reference: 'M2N3P4R5' })));
    assert.ok(retries.every(rows => rows[0].reference === 'M2N3P4R5'));
    await db.query("insert into manual_payment_requests values($1,'submitted')", [b.paymentId]);
    await db.query('delete from manual_payment_uploads where id=$1', [b.paymentId]);
    assert.equal((await claim({ ...b, reference: 'A2B3C4D5' }))[0].reference, 'P6M4K8RT', 'prepared ticket and committed proof share the original payment ID');
    assert.equal((await claim({ ...a, source: 'bakong', reference: 'A2B3C4D5' }))[0].outcome, 'missing');
    assert.equal((await claim({ ...payment(), reference: 'A2B3C4D5' }))[0].outcome, 'missing');
    assert.deepEqual((await db.query('select * from billing_transactions order by id')).rows, before);
    assert.equal((await db.query('select count(*)::int n from customer_payment_references')).rows[0].n, 3);
    await assert.rejects(claim({ ...a, reference: 'T7K9M2XP_TOO_LONG' }));
    for (const role of ['anon', 'authenticated']) {
      const access = (await db.query(`select has_table_privilege($1,'public.customer_payment_references','select') as readable,
        has_table_privilege($1,'public.customer_payment_references','insert') as writable,
        has_function_privilege($1,'public.tenh_claim_customer_payment_references(jsonb)','execute') as callable`, [role])).rows[0];
      assert.deepEqual(access, { readable: false, writable: false, callable: false });
    }
    await db.exec('set role service_role');
    assert.equal((await claim({ ...a, reference: 'A2B3C4D5' }))[0].reference, 'T7K9M2XP');
    await assert.rejects(db.query("update customer_payment_references set reference='A2B3C4D5'"));
    await db.exec('reset role');
    // Rollback disables allocation without dropping the ledger or changing old application data.
    await db.exec('revoke execute on function tenh_claim_customer_payment_references(jsonb) from service_role');
    assert.equal((await db.query('select count(*)::int n from customer_payment_references')).rows[0].n, 3);
  } finally { await db.close(); }
});

function referenceService(rpc) {
  let randomCalls = 0;
  const load = loader({ 'node:crypto': { randomBytes: size => Buffer.alloc(size, randomCalls++ % 32) },
    '@/lib/supabase/admin': { supabaseAdmin: { rpc } } });
  return load('lib/billing/customer-payment-references.ts').getCustomerPaymentReferences;
}

test('server retries only collisions, preserves concurrent winners and never sends a provider ID as a short reference', async () => {
  const a = payment(), b = payment('manual'), calls = [];
  const get = referenceService(async (name, args) => {
    assert.equal(name, 'tenh_claim_customer_payment_references'); calls.push(args.p_candidates);
    return { data: args.p_candidates.map(row => ({ source_type: row.source, payment_id: row.paymentId,
      outcome: calls.length === 1 && row.paymentId === b.paymentId ? 'collision' : 'existing',
      reference: calls.length === 1 && row.paymentId === b.paymentId ? null : row.paymentId === a.paymentId ? 'T7K9M2XP' : 'P6M4K8RT' })), error: null };
  });
  const refs = await get([a, b, a]);
  assert.deepEqual([...refs.values()], ['T7K9M2XP', 'P6M4K8RT']);
  assert.equal(calls.length, 2); assert.equal(calls[0].length, 2); assert.equal(calls[1].length, 1);
  assert.equal(calls[1][0].paymentId, b.paymentId);
  assert.notEqual(calls[0][1].reference, calls[1][0].reference);
  for (const row of calls.flat()) assert.match(row.reference, /^[A-HJ-NP-Z2-9]{8}$/);
});

test('collision budget, missing records, unavailable migration and mismatched responses fail without changing payment state', async () => {
  const a = payment(); let calls = 0;
  const collision = referenceService(async (_name, args) => { calls++; return { data: args.p_candidates.map(row => ({ source_type: row.source, payment_id: row.paymentId, reference: null, outcome: 'collision' })) }; });
  assert.equal((await collision([a])).size, 0); assert.equal(calls, 8);
  for (const rpc of [async () => ({ error: { code: 'PGRST202' } }), async () => { throw Error('offline'); },
    async () => ({ data: [{ source_type: 'manual', payment_id: randomUUID(), reference: 'T7K9M2XP', outcome: 'existing' }] }),
    async () => ({ data: [{ source_type: a.source, payment_id: a.paymentId, reference: 'FULL_PROVIDER_ID', outcome: 'existing' }] })]) {
    assert.equal((await referenceService(rpc)([a])).size, 0);
  }
});

test('references are batched instead of one database call per history row', async () => {
  const sizes = [];
  const get = referenceService(async (_name, args) => { sizes.push(args.p_candidates.length); return { data: [] }; });
  await get(Array.from({ length: 601 }, () => payment()));
  assert.deepEqual(sizes, [600, 1]);
});

test('status API allocates only after active membership/permission and retains the full PayWay ID', async () => {
  const paymentId = randomUUID(), businessId = randomUUID(), providerId = 'ABA_FULL_1234567890';
  for (const denied of [false, true, 'signed-out']) {
    const db = database({ billing_transactions: [{ id: paymentId, business_id: businessId, provider: 'payway', provider_transaction_id: providerId, status: 'pending', plan_code: 'mini', billing_cycle: 'monthly', amount: 13, currency: 'USD' }],
      team_members: [{ id: randomUUID(), user_id: 'user', business_id: businessId, role: 'owner', is_active: true }], businesses: [{ id: businessId, name: 'Synthetic' }], tenh_billing_invoices: [], business_subscriptions: [], payment_cancellations: [] });
    const claims = [];
    db.rpc = async (name, args) => {
      if (name === 'tenh_claim_customer_payment_references') {
        claims.push(args.p_candidates);
        return { data: args.p_candidates.map(p => ({ source_type: p.source, payment_id: p.paymentId, reference: 'T7K9M2XP', outcome: 'existing' })), error: null };
      }
      assert.equal(name, 'tenh_get_billing_recovery_queue'); return { data: [], error: null };
    };
    const load = loader({ '@/lib/supabase/admin': { supabaseAdmin: db },
      '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: denied === 'signed-out' ? null : { id: 'user' } }, error: null }) } }) },
      '@/lib/auth/require-permission': { memberHasPermission: async () => !denied },
    });
    const response = await load('app/api/subscription/payment-status/route.ts').GET(new Request('https://fixture.invalid/api/subscription/payment-status?tran_id=' + providerId));
    const body = await response.json();
    if (denied) { assert.equal(response.status, denied === 'signed-out' ? 401 : 404); assert.deepEqual(claims, []); }
    else {
      assert.equal(response.status, 200); assert.equal(body.attempt.id, providerId); assert.equal(body.attempt.reference, providerId);
      assert.equal(body.attempt.customerReference, 'T7K9M2XP'); assert.equal(claims.length, 1);
      assert.equal(claims[0][0].paymentId, paymentId); assert.equal(db.tables.billing_transactions[0].provider_transaction_id, providerId);
    }
  }
});

test('customer UI displays and copies all eight characters, never a sliced provider ID, in English and Khmer', async () => {
  for (const language of ['en', 'km']) {
    const dom = new JSDOM('<div id="root"></div>'), previous = {}, copied = [];
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) { previous[key] = global[key]; global[key] = value; }
    const navigator = { clipboard: { writeText: async value => { copied.push(value); } } };
    const load = loader({ react: React, '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => language } }, { navigator });
    const { CustomerPaymentReference } = load('components/subscription/customer-payment-reference.tsx');
    const root = createRoot(dom.window.document.querySelector('#root'));
    try {
      await act(async () => root.render(React.createElement(CustomerPaymentReference, { value: 'T7K9M2XP' })));
      const ref = dom.window.document.querySelector('[data-payment-reference]');
      assert.equal(ref.textContent, 'T7K9M2XP'); assert.equal(ref.textContent.length, 8);
      assert.equal(ref.closest('.truncate,.text-ellipsis,.overflow-hidden'), null);
      await act(async () => dom.window.document.querySelector('button').click());
      assert.deepEqual(copied, ['T7K9M2XP']);
      navigator.clipboard.writeText = async () => { throw Error('clipboard blocked'); };
      await act(async () => dom.window.document.querySelector('button').click());
      assert.ok(dom.window.document.querySelector('[role="status"]')); assert.equal(ref.textContent, 'T7K9M2XP');
      await act(async () => root.render(React.createElement(CustomerPaymentReference, { value: 'FULL_ABA_1234567890' })));
      assert.equal(dom.window.document.querySelector('button'), null);
      assert.ok(!dom.window.document.body.textContent.includes('FULL_ABA')); assert.ok(!dom.window.document.body.textContent.includes('…'));
    } finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } }
  }
});

test('Super Admin waiting review uses Reference while review requests still send the original payment ID', async () => {
  const source = fs.readFileSync('components/billing/manual-payment-admin.tsx', 'utf8');
  assert.match(source, /Waiting review/); assert.ok(!source.includes('>Request</p>'));
  assert.match(source, /<CustomerPaymentReference value=\{selectedRow.customerReference\}/);
  assert.match(source, /requestId: row.id/);
});
