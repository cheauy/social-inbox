/* eslint-disable @typescript-eslint/no-require-imports */
// Real React + jsdom. Counts image-src attempts only; jsdom downloads no images.
const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const {loader}=require('./tenh-seven/harness.cjs');
async function fixture(t,id){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/dashboard/inbox'}),previous={};
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){previous[key]=global[key];global[key]=value;}
 let clock=1000;class FixtureDate extends Date{static now(){return clock;}}
 const api=loader({react:React,'react/jsx-runtime':require('react/jsx-runtime')},{Date:FixtureDate})('components/customer-avatar.tsx');
 const Provider=api.CustomerAvatarCacheProvider??React.Fragment,root=createRoot(document.getElementById('root'));
 const base={contactId:id,businessId:'workspace-A',platform:'facebook',src:'https://fixture.invalid/'+id+'.jpg',name:'Fixture customer'};
 const render=async(show=true,patch={},account='account-A')=>act(async()=>root.render(React.createElement(Provider,{key:account},show?React.createElement(api.CustomerAvatar,{...base,...patch}):null)));
 const attempts=[];
 async function exhaust(){for(let i=0;i<3;i++){const image=document.querySelector('img');if(!image)return;attempts.push(image.getAttribute('src'));await act(async()=>image.dispatchEvent(new window.Event('error')));}assert.equal(document.querySelector('img'),null);}
 async function remount(patch={},account='account-A'){await render(false,{},account);await render(true,patch,account);}
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();for(const[key,value]of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}});
 return{render,remount,exhaust,attempts,advance:ms=>{clock+=ms;},src:()=>document.querySelector('img')?.getAttribute('src'),load:async()=>act(async()=>document.querySelector('img').dispatchEvent(new window.Event('load')))};
}
test('30 filter/channel/box remounts do not retry two exhausted avatar URLs during the cooldown',async t=>{
 const f=await fixture(t,'missing-switch');
 for(let i=0;i<30;i++){await f.remount();await f.exhaust();}
 assert.equal(f.attempts.length,2,'only the first stored + original candidates should be attempted');
 assert.equal(f.src(),undefined);assert.match(document.body.textContent,/F/);
});
test('failure cooldown expires so a transiently unavailable photo can recover',async t=>{
 const f=await fixture(t,'transient');await f.render();await f.exhaust();await f.remount();assert.equal(f.src(),undefined);
 f.advance(30001);await f.remount();assert.equal(f.src(),'/api/contacts/transient/facebook-avatar');await f.load();
 await f.remount();assert.equal(f.src(),'/api/contacts/transient/facebook-avatar');
});
test('newly synced and renewed signed sources bypass earlier failures immediately without stripping query signatures',async t=>{
 const f=await fixture(t,'renewed');await f.render(true,{src:null});await f.exhaust();
 await f.render(true,{src:'/api/contacts/renewed/facebook-avatar'});assert.equal(f.src(),'/api/contacts/renewed/facebook-avatar');
 await f.exhaust();const renewed='https://fixture.invalid/photo?token=fixture-new&expires=2099';await f.render(true,{src:renewed});
 assert.equal(f.src(),'/api/contacts/renewed/facebook-avatar');await act(async()=>document.querySelector('img').dispatchEvent(new window.Event('error')));assert.equal(f.src(),renewed);
});
test('workspace and account changes do not inherit another identity failure cooldown',async t=>{
 const f=await fixture(t,'scope');await f.render();await f.exhaust();
 await f.remount({businessId:'workspace-B'});assert.equal(f.src(),'/api/contacts/scope/facebook-avatar');await f.exhaust();
 await f.remount({businessId:'workspace-A'},'account-B');assert.equal(f.src(),'/api/contacts/scope/facebook-avatar');
});
test('a working fallback stays preferred on remount and each new account verifies its own candidates',async t=>{
 const f=await fixture(t,'working');await f.render();await act(async()=>document.querySelector('img').dispatchEvent(new window.Event('error')));
 assert.equal(f.src(),'https://fixture.invalid/working.jpg');await f.load();await f.remount();assert.equal(f.src(),'https://fixture.invalid/working.jpg');
 await f.remount({},'account-B');assert.equal(f.src(),'/api/contacts/working/facebook-avatar');
});
test('independent Inbox page owners never share failed candidates',async t=>{
 const f=await fixture(t,'page-owner');await f.render();await f.exhaust();await f.render(false,{},'retired-page');
 await f.render(true,{},'new-page');assert.equal(f.src(),'/api/contacts/page-owner/facebook-avatar');
});
test('Telegram stored fallback also avoids a repeated failure chain',async t=>{
 const f=await fixture(t,'telegram');const props={platform:'telegram',src:'https://fixture.invalid/expired-telegram.jpg'};
 await f.render(true,props);await f.exhaust();await f.remount(props);assert.equal(f.src(),undefined);assert.equal(f.attempts.length,2);
});

test('failed avatar metadata stays bounded and an evicted contact can retry',async t=>{
 const f=await fixture(t,'bounded-0');await f.render();await f.exhaust();
 for(let n=1;n<=500;n++){await f.render(true,{contactId:'bounded-'+n});await f.exhaust();}
 await f.render(true,{contactId:'bounded-0'});assert.equal(f.src(),'/api/contacts/bounded-0/facebook-avatar');
});
