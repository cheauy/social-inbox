/* eslint-disable @typescript-eslint/no-require-imports */
// In-memory route transport; no provider calls, hosted writes or financial cancellation.
const test = require('node:test'), assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');
const businessId = '00000000-0000-4000-8000-000000000002', transactionId = 'SAVED_123';
function fixture(options = {}) {
  const payment = { id: 'row', business_id: businessId, provider: 'payway', provider_transaction_id: transactionId,
    amount: 13, currency: 'USD', status: 'pending', metadata: { environment: 'sandbox', live_enabled: false, immutable: 'evidence' }, ...options.payment };
  const db = database({ team_members: [{ id: 'member', user_id: 'user', business_id: businessId, role: 'owner', is_active: true }], billing_transactions: [payment] });
  const original = db.from;
  let raced = false;
  db.from = name => {
    const query = original(name), eq = query.eq.bind(query), execute = query.execute.bind(query);
    query.eq = (key, value) => {
      if (key === 'metadata') { query.filters.push(row => JSON.stringify(row.metadata) === value); return query; }
      return eq(key, value);
    };
    query.execute = async () => {
      if (query.op === 'update' && !raced && options.race) { raced = true; options.race(db.tables.billing_transactions[0]); }
      return execute();
    };
    return query;
  };
  const load = loader({ '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: options.unauthenticated ? null : { id: 'user' } }, error: null }) } }) },
    '@/lib/auth/require-permission': { memberHasPermission: async () => !options.denied },
  }, { fetch: () => { throw new Error('Provider calls forbidden'); } });
  const route = load('app/api/payway/checkout-session/route.ts');
  return { db, payment, post: (body = {}, origin = 'https://fixture.invalid') => route.POST(new Request('https://fixture.invalid/api/payway/checkout-session', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true, transactionId, businessId, ...body }),
  })) };
}
test('Cancel persists an idempotent checkout-only session boundary while financial evidence is unchanged', async () => {
  const f = fixture(), before = structuredClone(f.db.tables.billing_transactions[0]);
  const response = await f.post(), result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.outcome, 'closed'); assert.equal(result.transactionId, transactionId);
  const saved = f.db.tables.billing_transactions[0], { checkout_session, ...metadata } = saved.metadata;
  assert.deepEqual({ ...saved, metadata }, before); assert.equal(checkout_session.closed_by_member_id, 'member');
  assert.equal(checkout_session.state, 'closed'); assert.ok(Number.isFinite(Date.parse(checkout_session.closed_at)));
  assert.deepEqual(await (await f.post()).json(), result);
  assert.equal(f.db.history.filter(x => x.op === 'update').length, 1);
  assert.ok(f.db.history.filter(x => x.op !== 'read').every(x => x.table === 'billing_transactions' && Object.keys(x.body).join() === 'metadata'));
});
test('origin, explicit intent, authentication and billing ownership guard closure without disclosing attempts', async () => {
  for (const [options, body, origin, status] of [[{}, {}, 'https://evil.invalid', 403], [{}, { confirmed: false }, undefined, 400],
    [{ unauthenticated: true }, {}, undefined, 401], [{ denied: true }, {}, undefined, 404], [{}, { businessId: '00000000-0000-4000-8000-000000000099' }, undefined, 404]]) {
    const f = fixture(options); assert.equal((await f.post(body, origin)).status, status);
    assert.ok(f.db.history.every(x => x.op === 'read'));
  }
});
test('paid precedence and a concurrent approval prevent any stale session write', async () => {
  for (const options of [{ payment: { status: 'approved' } }, { race: row => { row.status = 'approved'; row.metadata.approval = 'saved'; } }]) {
    const f = fixture(options), result = await (await f.post()).json(); assert.equal(result.outcome, 'paid');
    assert.equal(f.db.tables.billing_transactions[0].status, 'approved'); assert.equal(f.db.tables.billing_transactions[0].metadata.checkout_session, undefined);
  }
});
test('compare-and-swap retries concurrent observations without losing settlement evidence', async () => {
  const f = fixture({ race: row => { row.metadata.payway_last_verification = { payment_status: 'PENDING', reference: 'preserved' }; } });
  assert.equal((await (await f.post()).json()).outcome, 'closed');
  assert.equal(f.db.tables.billing_transactions[0].metadata.payway_last_verification.reference, 'preserved');
  assert.equal(f.db.tables.billing_transactions[0].status, 'pending');
});
test('unsupported metadata/session states and terminal financial outcomes fail closed', async () => {
  for (const payment of [{ metadata: [] }, { metadata: 'legacy-unknown' }, { metadata: { checkout_session: { version: 99 } } }, { status: 'recovery_required' }, { status: 'declined' }]) {
    const f = fixture({ payment }); assert.equal((await f.post()).status, 409); assert.ok(f.db.history.every(x => x.op === 'read'));
  }
});
test('a failed metadata write has no financial side effects and remains retryable', async () => {
  const f = fixture(); f.db.failures.push({ table: 'billing_transactions', op: 'update', once: true });
  assert.equal((await f.post()).status, 503); assert.equal(f.db.tables.billing_transactions[0].metadata.checkout_session, undefined);
  assert.equal((await (await f.post()).json()).outcome, 'closed');
});
