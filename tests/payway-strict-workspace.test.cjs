/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic route/auth contract checks; no real payment API. */
const test=require('node:test'),assert=require('node:assert/strict');
const {loader,database}=require('./tenh-seven/harness.cjs');

function harness(selected='removed',patch={}){
 const owner=business=>({id:'member-'+business,user_id:'user',business_id:business,full_name:'Synthetic owner',email:'fixture@example.invalid',role:'owner',is_active:true});
 const db=database({team_members:[owner('active'),owner('expired'),{...owner('removed'),is_active:false}],
  business_subscriptions:[{business_id:'active',status:'active',plan_code:'mini',billing_cycle:'monthly',member_limit:1,channel_limit:3,
    current_period_start:new Date(Date.now()-86400000).toISOString(),current_period_end:new Date(Date.now()+86400000).toISOString(),pricing_snapshot:{}},
    {business_id:'expired',status:'expired',plan_code:'mini',billing_cycle:'monthly',member_limit:1,channel_limit:3,last_paid_amount:12,last_paid_currency:'USD',
    current_period_start:'2026-01-01T00:00:00Z',current_period_end:'2026-02-01T00:00:00Z',pricing_snapshot:{renewal_total_cents:1200}}],
  manual_payment_requests:[],billing_transactions:[]});
 const memo=new Map(),effects=[];let selectedWorkspace=selected;
 db.storage={from:()=>({createSignedUploadUrl:async path=>{effects.push({upload:path});return {data:{token:'synthetic-token'},error:null};}})};
 const load=loader({
  react:{cache:fn=>fn},'next/headers':{cookies:async()=>({get:()=>selectedWorkspace?{value:selectedWorkspace}:undefined})},
  '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})}})},
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/server/usage-context':{attributeUsage:()=>{}},
  '@/lib/server/request-scope':{requestMemo:(key,fn)=>{if(!memo.has(key))memo.set(key,fn());return memo.get(key);}},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>true,permissionDenied:error=>new Response(JSON.stringify({error}),{status:403})},
  '@/lib/subscription/sync-subscription-lifecycle':{syncBusinessSubscriptionLifecycle:async business=>effects.push({sync:business})},
  '@/lib/payway/config':{getPayWayConfig:()=>({environment:'sandbox',liveEnabled:false,merchantId:'synthetic',apiKey:'synthetic',appUrl:'https://synthetic.invalid',
    purchaseUrl:'https://synthetic.invalid/purchase',callbackUrl:'https://synthetic.invalid/callback'}),getPayWayReadiness:()=>({readyToAcceptLivePayments:false,liveBlockers:[]})},
  '@/lib/billing/manual-payment-config':{getManualPaymentConfig:()=>({enabled:true,bankName:'Synthetic',accountName:'Synthetic',accountNumber:'Synthetic'})},
  '@/lib/billing/manual-payment-payway-safety':{getManualPaymentPayWaySafety:async()=>({blocked:false})},
  '@/lib/payway/close-transaction':{closePayWayTransaction:async()=>{throw Error('No real provider call allowed');}},
  '@/lib/payway/finalize-payment':{verifyAndFinalizePayWayTransaction:async()=>{throw Error('No real provider call allowed');}},
  ...patch,
 },{URLSearchParams});
 const request=(body,path='/api/payway/checkout')=>new Request('https://synthetic.invalid'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {db,effects,load,request,memo,select:business=>{selectedWorkspace=business;memo.clear();}};
}

const routes=[
 {name:'PayWay checkout',invoke:h=>h.load('app/api/payway/checkout/route.ts').POST(h.request({planCode:'mini',billingCycle:'monthly'}))},
 {name:'manual proof prepare',invoke:h=>h.load('app/api/manual-payments/route.ts').POST(h.request({action:'prepare-upload',planCode:'mini',billingCycle:'monthly',fileName:'synthetic.png',mimeType:'image/png',sizeBytes:100},'/api/manual-payments'))},
 {name:'upgrade quote',invoke:h=>h.load('app/api/subscription/custom-upgrade/quote/route.ts').GET(new Request('https://synthetic.invalid/api/subscription/custom-upgrade/quote?connections=4&users=1&cycle=monthly&extension=none'))},
];
for(const selected of ['removed','stale-nonmember'])for(const route of routes){
 test(`${route.name} rejects ${selected} instead of silently using another owned workspace`,async()=>{
  const h=harness(selected),before=JSON.stringify(h.db.tables),response=await route.invoke(h);
  assert.equal(response.status,403);const result=await response.json();assert.equal(result.code,'WORKSPACE_ACCESS_REMOVED');assert.equal(result.businessId,selected);
  assert.equal(JSON.stringify(h.db.tables),before);assert.deepEqual(h.effects,[]);
  assert.ok(h.db.history.every(entry=>entry.op==='read'&&entry.table==='team_members'));
 });
}

test('read-only stale-cookie fallback cannot populate the strict Billing auth cache',async()=>{
 const h=harness('stale-nonmember'),auth=h.load('lib/auth/get-current-member.ts');
 const read=await auth.getCurrentMember();assert.equal(read.success,true);assert.equal(read.member.business_id,'active');
 const response=await routes[0].invoke(h);assert.equal(response.status,403);assert.deepEqual(h.effects,[]);
 assert.ok(h.memo.has('current-member'));assert.ok(h.memo.has('current-member-mutation'));
});

for(const selected of ['expired','active'])test(`expired Owner renewal remains bound to intended expired workspace from ${selected} selection`,async()=>{
 const h=harness(selected),beforeActive=JSON.stringify(h.db.tables.business_subscriptions[0]);
 const response=await h.load('app/api/payway/checkout/route.ts').POST(h.request({planCode:'mini',billingCycle:'monthly',renewSame:true,purchaseBusinessId:'expired',amount:0.01}));
 assert.equal(response.status,200,await response.clone().text());
 assert.equal(h.db.tables.billing_transactions.length,1);const saved=h.db.tables.billing_transactions[0];
 assert.equal(saved.business_id,'expired');assert.equal(saved.requested_by_member_id,'member-expired');assert.equal(Number(saved.amount),12);
 assert.equal(saved.renew_same,true);assert.equal(saved.status,'pending');assert.equal(JSON.stringify(h.db.tables.business_subscriptions[0]),beforeActive);
 assert.deepEqual(h.effects,[{sync:'expired'}]);
});

test('manual renewal for valid expired Owner prepares only a synthetic proof upload in the intended workspace',async()=>{
 const h=harness('expired'),before=JSON.stringify(h.db.tables);
 const response=await h.load('app/api/manual-payments/route.ts').POST(h.request({action:'prepare-upload',planCode:'mini',billingCycle:'monthly',renewSame:true,
  purchaseBusinessId:'expired',fileName:'synthetic.png',mimeType:'image/png',sizeBytes:100,amount:0.01},'/api/manual-payments'));
 assert.equal(response.status,200,await response.clone().text());const body=await response.json();assert.equal(body.trustedAmount,'12.00');
 assert.equal(JSON.stringify(h.db.tables),before);assert.equal(h.effects[0].sync,'expired');assert.match(h.effects[1].upload,/^expired\//);
});

test('valid membership in an expired workspace can authenticate but cannot receive an active-period upgrade quote',async()=>{
 const h=harness('expired'),auth=await h.load('lib/auth/get-current-member.ts').getCurrentMember(true);
 assert.equal(auth.success,true);assert.equal(auth.member.business_id,'expired');
 const response=await routes[2].invoke(h);assert.equal(response.status,409);
 assert.equal((await response.json()).success,false);assert.deepEqual(h.effects,[]);
});

test('explicit unauthorized purchase target is rejected before lifecycle, provider or upload work',async()=>{
 const h=harness('active');
 for(const [file,body] of [['app/api/payway/checkout/route.ts',{planCode:'mini',billingCycle:'monthly',purchaseBusinessId:'stale-nonmember'}],
   ['app/api/manual-payments/route.ts',{action:'prepare-upload',planCode:'mini',billingCycle:'monthly',purchaseBusinessId:'stale-nonmember'}]]){
   assert.equal((await h.load(file).POST(h.request(body))).status,403);
 }
 const response=await h.load('app/api/subscription/custom-upgrade/quote/route.ts').GET(new Request('https://synthetic.invalid/api/subscription/custom-upgrade/quote?business_id=stale-nonmember'));
 assert.equal(response.status,403);assert.deepEqual(h.effects,[]);
});
