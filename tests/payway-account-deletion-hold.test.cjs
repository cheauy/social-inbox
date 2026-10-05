/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS node:test harness. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader } = require('./tenh-seven/harness.cjs');
const { setup, seed } = require('./payway-compat-fixture.cjs');

function routeHarness({ reply = { data: { held: true }, error: null }, authenticated = true } = {}) {
  const calls = [];
  const forbidden = () => { calls.push({ mutation: true }); throw Error('Deletion reached a forbidden operation'); };
  const load = loader({
    'next/server': { NextResponse: { json: (data, init = {}) => new Response(JSON.stringify(data), {
      status: init.status || 200, headers: { 'Content-Type': 'application/json', ...init.headers },
    }) } },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'authenticated-user' } : null }, error: null }) } }) },
    '@/lib/supabase/admin': { supabaseAdmin: {
      rpc: async (name, args) => { calls.push({ name, args: JSON.parse(JSON.stringify(args)) }); return reply; },
      from: forbidden, auth: { admin: { deleteUser: forbidden } },
    } },
    '@/lib/channels/channel-token-crypto': { decryptChannelCredential: forbidden },
    '@/lib/facebook/facebook-token-crypto': { decryptFacebookToken: forbidden },
    '@/lib/telegram/telegram-api': { deleteTelegramWebhook: forbidden },
  });
  return { route: load('app/api/account/delete/route.ts'), calls };
}

for (const method of ['GET', 'DELETE']) {
  for (const [label, reply, status, code] of [
    ['retention hold', { data: { held: true }, error: null }, 409, 'TENH_BILLING_RECOVERY_REQUIRED'],
    ['RPC error', { data: null, error: { message: 'unavailable' } }, 503, 'TENH_BILLING_HOLD_CHECK_UNAVAILABLE'],
    ['malformed reply', { data: { held: 'false' }, error: null }, 503, 'TENH_BILLING_HOLD_CHECK_UNAVAILABLE'],
    ['missing reply', { data: null, error: null }, 503, 'TENH_BILLING_HOLD_CHECK_UNAVAILABLE'],
  ]) test(`${method} stops before impact reads, ownership staging or Auth deletion: ${label}`, async () => {
    const h = routeHarness({ reply });
    const request = new Request('https://synthetic.invalid/api/account/delete', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT', understood: true,
        userId: 'untrusted-body-user', ownerDecision: 'delete_subscriptions', deleteSubscriptionsConfirmed: true }),
    });
    const response = await h.route[method](request);
    assert.equal(response.status, status); assert.equal((await response.json()).code, code);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(h.calls, [{ name: 'tenh_get_account_deletion_billing_hold', args: { p_user_id: 'authenticated-user' } }]);
  });
  test(`${method} rejects an unauthenticated request before the retention RPC`, async () => {
    const h = routeHarness({ authenticated: false });
    const response = await h.route[method](new Request('https://synthetic.invalid/api/account/delete', {
      method: 'DELETE', body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT', understood: true }),
    }));
    assert.equal(response.status, 401); assert.deepEqual(h.calls, []);
  });
}

test('no hold allows the existing read-only account impact preflight', async () => {
  let reads = 0;
  const load = loader({
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } }, error: null }) } }) },
    '@/lib/supabase/admin': { supabaseAdmin: {
      rpc: async () => ({ data: { held: false }, error: null }),
      from: () => { reads++; return { select() { return this; }, eq: async () => ({ data: [], error: null }) }; },
    } },
    '@/lib/channels/channel-token-crypto': { decryptChannelCredential() {} },
    '@/lib/facebook/facebook-token-crypto': { decryptFacebookToken() {} },
    '@/lib/telegram/telegram-api': { deleteTelegramWebhook() {} },
  });
  const response = await load('app/api/account/delete/route.ts').GET();
  assert.equal(response.status, 200); assert.equal((await response.json()).impact.canDelete, true); assert.equal(reads, 1);
});

test('SQL hold includes inactive requester/owner, survives resolution, and restricts access', async () => {
  const db = await setup({ install: false });
  try {
    const fixture = await seed(db);
    await db.exec(fs.readFileSync('tests/fixtures/payway-legacy-coexistence-core.sql', 'utf8'));
    const users = (await db.query('select gen_random_uuid() as requester,gen_random_uuid() as owner,gen_random_uuid() as member,gen_random_uuid() as outsider')).rows[0];
    const requester = (await db.query("insert into team_members(id,user_id,business_id,role,is_active) values(gen_random_uuid(),$1,$2,'agent',false) returning id", [users.requester, fixture.businessId])).rows[0].id;
    for (const [user, role] of [[users.owner, 'owner'], [users.member, 'agent']]) await db.query('insert into team_members(id,user_id,business_id,role,is_active) values(gen_random_uuid(),$1,$2,$3,false)', [user, fixture.businessId, role]);
    await db.exec("set session_replication_role='replica'");
    const row = (await db.query("insert into billing_transactions(business_id,provider,provider_transaction_id,plan_code,billing_cycle,amount,currency,status,requested_by_member_id) values($1,'payway','synthetic-retained-payment','mini','monthly',12,'USD','pending',$2) returning *", [fixture.businessId, requester])).rows[0];
    await db.exec("set session_replication_role='origin'");
    await db.query("insert into tenh_billing_private.legacy_payway_enrollments select b.id,b.provider_transaction_id,b.business_id,tenh_compat_payment_identity(to_jsonb(b)),tenh_compat_subscription_identity(to_jsonb(s)),'review',false,'UNKNOWN','synthetic retention review',clock_timestamp() from billing_transactions b join business_subscriptions s on s.business_id=b.business_id where b.id=$1", [row.id]);
    const held = async user => (await db.query('select tenh_get_account_deletion_billing_hold($1) as value', [user])).rows[0].value;
    const before = (await db.query('select to_jsonb(b) as value from billing_transactions b where id=$1', [row.id])).rows;
    // Compile the three read-only metadata queries against this isolated schema.
    await db.exec(fs.readFileSync('docs/sql/payway-account-deletion-readonly-supplement.sql', 'utf8'));
    await db.exec('set role service_role');
    assert.deepEqual(await held(users.requester), { held: true }); assert.deepEqual(await held(users.owner), { held: true });
    assert.deepEqual(await held(users.member), { held: false }); assert.deepEqual(await held(users.outsider), { held: false });
    await db.exec('reset role');
    assert.deepEqual((await db.query('select to_jsonb(b) as value from billing_transactions b where id=$1', [row.id])).rows, before);
    await db.exec('set role authenticated'); await assert.rejects(() => held(users.requester), /permission denied/); await db.exec('reset role');
    await db.query('select tenh_billing_private.resolve_legacy_payment($1,\'failed\',\'synthetic explicit review\',$2)', [row.id, {
      owner_authorization_reference: 'synthetic authorization', merchant_binding_verified: true,
      provider_status_code: '00', payment_status: 'FAILED', provider_transaction_id: row.provider_transaction_id,
    }]);
    assert.equal((await db.query('select status from billing_transactions where id=$1', [row.id])).rows[0].status, 'failed');
    assert.deepEqual(await held(users.requester), { held: true }); assert.deepEqual(await held(users.owner), { held: true });
    await assert.rejects(() => db.query('delete from billing_transactions where id=$1', [row.id]), /cannot be deleted/);
  } finally { await db.close(); }
});
