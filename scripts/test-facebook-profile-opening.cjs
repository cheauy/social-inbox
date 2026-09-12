/* Chrome/API mocks exercise authorization, navigation ownership and tickets.
 * Facebook's DOM is covered separately; no live Facebook session is used. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const source = fs.readFileSync('tenh-extension/src/background.js', 'utf8');
const code = source.slice(source.indexOf('const PROFILE_TICKETS_KEY'), source.indexOf('async function warmFacebookCompanion'));
const options = { businessId:'workspace', conversationId:'conversation', pageId:'123456', threadId:'987654', customerName:'Customer' };
const sender = { id:'extension', frameId:0, documentId:'doc', url:'https://app.tenhchat.com/dashboard/inbox', tab:{ id:10 } };
const profile = 'https://www.facebook.com/profile.php?id=61555135812581';
const exact = 'https://business.facebook.com/latest/inbox/all?asset_id=123456&selected_item_id=112233445566&thread_type=FB_MESSAGE';
const pageInboxFixture = require('./fixtures/facebook-conversation-page-inbox.json');
function harness(config = {}) {
  const tabs = new Map((config.tabs || []).map(tab => [tab.id,{ status:'complete', active:false, ...tab }]));
  const created=[], removed=[], read=[], auth=[]; const session = config.session || {}; let id=100, now=1000; const loads=new Set(),revealed=new Set();
  const chrome = { runtime:{ id:'extension' }, storage:{ session:{
    get:async key=>({ [key]:structuredClone(session[key]) }), set:async data=>Object.assign(session,structuredClone(data)),
  } }, tabs:{
    query:async()=>[...tabs.values()].filter(tab=>tab.url.includes('facebook.com')),
    get:async id=>{ if(!tabs.has(id)) throw Error('closed'); if(config.coldLoad&&!loads.has(id)){loads.add(id);return {...tabs.get(id),status:'loading',url:'',pendingUrl:tabs.get(id).url};} return {...tabs.get(id)}; },
    create:async props=>{ const tab={...props,id:++id,status:'complete'}; if(config.login && props.url.includes('business.facebook.com')) tab.url='https://www.facebook.com/login/'; if(config.redirect && props.url===config.authorization?.conversationLink)tab.url=config.redirect; created.push(tab); tabs.set(tab.id,tab); return tab; },
    remove:async id=>{ removed.push(id); tabs.delete(id); },
  }, scripting:{executeScript:async request=>{
    if(request.files) return [];
    const [ctx,action]=request.args; read.push({tabId:request.target.tabId,action,ctx});
    if(config.takeOver) tabs.get(request.target.tabId).active=true;
    if(action==='reveal'){revealed.add(request.target.tabId);return [{frameId:0,result:{revealed:true}}];}
    const result=action==='validate'
      ? config.validation || {valid:true,nameMatches:true,url:config.profile || profile}
      : config.collapsed && (!revealed.has(request.target.tabId)||config.stillMissing) ? {reason:'profile_link_not_rendered',canReveal:true}
      : config.result || {found:true,pageId:ctx.pageId,matchedThreadId:ctx.threadId,profileUrl:config.profile || profile};
    return [{frameId:0,result}];
  }} };
  const sandbox={URL,URLSearchParams,Map,Set,Object,Promise,Date:class extends Date{static now(){return now;}},
    crypto:{randomUUID},chrome,TENH_ORIGIN:'https://app.tenhchat.com',
    setTimeout:(fn,ms)=>ms===500?setImmediate(()=>{now+=500;fn();}):setTimeout(fn,ms),clearTimeout,
    readState:async()=>({token:config.noToken?null:'fake-device-token'}),
    callTenh:async(path,request)=>{auth.push({path,request});return {ok:!config.denied,result:{success:true,verified:true,...options,customerName:'Customer',sourceType:'messenger',linkSource:'meta_conversations_api',conversationLink:exact,...config.authorization}};},
    facebookTarget:ctx=>`https://business.facebook.com/latest/inbox/all?asset_id=${ctx.pageId}&selected_item_id=${ctx.threadId}&thread_type=FB_MESSAGE`,
  };
  vm.runInNewContext(code+'\nglobalThis.api={openFacebookCustomerProfile,openResolvedFacebookProfile};',sandbox);
  return {api:sandbox.api,created,removed,read,auth,tabs,session,advance:()=>{now+=70000;}};
}
const lookup=(h,opts=options,from=sender)=>h.api.openFacebookCustomerProfile(opts,from);
const open=(h,result,opts=options,from=sender)=>h.api.openResolvedFacebookProfile(result.openToken,from,opts);
test('customer card: automatically reveals a collapsed card once in an owned inactive tab',async()=>{
 const h=harness({collapsed:true}),r=await lookup(h);assert.equal(r.resolved,true);
 assert.equal(h.read.filter(r=>r.action==='reveal').length,1);assert.equal(h.removed.length,2);
 assert.equal((await open(h,r)).opened,true);
});
test('customer card: existing tab stays passive while a disposable tab reveals the card',async()=>{
 const h=harness({collapsed:true,tabs:[{id:22,url:exact,active:true}]}),r=await lookup(h);
 assert.equal(r.resolved,true);assert.ok(h.read.filter(x=>x.tabId===22).every(x=>x.action==='read'));
 assert.equal(h.read.filter(x=>x.action==='reveal').length,1);assert.ok(h.tabs.has(22));
});
test('customer card: an unsuccessful reveal is not repeated and cannot open a guessed profile',async()=>{
 const h=harness({collapsed:true,stillMissing:true}),r=await lookup(h);
 assert.equal(r.reason,'profile_link_not_rendered');assert.equal(r.openToken,undefined);
 assert.equal(h.read.filter(x=>x.action==='reveal').length,1);assert.equal(h.created.length,1);
});
test('customer card: user takeover prevents automatic reveal and preserves the tab',async()=>{
 const h=harness({collapsed:true,takeOver:true}),r=await lookup(h);
 assert.equal(r.resolved,undefined);assert.equal(h.read.filter(x=>x.action==='reveal').length,0);assert.equal(h.removed.length,0);
});
test('customer card: mismatch or unavailable contact stops before any reveal',async()=>{
 for(const reason of ['conversation_mismatch','ambiguous_profile','facebook_no_contact_card','facebook_inbox_load_failed']){
  const h=harness({result:{reason,canReveal:true}}),r=await lookup(h);
  assert.equal(r.reason,reason);assert.ok(h.read.every(x=>x.action==='read'));assert.equal(r.openToken,undefined);
 }
});
test('Page inbox: worker accepts actual provider path without converting its ID to a PSID',async()=>{
 const f=pageInboxFixture,conversationLink='https://www.facebook.com'+f.response.data[0].link;
 const ctx={...options,pageId:f.pageId,threadId:f.psid};
 const h=harness({authorization:{...ctx,conversationLink}}),r=await lookup(h,ctx);
 assert.equal(r.resolved,true);assert.equal(h.created[0].url,conversationLink);
 assert.equal(r.threadId,f.psid);assert.equal((await open(h,r,ctx)).opened,true);
});
test('Page inbox: path thread ID may redirect to a different Suite selected ID',async()=>{
 const f=pageInboxFixture,conversationLink='https://www.facebook.com'+f.response.data[0].link;
 const ctx={...options,pageId:f.pageId,threadId:f.psid};
 const h=harness({authorization:{...ctx,conversationLink},redirect:f.suiteUrl}),r=await lookup(h,ctx);
 assert.equal(r.resolved,true);assert.equal(r.loadedConversationLink,f.suiteUrl);
 assert.equal(h.removed.length,2);assert.equal((await open(h,r,ctx)).opened,true);
});
test('Page inbox: unrelated legacy inbox tab stays untouched',async()=>{
 const conversationLink='https://www.facebook.com/123456/inbox/444444/?section=messages';
 const h=harness({authorization:{conversationLink},tabs:[{id:22,url:conversationLink.replace('444444','555555'),active:true}]}),r=await lookup(h);
 assert.equal(r.resolved,true);assert.equal(h.created[0].url,conversationLink);
 assert.ok(h.tabs.has(22));assert.ok(h.read.every(x=>x.tabId!==22));
});
test('Page inbox: redirect to another Page cannot authorize a profile',async()=>{
 const conversationLink='https://www.facebook.com/123456/inbox/444444/?section=messages';
 const h=harness({authorization:{conversationLink},redirect:exact.replace('123456','222222')}),r=await lookup(h);
 assert.equal(r.reason,'profile_lookup_interrupted');assert.equal(h.read.length,0);assert.equal(r.openToken,undefined);
});
test('Page inbox: wrong Page, section and contradictory selectors are rejected before navigation',async()=>{
 for(const conversationLink of ['https://www.facebook.com/999999/inbox/444444/?section=messages',
  'https://www.facebook.com/123456/inbox/444444/?section=comments',
  'https://www.facebook.com/123456/inbox/444444/?section=messages&selected_item_id=555555']){
  const h=harness({authorization:{conversationLink}});assert.equal((await lookup(h)).opened,false);assert.equal(h.created.length,0);
 }
});
test('specific conversation failure reaches TENH without opening a tab',async()=>{
 for(const reason of ['profile_conversation_not_found','profile_conversation_participants_unmatched','profile_conversation_link_unsupported',
  'profile_conversation_link_missing','profile_conversation_name_unavailable','profile_conversation_request_failed']){
  const h=harness({denied:true,authorization:{reason}});assert.equal((await lookup(h)).reason,reason);assert.equal(h.created.length,0);
 }
});
test('one click resolves on demand, closes owned background tabs, opens only verified profile',async()=>{
  const h=harness(), r=await lookup(h); assert.equal(r.resolved,true); assert.equal(r.profileUrl,profile);
  assert.equal(h.created.length,2); assert.ok(h.created.every(t=>!t.active)); assert.equal(h.removed.length,2);
  assert.equal((await open(h,r)).opened,true); assert.equal(h.created[2].url,profile); assert.equal(h.created[2].active,true);
  assert.equal((await open(h,r)).opened,false); assert.equal(h.created.length,3);
});
test('existing exact inbox is read passively and never closed',async()=>{
  const h=harness({tabs:[{id:22,url:exact,active:true}]}),r=await lookup(h);
  assert.equal(r.resolved,true); assert.equal(h.created.length,1); assert.ok(h.tabs.has(22));
  assert.ok(h.read.filter(x=>x.tabId===22).every(x=>x.action==='read'));
});
test('other Page and other customer tabs remain untouched',async()=>{
  const h=harness({tabs:[{id:22,url:exact.replace('123456','222222')},{id:23,url:exact.replace('112233445566','333333')} ]});
  assert.equal((await lookup(h)).resolved,true); assert.ok(h.read.every(x=>x.tabId!==22&&x.tabId!==23));
  assert.ok(h.tabs.has(22)&&h.tabs.has(23));
});
for(const cfg of [{noToken:true},{denied:true},{authorization:{pageId:'other'}},{authorization:{businessId:'other'}},{authorization:{conversationId:'other'}},{authorization:{threadId:'other'}},{authorization:{sourceType:'facebook_comment'}}]) test('authorization failure opens no tab '+JSON.stringify(cfg),async()=>{
  const h=harness(cfg); assert.equal((await lookup(h)).opened,false); assert.equal(h.created.length,0);
});
for(const patch of [{frameId:1},{id:'foreign'},{url:'https://evil.test/'},{url:'https://app.tenhchat.com.evil.test/'}]) test('reject untrusted sender '+JSON.stringify(patch),async()=>{
  const h=harness(); assert.equal((await lookup(h,options,{...sender,...patch})).reason,'untrusted_sender'); assert.equal(h.auth.length,0);
});
test('lookup uses server customer name, never the caller name',async()=>{
  const h=harness(); await lookup(h,{...options,customerName:'Wrong name'}); assert.ok(h.read.every(r=>r.ctx.customerName==='Customer'));
});
for(const url of ['https://www.facebook.com/profile.php?id=987654','https://www.facebook.com/123456','https://www.facebook.com/me','https://www.facebook.com/photos','https://www.facebook.com/profile.php?id=555555&id=666666','https://www.facebook.com.evil.test/name','javascript:alert(1)']) test('reject unsafe/scoped destination '+url,async()=>{
  const h=harness({profile:url}); const r=await lookup(h); assert.equal(r.openToken,undefined); assert.ok(h.created.every(t=>!t.active));
});
for(const reason of ['conversation_selection_unverified','ambiguous_profile','profile_link_missing'])test('rendered identity failure never opens a guessed profile '+reason,async()=>{
  const h=harness({result:{reason}}); assert.equal((await lookup(h)).reason,reason); assert.equal(h.created.length,1); assert.equal(h.removed.length,1);
});
test('unavailable Facebook profile is not opened or cached',async()=>{
  const h=harness({validation:{valid:false,reason:'facebook_content_unavailable'}});assert.equal((await lookup(h)).reason,'facebook_content_unavailable');assert.equal(h.removed.length,2);assert.ok(h.created.every(t=>!t.active));
});
test('login redirect gives clear reason and cleans owned inactive lookup',async()=>{
  const h=harness({login:true});assert.equal((await lookup(h)).reason,'facebook_sign_in_required');assert.equal(h.removed.length,1);
});
test('active inbox tab remains readable and is preserved',async()=>{
  const h=harness({takeOver:true,result:{reason:'facebook_no_contact_card'}});assert.equal((await lookup(h)).reason,'facebook_no_contact_card');assert.equal(h.removed.length,0);
});
test('concurrent lookup is rejected without duplicate tabs',async()=>{
  const h=harness(); const [a,b]=await Promise.all([lookup(h),lookup(h)]);assert.equal(a.resolved,true);assert.equal(b.reason,'profile_lookup_busy');assert.equal(h.created.length,2);
});
test('opening ticket binds Page/customer/workspace/conversation/document and expires',async()=>{
  const h=harness(),r=await lookup(h);
  for(const patch of [{pageId:'other'},{threadId:'other'},{businessId:'other'},{conversationId:'other'}])assert.equal((await open(h,r,{...options,...patch})).opened,false);
  assert.equal((await open(h,r,options,{...sender,documentId:'new-document'})).opened,false);
  h.advance();assert.equal((await open(h,r)).opened,false);assert.equal(h.created.length,2);
});
test('parallel consumption opens a ticket only once',async()=>{
  const h=harness(),r=await lookup(h);const results=await Promise.all([open(h,r),open(h,r)]);assert.equal(results.filter(x=>x.opened).length,1);
});

test('cold Chrome tabs with pendingUrl wait for the loaded document',async()=>{const h=harness({coldLoad:true});const r=await lookup(h);assert.equal(r.resolved,true);assert.equal(h.removed.length,2);assert.equal((await open(h,r)).opened,true);});

test('uses provider conversation URL with separate inbox ID; never a PSID-built URL',async()=>{
 const h=harness();const r=await lookup(h);assert.equal(r.resolved,true);assert.equal(h.created[0].url,exact);
 assert.equal(new URL(h.created[0].url).searchParams.get('selected_item_id'),'112233445566');
 assert.equal(r.threadId,options.threadId);assert.ok(h.created.every(t=>!t.url.includes('selected_item_id='+options.threadId)));
});
test('missing provider link opens no guessed inbox tab',async()=>{
 const h=harness({authorization:{conversationLink:undefined}});assert.equal((await lookup(h)).reason,'profile_conversation_link_unavailable');assert.equal(h.created.length,0);
});
test('caller-supplied route does not override server conversation link',async()=>{
 const h=harness();await lookup(h,{...options,conversationLink:exact.replace('112233445566','999999')});assert.equal(h.created[0].url,exact);
});
test('legacy provider link can follow Facebook redirect in its own inactive tab',async()=>{
 const legacy='https://www.facebook.com/123456/messages/?tid=cid.c.123456:112233445566';
 const h=harness({authorization:{conversationLink:legacy},redirect:exact});assert.equal((await lookup(h)).resolved,true);assert.equal(h.created[0].url,exact);assert.equal(h.removed.length,2);
});
test('provider link to wrong Page is rejected before navigation',async()=>{
 const h=harness({authorization:{conversationLink:exact.replace('123456','888888')}});assert.equal((await lookup(h)).reason,'profile_conversation_link_unavailable');assert.equal(h.created.length,0);
});
