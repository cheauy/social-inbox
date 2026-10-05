const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');

function fixture(selected, options = {}) {
  const member = business => ({ id: `member-${business}`, user_id: 'mock-user', business_id: business,
    role: 'owner', is_active: true, full_name: 'Mock owner', email: 'mock@example.invalid' });
  const db = database({ team_members: [member('active'), { ...member('removed'), is_active: false }],
    business_subscriptions: [{ business_id: 'active', status: 'active', current_period_end: '2999-01-01', created_at: '2026-10-03' }] });
  if (options.lookupError) db.failures.push({ table: 'team_members', message: 'Synthetic lookup failure' });
  const memo = new Map(), usage = [];
  const load = loader({
    react: { cache: fn => fn },
    'next/headers': { cookies: async () => ({ get: () => selected ? { value: selected } : undefined }) },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => options.unauthorized
      ? { data: { user: null }, error: new Error('Synthetic auth failure') }
      : { data: { user: { id: 'mock-user' } }, error: null } } }) },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/server/usage-context': { attributeUsage: business => usage.push(business) },
    '@/lib/server/request-scope': { requestMemo: (key, fn) => { if (!memo.has(key)) memo.set(key, fn()); return memo.get(key); } },
  });
  return { db, memo, usage, auth: load('lib/auth/get-current-member.ts'), access: load('lib/storage/workspace-storage-access.ts') };
}

for (const selected of ['stale-nonmember', 'removed']) {
  test(`Storage refuses ${selected} without retargeting another membership or checking its subscription`, async () => {
    const f = fixture(selected), before = JSON.stringify(f.db.tables);
    const result = await f.access.getWorkspaceStorageAccess();
    assert.equal(result.success, false); assert.equal(result.status, 403);
    assert.equal(result.code, 'WORKSPACE_ACCESS_REMOVED'); assert.equal(result.businessId, selected);
    assert.equal(f.db.history.some(entry => entry.table === 'business_subscriptions'), false);
    assert.equal(f.db.history.some(entry => entry.op !== 'read'), false);
    assert.equal(JSON.stringify(f.db.tables), before); assert.deepEqual(f.usage, []);
  });
}

test('permissive browser recovery cannot satisfy a subsequent strict Storage lookup in the same request', async () => {
  const f = fixture('stale-nonmember');
  const permissive = await f.auth.getCurrentMember();
  assert.equal(permissive.success, true); assert.equal(permissive.member.business_id, 'active');
  const strict = await f.access.getWorkspaceStorageAccess();
  assert.equal(strict.success, false); assert.equal(strict.status, 403);
  assert.equal(f.memo.size, 2); assert.deepEqual(f.usage, ['active']);
});

test('a strict refusal does not change existing no-argument browser recovery', async () => {
  const f = fixture('stale-nonmember');
  assert.equal((await f.auth.getCurrentMember(true)).success, false);
  const permissive = await f.auth.getCurrentMember();
  assert.equal(permissive.success, true); assert.equal(permissive.member.business_id, 'active');
});

test('valid explicit membership and an absent workspace selection preserve existing account resolution', async () => {
  for (const selected of ['active', '']) {
    const f = fixture(selected), result = await f.access.getWorkspaceStorageAccess();
    assert.equal(result.success, true); assert.equal(result.member.business_id, 'active');
    assert.equal(f.db.history.some(entry => entry.op !== 'read'), false);
  }
});

test('unauthorized sessions and selected membership lookup errors stop Storage access', async () => {
  for (const [options, status] of [[{ unauthorized: true }, 401], [{ lookupError: true }, 500]]) {
    const f = fixture('active', options), result = await f.access.getWorkspaceStorageAccess();
    assert.equal(result.success, false); assert.equal(result.status, status);
    assert.equal(f.db.history.some(entry => entry.table === 'business_subscriptions'), false);
    assert.deepEqual(f.usage, []);
  }
});
