/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic DOM and responses only. The real deletion endpoint is never called.
const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{act}=React,{JSDOM}=require('jsdom');
const {loader}=require('./tenh-seven/harness.cjs');
const subscription=(id='a',patch={})=>({businessId:id,businessName:'Workspace '+id,status:'active',candidates:[{memberId:'user-'+id,name:'Active user '+id,email:'fixture@example.invalid',role:'agent'}],...patch});
const impact=(blocking=[],subscriptions=blocking)=>({canDelete:!blocking.length,membershipCount:subscriptions.length,activeOwnedSubscriptionCount:blocking.length,blockingSubscriptions:blocking,subscriptions});
async function fixture(options={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/settings'}),previous={};
 for(const key of ['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT']){previous[key]=global[key];global[key]=key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key];}
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const requests=[],navigations=[];let resolveDelete;
 const load=loader({react:React},{window:{location:{assign:url=>navigations.push(url)}},document:dom.window.document,HTMLElement:dom.window.HTMLElement,AbortController,
  fetch:async(url,init={})=>{assert.equal(url,'/api/account/delete');requests.push({method:init.method,body:init.body&&JSON.parse(init.body)});
   if(init.method==='GET')return Response.json(options.preflightError?{success:false,error:'Preflight unavailable'}:{success:true,impact:options.impact??impact()});
   return new Promise(resolve=>{resolveDelete=resolve;});
  }});
 const Component=load('components/profile/delete-account-section.tsx').DeleteAccountSection;
 // The shared modal needs the real DOM window; the component navigation uses the isolated stub above.
 const {createRoot}=require('react-dom/client');
 const root=createRoot(dom.window.document.querySelector('#root'));
 await act(async()=>root.render(React.createElement(Component,{email:'fixture@example.invalid',variant:'row'})));
 const click=async selector=>act(async()=>{const el=typeof selector==='string'?dom.window.document.querySelector(selector):selector;assert.ok(el,selector);el.click();});
 await click('button');
 const set=async(selector,value)=>act(async()=>{const input=dom.window.document.querySelector(selector);const prototype=input.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}));});
 return{dom,requests,navigations,click,set,confirm:()=>[...dom.window.document.querySelectorAll('dialog button')].at(-1),
  fill:async(text='DELETE MY ACCOUNT')=>{await click('input[type=checkbox]');await set('#delete-account-confirmation',text);},
  finish:async(result,status=200)=>act(async()=>resolveDelete(Response.json(result,{status}))),
  close:async()=>{await act(async()=>root.unmount());dom.window.close();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}}
 };
}
test('no subscriptions: compact copy, exact phrase, Cancel/X and Escape dismiss without a DELETE',async()=>{
 for(const close of ['cancel','x','escape']){
  const f=await fixture();try{
   assert.match(f.dom.window.document.body.textContent,/Permanent. This cannot be undone/);
   assert.match(f.dom.window.document.body.textContent,/Shared chats and billing records are kept/);
   assert.ok(f.confirm().disabled);await f.fill('DELETE');assert.ok(f.confirm().disabled);
   await f.set('#delete-account-confirmation','DELETE MY ACCOUNT');assert.ok(!f.confirm().disabled);
   if(close==='cancel')await f.click([...f.dom.window.document.querySelectorAll('dialog button')].find(b=>b.textContent==='Cancel'));
   else if(close==='x')await f.click('button[aria-label="Close delete account dialog"]');
   else await act(async()=>f.dom.window.document.querySelector('dialog').dispatchEvent(new f.dom.window.Event('cancel',{cancelable:true})));
   assert.equal(f.dom.window.document.querySelector('dialog'),null);assert.equal(f.requests.filter(x=>x.method==='DELETE').length,0);
   assert.equal(f.dom.window.document.activeElement.textContent,'Delete account');
  }finally{await f.close();}
 }
});
test('multiple subscriptions: no destructive default, every transfer selection required, Manage users is navigation only',async()=>{
 const blockers=[subscription(),subscription('b')],f=await fixture({impact:impact(blockers,[...blockers,subscription('joined',{status:'expired'})])});try{
  assert.equal(f.dom.window.document.querySelector('input[type=radio]:checked'),null);
  assert.match(f.dom.window.document.body.textContent,/Workspace joined/);assert.match(f.dom.window.document.body.textContent,/Expired/);
  assert.equal(f.dom.window.document.querySelector('a').getAttribute('href'),'/dashboard/settings/users');
  await f.fill();assert.ok(f.confirm().disabled);
  await f.click('input[value=transfer]');await f.set('#new-owner-a','user-a');assert.ok(f.confirm().disabled);
  await f.set('#new-owner-b','user-b');assert.ok(!f.confirm().disabled);
  await f.click(f.confirm());assert.deepEqual(f.requests.at(-1).body.ownerTransfers,[{businessId:'a',memberId:'user-a'},{businessId:'b',memberId:'user-b'}]);
  await f.finish({success:true});assert.deepEqual(f.navigations,['/login?accountDeleted=1']);
 }finally{await f.close();}
});
test('end subscription retains both acknowledgments, submitted once; pending cannot close and server failure stays in dialog',async()=>{
 const f=await fixture({impact:impact([subscription('a',{paidTimeRemaining:true})])});try{
  await f.click('input[value=delete_subscriptions]');await f.fill();assert.ok(f.confirm().disabled);
  await f.click('input[type=checkbox]:not(:checked)');assert.ok(!f.confirm().disabled);
  await act(async()=>{f.confirm().click();f.confirm().click();});assert.equal(f.requests.filter(x=>x.method==='DELETE').length,1);
  assert.equal(f.requests.at(-1).body.deleteSubscriptionsConfirmed,true);assert.equal(f.navigations.length,0);
  await act(async()=>f.dom.window.document.querySelector('dialog').dispatchEvent(new f.dom.window.Event('cancel',{cancelable:true})));
  assert.ok(f.dom.window.document.querySelector('dialog'));
  await f.finish({success:false,error:'Server could not confirm deletion'},500);
  assert.match(f.dom.window.document.querySelector('[role=alert]').textContent,/could not confirm/);assert.equal(f.navigations.length,0);
 }finally{await f.close();}
});
test('no eligible transferee, trial/unknown paid time and failed preflight do not invent policy or enable deletion',async()=>{
 const f=await fixture({impact:impact([subscription('a',{status:'trialing',candidates:[]})])});try{
  assert.ok(f.dom.window.document.querySelector('input[value=transfer]').disabled);
  assert.match(f.dom.window.document.body.textContent,/Add another active user first/);
  assert.doesNotMatch(f.dom.window.document.body.textContent,/Unused paid time is lost/);
  assert.equal(f.dom.window.document.querySelector('input[type=radio]:checked'),null);
 }finally{await f.close();}
 const failed=await fixture({preflightError:true});try{assert.ok(failed.confirm().disabled);assert.match(failed.dom.window.document.querySelector('[role=alert]').textContent,/Preflight unavailable/);}finally{await failed.close();}
});
test('ownership changes returned by the server invalidate prior choices and confirmations',async()=>{
 const f=await fixture();try{
  await f.fill();await f.click(f.confirm());
  await f.finish({success:false,error:'Owner decision required',impact:impact([subscription('new')])},409);
  assert.ok(f.confirm().disabled);assert.equal(f.dom.window.document.querySelector('#delete-account-confirmation').value,'');
  assert.equal(f.dom.window.document.querySelector('input[type=radio]:checked'),null);assert.equal(f.navigations.length,0);
 }finally{await f.close();}
});
