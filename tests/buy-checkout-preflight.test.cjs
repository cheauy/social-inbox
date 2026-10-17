/* eslint-disable @typescript-eslint/no-require-imports -- Offline React checkout flow. */
const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const {loader}=require('./tenh-seven/harness.cjs');
const BUSINESS='00000000-0000-4000-8000-000000000002',ID='original-saved';
async function fixture(options={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/dashboard/subscription/buy'}),previous={};
 Object.defineProperty(dom.window.document,'hidden',{configurable:true,value:false});
 for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){previous[key]=global[key];global[key]=value;}
 const requests=[],navigations=[],timers=new Map(),listeners=new Set();let sequence=0,clock=0,transfers=0,releaseDiscovery,releaseCheckout;
 const later=(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:clock+delay});return id;};
 dom.window.setTimeout=later;dom.window.clearTimeout=id=>timers.delete(id);
 dom.window.open=()=>{throw Error('Unexpected popup/new window');};
 dom.window.TenhAbaPaywayBridge={isReady:()=>true,checkout(){transfers++;}};
 const state={failDiscovery:options.failDiscovery,holdDiscovery:options.holdDiscovery,holdCheckout:options.holdCheckout,existing:options.existing};
 const record={kind:'payway',id:ID,businessId:BUSINESS,businessName:'Saved workspace',planCode:'mini',billingCycle:'monthly',amount:13,currency:'USD',reference:ID,status:'pending',environment:'production',application:'pending',invoiceId:null,...options.record};
 const wait=(init,save)=>new Promise((resolve,reject)=>{save(resolve);init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
 const fetcher=async(url,init={})=>{
  requests.push({url,method:init.method||'GET',body:init.body?JSON.parse(init.body):null,signal:init.signal});
  if(url==='/api/workspaces/create-subscription')return Response.json({success:true,businessId:BUSINESS,paymentUrl:'/dashboard/subscription/payment?plan=mini&cycle=monthly&purchase_business='+BUSINESS});
  if(url.startsWith('/api/bakong/checkout?'))return Response.json({success:true,retired:true,enabled:false,businessId:BUSINESS,userId:'user',memberId:'member'});
  if(url.startsWith('/api/manual-payments?')){
   if(state.holdDiscovery)await wait(init,resolve=>{releaseDiscovery=resolve;});
   if(state.failDiscovery)return Response.json({success:false,error:'Unable to check saved payment.'},{status:503});
   return Response.json({success:true,businessId:BUSINESS,payWayAttemptId:state.existing&&!options.existingAfterDiscovery?ID:null,payWayReviewRequired:options.reviewRequired,config:{enabled:true,bankName:'Fixture bank',accountName:'Fixture',accountNumber:'0'},request:options.manualSubmitted?{id:'manual-original',status:'submitted'}:null});
  }
  if(url==='/api/payway/checkout'){
   if(state.holdCheckout)await wait(init,resolve=>{releaseCheckout=resolve;});
   if(state.existing)return Response.json({success:false,transactionId:ID,businessId:BUSINESS},{status:409});
   return Response.json({success:true,transactionId:ID,checkoutUrl:'https://checkout.synthetic.invalid/purchase',fields:{tran_id:ID,amount:'13.00',hash:'synthetic'}});
  }
  if(url.startsWith('/api/subscription/payment-status?'))return Response.json({success:true,attempt:options.manualSubmitted?{...record,kind:'manual',id:'manual-original',status:'submitted',environment:'manual'}:record});
  if(url.startsWith('/api/payway/status?'))return Response.json({success:true});
  throw Error('Unexpected request '+url);
 };
 const router={replace(url){navigations.push(url);if(options.failNavigation)throw Error('Synthetic navigation failure');}};
 const testWindow=new Proxy(dom.window,{get(target,key){if(key==='location')return{origin:target.location.origin,href:target.location.href,replace:path=>navigations.push(path)};return Reflect.get(target,key,target);}});
 const Link=({children,href,...props})=>React.createElement('a',{href,...props},children);
 const load=loader({react:React,'next/navigation':{useRouter:()=>router,useSearchParams:()=>new URLSearchParams()},'next/link':{default:Link,__esModule:true},
  'next/script':{default:()=>null,__esModule:true},
  '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=>options.language||'en'},
  '@/lib/supabase/client':{createClient:()=>({auth:{onAuthStateChange(callback){listeners.add(callback);return{data:{subscription:{unsubscribe(){listeners.delete(callback);}}}};}}})},
 },{window:testWindow,document:dom.window.document,navigator:dom.window.navigator,fetch:fetcher,AbortController,URLSearchParams,setTimeout:later,clearTimeout:id=>timers.delete(id),performance:{now:()=>clock}});
 const Component=load(options.custom?'components/subscription/custom-subscription-builder.tsx':'components/subscription/buy-subscription-view.tsx')[options.custom?'CustomSubscriptionBuilder':'BuySubscriptionView'];
 const root=createRoot(dom.window.document.querySelector('#root'));
 await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Component))));
 const buy=()=>[...dom.window.document.querySelectorAll('button')].find(b=>options.custom?b.textContent==='Continue to payment':b.hasAttribute('aria-busy')&&b.textContent.includes('Standard'));
 return{dom,state,requests,navigations,record,timers,transfers:()=>transfers,buy,
  click:async()=>act(async()=>{buy().click();buy()?.click();}),
  release:async()=>act(async()=>{state.holdDiscovery=false;releaseDiscovery();}),
  releaseCheckout:async()=>act(async()=>{state.holdCheckout=false;releaseCheckout();}),
  async advance(ms){const target=clock+ms;for(let count=0;count<1000;count++){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;timers.delete(next[0]);clock=next[1].at;await act(async()=>{void next[1].fn();});}clock=target;},
  async chooseManual(){await act(async()=>dom.window.document.querySelector('[data-checkout-method-chooser] input[value="manual"]').click());},
  async closeManual(){await act(async()=>dom.window.document.querySelector("dialog[open] header button").click());},
  async choosePayWay(){await act(async()=>dom.window.document.querySelector('[data-checkout-method-chooser] input[value="payway"]').click());},
  async pay(){await act(async()=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Checkout').click());},
  async closeChooser(){await act(async()=>dom.window.document.querySelector('button[aria-label="Close checkout"]').click());},
  async signout(){await act(async()=>{for(const listener of listeners)listener('SIGNED_OUT');});},
  async close(){await act(async()=>root.unmount());dom.window.close();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}}
 };
}
test('Buy preflight opens an unselected method chooser; only an explicit choice and continue can open PayWay',async()=>{
 const f=await fixture({holdDiscovery:true});try{
  await f.click();assert.equal(f.requests.filter(r=>r.url==='/api/workspaces/create-subscription').length,1);
  assert.equal(f.navigations.length,0);assert.equal(f.transfers(),0);assert.equal(f.dom.window.location.pathname,'/dashboard/subscription/buy');
  assert.ok(f.dom.window.document.querySelector('button[aria-busy=true][disabled] [class*="animate-spin"]'));
  assert.ok(!f.dom.window.document.body.textContent.includes('Checking existing payment'));
  await f.release();await f.advance(100);assert.equal(f.requests.filter(r=>r.url==='/api/payway/checkout').length,0);assert.equal(f.transfers(),0);assert.ok(f.dom.window.document.querySelector('[data-checkout-method-chooser]'));assert.ok(!f.dom.window.document.querySelector('[data-checkout-method-chooser] input:checked'));await f.choosePayWay();assert.equal(f.transfers(),0);await f.pay();assert.equal(f.transfers(),1);
  assert.equal(f.navigations.length,1);assert.ok(f.navigations[0].includes('tran_id='+ID));assert.match(f.dom.window.document.body.textContent,/Checking payment/);
 }finally{await f.close();}
});
test('preflight error is near Buy; retry reuses known workspace and preserves manual choice',async()=>{
 const f=await fixture({failDiscovery:true});try{
  await f.click();assert.equal(f.navigations.length,0);assert.equal(f.transfers(),0);assert.ok(!f.buy().disabled);
  const alert=f.dom.window.document.querySelector('[role=alert]');assert.match(alert.textContent,/Unable to check/);assert.ok(alert.closest('section').contains(f.buy()));
  f.state.failDiscovery=false;await f.click();await f.advance(100);assert.equal(f.requests.filter(r=>r.url==='/api/workspaces/create-subscription').length,1);assert.equal(f.transfers(),0);await f.chooseManual();assert.equal(Boolean(f.dom.window.document.querySelector('input[type=file]')),false);await f.pay();assert.ok(f.dom.window.document.querySelector('input[type=file]'));
 }finally{await f.close();}
});
for(const status of ['pending','approved','expired'])test('Buy resumes original '+status+' attempt without another provider checkout',async()=>{
 const record=status==='approved'?{status:'approved',application:'active'}:status==='expired'?{checkoutExpiresAt:'2026-10-17T11:59:59Z',serverTime:'2026-10-17T12:00:00Z'}:{};
 const f=await fixture({existing:true,record});try{
  await f.click();await f.advance(5100);assert.equal(f.transfers(),0);assert.ok(f.navigations[0].includes('tran_id='+ID));assert.equal(f.requests.filter(r=>r.url==='/api/payway/checkout').length,0);
  if(status==='approved')assert.match(f.dom.window.document.body.textContent,/Payment successful/);
  if(status==='expired'){assert.equal(f.navigations.at(-1),'/dashboard/subscription');assert.equal(f.requests.filter(r=>r.url.startsWith('/api/payway/status?')).length,0);await f.advance(1000);assert.equal(f.navigations.length,2);}
 }finally{await f.close();}
});
test('manual selection remains available through the same Buy preflight and never starts PayWay',async()=>{
 const f=await fixture();try{await f.click();await f.advance(100);await f.chooseManual();await f.pay();assert.equal(f.transfers(),0);assert.equal(f.requests.filter(r=>r.url==='/api/payway/checkout').length,0);assert.ok(f.dom.window.document.querySelector('input[type=file]'));await f.advance(30000);assert.ok(f.dom.window.document.querySelector('input[type=file]'));}finally{await f.close();}
});
test('submitted manual proof resumes review and cannot start another checkout',async()=>{
 const f=await fixture({manualSubmitted:true});try{await f.click();await f.advance(5100);assert.match(f.dom.window.document.body.textContent,/Payment submitted/);assert.equal(f.transfers(),0);assert.ok(!f.requests.some(r=>r.url==='/api/payway/checkout'));}finally{await f.close();}
});
test('unmount during checkout preparation aborts response and cannot later open provider or navigate',async()=>{
 const f=await fixture({holdCheckout:true});await f.click();await f.advance(100);await f.choosePayWay();await f.pay();assert.equal(f.transfers(),0);const request=f.requests.find(r=>r.url==='/api/payway/checkout');assert.ok(request);await f.close();assert.equal(request.signal.aborted,true);assert.deepEqual(f.navigations,[]);
});
test('navigation interruption preserves saved status and still opens exactly one provider iframe',async()=>{
 const f=await fixture({failNavigation:true});try{await f.click();await f.advance(100);assert.equal(f.transfers(),0);await f.choosePayWay();await f.pay();assert.equal(f.transfers(),1);assert.equal(f.requests.filter(r=>r.url==='/api/payway/checkout').length,1);assert.match(f.dom.window.document.body.textContent,/Checking payment/);}finally{await f.close();}
});
test('Custom subscription uses the same guarded button flow',async()=>{
 const f=await fixture({custom:true,holdDiscovery:true});try{await f.click();assert.equal(f.navigations.length,0);assert.ok(f.dom.window.document.querySelector('button[aria-busy=true]'));await f.release();await f.advance(100);assert.equal(f.transfers(),0);assert.ok(f.dom.window.document.querySelector('[data-checkout-method-chooser]'));await f.choosePayWay();await f.pay();assert.equal(f.transfers(),1);}finally{await f.close();}
});

test('a checkout created after discovery still resumes via server POST conflict without opening provider',async()=>{
 const f=await fixture({existing:true,existingAfterDiscovery:true});try{await f.click();await f.advance(5100);assert.equal(f.transfers(),0);await f.choosePayWay();await f.pay();await f.advance(5100);assert.equal(f.transfers(),0);assert.equal(f.requests.filter(r=>r.url==='/api/payway/checkout').length,1);assert.ok(f.navigations[0].includes('tran_id='+ID));}finally{await f.close();}
});

test('sign-out during Buy preflight cannot restore prior private attempt or open checkout',async()=>{
 const f=await fixture({holdDiscovery:true});try{await f.click();await f.signout();await f.advance(1000);assert.equal(f.transfers(),0);assert.deepEqual(f.navigations,[]);assert.ok(!f.requests.some(r=>r.url==='/api/payway/checkout'));assert.ok(f.buy());}finally{await f.close();}
});

test('switching checkout options and closing chooser never starts or cancels payment',async()=>{
 const f=await fixture();try{await f.click();await f.advance(100);await f.chooseManual();assert.equal(Boolean(f.dom.window.document.querySelector('input[type=file]')),false);await f.pay();assert.ok(f.dom.window.document.querySelector('input[type=file]'));await f.closeManual();await f.choosePayWay();assert.equal(Boolean(f.dom.window.document.querySelector('input[type=file]')),false);await f.chooseManual();assert.equal(Boolean(f.dom.window.document.querySelector('input[type=file]')),false);await f.pay();assert.ok(f.dom.window.document.querySelector('input[type=file]'));assert.equal(f.transfers(),0);assert.ok(!f.requests.some(r=>r.url==='/api/payway/checkout'));await f.closeManual();await f.closeChooser();assert.equal(f.navigations.at(-1),'/dashboard/subscription');assert.ok(!f.requests.some(r=>r.url.includes('cancel')));}finally{await f.close();}
});

test('ended unresolved checkout stays in review across reload/tabs instead of reopening the old attempt',async()=>{
 for(const language of ['en','km'])for(let tab=0;tab<2;tab++){
  const f=await fixture({existing:true,reviewRequired:true,language});try{
   await f.click();await f.advance(60000);
   assert.match(f.dom.window.document.querySelector('h1').textContent,language==='en'?/Previous payment needs review/:/ការទូទាត់ពីមុនត្រូវការពិនិត្យ/);
   const saved=[...f.dom.window.document.querySelectorAll('a')].find(a=>a.href.includes('tran_id='+ID));assert.ok(saved);
   assert.equal(f.transfers(),0);assert.deepEqual(f.navigations,[]);
   assert.ok(!f.requests.some(r=>r.url==='/api/payway/checkout'||r.url.startsWith('/api/payway/status?')||r.url.startsWith('/api/subscription/payment-status?')));
   assert.equal(f.dom.window.document.querySelector('[data-checkout-method-chooser]'),null);
  }finally{await f.close();}
 }
});
