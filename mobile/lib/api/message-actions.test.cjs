const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { setup } = require('../../../tests/tenh-seven/harness.cjs');

function client(status = 200) {
  const calls = [];
  const module = { exports: {} };
  const dependencies = {
    'expo-file-system': {},
    '../supabase/client': { authCookieName: 'auth', supabase: { auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user1' } } } }),
    } } },
    './session-cookie': { sessionCookie: (_, __, scope) => `workspace=${scope}` },
    './read-cache': { invalidateReadCache() {}, clearReadCache() {} },
  };
  const source = ts.transpileModule(fs.readFileSync(require.resolve('./client.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function('require', 'exports', 'module', 'fetch', 'process', source)(
    name => dependencies[name], module.exports, module,
    async (url, init) => { calls.push({ url, init }); return Response.json({ success: status === 200, error: 'Rejected' }, { status }); },
    { env: { EXPO_PUBLIC_TENH_API_URL: 'https://app.tenhchat.com' } },
  );
  return { ...module.exports, calls };
}

test('native reaction keeps workspace authentication and supplies the API origin', async () => {
  const h = client();
  const body = { conversationId: 'conv1', messageId: 'message1', reaction: '❤️' };
  await h.api('/api/facebook/messages/reaction', 'b1', { method: 'POST', body });
  assert.equal(h.calls[0].url, 'https://app.tenhchat.com/api/facebook/messages/reaction');
  assert.equal(h.calls[0].init.headers.Origin, 'https://app.tenhchat.com');
  assert.equal(h.calls[0].init.headers.Cookie, 'workspace=b1');
  assert.deepEqual(JSON.parse(h.calls[0].init.body), body);
});

test('native rejected reaction is surfaced without an automatic mutation retry', async () => {
  const h = client(502);
  await assert.rejects(h.api('/api/facebook/messages/reaction', 'b1', { method: 'POST', body: {} }), /Rejected/);
  assert.equal(h.calls.length, 1);
});

for (const denied of [false, true]) test(`message pin uses website permissions (denied=${denied})`, async () => {
  const h = setup({ permissionDenied: denied });
  h.db.tables.conversations[0].platform = 'facebook';
  h.db.tables.messages = [{ id: 'message1', business_id: 'b1', conversation_id: 'conv1',
    platform_message_id: 'mid1', direction: 'incoming', message_type: 'image',
    raw_payload: { tenh_messenger_reactions: { page: { emoji: '❤️', timestamp: 10 } } }, delivery_status: 'seen' }];
  const route = h.load('app/api/conversations/[conversationId]/message-pins/route.ts');
  const result = await route.PATCH(h.request({ messageId: 'message1', pinned: true }, 'PATCH'), h.context);
  assert.equal(result.status, denied ? 403 : 200);
  const row = h.db.tables.messages[0];
  assert.equal(row.raw_payload.tenh_message_pin?.pinned, denied ? undefined : true);
  assert.equal(row.raw_payload.tenh_messenger_reactions.page.emoji, '❤️');
  assert.equal(row.delivery_status, 'seen');
  assert.equal(h.calls.length, 0);
});
