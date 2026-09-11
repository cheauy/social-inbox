/* Controlled Chrome/API tests; these do not use a real Facebook login. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');
const source = fs.readFileSync('tenh-extension/src/background.js','utf8');
const functions = source.slice(source.indexOf('function isSafeFacebookProfileUrl('),source.indexOf('async function warmFacebookCompanion('));
const options={pageId:'123456',threadId:'987654',conversationId:'conversation-A',businessId:'workspace-A',customerName:'Test Customer'};
const sender={frameId:0,documentId:'doc-A',url:'https://app.tenhchat.com/dashboard/inbox',tab:{id:10,windowId:1,url:'https://app.tenhchat.com/dashboard/inbox'}};
const profile='https://www.facebook.com/profile.php?id=61555135812581';
const exact='https://business.facebook.com/latest/inbox/all?asset_id=123456&selected_item_id=987654&thread_type=FB_MESSAGE';
function harness(config={}){
  const tabMap=new Map((config.tabs??[{id:77,windowId:1,active:true,status:'complete',url:exact}]).map(t=>[t.id,t]));
  const created=[],removed=[],executed=[],updates=[];
  const session=config.session||{};
  const result={profileUrl:config.profile||profile,pageId:options.pageId,matchedThreadId:options.threadId,selectedItemId:options.threadId,...config.result};
  let n=100, validationCalls=0;
  const context=vm.createContext({URL,URLSearchParams,Map,Set,Promise,Date,crypto:{randomUUID},setTimeout,clearTimeout,
    TENH_ORIGIN:'https://app.tenhchat.com',VERSION:'1.2.19',
    readState:async()=>({token:config.unauthorized?null:'test-token'}),
    callTenh:async()=>({ok:true,status:200,result:{matched:!config.unmatched,workspace:{businessId:config.businessId||options.businessId},page:{id:options.pageId},conversation:{id:config.conversationId||options.conversationId},customer:{name:'Test Customer'}}}),
    facebookTarget:({pageId,threadId})=>`https://business.facebook.com/latest/inbox/all?asset_id=${pageId}&selected_item_id=${threadId}`,
    tabById:async id=>tabMap.get(id)||null,
    chrome:{
      storage:{session:{get:async key=>({[key]:structuredClone(session[key])}),set:async value=>{Object.assign(session,structuredClone(value))}}},
      tabs:{
        query:async()=>[...tabMap.values()].filter(t=>t.url.includes('business.facebook.com')),
        get:async id=>tabMap.get(id),
        create:async value=>{const t={...value,id:++n,windowId:1,status:'complete'};if(config.loginRedirect)t.url='https://www.facebook.com/login/';created.push(t);tabMap.set(t.id,t);return t},
        remove:async id=>{removed.push(id);tabMap.delete(id)},
        update:async(id,patch)=>{updates.push({id,patch});throw Error('Must not navigate existing tabs')},
      },
      scripting:{executeScript:async request=>{
        executed.push(request);if(request.files)return [];
        if(request.func.toString().includes('validateCurrentProfilePage')){
          validationCalls++;
          if(config.validationFailure)return [{result:{valid:false,reason:'facebook_content_unavailable'}}];
          return [{result:{valid:true,nameMatches:true,url:config.canonical||profile}}];
        }
        if(config.missingLink)return [{result:{reason:'profile_link_unavailable'}}];
        return [{result}];
      }},
    },
  });
  vm.runInContext(functions,context);
  return {context,created,removed,executed,updates,session,tabMap,validationCalls:()=>validationCalls};
}
async function lookup(h,expected=options,from=sender){return h.context.openFacebookCustomerProfile(expected,from)}
async function open(h,result,expected=options,from=sender){return h.context.openResolvedFacebookProfile(result.openToken,from,expected)}
test('one click resolves + confirms: only final profile activates; existing Facebook tab untouched',async()=>{
  const h=harness();const result=await lookup(h);
  assert.equal(result.resolved,true);assert.equal(result.verified,true);assert.equal(result.profileId,'61555135812581');
  assert.equal(result.threadId,options.threadId);assert.equal(h.created.length,1);assert.equal(h.created[0].active,false);
  assert.ok(h.validationCalls()>=2);assert.deepEqual(h.removed,[h.created[0].id]);assert.equal(h.updates.length,0);
  assert.equal((await open(h,result)).opened,true);assert.equal(h.created.at(-1).url,profile);assert.equal(h.created.at(-1).active,true);
  assert.equal((await open(h,result)).opened,false);assert.equal(h.created.length,2);assert.ok(h.tabMap.has(77));
});
test('no Facebook tabs: no Business Suite tab or guessed profile is opened',async()=>{
  const h=harness({tabs:[]});const result=await lookup(h);
  assert.equal(result.reason,'profile_link_not_available');
  assert.equal(result.resolved,undefined);assert.equal(h.created.length,0);assert.equal(h.updates.length,0);
});

test('another Page or same-name different thread is not read/navigated as the requested customer',async()=>{
  const h=harness({tabs:[{id:88,active:true,status:'complete',url:exact.replace('123456','555555')},{id:89,active:true,status:'complete',url:exact.replace('987654','555555')}]});
  assert.equal((await lookup(h)).reason,'profile_link_not_available');
  assert.equal(h.created.length,0);
  assert.ok(h.executed.every(r=>![88,89].includes(r.target.tabId)));assert.equal(h.updates.length,0);
  assert.ok(h.tabMap.has(88)&&h.tabMap.has(89));
});
test('blocked/unavailable Facebook profile is never opened in the foreground',async()=>{
  const h=harness({validationFailure:true});const r=await lookup(h);
  assert.equal(r.reason,'facebook_content_unavailable');assert.equal(r.openToken,undefined);
  assert.ok(h.created.every(t=>!t.active));assert.equal(h.removed.length,1);
});
test('missing link gives a reason, never a Business Suite foreground fallback',async()=>{
  const h=harness({missingLink:true,tabs:[]});const r=await lookup(h);
  assert.equal(r.reason,'profile_link_not_available');assert.equal(r.openToken,undefined);
  assert.equal(h.created.length,0);assert.equal(h.removed.length,0);
});
test('authorization and current TENH workspace/conversation are checked before any browser lookup',async()=>{
  for(const config of [{unauthorized:true},{unmatched:true},{businessId:'other-workspace'},{conversationId:'other-conversation'}]){
    const h=harness(config);assert.equal((await lookup(h)).opened,false);assert.equal(h.created.length,0);assert.equal(h.executed.length,0);
  }
});
test('unsafe, malformed, scoped Messenger links never receive an opening ticket',async()=>{
  for(const url of ['https://business.facebook.com/latest/inbox/all','https://www.facebook.com/login','https://www.facebook.com/l.php?u=x',`https://www.facebook.com/profile.php?id=${options.threadId}`,`https://www.facebook.com/${options.threadId}`,'https://www.facebook.com.evil.example/name','javascript:alert(1)','https://a:b@www.facebook.com/name','https://www.facebook.com/profile.php?id=123456&id=222222']){
    const h=harness({profile:url});const r=await lookup(h);assert.equal(r.openToken,undefined,url);assert.ok(h.created.every(t=>!t.active),url);
  }
});
test('different tab, document, frame or origin cannot consume profile ticket',async()=>{
  const h=harness();const r=await lookup(h);
  for(const from of [{...sender,tab:{...sender.tab,id:11}},{...sender,documentId:'doc-B'},{...sender,frameId:1},{...sender,url:'https://app.tenhchat.com.evil.test/',tab:{...sender.tab,url:'https://app.tenhchat.com.evil.test/'}}]){
    assert.equal((await open(h,r,options,from)).opened,false);
  }
  assert.equal((await open(h,r,{...options,threadId:'555555'})).opened,false);
  assert.equal((await open(h,r)).opened,true);
});
test('ticket survives service-worker restart; not stored in persistent local/sync storage',async()=>{
  const h=harness();const r=await lookup(h);
  const resumed=harness({session:h.session});assert.equal((await open(resumed,r)).opened,true);
  assert.equal(resumed.created.length,1);
});
test('concurrent confirmation consumes ticket once',async()=>{
  const h=harness();const r=await lookup(h);const replies=await Promise.all([open(h,r),open(h,r)]);
  assert.equal(replies.filter(r=>r.opened).length,1);assert.equal(h.created.filter(t=>t.active).length,1);
});
test('expired ticket does not open a tab',async()=>{
  const h=harness();const r=await lookup(h);h.session.tenhProfileOpenTicketsV2[r.openToken].expiresAt=0;
  assert.equal((await open(h,r)).reason,'profile_resolution_expired');assert.equal(h.created.filter(t=>t.active).length,0);
});
test('username remains username when Facebook does not expose a numeric public ID',async()=>{
  const url='https://www.facebook.com/customer.example';const h=harness({profile:url,canonical:url});
  const r=await lookup(h);assert.equal(r.profileUrl,url);assert.equal(r.profileId,null);
});

test('signed-out profile validation reports sign-in required and cleans its inactive profile tab',async()=>{
  const h=harness({loginRedirect:true});const r=await lookup(h);
  assert.equal(r.reason,'facebook_sign_in_required');assert.equal(h.created.length,1);
  assert.equal(h.created[0].active,false);assert.equal(h.removed.length,1);
});
