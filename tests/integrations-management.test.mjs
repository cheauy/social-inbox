import test from 'node:test';
import assert from 'node:assert/strict';
import harness from './inbox-recovery-harness.cjs';
const { loader, database } = harness;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('capacity toggle reuses the guarded API and sends no credential or history fields', async () => {
  const calls = [];
  const load = loader({}, { fetch: async (url, options = {}) => {
    calls.push({ url, ...options });
    return json(options.method === 'PATCH' ? { success: true } : { success: true, businessId: 'workspace', subscription: { id: 'subscription' } });
  } });
  await load('lib/channels/set-integration-enabled.ts').setIntegrationEnabled('bot', false, 'workspace');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url === '/api/subscription/usage-management'));
  assert.equal(calls[1].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].body), { kind: 'connection', id: 'bot', active: false, businessId: 'workspace', subscriptionId: 'subscription' });
});

test('capacity toggle refuses stale workspace/subscription context and surfaces server limits', async () => {
  for (const context of [{ success: true, businessId: 'other', subscription: { id: 'subscription' } }, { success: true, businessId: 'workspace', subscription: null }]) {
    const calls = [];
    const load = loader({}, { fetch: async (url, options) => { calls.push({ url, options }); return json(context); } });
    await assert.rejects(load('lib/channels/set-integration-enabled.ts').setIntegrationEnabled('bot', true, 'workspace'), /workspace or subscription changed/);
    assert.equal(calls.length, 1, 'No mutation after a stale context read');
  }
  const load = loader({}, { fetch: async (_url, options = {}) => options.method === 'PATCH'
    ? json({ success: false, error: 'Channel limit reached' }, 409)
    : json({ success: true, businessId: 'workspace', subscription: { id: 'subscription' } }) });
  await assert.rejects(load('lib/channels/set-integration-enabled.ts').setIntegrationEnabled('bot', true, 'workspace'), /Channel limit reached/);
});

for (const [file, methods] of [
  ['app/api/telegram/connection/route.ts', ['POST', 'DELETE']],
  ['app/api/telegram/webhook/route.ts', ['POST', 'DELETE']],
  ['app/api/facebook/connections/[socialAccountId]/disconnect/route.ts', ['POST']],
  ['app/api/subscription/usage-management/route.ts', ['PATCH']],
]) for (const method of methods) test(`${method} ${file}: Agents without Manage permission cannot mutate connections`, async () => {
  const db = database({ social_accounts: [] });
  let permissionChecks = 0, providerChecks = 0;
  const unexpected = () => { throw Error('Unexpected provider mutation or credential access'); };
  const load = loader({
    '@/lib/auth/get-current-member': { getCurrentMember: async () => ({ success: true, user: { id: 'user' }, member: { id: 'agent', business_id: 'workspace', role: 'agent' } }) },
    '@/lib/auth/require-permission': {
      memberHasPermission: async (_member, area, level) => { assert.equal(area, 'channels'); assert.equal(level, 'manage'); permissionChecks++; return false; },
      permissionDenied: message => json({ success: false, error: message }, 403),
    },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/channels/trial-channel-access': { assertTrialChannelAccess: async () => {}, TrialChannelAccessError: Error },
    '@/lib/channels/expired-trial-claim': {},
    '@/lib/channels/channel-token-crypto': { encryptChannelCredential: unexpected, decryptChannelCredential: unexpected },
    '@/lib/facebook/facebook-token-crypto': { decryptFacebookToken: unexpected },
    '@/lib/subscription/get-business-entitlements': {},
    '@/lib/team/resolve-team-profile-pictures': {},
    '@/lib/telegram/telegram-api': { deleteTelegramWebhook: unexpected, getTelegramWebhookInfo: unexpected, setTelegramWebhook: unexpected },
  }, { AbortController, fetch: async () => { providerChecks++; return json({ ok: true, result: { id: 999999999, is_bot: true, first_name: 'Synthetic bot' } }); } });
  const request = new Request('https://fixture.invalid/api?connectionId=bot', {
    method,
    ...(method !== 'DELETE' ? { body: JSON.stringify({ token: '999999999:offline-synthetic-token', kind: 'connection', id: 'bot', active: true, businessId: 'workspace', subscriptionId: 'subscription' }) } : {}),
  });
  request.nextUrl = new URL(request.url);
  const response = await load(file)[method](request, { params: Promise.resolve({ socialAccountId: 'page' }) });
  assert.equal(response.status, 403);
  assert.equal(permissionChecks, 1);
  assert.ok(db.history.every(entry => entry.op === 'read'));
  assert.equal(providerChecks, file.includes('/connection/') && method === 'POST' ? 1 : 0, 'Only the existing mocked getMe verification can run; no provider mutations');
});
