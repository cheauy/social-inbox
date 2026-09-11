const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness({ allowed = true, active = true, conversationError = false } = {}) {
  const queries = [];
  let tokenReads = 0;
  const rows = {
    messages: { id: 'm', business_id: 'b', conversation_id: 'c' },
    conversations: { id: 'c', business_id: 'b', social_account_id: 's' },
    social_accounts: { id: 's', business_id: 'b', platform: 'facebook', platform_account_id: 'p', is_active: active },
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('app/api/facebook/comments/_shared.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, require(name) {
    if (name.includes('get-facebook-page-access-token')) return {
      resolveStoredFacebookPageAccessToken(row) { tokenReads++; assert.equal(row.id, 's'); return 'test-token'; },
    };
    if (name.includes('get-inbox-resource-access')) return {
      authorizeInboxBusinessAccess: async id => {
        assert.equal(id, 'b');
        return allowed ? { success: true, member: { business_id: 'b' } } : { success: false, status: 403, error: 'Denied' };
      },
    };
    if (name.includes('supabase/admin')) return { supabaseAdmin: { from(table) {
      const query = { table, filters: [] }; queries.push(query);
      return { select() { return this; }, eq(...args) { query.filters.push(args); return this; },
        async maybeSingle() { return { data: rows[table], error: conversationError && table === 'conversations' }; },
      };
    } } };
    throw Error(name);
  } });
  return { run: () => exports.loadAuthorizedFacebookCommentActionContext({ commentId: 'fb-comment' }), queries, tokens: () => tokenReads };
}

test('authorized action reads its Page once and keeps workspace filters', async () => {
  const h = harness();
  assert.equal((await h.run()).pageAccessToken, 'test-token');
  assert.deepEqual(h.queries.map(q => q.table), ['messages', 'conversations', 'social_accounts']);
  for (const q of h.queries.slice(1)) assert(q.filters.some(([key, value]) => key === 'business_id' && value === 'b'));
  assert.equal(h.tokens(), 1);
});
test('denied access never loads Page credentials, including concurrent read failure', async () => {
  for (const conversationError of [false, true]) {
    const h = harness({ allowed: false, conversationError });
    await assert.rejects(h.run(), error => error.status === 403);
    assert.equal(h.tokens(), 0);
    assert(!h.queries.some(q => q.table === 'social_accounts'));
  }
});
test('disconnected Page cannot resolve credentials', async () => {
  const h = harness({ active: false });
  await assert.rejects(h.run(), /not active/);
  assert.equal(h.tokens(), 0);
});
test('conversation lookup failure stops the action', async () => {
  const h = harness({ conversationError: true });
  await assert.rejects(h.run(), /Unable to verify/);
  assert.equal(h.tokens(), 0);
});
