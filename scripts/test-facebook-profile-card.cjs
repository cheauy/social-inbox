/* Schematic layouts based on the screenshot, not captured Facebook HTML.
 * The public href is synthetic: the Suite selected ID is never assumed public. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require(process.env.TENH_JSDOM_PATH||'jsdom');
const f=require('./fixtures/facebook-customer-card.json');
const opts={pageId:f.pageId,threadId:f.psid,customerName:f.customerName,conversationLink:f.suiteUrl,linkSource:'meta_conversations_api'};
const publicUrl='https://www.facebook.com/fixture.customer';
const card=({name=f.customerName,href=publicUrl,photo=true,tag='span',action='<a href="'+href+'">View profile</a>'}={})=>
 `<div data-box="1440,175,320,100">${photo?'<img alt="" src="photo.png">':''}<div><${tag}>${name}</${tag}><div>${action}</div></div></div>`;
function load(html,url=f.suiteUrl){
 const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 Object.defineProperty(w,'innerWidth',{value:1800});Object.defineProperty(w,'innerHeight',{value:900});
 w.HTMLElement.prototype.getBoundingClientRect=function(){
  const box=this.closest('[data-box]')?.getAttribute('data-box')||'20,20,100,30';
  const [left,top,width,height]=box.split(',').map(Number);return {left,top,width,height,right:left+width,bottom:top+height};
 };
 Object.defineProperty(w.HTMLElement.prototype,'innerText',{get(){return this.textContent;}});
 w.eval(fs.readFileSync('tenh-extension/src/facebook-selectors.js','utf8'));
 w.eval(fs.readFileSync('tenh-extension/src/facebook-profile-resolver.js','utf8'));
 return {w,read:(options=opts)=>w.TenhFacebookProfileResolver.readCurrent(options),close:()=>w.close()};
}
for(const tag of ['span','strong','div'])test('plain card: visible name and profile link work without heading tag '+tag,()=>{
 const h=load('<aside>'+card({tag})+'</aside>'),r=h.read();
 assert.equal(r.profileUrl,publicUrl);assert.equal(r.matchedThreadId,f.psid);assert.notEqual(new URL(r.profileUrl).pathname,'/'+new URL(f.suiteUrl).searchParams.get('selected_item_id'));h.close();
});
test('plain card: generic right sidebar does not require aside or heading roles',()=>{
 const h=load('<main><div role="log">Messages</div><div contenteditable="true"></div></main><div data-box="1420,155,380,740">'+card()+'<section>Contact details</section><section>Facebook profile</section></div>');
 assert.equal(h.read().profileUrl,publicUrl);h.close();
});
test('plain card: nested name pieces and layout wrappers retain exact name matching',()=>{
 const name='<span>Ah</span><span>Mouy</span><span>Srun</span>';
 const html='<aside><div><img src="photo.png" alt=""><div>'+ '<div>'.repeat(7)+'<span>'+name+'</span>'+'</div>'.repeat(7)+'<a href="'+publicUrl+'">View profile</a></div></div></aside>';
 const h=load(html);assert.equal(h.read().profileUrl,publicUrl);h.close();
});
test('plain card: other customers and Pages use the same detector',()=>{
 for(const [name,p,s] of [['សុខ សាន្ត','111111','77777777777777777'],['Sosó Ps','222222','88888888888888888']]){
  const url=`https://business.facebook.com/latest/inbox/all?asset_id=${p}&selected_item_id=44444444&thread_type=FB_MESSAGE`;
  const h=load('<aside>'+card({name})+'</aside>',url);
  assert.equal(h.read({...opts,pageId:p,threadId:s,customerName:name,conversationLink:url}).profileUrl,publicUrl);h.close();
 }
});
for(const [label,html] of [
 ['wrong name','<aside>'+card({name:'Another customer'})+'</aside>'],
 ['missing photo','<aside>'+card({photo:false})+'</aside>'],
 ['message content','<div role="log">'+card()+'</div>'],
 ['conversation list','<aside><div role="row">'+card()+'</div></aside>'],
 ['global navigation','<nav>'+card()+'</nav>'],
 ['global header','<header>'+card()+'</header>'],
 ['hidden matching name','<aside>'+card({name:'<span hidden>Ah Mouy Srun</span>'})+'</aside>'],
 ['name only in message','<aside><img src="photo.png"><div role="log"><span>Ah Mouy Srun</span></div><a href="'+publicUrl+'">View profile</a></aside>'],
])test('plain card excludes '+label,()=>{const h=load(html);assert.equal(h.read().profileUrl,undefined);h.close();});
test('plain card rejects ambiguous public links',()=>{
 const h=load('<aside>'+card()+card({href:'https://www.facebook.com/different.fixture'})+'</aside>');
 assert.equal(h.read().reason,'ambiguous_profile');h.close();
});
test('plain card stays bound to the authorized Page and inbox route',()=>{
 for(const url of [f.suiteUrl.replace(f.pageId,'999999'),f.suiteUrl.replace('61587588958395','55555555')]){
  const h=load('<aside>'+card()+'</aside>',url);assert.equal(h.read().reason,'conversation_mismatch');h.close();
 }
});
test('plain card reports a profile action without href without clicking it',()=>{
 const h=load('<aside>'+card({action:'<button>View profile</button>'})+'</aside>');
 let clicks=0;h.w.document.addEventListener('click',()=>clicks++);
 const r=h.read();assert.equal(r.reason,'profile_action_without_link');assert.equal(r.profileUrl,undefined);assert.equal(clicks,0);
 assert.equal(r.diagnostics.profileActions,1);assert.equal(r.diagnostics.linkActions,0);h.close();
});
