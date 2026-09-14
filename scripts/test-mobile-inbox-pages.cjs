const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('app/api/mobile/bootstrap/route.ts', 'utf8');
function setup(sources) {
  const calls = [];
  const module = { exports: {} };
  const deps = {
    '@/lib/facebook/messenger-source': require('../tests/tenh-seven/harness.cjs').loader()('lib/facebook/messenger-source.ts'),
    '@/lib/server/tenant-read-scope': { withTenantReadScope: fn => fn },
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/auth/require-permission': { loadPermissionContext: async () => ({ success: true, context: { member: { business_id: 'shop' }, permissions: {} } }) },
    '@/lib/inbox/get-conversations': {
      getInboxConversationScope: async () => ({ currentBusinessId: 'shop', accessibleBusinessIds: ['shop'] }),
      getConversations: async (ids, filter) => { calls.push(filter); return Array.from({ length: 31 }, (_, i) => ({ id: String(i), business_id: 'shop', facebook_messenger_sources: sources })); },
    },
  };
  new Function('require','module','exports',ts.transpileModule(source,{ compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(name => deps[name],module,module.exports);
  return { calls, get: query => module.exports.GET({ nextUrl: new URL('https://test/api/mobile/bootstrap?' + query) }) };
}
test('initial page returns 30 with a next-page marker', async () => {
  const app=setup(); const result=await app.get('limit=30');
  assert.equal(result.body.conversations.length,30);
  assert.equal(result.body.hasMore,true); assert.equal(result.body.nextOffset,30);
  assert.deepEqual(app.calls[0].page,{offset:0,size:31});
});
test('next page advances by thirty', async () => {
  const app=setup(); const result=await app.get('limit=30&offset=30');
  assert.deepEqual(app.calls[0].page,{offset:30,size:31});
  assert.equal(result.body.nextOffset,60);
});
test('inaccessible workspaces never load data', async () => {
  const app=setup(); assert.equal((await app.get('limit=30&workspaceIds=other')).status,403);
  assert.equal(app.calls.length,0);
});
for(const value of ['-1','1.5','NaN','100001']) test(`invalid offset ${value} is rejected`,async()=>{
  const app=setup(); assert.equal((await app.get(`limit=30&offset=${value}`)).status,400);
  assert.equal(app.calls.length,0);
});
test('older mobile versions keep their existing response', async()=>{
  const app=setup(); const result=await app.get('');
  assert.equal(app.calls[0].page,undefined); assert.equal(result.body.conversations.length,31);
});

test('mobile source cards retain only the latest twenty validated contexts', async () => {
  const sources = Array.from({ length: 25 }, (_, i) => ({ key: String(i), kind: 'ad', ad_id: '123', message_id: 'mid' + i,
    image_url: 'https://example.com/image.jpg', post_url: 'javascript:alert(1)' }));
  const result = await setup(sources).get('limit=30');
  const saved = result.body.conversations[0].facebook_messenger_sources;
  assert.equal(saved.length, 20);
  assert.equal(saved[0].message_id, 'mid5');
  assert.equal(saved[0].post_url, null);
  assert.equal(saved[0].image_url, sources[0].image_url);
});
