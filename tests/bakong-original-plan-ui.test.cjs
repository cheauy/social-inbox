/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated React + synthetic transport/time only. No user/admin session or financial action.
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),{randomUUID}=require('node:crypto');
const bootstrap=new JSDOM('<div></div>');global.window=bootstrap.window;global.document=bootstrap.window.document;global.HTMLElement=bootstrap.window.HTMLElement;
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{loader}=require('./tenh-seven/harness.cjs');
async function fixture(options={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid'}),previous={};
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){previous[key]=global[key];global[key]=value;}
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const requests=[],applied=[],deadlines=new Map();let next=0,release,reject;
 const payment={id:'00000000-0000-4000-8000-000000000001',workspaceName:'Synthetic workspace',amount:'13.00',currency:'USD',transactionReference:'a'.repeat(64),planCode:'mini',billingCycle:'monthly',canApplyOriginal:true,...options.payment};
 const load=loader({react:React,'@/lib/billing/payment-cancellation-feature':{KHQR_CHECKOUT_ENABLED:options.enabled!==false,PAYMENT_CANCELLATION_ENABLED:options.otherEnabled??false},'@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=>options.language??'en'}},
  {window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,AbortController,crypto:{randomUUID},fetch:(url,init)=>{
   assert.equal(url,'/api/bakong/admin');assert.equal(init.method,'POST');requests.push(JSON.parse(init.body));
   return new Promise((ok,fail)=>{release=ok;reject=fail;init.signal.addEventListener('abort',()=>fail(new DOMException('Aborted','AbortError')),{once:true});});
  },setTimeout:(fn,ms)=>{assert.equal(ms,30000);const id=++next;deadlines.set(id,fn);return id;},clearTimeout:id=>deadlines.delete(id)});
 const Button=load('components/billing/bakong-original-plan-button.tsx').BakongOriginalPlanButton,root=createRoot(dom.window.document.querySelector('#root'));
 await act(async()=>root.render(React.createElement(React.StrictMode,null,React.createElement(Button,{payment,onApplied:()=>applied.push(true)}))));
 const click=label=>act(async()=>[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent===label).click());
 const type=note=>act(async()=>{const field=dom.window.document.querySelector('textarea');Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value').set.call(field,note);field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 return{dom,requests,applied,click,type,deadlines,payment,
  confirm:()=>act(async()=>{const button=[...dom.window.document.querySelectorAll('dialog button')].find(button=>button.textContent==='Apply original plan');button.click();button.click();}),
  finish:result=>act(async()=>release(Response.json(result,{status:result.success?200:result.code==='RESOLUTION_UNCERTAIN'?503:409}))),
  fail:()=>act(async()=>reject(new TypeError('Synthetic lost acknowledgement'))),
  timeout:()=>act(async()=>{for(const fn of [...deadlines.values()])fn();}),
  close:async()=>{await act(async()=>root.unmount());dom.window.close();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}}
 };
}
test('disabled feature has no financial control and sends nothing',async()=>{const f=await fixture({enabled:false,otherEnabled:true});try{assert.equal(f.dom.window.document.querySelector('button'),null);assert.equal(f.requests.length,0);}finally{await f.close();}});
test('review opens without a write; meaningful reason and explicit confirmation submit once without browser-controlled price, plan or actor',async()=>{
 const f=await fixture();try{
  await f.click('Apply original plan');assert.equal(f.requests.length,0);const confirm=[...f.dom.window.document.querySelectorAll('dialog button')].find(button=>button.textContent==='Apply original plan');assert.equal(confirm.disabled,true);
  await f.type('short');assert.equal(confirm.disabled,true);await f.type('Reviewed exact bank receipt and no replacement purchase.');assert.equal(confirm.disabled,false);
  await f.confirm();assert.equal(f.requests.length,1);assert.equal(f.requests[0].confirmed,true);assert.equal(f.requests[0].expectedTransactionReference,'a'.repeat(64));assert.equal(f.requests[0].action,'apply_original_plan');assert.ok(!['planCode','amount','businessId','actorId'].some(key=>key in f.requests[0]));
  assert.ok([...f.dom.window.document.querySelectorAll('dialog button')].every(button=>button.disabled));await f.finish({success:true,outcome:'applied'});assert.equal(f.applied.length,1);assert.equal(f.dom.window.document.querySelector('dialog'),null);
 }finally{await f.close();}
});
test('lost acknowledgement and timeout stay visible and retry the same audited request identity',async t=>{
 for(const mode of ['lost','timeout'])await t.test(mode,async()=>{const f=await fixture();try{
  await f.click('Apply original plan');await f.type('Reviewed original received-money evidence for this purchase.');await f.confirm();const first=f.requests[0];
  if(mode==='lost')await f.fail();else await f.timeout();assert.ok(f.dom.window.document.querySelector('dialog [role="alert"]'));assert.equal(f.applied.length,0);
  await f.confirm();assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1],first);await f.finish({success:true,outcome:'applied'});assert.equal(f.applied.length,1);
 }finally{await f.close();}});
});
test('baseline or replacement conflicts keep the dialog and case in review without a success callback',async t=>{
 for(const code of ['SUBSCRIPTION_BASELINE_CHANGED','OVERLAPPING_PURCHASE'])await t.test(code,async()=>{const f=await fixture();try{
  await f.click('Apply original plan');await f.type('Reviewed exact bank receipt and original purchase details.');await f.confirm();await f.finish({success:false,outcome:'conflict',code});
  assert.equal(f.applied.length,0);assert.ok(f.dom.window.document.querySelector('dialog'));assert.match(f.dom.window.document.querySelector('[role="alert"]').textContent,code==='OVERLAPPING_PURCHASE'?/overlaps/:/subscription changed/);
  await f.click('Keep in review');assert.equal(f.requests.length,1);assert.equal(f.dom.window.document.querySelector('dialog'),null);
 }finally{await f.close();}});
});
test('advisory ineligibility disables application and explains the conflict',async()=>{const f=await fixture({payment:{canApplyOriginal:false,resolutionConflict:'OVERLAPPING_PURCHASE'}});try{assert.equal(f.dom.window.document.querySelector('button').disabled,true);assert.match(f.dom.window.document.body.textContent,/overlaps/);assert.equal(f.requests.length,0);}finally{await f.close();}});
