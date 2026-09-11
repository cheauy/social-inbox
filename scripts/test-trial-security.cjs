const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');

function load(file, mocks = {}) {
  const context = {
    exports: {}, console: { error() {} },
    process: { env: { TENH_TRIAL_SECURITY_SECRET: 'test-only-secret' } },
    require(name) {
      if (name === 'server-only') return {};
      if (name === 'node:crypto') return crypto;
      if (name in mocks) return mocks[name];
      throw new Error('Unexpected import: ' + name);
    },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context.exports;
}

function reservationHarness() {
  const state = { rows: [], device: 'device-a', readError: null, insertError: null };
  const admin = { from() {
    let filters = [], inserted, head = false;
    const result = () => {
      if (state.readError) return { data: null, error: state.readError };
      const matches = state.rows.filter(row => filters.every(f => f(row)));
      return { data: head ? null : matches[0] ?? null, count: matches.length, error: null };
    };
    const query = {
      select(_fields, options) { head = !!options?.head; return query; },
      eq(k, v) { filters.push(row => row[k] === v); return query; },
      gte(k, v) { filters.push(row => row[k] >= v); return query; },
      maybeSingle: async () => result(),
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      insert(row) { inserted = row; return query; },
      async single() {
        if (state.insertError) return { data: null, error: state.insertError };
        const row = { ...inserted, id: 'claim-' + state.rows.length, claimed_at: new Date().toISOString() };
        state.rows.push(row);
        return { data: row, error: null };
      },
    };
    return query;
  } };
  const mod = load('lib/onboarding/trial-security.ts', {
    '@/lib/supabase/admin': { supabaseAdmin: admin },
    'next/headers': { cookies: async () => ({ get: () => ({ value: state.device }), set() {} }) },
  });
  const request = new Request('https://test.invalid', { headers: { 'x-real-ip': '192.0.2.1' } });
  return { state, reserve: (id, email) => mod.reserveFreeTrial(id, email, request) };
}

test('a fresh account reserves a trial; a granted account cannot reserve twice', async () => {
  const h = reservationHarness();
  assert.equal((await h.reserve('user-a', 'a@example.com')).eligible, true);
  Object.assign(h.state.rows[0], { business_id: 'workspace-a', trial_granted: true });
  assert.equal((await h.reserve('user-a', 'a@example.com')).reason, 'account_already_used_trial');
});
test('deleting auth account and using a new user ID does not bypass retained email claim', async () => {
  const h = reservationHarness();
  await h.reserve('deleted-user', 'A@example.com');
  h.state.device = 'new-browser';
  assert.equal((await h.reserve('new-user', ' a@EXAMPLE.com ')).reason, 'email_already_used_trial');
});
test('Gmail dots, plus aliases, and Googlemail share one trial', async () => {
  const h = reservationHarness();
  await h.reserve('user-a', 'first.last+one@gmail.com');
  h.state.device = 'new-browser';
  assert.equal((await h.reserve('user-b', 'firstlast+two@googlemail.com')).reason, 'email_already_used_trial');
});
test('another email on the same browser cannot reserve another trial', async () => {
  const h = reservationHarness();
  await h.reserve('user-a', 'a@example.com');
  assert.equal((await h.reserve('user-b', 'b@example.com')).reason, 'device_already_used_trial');
});
test('pending provisioning retry reuses its claim', async () => {
  const h = reservationHarness();
  const first = await h.reserve('user-a', 'a@example.com');
  const second = await h.reserve('user-a', 'a@example.com');
  assert.equal(second.claimId, first.claimId);
  assert.equal(second.reason, 'retry_pending_claim');
  assert.equal(h.state.rows.length, 1);
});
test('network limit blocks the third distinct registration', async () => {
  const h = reservationHarness();
  await h.reserve('user-a', 'a@example.com');
  h.state.device = 'device-b';
  await h.reserve('user-b', 'b@example.com');
  h.state.device = 'device-c';
  assert.equal((await h.reserve('user-c', 'c@example.com')).reason, 'network_trial_limit_reached');
});
test('a concurrent database IP rejection is handled as a trial denial', async () => {
  const h = reservationHarness();
  h.state.insertError = { code: 'P0001', details: 'TENH_TRIAL_IP_LIMIT' };
  assert.equal((await h.reserve('user-a', 'a@example.com')).reason, 'network_trial_limit_reached');
});
test('database failure never grants a trial', async () => {
  const h = reservationHarness();
  h.state.readError = { code: '42P01', message: 'Missing trial table' };
  assert.equal((await h.reserve('user-a', 'a@example.com')).reason, 'trial_security_unavailable');
});

function channelHarness(result) {
  const calls = [];
  const mod = load('lib/channels/trial-channel-access.ts', {
    '@/lib/supabase/admin': { supabaseAdmin: { rpc: async (...args) => { calls.push(args); return result; } } },
  });
  return { ...mod, calls };
}
test('channel check submits the actual workspace and verified Page ID', async () => {
  const h = channelHarness({ data: true, error: null });
  await h.assertTrialChannelAccess('workspace-a', 'facebook', 'page-a');
  assert.equal(h.calls[0][0], 'check_tenh_trial_channel_access');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][1])), {
    p_business_id: 'workspace-a', p_platform: 'facebook', p_account_id: 'page-a',
  });
});
for (const [label, result, code, status] of [
  ['previous channel trial', { data: false, error: null }, 'CHANNEL_TRIAL_ALREADY_USED', 403],
  ['expired trial', { data: null, error: { details: 'TENH_TRIAL_EXPIRED' } }, 'TRIAL_EXPIRED', 403],
  ['missing migration', { data: null, error: { code: 'PGRST202' } }, 'TRIAL_SECURITY_UNAVAILABLE', 503],
]) test(label + ' blocks connection with an actionable error', async () => {
  const h = channelHarness(result);
  await assert.rejects(h.assertTrialChannelAccess('workspace-b', 'telegram', 'bot-a'), error => error.code === code && error.status === status);
});

test('trial retry preserves original start and exactly seven days', async () => {
  const file = 'lib/onboarding/ensure-user-workspace.ts', text = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'applySevenDayTrial').getText(ast);
  const row = { trial_started_at: '2026-01-01T12:30:00.000Z', current_period_start: '2026-01-01T12:30:00.000Z' };
  const updates = [];
  const query = {
    select() { return this; }, eq() { return this; },
    maybeSingle: async () => ({ data: row, error: null }),
    update(value) { updates.push(value); return this; },
    then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
  };
  const context = { exports: {}, supabaseAdmin: { from: () => query }, TRIAL_DAYS: 7, TRIAL_CHANNEL_LIMIT: 3, TRIAL_MEMBER_LIMIT: 1 };
  vm.runInNewContext(ts.transpileModule(fn + '\nexports.run=applySevenDayTrial;', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  await context.exports.run('workspace-a');
  await context.exports.run('workspace-a');
  for (const update of updates) {
    assert.equal(update.trial_started_at, row.trial_started_at);
    assert.equal(update.trial_ends_at, '2026-01-08T12:30:00.000Z');
    assert.equal(update.channel_limit, 3);
    assert.equal(update.member_limit, 1);
  }
});
test('unverified email cannot provision a workspace or reserve a trial', async () => {
  const unexpected = () => { throw new Error('Must not access DB for unverified email'); };
  const mod = load('lib/onboarding/ensure-user-workspace.ts', {
    '@/lib/supabase/admin': { supabaseAdmin: { from: unexpected, rpc: unexpected } },
    '@/lib/settings/ensure-workspace-default-content': { ensureWorkspaceDefaultContent: unexpected },
    '@/lib/onboarding/trial-security': { reserveFreeTrial: unexpected },
  });
  const result = await mod.provisionUserWorkspace({ id: 'user-a', email: 'a@example.com' }, new Request('https://test.invalid'));
  assert.equal(result.success, false);
  assert.match(result.error, /verified email/);
});
