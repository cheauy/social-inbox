/* eslint-disable @typescript-eslint/no-require-imports */
// Real checkout UI, synthetic server props and mocked requests only.
const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const {JSDOM}=require('jsdom'),{loader}=require('./tenh-seven/harness.cjs');
const BUSINESS='00000000-0000-4000-8000-000000000002',ATTEMPT='00000000-0000-4000-8000-000000000001';

test('retired direct Bakong remains absent even when a stale server advertises it; PayWay and manual stay available',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/dashboard/subscription/payment'}),previous={};
  for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){
    previous[key]=global[key];global[key]=value;
  }
  const requests=[];let paywayCalls=0;
  dom.window.TenhAbaPaywayBridge={isReady:()=>true,checkout:()=>{paywayCalls++;throw Error('PayWay must not start');}};
  const fetcher=async(url,init={})=>{
    const path=new URL(url,'https://fixture.invalid').pathname,method=init.method??'GET';
    requests.push({path,method,body:init.body?JSON.parse(init.body):null});
    if(path==='/api/manual-payments'&&method==='GET')return Response.json({success:true,businessId:BUSINESS,request:null,preparedAttempt:null,config:{enabled:true,bankName:"Fixture Bank",accountName:"Synthetic",accountNumber:"0000",qrImageUrl:null}});
    if(path==='/api/bakong/checkout')return Response.json(method==='GET'
      ?{success:true,businessId:BUSINESS,userId:'fixture-user',memberId:'fixture-member',enabled:true,environment:'production',pendingAttemptId:null,resumeAttemptId:null}
      :{success:true,businessId:BUSINESS,attemptId:ATTEMPT});
    throw Error('Unexpected request '+method+' '+path);
  };
  const load=loader({
    react:React,'next/navigation':{useRouter:()=>({replace(){}})},
    'next/script':({onReady})=>{React.useEffect(()=>{onReady?.();},[]);return null;},
    'next/image':props=>{const imageProps={...props};for(const key of ['priority','fill','unoptimized'])delete imageProps[key];return React.createElement('img',imageProps);},
    './payment-attempt-view':{PaymentAttemptView:props=>React.createElement('p',null,'Saved '+props.kind+' '+props.attemptId),paymentAttemptUrl:(kind,id,business)=>'/dashboard/subscription/payment?'+new URLSearchParams({bakong_attempt:id,purchase_business:business})},
    '@/lib/supabase/client':{createClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})},
    '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=> 'en'},
  },{window:dom.window,document:dom.window.document,fetch:fetcher,crypto:require('node:crypto').webcrypto,URLSearchParams,AbortController});
  const Component=load('components/subscription/subscription-payment-view.tsx').SubscriptionPaymentView;
  const root=createRoot(dom.window.document.querySelector('#root'));
  try{
    await act(async()=>root.render(React.createElement(Component,{planCode:'mini',billingCycle:'monthly',purchaseBusinessId:BUSINESS,savedTransactionTotalCents:2537})));
    const buttons=()=>[...dom.window.document.querySelectorAll('button')];
    const payway=buttons().find(button=>button.textContent.trim()==='Checkout');assert.ok(payway);
    const paywaySummary=payway.parentElement;
    assert.match(paywaySummary.textContent,/Total/);assert.match(paywaySummary.textContent,/\$25\.37/);
    assert.equal(buttons().some(button=>button.textContent.trim().startsWith('KHQR')),false);
    assert.ok(buttons().some(button=>button.textContent.includes('ABA KHQR')),'PayWay QR remains available');
    const manual=buttons().find(button=>button.textContent.includes('Manual bank transfer'));
    assert.ok(manual);assert.equal(manual.disabled,false);
    await act(async()=>manual.click());
    assert.ok(dom.window.document.querySelector('input[type=file]'),'manual receipt input remains available');
    assert.equal(requests.filter(request=>request.method==='POST').length,0);
    assert.equal(paywayCalls,0);
  }finally{
    await act(async()=>root.unmount());dom.window.close();
    for(const key of Object.keys(previous)){if(previous[key]===undefined)delete global[key];else global[key]=previous[key];}
  }
});
