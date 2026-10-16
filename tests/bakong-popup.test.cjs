/* eslint-disable @typescript-eslint/no-require-imports */
// Native dialog surface is mocked in JSDOM; transport and time remain isolated and synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{act}=require('react');
const file=path.resolve('tests/bakong-expiry.test.cjs'),source=fs.readFileSync(file,'utf8'),fixtureModule={exports:{}};
vm.runInNewContext(source.slice(0,source.indexOf("test('KHQR card"))+'\nmodule.exports={fixture,START,LIFETIME};',{module:fixtureModule,require:createRequire(file),process,console,Request,Response,Headers,AbortController,global});
const {fixture,START,LIFETIME}=fixtureModule.exports;
const closeButton=f=>f.dom.window.document.querySelector('button[aria-label="Close payment window"]');

test('centered labelled QR dialog hides outer metadata while preserving support details and server amount',async()=>{
 const f=await fixture({record:{reference:'REF-LOCAL-SUPPORT-123'}});try{
  await f.render();const dialog=f.dom.window.document.querySelector('dialog');assert.ok(dialog.open);assert.equal(dialog.getAttribute('aria-modal'),'true');
  assert.ok(f.dom.window.document.getElementById(dialog.getAttribute('aria-labelledby')));assert.ok(f.dom.window.document.getElementById(dialog.getAttribute('aria-describedby')));
  assert.ok(dialog.classList.contains('m-auto'));assert.ok(dialog.classList.contains('max-w-md'));assert.ok(dialog.querySelector('section').classList.contains('overflow-y-auto'));
  const details=[...dialog.querySelectorAll('details')].find(x=>x.querySelector('summary')?.textContent==='Payment details');assert.ok(details);assert.equal(details.open,false);
  assert.ok(details.textContent.includes(f.record.reference));assert.ok(details.textContent.includes(f.record.workspaceName));
  const main=dialog.cloneNode(true);main.querySelectorAll('details').forEach(node=>node.remove());
  assert.ok(!main.textContent.includes(f.record.workspaceName));assert.ok(!main.textContent.includes(f.record.reference));assert.ok(!main.textContent.includes('Bakong KHQR'));
  const card=dialog.querySelector('figure');assert.match(card.textContent,/SYNTHETIC RECEIVER/);assert.ok(card.querySelector('[aria-label="32.53 USD"]'));
  assert.match(closeButton(f).parentElement.textContent,/Expires in 15:00/);assert.equal(f.dom.window.document.activeElement,closeButton(f));
 }finally{await f.close();}
});
test('X dismisses to Subscription once, restores focus, and leaves the session, expiry and payment untouched',async()=>{
 const f=await fixture();try{
  const opener=f.dom.window.document.createElement('button');opener.textContent='Open saved payment';f.dom.window.document.body.prepend(opener);opener.focus();
  await f.render();const before=JSON.stringify(f.record),count=f.requests.length;
  await act(async()=>{closeButton(f).click();closeButton(f).click();});
  assert.equal(f.dom.window.document.querySelector('dialog').open,false);assert.equal(f.dom.window.document.activeElement,opener);
  assert.deepEqual(Array.from(f.navigations),['/dashboard/subscription']);assert.equal(JSON.stringify(f.record),before);assert.equal(f.requests.length,count);
  await f.advance(600000);assert.equal(f.requests.filter(x=>x.method==='POST').length,0);assert.equal(f.navigations.length,1);
 }finally{await f.close();}
});
test('Escape uses dialog cancellation to dismiss only, with no cancellation or workspace mutation request',async()=>{
 const f=await fixture();try{
  await f.render();const dialog=f.dom.window.document.querySelector('dialog'),event=new f.dom.window.Event('cancel',{cancelable:true});
  await act(async()=>dialog.dispatchEvent(event));assert.equal(event.defaultPrevented,true);assert.equal(dialog.open,false);
  assert.deepEqual(Array.from(f.navigations),['/dashboard/subscription']);assert.ok(f.requests.every(x=>x.method==='GET'));assert.equal(f.record.state,'pending');
  assert.equal(f.record.expiresAt,new Date(START+LIFETIME).toISOString());
 }finally{await f.close();}
});
test('waiting animation is decorative; checking and terminal display follow the actual request and saved result',async()=>{
 let finish;const f=await fixture({response:(record,method)=>method==='POST'?new Promise(resolve=>{finish=()=>resolve(Response.json({success:true,attempt:{...record,state:'applied',application:'active',qrImage:null,canCheck:false}}));}):Response.json({success:true,attempt:record})});
 try{
  await f.render();const status=f.dom.window.document.querySelector('[aria-live="polite"]'),section=f.dom.window.document.querySelector('section');
  assert.match(status.textContent,/Waiting for payment/);assert.ok(status.querySelector('[class*="animate-spin"]'));assert.equal(section.getAttribute('aria-busy'),'false');assert.equal(f.requests.filter(x=>x.method==='POST').length,0);
  await f.advance(300000);await f.advance(0);await f.advance(0);assert.match(status.textContent,/Checking payment/);assert.equal(section.getAttribute('aria-busy'),'true');
  await act(async()=>finish());assert.match(status.textContent,/Subscription active/);assert.equal(status.querySelector('[class*="animate-spin"]'),null);assert.equal(section.getAttribute('aria-busy'),'false');
 }finally{await f.close();}
});
test('future Cancel only navigates after authoritative closure, while uncertain or failed responses stay visible',async t=>{
 for(const outcome of ['checkout_closed','expired','reconciliation_required','processing','paid','failure'])await t.test(outcome,async()=>{
  const f=await fixture({cancellation:true,cancelResponse:()=>outcome==='failure'?Response.json({success:false},{status:503}):Response.json({success:true,outcome})});
  try{
   await f.render();const before=JSON.stringify(f.record),find=()=>[...f.dom.window.document.querySelectorAll('button')].find(button=>button.textContent==='Cancel payment');
   await act(async()=>find().click());assert.equal(f.requests.filter(request=>request.method==='POST').length,0,'opening confirmation never closes a session');
   const confirmation=f.dom.window.document.querySelector('[role="alertdialog"]');assert.ok(confirmation);
   await act(async()=>[...confirmation.querySelectorAll('button')].find(button=>button.textContent==='Cancel payment').click());
   assert.equal(f.requests.filter(request=>request.url==='/api/subscription/cancel-payment').length,1);
   assert.equal(JSON.stringify(f.record),before,'client must not invent cancellation or reset the deadline');
   if(['checkout_closed','expired'].includes(outcome)){assert.deepEqual(Array.from(f.navigations),['/dashboard/subscription']);assert.equal(f.dom.window.document.querySelector('dialog[role="dialog"]').open,false);}
   else{assert.equal(f.navigations.length,0);assert.equal(f.dom.window.document.querySelector('dialog[role="dialog"]').open,true);}
   if(outcome==='failure'){assert.ok(f.dom.window.document.querySelector('[role="alertdialog"]'));assert.match(f.dom.window.document.body.textContent,/Unable to confirm cancellation/);}
  }finally{await f.close();}
 });
});
