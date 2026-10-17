const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { loader, database, baseSeed } = require('./tenh-seven/harness.cjs');

function fixture(options = {}) {
  const seed = baseSeed();
  seed.contacts[0].full_name = options.name === undefined ? null : options.name;
  seed.contacts[0].created_at = '2026-01-01T00:00:00Z';
  seed.contacts[0].profile_picture_url = '/api/contacts/c1/facebook-avatar';
  seed.conversations[0].platform = 'facebook';
  seed.conversations[0].unread_count = 0;
  const db = database(seed), calls = [], tokens = [], uploads = [];
  db.storage = { from: () => ({ upload: async (...args) => { uploads.push(args); return { error: null }; } }) };
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const load = loader({
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/facebook/get-facebook-page-access-token': { getFacebookPageAccessToken: async (...args) => { tokens.push(args); return 'fixture-only'; } },
    '@/lib/facebook/get-facebook-customer-profile': { getFacebookCustomerProfile: async () => {
      if (options.genericFailure) throw Error('fixture profile failure');
      return options.genericProfile || null;
    } },
    '@/lib/facebook/customer-block': { readFacebookBlock: async () => ({ state: null }) },
    '@/lib/facebook/capture-native-reply': { captureFacebookNativeReply: async () => null },
    '@/lib/bot/execution-store': { noteStoredFacebookBotEvent: async () => {} },
    '@/lib/inbox/save-detected-customer-phone': { saveDetectedCustomerPhone: async () => {} },
  }, { Buffer, Date: Clock, console: { log() {}, warn() {}, error() {} }, fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    if (options.onFetch) await options.onFetch(db);
    if (options.failure) return Response.json({ error: { code: 10, message: 'Fixture denied' } }, { status: 403 });
    if (String(url).includes('fixture.invalid/photo')) return new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    return Response.json({ first_name: 'Provider', last_name: 'Name', ...(options.noPhoto ? {} : { profile_pic: 'https://fixture.invalid/photo' }) });
  } });
  const api = load('lib/facebook/facebook-profile-photo.ts');
  const processMessage = load('lib/facebook/process-message.ts').processFacebookMessage;
  const scope = { businessId: 'b1', socialAccountId: 's1', contactId: 'c1', customerId: seed.contacts[0].platform_user_id, pageId: seed.social_accounts[0].platform_account_id };
  const deliver = (echo = true, mid = 'fixture-mid') => processMessage({
    sender: { id: echo ? scope.pageId : scope.customerId }, recipient: { id: echo ? scope.customerId : scope.pageId },
    timestamp: now, message: { mid, is_echo: echo, text: 'Fixture message' },
  });
  return { db, api, scope, deliver, calls, tokens, uploads, advance: ms => { now += ms; } };
}

test('echo-only contact with an existing avatar gets a name after its message is saved', async () => {
  const h = fixture({ onFetch: db => assert.equal(db.tables.messages.length, 1) });
  await h.deliver();
  assert.equal(h.db.tables.messages[0].direction, 'outgoing');
  assert.equal(h.db.tables.conversations[0].unread_count, 0);
  assert.equal(h.db.tables.contacts[0].full_name, 'Provider Name');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.tokens, [[h.scope.pageId, 's1']]);
  assert.equal(h.uploads.length, 0);
  const activity = h.db.tables.conversation_activity[0];
  assert.equal(activity.activity_type, 'customer_profile_updated');
  assert.equal(activity.business_id, 'b1');
  assert.equal(activity.conversation_id, 'conv1');
  assert.equal(activity.contact_id, 'c1');
  assert.equal(activity.metadata.socialAccountId, 's1');
  assert.equal(activity.metadata.fullName, 'Provider Name');
});

for (const name of ['', '  ', 'Customer', 'FACEBOOK CUSTOMER', 'Messenger customer']) {
  test(`fills placeholder ${JSON.stringify(name)} from the existing photo response`, async () => {
    const h = fixture({ name });
    const result = await h.api.syncFacebookContactProfilePhoto({ ...h.scope, pageAccessToken: 'fixture-only' });
    assert.equal(result.stored, true);
    assert.equal(h.db.tables.contacts[0].full_name, 'Provider Name');
    assert.equal(h.calls.length, 2); // Original profile and image requests only.
    assert.equal(h.db.tables.conversation_activity.length, 1);
  });
}

test('a provider name is kept even when the profile has no photo', async () => {
  const h = fixture({ noPhoto: true });
  assert.equal((await h.api.syncFacebookContactProfilePhoto({ ...h.scope, pageAccessToken: 'fixture-only' })).stored, false);
  assert.equal(h.db.tables.contacts[0].full_name, 'Provider Name');
  assert.equal(h.calls.length, 1);
});

test('echoes preserve custom names without another provider lookup', async () => {
  const h = fixture({ name: 'Staff VIP Name' });
  await h.deliver();
  assert.equal(h.db.tables.contacts[0].full_name, 'Staff VIP Name');
  assert.equal(h.calls.length, 0);
  assert.equal(h.tokens.length, 0);
  assert.equal(h.db.tables.conversation_activity.length, 0);
});

test('incoming message enrichment also preserves a valid staff name', async () => {
  const h = fixture({ name: 'Staff VIP Name', genericProfile: { fullName: 'Provider Name', profilePictureUrl: null } });
  await h.deliver(false);
  assert.equal(h.db.tables.contacts[0].full_name, 'Staff VIP Name');
  assert.equal(h.db.tables.messages.length, 1);
  assert.equal(h.db.tables.conversation_activity.length, 0);
});

test('compare-and-set protects a staff edit made while the name lookup is running', async () => {
  const h = fixture();
  const from = h.db.from;
  h.db.from = name => {
    const q = from(name), execute = q.execute.bind(q);
    q.execute = async () => {
      if (name === 'contacts' && q.op === 'update') h.db.tables.contacts[0].full_name = 'Concurrent staff edit';
      return execute();
    };
    return q;
  };
  assert.equal(await h.api.saveFacebookCustomerName(h.scope, 'Provider Name'), false);
  assert.equal(h.db.tables.contacts[0].full_name, 'Concurrent staff edit');
  assert.equal(h.db.tables.conversation_activity.length, 0);
});

test('failed echo profile lookup preserves messages and has a bounded retry cooldown', async () => {
  const h = fixture({ failure: true });
  await h.deliver(true, 'one');
  await h.deliver(true, 'two');
  assert.equal(h.db.tables.messages.length, 2);
  assert.equal(h.db.tables.contacts[0].full_name, null);
  assert.equal(h.calls.length, 1);
  h.advance(300_001);
  await h.deliver(true, 'three');
  assert.equal(h.calls.length, 2);
  assert.equal(h.db.tables.messages.length, 3);
});

test('concurrent missing-name lookups coalesce without caching provider tokens', async () => {
  const h = fixture();
  await Promise.all([h.api.syncFacebookCustomerName(h.scope), h.api.syncFacebookCustomerName(h.scope)]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.db.tables.conversation_activity.length, 1);
});

test('profile and activity failures cannot prevent incoming or outgoing message storage', async () => {
  const h = fixture({ genericFailure: true });
  h.db.failures.push({ table: 'conversation_activity', op: 'insert' });
  await h.deliver(false, 'incoming');
  await h.deliver(true, 'echo');
  assert.equal(h.db.tables.messages.length, 2);
  assert.equal(h.db.tables.conversations[0].unread_count, 1);
});

test('name lookup validates tenant, Page connection and customer identity before a provider call', async () => {
  for (const patch of [{ businessId: 'other' }, { socialAccountId: 'other' }, { contactId: 'other' }, { customerId: 'other' }]) {
    const h = fixture();
    assert.equal(await h.api.syncFacebookCustomerName({ ...h.scope, ...patch }), false);
    assert.equal(h.db.tables.contacts[0].full_name, null);
    assert.equal(h.calls.length, 0);
    assert.equal(h.db.tables.conversation_activity.length, 0);
  }
});

function uiFixture() {
  const source = fs.readFileSync('components/inbox/inbox-view.tsx', 'utf8');
  const ast = ts.createSourceFile('inbox.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration, handler;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'applyFacebookProfileNameActivity') declaration = node;
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useInboxRealtime') {
      handler = node.arguments[0].properties.find(p => p.name?.getText(ast) === 'onRealtimeEvent').initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration && handler);
  let rows = [
    { id: 'conv1', business_id: 'b1', social_account: { id: 's1' }, contact: { id: 'c1', business_id: 'b1', full_name: null }, unread_count: 3 },
    { id: 'conv2', business_id: 'b2', social_account: { id: 's2' }, contact: { id: 'c2', business_id: 'b2', full_name: 'Other customer' } },
  ];
  const context = {
    isRecord: value => value && typeof value === 'object' && !Array.isArray(value),
    setLiveConversations: update => { rows = update(rows); }, realtimeBusinessIds: ['b1'], pagination: true,
    window: { dispatchEvent() { throw Error('Must not refetch the Inbox'); } },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  vm.runInContext(ts.transpileModule('var onRealtimeEvent = ' + handler.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const activity = { business_id: 'b1', conversation_id: 'conv1', contact_id: 'c1', activity_type: 'customer_profile_updated', metadata: { source: 'facebook_profile_name', socialAccountId: 's1', fullName: 'Provider Name', previousFullName: null } };
  return { context, activity, rows: () => rows };
}

test('name activity updates the visible contact immediately without page refetch or message/unread changes', () => {
  const h = uiFixture(), other = h.rows()[1];
  h.context.onRealtimeEvent({ table: 'conversation_activity', eventType: 'INSERT', newRow: h.activity });
  assert.equal(h.rows()[0].contact.full_name, 'Provider Name');
  assert.equal(h.rows()[0].unread_count, 3);
  assert.equal(h.rows()[1], other);
});

test('UI rejects stale custom-name replacements and other tenant/Page/contact activities', () => {
  for (const patch of [{ business_id: 'other' }, { conversation_id: 'other' }, { contact_id: 'other' }, { metadata: { socialAccountId: 'other' } }]) {
    const h = uiFixture();
    const activity = { ...h.activity, ...patch, metadata: { ...h.activity.metadata, ...patch.metadata } };
    h.context.applyFacebookProfileNameActivity(activity);
    assert.equal(h.rows()[0].contact.full_name, null);
  }
  const h = uiFixture();
  h.rows()[0].contact.full_name = 'Staff edit';
  h.context.applyFacebookProfileNameActivity(h.activity);
  assert.equal(h.rows()[0].contact.full_name, 'Staff edit');
});
