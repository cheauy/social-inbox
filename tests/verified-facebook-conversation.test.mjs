import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loader, hooks, tick } from './inbox-recovery-harness.cjs';
const context = { businessId:'b1', conversationId:'c1', pageId:'12345', threadId:'98765' };
const origin = 'https://app.tenhchat.com';
const { supportsVerifiedConversation, verifiedConversationOpened } = loader()('lib/extension/verified-conversation.ts');
const handshake = { type:'TENH_EXTENSION_PONG', version:'1.2.33', connected:true, verifiedConversationNavigation:true, appOrigin:origin };

test('verified navigation requires a live supported version, capability, connection and exact app origin', () => {
  assert.equal(supportsVerifiedConversation(handshake, origin), true);
  assert.equal(supportsVerifiedConversation({...handshake,version:'1.10.0'}, origin), true);
  for (const patch of [{version:'1.2.32'}, {version:'1.2.33-beta'}, {verifiedConversationNavigation:false},
    {verifiedConversationNavigation:undefined}, {connected:false}, {appOrigin:'http://localhost:3000'},
    {type:'TENH_EXTENSION_READY'}, {error:'invalidated'}, {requiresRefresh:true}]) assert.equal(supportsVerifiedConversation({...handshake,...patch}, origin), false);
});
test('opened alone and any wrong context cannot report verified success', () => {
  const ok = {...context,opened:true,exactRequested:true,verified:true};
  assert.equal(verifiedConversationOpened(ok,context),true);
  for(const key of ['opened','exactRequested','verified'])assert.equal(verifiedConversationOpened({...ok,[key]:false},context),false);
  for(const key of Object.keys(context))assert.equal(verifiedConversationOpened({...ok,[key]:'other'},context),false);
});

function host() {
  const listeners = new Map(), messages = [];
  const window = { location:{origin}, addEventListener(type, fn){ if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn); },
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);}, setTimeout,clearTimeout,setInterval,clearInterval,
    postMessage(data,target){assert.equal(target,origin);messages.push(data);} };
  const reply = (type, data, request = messages.findLast(message=>message.type===type)) => {
    for(const fn of [...(listeners.get('message') || [])])fn({source:window,origin,data:{source:'TENH_EXTENSION',
      type:type==='TENH_EXTENSION_PING'?'TENH_EXTENSION_PONG':`${type}_RESULT`,requestId:request?.requestId,...data}});
  };
  return {window, messages, reply};
}
function companionFixture() {
  const h=hooks(), browser=host();
  const useCompanion=loader({react:h.React},{window:browser.window})('lib/extension/use-companion.ts').useCompanion;
  const render=()=>h.render(useCompanion);
  render();browser.reply('TENH_EXTENSION_PING',handshake);
  return {...browser,h,render};
}
test('hook ignores uncorrelated and READY capability announcements', () => {
  const f=companionFixture();try {
    assert.equal(f.render().verifiedConversationNavigation,true);
    f.reply('TENH_EXTENSION_PING',{...handshake,requestId:'other',version:'1.2.32'});
    assert.equal(f.render().verifiedConversationNavigation,true);
    f.reply('TENH_EXTENSION_PING',{...handshake,connected:false});
    assert.equal(f.render().verifiedConversationNavigation,false);
  } finally {f.h.cleanup();}
});
test('prepare must match the exact context before the hook sends commit', async () => {
  const f=companionFixture(),controller=new AbortController();try {
    const task=f.render().openVerifiedConversation(context,controller.signal,()=>true);
    f.reply('PREPARE_FACEBOOK_CONVERSATION',{...context,threadId:'other',prepared:true,opened:false,exactRequested:true,verified:true,openToken:'00000000-0000-4000-8000-000000000001'});
    assert.equal(await task,null);assert.equal(f.messages.some(m=>m.type==='COMMIT_FACEBOOK_CONVERSATION'),false);
    assert.equal(f.messages.at(-1).type,'CANCEL_FACEBOOK_CONVERSATION');
  } finally {f.h.cleanup();}
});
test('selection changes before commit send cancellation and never activate the prepared tab', async () => {
  const f=companionFixture(),controller=new AbortController();let current=true;try {
    const task=f.render().openVerifiedConversation(context,controller.signal,()=>current);current=false;
    f.reply('PREPARE_FACEBOOK_CONVERSATION',{...context,prepared:true,opened:false,exactRequested:true,verified:true,openToken:'00000000-0000-4000-8000-000000000001'});
    assert.equal(await task,null);assert.equal(f.messages.some(m=>m.type==='COMMIT_FACEBOOK_CONVERSATION'),false);
    assert.equal(f.messages.at(-1).type,'CANCEL_FACEBOOK_CONVERSATION');
  } finally {f.h.cleanup();}
});
test('aborting an in-flight preparation settles the wait and sends worker cancellation', async () => {
  const f=companionFixture(),controller=new AbortController();try {
    const task=f.render().openVerifiedConversation(context,controller.signal,()=>true);controller.abort();
    assert.equal(await task,null);assert.equal(f.messages.some(m=>m.type==='COMMIT_FACEBOOK_CONVERSATION'),false);
    assert.equal(f.messages.at(-1).type,'CANCEL_FACEBOOK_CONVERSATION');
  } finally {f.h.cleanup();}
});
test('valid prepare and exact verified commit use the same navigation request and full context', async () => {
  const f=companionFixture(),controller=new AbortController();try {
    const task=f.render().openVerifiedConversation(context,controller.signal,()=>true);
    f.reply('PREPARE_FACEBOOK_CONVERSATION',{...context,prepared:true,opened:false,exactRequested:true,verified:true,openToken:'00000000-0000-4000-8000-000000000001'});
    await tick();f.reply('COMMIT_FACEBOOK_CONVERSATION',{...context,opened:true,exactRequested:true,verified:true});
    assert.equal(verifiedConversationOpened(await task,context),true);
    const prepare=f.messages.find(m=>m.type==='PREPARE_FACEBOOK_CONVERSATION'),commit=f.messages.find(m=>m.type==='COMMIT_FACEBOOK_CONVERSATION');
    assert.equal(commit.navigationRequestId,prepare.navigationRequestId);
    for(const key of Object.keys(context))assert.equal(commit[key],context[key]);
  } finally {f.h.cleanup();}
});

const inbox='https://business.facebook.com/latest/inbox/all?asset_id=12345';
const fallback={success:true,businessId:context.businessId,conversationId:context.conversationId,pageId:context.pageId,recipientId:context.threadId,
  navigationAvailable:false,pageInboxUrl:inbox,reason:'facebook_direct_link_required',providerLinkState:'retained',providerRouteKind:'legacy_page_inbox',directLinkRejectReason:'legacy_page_inbox_route'};
function actionFixture(body=fallback, enabled=true, open=async()=>({...context,opened:true,exactRequested:true,verified:true})) {
  const h=hooks(),popups=[],calls=[];h.React.createContext=()=>({Provider:'provider'});
  const companion={verifiedConversationNavigation:enabled,openVerifiedConversation:(...args)=>{calls.push(args);return open(...args);}};
  const window={open:()=>{const popup={closed:false,location:{href:'about:blank',replace(value){this.href=value;}},document:{createElement:()=>({style:{}}),body:{appendChild(){}}},close(){this.closed=true;}};popups.push(popup);return popup;}};
  const Provider=loader({react:h.React,'react/jsx-runtime':h.jsx,'lucide-react':{ExternalLink:'icon'},'@/lib/extension/use-companion':{useCompanion:()=>companion}},
    {window,AbortController,URLSearchParams,fetch:async()=>new Response(JSON.stringify(body))})('components/inbox/companion-facebook-action.tsx').FacebookConversationActionProvider;
  const render=(props=context)=>h.render(Provider,{...props,navigationOnly:true}).props.value;
  render();return {h,render,popups,calls};
}
test('explicit fallback is offered only for authorized legacy diagnostics and a capable extension', async () => {
  for(const [body,enabled,expected] of [[fallback,true,true],[fallback,false,false],
    [{...fallback,providerLinkState:'missing'},true,false],[{...fallback,providerRouteKind:'messages'},true,false],
    [{...fallback,reason:'page_reconnection_required'},true,false],[{...fallback,conversationId:'other'},true,false]]) {
    const f=actionFixture(body,enabled);try{await f.render().open();assert.equal(f.render().canVerifyWithExtension,expected);assert.equal(f.calls.length,0);}finally{f.h.cleanup();}
  }
});
test('fallback clears only on exact verified success and preserves diagnostics on failure', async () => {
  for(const result of [{...context,opened:true,exactRequested:true,verified:true},{...context,opened:true,verified:false},
    {...context,opened:true,exactRequested:true,verified:true,businessId:'other'},null]){
    const f=actionFixture(fallback,true,async()=>result);try {
      await f.render().open();await f.render().verifyWithExtension();const action=f.render();
      assert.equal(action.notice==='',verifiedConversationOpened(result,context));
      assert.equal(action.navigationDetails.providerRouteKind,'legacy_page_inbox');assert.equal(f.popups.length,1);assert.equal(f.popups[0].closed,true);
    }finally{f.h.cleanup();}
  }
});
test('switching TENH customers aborts fallback and ignores a late exact success', async () => {
  let resolve;const f=actionFixture(fallback,true,()=>new Promise(r=>resolve=r));try{
    await f.render().open();const task=f.render().verifyWithExtension();
    const changed={...context,conversationId:'c2',threadId:'77777'};f.render(changed);
    assert.equal(f.calls[0][1].aborted,true);assert.equal(f.calls[0][2](),false);
    resolve({...context,opened:true,exactRequested:true,verified:true});await task;
    const action=f.render(changed);assert.equal(action.notice,'');assert.equal(action.fallbackUrl,'');assert.equal(action.canVerifyWithExtension,false);
  }finally{f.h.cleanup();}
});
