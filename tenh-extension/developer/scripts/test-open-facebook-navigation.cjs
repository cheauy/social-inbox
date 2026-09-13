const fs=require('node:fs'),vm=require('node:vm'),{test}=require('node:test'),assert=require('node:assert/strict');
const extensionRoot=process.env.TENH_NAV_EXTENSION || 'tenh-extension';
const source=fs.readFileSync(extensionRoot+'/src/background.js','utf8');
const manifest=JSON.parse(fs.readFileSync(extensionRoot+'/manifest.json','utf8'));
const localBuild=manifest.host_permissions.includes('http://localhost:3000/*');
const args={businessId:'b1',conversationId:'uuid1',pageId:'393342417206745',threadId:'28288665770787398'};
const legacy=`https://www.facebook.com/${args.pageId}/inbox/1187032264483411/?section=messages`;
const suite=id=>`https://business.facebook.com/latest/inbox/all?asset_id=${args.pageId}&selected_item_id=${id}&thread_type=FB_MESSAGE`;
const reported=`https://business.facebook.com/latest/inbox/all?bpn_id=352037214598201&asset_id=${args.pageId}&nav_ref=manage_page_ap_plus_default&selected_item_id=61576318208827&mailbox_id=${args.pageId}&thread_type=FB_MESSAGE`;
const provider=(patch={})=>({success:true,verified:true,...args,customerName:'Customer',linkSource:'meta_conversations_api',conversationLink:legacy,...patch});
function extension(options={}) {
 let clock=Date.now(),nextId=100;class Clock extends Date {static now(){return clock;}}
 const tabs=structuredClone(options.tabs||[]),history=[],network=[],scripts=[];
 const initial={installationId:'test-install',token:'FAKE_DEVICE_TOKEN',...(options.state||{})};
 const state=localBuild ? new Proxy(Object.fromEntries(Object.entries(initial).map(([k,v])=>['tenh-localhost-3000:'+k,v])),{
  get:(obj,key)=>obj[String(key).startsWith('tenh-localhost-3000:')?key:'tenh-localhost-3000:'+String(key)],
  set:(obj,key,value)=>{obj[String(key).startsWith('tenh-localhost-3000:')?key:'tenh-localhost-3000:'+String(key)]=value;return true;},
  deleteProperty:(obj,key)=>{delete obj[String(key).startsWith('tenh-localhost-3000:')?key:'tenh-localhost-3000:'+String(key)];return true;}
 }) : initial;
 const event=()=>({addListener(){}});
 const storage={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,state[k]])),set:async patch=>Object.assign(state,patch),remove:async keys=>{for(const k of(Array.isArray(keys)?keys:[keys]))delete state[k];}};
 const chrome={runtime:{id:'testextension',getManifest:()=>manifest,onMessage:event(),onConnect:event(),onInstalled:event(),onStartup:event()},storage:{local:storage,session:storage},alarms:{onAlarm:event(),create(){}},action:{setBadgeText:async()=>{}},
 tabs:{onUpdated:event(),onRemoved:event(),get:async id=>{const t=tabs.find(x=>x.id===id);if(!t)throw new Error('Missing');options.onGet?.(t);return {...t};},query:async()=>tabs.map(t=>({...t})),
  update:async(id,patch)=>{history.push({action:'update',id,patch});const t=tabs.find(t=>t.id===id);Object.assign(t,patch);options.onUpdate?.(t,patch);return {...t};},
  create:async props=>{history.push({action:'create',props});const t={id:nextId++,windowId:1,status:'complete',...props};if(options.redirect && !props.active)t.url=options.redirect;
   if(options.loading){t.status='loading';t.pendingUrl=options.redirect||props.url;}
   options.onCreate?.(t);tabs.push(t);return {...t};},remove:async id=>{history.push({action:'remove',id});const i=tabs.findIndex(t=>t.id===id);if(i>=0)tabs.splice(i,1);},sendMessage:async()=>({})},
 windows:{update:async()=>{}},scripting:{executeScript:async request=>{
  scripts.push(request);if(request.files)return [];
  const tab=tabs.find(x=>x.id===request.target.tabId),context=request.args[0];
  const result=typeof options.read==='function'?options.read(tab,context,request.args[1]):options.read||{
   found:true,pageId:context.pageId,matchedThreadId:context.threadId,
   selectedItemId:new URL(tab.url).searchParams.get('selected_item_id'),profileUrl:'https://www.facebook.com/profile.php?id=100073163121418'};
  return [{frameId:0,result}];
 }}};
 const sandbox={Date:Clock,chrome,console,URL,URLSearchParams,crypto:require('crypto').webcrypto,AbortSignal,WebSocket:{OPEN:1},
 setTimeout:(fn,ms)=>{if(ms===350){clock+=ms;queueMicrotask(fn);return null;}return setTimeout(fn,ms);},clearTimeout,setInterval,clearInterval,
 fetch:async(url,init)=>{network.push({url,init});if(String(url).includes('/api/extension/conversations/open-context'))return new Response(JSON.stringify(options.response||provider()),{status:options.status||200});throw new Error('Unexpected fetch');}};
 vm.runInNewContext(source+'\nglobalThis.testAPI={openFacebook,cachedFacebookNavigationId,rememberFacebookNavigationId,navigationIdFromFacebookUrl};',sandbox);
 const senderUrl=(localBuild?'http://localhost:3000':'https://app.tenhchat.com')+'/dashboard/inbox';
 const sender={id:'testextension',frameId:0,tab:{id:9,url:senderUrl},url:senderUrl};
 return {api:sandbox.testAPI,tabs,history,network,state,sender,scripts};
}
test('keeps the verified legacy redirect tab and focuses it without a second navigation',async()=>{
 const e=extension({redirect:reported});const r=await e.api.openFacebook(args,e.sender);
 assert.equal(e.history.filter(x=>x.action==='create').length,1);
 assert.equal(r.opened,true);assert.equal(r.verified,true);assert.equal(r.navigationId,'61576318208827');
 assert.equal(e.tabs[0].url,reported);assert.equal(e.tabs[0].active,true);
 assert.ok(e.history.filter(x=>x.action==='update').every(x=>!('url' in x.patch)));
 assert.equal(e.history.filter(x=>x.action==='remove').length,0);
});
test('direct provider Suite URL cannot override a known wrong customer',async()=>{
 const e=extension({response:provider({conversationLink:reported}),read:{reason:'facebook_customer_mismatch'}});
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.opened,false);assert.equal(r.exactRequested,false);
 assert.equal(e.history.filter(x=>x.action==='update').length,0);assert.equal(e.tabs.length,0);
 assert.equal(r.diagnostics.observedNavigationId,'61576318208827');assert.equal(r.diagnostics.expectedCustomerName,'Customer');
});
test('a hidden customer panel receives one foreground retry, then verifies before caching',async()=>{
 const e=extension({redirect:reported,read:(tab,context)=>tab.active?{
  found:true,pageId:context.pageId,matchedThreadId:context.threadId,selectedItemId:'61576318208827',profileUrl:'https://www.facebook.com/customer'
 }:{reason:'profile_customer_heading_missing',diagnostics:{visibility:'hidden',headerCandidates:0,matchingHeaders:0,composerFound:false}}});
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.verified,true);assert.equal(r.foregroundRetry,true);
 assert.equal(e.history.filter(x=>x.action==='update').length,1);assert.equal(e.history.filter(x=>x.action==='create').length,1);
 assert.ok(Object.keys(e.state.facebookVerifiedConversationTabsV1).length===1);
 const next=await e.api.openFacebook(args,e.sender);assert.equal(next.cacheUsed,true);assert.equal(next.tabId,r.tabId);
});
test('an unresolved foreground retry keeps the tab for inspection, returns diagnostics and does not cache',async()=>{
 const e=extension({redirect:reported,read:tab=>({reason:'profile_customer_heading_missing',diagnostics:{visibility:tab.active?'visible':'hidden',headerCandidates:0,matchingHeaders:0,composerFound:tab.active,html:'private chat text'}})});
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.opened,true);assert.equal(r.verified,false);
 assert.equal(r.diagnostics.phase,'after_foreground_retry');assert.equal(r.diagnostics.dom.visibility,'visible');
 assert.equal(r.diagnostics.background.dom.visibility,'hidden');assert.equal(r.diagnostics.dom.html,undefined);
 assert.equal(e.tabs.length,1);assert.equal(e.tabs[0].active,true);assert.equal(e.state.facebookVerifiedConversationTabsV1,undefined);
});
test('foreground retries cannot accept a redirect to a different selected conversation',async()=>{
 const e=extension({redirect:reported,onUpdate:(tab,patch)=>{if(patch.active)tab.url=suite('999999');},read:{reason:'profile_customer_heading_missing'}});
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.opened,true);assert.equal(r.verified,false);
 assert.equal(r.diagnostics.observedNavigationId,'999999');assert.equal(e.state.facebookVerifiedConversationTabsV1,undefined);
});
test('foreground retries preserve an inspection tab even if the user switches tabs',async()=>{
 let opened=false;const e=extension({redirect:reported,onUpdate:()=>{opened=true;},onGet:tab=>{if(opened)tab.active=false;},read:{reason:'profile_customer_heading_missing'}});
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.verified,false);assert.equal(e.tabs.length,1);
 assert.equal(e.history.filter(x=>x.action==='remove').length,0);assert.equal(e.history.filter(x=>x.action==='update').length,1);
});
test('wrong customer, ambiguous profile and sign-in failures do not trigger foreground recovery',async()=>{
 for(const reason of ['facebook_customer_mismatch','ambiguous_profile','facebook_sign_in_required','conversation_mismatch','facebook_inbox_load_failed']){
  const e=extension({redirect:reported,read:{reason}});const r=await e.api.openFacebook(args,e.sender);
  assert.equal(r.opened,false);assert.equal(e.history.filter(x=>x.action==='update').length,0);assert.equal(e.state.facebookVerifiedConversationTabsV1,undefined);
 }
});
test('direct Suite URL retains routing parameters and verifies before and after activation',async()=>{
 const e=extension({response:provider({conversationLink:reported})});const r=await e.api.openFacebook(args,e.sender);
 assert.equal(r.verified,true);assert.equal(e.tabs[0].url,reported);assert.ok(e.scripts.filter(x=>x.args).length>=4);
});
test('a second redirect caused by activating the verified tab is reported as a mismatch',async()=>{
 const e=extension({redirect:reported,onUpdate:(tab,patch)=>{if(patch.active)tab.url=suite('999999');}});
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.verified,false);assert.equal(r.exactRequested,false);
 assert.equal(r.diagnostics.phase,'after_activation');assert.equal(r.diagnostics.observedNavigationId,'999999');
 assert.equal(Object.keys(e.state.facebookVerifiedConversationTabsV1||{}).length,0);
});
test('repeat clicks reuse the loaded tab but recheck its rendered customer',async()=>{
 const e=extension({redirect:reported});const first=await e.api.openFacebook(args,e.sender);const reads=e.scripts.length;
 const second=await e.api.openFacebook(args,e.sender);assert.equal(second.cacheUsed,true);assert.equal(second.tabId,first.tabId);
 assert.equal(e.history.filter(x=>x.action==='create').length,1);assert.ok(e.scripts.length>reads);
});
test('a cached tab moved to another customer is preserved and replaced with a fresh verified tab',async()=>{
 const e=extension({redirect:reported});await e.api.openFacebook(args,e.sender);e.tabs[0].url=suite('999999');
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.verified,true);assert.equal(r.cacheUsed,false);assert.equal(e.tabs[0].url,suite('999999'));
 assert.equal(e.history.filter(x=>x.action==='create').length,2);assert.notEqual(r.tabId,e.tabs[0].id);
});
test('previous V1 and V2 navigation IDs cannot bypass loaded-customer checks',async()=>{
 const entry={navigationId:'61576318208827',providerRoute:`suite:${args.pageId}:61576318208827`,savedAt:Date.now()};
 const e=extension({state:{facebookNavigationCacheV1:{[`${args.pageId}:${args.threadId}`]:entry},facebookNavigationCacheV2:{[`${args.pageId}:${args.threadId}`]:entry}},redirect:reported,read:{reason:'conversation_mismatch'}});
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.opened,false);assert.equal(e.history.filter(x=>x.action==='update').length,0);
});
test('missing provider link opens no default or guessed customer thread',async()=>{
 const e=extension({response:provider({conversationLink:null})});const r=await e.api.openFacebook(args,e.sender);
 assert.equal(r.opened,false);assert.equal(r.reason,'facebook_provider_link_unavailable');assert.equal(e.tabs.length,0);
});
test('loading or pending URLs do not count as displayed conversation evidence',async()=>{
 for(const config of [{loading:true},{onCreate:tab=>{tab.pendingUrl=reported;}}]){
  const e=extension({redirect:reported,...config});const r=await e.api.openFacebook(args,e.sender);
  assert.equal(r.opened,false);assert.equal(e.scripts.length,0);assert.equal(e.tabs.length,0);
 }
});
test('user takeover during verification preserves their tab without focusing or closing it',async()=>{
 const e=extension({redirect:reported,onGet:tab=>{tab.active=true;}});const r=await e.api.openFacebook(args,e.sender);
 assert.equal(r.verified,false);assert.equal(e.tabs.length,1);assert.equal(e.history.filter(x=>x.action!=='create').length,0);
});
test('DOM selection mismatch cannot be hidden by matching Page and customer fields',async()=>{
 const e=extension({redirect:reported,read:{found:true,pageId:args.pageId,matchedThreadId:args.threadId,selectedItemId:'999999',profileUrl:'https://www.facebook.com/profile.php?id=100073163121418'}});
 assert.equal((await e.api.openFacebook(args,e.sender)).opened,false);
});
test('authorization rejects mismatched customer context before opening any tab',async()=>{
 const e=extension({response:provider({threadId:'999999'})});assert.equal((await e.api.openFacebook(args,e.sender)).opened,false);assert.equal(e.tabs.length,0);
});
test('two pending requests for the same click context share one operation',async()=>{
 const e=extension({redirect:reported});const [a,b]=await Promise.all([e.api.openFacebook(args,e.sender),e.api.openFacebook(args,e.sender)]);
 assert.equal(a.tabId,b.tabId);assert.equal(e.history.filter(x=>x.action==='create').length,1);
});
test('ambiguous or missing customer identity cannot populate a verified tab cache',async()=>{
 for(const reason of ['ambiguous_profile','profile_customer_heading_missing','facebook_sign_in_required']){
  const e=extension({redirect:reported,read:{reason}});const r=await e.api.openFacebook(args,e.sender);assert.equal(r.verified,false);assert.equal(e.state.facebookVerifiedConversationTabsV1,undefined);
 }
});
test('a fresh provider destination supersedes a previous direct-link cache entry',async()=>{
 const e=extension({response:provider({conversationLink:reported}),state:{facebookNavigationCacheV2:{[`${args.pageId}:${args.threadId}`]:{navigationId:'111111',providerRoute:`suite:${args.pageId}:111111`,savedAt:Date.now()}}}});
 assert.equal((await e.api.openFacebook(args,e.sender)).navigationId,'61576318208827');assert.equal(e.tabs[0].url,reported);
});
test('unverified browser observations cannot enter the persistent navigation cache',async()=>{
 const e=extension();assert.equal(await e.api.rememberFacebookNavigationId(args.pageId,args.threadId,'61576318208827',legacy),false);
 assert.equal(e.state.facebookNavigationCacheV2,undefined);
});
test('conflicting Page identifiers and PSIDs are rejected as navigation destinations',()=>{
 const e=extension();assert.equal(e.api.navigationIdFromFacebookUrl(reported+'&page_id=999',args.pageId,args.threadId),null);
 assert.equal(e.api.navigationIdFromFacebookUrl(suite(args.threadId),args.pageId,args.threadId),null);
});
