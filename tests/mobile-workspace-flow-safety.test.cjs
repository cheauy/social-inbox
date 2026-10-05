const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { loader, database } = require('./tenh-seven/harness.cjs');

function requestOwner() {
  let ref, cleanup;
  const hooks = {
    useRef: value => ref ??= { current: value },
    useCallback: fn => fn,
    useEffect: fn => { if (!cleanup) cleanup = fn(); },
  };
  const { useRequestOwner } = loader({ react: hooks })('mobile/lib/use-request-owner.ts');
  return { render: scope => useRequestOwner(scope), unmount: () => cleanup() };
}

test('responses belong to the latest request, membership and mounted screen', () => {
  const owner = requestOwner(), beginA = owner.render('A/member-1');
  const first = beginA(), second = beginA();
  assert.equal(first(), false); assert.equal(second(), true);
  const beginB = owner.render('B/member-2'), newest = beginB();
  assert.equal(second(), false); assert.equal(newest(), true);
  assert.equal(beginA()(), false);
  assert.equal(newest(), true, 'a stale callback must not invalidate B');
  owner.render('B/replacement-member');
  assert.equal(newest(), false);
  const last = owner.render('B/replacement-member')();
  owner.unmount(); assert.equal(last(), false);
});

function callback(file, name = 'load', kind = 'useCallback') {
  const src = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (kind === 'function' && ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name &&
        ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'useCallback') {
      found = node.initializer.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found, file);
  return ts.transpileModule('globalThis.run = ' + found, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

for (const file of [
  'mobile/components/screen.tsx', 'mobile/app/(tabs)/analytics.tsx',
  'mobile/components/profile/integration.tsx', 'mobile/app/settings/roles.tsx',
  'mobile/app/settings/people.tsx', 'mobile/app/settings/tags.tsx',
  'mobile/app/settings/quick-replies.tsx',
]) {
  for (const fails of [false, true]) test(`${file}: delayed A ${fails ? 'error' : 'response'} cannot overwrite B`, async () => {
    const owner = requestOwner(), state = {}, pending = { A: [], B: [] };
    function context(id) {
      const c = {
        workspace: { businessId: id, memberId: 'member-' + id },
        beginRequest: owner.render(id), path: '/api/test', period: 'today', offset: 0,
        SLA_MINUTES: 15, DEFAULT_CATEGORY: 'General',
        api: (_, businessId) => new Promise((resolve, reject) => pending[businessId].push(() => {
          if (businessId === 'A' && fails) return reject(new Error('old A failed'));
          resolve({ value: id, channels: [{ businessId: id, id }], pages: [{ id }],
            members: [{ id }], groups: [{ key: id }], canManage: id === 'A', currentMemberId: id,
            invitations: [{ id }], tags: [{ id }], savedReplies: [{ id }], categories: [],
            analytics: { summary: { marker: id } } });
        })),
      };
      for (const setter of ['setData', 'setError', 'setLoading', 'setChannels', 'setAttention',
        'setGroups', 'setMembers', 'setCanManage', 'setMeId', 'setCanInvite', 'setInvitations',
        'setTags', 'setReplies', 'setCategories']) c[setter] = value => { state[setter] = value; };
      vm.createContext(c); vm.runInContext(callback(file), c); return c;
    }
    const a = context('A'), pa = a.run(), b = context('B'), pb = b.run();
    pending.B.forEach(resolve => resolve()); await pb;
    const afterB = JSON.stringify(state);
    pending.A.forEach(resolve => resolve()); await pa;
    assert.equal(JSON.stringify(state), afterB);
  });
}

function authFixture(selected, members, user = { id: 'u' }) {
  const db = database({ team_members: members, business_subscriptions: [], tags: [] });
  const memo = new Map();
  const load = loader({
    react: { cache: fn => fn },
    'next/server': { NextResponse: {
      json: (value, init = {}) => new Response(JSON.stringify(value), { status: init.status || 200 }),
      redirect: (url, status = 307) => new Response(null, { status, headers: { Location: String(url) } }),
    } },
    'next/headers': { cookies: async () => ({ get: () => selected ? { value: selected } : undefined }) },
    '@/lib/server/usage-context': { attributeUsage: () => {} },
    '@/lib/server/request-scope': { requestMemo: (key, fn) => {
      if (!memo.has(key)) memo.set(key, fn()); return memo.get(key);
    } },
    '@/lib/supabase/server': { createClient: async () => ({ auth: {
      getUser: async () => ({ data: { user } }),
    } }) },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/inbox/get-inbox-resource-access': {},
    '@/lib/settings/ensure-workspace-default-content': { DEFAULT_TAG_SEED_MARKER: '__seed' },
  });
  return { db, load, auth: load('lib/auth/get-current-member.ts') };
}
const memberB = { id: 'mb', user_id: 'u', business_id: 'B', role: 'owner', is_active: true };

for (const [file, methods] of [
  ['app/api/mobile/facebook-connect/route.ts', ['GET']],
  ['app/api/facebook/oauth/connect/route.ts', ['GET']],
  ['app/api/facebook/oauth/callback/route.ts', ['GET']],
  ['app/api/facebook/oauth/select/route.ts', ['POST']],
  ['app/api/facebook/subscribe/route.ts', ['POST']],
  ['app/api/facebook/connections/[socialAccountId]/disconnect/route.ts', ['POST']],
  ['app/api/telegram/connection/route.ts', ['POST', 'DELETE']],
  ['app/api/telegram/webhook/route.ts', ['POST', 'DELETE']],
  ['app/api/telegram/diagnostics/route.ts', ['POST']],
  ['app/api/team/members/route.ts', ['PATCH']],
]) for (const method of methods) test(`${method} ${file}: removed selection is rejected before side effects`, async () => {
  const f = authFixture('removed-A', [memberB]);
  const route = f.load(file);
  const request = new Request('https://app.tenhchat.com/api/test', { method });
  request.nextUrl = new URL(request.url);
  const response = await route[method](request, {
    params: Promise.resolve({ socialAccountId: 'account-B' }),
  });
  if (file.includes('/oauth/')) {
    assert.ok([303, 307].includes(response.status));
    const destination = new URL(response.headers.get('Location'));
    assert.equal(destination.searchParams.get('facebook'), 'error');
    assert.match(destination.searchParams.get('message'), /selected workspace is no longer available/);
  } else assert.equal(response.status, 403);
  assert.equal(f.db.history.some(entry => entry.op !== 'read'), false);
});

test('read fallback stays available; cached read fallback cannot authorize a mutation', async () => {
  const f = authFixture('removed-A', [memberB]);
  assert.equal((await f.auth.getCurrentMember()).member.business_id, 'B');
  const strict = await f.auth.getCurrentMember(true);
  assert.equal(strict.success, false); assert.equal(strict.status, 403);
  assert.equal(strict.businessId, 'removed-A');
  const permissions = f.load('lib/auth/require-permission.ts');
  assert.equal((await permissions.requirePermission('tags_quick_replies', 'view')).success, true);
  assert.equal((await permissions.requirePermission('tags_quick_replies', 'manage')).success, false);
  assert.equal((await permissions.requireOwner()).success, false);
});

test('quick reply save refuses denied permissions, serializes duplicate taps and ignores old membership completion', async () => {
  const file = 'mobile/app/settings/quick-replies.tsx', owner = requestOwner();
  let calls = 0, finish;
  const state = {}, c = {
    workspace: { businessId: 'A' }, canManageReplies: false, saving: false,
    mutationLock: { current: false }, beginMutation: owner.render('A'),
    draft: { title: 'Reply', messageText: 'Hello', shortcut: '', category: 'General', attachments: [], sortIndex: '0' },
    replies: [], DEFAULT_CATEGORY: 'General', t: text => text,
    api: () => { calls++; return new Promise(resolve => { finish = resolve; }); },
    load: async () => { state.loaded = true; },
  };
  for (const name of ['setSaving', 'setFormError', 'setDraft']) c[name] = value => { state[name] = value; };
  vm.createContext(c); vm.runInContext(callback(file, 'save', 'function'), c);
  await c.run(); assert.equal(calls, 0);
  c.canManageReplies = true;
  const first = c.run(); await c.run(); assert.equal(calls, 1);
  owner.render('B'); const afterSwitch = JSON.stringify(state);
  finish({}); await first;
  assert.equal(JSON.stringify(state), afterSwitch);
});

test('sole expired billing target resolves on entry and after memberships arrive, preserving explicit and buy-new targets', () => {
  const file = 'mobile/components/billing/subscription-flow.tsx', src = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initial, hydration;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === '[billingId, setBillingId]') initial = node.initializer.arguments[0].getText(ast);
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('setBillingId(workspaces[0].businessId)')) hydration = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(initial); assert.ok(hydration);
  const workspace = { businessId: 'expired-A', subscriptionOperational: false };
  function run(page, params, selected, workspaces) {
    let target;
    const c = { page, params, workspace: selected, workspaces, setBillingId: value => { target = value; } };
    vm.createContext(c); vm.runInContext('globalThis.billingId = ' + initial, c);
    vm.runInContext('globalThis.hydrate = ' + hydration, c);
    return { c, initial: c.billingId, target: () => target };
  }
  assert.equal(run('overview', {}, null, [workspace]).initial, 'expired-A');
  assert.equal(run('overview', { businessId: 'explicit' }, null, [workspace]).initial, 'explicit');
  assert.equal(run('plans', {}, null, [workspace]).initial, null);
  assert.equal(run('overview', {}, null, [workspace, { businessId: 'B' }]).initial, null);
  const late = run('overview', {}, null, []); late.c.workspaces = [workspace]; late.c.hydrate();
  assert.equal(late.target(), 'expired-A');
  late.c.billingId = 'captured'; late.c.hydrate(); assert.equal(late.target(), 'expired-A');
});

test('a retained tag ID always has a visible removable filter even if its catalog entry disappears', () => {
  const file = 'mobile/app/(tabs)/index.tsx', src = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let selected;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'selectedTags') selected = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(selected);
  const c = { tags: [{ id: 'new-B', name: 'VIP' }], tagIds: ['old-A'] };
  vm.createContext(c); vm.runInContext('globalThis.run = ' + selected, c);
  const result = c.run(); assert.equal(result.length, 1);
  assert.equal(result[0].id, 'old-A'); assert.equal(result[0].name, 'Unavailable tag');
});

test('actual tag POST never inserts into B for removed selection A', async () => {
  const f = authFixture('removed-A', [memberB]);
  const response = await f.load('app/api/tags/route.ts').POST(new Request('https://app.tenhchat.com/api/tags', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId: 'removed-A', name: 'Promotion', color: '#0089CC' }),
  }));
  assert.equal(response.status, 403);
  assert.equal(f.db.history.some(entry => entry.op === 'insert'), false);
});

test('strict authentication keeps authorized targets and default selection; rejects revoked sessions', async () => {
  for (const selection of ['B', '']) {
    assert.equal((await authFixture(selection, [memberB]).auth.getCurrentMember(true)).member.business_id, 'B');
  }
  assert.equal((await authFixture('B', [{ ...memberB, is_active: false }]).auth.getCurrentMember(true)).status, 403);
  assert.equal((await authFixture('B', [memberB], null).auth.getCurrentMember(true)).status, 401);
});

test('settings management requires current membership, operational subscription and correct grant', () => {
  const { canManageWorkspacePermission: can } = loader()('mobile/lib/workspace-permissions.ts');
  const workspace = { memberId: 'm', subscriptionOperational: true }, agent = { id: 'm', role: 'agent' };
  assert.equal(can(workspace, { ...agent, role: 'owner' }, {}, 'channels'), true);
  assert.equal(can(workspace, agent, { channels: 'manage' }, 'channels'), true);
  assert.equal(can(workspace, agent, { channels: 'view' }, 'channels'), false);
  assert.equal(can(workspace, agent, { channels: 'manage' }, 'tags_quick_replies'), false);
  assert.equal(can(workspace, { id: 'old', role: 'owner' }, { channels: 'manage' }, 'channels'), false);
  assert.equal(can({ ...workspace, subscriptionOperational: false }, { ...agent, role: 'owner' }, {}, 'channels'), false);
  assert.equal(can(null, null, {}, 'channels'), false);
});
