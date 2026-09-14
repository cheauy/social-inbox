const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database, baseSeed } = require('./tenh-seven/harness.cjs');
function setup({ graph = { id: 'reply1' }, status = 200, dbError, replies = [] } = {}) {
  const db = database(baseSeed()), calls = [];
  if (dbError) db.failures.push({ table: 'messages', op: 'insert', code: dbError });
  const load = loader({
    '../_shared': { FacebookCommentContextError: class extends Error {}, loadAuthorizedFacebookCommentActionContext: async () => ({ member: { id: 'member1', business_id: 'b1' }, conversation: { id: 'conv1' }, socialAccount: { id: 'page1' }, pageId: '123', pageAccessToken: 'test-token' }) },
    '@/lib/auth/require-permission': { memberHasPermission: async () => true },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/facebook/get-facebook-page-access-token': { isFacebookAccessTokenError: () => false },
  }, { fetch: async (url, init) => { calls.push({ url, init }); return init?.method === 'POST' ? Response.json(graph, { status }) : Response.json({ data: replies }); } });
  return { calls, post: () => load('app/api/facebook/comments/reply/route.ts').POST(new Request('https://app.tenhchat.com/api/facebook/comments/reply', { method: 'POST', body: JSON.stringify({ conversationId: 'conv1', commentId: '123_456', message: 'Hello' }) })) };
}
test('Facebook reduce-data error is identified without automatically posting again', async () => {
  const h = setup({ graph: { error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" } }, status: 500 });
  const response = await h.post(), body = await response.json();
  assert.equal(body.code, 'FACEBOOK_COMMENT_UNCONFIRMED'); assert.match(body.error, /Check the post/);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls.filter(call => call.init?.method === 'POST').length, 1);
});

const postedReply = () => ({ id: 'confirmed1', message: 'Hello', from: { id: '123' }, parent: { id: '123_456' }, created_time: new Date().toISOString() });
test('read-back confirms the posted reply after Meta code 1 without resending', async () => {
  const h = setup({ graph: { error: { code: 1 } }, status: 500, replies: [postedReply()] });
  const response = await h.post(), body = await response.json();
  assert.equal(body.success, true); assert.equal(body.messageId, 'confirmed1');
  assert.equal(h.calls.filter(call => call.init?.method === 'POST').length, 1);
});
for (const [label, replies] of [
  ['wrong Page', () => [{ ...postedReply(), from: { id: 'other' } }]],
  ['wrong parent', () => [{ ...postedReply(), parent: { id: 'other' } }]],
  ['old reply', () => [{ ...postedReply(), created_time: '2020-01-01T00:00:00Z' }]],
  ['different text', () => [{ ...postedReply(), message: 'Other' }]],
  ['ambiguous identical replies', () => [postedReply(), { ...postedReply(), id: 'second' }]],
]) test(`read-back does not confirm ${label}`, async () => {
  const h = setup({ graph: { error: { code: 1 } }, status: 500, replies: replies() });
  const body = await (await h.post()).json();
  assert.equal(body.success, false);
  assert.equal(h.calls.filter(call => call.init?.method === 'POST').length, 1);
});
for (const dbError of [undefined, '23505', 'FAIL']) test(`confirmed reply keeps its provider ID when local save returns ${dbError}`, async () => {
  const h = setup({ dbError }); const response = await h.post(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.success, true); assert.equal(body.messageId, 'reply1');
  assert.equal(Boolean(body.warning), dbError === 'FAIL'); assert.equal(h.calls.length, 1);
});
