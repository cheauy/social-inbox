const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('../tenh-seven/harness.cjs');
const { readMessagePageResponse: read, MessagePageResponseError } = loader()('lib/inbox/read-message-page-response.ts');
const message = { id: 'm1', conversation_id: 'c1', created_at: '2026-09-13T08:00:00Z', direction: 'incoming', raw_payload: { referral: { ad_id: '123' } } };

test('a valid page preserves message metadata and pagination', async () => {
  const result = await read(Response.json({ success: true, messages: [message], hasMore: true }));
  assert.equal(result.messages[0].raw_payload.referral.ad_id, '123');
  assert.equal(result.hasMore, true);
  assert.equal((await read(Response.json({ success: true, messages: [] }))).messages.length, 0);
});

for (const status of [200, 404, 503]) {
  test(`HTML with status ${status} gives a useful error without leaking the page`, async () => {
    await assert.rejects(read(new Response('<!DOCTYPE html><body>PRIVATE PAGE</body>', {
      status, headers: { 'content-type': 'text/html; charset=utf-8' },
    })), error => error instanceof MessagePageResponseError && error.status === status &&
      error.message.includes('HTML page instead of JSON') && !error.message.includes('PRIVATE PAGE'));
  });
}

test('a followed redirect is visible in diagnostics, without logging the destination or body', async () => {
  const response = new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } });
  Object.defineProperty(response, 'redirected', { value: true });
  await assert.rejects(read(response), error => error.redirected && error.message.includes('redirected'));
});

for (const body of ['', '{broken', 'null', '[]', '{"success":true}', '{"success":true,"messages":[null]}']) {
  test(`invalid page ${JSON.stringify(body)} cannot masquerade as an empty success`, async () => {
    await assert.rejects(read(new Response(body)), error => error instanceof MessagePageResponseError);
  });
}

for (const status of [401, 403, 429, 500]) {
  test(`JSON API error ${status} preserves its error and HTTP status`, async () => {
    await assert.rejects(read(Response.json({ success: false, error: 'Request unavailable' }, { status })),
      error => error.status === status && error.message.includes('Request unavailable'));
  });
}

test('cancelling response body reading preserves AbortError', async () => {
  const aborted = new DOMException('Cancelled', 'AbortError');
  await assert.rejects(read({ text: async () => { throw aborted; } }), error => error === aborted);
});

function route({ access, queryThrows = false, conversation = {}, rows = [message], onPage, query = '' } = {}) {
  let pageCalls = 0;
  const db = database({ conversations: [{ id: 'c1', business_id: 'b1', ...conversation }] });
  const load = loader({
    '@/lib/inbox/get-inbox-resource-access': { getInboxConversationAccess: access ?? (async () => ({ success: true, member: { business_id: 'b1' } })) },
    '@/lib/supabase/admin': { supabaseAdmin: queryThrows ? { from: () => { throw new Error('Database transport failed'); } } : db },
    '@/lib/inbox/get-messages': { MESSAGE_PAGE_SIZE: 25, getMessagePage: async () => { pageCalls++; onPage?.(db); return { messages: rows, hasMore: false, nextCursor: null }; } },
    '@/lib/facebook/get-post-preview': {},
  }, { console: { error() {}, warn() {} } });
  const { GET } = load('app/api/conversations/[conversationId]/messages/route.ts');
  return { db, get: () => GET({ nextUrl: new URL('https://example.com/api/conversations/c1/messages' + query) }, { params: Promise.resolve({ conversationId: 'c1' }) }), pageCalls: () => pageCalls };
}

const oldComment = { platform: 'facebook', source_type: 'comment', updated_at: '2026-09-13T08:00:00Z', last_message_at: message.created_at };
const dm = { ...message, platform_message_id: 'mid1', platform_created_at: message.created_at };
test('opening the latest page repairs a historical comment badge', async () => {
  const api = route({ conversation: oldComment, rows: [dm] });
  assert.equal((await api.get()).status, 200);
  assert.equal(api.db.tables.conversations[0].source_type, 'messenger');
});
test('historical pagination cannot change the current channel', async () => {
  const api = route({ conversation: oldComment, rows: [dm], query: '?beforeCreatedAt=2026-09-14T00:00:00Z&beforeId=m2' });
  await api.get(); assert.equal(api.db.tables.conversations[0].source_type, 'comment');
});
test('a concurrent conversation change prevents stale channel repair', async () => {
  const api = route({ conversation: oldComment, rows: [dm], onPage: db => { db.tables.conversations[0].updated_at = '2026-09-14T00:00:00Z'; } });
  await api.get(); assert.equal(api.db.tables.conversations[0].source_type, 'comment');
});

for (const scenario of ['access exception', 'query exception']) {
  test(`${scenario} is contained in the message API JSON boundary`, async () => {
    const api = route(scenario === 'access exception' ? { access: async () => { throw new Error('Auth initialization failed'); } } : { queryThrows: true });
    const response = await api.get();
    assert.equal(response.status, 500);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).success, false);
    assert.equal(api.pageCalls(), 0);
  });
}

test('denied access stays denied and never fetches messages', async () => {
  const api = route({ access: async () => ({ success: false, status: 403, error: 'Forbidden' }) });
  const response = await api.get();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Forbidden');
  assert.equal(api.pageCalls(), 0);
});

test('authorized API response still returns the newest page', async () => {
  const api = route();
  assert.equal((await read(await api.get())).messages[0].id, 'm1');
  assert.equal(api.pageCalls(), 1);
});
