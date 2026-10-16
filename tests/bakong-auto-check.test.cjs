/* eslint-disable @typescript-eslint/no-require-imports */
// Real React, synthetic clock/transport/locks only. No hosted data or provider access.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const filename=path.resolve('tests/bakong-expiry.test.cjs'),source=fs.readFileSync(filename,'utf8'),fixtureModule={exports:{}};
vm.runInNewContext(source.slice(0,source.indexOf("test('KHQR card"))+'\nmodule.exports={fixture,START,LIFETIME};',
  {require:createRequire(filename),module:fixtureModule,process,console,Request,Response,Headers,AbortController,global});
const {fixture,START,LIFETIME}=fixtureModule.exports;
const posts=f=>f.requests.filter(request=>request.method==='POST').length;
async function tick(f,ms=0){await f.advance(ms);await f.advance(0);await f.advance(0);}

test('reload preserves the first server-anchored due time and each successful claim keeps a five-minute gap',async()=>{
 const f=await fixture();try{
  await f.render();await tick(f,240000);await f.reload();await tick(f,59999);assert.equal(posts(f),0);
  await tick(f,1);assert.equal(posts(f),1);assert.equal(f.record.automaticChecksRemaining,2);
  await f.reload();await tick(f,299999);assert.equal(posts(f),1);
  await tick(f,1);assert.equal(posts(f),2);
 }finally{await f.close();}
});

test('response transit cannot make a provider check run before its server deadline',async()=>{
 let release,delaying=true;
 const f=await fixture({response:(record,method)=>{if(method==='GET'&&delaying)return new Promise(resolve=>{release=()=>resolve(Response.json({success:true,attempt:record}));});return Response.json({success:true,attempt:record});}});
 try{
  await f.render();delaying=false;f.clock(20000);await require('react').act(async()=>release());
  await tick(f,280000);assert.equal(posts(f),0,'the conservative QR clock must not advance verification');
  await tick(f,20000);assert.equal(posts(f),1);
 }finally{await f.close();}
});

test('hidden overdue attempt verifies promptly on return rather than waiting five more minutes',async()=>{
 const f=await fixture();try{
  await f.render();await f.visibility(true);await tick(f,420000);assert.equal(posts(f),0);
  await f.visibility(false);await tick(f);assert.equal(posts(f),1);
  assert.equal(f.record.expiresAt,new Date(START+LIFETIME).toISOString());
 }finally{await f.close();}
});

test('offline overdue attempt refreshes saved status and verifies promptly when online',async()=>{
 const f=await fixture();try{
  await f.render();await f.network(false);await tick(f,420000);assert.equal(posts(f),0);
  await f.network(true);await tick(f);assert.equal(posts(f),1);
 }finally{await f.close();}
});

test('server cooldown survives reload and network events without early verification',async()=>{
 const f=await fixture({record:{nextCheckAt:new Date(START+720000).toISOString()}});try{
  await f.render();await tick(f,500000);await f.reload();await f.network(true);await tick(f,219999);assert.equal(posts(f),0);
  await tick(f,1);assert.equal(posts(f),1);
 }finally{await f.close();}
});

test('another tab claim discovered by the preflight GET postpones POST to its authoritative cooldown',async()=>{
 const f=await fixture();try{
  await f.render();await tick(f,299999);
  f.setRecord({automaticChecksRemaining:2,nextCheckAt:new Date(START+600000).toISOString()});
  await tick(f,1);assert.equal(posts(f),0,'GET learns the newer claim without spending an inquiry');
  await tick(f,300000);assert.equal(posts(f),1);
 }finally{await f.close();}
});

test('two tabs share a browser lock and issue only one verification POST for the same due time',async()=>{
 let chain=Promise.resolve(),lockCalls=0;
 const locks={request(name,options,work){lockCalls++;const run=chain.then(()=>{if(options.signal.aborted)throw new DOMException('Aborted','AbortError');return work({name});});chain=run.catch(()=>{});return run;}};
 const f=await fixture({tabs:2,locks});try{
  await f.render();await tick(f,300000);assert.equal(posts(f),1);assert.equal(f.record.automaticChecksRemaining,2);assert.ok(lockCalls>=2);
 }finally{await f.close();}
});

test('GET success never creates paid status and repeated visibility events cannot overlap an active check',async()=>{
 let release;
 const f=await fixture({response:(record,method)=>method==='POST'?new Promise(resolve=>{release=()=>resolve(Response.json({success:true,attempt:record}));}):Response.json({success:true,attempt:record})});
 try{
  await f.render();assert.equal(posts(f),0);assert.match(f.dom.window.document.body.textContent,/Waiting for payment/);
  await tick(f,300000);assert.equal(posts(f),1);assert.ok(f.dom.window.document.querySelector('[class*="animate-spin"]'));
  await f.visibility(false);await f.network(true);await tick(f);assert.equal(posts(f),1);
  await require('react').act(async()=>release());await tick(f);assert.equal(posts(f),1);
  assert.equal(f.record.state,'pending');assert.ok(!f.dom.window.document.body.textContent.includes('Subscription active'));
 }finally{await f.close();}
});

test('a lost response re-reads the saved claim and respects its cooldown instead of repeating the provider check',async()=>{
 let failed=false;
 const f=await fixture({response:(record,method)=>{if(method==='POST'&&!failed){failed=true;throw new TypeError('Synthetic lost response after claim');}return Response.json({success:true,attempt:record});}});
 try{
  await f.render();await tick(f,300000);assert.equal(posts(f),1);assert.match(f.dom.window.document.body.textContent,/unavailable/);
  assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);
  await f.network(true);await tick(f);assert.equal(posts(f),1);
  await tick(f,299999);assert.equal(posts(f),1);await tick(f,1);assert.equal(posts(f),2);
 }finally{await f.close();}
});

test('a hanging request times out and queued network recovery reads the persisted claim',async()=>{
 const f=await fixture({response:(record,method,init)=>method==='POST'?new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})):Response.json({success:true,attempt:record})});
 try{
  await f.render();await tick(f,300000);assert.equal(posts(f),1);await f.network(true);
  await tick(f,30000);assert.equal(posts(f),1);assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);
  assert.equal(f.dom.window.document.querySelector('section').getAttribute('aria-busy'),'false');
 }finally{await f.close();}
});

test('exhausted checks and exhausted global capacity stay visible for review without verification retries',async t=>{
 for(const record of [{automaticChecksRemaining:0,canCheck:false,reconciliationRequired:true,reconciliationReason:'INQUIRY_LIMIT_REVIEW'},
  {automaticChecksRemaining:2,canCheck:false,reconciliationRequired:true,reconciliationReason:'DAILY_BUDGET_REVIEW'}])await t.test(record.reconciliationReason,async()=>{
  const f=await fixture({elapsed:420000,record});try{await f.render();await tick(f);await f.reload();await f.network(true);await tick(f);assert.equal(posts(f),0);assert.match(f.dom.window.document.body.textContent,/review/);}finally{await f.close();}
 });
});

test('an expired QR cannot auto-verify from its original checkout or gain a fresh timer on reload',async()=>{
 const f=await fixture({elapsed:LIFETIME+1});try{
  await f.render();await tick(f);await f.reload();await f.network(true);await tick(f);
  assert.equal(posts(f),0);assert.equal(f.dom.window.document.querySelector('figure'),null);assert.equal(f.record.state,'pending');
 }finally{await f.close();}
});
