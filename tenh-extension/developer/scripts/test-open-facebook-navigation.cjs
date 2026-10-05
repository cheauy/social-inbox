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
 const tabs=structuredClone(options.tabs||[]),history=[],network=[],scripts=[],watches=new Map();let focusedWindow=1;
 const initial={installationId:'test-install',token:'FAKE_DEVICE_TOKEN',...(options.state||{})};
 const state=localBuild ? new Proxy(Object.fromEntries(Object.entries(initial).map(([k,v])=>['tenh-localhost-3000:'+k,v])),{
  get:(obj,key)=>obj[String(key).startsWith('tenh-localhost-3000:')?key:'tenh-localhost-3000:'+String(key)],
  set:(obj,key,value)=>{obj[String(key).startsWith('tenh-localhost-3000:')?key:'tenh-localhost-3000:'+String(key)]=value;return true;},
  deleteProperty:(obj,key)=>{delete obj[String(key).startsWith('tenh-localhost-3000:')?key:'tenh-localhost-3000:'+String(key)];return true;}
 }) : initial;
 const event=()=>({addListener(){}});
 const storage={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,state[k]])),set:async patch=>Object.assign(state,patch),remove:async keys=>{for(const k of(Array.isArray(keys)?keys:[keys]))delete state[k];}};
 const chrome={runtime:{id:'testextension',getManifest:()=>manifest,onMessage:event(),onConnect:event(),onInstalled:event(),onStartup:event()},storage:{local:storage,session:storage},alarms:{onAlarm:event(),create(){}},action:{setBadgeText:async()=>{}},
 tabs:{onUpdated:event(),onRemoved:event(),get:async id=>{const t=tabs.find(x=>x.id===id);if(!t)throw new Error('Missing');options.onGet?.(t);return {...t};},query:async filter=>tabs.filter(t=>(!filter?.active||t.active)&&(!filter?.lastFocusedWindow||(t.windowId||1)===focusedWindow)).map(t=>({...t})),
  update:async(id,patch)=>{history.push({action:'update',id,patch});const t=tabs.find(t=>t.id===id);if(patch.active)for(const other of tabs)if((other.windowId||1)===(t.windowId||1))other.active=false;Object.assign(t,patch);options.onUpdate?.(t,patch,tabs);return {...t};},
  create:async props=>{history.push({action:'create',props});const t={id:nextId++,windowId:1,status:'complete',...props};if(options.redirect && !props.active)t.url=options.redirect;
   if(options.loading){t.status='loading';t.pendingUrl=options.redirect||props.url;}
   options.onCreate?.(t);tabs.push(t);return {...t};},remove:async id=>{history.push({action:'remove',id});const i=tabs.findIndex(t=>t.id===id);if(i>=0)tabs.splice(i,1);},sendMessage:async()=>({})},
 windows:{update:async(id)=>{focusedWindow=id;}},scripting:{executeScript:async request=>{
  scripts.push(request);if(request.files)return [];
  const tab=tabs.find(x=>x.id===request.target.tabId),context=request.args[0];
  if(typeof context==='string' && ['arm','read','clear'].includes(request.args[1])) {
   const action=request.args[1];if(action==='arm')watches.set(tab.id,{token:context,url:tab.url});
   const watch=watches.get(tab.id),result={known:Boolean(watch&&watch.token===context&&!options.watchUnavailable),interacted:Boolean(options.interacted?.(tab,action)),unchangedUrl:watch?.url===tab.url};
   if(action==='clear')watches.delete(tab.id);return [{frameId:0,result}];
  }
  const result=typeof options.read==='function'?options.read(tab,context,request.args[1]):options.read||{
   found:true,pageId:context.pageId,matchedThreadId:context.threadId,
   selectedItemId:new URL(tab.url).searchParams.get('selected_item_id'),profileUrl:'https://www.facebook.com/profile.php?id=100073163121418'};
  return [{frameId:0,result}];
 }}};
 const sandbox={Date:Clock,chrome,console,URL,URLSearchParams,crypto:require('crypto').webcrypto,AbortSignal,WebSocket:{OPEN:1},
 setTimeout:(fn,ms)=>{if(ms===350){clock+=ms;queueMicrotask(fn);return null;}return setTimeout(fn,ms);},clearTimeout,setInterval,clearInterval,
 fetch:async(url,init)=>{network.push({url,init});if(String(url).includes('/api/extension/conversations/open-context'))return new Response(JSON.stringify(options.response||provider()),{status:options.status||200});throw new Error('Unexpected fetch');}};
 vm.runInNewContext(source+'\nglobalThis.testAPI={openFacebook,prepareFacebookConversation,commitFacebookConversation,cancelFacebookConversation,handle,cachedFacebookNavigationId,rememberFacebookNavigationId,navigationIdFromFacebookUrl};',sandbox);
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

const verifiedRequest = { ...args, navigationRequestId:'verified-request-1' };
test('capability comes from the live worker and identifies its app origin',async()=>{
 const e=extension(),r=await e.api.handle({type:'TENH_EXTENSION_PING'},e.sender);
 assert.equal(r.verifiedConversationNavigation,true);assert.equal(r.appOrigin,localBuild?'http://localhost:3000':'https://app.tenhchat.com');assert.equal(r.connected,true);
});
test('two phase navigation keeps provider routing intact and focuses only after commit',async()=>{
 const e=extension({redirect:reported});const p=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);
 assert.equal(p.prepared,true);assert.equal(p.opened,false);assert.equal(e.tabs[0].active,false);assert.equal(e.history.filter(x=>x.action==='update').length,0);
 const r=await e.api.commitFacebookConversation({...verifiedRequest,openToken:p.openToken},e.sender);
 assert.equal(r.opened,true);assert.equal(r.exactRequested,true);assert.equal(r.verified,true);assert.equal(r.businessId,args.businessId);
 assert.equal(e.network.length,2);assert.equal(e.tabs[0].url,reported);assert.ok(e.history.filter(x=>x.action==='update').every(x=>!('url' in x.patch)));
});
test('strict prepare fails closed for wrong, ambiguous and hidden customers without foreground retry',async()=>{
 for(const reason of ['facebook_customer_mismatch','ambiguous_profile','profile_customer_heading_missing','facebook_sign_in_required']){
  const e=extension({redirect:reported,read:{reason}});const r=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);
  assert.notEqual(r.prepared,true);assert.equal(r.opened,false);assert.equal(e.history.filter(x=>x.action==='update').length,0);assert.equal(e.tabs.length,0);
 }
});
test('cancelling a prepared customer removes only its untouched inactive tab and makes the ticket unusable',async()=>{
 const e=extension({redirect:reported}),p=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);
 await e.api.cancelFacebookConversation(verifiedRequest,e.sender);
 assert.equal((await e.api.commitFacebookConversation({...verifiedRequest,openToken:p.openToken},e.sender)).opened,false);
 assert.equal(e.tabs.length,0);assert.equal(e.history.filter(x=>x.action==='update').length,0);
});
test('cancel during provider authorization opens no stale tab',async()=>{
 const e=extension({redirect:reported});const task=e.api.prepareFacebookConversation(verifiedRequest,e.sender);
 await e.api.cancelFacebookConversation(verifiedRequest,e.sender);const r=await task;
 assert.equal(r.opened,false);assert.equal(e.tabs.length,0);assert.equal(e.history.filter(x=>x.action==='create').length,0);
});
test('ticket binds full context and sender document, and can only be consumed once',async()=>{
 const e=extension({redirect:reported}),p=await e.api.prepareFacebookConversation(verifiedRequest,{...e.sender,documentId:'doc-1'}),opts={...verifiedRequest,openToken:p.openToken};
 for(const key of ['businessId','conversationId','pageId','threadId'])assert.equal((await e.api.commitFacebookConversation({...opts,[key]:'wrong'},{...e.sender,documentId:'doc-1'})).opened,false);
 assert.equal((await e.api.commitFacebookConversation(opts,{...e.sender,documentId:'doc-2'})).opened,false);
 const both=await Promise.all([e.api.commitFacebookConversation(opts,{...e.sender,documentId:'doc-1'}),e.api.commitFacebookConversation(opts,{...e.sender,documentId:'doc-1'})]);
 assert.equal(both.filter(x=>x.verified===true).length,1);assert.equal(e.history.filter(x=>x.action==='update').length,1);
});
test('customer or route changes between prepare and commit cannot be activated',async()=>{
 const e=extension({redirect:reported}),p=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);
 e.tabs[0].url=suite('999999');
 const r=await e.api.commitFacebookConversation({...verifiedRequest,openToken:p.openToken},e.sender);
 assert.equal(r.opened,false);assert.equal(e.history.filter(x=>x.action==='update').length,0);assert.equal(e.tabs.length,1,'user navigation is preserved');
});
test('authorization is repeated and revocation or changed provider context blocks activation',async()=>{
 const response=provider(),e=extension({redirect:reported,response}),p=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);
 response.threadId='999999';
 const r=await e.api.commitFacebookConversation({...verifiedRequest,openToken:p.openToken},e.sender);
 assert.equal(r.opened,false);assert.equal(e.history.filter(x=>x.action==='update').length,0);assert.equal(e.tabs.length,0);
});
test('DOM mismatch after prepare blocks activation even if the route stays the same',async()=>{
 let mismatch=false;const e=extension({redirect:reported,read:(tab,ctx)=>mismatch?{reason:'facebook_customer_mismatch'}:{found:true,pageId:ctx.pageId,matchedThreadId:ctx.threadId,selectedItemId:'61576318208827',profileUrl:'https://www.facebook.com/customer'}});
 const p=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);mismatch=true;
 assert.equal((await e.api.commitFacebookConversation({...verifiedRequest,openToken:p.openToken},e.sender)).opened,false);assert.equal(e.history.filter(x=>x.action==='update').length,0);
});
test('a redirect after activation cannot become verified success or a durable mapping',async()=>{
 const e=extension({redirect:reported,onUpdate:(tab,patch)=>{if(patch.active)tab.url=suite('999999');}}),p=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);
 assert.equal((await e.api.commitFacebookConversation({...verifiedRequest,openToken:p.openToken},e.sender)).verified,false);
 assert.equal(e.state.facebookNavigationCacheV2,undefined);assert.equal(e.state.facebookVerifiedConversationTabsV1,undefined);assert.equal(e.tabs.length,1);
});
test('cancellation during commit DOM recheck prevents tab activation',async()=>{
 let reads=0,e; e=extension({redirect:reported,read:(tab,ctx)=>{
  if(++reads===3)void e.api.cancelFacebookConversation(verifiedRequest,e.sender);
  return {found:true,pageId:ctx.pageId,matchedThreadId:ctx.threadId,selectedItemId:'61576318208827',profileUrl:'https://www.facebook.com/customer'};
 }});
 const p=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);
 assert.equal((await e.api.commitFacebookConversation({...verifiedRequest,openToken:p.openToken},e.sender)).opened,false);
 assert.equal(e.history.filter(x=>x.action==='update').length,0);
});
test('user navigation during prepare is preserved when its route changed',async()=>{
 let reads=0;const e=extension({redirect:reported,read:tab=>{if(++reads===1)tab.url=suite('999999');return {reason:'facebook_customer_mismatch'};}});
 assert.equal((await e.api.prepareFacebookConversation(verifiedRequest,e.sender)).opened,false);
 assert.equal(e.tabs.length,1);assert.equal(e.tabs[0].url,suite('999999'));assert.equal(e.history.filter(x=>x.action==='update').length,0);
});

function sourceTab(){return {id:9,windowId:1,status:'complete',active:true,url:(localBuild?'http://localhost:3000':'https://app.tenhchat.com')+'/dashboard/inbox'};}
function loadedRead(tab,ctx){return tab.active?{reason:'facebook_customer_mismatch',diagnostics:{composerFound:false,headerCandidates:1,matchingHeaders:0}}:
 {found:true,pageId:ctx.pageId,matchedThreadId:ctx.threadId,selectedItemId:'61576318208827',profileUrl:'https://www.facebook.com/customer'};}
async function preparedCommit(e){const p=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);assert.equal(p.prepared,true);return e.api.commitFacebookConversation({...verifiedRequest,openToken:p.openToken},e.sender);}
test('after-activation mismatch reports truth and returns focus, closing only its untouched temporary tab',async()=>{
 const unrelated={id:44,windowId:1,status:'complete',active:false,url:suite('999999')};
 const e=extension({tabs:[sourceTab(),unrelated],redirect:reported,read:loadedRead}),r=await preparedCommit(e);
 assert.equal(r.opened,true);assert.equal(r.verified,false);assert.equal(r.phase,'after_activation');assert.equal(r.verificationReason,'facebook_customer_mismatch');
 assert.equal(r.focusReturned,true);assert.equal(r.temporaryTabClosed,true);assert.equal(e.tabs.find(t=>t.id===9).active,true);
 assert.equal(e.tabs.some(t=>t.id===44),true);assert.deepEqual(e.history.filter(x=>x.action==='remove').map(x=>x.id),[100]);
 assert.equal(r.diagnostics.dom.composerFound,false);assert.equal(r.diagnostics.dom.matchingHeaders,0);
});
test('trusted user interaction after activation preserves their tab and foreground',async()=>{
 const e=extension({tabs:[sourceTab()],redirect:reported,read:loadedRead,interacted:tab=>tab.active}),r=await preparedCommit(e);
 assert.equal(r.opened,true);assert.equal(r.phase,'after_activation');assert.equal(r.focusReturned,false);assert.equal(r.temporaryTabClosed,false);
 assert.equal(e.tabs.find(t=>t.id===100).active,true);assert.equal(e.history.some(x=>x.action==='remove'),false);
});
test('unavailable interaction guard prevents activation and cleans only the inactive temporary tab',async()=>{
 const e=extension({tabs:[sourceTab()],redirect:reported,watchUnavailable:true}),r=await preparedCommit(e);
 assert.equal(r.opened,false);assert.equal(r.phase,'before_activation');assert.equal(r.reason,'facebook_navigation_guard_unavailable');
 assert.equal(e.history.some(x=>x.action==='update'),false);assert.equal(e.tabs.length,1);
});
test('replaced document after activation prevents focus recovery and closing',async()=>{
 const options={tabs:[sourceTab()],redirect:reported,read:loadedRead,onUpdate:(tab,patch)=>{if(tab.id===100&&patch.active)options.watchUnavailable=true;}};
 const e=extension(options),r=await preparedCommit(e);assert.equal(r.opened,true);assert.equal(r.focusReturned,false);assert.equal(r.temporaryTabClosed,false);assert.equal(e.tabs.length,2);
});
test('activation redirect returns focus but preserves the changed Facebook destination',async()=>{
 const e=extension({tabs:[sourceTab()],redirect:reported,onUpdate:(tab,patch)=>{if(tab.id===100&&patch.active)tab.url=suite('999999');}}),r=await preparedCommit(e);
 assert.equal(r.opened,true);assert.equal(r.phase,'after_activation');assert.equal(r.focusReturned,true);assert.equal(r.temporaryTabClosed,false);
 assert.equal(e.tabs.find(t=>t.id===100).url,suite('999999'));assert.equal(e.history.some(x=>x.action==='remove'),false);
});
test('another user foreground tab prevents recovery from stealing focus',async()=>{
 const other={id:44,windowId:1,status:'complete',active:false,url:'https://example.test/'};
 let switched=false;const e=extension({tabs:[sourceTab(),other],redirect:reported,read:(tab,ctx)=>switched?{reason:'facebook_customer_mismatch'}:loadedRead(tab,ctx),onUpdate:(tab,patch,tabs)=>{if(tab.id===100&&patch.active){switched=true;tab.active=false;tabs.find(t=>t.id===44).active=true;}}}),r=await preparedCommit(e);
 assert.equal(r.opened,true);assert.equal(r.focusReturned,false);assert.equal(r.temporaryTabClosed,false);assert.equal(e.tabs.find(t=>t.id===44).active,true);
});
test('cached verified tab is never closed or subject to owned-tab recovery on failure',async()=>{
 let fail=false;const e=extension({tabs:[sourceTab()],redirect:reported,read:(tab,ctx)=>fail?loadedRead(tab,ctx):{found:true,pageId:ctx.pageId,matchedThreadId:ctx.threadId,selectedItemId:'61576318208827',profileUrl:'https://www.facebook.com/customer'}});
 assert.equal((await preparedCommit(e)).verified,true);e.tabs.find(t=>t.id===100).active=false;e.tabs.find(t=>t.id===9).active=true;
 fail=true;const r=await preparedCommit(e);assert.equal(r.opened,true);assert.equal(r.phase,'after_activation');assert.equal(r.focusReturned,undefined);
 assert.equal(e.history.filter(x=>x.action==='create').length,1);assert.equal(e.history.some(x=>x.action==='remove'),false);
});
test('prepare failure exposes only whitelisted reason, phase and structural diagnostics',async()=>{
 const secret='PRIVATE-CUSTOMER-URL-TOKEN';const e=extension({redirect:reported,read:{reason:'facebook_customer_mismatch',diagnostics:{composerFound:false,matchingHeaders:0,customerName:secret,html:secret}}});
 const r=await e.api.prepareFacebookConversation(verifiedRequest,e.sender);
 assert.equal(r.reason,'facebook_customer_mismatch');assert.equal(r.phase,'prepare');assert.equal(r.opened,false);assert.equal(r.diagnostics.dom.matchingHeaders,0);
 assert.equal(JSON.stringify(r).includes(secret),false);for(const key of ['tabId','customerName','navigationId','threadId','conversationId'])assert.equal(key in r,false);
});

test('interaction watcher records trusted input as a boolean without reading event content and clears listeners',async()=>{
 const e=extension({redirect:reported});await preparedCommit(e);
 const request=e.scripts.find(s=>s.args?.[1]==='arm'),handlers=new Map();
 const sandbox={location:{href:reported},document:{addEventListener:(type,fn)=>handlers.set(type,fn),removeEventListener:type=>handlers.delete(type)}};
 const call=action=>vm.runInNewContext('('+request.func.toString()+')('+JSON.stringify('test-ticket')+','+JSON.stringify(action)+')',sandbox);
 assert.equal(call('arm').interacted,false);assert.equal(handlers.size,4);
 handlers.get('keydown')({isTrusted:false});assert.equal(call('read').interacted,false);
 handlers.get('keydown')({isTrusted:true,get key(){throw Error('Must not read keystrokes');}});assert.equal(call('read').interacted,true);
 assert.equal(Object.keys(sandbox.__tenhNavigationInteraction).includes('key'),false);call('clear');assert.equal(handlers.size,0);assert.equal(call('read').known,false);
});

test('user input detected before activation transfers ownership and preserves the temporary tab',async()=>{
 const e=extension({tabs:[sourceTab()],redirect:reported,interacted:()=>true}),r=await preparedCommit(e);
 assert.equal(r.opened,false);assert.equal(r.phase,'before_activation');assert.equal(r.reason,'facebook_tab_in_use');assert.equal(e.tabs.length,2);
 assert.equal(e.history.some(x=>x.action==='remove'),false);assert.equal(e.history.some(x=>x.action==='update'),false);
});
