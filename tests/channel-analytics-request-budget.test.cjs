const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./inbox-recovery-harness.cjs');

async function run(conversations, messagesPerConversation) {
  const reads = [], business = 'tenant-a', now = new Date().toISOString();
  const rows = Array.from({ length: conversations }, (_, i) => ({ id: 'c' + i, business_id: business, social_account_id: 's1', platform: 'facebook', source_type: 'messenger', status: 'open', unread_count: 0, contact_id: 'p' + i, created_at: now }));
  let activeMessages = 0, maxMessageConcurrency = 0, transferred = 0;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.ids = []; this.head = false; }
    select(_, options) { this.head = Boolean(options?.head); return this; }
    eq(k,v) { this.filters.push([k,'eq',v]); return this; }
    gte(k,v) { this.filters.push([k,'gte',v]); return this; }
    lt(k,v) { this.filters.push([k,'lt',v]); return this; }
    or() { return this; } order() { return this; }
    in(k,v) { this.ids = v; this.filters.push([k,'in',v]); return this; }
    range(from,to) { return this.read(from,to); }
    then(a,b) { return this.read().then(a,b); }
    async read(from=0,to=Infinity) {
      reads.push({ table: this.table, from, to, filters: this.filters });
      assert.ok(this.filters.some(([k,op,v]) => k === 'business_id' && op === 'eq' && v === business), 'all DB reads remain tenant scoped');
      if (this.head) return { data: null, count: 0, error: null };
      if (this.table === 'social_accounts') return { data: [{ id: 's1', platform: 'facebook', account_name: 'Fixture' }], error: null };
      if (this.table === 'conversations') { const data = rows.slice(from,to+1); transferred += data.length; return { data, error: null }; }
      activeMessages++; maxMessageConcurrency = Math.max(maxMessageConcurrency, activeMessages); await Promise.resolve(); activeMessages--;
      const size = this.ids.length * messagesPerConversation, count = Math.max(0, Math.min(size,to+1) - from);
      const data = Array.from({ length: count }, (_, offset) => ({ conversation_id: this.ids[Math.floor((from+offset)/messagesPerConversation)], direction: 'incoming', created_at: now, platform_created_at: now }));
      transferred += count;
      return { data, error: null };
    }
  }
  const load = loader({ '@/lib/auth/get-current-member': { getCurrentMember: async () => ({ success: true, member: { business_id: business } }) }, '@/lib/supabase/admin': { supabaseAdmin: { from: table => new Query(table) } } });
  const result = await (await load('app/api/analytics/channels/route.ts').GET({ nextUrl: new URL('https://fixture.invalid/api/analytics/channels?period=90d') })).json();
  assert.equal(result.success,true); assert.equal(result.summary.conversations,conversations);
  const messageReads = reads.filter(r => r.table === 'messages'), chunks = Math.ceil(conversations/200);
  assert.equal(maxMessageConcurrency, conversations ? 1 : 0);
  assert.ok(messageReads.every(r => !r.filters.some(([k,op]) => ['created_at','platform_created_at'].includes(k) && ['gte','lt'].includes(op))), 'message walks have no date bound');
  return { conversations, messagesPerConversation, chunks, totalReads: reads.length, messageReads: messageReads.length, transferredRows: transferred, maxMessageConcurrency };
}

test('real Channel route exposes sequential raw-history request amplification in bounded mocks', async () => {
  const cases = [];
  for (const [conversations, messagesPerConversation] of [[30,10],[200,10],[201,10],[1000,10]]) cases.push(await run(conversations,messagesPerConversation));
  assert.deepEqual(cases.map(c => c.totalReads), [4,6,7,19]);
  console.log(JSON.stringify({ channelAnalyticsBudget: cases }));
});

test('fetchAllRows treats reaching its configured cap as success without a completeness marker', async () => {
  let calls = 0;
  const helper = loader()('lib/supabase/fetch-all-rows.ts');
  const result = await helper.fetchAllRows(() => ({ range: async (from,to) => { calls++; return { data: Array.from({length:to-from+1}, (_,i) => ({ id: from+i })), error: null }; } }), { maxRows: 2000 });
  assert.equal(calls,2); assert.equal(result.data.length,2000); assert.equal(result.error,null); assert.equal(result.truncated,undefined);
});
