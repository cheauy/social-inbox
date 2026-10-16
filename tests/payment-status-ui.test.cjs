/* eslint-disable @typescript-eslint/no-require-imports */
// Real React with synthetic HTTP only. Never contacts a provider or changes a real account.
const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const {JSDOM}=require('jsdom'),{loader}=require('./tenh-seven/harness.cjs');
const BUSINESS='00000000-0000-4000-8000-000000000002';
async function fixture(kind,options={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid'}),previous={};
 Object.defineProperty(dom.window.document,'hidden',{configurable:true,value:false});
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){previous[key]=global[key];global[key]=value;}
 const requests=[];let release,paid=false;
 const saved=()=>({kind,id:'synthetic',businessId:BUSINESS,businessName:'Synthetic workspace',planCode:'mini',billingCycle:'monthly',amount:12,currency:'USD',reference:'synthetic',status:kind==='manual'?'submitted':paid?'approved':'pending',environment:'production',invoiceId:null,application:kind==='manual'?'pending':paid?'active':'pending',effectiveAt:null,reason:null,canRetry:false});
 const fetcher=async(url,init={})=>{requests.push({url,method:init.method??'GET'});if(options.error)return Response.json({success:false},{status:503});if(init.method==='POST')return new Promise(resolve=>{release=()=>{paid=true;resolve(Response.json({success:true}));};});return Response.json({success:true,attempt:saved()});};
 const load=loader({react:React,'@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=> 'en'},'@/lib/supabase/client':{createClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})}},{window:dom.window,document:dom.window.document,navigator:dom.window.navigator,fetch:fetcher,AbortController,URLSearchParams});
 const Component=load('components/subscription/payment-attempt-view.tsx').PaymentAttemptView,root=createRoot(dom.window.document.querySelector('#root'));
 await act(async()=>root.render(React.createElement(Component,{kind,attemptId:'synthetic',businessId:BUSINESS})));
 return{dom,requests,finish:()=>act(async()=>release()),async close(){await act(async()=>root.unmount());dom.window.close();for(const key of Object.keys(previous)){if(previous[key]===undefined)delete global[key];else global[key]=previous[key];}}};
}
test('PayWay checks automatically with a passive spinner, then shows authoritative activation',async()=>{
 const f=await fixture('payway');try{
  const status=f.dom.window.document.querySelector('[aria-live="polite"]');assert.match(status.textContent,/Checking payment/);assert.ok(status.querySelector('[class*="animate-spin"]'));
  assert.equal(f.dom.window.document.querySelector('h1'),null);assert.ok(!f.dom.window.document.body.textContent.includes('Payment status'));
  assert.ok(![...f.dom.window.document.querySelectorAll('button')].some(b=>/Check (status|payment)/.test(b.textContent)));
  assert.equal(f.requests.filter(x=>x.method==='POST').length,1);
  await f.finish();assert.match(status.textContent,/Subscription active/);assert.equal(status.querySelector('[class*="animate-spin"]'),null);
 }finally{await f.close();}
});
test('manual proof waits for admin review with no provider verification or false activation',async()=>{
 const f=await fixture('manual');try{
  assert.match(f.dom.window.document.body.textContent,/Submitted for review/);assert.match(f.dom.window.document.body.textContent,/Awaiting review/);
  assert.equal(f.requests.filter(x=>x.method==='POST').length,0);assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);
  assert.ok(!f.dom.window.document.body.textContent.includes('Subscription active'));
 }finally{await f.close();}
});
test('unavailable verification shows a retry without a normal Check status action or endless spinner',async()=>{
 const f=await fixture('payway',{error:true});try{
  assert.ok(f.dom.window.document.querySelector('[role="alert"]'));assert.ok([...f.dom.window.document.querySelectorAll('button')].some(x=>x.textContent==='Try again'));
  assert.equal(f.dom.window.document.querySelector('[class*="animate-spin"]'),null);assert.equal(f.requests.filter(x=>x.method==='POST').length,0);
 }finally{await f.close();}
});
