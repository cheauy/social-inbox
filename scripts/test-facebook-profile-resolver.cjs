/* Rendered DOM fixtures with simulated layout; no Facebook network/session.
 * npm install --no-save jsdom@26, or set TENH_JSDOM_PATH to an installed copy. */
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const {JSDOM}=require(process.env.TENH_JSDOM_PATH || 'jsdom');
const selectors=fs.readFileSync('tenh-extension/src/facebook-selectors.js','utf8');
const resolver=fs.readFileSync('tenh-extension/src/facebook-profile-resolver.js','utf8');
const base='https://business.facebook.com/latest/inbox/all?asset_id=123456&selected_item_id=987654&thread_type=FB_MESSAGE';
const opts={pageId:'123456',threadId:'987654',customerName:'Test Customer'};
const profile='https://www.facebook.com/profile.php?id=61555135812581';
function fixture({name=opts.customerName,href=profile,rowId=opts.threadId,selected=true,extra='',hidden=false,heading=true}={}) {
  return `<nav><a href="https://www.facebook.com/admin">Admin</a></nav>
    <a ${selected?'aria-selected="true"':''} href="?asset_id=123456&selected_item_id=${rowId}">Test Customer</a>
    <aside ${hidden?'hidden':''}>${heading?`<h2>${name}</h2>`:`<span>${name}</span>`}<a href="${href}">View profile</a>${extra}</aside>
    <div role="log"><a href="https://www.facebook.com/wrong.customer">View profile</a></div>`;
}
function load(html=fixture(),url=base) {
  const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.HTMLElement.prototype.getBoundingClientRect=function(){return {width:this.hidden?0:100,height:this.hidden?0:50,top:0,left:0};};
  Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
  w.eval(selectors);w.eval(resolver);
  return {w,read:(options=opts)=>w.TenhFacebookProfileResolver.readCurrent(options),close:()=>w.close()};
}
test('exact selected thread and matching detail heading yields real link without interaction',()=>{
  const h=load();let clicks=0;h.w.document.addEventListener('click',()=>clicks++);const r=h.read();
  assert.equal(r.profileUrl,profile);assert.equal(r.matchedThreadId,opts.threadId);assert.equal(clicks,0);h.close();
});
for(const config of [{selected:false},{rowId:'222222'},{name:'Previous Customer'},{hidden:true},{heading:false}])test('do not trust address bar/name alone '+JSON.stringify(config),()=>{
  const h=load(fixture(config));assert.equal(h.read().profileUrl,undefined);h.close();
});
for(const url of [base.replace('asset_id=123456','asset_id=333333'),base+'&selected_item_id=222222',base+'&mailbox_id=555555',base.replace('FB_MESSAGE','COMMENT')])test('reject conflicting Page/thread context '+url,()=>{
  const h=load(fixture(),url);assert.equal(h.read().profileUrl,undefined);h.close();
});
test('ambiguous detail profile links rejected',()=>{
  const h=load(fixture({extra:'<a href="https://www.facebook.com/other.customer">View profile</a>'}));assert.equal(h.read().reason,'ambiguous_profile');h.close();
});
for(const href of ['https://www.facebook.com/987654','https://www.facebook.com/profile.php?id=123456','https://www.facebook.com/profile.php?id=111111&id=222222','https://www.facebook.com/me','https://www.facebook.com/photos','https://www.facebook.com.evil.test/customer','javascript:alert(1)'])test('reject invalid profile '+href,()=>{
  const h=load(fixture({href}));assert.equal(h.read().profileUrl,undefined);h.close();
});
test('Khmer heading and profile label supported',()=>{
  const h=load(fixture({name:'សុខ សាន្ត'}).replace('View profile','មើលប្រវត្តិរូប'));assert.equal(h.read({...opts,customerName:'សុខ សាន្ត'}).profileUrl,profile);h.close();
});
test('profile link shim decoded only to an allowed Facebook profile',()=>{
  const h=load(fixture({href:'https://l.facebook.com/l.php?u='+encodeURIComponent(profile)}));assert.equal(h.read().profileUrl,profile);h.close();
});
test('generic profile name and link in chat message is not identity evidence',()=>{
  const h=load(fixture({heading:false,extra:'<div role="log"><h2>Test Customer</h2><a href="https://facebook.com/wrong">View profile</a></div>'}));assert.equal(h.read().profileUrl,undefined);h.close();
});
test('no reveal in visible tab; safe header button only in hidden tab',()=>{
  const html=fixture({heading:false})+'<header><button><h2>Test Customer</h2></button></header>';
  const h=load(html);let clicks=0;h.w.document.addEventListener('click',()=>clicks++);
  assert.equal(h.w.TenhFacebookProfileResolver.reveal(opts).reason,'facebook_tab_in_use');assert.equal(clicks,0);
  Object.defineProperty(h.w.document,'visibilityState',{value:'hidden',configurable:true});
  assert.equal(h.w.TenhFacebookProfileResolver.reveal(opts).revealed,true);assert.equal(clicks,1);h.close();
});
for(const [html,valid,reason] of [
 ['<main><h1>Test Customer</h1></main>',true,null],
 ['<nav>Test Customer</nav><main><h1>Someone Else</h1></main>',false,'profile_identity_unverified'],
 ['<main><h1>Test Customer</h1><p>This content isn’t available right now</p></main>',false,'facebook_content_unavailable'],
 ['<input type="password"><main><h1>Test Customer</h1></main>',false,'facebook_sign_in_required'],
])test('validate destination '+(reason||'valid profile'),()=>{
  const h=load(html,profile),r=h.w.TenhFacebookSelectors.validateCurrentProfilePage(opts.customerName,opts.threadId);
  assert.equal(r.valid,valid);assert.equal(r.reason,reason);h.close();
});
test('username stays username unless Facebook exposes one numeric canonical ID',()=>{
  const h=load('<main><h1>Test Customer</h1></main>','https://www.facebook.com/customer.test');
  assert.equal(h.w.TenhFacebookSelectors.validateCurrentProfilePage(opts.customerName,opts.threadId).url,'https://www.facebook.com/customer.test');
  h.w.document.head.innerHTML=`<link rel="canonical" href="${profile}">`;
  assert.equal(h.w.TenhFacebookSelectors.validateCurrentProfilePage(opts.customerName,opts.threadId).url,profile);h.close();
});
