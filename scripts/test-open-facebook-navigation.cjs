const fs=require('fs'),vm=require('vm'),{test}=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync('tenh-extension/src/background.js','utf8');
function extension(options={}){
 let clock=Date.now(); class Clock extends Date { static now(){return clock;} }
 let nextId=100;const tabs=structuredClone(options.tabs||[]),history=[],network=[];const state={installationId:'test-install',token:'FAKE_DEVICE_TOKEN',...(options.state||{})};
 const event=()=>({addListener(){}});
 const storage={get:async keys=>{const list=Array.isArray(keys)?keys:[keys];return Object.fromEntries(list.map(k=>[k,state[k]]))},set:async patch=>Object.assign(state,patch),remove:async keys=>{for(const k of (Array.isArray(keys)?keys:[keys]))delete state[k]}};
 const session={get:async key=>({[key]:state[key]}),set:async patch=>Object.assign(state,patch),remove:async keys=>{for(const k of (Array.isArray(keys)?keys:[keys]))delete state[k]}};
 const chrome={runtime:{id:'testextension',getManifest:()=>({version:'1.2.28'}),onMessage:event(),onConnect:event(),onInstalled:event(),onStartup:event()},storage:{local:storage,session},alarms:{onAlarm:event(),create(){}},action:{setBadgeText:async()=>{}},tabs:{onUpdated:event(),onRemoved:event(),get:async id=>{const t=tabs.find(x=>x.id===id);if(!t)throw new Error('Missing');return {...t}},query:async()=>tabs.map(t=>({...t})),update:async(id,patch)=>{history.push({action:'update',id,patch});const t=tabs.find(t=>t.id===id);Object.assign(t,patch);return {...t}},create:async props=>{history.push({action:'create',props});const t={id:nextId++,windowId:1,status:'complete',...props};if(options.redirect && !props.active)Object.assign(t,{url:options.redirect,status:options.loading?'loading':'complete',pendingUrl:options.redirect});tabs.push(t);return {...t}},remove:async id=>{history.push({action:'remove',id});const i=tabs.findIndex(t=>t.id===id);if(i>=0)tabs.splice(i,1)},sendMessage:async()=>({})},windows:{update:async()=>{}},scripting:{executeScript:async request=>request.files?[]:[{frameId:0,result:options.profile||{reason:'conversation_mismatch'}}]}};
 const response=options.response||null;
 const context={Date:Clock,chrome,console,URL,URLSearchParams,crypto:require('crypto').webcrypto,AbortSignal,WebSocket:{OPEN:1},setTimeout:(fn,ms)=>{clock+=ms;fn();return 1;},clearTimeout,setInterval,clearInterval,fetch:async(url,init)=>{network.push({url,init});if(String(url).includes('/api/extension/conversations/open-context')){const body=JSON.parse(init.body);return new Response(JSON.stringify(response||{success:true,verified:true,...body}),{status:options.status||200});}throw new Error('unexpected fetch '+url)}};
 vm.runInNewContext(source+'\n globalThis.testAPI={openFacebook,resolveFacebookNavigationId,cachedFacebookNavigationId,rememberFacebookNavigationId,navigationIdFromFacebookUrl};',context);
 const sender={id:'testextension',frameId:0,tab:{id:9,url:'https://app.tenhchat.com/dashboard/inbox'},url:'https://app.tenhchat.com/dashboard/inbox'};
 return {api:context.testAPI,tabs,history,network,state,sender};
}
const args={businessId:'b1',conversationId:'uuid1',pageId:'393342417206745',threadId:'28288665770787398'};
test('Open in Meta uses authorized global id and Pancake-style URL',async()=>{const globalId='100073163121418';const conversationLink=`https://business.facebook.com/latest/inbox/all?asset_id=${args.pageId}&mailbox_id=&selected_item_id=${globalId}&thread_type=FB_MESSAGE`;const e=extension({response:{success:true,verified:true,...args,conversationLink,navigationId:globalId,businessId:'b1'}});const r=await e.api.openFacebook(args,e.sender);assert.equal(r.opened,true);assert.equal(r.navigationId,globalId);const u=new URL(e.tabs[0].url);assert.equal(u.searchParams.get('asset_id'),args.pageId);assert.equal(u.searchParams.get('nav_ref'),'diode_page_inbox');assert.equal(u.searchParams.get('mailbox_id'),'');assert.equal(u.searchParams.get('selected_item_id'),globalId);assert.notEqual(u.searchParams.get('selected_item_id'),args.threadId)});
test('without a verified provider/global id TENH opens only the Page inbox, never PSID as selected_item_id',async()=>{const e=extension({response:{success:true,verified:true,...args,businessId:'b1',navigationReason:'profile_conversation_not_found'}});const r=await e.api.openFacebook(args,e.sender);assert.equal(r.opened,true);assert.equal(r.exactRequested,false);const u=new URL(e.tabs[0].url);assert.equal(u.searchParams.get('asset_id'),args.pageId);assert.equal(u.searchParams.get('selected_item_id'),null)});
test('server provider link can be opened directly when no global id is available',async()=>{const conversationLink=`https://www.facebook.com/${args.pageId}/inbox/1187032264483411/?section=messages`;const e=extension({response:{success:true,verified:true,...args,businessId:'b1',conversationLink}});const r=await e.api.openFacebook(args,e.sender);assert.equal(r.opened,true);assert.equal(r.providerLink,true);assert.equal(e.tabs.at(-1).url,conversationLink);assert.ok(!e.tabs.at(-1).url.includes(args.threadId))});

const legacy = `https://www.facebook.com/${args.pageId}/inbox/1187032264483411/?section=messages`;
const suite = id => `https://business.facebook.com/latest/inbox/all?asset_id=${args.pageId}&selected_item_id=${id}&thread_type=FB_MESSAGE`;
const apiResponse = patch => ({success:true,verified:true,...args,customerName:'Customer',linkSource:'meta_conversations_api',conversationLink:legacy,...patch});
test('old seven-day cache never sends another customer to the stale thread',async()=>{
 const stale='1031384773402503';const e=extension({state:{facebookNavigationCacheV1:{[`${args.pageId}:${args.threadId}`]:{navigationId:stale,savedAt:Date.now()}}},redirect:suite(stale),profile:{reason:'conversation_mismatch'},response:apiResponse({})});
 const r=await e.api.openFacebook(args,e.sender);
 assert.equal(r.exactRequested,false);assert.equal(r.navigationId,undefined);
 assert.ok(!e.history.some(x=>x.action==='update' && x.patch.url?.includes(`selected_item_id=${stale}`)));
 assert.equal(e.state.facebookNavigationCacheV2,undefined);
});
test('fresh participant-verified provider link wins over an old mapping',async()=>{
 const old='1031384773402503',fresh='100073163121418';const e=extension({state:{facebookNavigationCacheV2:{[`${args.pageId}:${args.threadId}`]:{navigationId:old,providerRoute:`suite:${args.pageId}:${old}`,savedAt:Date.now()}}},response:apiResponse({conversationLink:suite(fresh),navigationId:old})});
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.navigationId,fresh);assert.equal(r.exactRequested,true);
 assert.equal(await e.api.cachedFacebookNavigationId(args.pageId,args.threadId,suite(fresh)),fresh);
 assert.equal(await e.api.cachedFacebookNavigationId(args.pageId,args.threadId,suite(old)),null);
 assert.equal(await e.api.cachedFacebookNavigationId('111',args.threadId,suite(fresh)),null);
 assert.equal(await e.api.cachedFacebookNavigationId(args.pageId,'222',suite(fresh)),null);
});
test('unverified redirect ID cannot be written by navigation or profile lookup',async()=>{
 const e=extension();assert.equal(await e.api.rememberFacebookNavigationId(args.pageId,args.threadId,'1031384773402503'),false);
 assert.equal(await e.api.rememberFacebookNavigationId(args.pageId,args.threadId,'1031384773402503',legacy),false);
 assert.equal(e.state.facebookNavigationCacheV2,undefined);
});
test('matching customer card on two loaded redirect reads permits this click without persisting redirect identity',async()=>{
 const nav='100073163121418';const e=extension({redirect:suite(nav),profile:{found:true,pageId:args.pageId,matchedThreadId:args.threadId,profileUrl:`https://www.facebook.com/profile.php?id=${nav}`},response:apiResponse({})});
 const r=await e.api.openFacebook(args,e.sender);assert.equal(r.navigationId,nav);assert.equal(r.exactRequested,true);assert.equal(e.state.facebookNavigationCacheV2,undefined);
 assert.ok(e.history.some(x=>x.action==='remove'), 'owned lookup tab is cleaned up');
});
test('pending redirect URL cannot identify a loaded customer',async()=>{
 const e=extension({loading:true,redirect:suite('1031384773402503'),profile:{found:true,pageId:args.pageId,matchedThreadId:args.threadId,profileUrl:'https://www.facebook.com/profile.php?id=100073163121418'}});
 assert.equal(await e.api.resolveFacebookNavigationId(legacy,args.pageId,args.threadId,'Customer'),null);
 assert.equal(e.state.facebookNavigationCacheV2,undefined);
});
test('conflicting Page IDs and PSIDs are rejected as navigation targets',()=>{
 const e=extension();assert.equal(e.api.navigationIdFromFacebookUrl(suite('1031384773402503')+'&page_id=999',args.pageId,args.threadId),null);
 assert.equal(e.api.navigationIdFromFacebookUrl(suite(args.threadId),args.pageId,args.threadId),null);
});
