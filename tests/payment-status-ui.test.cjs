/* eslint-disable @typescript-eslint/no-require-imports */
// Real React, saved synthetic attempts and controlled transport/time. No provider or hosted requests.
const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const {loader}=require('./tenh-seven/harness.cjs');
const BUSINESS='00000000-0000-4000-8000-000000000002',ID='saved-attempt';
async function fixture(options={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/dashboard/subscription/payment'}),previous={};
 Object.defineProperty(dom.window.document,'hidden',{configurable:true,value:false});
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){previous[key]=global[key];global[key]=value;}
 const kind=options.kind??'payway',requests=[],listeners=new Set(),timers=new Map();let sequence=0,clock=options.initialClock??0,release,releaseRead; const navigations=[],BASE=Date.parse("2026-10-17T12:00:00Z");
 const record={kind,id:ID,businessId:BUSINESS,businessName:'Saved workspace',planCode:'mini',billingCycle:'monthly',amount:47.63,currency:'USD',reference:'SAVED-REFERENCE',
  status:kind==='manual'?'submitted':'pending',environment:kind==='manual'?'manual':'production',application:'pending',invoiceId:null,effectiveAt:null,reason:null,canRetry:false,...options.record};
 const state={record,failRead:options.failRead??0,failVerify:options.failVerify??false,holdRead:false};
 const later=(fn,delay,interval=false)=>{const id=++sequence;timers.set(id,{fn,at:clock+delay,interval:interval?delay:0});return id;};
 const fetcher=async(url,init={})=>{
  const method=init.method??'GET';requests.push({url,method});
  if(url.startsWith('/api/subscription/payment-status?')) {
   if(state.holdRead)await new Promise((resolve,reject)=>{releaseRead=resolve;init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
   return state.failRead?Response.json({success:false},{status:state.failRead}):Response.json({success:true,attempt:{...state.record,...(state.record.serverTime?{serverTime:new Date(BASE+clock).toISOString()}: {})}});
  }
  if(url==='/api/workspaces/switch') return Response.json({success:false},{status:503});
  assert.ok(url.startsWith('/api/payway/status?')&&kind==='payway'&&method==='POST','only saved PayWay verification is allowed');
  assert.ok(url.includes('tran_id='+ID)&&url.includes('preserve_workspace=1'));
  if(state.failVerify)return Response.json({success:false},{status:503});
  if(options.holdVerification)return new Promise((resolve,reject)=>{release=()=>resolve(Response.json({success:true}));init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
  return Response.json({success:true});
 };
 const router={replace(path){navigations.push(path);}};
 const load=loader({react:React,'next/navigation':{useRouter:()=>router},'@/lib/billing/payment-cancellation-feature':options.feature??{KHQR_CHECKOUT_ENABLED:true,PAYMENT_CANCELLATION_ENABLED:false},'./bakong-payment-view':{BakongPaymentView:()=>null},
  '@/lib/supabase/client':{createClient:()=>({auth:{onAuthStateChange:callback=>{listeners.add(callback);return{data:{subscription:{unsubscribe(){listeners.delete(callback);}}}};}}})},
  '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=>options.language??'en'},
 },{window:dom.window,document:dom.window.document,navigator:dom.window.navigator,fetch:fetcher,AbortController,URLSearchParams,setTimeout:later,clearTimeout:id=>timers.delete(id),setInterval:(fn,delay)=>later(fn,delay,true),clearInterval:id=>timers.delete(id),performance:{now:()=>clock}});
 const Component=load('components/subscription/payment-attempt-view.tsx').PaymentAttemptView,root=createRoot(dom.window.document.querySelector('#root'));
 await act(async()=>root.render(React.createElement(Component,{kind,attemptId:ID,businessId:BUSINESS,checkoutClosed:options.checkoutClosed})));
 return{dom,requests,state,timers,record,navigations,
  setClosed:async()=>act(async()=>root.render(React.createElement(Component,{kind,attemptId:ID,businessId:BUSINESS,checkoutClosed:true}))),
  text:()=>dom.window.document.body.textContent,
  title:()=>dom.window.document.querySelector('h1')?.textContent,posts:()=>requests.filter(r=>r.method==='POST'),
  release:async()=>act(async()=>release()),
  releaseRead:async()=>act(async()=>{state.holdRead=false;releaseRead();}),
  async advance(ms){const target=clock+ms;for(let count=0;count<10000;count++){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;const[id,timer]=next;clock=timer.at;if(timer.interval)timer.at+=timer.interval;else timers.delete(id);await act(async()=>{void timer.fn();});}clock=target;},
  click:async label=>act(async()=>[...dom.window.document.querySelectorAll('button')].find(x=>x.textContent===label).click()),
  async next(){const timer=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(timer,'scheduled refresh');timers.delete(timer[0]);clock=timer[1].at;await act(async()=>{await timer[1].fn();});},
  async signout(){state.failRead=401;await act(async()=>{for(const listener of listeners)listener('SIGNED_OUT');});},
  async close(){await act(async()=>root.unmount());dom.window.close();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}}
 };
}
test('PayWay uses the approved teal checking card and exact saved amount without extra animation requests',async()=>{
 const f=await fixture({holdVerification:true});try{
  assert.equal(f.title(),'Checking payment');assert.match(f.text(),/Please wait/);assert.match(f.text(),/Waiting for payment confirmation/);
  assert.match(f.text(),/\$47\.63/);assert.ok(!f.text().includes('Sample amount')&&!f.text().includes('$25.00')&&!f.text().includes('Test payment'));
  const spinner=f.dom.window.document.querySelector('[class*="animate-spin"]');assert.ok(spinner);assert.match(spinner.className,/border-t-teal-600/);assert.match(spinner.className,/motion-safe:animate-spin/);assert.match(spinner.className,/motion-reduce:animate-none/);
  assert.equal(spinner.getAttribute('aria-hidden'),'true');assert.ok(f.dom.window.document.querySelector('[role=status][aria-live=polite]'));
  assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent==='Check status'));
  assert.equal(f.posts().length,1);await f.release();assert.equal(f.posts().length,1);assert.equal(f.title(),'Checking payment');
  assert.ok(!f.text().includes('Subscription active'));assert.ok(!f.requests.some(r=>r.url.includes('/checkout')));
 }finally{await f.close();}
});
test('manual submission uses a static amber clock and never claims approval or verifies with PayWay',async()=>{
 const f=await fixture({kind:'manual'});try{
  assert.equal(f.title(),'Under review');assert.match(f.text(),/Receipt submitted/);assert.match(f.text(),/Awaiting manual verification/);
  assert.ok(f.dom.window.document.querySelector('[class*="text-amber-500"]'));assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);
  for(let i=0;i<3;i++)await f.next();assert.equal(f.posts().length,0);assert.equal(f.title(),'Under review');assert.ok(!f.text().includes('Subscription active'));
 }finally{await f.close();}
});
test('close X is a keyboard accessible navigation link and makes no cancellation mutation',async()=>{
 const f=await fixture({kind:'manual',feature:{KHQR_CHECKOUT_ENABLED:true,PAYMENT_CANCELLATION_ENABLED:true}});try{
  assert.ok([...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent==='Withdraw proof'),'explicit withdrawal remains separate from close');
  const close=f.dom.window.document.querySelector('a[aria-label="Close payment status"]');assert.ok(close);assert.equal(close.getAttribute('href'),'/dashboard/subscription');
  assert.match(close.className,/h-11 w-11/);assert.match(close.className,/focus-visible:outline/);close.focus();assert.equal(f.dom.window.document.activeElement,close);
  close.addEventListener('click',event=>event.preventDefault());await act(async()=>close.click());assert.equal(f.posts().length,0);
 }finally{await f.close();}
});
test('verification timeout stops the spinner and offers an accessible retry for the same saved attempt',async()=>{
 const f=await fixture({holdVerification:true});try{
  await f.next();assert.equal(f.title(),'Unable to check payment');assert.ok(f.dom.window.document.querySelector('[role=alert]'));
  assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);assert.ok([...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent==='Try again'&&!b.disabled));
  assert.equal(f.posts().length,1);
 }finally{await f.close();}
});
test('failed verification retries only the saved identity and does not create another checkout',async()=>{
 const f=await fixture({failVerify:true});try{
  assert.equal(f.title(),'Unable to check payment');f.state.failVerify=false;await f.click('Try again');
  assert.equal(f.posts().length,2);assert.equal(f.title(),'Checking payment');assert.ok(!f.requests.some(r=>r.url.includes('/checkout')));
 }finally{await f.close();}
});
test('the existing twenty-refresh limit stops the spinner until explicit status retry',async()=>{
 const f=await fixture();try{
  for(let i=1;i<20;i++)await f.next();assert.equal(f.posts().length,20);assert.equal(f.timers.size,0);
  assert.match(f.text(),/Confirmation is taking longer than expected/);assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);
  await f.click('Check status');assert.equal(f.posts().length,21);assert.equal(f.title(),'Checking payment');
 }finally{await f.close();}
});
test('saved historical and review outcomes cannot become active through the new presentation',async()=>{
 for(const record of [{status:'approved',application:'historical'},{status:'recovery_required',application:'review'}]){
  const f=await fixture({record});try{assert.ok(!f.text().includes('Subscription active'));assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent==='Continue'));assert.equal(f.posts().length,0);assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);}finally{await f.close();}
 }
});
test('Khmer manual review and saved currency render without copied mockup values',async()=>{
 const f=await fixture({kind:'manual',language:'km',record:{amount:22500,currency:'KHR'}});try{assert.equal(f.title(),'កំពុងពិនិត្យ');assert.match(f.text(),/បានផ្ញើបង្កាន់ដៃ/);assert.match(f.text(),/22,500/);assert.match(f.text(),/KHR/);assert.ok(!f.text().includes('$25.00'));}finally{await f.close();}
});

test('only authoritative saved activation ends checking and enables Continue',async()=>{
 const f=await fixture({holdVerification:true});try{
  assert.equal(f.title(),'Checking payment');Object.assign(f.record,{status:'approved',application:'active'});await f.release();
  assert.equal(f.title(),'Payment successful');assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);
  assert.ok([...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent==='Go to inbox'));assert.equal(f.posts().length,1);
 }finally{await f.close();}
});
test('unavailable saved status exposes no amount and remains retryable without a provider request',async()=>{
 const f=await fixture({failRead:503});try{
  assert.equal(f.title(),'Unable to check payment');assert.ok(!f.text().includes('$47.63'));assert.equal(f.posts().length,0);
  assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);assert.ok([...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent==='Try again'));
 }finally{await f.close();}
});

test('workspace navigation failure never replaces the authoritative confirmed payment status',async()=>{
 const f=await fixture({record:{status:'approved',application:'active'}});try{
  const confirmed=f.title();assert.match(confirmed,/Subscription active|Payment successful/);
  const label=[...f.dom.window.document.querySelectorAll('button')].some(b=>b.textContent==='Go to inbox')?'Go to inbox':'Continue';
  await f.click(label);assert.equal(f.title(),confirmed,'workspace navigation is separate from payment verification');
  assert.match(f.text(),/Unable to open workspace/);assert.ok(!f.text().includes('Unable to check payment'));
  assert.equal(f.requests.filter(r=>r.url==='/api/workspaces/switch').length,1);assert.equal(f.requests.filter(r=>r.url.startsWith('/api/payway/status?')).length,0);
 }finally{await f.close();}
});

const deadlineRecord=(seconds=600)=>({checkoutExpiresAt:new Date(Date.parse('2026-10-17T12:00:00Z')+seconds*1000).toISOString(),serverTime:'2026-10-17T12:00:00Z'});
test('ten-minute saved countdown is inside card beside accessible X; expiry replaces once and never cancels',async()=>{
 const f=await fixture({record:deadlineRecord()});try{
  const time=f.dom.window.document.querySelector('time');assert.equal(time.textContent,'10:00600 seconds');assert.ok(time.closest('[data-payment-card]'));
  assert.ok(f.dom.window.document.querySelector('details').closest('[data-payment-card]'));assert.ok(![...f.dom.window.document.querySelectorAll('a')].some(a=>a.textContent==='Back to subscription'));
  await f.advance(599000);assert.equal(f.dom.window.document.querySelector('time span').textContent,'00:01');assert.deepEqual(f.navigations,[]);
  const posts=f.posts().length;await f.advance(1000);assert.deepEqual(f.navigations,['/dashboard/subscription']);assert.equal(f.posts().length,posts);
  assert.equal(f.record.status,'pending');await f.advance(5000);assert.equal(f.navigations.length,1);assert.ok(f.posts().length<30,'no provider call per countdown second');
 }finally{await f.close();}
});
test('newly reopened expired saved link performs read-only final check with no provider inquiry or timer reset',async()=>{
 const f=await fixture({record:deadlineRecord(-1)});try{assert.deepEqual(f.navigations,['/dashboard/subscription']);assert.equal(f.posts().length,0);assert.equal(f.record.status,'pending');}finally{await f.close();}
});
test('deadline waits for in-flight verification and paid activation wins at boundary',async()=>{
 const f=await fixture({holdVerification:true,record:deadlineRecord(5)});try{
  await f.advance(5000);assert.deepEqual(f.navigations,[]);assert.equal(f.posts().length,1);
  Object.assign(f.record,{status:'approved',application:'active'});await f.release();assert.equal(f.title(),'Payment successful');assert.deepEqual(f.navigations,[]);
  await f.advance(5000);assert.deepEqual(f.navigations,[]);
 }finally{await f.close();}
});
test('pending verification at boundary closes only after final saved read, preserving late payment evidence',async()=>{
 const f=await fixture({holdVerification:true,record:deadlineRecord(5)});try{
  await f.advance(5000);assert.deepEqual(f.navigations,[]);await f.release();assert.deepEqual(f.navigations,['/dashboard/subscription']);assert.equal(f.record.status,'pending');assert.equal(f.posts().length,1);
 }finally{await f.close();}
});
test('a paid result racing the final expiry read keeps success instead of navigating away',async()=>{
 const f=await fixture({record:deadlineRecord(2)});try{
  f.state.holdRead=true;await f.advance(2000);assert.deepEqual(f.navigations,[]);
  Object.assign(f.record,{status:'approved',application:'active'});await f.releaseRead();assert.equal(f.title(),'Payment successful');assert.deepEqual(f.navigations,[]);
 }finally{await f.close();}
});
test('unmount aborts expiry read and clears all timers without redirecting',async()=>{
 const f=await fixture({record:deadlineRecord(2)});f.state.holdRead=true;await f.advance(2000);await f.close();assert.equal(f.timers.size,0);assert.deepEqual(f.navigations,[]);
});
test('old deadline-less attempts have an honest fallback and sandbox truth is inside details only',async()=>{
 const f=await fixture({checkoutClosed:true,record:{environment:'sandbox'}});try{
  assert.equal(f.title(),'Checkout closed');assert.equal(f.record.status,'pending');assert.equal(f.dom.window.document.querySelector('time'),null);assert.match(f.text(),/No checkout deadline was saved/);
  const details=f.dom.window.document.querySelector('details');assert.match(details.textContent,/Test payment/);assert.ok(details.closest('[data-payment-card]'));assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);
 }finally{await f.close();}
});
test('manual submitted review ignores PayWay checkout deadline and never auto-closes',async()=>{
 const f=await fixture({kind:'manual',record:deadlineRecord(2)});try{await f.advance(5000);assert.equal(f.title(),'Under review');assert.equal(f.posts().length,0);assert.deepEqual(f.navigations,[]);assert.equal(f.dom.window.document.querySelector('time'),null);}finally{await f.close();}
});
test('provider iframe close stops checking presentation without changing saved payment or issuing cancellation',async()=>{
 const f=await fixture();try{
  await act(async()=>{const container=f.dom.window.document.createElement('div');container.id='aba-checkout';container.innerHTML='<iframe name="aba_webservice"></iframe>';f.dom.window.document.body.appendChild(container);});
  assert.equal(f.title(),'Checking payment');await act(async()=>f.dom.window.document.querySelector('#aba-checkout').remove());assert.equal(f.title(),'Checkout closed');assert.equal(f.record.status,'pending');assert.equal(f.posts().length,1);
 }finally{await f.close();}
});

test('reload uses saved original deadline and elapsed server time instead of resetting to ten minutes',async()=>{
 const f=await fixture({initialClock:120000,record:deadlineRecord()});try{assert.equal(f.dom.window.document.querySelector('time span').textContent,'08:00');await f.advance(1000);assert.equal(f.dom.window.document.querySelector('time span').textContent,'07:59');assert.equal(f.record.checkoutExpiresAt,deadlineRecord().checkoutExpiresAt);}finally{await f.close();}
});

test('provider return hint updates an already mounted attempt without resetting its identity or checking again',async()=>{
 const f=await fixture();try{assert.equal(f.title(),'Checking payment');const count=f.posts().length;await f.setClosed();assert.equal(f.title(),'Checkout closed');assert.equal(f.posts().length,count);assert.equal(f.record.status,'pending');}finally{await f.close();}
});
