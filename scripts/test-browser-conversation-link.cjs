const test=require('node:test'),assert=require('node:assert/strict');
const {loader,database,baseSeed}=require('../tests/tenh-seven/harness.cjs');
const ROUTE='app/api/conversations/[conversationId]/facebook-conversation/route.ts';
const page='203981939455120',psid='38366250273019952';
const link=`https://business.facebook.com/latest/inbox/all?asset_id=${page}&selected_item_id=100029016673099&mailbox_id=${page}&thread_type=FB_MESSAGE`;
const payload=(url=link)=>({data:[{id:'t_meta_thread',link:url,participants:{data:[{id:page,name:'Page'},{id:psid,name:'Ken Rover'}]}}]});
function setup(options={}){
 const seed=baseSeed();seed.conversations[0].source_type='messenger';
 Object.assign(seed.social_accounts[0],{platform_account_id:page,facebook_token_status:'connected',facebook_page_access_token_encrypted:'encrypted-test-token',updated_at:'v1'});
 seed.contacts[0].platform_user_id=psid;seed.facebook_inbox_links=[];
 const db=database(seed),calls=[];let denied=null,authCalls=0,clock=Date.now();
 class Clock extends Date{static now(){return clock;}}
 const load=loader({
  'next/server':{NextResponse:{json:(body,init={})=>new Response(JSON.stringify(body),{...init,headers:{'Content-Type':'application/json',...init.headers}})}},
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>!options.permissionDenied},
  '@/lib/inbox/get-inbox-resource-access':{getInboxConversationAccess:async id=>{authCalls++;return denied||{success:true,businessId:'b1',member:{id:'m1',business_id:'b1'},conversation:{...db.tables.conversations.find(x=>x.id===id)}};}},
  '@/lib/facebook/facebook-token-crypto':{decryptFacebookToken:value=>{if(value!=='encrypted-test-token')throw new Error('Bad token');return 'PRIVATE_PAGE_TOKEN';}},
  '@/lib/facebook/get-facebook-page-access-token':{getFacebookPageAccessToken:async()=>{throw new Error('Global Page-token lookup must not be used');}},
 },{Date:Clock,fetch:async(url,init)=>{calls.push({url,init});return options.fetch?options.fetch(url,init):new Response(JSON.stringify(options.payload||payload()));}});
 const route=load(ROUTE);
 const get=(patch={},id='conv1')=>{
  const q=new URLSearchParams({businessId:'b1',pageId:page,recipientId:psid,...patch});
  return route.GET(new Request('https://app.tenhchat.com/api/conversations/'+id+'/facebook-conversation?'+q),{params:Promise.resolve({conversationId:id})});
 };
 const patch=(body,params={},origin='https://app.tenhchat.com')=>route.PATCH(new Request('https://app.tenhchat.com/api/conversations/conv1/facebook-conversation?'+new URLSearchParams({businessId:'b1',pageId:page,recipientId:psid,...params}),{method:'PATCH',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)}),{params:Promise.resolve({conversationId:'conv1'})});
 return {db,calls,get,patch,load,deny:(status=403)=>{denied={success:false,status,error:'Access denied'};},authCalls:()=>authCalls,advance:ms=>{clock+=ms;}};
}
test('signed-in API returns the exact Meta link with the scoped Page token kept server-side',async()=>{
 const h=setup(),res=await h.get(),r=await res.json();assert.equal(res.status,200);assert.equal(r.conversationLink,link);assert.equal(r.recipientId,psid);assert.equal(r.linkSource,'meta_conversations_api');
 assert.equal(res.headers.get('Cache-Control'),'private, no-store');assert.equal(res.headers.get('Vary'),'Cookie');assert.ok(!JSON.stringify(r).includes('PRIVATE_PAGE_TOKEN'));
 const url=new URL(h.calls[0].url);assert.equal(url.pathname,`/v26.0/${page}/conversations`);assert.equal(url.searchParams.get('user_id'),psid);assert.equal(url.searchParams.get('platform'),'MESSENGER');
 assert.equal(h.calls[0].init.headers.Authorization,'Bearer PRIVATE_PAGE_TOKEN');assert.equal(url.searchParams.has('access_token'),false);
});
test('membership is checked on every cache hit; revoked users never receive the cached link',async()=>{
 const h=setup();assert.equal((await h.get()).status,200);assert.equal((await (await h.get()).json()).cacheUsed,true);
 h.deny();const r=await h.get();assert.equal(r.status,403);assert.equal((await r.json()).conversationLink,undefined);assert.equal(h.calls.length,1);assert.equal(h.authCalls(),3);
});
test('disconnected Page cannot reuse a cached conversation',async()=>{
 const h=setup();await h.get();h.db.tables.social_accounts[0].is_active=false;
 assert.equal((await h.get()).status,424);assert.equal(h.calls.length,1);
});
for(const patch of [{businessId:'other'},{pageId:'999999'},{recipientId:'999999'}])test('reject mismatched caller context before Meta lookup '+JSON.stringify(patch),async()=>{
 const h=setup();assert.equal((await h.get(patch)).status,409);assert.equal(h.calls.length,0);
});
for(const status of [401,403,409])test('unauthenticated, removed or expired access is respected '+status,async()=>{
 const h=setup();h.deny(status);assert.equal((await h.get()).status,status);assert.equal(h.calls.length,0);
});
test('non-Messenger, foreign-workspace and missing Page/contact rows cannot request a link',async()=>{
 for(const change of [h=>{h.db.tables.conversations[0].source_type='comment';},h=>{h.db.tables.social_accounts[0].business_id='other';},h=>{h.db.tables.contacts[0].business_id='other';},h=>{h.db.tables.contacts=[];}]){
  const h=setup();change(h);assert.equal((await h.get()).status,400);assert.equal(h.calls.length,0);
 }
});
test('token revocation, missing ciphertext and decrypt failures cannot use environment credentials',async()=>{
 for(const change of [p=>{p.facebook_token_status='revoked';},p=>{p.facebook_page_access_token_encrypted=null;},p=>{p.facebook_page_access_token_encrypted='corrupt';}]){
  const h=setup();change(h.db.tables.social_accounts[0]);assert.equal((await h.get()).status,424);assert.equal(h.calls.length,0);
 }
});
test('cached links expire after five minutes and reconnection changes invalidate the cache',async()=>{
 const h=setup();await h.get();assert.equal((await (await h.get()).json()).cacheUsed,true);assert.equal(h.calls.length,1);
 h.advance(300001);assert.equal((await (await h.get()).json()).cacheUsed,false);assert.equal(h.calls.length,2);
 h.db.tables.social_accounts[0].updated_at='v2';await h.get();assert.equal(h.calls.length,3);
});
test('explicit refresh resolves Meta again instead of reusing the old link',async()=>{
 const h=setup();await h.get();assert.equal((await (await h.get({refresh:'1'})).json()).cacheUsed,false);assert.equal(h.calls.length,2);
});
test('concurrent requests coalesce only the same authorized conversation',async()=>{
 let finish;const h=setup({fetch:()=>new Promise(resolve=>{finish=resolve;})});const first=h.get(),second=h.get();
 for(let i=0;i<20&&!finish;i++)await Promise.resolve();assert.ok(finish);assert.equal(h.calls.length,1);
 finish(new Response(JSON.stringify(payload())));const results=await Promise.all([first,second]);assert.ok(results.every(r=>r.status===200));
 h.db.tables.conversations.push({...h.db.tables.conversations[0],id:'conv2'});
 const third=h.get({},'conv2');for(let i=0;i<20&&h.calls.length<2;i++)await Promise.resolve();assert.equal(h.calls.length,2);
 finish(new Response(JSON.stringify(payload())));assert.equal((await third).status,200);
});
test('a link failure is not cached; the next click can recover',async()=>{
 let count=0;const h=setup({fetch:async()=>new Response(JSON.stringify(++count===1?{data:[]}:payload()))});
 const first=await h.get();assert.equal(first.status,424);assert.match((await first.json()).error,/did not return a Messenger conversation/);
 assert.equal((await h.get()).status,200);assert.equal(h.calls.length,2);
});
test('participant mismatch and unsafe provider links never fall back to a guessed inbox URL',async()=>{
 for(const p of [payload('https://evil.test/'),{data:[{...payload().data[0],participants:{data:[{id:page},{id:'another'}]}}]}]){
  const h=setup({payload:p});const r=await h.get();assert.equal(r.status,424);assert.equal((await r.json()).conversationLink,undefined);
 }
});
test('missing customer display name does not block browser navigation with exact participant IDs',async()=>{
 const p=payload();delete p.data[0].participants.data[1].name;const h=setup({payload:p});assert.equal((await h.get()).status,200);
});
test('non-JSON Meta and database failures stay inside a safe JSON error response',async()=>{
 const h=setup({fetch:async()=>new Response('<!DOCTYPE html>upstream failure',{status:502})});const r=await h.get();assert.equal(r.status,424);assert.equal((await r.json()).success,false);
 const d=setup();d.db.failures.push({table:'contacts'});assert.equal((await d.get()).status,503);assert.equal(d.calls.length,0);
});

const haePsid='38223061640675514',haeSelected='61584041913037';
const haeUrl=`https://business.facebook.com/latest/inbox/all?asset_id=${page}&business_id=1594812998092301&ir_qe_exposed=1&nav_ref=manage_page_ap_plus_default&selected_item_id=${haeSelected}&mailbox_id=${page}&thread_type=FB_MESSAGE`;
const normalizedHae=haeUrl.replace('&ir_qe_exposed=1','');
const savedRow=(patch={})=>({business_id:'b1',social_account_id:'s1',contact_id:'c1',page_id:page,recipient_id:psid,
 selected_item_id:'100029016673099',conversation_link:link,confirmed_by_member_id:'m1',confirmed_at:'2026-09-13T08:00:00.000Z',...patch});
const saveBody=(patch={})=>({conversationLink:link,confirmed:true,expectedConfirmedAt:null,...patch});
test('the supplied Hae Rith URL retains the Suite ID and supported routing parameters',()=>{
 const {normalizeBusinessSuiteConversationLink:normalize}=setup().load('lib/facebook/conversation-link.ts');
 assert.equal(normalize(haeUrl,page,haePsid),normalizedHae);
 for(const invalid of [haeUrl.replace(page,'999999'),haeUrl.replace(haeSelected,haePsid),haeUrl.replace(haeSelected,page),
  haeUrl+'&selected_item_id='+haeSelected,haeUrl+'&thread_type=FB_MESSAGE',haeUrl+'&thread_id='+haeSelected,
  haeUrl+'&business_id=111',haeUrl.replace('FB_MESSAGE','IG_MESSAGE'),haeUrl.replace('business.facebook.com','evil.test'),
  `https://www.facebook.com/${page}/inbox/1372921689227800/?section=messages`]) assert.equal(normalize(invalid,page,haePsid),null,invalid);
});
test('legacy Meta links stop with a setup action instead of opening the first customer again',async()=>{
 const h=setup({payload:payload(`https://www.facebook.com/${page}/inbox/1372921689227800/?section=messages`)});
 const res=await h.get(),body=await res.json();assert.equal(res.status,424);assert.equal(body.reason,'facebook_direct_link_required');
 assert.equal(body.canSaveLink,undefined);assert.equal(body.conversationLink,undefined);
});
test('a saved Hae Rith link survives new server instances and never supplies Ken Rover or another Page',async()=>{
 for(let restart=0;restart<2;restart++){
  const h=setup({payload:{data:[]}});
  h.db.tables.contacts[0].platform_user_id=haePsid;
  h.db.tables.facebook_inbox_links.push(savedRow({recipient_id:haePsid,selected_item_id:haeSelected,conversation_link:normalizedHae}));
  const res=await h.get({recipientId:haePsid}),body=await res.json();assert.equal(res.status,200);
  assert.equal(body.conversationLink,normalizedHae);assert.equal(body.linkSource,'agent_saved_business_suite');assert.equal(body.cacheUsed,true);assert.equal(h.calls.length,0);
  h.db.tables.contacts.push({...h.db.tables.contacts[0],id:'ken',platform_user_id:psid});
  h.db.tables.conversations.push({...h.db.tables.conversations[0],id:'ken-thread',contact_id:'ken'});
  assert.equal((await h.get({},'ken-thread')).status,424);
  h.db.tables.social_accounts.push({...h.db.tables.social_accounts[0],id:'another-page',platform_account_id:'393342417206745'});
  h.db.tables.conversations.push({...h.db.tables.conversations[0],id:'other-page-thread',social_account_id:'another-page'});
  assert.equal((await h.get({recipientId:haePsid,pageId:'393342417206745'},'other-page-thread')).status,424);
 }
});
test('a saved link still requires current membership and an active Page',async()=>{
 const h=setup();h.db.tables.facebook_inbox_links.push(savedRow());assert.equal((await h.get()).status,200);h.deny();assert.equal((await h.get()).status,403);
 const p=setup();p.db.tables.facebook_inbox_links.push(savedRow());p.db.tables.social_accounts[0].facebook_token_status='revoked';assert.equal((await p.get()).status,424);
 assert.equal(h.calls.length+p.calls.length,0);
});
test('invalid saved context is never returned as a customer link',async()=>{
 for(const patch of [{business_id:'other'},{social_account_id:'other'},{contact_id:'other'},{page_id:'99999'},{recipient_id:'99999'},
  {selected_item_id:'99999'},{conversation_link:'https://evil.test/'}]){
  const h=setup({payload:{data:[]}});h.db.tables.facebook_inbox_links.push(savedRow(patch));
  const res=await h.get();assert.equal(res.status,424);assert.equal((await res.json()).conversationLink,undefined);
 }
});
test('link settings use current permission and saved data without calling Meta',async()=>{
 for(const permissionDenied of [true,false]){
  const h=setup({permissionDenied});h.db.tables.facebook_inbox_links.push(savedRow());
  const body=await (await h.get({settings:'1'})).json();assert.equal(body.canSaveLink,!permissionDenied);assert.equal(body.conversationLink,link);
  assert.equal(body.confirmedAt,savedRow().confirmed_at);assert.equal(h.calls.length,0);
 }
});
test('save requires explicit customer confirmation, edit permission and the current workspace',async()=>{
 for(const body of [saveBody({confirmed:false}),saveBody({confirmed:undefined}),saveBody({conversationLink:'https://evil.test/'}),
  saveBody({conversationLink:link.replace(page,'999999')}),saveBody({expectedConfirmedAt:undefined})]){
  const h=setup();assert.ok([400,409].includes((await h.patch(body)).status));assert.equal(h.db.tables.facebook_inbox_links.length,0);
 }
 const readOnly=setup({permissionDenied:true});assert.equal((await readOnly.patch(saveBody())).status,403);
 const crossOrigin=setup();assert.equal((await crossOrigin.patch(saveBody(),{},'https://evil.test')).status,403);
 const crossContext=setup();assert.equal((await crossContext.patch(saveBody(),{businessId:'other'})).status,409);
});
test('saving uses server-resolved identity and repeated opening uses storage without Meta',async()=>{
 const h=setup();const res=await h.patch(saveBody({business_id:'other',contact_id:'other',recipient_id:'9999'}));assert.equal(res.status,200);
 const row=h.db.tables.facebook_inbox_links[0];assert.equal(row.business_id,'b1');assert.equal(row.contact_id,'c1');assert.equal(row.recipient_id,psid);assert.equal(row.confirmed_by_member_id,'m1');
 for(let click=0;click<3;click++){const body=await (await h.get()).json();assert.equal(body.conversationLink,link);assert.equal(body.linkSource,'agent_saved_business_suite');}
 assert.equal(h.calls.length,0);
});
test('an old editor cannot overwrite a newer saved link and database uniqueness conflicts are reported',async()=>{
 const h=setup();h.db.tables.facebook_inbox_links.push(savedRow());
 assert.equal((await h.patch(saveBody())).status,409);assert.equal(h.db.tables.facebook_inbox_links[0].conversation_link,link);
 h.db.failures.push({table:'facebook_inbox_links',op:'update',code:'23505'});
 const res=await h.patch(saveBody({expectedConfirmedAt:savedRow().confirmed_at}));assert.equal(res.status,409);
 assert.match((await res.json()).error,/assigned to another customer/);
});
test('editing and deleting affect only this customer, with version checks on both operations',async()=>{
 const h=setup();h.db.tables.facebook_inbox_links.push(savedRow(),savedRow({contact_id:'c2',recipient_id:'22222',selected_item_id:'33333',conversation_link:link.replace('100029016673099','33333')}));
 const replacement=link.replace('100029016673099','44444');
 let res=await h.patch(saveBody({conversationLink:replacement,expectedConfirmedAt:savedRow().confirmed_at}));assert.equal(res.status,200);
 const version=(await res.json()).confirmedAt;assert.equal(h.db.tables.facebook_inbox_links[0].selected_item_id,'44444');
 assert.equal((await h.patch({conversationLink:null,expectedConfirmedAt:savedRow().confirmed_at})).status,409);
 res=await h.patch({conversationLink:null,expectedConfirmedAt:version});assert.equal(res.status,200);assert.equal((await res.json()).conversationLink,null);
 assert.equal(h.db.tables.facebook_inbox_links.length,1);assert.equal(h.db.tables.facebook_inbox_links[0].recipient_id,'22222');
 assert.equal(h.calls.length,0);
});
test('missing database migration gives a readable error instead of using a legacy fallback',async()=>{
 const h=setup();delete h.db.tables.facebook_inbox_links;const res=await h.get();assert.equal(res.status,503);
 assert.match((await res.json()).error,/database update/);assert.equal(h.calls.length,0);
});

test('thread lookup returns Graph id even without link, display name or a manual-link table',async()=>{
 const p=payload();delete p.data[0].link;delete p.data[0].participants.data[1].name;
 p.data[0].id='t_971148639112183';const h=setup({payload:p});delete h.db.tables.facebook_inbox_links;
 const response=await h.get({lookup:'thread'}),body=await response.json();assert.equal(response.status,200);
 assert.equal(body.success,true);assert.equal(body.threadLookupSucceeded,true);assert.equal(body.thread_id,'t_971148639112183');
 assert.equal(body.threadIdSource,'meta_conversations_api');assert.equal(body.navigationAvailable,false);assert.equal(body.conversationLink,null);
 assert.equal(body.metaConversationLink,null);assert.equal(h.db.history.some(q=>q.table==='facebook_inbox_links'),false);
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.ok(!JSON.stringify(body).includes('PRIVATE_PAGE_TOKEN'));
});
test('legacy URL and Graph thread ID stay distinct from Business Suite selected_item_id',async()=>{
 const f=require('./fixtures/facebook-conversation-page-inbox.json');
 const p=structuredClone(f.response);p.data[0].participants.data[0].id=psid;
 const h=setup({payload:p}),response=await h.get(),body=await response.json();
 assert.equal(response.status,424);assert.equal(body.success,false);assert.equal(body.threadLookupSucceeded,true);
 assert.equal(body.thread_id,f.response.data[0].id);assert.equal(body.metaConversationLink,'https://www.facebook.com'+f.response.data[0].link);
 assert.equal(body.navigationAvailable,false);assert.equal(body.conversationLink,undefined);assert.equal(body.reason,'facebook_direct_link_required');
 assert.ok(!JSON.stringify(body).includes(new URL(f.suiteUrl).searchParams.get('selected_item_id')));
 const lookup=await h.get({lookup:'thread'});assert.equal(lookup.status,200);assert.equal((await lookup.json()).thread_id,body.thread_id);assert.equal(h.calls.length,1);
});
test('thread lookup preserves long string IDs and rejects rounded numeric Graph IDs',async()=>{
 for(const id of ['t_123456789012345678901234','123456789012345678901234']){
  const p=payload();p.data[0].id=id;const body=await(await setup({payload:p}).get({lookup:'thread'})).json();assert.equal(body.thread_id,id);
 }
 const p=payload();p.data[0].id=Number('123456789012345678901234');const r=await setup({payload:p}).get({lookup:'thread'});
 assert.equal(r.status,424);assert.equal((await r.json()).thread_id,undefined);
});
test('thread-only mode never weakens Page, recipient, workspace or current access checks',async()=>{
 for(const patch of [{pageId:'999'},{recipientId:'999'},{businessId:'other'}]){
  const h=setup();assert.equal((await h.get({...patch,lookup:'thread'})).status,409);assert.equal(h.calls.length,0);
 }
 const h=setup();await h.get({lookup:'thread'});h.deny();const res=await h.get({lookup:'thread'});assert.equal(res.status,403);assert.equal((await res.json()).thread_id,undefined);assert.equal(h.calls.length,1);
 const disconnected=setup();await disconnected.get({lookup:'thread'});disconnected.db.tables.social_accounts[0].is_active=false;
 assert.equal((await disconnected.get({lookup:'thread'})).status,424);assert.equal(disconnected.calls.length,1);
});
test('finding a thread does not bypass ambiguous participants or multiple matching conversations',async()=>{
 for(const change of [p=>p.data[0].participants.data.push({id:'other'}),p=>{p.data[0].participants.paging={next:'more'};},
  p=>{p.data.push({...p.data[0],id:'t_second',link:undefined});},p=>{p.paging={next:'more'};}]){
  const p=payload();change(p);const h=setup({payload:p});const res=await h.get({lookup:'thread'}),body=await res.json();assert.equal(res.status,424);assert.equal(body.threadLookupSucceeded,false);assert.equal(body.thread_id,undefined);
 }
});
test('thread lookup bypasses manual destinations and never converts a saved Suite ID into a Graph ID',async()=>{
 const h=setup();h.db.tables.facebook_inbox_links.push(savedRow());
 const saved=await(await h.get()).json();assert.equal(saved.linkSource,'agent_saved_business_suite');assert.equal(h.calls.length,0);
 const lookup=await(await h.get({lookup:'thread'})).json();assert.equal(lookup.thread_id,'t_meta_thread');assert.notEqual(lookup.thread_id,savedRow().selected_item_id);assert.equal(h.calls.length,1);
});
test('successful thread lookups without a browser link share the TTL cache across lookup and navigation',async()=>{
 const p=payload();delete p.data[0].link;const h=setup({payload:p});
 let r=await(await h.get({lookup:'thread'})).json();assert.equal(r.cacheUsed,false);
 r=await(await h.get()).json();assert.equal(r.thread_id,'t_meta_thread');assert.equal(r.cacheUsed,true);assert.equal(h.calls.length,1);
 h.advance(300001);r=await(await h.get({lookup:'thread'})).json();assert.equal(r.cacheUsed,false);assert.equal(h.calls.length,2);
 await h.get({lookup:'thread',refresh:'1'});assert.equal(h.calls.length,3);
});
test('thread lookup isolates different customers even when display names match',async()=>{
 const h=setup({fetch:async url=>{
  const recipient=new URL(url).searchParams.get('user_id');const p=payload();p.data[0].id=recipient===psid?'t_first':'t_second';p.data[0].participants.data[1].id=recipient;return Response.json(p);
 }});
 h.db.tables.contacts.push({...h.db.tables.contacts[0],id:'c2',platform_user_id:'88888888888888888'});
 h.db.tables.conversations.push({...h.db.tables.conversations[0],id:'conv2',contact_id:'c2'});
 assert.equal((await(await h.get({lookup:'thread'})).json()).thread_id,'t_first');
 assert.equal((await(await h.get({lookup:'thread',recipientId:'88888888888888888'},'conv2')).json()).thread_id,'t_second');
 assert.equal((await(await h.get({lookup:'thread'})).json()).thread_id,'t_first');assert.equal(h.calls.length,2);
});
test('provider access failures are not presented as a request to save a manual link',async()=>{
 const h=setup({fetch:async()=>Response.json({error:{code:190,message:'PRIVATE_PROVIDER_ERROR'}},{status:400})});
 const response=await h.get({lookup:'thread'}),body=await response.json();assert.equal(response.status,424);assert.equal(body.reason,'profile_conversation_access_unavailable');
 assert.equal(body.threadLookupSucceeded,false);assert.equal(body.thread_id,undefined);assert.match(body.error,/denied conversation access/);assert.ok(!JSON.stringify(body).includes('PRIVATE_PROVIDER_ERROR'));
});
test('unsafe provider URLs cannot be exposed in thread lookup details',async()=>{
 for(const url of ['https://evil.test/?access_token=PRIVATE_VALUE',link+'&access_token=PRIVATE_VALUE']){
  const h=setup({payload:payload(url)}),body=await(await h.get({lookup:'thread'})).json();assert.equal(body.thread_id,'t_meta_thread');
  assert.ok(!JSON.stringify(body).includes('PRIVATE_VALUE'));assert.ok(!JSON.stringify(body).includes('evil.test'));
 }
});
test('lookup=thread on PATCH cannot bypass the saved-version check',async()=>{
 const h=setup();h.db.tables.facebook_inbox_links.push(savedRow());assert.equal((await h.patch(saveBody(),{lookup:'thread'})).status,409);
 assert.equal(h.db.tables.facebook_inbox_links[0].conversation_link,link);
});
