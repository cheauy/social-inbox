const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');
const requestId = '00000000-0000-4000-8000-000000000001';
const body = { conversationId: 'conv1', requestId, latitude: 0.125, longitude: -0.25 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function fixture(options = {}) {
  const db = database({
    conversations: [{ id: 'conv1', business_id: 'b1', platform: 'telegram', social_account_id: 's1', contact_id: 'c1' }],
    contacts: [{ id: 'c1', business_id: 'b1', platform: 'telegram', platform_user_id: 'mock-chat' }],
    social_accounts: [{ id: 's1', business_id: 'b1', platform: 'telegram', is_active: true, telegram_token_status: 'verified', telegram_bot_token_encrypted: 'mock-encrypted', platform_account_id: 'mock-bot' }],
    messages: [], facebook_sticker_sends: [],
  });
  // Enforce the real schema's atomic (business_id,request_id) primary key in
  // the mocked DB. Message lookup alone is deliberately not a dispatch fence.
  db.failures.push({ table: 'facebook_sticker_sends', op: 'insert', code: '23505', when: q =>
    db.tables.facebook_sticker_sends.some(r => r.business_id === q.body.business_id && r.request_id === q.body.request_id) });
  let calls = 0;
  const route = loader({
    '@/lib/inbox/get-inbox-resource-access': { getInboxConversationAccess: async () => options.denied
      ? { success: false, status: 403, error: 'Mock denied workspace' }
      : { success: true, member: { id: 'm1', business_id: 'b1' } } },
    '@/lib/auth/require-permission': { memberHasPermission: async () => !options.noManage, permissionDenied: error => new Response(JSON.stringify({ success: false, error }), { status: 403 }) },
    '@/lib/channels/channel-token-crypto': { decryptChannelCredential: () => 'mock-token' },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/telegram/telegram-api': { sendTelegramLocation: async args => {
      calls++; assert.equal(args.token, 'mock-token');
      assert.equal(db.tables.facebook_sticker_sends[0]?.status, options.legacy ? undefined : 'pending');
      if (options.send) return options.send(args);
      return { message_id: 42, date: 1, location: { latitude: args.latitude, longitude: args.longitude } };
    } },
  }, { console: { error() {}, info() {} } })('app/api/telegram/send-location/route.ts');
  return { db, calls: () => calls, route,
    post: value => route.POST(new Request('https://mock.invalid/api/telegram/send-location', { method: 'POST', body: JSON.stringify(value ?? body) })),
    get: value => route.GET(new Request('https://mock.invalid/api/telegram/send-location?' + new URLSearchParams(Object.entries(value ?? body).map(([k,v]) => [k, String(v)])))),
  };
}

test('claim precedes dispatch and a completed retry replays without sending twice', async () => {
  const f = fixture(); const first = await f.post(); assert.equal(first.status, 200);
  assert.equal((await first.json()).delivery, 'confirmed');
  const replay = await f.post(); assert.equal(replay.status, 200); assert.equal(f.calls(), 1);
  assert.equal((await replay.json()).messageId, 'telegram:mock-chat:42');
  assert.equal(f.db.tables.messages.length, 1);
});

test('two concurrent requests with the same ID can claim only one dispatch', async () => {
  const pending = deferred(); const f = fixture({ send: () => pending.promise });
  const work = f.post(); await new Promise(r => setImmediate(r));
  const duplicate = await f.post(); assert.equal(duplicate.status, 409); assert.equal(f.calls(), 1);
  pending.resolve({ message_id: 42 }); assert.equal((await work).status, 200);
});

test('atomic insert catches the race when both initial reads see no receipt', async () => {
  const f = fixture(); const [a,b] = await Promise.all([f.post(), f.post()]);
  assert.deepEqual([a.status,b.status].sort(), [200,409]); assert.equal(f.calls(), 1);
});

test('accepted send with lost provider response remains uncertain and rejects blind retry', async () => {
  const f = fixture({ send: async () => { throw Error('Mock response lost after acceptance'); } });
  assert.equal((await f.post()).status, 502); assert.equal(f.db.tables.facebook_sticker_sends[0].status, 'uncertain');
  assert.equal((await f.post()).status, 409); assert.equal((await f.get()).status, 409); assert.equal(f.calls(), 1);
});

test('missing provider message ID remains blocked', async () => {
  const f = fixture({ send: async () => ({}) }); assert.equal((await f.post()).status, 502);
  assert.equal((await f.post()).status, 409); assert.equal(f.calls(), 1);
});

test('failed receipt completion leaves the pending claim in place', async () => {
  const f = fixture(); f.db.failures.push({ table: 'facebook_sticker_sends', op: 'update' });
  assert.equal((await f.post()).status, 200); assert.equal(f.db.tables.facebook_sticker_sends[0].status, 'pending');
  assert.equal((await f.post()).status, 409); assert.equal(f.calls(), 1);
});

test('local history save failure does not invite another Telegram send', async () => {
  const f = fixture(); f.db.failures.push({ table: 'messages', op: 'insert' });
  const response = await f.post(); assert.equal(response.status, 200); assert.match((await response.json()).warning, /could not save/);
  assert.equal((await f.get()).status, 200); assert.equal(f.calls(), 1);
});

test('missing receipt store refuses dispatch and reconciliation', async () => {
  const f = fixture(); delete f.db.tables.facebook_sticker_sends;
  assert.equal((await f.post()).status, 503); assert.equal((await f.get()).status, 503); assert.equal(f.calls(), 0);
});

test('a request ID cannot be reused for changed coordinates', async () => {
  const f = fixture(); await f.post(); assert.equal((await f.post({ ...body, latitude: 1 })).status, 409);
  assert.equal(f.calls(), 1);
});

test('GET with no receipt is read-only and does not promise no later dispatch', async () => {
  const f = fixture(); const response = await f.get();
  assert.deepEqual(await response.json(), { success: true, delivery: 'not_found', locationTracking: 'v1' });
  assert.equal(f.calls(), 0); assert.equal(f.db.history.some(q => q.op !== 'read'), false);
});

test('POST reconciliation cannot accidentally dispatch an absent receipt', async () => {
  const f = fixture(); const response = await f.post({ ...body, reconcileOnly: true });
  assert.equal((await response.json()).delivery, 'not_found'); assert.equal(f.calls(), 0);
});

for (const option of ['denied','noManage']) test(`${option} refuses receipt lookup and provider dispatch`, async () => {
  const f = fixture({ [option]: true }); assert.equal((await f.post()).status, 403); assert.equal((await f.get()).status, 403);
  assert.equal(f.calls(), 0); assert.equal(f.db.history.length, 0);
});

test('legacy web caller retains its existing contract without claiming native safety', async () => {
  const f = fixture({ legacy: true }); const { requestId: _, ...legacy } = body;
  assert.equal((await f.post(legacy)).status, 200); assert.equal(f.calls(), 1); assert.equal(f.db.tables.facebook_sticker_sends.length, 0);
});

test('durable native attempt survives module reload and remains account/thread scoped', async () => {
  const store = new Map(); const storage = { getItem: async k => store.get(k) ?? null, setItem: async (k,v) => { store.set(k,v); }, removeItem: async k => { store.delete(k); } };
  const load = () => loader({ './auth/secure-storage': { sessionStorage: storage } })('mobile/lib/location-send-state.ts');
  const first = load(), key = first.locationAttemptKey('account1','business1','thread1');
  await first.saveLocationAttempt(key, { requestId, latitude: body.latitude, longitude: body.longitude });
  const next = load(); assert.equal((await next.readLocationAttempt(key)).requestId, requestId);
  assert.equal(await next.readLocationAttempt(next.locationAttemptKey('account2','business1','thread1')), null);
  assert.equal(await next.readLocationAttempt(next.locationAttemptKey('account1','business1','thread2')), null);
});

test('simultaneous screens cannot overwrite an unresolved attempt and old cleanup cannot erase a newer one', async () => {
  const store = new Map(); const state = loader({ './auth/secure-storage': { sessionStorage: {
    getItem: async k => store.get(k) ?? null, setItem: async (k,v) => store.set(k,v), removeItem: async k => store.delete(k),
  } } })('mobile/lib/location-send-state.ts');
  const a = { requestId, latitude: 0, longitude: 0 }, b = { ...a, requestId: '00000000-0000-4000-8000-000000000002' };
  const results = await Promise.allSettled([state.saveLocationAttempt('key',a),state.saveLocationAttempt('key',b)]);
  assert.deepEqual(results.map(r=>r.status), ['fulfilled','rejected']);
  await state.clearLocationAttempt('key', requestId); await state.saveLocationAttempt('key',b);
  await state.clearLocationAttempt('key', requestId); assert.equal((await state.readLocationAttempt('key')).requestId, b.requestId);
});

test('corrupt saved attempt fails closed instead of returning an empty draft', async () => {
  const state = loader({ './auth/secure-storage': { sessionStorage: { getItem: async () => '{broken' } } })('mobile/lib/location-send-state.ts');
  await assert.rejects(state.readLocationAttempt('key'));
});
