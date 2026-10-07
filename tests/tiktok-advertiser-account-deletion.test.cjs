/* eslint-disable @typescript-eslint/no-require-imports -- Isolated route harness. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { database, loader } = require('./tenh-seven/harness.cjs');
const { readFileSync } = require('node:fs');

function fixture(options = {}) {
  const { members, subscriptions, connections, held = false, fail, throwRead, closureReply, authFailure } = options;
  const flag = Object.hasOwn(options, 'flag') ? options.flag : 'true';
  const actor = 'deleting-user', business = 'workspace-a', calls = [], logs = [], reads = [];
  const db = database({
    team_members: members ?? [{ id: 'actor-member', user_id: actor, business_id: business, role: 'owner', is_active: true }],
    businesses: [{ id: business, name: 'Synthetic workspace' }],
    business_subscriptions: subscriptions ?? [{ id: 'subscription-a', business_id: business, status: 'active' }],
    tiktok_advertiser_connections: connections ?? [{ id: 'grant-a', business_id: business, user_id: actor,
      status: 'connected', token_hash: 'private-fingerprint-marker', access_token_encrypted: 'private-ciphertext-marker' }],
    social_accounts: [], tenh_system_announcement_dismissals: [],
  });
  if (options.schemaAbsent) delete db.tables.tiktok_advertiser_connections;
  if (fail) db.failures.push(fail);
  const from = db.from;
  db.from = name => {
    if (options.schemaAbsent) assert.ok(!name.startsWith('tiktok_advertiser'), 'advertiser schema is absent');
    if (name === throwRead) throw new Error('private-token-marker');
    const query = from(name), select = query.select;
    query.select = columns => { query.auditColumns = columns; reads.push({ table: name, columns }); return select.call(query, columns); };
    query.neq = (key, value) => query.not(key, 'eq', value);
    return query;
  };
  db.rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'tenh_get_account_deletion_billing_hold') return { data: { held }, error: null };
    assert.ok(!options.schemaAbsent, 'advertiser functions are absent');
    assert.equal(name, 'tenh_begin_tiktok_advertiser_account_deletion');
    if (closureReply) return closureReply;
    const business_ids = db.tables.team_members.filter(m => m.user_id === actor && m.is_active && m.role === 'owner')
      .map(m => m.business_id).filter(id => !args.p_transferring_business_ids.includes(id)
        && !db.tables.team_members.some(m => m.business_id === id && m.user_id && m.user_id !== actor && m.is_active && m.role === 'owner'));
    return { data: { outcome: 'reserved', business_ids }, error: null };
  };
  db.auth = { admin: { deleteUser: async id => { calls.push({ deletion: id }); if (authFailure === 'throw') throw new Error('private-auth-marker'); return { error: authFailure ? { message: 'private-auth-marker' } : null }; } } };
  db.storage = { from: () => ({ list: async () => { calls.push({ avatars: true }); return { data: [], error: null }; } }) };
  const forbidden = () => { throw new Error('Provider operations are forbidden'); };
  const load = loader({
    'next/server': { NextResponse: { json: (body, init = {}) => {
      const response = new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
      response.cookies = { set: (...args) => calls.push({ cookie: args }) };
      return response;
    } } },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) } }) },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/channels/channel-token-crypto': { decryptChannelCredential: forbidden },
    '@/lib/facebook/facebook-token-crypto': { decryptFacebookToken: forbidden },
    '@/lib/telegram/telegram-api': { deleteTelegramWebhook: forbidden },
  }, {
    process: { env: { TIKTOK_ADVERTISER_OAUTH_ENABLED: flag } }, fetch: forbidden,
    console: Object.fromEntries(['error', 'warn', 'info', 'log'].map(level => [level, (...args) => logs.push(args)])),
  });
  const route = load('app/api/account/delete/route.ts');
  const request = body => new Request('https://synthetic.invalid/api/account/delete', { method: 'DELETE',
    body: JSON.stringify({ understood: true, confirmation: 'DELETE MY ACCOUNT', ...body }) });
  const close = () => route.DELETE(request({ ownerDecision: 'delete_subscriptions', deleteSubscriptionsConfirmed: true }));
  return { actor, business, db, route, request, close, calls, logs, reads };
}

function unchanged(h, connectionsBefore) {
  assert.ok(h.db.history.every(item => item.op === 'read'), 'no destructive staging');
  assert.ok(h.calls.every(item => item.name === 'tenh_get_account_deletion_billing_hold'), 'no Auth, avatar or cookie operations');
  assert.deepEqual(h.db.tables.tiktok_advertiser_connections, connectionsBefore);
  assert.deepEqual(h.logs, []);
}

const other = (role = 'owner', permissions, business_id = 'workspace-a') => ({
  id: 'surviving-member', user_id: 'other-user', business_id, role, permissions, is_active: true,
});

for (const scenario of [
  { name: 'member removal', role: 'agent', body: { kind: 'member', active: false }, expected: { role: 'agent', is_active: false } },
  { name: 'Owner removal with another Owner', role: 'owner', body: { kind: 'member', active: false }, expected: { role: 'owner', is_active: false } },
  { name: 'member reactivation', role: 'agent', active: false, body: { kind: 'member', active: true }, expected: { role: 'agent', is_active: true } },
  { name: 'agent promotion', role: 'agent', body: { kind: 'member-role', role: 'admin' }, expected: { role: 'admin', is_active: true } },
  { name: 'admin demotion', role: 'admin', body: { kind: 'member-role', role: 'agent' }, expected: { role: 'agent', is_active: true } },
  { name: 'Owner demotion with another Owner', role: 'owner', body: { kind: 'member-role', role: 'agent' }, expected: { role: 'agent', is_active: true } },
  { name: 'grant Owner access', role: 'agent', body: { kind: 'member-role', role: 'owner' }, expected: { role: 'owner', is_active: true } },
  { name: 'unchanged role', role: 'agent', body: { kind: 'member-role', role: 'agent' }, expected: { role: 'agent', is_active: true }, unchanged: true },
]) {
  test(`disabled team ${scenario.name} succeeds without advertiser tables or functions`, async () => {
    const actor = { ...other(), id: 'acting-owner', user_id: 'acting-user' };
    const target = { ...other(scenario.role), id: 'target-member', is_active: scenario.active ?? true };
    const foreign = { ...other('owner', undefined, 'workspace-b'), id: 'foreign-owner' };
    const db = database({ team_members: [actor, target, foreign], social_accounts: [],
      business_subscriptions: [{ id: 'subscription-a', business_id: 'workspace-a', status: 'active', member_limit: 5, channel_limit: 5 }] });
    const before = structuredClone(db.tables.team_members);
    const from = db.from;
    db.from = name => {
      assert.ok(['team_members', 'social_accounts', 'business_subscriptions'].includes(name), `missing/unrelated table: ${name}`);
      return from(name);
    };
    db.rpc = () => { throw new Error('No RPCs exist in this team fixture'); };
    const forbidden = () => { throw new Error('Provider operations are forbidden'); };
    const load = loader({
      'next/server': { NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), init) } },
      '@/lib/supabase/admin': { supabaseAdmin: db },
      '@/lib/auth/get-current-member': { getCurrentMember: async () => ({ success: true, member: actor }) },
      '@/lib/auth/require-permission': { memberHasPermission: async () => true },
      '@/lib/subscription/get-business-entitlements': { canActivateAnotherChannel: forbidden },
      '@/lib/team/resolve-team-profile-pictures': { resolveTeamProfilePictures: async () => new Map() },
    }, { process: { env: { TIKTOK_ADVERTISER_OAUTH_ENABLED: 'false' } }, fetch: forbidden });
    const response = await load('app/api/subscription/usage-management/route.ts').PATCH(new Request('https://synthetic.invalid/api/subscription/usage-management', {
      method: 'PATCH', body: JSON.stringify({ ...scenario.body, id: target.id, businessId: 'workspace-a', subscriptionId: 'subscription-a' }),
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.changed, !scenario.unchanged);
    const saved = db.tables.team_members.find(m => m.id === target.id);
    for (const [key, value] of Object.entries(scenario.expected)) assert.equal(saved[key], value);
    assert.deepEqual(db.tables.team_members.find(m => m.id === actor.id), before.find(m => m.id === actor.id));
    assert.deepEqual(db.tables.team_members.find(m => m.id === foreign.id), before.find(m => m.id === foreign.id));
    assert.equal(result.members.length, 2, 'normal workspace-scoped success payload');
    assert.equal(result.usage.members, scenario.expected.is_active ? 2 : 1);
    assert.equal(result.subscription.status, 'active');
    assert.equal(Object.hasOwn(db.tables, 'tiktok_advertiser_connections'), false);
    assert.equal(db.history.filter(q => q.op !== 'read').length, scenario.unchanged ? 0 : 1);
  });
}

for (const status of ['pending', 'exchanging', 'connected', 'failed', 'revocation_pending']) {
  test(`ending a last-owner workspace blocks ${status} advertiser work before staging`, async () => {
    const h = fixture({ members: [
      { id: 'actor-member', user_id: 'deleting-user', business_id: 'workspace-a', role: 'owner', is_active: true },
      other('agent', { channels: 'manage' }),
    ], connections: [{ id: 'grant-a', business_id: 'workspace-a', status }] });
    const before = structuredClone(h.db.tables.tiktok_advertiser_connections);
    const response = await h.close();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'TENH_TIKTOK_ADVERTISER_RECONCILIATION_REQUIRED');
    assert.match(response.headers.get('cache-control'), /no-store/);
    unchanged(h, before);
    assert.deepEqual(h.reads.filter(r => r.table === 'tiktok_advertiser_connections'), [{ table: 'tiktok_advertiser_connections', columns: 'id' }]);
  });
}

for (const flag of [undefined, 'false', 'TRUE']) {
  test(`disabled draft adds no advertiser schema dependency (${String(flag)})`, async () => {
    const h = fixture({ flag, schemaAbsent: true });
    assert.equal((await h.close()).status, 200);
    assert.equal(h.reads.filter(r => r.table === 'tiktok_advertiser_connections').length, 0);
    assert.equal(Object.hasOwn(h.db.tables, 'tiktok_advertiser_connections'), false);
    assert.ok(h.calls.some(c => c.deletion === h.actor));
    assert.ok(h.calls.filter(c => c.name).every(c => c.name === 'tenh_get_account_deletion_billing_hold'));
  });
}

test('disabled deletion preserves ordinary member, surviving Owner and valid transfer paths without the proposal', async () => {
  for (const mode of ['member', 'surviving-owner', 'transfer']) {
    const h = fixture({ flag: 'false', schemaAbsent: true });
    h.db.tables.team_members.push(other(mode === 'transfer' ? 'agent' : 'owner'));
    if (mode === 'member') h.db.tables.team_members[0].role = 'agent';
    assert.equal((await h.route.GET()).status, 200);
    const response = await h.route.DELETE(h.request(mode === 'transfer' ? {
      ownerDecision: 'transfer', ownerTransfers: [{ businessId: h.business, memberId: 'surviving-member' }],
    } : {}));
    assert.equal(response.status, 200, mode);
    assert.ok(h.calls.some(c => c.deletion === h.actor), mode);
    assert.equal(h.db.tables.team_members.find(m => m.id === 'surviving-member').role, 'owner');
    assert.equal(h.db.tables.team_members.find(m => m.id === 'surviving-member').is_active, true);
    assert.equal(h.db.tables.business_subscriptions[0].status, 'active');
    assert.equal(Object.hasOwn(h.db.tables, 'tiktok_advertiser_connections'), false);
    assert.ok(h.calls.filter(c => c.name).every(c => c.name === 'tenh_get_account_deletion_billing_hold'));
    assert.deepEqual(h.logs, []);
  }
});

test('disabled deletion preserves the Billing hold before any staging without the proposal', async () => {
  const h = fixture({ flag: 'false', schemaAbsent: true, held: true });
  for (const response of [await h.route.GET(), await h.close()]) {
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'TENH_BILLING_RECOVERY_REQUIRED');
  }
  assert.deepEqual(h.db.history, []);
  assert.ok(h.calls.every(c => c.name === 'tenh_get_account_deletion_billing_hold'));
});

test('retained disconnected fingerprints permit closure and are never released', async () => {
  const h = fixture();
  Object.assign(h.db.tables.tiktok_advertiser_connections[0], { status: 'disconnected', access_token_encrypted: null, revoke_confirmed_at: '2026-10-07T00:00:00Z' });
  const before = structuredClone(h.db.tables.tiktok_advertiser_connections);
  assert.equal((await h.close()).status, 200);
  assert.deepEqual(h.db.tables.tiktok_advertiser_connections, before);
});

test('workspace with no advertiser records follows existing account deletion', async () => {
  const h = fixture({ connections: [] });
  assert.equal((await h.close()).status, 200);
  assert.ok(h.calls.some(c => c.deletion === h.actor));
});

test('valid Owner transfer preserves grant access even when its creator deletes their account', async () => {
  const h = fixture(); h.db.tables.team_members.push(other('agent'));
  const before = structuredClone(h.db.tables.tiktok_advertiser_connections);
  assert.equal((await h.route.GET()).status, 200, 'preflight must keep the transfer choice available');
  assert.equal((await h.route.DELETE(h.request({ ownerDecision: 'transfer', ownerTransfers: [{ businessId: h.business, memberId: 'surviving-member' }] }))).status, 200);
  assert.equal(h.db.tables.team_members.find(m => m.id === 'surviving-member').role, 'owner');
  assert.deepEqual(h.db.tables.tiktok_advertiser_connections, before);
});

test('invalid transfer cannot bypass deletion validation or mutate advertiser ownership', async () => {
  const h = fixture(); h.db.tables.team_members.push(other('agent'));
  const before = structuredClone(h.db.tables.tiktok_advertiser_connections);
  assert.equal((await h.route.DELETE(h.request({ ownerDecision: 'transfer', ownerTransfers: [{ businessId: h.business, memberId: 'foreign-member' }] }))).status, 500);
  assert.ok(h.db.history.every(item => item.op === 'read'));
  assert.ok(!h.calls.some(c => c.deletion));
  assert.deepEqual(h.db.tables.tiktok_advertiser_connections, before);
});

test('ordinary member deletion is allowed when another Owner remains, regardless of grant creator', async () => {
  const h = fixture(); h.db.tables.team_members[0].role = 'agent'; h.db.tables.team_members.push(other());
  assert.equal((await h.route.GET()).status, 200);
  assert.equal((await h.route.DELETE(h.request())).status, 200);
  assert.equal(h.reads.filter(r => r.table === 'tiktok_advertiser_connections').length, 0);
});

test('another Owner appearing before preflight keeps the workspace open', async () => {
  const h = fixture(); h.db.tables.team_members.push(other());
  assert.equal((await h.close()).status, 200);
  assert.equal(h.db.tables.business_subscriptions[0].status, 'active');
  assert.equal(h.db.tables.team_members.find(m => m.id === 'surviving-member').is_active, true);
});

for (const subscriptions of [[], [{ id: 'subscription-a', business_id: 'workspace-a', status: 'expired' }]]) {
  test(`last manager deletion blocks unresolved grants without an active subscription (${subscriptions.length})`, async () => {
    const h = fixture({ subscriptions });
    const before = structuredClone(h.db.tables.tiktok_advertiser_connections);
    assert.equal((await h.route.GET()).status, 409);
    assert.equal((await h.route.DELETE(h.request())).status, 409);
    unchanged(h, before);
  });
}

for (const survivor of [other('agent'), { ...other('agent', { channels: 'manage' }), is_active: false }, { ...other('owner'), user_id: null }]) {
  test(`a non-operational survivor cannot manage the retained grant (${String(survivor.user_id)}:${survivor.is_active}:${survivor.role})`, async () => {
    const h = fixture({ subscriptions: [] }); h.db.tables.team_members.push(survivor);
    assert.equal((await h.route.DELETE(h.request())).status, 409);
    assert.ok(h.db.history.every(item => item.op === 'read'));
  });
}

test('a surviving agent with channels/manage cannot replace the last authorized Owner', async () => {
  const h = fixture({ subscriptions: [] }); h.db.tables.team_members.push(other('agent', { channels: 'manage' }));
  assert.equal((await h.route.DELETE(h.request())).status, 409);
});

test('records and managers from another workspace do not affect the deletion', async () => {
  const h = fixture({ connections: [{ id: 'foreign-grant', business_id: 'workspace-b', status: 'connected' }] });
  h.db.tables.team_members.push(other('owner', undefined, 'workspace-b'));
  assert.equal((await h.close()).status, 200);
  const blocked = fixture(); blocked.db.tables.team_members.push(other('owner', undefined, 'workspace-b'));
  assert.equal((await blocked.close()).status, 409, 'a foreign manager cannot stand in for this workspace');
});

test('untrusted body workspace/user/transfer IDs cannot suppress the blocker', async () => {
  const h = fixture({ subscriptions: [] });
  const response = await h.route.DELETE(h.request({ userId: 'other-user', businessId: 'workspace-b', ownerDecision: 'transfer',
    ownerTransfers: [{ businessId: h.business, memberId: 'surviving-member' }] }));
  assert.equal(response.status, 409);
  assert.ok(h.db.history.every(item => item.op === 'read'));
});

test('Billing hold still takes precedence and prevents advertiser reads', async () => {
  const h = fixture({ held: true });
  for (const response of [await h.route.GET(), await h.close()]) {
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'TENH_BILLING_RECOVERY_REQUIRED');
  }
  assert.deepEqual(h.db.history, []);
});

for (const failure of [
  { fail: { table: 'team_members', when: query => query.auditColumns === 'business_id,role', message: 'private-token-marker' } },
  { fail: { table: 'team_members', when: query => query.auditColumns === 'business_id,role,permissions', message: 'private-token-marker' } },
  { fail: { table: 'tiktok_advertiser_connections', message: 'private-token-marker' } },
  { throwRead: 'tiktok_advertiser_connections' },
]) {
  test(`advertiser read failure stops before staging without logging or exposing raw errors (${Object.keys(failure)[0]})`, async () => {
    const h = fixture(failure), before = structuredClone(h.db.tables.tiktok_advertiser_connections);
    const response = await h.close(), text = await response.text();
    assert.equal(response.status, 503);
    assert.equal(JSON.parse(text).code, 'TENH_TIKTOK_ADVERTISER_DELETION_CHECK_UNAVAILABLE');
    assert.doesNotMatch(text, /private-|ciphertext|token_hash|access_token/);
    assert.match(response.headers.get('cache-control'), /no-store/);
    unchanged(h, before);
  });
}

for (const [outcome, status, code] of [
  ['blocked', 409, 'TENH_TIKTOK_ADVERTISER_RECONCILIATION_REQUIRED'],
  ['busy', 409, 'TENH_TIKTOK_ADVERTISER_CLOSURE_PENDING'],
  ['invalid_scope', 503, 'TENH_TIKTOK_ADVERTISER_DELETION_CHECK_UNAVAILABLE'],
]) test(`coordinated ${outcome} result stops before staging`, async () => {
  const h = fixture({ connections: [], closureReply: { data: { outcome }, error: null } });
  const response = await h.close();
  assert.equal(response.status, status); assert.equal((await response.json()).code, code);
  assert.ok(h.db.history.every(item => item.op === 'read'));
  assert.ok(!h.calls.some(c => c.deletion || c.avatars));
  const coordination = h.calls.find(c => c.name === 'tenh_begin_tiktok_advertiser_account_deletion');
  assert.equal(coordination.args.p_user_id, h.actor);
  assert.deepEqual(Array.from(coordination.args.p_closing_business_ids), [h.business]);
  assert.match(coordination.args.p_operation_id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(h.logs, []);
});

test('ambiguous coordination failure is generic and does not start account staging', async () => {
  const h = fixture({ connections: [], closureReply: { data: null, error: { message: 'private-token-marker' } } });
  const response = await h.close(), text = await response.text();
  assert.equal(response.status, 503); assert.doesNotMatch(text, /private-/);
  assert.ok(h.db.history.every(item => item.op === 'read'));
  assert.deepEqual(h.logs, []);
});

test('Auth failures retain the fence; known failure restores snapshots and unknown outcome requires review', async () => {
  for (const authFailure of [true, 'throw']) {
  const h = fixture({ connections: [], authFailure });
  const response = await h.close();
  const result = await response.json();
  assert.equal(response.status, 409); assert.equal(result.code, 'TENH_TIKTOK_ADVERTISER_CLOSURE_PENDING');
  assert.match(result.error,/could not confirm/);
  if (authFailure === true) {
    assert.equal(h.db.tables.team_members[0].is_active, true);
    assert.equal(h.db.tables.business_subscriptions[0].status, 'active');
  }
  assert.equal(h.calls.filter(c => c.name === 'tenh_begin_tiktok_advertiser_account_deletion').length, 1);
  assert.deepEqual(h.logs, []);
  }
});

test('account-deletion copy describes closure and retention rather than deleting workspace data', () => {
  const source = readFileSync('components/profile/delete-account-section.tsx', 'utf8');
  assert.match(source, /Shared history and required records remain retained/);
  assert.doesNotMatch(source, /delete the workspace data/);
});

for (const body of [{ kind: 'member-role', role: 'agent' }, { kind: 'member', active: false }]) {
  test(`team ${body.kind} returns the specific non-secret last-Owner blocker`, async () => {
    const db = database({ team_members: [{ id: 'target-owner', business_id: 'workspace-a', user_id: 'target-user', role: 'owner', is_active: true }],
      business_subscriptions: [{ id: 'subscription-a', business_id: 'workspace-a' }] });
    db.failures.push({ table: 'team_members', op: 'update', code: '23514',
      message: 'Reconcile TikTok advertiser work or transfer Owner access before removing the last Owner.' });
    const load = loader({
      'next/server': { NextResponse: { json: (value, init = {}) => new Response(JSON.stringify(value), { ...init, headers: init.headers }) } },
      '@/lib/supabase/admin': { supabaseAdmin: db },
      '@/lib/auth/get-current-member': { getCurrentMember: async () => ({ success: true, member: { id: 'acting-owner', role: 'owner', business_id: 'workspace-a' } }) },
      '@/lib/auth/require-permission': { memberHasPermission: async () => true },
      '@/lib/subscription/get-business-entitlements': { canActivateAnotherChannel: () => { throw new Error('Unrelated channel operation'); } },
      '@/lib/team/resolve-team-profile-pictures': { resolveTeamProfilePictures: () => { throw new Error('Unexpected success read'); } },
    });
    const response = await load('app/api/subscription/usage-management/route.ts').PATCH(new Request('https://synthetic.invalid/api/subscription/usage-management', {
      method: 'PATCH', body: JSON.stringify({ ...body, id: 'target-owner', businessId: 'workspace-a', subscriptionId: 'subscription-a' }),
    }));
    const result = await response.json();
    assert.equal(response.status,409); assert.equal(result.code,'TENH_TIKTOK_ADVERTISER_RECONCILIATION_REQUIRED');
    assert.match(result.error,/transfer Owner access/); assert.equal(result.details,undefined);
    assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal(db.tables.team_members[0].role,'owner'); assert.equal(db.tables.team_members[0].is_active,true);
  });
}
