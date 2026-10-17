/* eslint-disable @typescript-eslint/no-require-imports */
// Real React with synthetic uploads, saved-state reads and route navigation only.
const test=require('node:test'),assert=require('node:assert/strict'),React=require('react');
const {act}=React,{JSDOM}=require('jsdom');
const {loader}=require('./tenh-seven/harness.cjs');
const business='00000000-0000-4000-8000-000000000002',id='00000000-0000-4000-8000-000000000003';
async function fixture(options={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/dashboard/subscription/payment'}),previous={};
 Object.defineProperty(dom.window.document,'hidden',{configurable:true,value:false});
 for(const[k,v]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){previous[k]=global[k];global[k]=v;}
 const requests=[],navigations=[],state={...options},records=new Map();let release,uploads=0,clock=0,nextTimer=0;const timers=new Map();
 const record=()=>records.get(id);
 const fetcher=async(url,init={})=>{
  const body=init.body?JSON.parse(init.body):null;requests.push({url,method:init.method??'GET',body});
  if(url.startsWith('/api/bakong/checkout?'))return Response.json({success:true,retired:true,enabled:false,businessId:business,userId:'user',memberId:'member'});
  if(url.startsWith('/api/manual-payments?'))return Response.json({success:true,businessId:business,config:{enabled:true,bankName:'Fixture Bank',accountName:'TENH fixture',accountNumber:'00000000',qrImageUrl:options.qrImageUrl??null},request:null});
  if(url==='/api/manual-payments'){
   if(body.action==='prepare-upload'){
    if(state.holdStage==='prepare')await new Promise(()=>{});
    if(!record())records.set(id,{id,kind:'manual',businessId:business,businessName:'Saved workspace',planCode:'mini',billingCycle:'monthly',amount:13,currency:'USD',reference:id,status:'prepared',environment:'manual',application:'pending'});
    return Response.json({success:true,requestId:id,proofUploaded:Boolean(state.uploaded),upload:{bucket:'fixture',path:'same-private-path',token:'fake'}});
   }
   assert.equal(body.action,'finalize-upload');
   if(state.holdStage==='finalize')await new Promise(()=>{});
   if(state.holdFinalize)await new Promise(resolve=>{release=resolve;});
   if(state.failFinalize)return Response.json({success:false,error:'Submission was not confirmed. Please try again.'},{status:503});
   record().status=state.reviewed??'submitted';if(state.reviewed==='approved')record().application='active';
   if(state.lostReply){state.lostReply=false;throw Error('Synthetic final response lost');}
   return Response.json({success:true,request:record()});
  }
  if(url.startsWith('/api/subscription/payment-status?')){if(state.holdRecovery)await new Promise(()=>{});return record()?Response.json({success:true,attempt:record()}):Response.json({success:false},{status:404});}
  throw Error('Unexpected request '+url);
 };
 const client={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},storage:{from:()=>({uploadToSignedUrl:async()=>{uploads++;if(state.holdStage==='upload')await new Promise(()=>{});if(state.failUpload)return{error:{message:'Upload connection failed. Please try again.'}};state.uploaded=true;return{error:null};}})}};
 const load=loader({react:React,'next/script':()=>null,'next/navigation':{useRouter:()=>({replace:url=>navigations.push(url)})},
  '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=>options.language??'en'},'@/lib/supabase/client':{createClient:()=>client},
 },{window:dom.window,document:dom.window.document,navigator:dom.window.navigator,fetch:fetcher,performance:{now:()=>clock},setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id),AbortController,AbortSignal,crypto:{randomUUID:()=>id},URLSearchParams});
 const {createRoot}=require('react-dom/client'),root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(React.createElement(load('components/subscription/subscription-payment-view.tsx').SubscriptionPaymentView,{planCode:'mini',billingCycle:'monthly',purchaseBusinessId:business})));
 const footer=()=>document.querySelector('[data-checkout-footer] button'),dialog=()=>document.querySelector('dialog[open]');
 const click=async element=>act(async()=>element.click());
 return{state,requests,navigations,record,uploads:()=>uploads,dialog,footer,text:()=>document.body.textContent,
  async select(){await click([...document.querySelectorAll('[data-checkout-method-chooser] button')].find(x=>x.textContent.includes('Manual bank transfer')));},
  async open(){await click(footer());},async dismiss(){await click(dialog().querySelector('header button'));},
  async file(){const input=dialog().querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:[new dom.window.File(['synthetic'],'proof.png',{type:'image/png'})]});await act(async()=>input.dispatchEvent(new dom.window.Event('change',{bubbles:true})));},
  async advance(ms){const target=clock+ms;for(let count=0;count<100;count++){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;timers.delete(next[0]);clock=next[1].at;await act(async()=>{void next[1].fn();});}clock=target;},
  submit:()=>dialog().querySelector('button[aria-busy]'),
  click,async release(){state.holdFinalize=false;await act(async()=>release());},
  async close(){await act(async()=>root.unmount());dom.window.close();for(const[k,v]of Object.entries(previous)){if(v===undefined)delete global[k];else global[k]=v;}}
 };
}
test('manual selection uses the common footer; popup guidance, close, focus and selected proof survive reopening',async()=>{
 const f=await fixture();try{
  const footer=f.footer();await f.select();assert.ok(f.footer()===footer);assert.equal(Boolean(document.querySelector('input[type=file]')),false);assert.equal(f.requests.some(x=>x.method==='POST'),false);
  footer.focus();await f.open();assert.ok(f.dialog());assert.ok(document.activeElement===f.dialog());assert.equal(document.body.style.overflowY,'hidden');
  const header=f.dialog().querySelector('header');assert.match(header.textContent,/Make sure the transfer amount and transaction details match your order\. Approval usually takes 1-2 business days\./);
  assert.match(f.dialog().textContent,/Transfer details/);assert.match(f.dialog().textContent,/Scan ABA KHQR/);assert.match(f.dialog().textContent,/Upload payment receipt/);
  await f.file();await f.dismiss();assert.equal(Boolean(f.dialog()),false);assert.ok(document.activeElement===footer);assert.equal(document.body.style.overflowY,'');
  await f.open();assert.match(f.dialog().textContent,/proof\.png/);assert.equal(f.submit().disabled,false);assert.equal(f.requests.some(x=>x.method==='POST'),false);
 }finally{await f.close();}
});
test('upload failure retains the popup and proof; retry reuses one request and only confirmed submission enters review',async()=>{
 const f=await fixture({failUpload:true});try{
  await f.select();await f.open();await f.file();await f.click(f.submit());
  assert.ok(f.dialog());assert.match(f.text(),/Upload connection failed/);assert.match(f.dialog().textContent,/proof\.png/);assert.equal(f.record().status,'prepared');assert.deepEqual(f.navigations,[]);
  f.state.failUpload=false;await f.click(f.submit());
  assert.equal(Boolean(f.dialog()),false);assert.match(f.text(),/Payment submitted/);assert.match(f.text(),/Approval usually takes 1-2 business days\./);assert.equal(f.record().status,'submitted');
  assert.equal(new Set(f.requests.filter(x=>x.body?.action==='prepare-upload').map(x=>x.body.requestId)).size,1);assert.equal(f.requests.filter(x=>x.body?.action==='finalize-upload').length,1);
  assert.equal(Boolean(document.querySelector('time')),false);assert.doesNotMatch(f.text(),/Subscription active|Payment successful|Show QR code/);assert.ok(f.navigations[0].includes('manual_request='+id));assert.ok(f.navigations[0].includes('purchase_business='+business));
 }finally{await f.close();}
});
test('manual QR lightbox repeatedly closes back to the same receipt/note, preserves scroll lock, and never submits',async()=>{
 const src='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="480"/%3E';
 const f=await fixture({qrImageUrl:src});try{
  assert.match(f.text(),/One-time payment\. Activated after approval\./);
  assert.doesNotMatch(f.text(),/Change selection|Safe to go back|Your payment is protected and verified/);
  await f.select();f.footer().focus();await f.open();await f.file();
  const parent=f.dialog(),input=parent.querySelector('input[type=file]'),file=input.files[0],note=parent.querySelector('textarea');
  await act(async()=>{Object.getOwnPropertyDescriptor(note.ownerDocument.defaultView.HTMLTextAreaElement.prototype,'value').set.call(note,'Keep this receipt note');note.dispatchEvent(new note.ownerDocument.defaultView.Event('input',{bubbles:true}));});
  const trigger=parent.querySelector('button[aria-haspopup=dialog]');trigger.focus();
  for(const mode of ['close','escape','close']){
   await f.click(trigger);const preview=[...document.querySelectorAll('dialog[open]')].at(-1);
   assert.notEqual(preview,parent);assert.equal(preview.querySelector('img').getAttribute('src'),src);
   assert.match(preview.querySelector('img').className,/object-contain/);assert.ok(!preview.querySelector('a'));
   assert.equal(document.activeElement,preview.querySelector('button'));assert.equal(document.body.style.overflowY,'hidden');
   await act(async()=>preview.dispatchEvent(new note.ownerDocument.defaultView.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
   assert.equal(document.activeElement,preview.querySelector('button'));
   if(mode==='escape')await act(async()=>preview.dispatchEvent(new note.ownerDocument.defaultView.Event('cancel',{cancelable:true})));
   else await f.click(preview.querySelector('button'));
   assert.equal(document.querySelectorAll('dialog[open]').length,1);assert.equal(f.dialog(),parent);assert.equal(document.activeElement,trigger);
   assert.equal(input.files[0],file);assert.equal(note.value,'Keep this receipt note');assert.equal(document.body.style.overflowY,'hidden');
  }
  assert.equal(f.requests.some(x=>x.method==='POST'),false);assert.equal(f.uploads(),0);assert.deepEqual(f.navigations,[]);
  await f.dismiss();assert.equal(document.body.style.overflowY,'');assert.equal(document.activeElement,f.footer());
 }finally{await f.close();}
});
test('repeated submission and closing while saving cannot duplicate or abandon the confirmed receipt',async()=>{
 const f=await fixture({holdFinalize:true});try{
  await f.select();await f.open();await f.file();const submit=f.submit();await act(async()=>{submit.click();submit.click();});
  assert.equal(f.requests.filter(x=>x.body?.action==='prepare-upload').length,1);assert.equal(f.requests.filter(x=>x.body?.action==='finalize-upload').length,1);assert.equal(f.uploads(),1);
  assert.equal(f.dialog().querySelector('header button').disabled,true);const event=new window.Event('cancel',{cancelable:true});await act(async()=>f.dialog().dispatchEvent(event));assert.ok(f.dialog());
  await f.release();assert.equal(Boolean(f.dialog()),false);assert.equal(f.record().status,'submitted');assert.equal(f.navigations.length,1);
 }finally{await f.close();}
});
for(const lostReply of [false,true])test('finalize '+(lostReply?'lost response is reconciled by exact saved identity':'error keeps proof for retry without a second upload'),async()=>{
 const f=await fixture({lostReply,failFinalize:!lostReply});try{
  await f.select();await f.open();await f.file();await f.click(f.submit());
  if(!lostReply){assert.ok(f.dialog());assert.match(f.text(),/Submission was not confirmed/);assert.equal(f.uploads(),1);f.state.failFinalize=false;await f.click(f.submit());assert.equal(f.uploads(),1);}
  assert.equal(Boolean(f.dialog()),false);assert.equal(f.record().status,'submitted');assert.match(f.text(),/Payment submitted/);assert.equal(f.navigations.length,1);
 }finally{await f.close();}
});

for(const stage of ['prepare','upload','finalize'])test(stage+' timeout restores retry/close controls while preserving the receipt and request identity',async()=>{
 const f=await fixture({holdStage:stage});try{
  await f.select();await f.open();await f.file();await f.click(f.submit());assert.equal(f.submit().disabled,true);
  await f.advance(31000);assert.ok(f.dialog());assert.equal(f.dialog().querySelector('header button').disabled,false);assert.equal(f.submit().disabled,false);
  assert.match(f.text(),/Submission is not confirmed yet/);assert.match(f.text(),/proof\.png/);assert.deepEqual(f.navigations,[]);
  f.state.holdStage=null;await f.click(f.submit());assert.equal(f.record().status,'submitted');assert.equal(f.navigations.length,1);
  assert.equal(new Set(f.requests.filter(x=>x.body?.requestId).map(x=>x.body.requestId)).size,1);
 }finally{await f.close();}
});
test('a stalled recovery read is bounded too, leaving a closable popup and the same receipt',async()=>{
 const f=await fixture({holdStage:'prepare',holdRecovery:true});try{
  await f.select();await f.open();await f.file();await f.click(f.submit());await f.advance(31000);
  assert.ok(f.dialog());assert.equal(f.dialog().querySelector('header button').disabled,false);assert.match(f.text(),/not confirmed yet/);
  await f.dismiss();assert.equal(Boolean(f.dialog()),false);assert.deepEqual(f.navigations,[]);
 }finally{await f.close();}
});
for(const reviewed of ['approved','rejected'])test('lost submission reply renders exact authoritative '+reviewed+' review outcome',async()=>{
 const f=await fixture({lostReply:true,reviewed});try{
  await f.select();await f.open();await f.file();await f.click(f.submit());
  assert.equal(Boolean(f.dialog()),false);assert.equal(f.record().status,reviewed);assert.equal(f.navigations.length,1);
  assert.match(f.text(),reviewed==='approved'?/Payment successful/:/Payment rejected/);assert.doesNotMatch(f.text(),/Unable to submit|Submission is not confirmed/);
 }finally{await f.close();}
});
