const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const req = require('node:module').createRequire(path.resolve(__dirname, '../../package.json'));
const { JSDOM } = require('jsdom');
// React performs DOM/input-event feature detection when react-dom is loaded.
// Provide a browser document before that import so typing exercises onChange.
const bootstrapDom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = bootstrapDom.window; global.document = bootstrapDom.window.document;
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client');
const { renderToStaticMarkup } = req('react-dom/server');
bootstrapDom.window.close();
const { loader } = require('../tenh-seven/harness.cjs');
const context = { pageId:'203981939455120',threadId:'38366250273019952',conversationId:'c1',businessId:'b1' };
const link = `https://business.facebook.com/latest/inbox/all?asset_id=${context.pageId}&selected_item_id=100029016673099&mailbox_id=${context.pageId}&thread_type=FB_MESSAGE`;
const good = (patch={}) => ({success:true,conversationId:context.conversationId,businessId:context.businessId,pageId:context.pageId,recipientId:context.threadId,linkSource:'meta_conversations_api',conversationLink:link,...patch});
const overrides = {
 react:React,'react/jsx-runtime':req('react/jsx-runtime'),'lucide-react':req('lucide-react'),
 '@/lib/extension/use-companion':{useCompanion:()=>{throw new Error('This action must not access the extension');}},
 '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=> 'en'},
 '@/lib/supabase/client':{createClient:()=>({auth:{getUser:async()=>({data:{user:null}})}})},
 './conversation-visuals':{ConversationBookmark:()=>null},'./conversation-status-menu':{ConversationStatusMenu:()=>null},
};
let fetcher,copyDetails;
const load=loader(overrides,{AbortController,URLSearchParams,window:{open:(...args)=>global.window.open(...args)},navigator:{clipboard:{writeText:value=>copyDetails(value)}},fetch:(...args)=>fetcher(...args)});
const {CompanionFacebookAction}=load('components/inbox/companion-facebook-action.tsx');
overrides['./companion-facebook-action']={CompanionFacebookAction};
const {ConversationHeader}=load('components/inbox/conversation-header.tsx');
async function mount(t,{response=good(),status=200,blocked=false,props={},fetchImpl}={}) {
 const dom=new JSDOM('<div id="root"></div>',{url:'https://app.tenhchat.com'});
 global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const calls=[],opened=[],navigations=[],copied=[];copyDetails=async value=>{copied.push(value);};
 window.open=(url,target)=>{
  if(blocked)return null;
  const popup={closed:false,opener:{},document:document.implementation.createHTMLDocument(),
   location:{href:url,replace:to=>{popup.location.href=to;navigations.push(to);}},close:()=>{popup.closed=true;}};
  opened.push({url,target,popup});return popup;
 };
 fetcher=async(url,options)=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options):new Response(typeof response==='string'?response:JSON.stringify(response),{status,headers:{'Content-Type':typeof response==='string'?'text/html':'application/json'}});};
 const root=createRoot(document.getElementById('root'));
 let unmounted=false;
 const render=async patch=>act(async()=>root.render(React.createElement(CompanionFacebookAction,{...context,compact:true,...props,...patch})));
 const unmount=async()=>{if(!unmounted){unmounted=true;await act(async()=>root.unmount());}};
 await render();t.after(async()=>{await unmount();dom.window.close();});
 return {calls,opened,navigations,copied,render,unmount,click:async()=>act(async()=>document.querySelector('button').click())};
}
test('one click opens the API-returned conversation without any installed extension',async t=>{
 const h=await mount(t);assert.equal(h.calls.length,0);assert.equal(h.opened.length,0);await h.click();
 assert.equal(h.calls.length,1);const url=new URL(h.calls[0].url,'https://app.tenhchat.com');
 assert.equal(url.pathname,'/api/conversations/c1/facebook-conversation');
 assert.equal(url.searchParams.get('pageId'),context.pageId);assert.equal(url.searchParams.get('recipientId'),context.threadId);
 assert.equal(url.searchParams.get('businessId'),context.businessId);assert.equal(h.calls[0].options.credentials,'same-origin');
 assert.deepEqual(h.navigations,[link]);assert.equal(h.opened[0].popup.opener,null);assert.equal(h.opened[0].popup.closed,false);
 assert.equal(document.querySelector('[role="alert"]'),null);
});
test('provider routing parameters are preserved without replacing the inbox ID with a PSID',async t=>{
 const full=`https://business.facebook.com/latest/inbox/all?bpn_id=123&asset_id=${context.pageId}&nav_ref=manage_page_ap_plus_default&selected_item_id=100029016673099&mailbox_id=${context.pageId}&thread_type=FB_MESSAGE`;
 const h=await mount(t,{response:good({conversationLink:full})});await h.click();assert.deepEqual(h.navigations,[full]);assert.ok(!h.navigations[0].includes(context.threadId));
});
test('popup blocking offers a normal browser link without requiring installation',async t=>{
 const h=await mount(t,{blocked:true});await h.click();const a=document.querySelector('a');assert.equal(a.href,link);
 assert.equal(a.rel,'noopener noreferrer');assert.equal(a.target,'_blank');assert.equal(h.navigations.length,0);assert.doesNotMatch(document.body.textContent,/install|companion/i);
});
test('a missing Meta link closes only the blank loading tab and shows the API error',async t=>{
 const h=await mount(t,{response:{success:false,error:'Meta did not return a link for this conversation.'},status:424});await h.click();
 assert.equal(h.opened[0].popup.closed,true);assert.equal(h.navigations.length,0);assert.match(document.querySelector('[role="alert"]').textContent,/did not return a link/);
 assert.equal(document.querySelector('a'),null);await h.click();assert.equal(new URL(h.calls[1].url,'https://app.tenhchat.com').searchParams.get('refresh'),'1');
});
test('HTML from an unavailable route is handled without leaking a JSON parse exception',async t=>{
 const h=await mount(t,{response:'<!DOCTYPE html><title>Error</title>',status:404});await h.click();
 assert.match(document.querySelector('[role="alert"]').textContent,/unexpected response/);assert.equal(h.navigations.length,0);assert.equal(h.opened[0].popup.closed,true);
});
test('pending requests suppress repeated clicks and restore the button after failure',async t=>{
 let finish;const h=await mount(t,{fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});await h.click();await h.click();
 assert.equal(h.calls.length,1);assert.equal(document.querySelector('button').disabled,true);
 await act(async()=>finish(new Response(JSON.stringify({success:false,error:'Try again'}),{status:503})));
 assert.equal(document.querySelector('button').disabled,false);assert.equal(h.opened[0].popup.closed,true);
});
test('switching conversations aborts the old lookup and prevents late navigation',async t=>{
 let finish;const h=await mount(t,{fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});await h.click();
 await h.render({conversationId:'c2',threadId:'999999'});assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.opened[0].popup.closed,true);
 await act(async()=>finish(new Response(JSON.stringify(good()))));assert.equal(h.navigations.length,0);assert.equal(document.querySelector('[role="alert"]'),null);
});
test('unmounting closes the untouched loading tab and cancels the pending request',async t=>{
 let finish;const h=await mount(t,{fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});await h.click();await h.unmount();
 assert.equal(h.calls[0].options.signal.aborted,true);assert.equal(h.opened[0].popup.closed,true);
 await act(async()=>finish(new Response(JSON.stringify(good()))));assert.equal(h.navigations.length,0);
});
test('a user-navigated loading tab is never overwritten or closed',async t=>{
 let finish;const h=await mount(t,{fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});await h.click();h.opened[0].popup.location.href='https://example.com';
 await act(async()=>finish(new Response(JSON.stringify(good()))));assert.equal(h.navigations.length,0);assert.equal(h.opened[0].popup.closed,false);assert.equal(document.querySelector('a').href,link);
});
for(const patch of [{businessId:'other'},{conversationId:'other'},{recipientId:'other'},{pageId:'other'},{linkSource:'browser_cache'},{conversationLink:'https://evil.test/'}])test('mismatched or unsafe responses cannot navigate '+JSON.stringify(patch),async t=>{
 const h=await mount(t,{response:good(patch)});await h.click();assert.equal(h.navigations.length,0);assert.equal(h.opened[0].popup.closed,true);assert.equal(document.querySelector('a'),null);
});
test('missing Page/customer context does not open a blank tab or call the API',async t=>{
 const h=await mount(t,{props:{pageId:null}});await h.click();assert.equal(h.calls.length,0);assert.equal(h.opened.length,0);
});
test('the real header keeps external conversation navigation hidden',()=>{
 const conversation={id:'c1',source_type:'messenger',status:'open',social_account:{id:'s1',platform:'facebook',platform_account_id:context.pageId,account_name:'Page'},contact:{id:'ct1',business_id:'b1',platform_user_id:context.threadId,full_name:'Customer'}};
 const render=value=>new JSDOM(renderToStaticMarkup(React.createElement(ConversationHeader,{conversation:value,teamMembers:[],viewingAgents:[],typingAgents:[],teamPresence:[],agentPresenceStatus:'connected',channelPlatform:'messenger',channelAccountName:'Page'}))).window.document;
 assert.equal(render(conversation).querySelector('[aria-label="Open in Meta Business Suite"]'),null);
 for(const other of [{...conversation,source_type:'comment'},{...conversation,social_account:{...conversation.social_account,platform:'telegram'}},{...conversation,social_account:null}])assert.equal(render(other).querySelector('[aria-label="Open in Meta Business Suite"]'),null);
});

const buttonWith=text=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent===text);
const clickText=async text=>act(async()=>{const button=buttonWith(text);assert.ok(button,`Missing button: ${text}`);button.click();});
test('a stored customer link opens without extension or setup',async t=>{
 const h=await mount(t,{response:good({linkSource:'agent_saved_business_suite',cacheUsed:true})});await h.click();assert.deepEqual(h.navigations,[link]);
});
test('a legacy link from an older server cannot redirect to the first conversation',async t=>{
 const h=await mount(t,{response:good({conversationLink:`https://www.facebook.com/${context.pageId}/inbox/1372921689227800/?section=messages`})});
 await h.click();assert.equal(h.navigations.length,0);assert.equal(h.opened[0].popup.closed,true);assert.match(document.querySelector('[role="alert"]').textContent,/Direct opening in Business Suite/);
});
test('the compact shortcut does not offer manual link editing after a failed redirect',async t=>{
 const h=await mount(t,{response:good({success:false,reason:'facebook_direct_link_required',canSaveLink:true,error:'Add this customer link.'}),status:424});
 await h.click();assert.equal(buttonWith('Set conversation link'),undefined);assert.equal(buttonWith('Edit conversation link'),undefined);assert.equal(h.navigations.length,0);
});
const threadFound=()=>good({success:false,threadLookupSucceeded:true,thread_id:'t_971148639112183',threadIdSource:'meta_conversations_api',
 metaConversationLink:`https://www.facebook.com/${context.pageId}/inbox/1187032264483411/?section=messages`,cacheUsed:true,
 conversationLink:undefined,reason:'facebook_direct_link_required',canSaveLink:true,error:'Meta found this conversation, but its link cannot select the customer in Business Suite.'});
test('a resolved thread is copyable for diagnosis without constructing a destination from it',async t=>{
 const h=await mount(t,{response:threadFound(),status:424});await h.click();assert.equal(h.navigations.length,0);assert.equal(document.querySelector('a'),null);
 document.querySelector('details').open=true;await clickText('Copy lookup details');const details=JSON.parse(h.copied[0]);
 assert.equal(details.thread_id,'t_971148639112183');assert.equal(details.recipientId,context.threadId);assert.equal(details.pageId,context.pageId);
 assert.equal(details.threadIdSource,'meta_conversations_api');assert.equal(document.querySelector('[role="status"]').textContent,'Copied');
});
test('reopening a resolved thread does not bypass the cache only because its browser link is unavailable',async t=>{
 const h=await mount(t,{response:threadFound(),status:424});await h.click();await h.click();assert.equal(h.calls.length,2);
 assert.equal(new URL(h.calls[1].url,'https://app.tenhchat.com').searchParams.has('refresh'),false);
});
test('lookup details reset on customer changes and mismatching responses never populate them',async t=>{
 const h=await mount(t,{response:threadFound(),status:424});await h.click();assert.ok(document.querySelector('details'));
 await h.render({conversationId:'c2',threadId:'99999'});assert.equal(document.querySelector('details'),null);
 await h.click();assert.equal(document.querySelector('details'),null);assert.equal(h.navigations.length,0);
});

test('the customer menu exposes View this conversation without an editing form',async t=>{
 const h=await mount(t,{props:{compact:false,menu:true}});
 assert.ok(buttonWith('View this conversation'));assert.equal(buttonWith('Edit conversation link'),undefined);
 assert.equal(document.querySelector('form'),null);assert.equal(h.calls.length,0);
});
