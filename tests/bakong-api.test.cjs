/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { loader } = require('./tenh-seven/harness.cjs'), { database } = require('./bakong-fixture.cjs');

// A read-only Supabase query adapter over the real isolated PostgreSQL fixture.
function postgresClient(db) {
  class Query {
    constructor(table) { this.table = table; this.columns = '*'; this.filters = []; this.values = []; this.orders = []; this.maximum = null; }
    select(columns) { this.columns = columns; return this; }
    eq(column, value) { this.values.push(value); this.filters.push(`"${column}"=$${this.values.length}`); return this; }
    in(column, values) { if (!values.length) this.filters.push('false'); else this.filters.push(`"${column}" in (${values.map(value => { this.values.push(value); return '$' + this.values.length; }).join(',')})`); return this; }
    order(column, options = {}) { this.orders.push(`"${column}" ${options.ascending === false ? 'desc' : 'asc'}`); return this; }
    limit(value) { this.maximum = value; return this; }
    async execute(single = false) {
      try {
        const columns = this.columns === '*' ? '*' : this.columns.split(',').map(value => `"${value}"`).join(',');
        const sql = `select ${columns} from "${this.table}"${this.filters.length ? ' where ' + this.filters.join(' and ') : ''}${this.orders.length ? ' order by ' + this.orders.join(',') : ''}${this.maximum ? ' limit ' + this.maximum : ''}`;
        // PostgREST preserves timestamp microseconds; PGlite's Date decoding would lose them.
        const rows = (await db.query(`select row_to_json(q)::text payload from (${sql}) q`, this.values)).rows.map(row => JSON.parse(row.payload));
        if (single && rows.length > 1) return { data: null, error: { code: 'PGRST116' } };
        return { data: single ? rows[0] ?? null : rows, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    }
    maybeSingle() { return this.execute(true); }
    then(resolve, reject) { return this.execute().then(resolve, reject); }
  }
  return { from: table => new Query(table), async rpc(name, args = {}) {
    try {
      const entries = Object.entries(args);
      const result = await db.query(`select public."${name}"(${entries.map(([key], i) => `"${key}"=>$${i + 1}`).join(',')}) as data`, entries.map(([,value]) => value));
      return { data: result.rows[0].data, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } };
}

async function fixture(environment = 'sandbox', accountType = 'merchant') {
  const ctx = await database();
  const seeded = await ctx.trial(), userId = randomUUID(), memberId = randomUUID();
  await ctx.db.query("insert into team_members(id,user_id,business_id,role,is_active) values($1,$2,$3,'owner',true)", [memberId,userId,seeded.businessId]);
  const state = { userId, admin: false, calls: 0, observation: 'paid', losePrepare: false };
  const env = { NODE_ENV: 'production', TENH_APP_ORIGIN: 'https://app.tenhchat.com', BAKONG_ENVIRONMENT: environment,
    BAKONG_API_CONTRACT: 'v1-md5', BAKONG_API_BASE_URL: environment === 'production' ? 'https://api-bakong.nbc.gov.kh' : 'https://sit-api-bakong.nbc.gov.kh',
    BAKONG_ACCOUNT_TYPE: accountType, BAKONG_ACCOUNT_ID: accountType === 'individual' ? 'individual@devb' : 'merchant@devb', BAKONG_MERCHANT_ID: accountType === 'merchant' ? '12345' : '',
    BAKONG_MERCHANT_NAME: 'TENH CHAT', BAKONG_MERCHANT_CITY: 'Phnom Penh', BAKONG_ACQUIRING_BANK: accountType === 'merchant' ? 'DEV BANK' : '',
    BAKONG_API_TOKEN: 'synthetic-private-api-token', BAKONG_CHECKOUT_ENABLED: 'true' };
  const pg = postgresClient(ctx.db), rpc = pg.rpc.bind(pg);
  pg.rpc = async (name, args) => { const result = await rpc(name,args); if(result.error) state.lastRpcError=result.error; if (name === 'tenh_prepare_bakong_payment' && state.losePrepare && !result.error) { state.losePrepare = false; return { data: null, error: { code: 'NETWORK' } }; } return result; };
  const provider = loader({ 'server-only': {} })('lib/bakong/provider.ts');
  const load = loader({ '@/lib/supabase/admin': { supabaseAdmin: pg }, '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null }, error: null }) } }) },
    '@/lib/auth/require-permission': { memberHasPermission: async member => member.role === 'owner' },
    '@/lib/subscription/sync-subscription-lifecycle': { syncBusinessSubscriptionLifecycle: async () => {} },
    '@/lib/billing/require-billing-admin': { getBillingAdminUser: async () => state.admin ? { success: true, user: { id: userId } } : { success: false, status: 403, error: 'Forbidden' } },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    './provider': { generateBakongQr: provider.generateBakongQr, checkBakongTransaction: async (config, expected) => {
      state.calls++; await new Promise(resolve => setTimeout(resolve, 30));
      if (state.observation !== 'paid') return { state: state.observation, retryAfterSeconds: 7200 };
      return { state: 'paid', settlement: { md5: expected.md5, hash: 'a'.repeat(64), recipient: expected.recipient,
        amount: expected.amount, currency: 'USD', environment: config.environment } };
    } },
  }, { process: { env }, Buffer, fetch: () => { throw new Error('Real network is forbidden in this fixture'); } });
  const config = load('lib/bakong/config.ts').getBakongConfig();
  const checkout = load('app/api/bakong/checkout/route.ts'), status = load('app/api/bakong/payments/[attemptId]/route.ts');
  const body = { businessId: seeded.businessId, purchaseIntent: randomUUID(), planCode: 'mini', billingCycle: 'monthly',
    connections: null, users: null, renewSame: false, customUpgrade: false, extensionBillingCycle: 'none' };
  const post = (url, payload, headers = {}) => new Request('https://app.tenhchat.com' + url, { method: 'POST', headers: { Origin: 'https://app.tenhchat.com', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  return { ...ctx, seeded, userId, memberId, state, config, env, pg, load, body, post, checkout, status,
    async capacity() { await ctx.db.query("insert into tenh_bakong_private.capacity_reviews values($1,$2,'production',true,100,100,20,'synthetic fixture review',$3,now())", [config.fingerprint, config.accountId,userId]); },
    async start() { const response = await checkout.POST(post('/api/bakong/checkout', body)); assert.equal(response.status,200,JSON.stringify({response:await response.clone().json(),rpcError:state.lastRpcError})); return response.json(); },
    async check(id) { return status.POST(post('/api/bakong/payments/' + id, { businessId: seeded.businessId, action: 'check' }), { params: Promise.resolve({attemptId:id}) }); },
    async read(id, businessId = seeded.businessId) { return status.GET(new Request(`https://app.tenhchat.com/api/bakong/payments/${id}?purchase_business=${businessId}`), { params: Promise.resolve({attemptId:id}) }); }
  };
}

test('server quote, lost response, concurrent clicks and cross-tab checks retain one exact attempt', async () => {
  const f = await fixture();
  try {
    f.state.losePrepare = true;
    const [one,two] = await Promise.all([f.start(),f.start()]);
    assert.equal(one.attemptId,two.attemptId);
    assert.equal((await f.db.query('select count(*)::int n from billing_transactions')).rows[0].n,1);
    const view = await (await f.read(one.attemptId)).json();
    const catalog = f.load('lib/subscription/plan-catalog.ts'), money = f.load('lib/bakong/money.ts');
    assert.equal(view.attempt.amount, money.centsDecimal(catalog.getTrustedSubscriptionQuote({planCode:'mini',billingCycle:'monthly'}).totalCents));
    assert.match(view.attempt.qrImage,/^data:image\/png;base64,/);
    assert.equal(view.attempt.recipientName, f.config.merchantName, 'the payee label comes from server configuration, not the customer workspace');
    assert.ok(Number.isFinite(Date.parse(view.attempt.createdAt)), 'automatic scheduling uses the saved server creation time');
    assert.ok(!JSON.stringify(view).includes(f.env.BAKONG_API_TOKEN)); assert.ok(!JSON.stringify(view).includes(f.config.fingerprint));
    assert.equal(view.attempt.md5,undefined); assert.equal(view.attempt.qr,undefined);
    await Promise.all([f.check(one.attemptId), f.check(one.attemptId)]);
    assert.equal(f.state.calls,1);
    assert.equal((await (await f.read(one.attemptId)).json()).attempt.state,'test_paid');
    assert.equal((await f.start()).attemptId,one.attemptId,'reopening the same intent cannot mint another obligation');
    const resumed = await (await f.checkout.GET(new Request('https://app.tenhchat.com/api/bakong/checkout?purchase_business='+f.body.businessId+'&purchase_intent='+f.body.purchaseIntent))).json();
    assert.equal(resumed.resumeAttemptId,one.attemptId,'a lost response after settlement restores the original intent');
    const history = await (await f.load('app/api/subscription/billing-history/route.ts').GET()).json();
    assert.equal(history.items[0].status,'test_paid'); assert.equal(history.items[0].environment,'sandbox');
    assert.equal(history.summary.approvedUsdTotal,0); assert.equal(history.summary.testUsdTotal,Number(view.attempt.amount));
  } finally { await f.db.close(); }
});

test('provider errors preserve the attempt, shared cooldowns and private evidence; admin reconciliation remains role-gated', async () => {
  const f = await fixture();
  try {
    const started = await f.start(); f.state.observation = 'unresolved';
    const result = await (await f.check(started.attemptId)).json();
    assert.equal(result.attempt.state,'pending'); assert.equal(result.attempt.qrImage,null);
    assert.ok(Date.parse(result.attempt.nextCheckAt) - Date.parse(result.attempt.serverTime) > 7000000);
    await f.check(started.attemptId); assert.equal(f.state.calls,1);
    const admin = f.load('app/api/bakong/admin/route.ts');
    assert.equal((await admin.GET(new Request('https://app.tenhchat.com/api/bakong/admin'))).status,403);
    f.state.admin=true;
    const list = await (await admin.GET(new Request('https://app.tenhchat.com/api/bakong/admin'))).json();
    assert.equal(list.items[0].id,started.attemptId); assert.equal(list.items[0].credential_fingerprint,undefined);
    const reconciled = await admin.POST(f.post('/api/bakong/admin',{attemptId:started.attemptId,action:'reconcile'}));
    assert.equal(reconciled.status,200); assert.equal(f.state.calls,1,'admin cannot bypass the shared provider budget');
  } finally { await f.db.close(); }
});

test('verified payment with a temporary invoice failure retries application without another provider request or charge', async () => {
  const f = await fixture('production');
  try {
    await f.capacity(); const started = await f.start();
    await f.db.exec("create function fixture_api_invoice_failure() returns trigger language plpgsql as $$begin raise exception 'temporary fixture error'; end$$; create trigger fixture_api_invoice_failure before insert on tenh_billing_invoices for each row execute function fixture_api_invoice_failure();");
    const first = await (await f.check(started.attemptId)).json();
    assert.equal(first.attempt.state,'verified'); assert.equal(first.attempt.application,'none'); assert.equal(first.attempt.qrImage,null);
    await f.db.exec('drop trigger fixture_api_invoice_failure on tenh_billing_invoices');
    const second = await (await f.check(started.attemptId)).json();
    assert.equal(second.attempt.application,'active'); assert.equal(f.state.calls,1);
  } finally { await f.db.close(); }
});

test('workspace ownership, removed users, missing sessions, forged state and strict CSRF fail before provider calls', async () => {
  const f = await fixture();
  try {
    const started = await f.start();
    for (const headers of [{Origin:'https://evil.tenhchat.com'}, {Origin:'null'}, {'Content-Type':'text/plain'}]) {
      const response = await f.checkout.POST(f.post('/api/bakong/checkout',f.body,headers)); assert.ok([403,415].includes(response.status));
    }
    assert.equal((await f.checkout.POST(f.post('/api/bakong/checkout',{...f.body, amount:'0.01'}))).status,400);
    const forged = await f.status.POST(f.post('/api/bakong/payments/'+started.attemptId,{businessId:f.body.businessId,action:'check',status:'paid'}),{params:Promise.resolve({attemptId:started.attemptId})});
    assert.equal(forged.status,400);
    assert.equal((await f.read(started.attemptId,randomUUID())).status,403);
    await f.db.query('update team_members set is_active=false where id=$1',[f.memberId]); assert.equal((await f.read(started.attemptId)).status,403);
    f.state.userId=null; assert.equal((await f.read(started.attemptId)).status,401); assert.equal(f.state.calls,0);
  } finally { await f.db.close(); }
});

test('production remains unavailable without reviewed credential capacity; approved fixture activates once and issues a TENH receipt', async () => {
  const f = await fixture('production');
  try {
    const readiness = () => f.checkout.GET(new Request('https://app.tenhchat.com/api/bakong/checkout?purchase_business='+f.body.businessId));
    assert.equal((await (await readiness()).json()).enabled,false);
    assert.equal((await f.checkout.POST(f.post('/api/bakong/checkout',f.body))).status,503);
    assert.equal((await f.db.query('select count(*)::int n from billing_transactions')).rows[0].n,0);
    await f.capacity(); assert.equal((await (await readiness()).json()).enabled,true);
    const started = await f.start(), result = await (await f.check(started.attemptId)).json();
    assert.equal(result.attempt.state,'applied'); assert.equal(result.attempt.application,'active'); assert.ok(result.attempt.invoiceId);
    await f.check(started.attemptId); assert.equal(f.state.calls,1);
    const history = await f.load('app/api/subscription/billing-history/route.ts').GET();
    const data = await history.json(); assert.equal(data.items[0].provider,'bakong'); assert.equal(data.items[0].paymentMethod,'Bakong KHQR'); assert.equal(data.items[0].confirmedPaid,true);
  } finally { await f.db.close(); }
});


test('invalid selection types and mutated intent cannot alter an issued quote or call the provider', async () => {
  const f=await fixture();
  try {
    for(const extra of [{renewSame:'true'},{customUpgrade:1},{connections:'5'},{users:1.5},{users:-1}]) {
      assert.equal((await f.checkout.POST(f.post('/api/bakong/checkout',{...f.body,...extra}))).status,400);
    }
    const started=await f.start();
    assert.equal((await f.checkout.POST(f.post('/api/bakong/checkout',{...f.body,planCode:'pro'}))).status,400);
    assert.equal((await f.read(started.attemptId)).status,200);assert.equal(f.state.calls,0);
  }finally{await f.db.close();}
});

test('Bakong reuses CHAT renewal, custom upgrade and trial-conversion quotes and coverage', async t => {
  for(const scenario of ['trial-conversion','expired-renewal','ordinary-renewal','custom-capacity','custom-extension']) await t.test(scenario,async()=>{
    const f=await fixture('production');
    try {
      await f.capacity();
      if(scenario!=='trial-conversion') await f.db.query("update business_subscriptions set status='active',current_period_start=date_trunc('second',now())-interval '15 days',current_period_end=date_trunc('second',now())+interval '15 days',last_paid_amount=13,pricing_snapshot=null where business_id=$1",[f.body.businessId]);
      if(['expired-renewal','ordinary-renewal'].includes(scenario)){
        await f.db.query("update business_subscriptions set status='expired',current_period_end=now()-interval '1 day' where business_id=$1",[f.body.businessId]);f.body.renewSame=scenario==='expired-renewal';
      }
      if(scenario.startsWith('custom-')) Object.assign(f.body,{planCode:'custom',connections:5,users:2,customUpgrade:true,extensionBillingCycle:scenario==='custom-extension'?'monthly':'none'});
      const baseline=(await f.pg.from('business_subscriptions').select('*').eq('business_id',f.body.businessId).maybeSingle()).data;
      const trusted=f.load('lib/billing/subscription-purchase.ts').getTrustedPlan(f.body.planCode,f.body.billingCycle,f.body.connections,f.body.users,f.body.renewSame,f.body.customUpgrade,f.body.extensionBillingCycle,baseline);
      assert.ok(trusted,scenario);
      const started=await f.start(), saved=(await f.db.query('select * from billing_transactions where id=$1',[started.attemptId])).rows[0];
      assert.equal(saved.amount,trusted.amount);assert.equal(saved.currency,'USD');assert.equal(saved.pricing_snapshot.purchase_type,trusted.purchaseType);
      const result=await(await f.check(started.attemptId)).json();assert.equal(result.attempt.state,'applied',JSON.stringify(result));
      const current=(await f.db.query('select * from business_subscriptions where business_id=$1',[f.body.businessId])).rows[0];
      const invoice=(await f.db.query('select * from tenh_billing_invoices where source_payment_id=$1',[started.attemptId])).rows[0];
      assert.equal(invoice.amount,trusted.amount);assert.equal(invoice.currency,'USD');assert.ok(invoice.period_end);
      if(scenario==='custom-capacity')assert.equal(Date.parse(current.current_period_end),Date.parse(baseline.current_period_end));
      if(scenario==='custom-extension')assert.equal(Date.parse(current.current_period_end),Date.parse(saved.pricing_snapshot.new_period_end));
      await f.check(started.attemptId);assert.equal(f.state.calls,1);
    }finally{await f.db.close();}
  });
});


test('pre-existing active same-plan SQL purchase guard remains authoritative',async()=>{
  const f=await fixture('production');try{
    await f.capacity();await f.db.query("update business_subscriptions set status='active',current_period_start=date_trunc('second',now()),current_period_end=date_trunc('second',now())+interval '1 month' where business_id=$1",[f.body.businessId]);
    const response=await f.checkout.POST(f.post('/api/bakong/checkout',f.body));assert.equal(response.status,503);
    assert.match(f.state.lastRpcError.message,/already active for the current paid period/);
    assert.equal((await f.db.query('select count(*)::int n from billing_transactions')).rows[0].n,0);assert.equal(f.state.calls,0);
  }finally{await f.db.close();}
});


test('individual-account checkout retains production gating, saved QR identity and exactly-once settlement',async t=>{
  for(const environment of ['sandbox','production'])await t.test(environment,async()=>{
    const f=await fixture(environment,'individual');try{
      assert.equal(f.config.accountType,'individual');assert.equal(f.config.merchantId,'');
      if(environment==='production'){
        const request=()=>f.checkout.POST(f.post('/api/bakong/checkout',f.body));
        assert.equal((await request()).status,503,'an individual account is not automatically production eligible');
        const merchantFingerprint=require('node:crypto').createHash('sha256').update(f.env.BAKONG_API_TOKEN).digest('hex');
        await f.db.query("insert into tenh_bakong_private.capacity_reviews values($1,$2,'production',true,100,100,20,'synthetic merchant-only review',$3,now())",[merchantFingerprint,f.config.accountId,f.userId]);
        assert.equal((await request()).status,503,'a merchant configuration review cannot approve an individual configuration');
        assert.equal(f.state.calls,0);await f.capacity();
      }
      const started=await f.start();
      const before=(await f.db.query('select qr,md5 from bakong_payment_attempts where id=$1',[started.attemptId])).rows[0];
      assert.equal(require('bakong-khqr').BakongKHQR.decode(before.qr).data.merchantType,'29');
      assert.equal((await f.start()).attemptId,started.attemptId);
      assert.deepEqual((await f.db.query('select qr,md5 from bakong_payment_attempts where id=$1',[started.attemptId])).rows[0],before);
      const forged=await f.checkout.POST(f.post('/api/bakong/checkout',{...f.body,accountType:'merchant'}));assert.equal(forged.status,400);
      await Promise.all([f.check(started.attemptId),f.check(started.attemptId)]);
      const result=await(await f.read(started.attemptId)).json();
      assert.equal(result.attempt.state,environment==='sandbox'?'test_paid':'applied');assert.equal(f.state.calls,1);
      assert.equal(result.attempt.application,environment==='sandbox'?'none':'active');
    }finally{await f.db.close();}
  });
});

test('an expired or cancelled checkout is never resumed; selecting again issues a new attempt, reference and QR', async () => {
  const f = await fixture();
  try {
    const subscription = async () => (await f.db.query('select * from business_subscriptions where business_id=$1', [f.seeded.businessId])).rows[0];
    const before = await subscription();
    const reopen = async () => (await f.checkout.GET(new Request(`https://app.tenhchat.com/api/bakong/checkout?purchase_business=${f.body.businessId}&purchase_intent=${f.body.purchaseIntent}`))).json();
    const first = await f.start();
    assert.equal((await reopen()).resumeAttemptId, first.attemptId, 'a still-open checkout is resumed');
    await f.db.query("select tenh_request_payment_cancellation('bakong',$1,$2,$3,$4,false)", [first.attemptId, f.seeded.businessId, f.userId, f.memberId]);
    const cancelled = (await (await f.read(first.attemptId)).json()).attempt;
    assert.equal(cancelled.checkout, 'cancelled'); assert.equal(cancelled.qrImage, null);
    assert.equal(cancelled.state, 'pending'); assert.equal(cancelled.reconciliationRequired, false);
    const reopened = await reopen();
    assert.equal(reopened.resumeAttemptId, null); assert.equal(reopened.pendingAttemptId, null); assert.equal(reopened.intentClosed, true);
    const replay = await f.checkout.POST(f.post('/api/bakong/checkout', f.body));
    assert.equal(replay.status, 409); assert.equal((await replay.json()).code, 'CHECKOUT_CLOSED');
    f.body.purchaseIntent = randomUUID();
    const second = await f.start();
    assert.notEqual(second.attemptId, first.attemptId);
    await f.db.exec(`alter table bakong_payment_attempts disable trigger bakong_immutable_attempt_identity;
      update bakong_payment_attempts set expires_at=now()-interval '1 second' where id='${second.attemptId}';
      alter table bakong_payment_attempts enable trigger bakong_immutable_attempt_identity;`);
    assert.equal((await (await f.read(second.attemptId)).json()).attempt.checkout, 'expired');
    assert.equal((await f.checkout.POST(f.post('/api/bakong/checkout', f.body))).status, 409);
    f.body.purchaseIntent = randomUUID();
    const third = await f.start();
    const rows = (await f.db.query('select id,reference,md5 from bakong_payment_attempts')).rows;
    assert.equal(rows.length, 3); assert.equal(new Set(rows.map(r => r.reference)).size, 3); assert.equal(new Set(rows.map(r => r.md5)).size, 3);
    assert.ok(rows.some(r => r.id === third.attemptId));
    assert.equal((await f.db.query("select count(*)::int n from billing_transactions where status='pending'")).rows[0].n, 3, 'closed checkouts keep their unresolved payment record');
    assert.deepEqual(await subscription(), before, 'the current subscription is unchanged until a verified payment is applied');
  } finally { await f.db.close(); }
});
