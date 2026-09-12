const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function route({ authenticated = true, count = 3, reminderError = null } = {}) {
  const calls = [], exports = {};
  const query = {};
  for (const method of ['select','eq','gte','lt']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.then = (resolve, reject) => Promise.resolve({ count, error: reminderError }).then(resolve, reject);
  const admin = {
    rpc: async (name, args) => { calls.push(['rpc',name,args]); return { data: { summary: { currentUnread: 4, currentUnassigned: 2, waitingOverSla: 1 } }, error: null }; },
    from: name => { calls.push(['from',name]); return query; },
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-01-01T00:30:00Z'])); }
  }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/analytics/conversations/route.ts','utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports, Date: FixedDate, console, process: { env: {} },
    require: name => {
      if (name === 'next/server') return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
      if (name === '@/lib/auth/get-current-member') return { getCurrentMember: async () => authenticated ? { success: true, member: { business_id: 'authorized-workspace', id: 'member', role: 'owner' } } : { success: false, status: 401, error: 'Sign in' } };
      if (name === '@/lib/supabase/admin') return { supabaseAdmin: admin };
      throw Error(name);
    },
  });
  return { calls, get: period => exports.GET({ nextUrl: new URL(`https://app.test/api/analytics/conversations?period=${period}&tzOffsetMinutes=-420`) }) };
}

for (const period of ['today','yesterday','7d','30d']) test(`overdue follows ${period}'s exact report bounds and authorized workspace`, async () => {
  const h = route(); const result = await h.get(period);
  const args = h.calls.find(c => c[0] === 'rpc')[2];
  assert.equal(result.status,200);
  assert.equal(result.body.analytics.summary.overdueReminders,3);
  assert(h.calls.some(c => c[0] === 'eq' && c[1] === 'business_id' && c[2] === 'authorized-workspace'));
  assert(h.calls.some(c => c[0] === 'eq' && c[1] === 'status' && c[2] === 'open'));
  assert(h.calls.some(c => c[0] === 'gte' && c[1] === 'remind_at' && c[2] === args.p_start));
  assert(h.calls.some(c => c[0] === 'lt' && c[1] === 'remind_at' && c[2] === args.p_end));
  assert(h.calls.some(c => c[0] === 'select' && c[2].head === true && c[2].count === 'exact'));
  assert.equal(result.body.analytics.summary.currentUnread,4);
});

test('reminder failure preserves other metrics and returns unknown, never a false zero', async () => {
  const h = route({ reminderError: { message: 'unavailable' }, count: null });
  const { body } = await h.get('today');
  assert.equal(body.analytics.summary.overdueReminders,null);
  assert.equal(body.analytics.summary.waitingOverSla,1);
  assert.equal(body.warnings.length,1);
});
test('unauthenticated dashboard requests cannot read a workspace', async () => {
  const h = route({ authenticated: false });
  assert.equal((await h.get('today')).status,401);
  assert.equal(h.calls.length,0);
});
