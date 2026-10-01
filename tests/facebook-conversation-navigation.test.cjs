const test=require('node:test'),assert=require('node:assert/strict');
const {loader,database}=require('./tenh-seven/harness.cjs');
const page='12345',psid='98765';
const link=`https://business.facebook.com/latest/inbox/all?asset_id=${page}&selected_item_id=54321&thread_type=FB_MESSAGE`;
function setup({authorized=true,source='messenger',participant=psid,payloadLink=link}={}) {
 const db=database({conversations:[{id:'c1',business_id:'b1',source_type:source,contact_id:'ct1',social_account_id:'s1'}],
 social_accounts:[{id:'s1',business_id:'b1',platform:'facebook',platform_account_id:page,is_active:true,facebook_page_access_token_encrypted:'encrypted',updated_at:'v1'}],
 contacts:[{id:'ct1',business_id:'b1',platform:'facebook',platform_user_id:psid}]});
 let calls=0;
 const load=loader({'@/lib/supabase/admin':{supabaseAdmin:db},'@/lib/inbox/get-inbox-resource-access':{getInboxConversationAccess:async()=>authorized?{success:true,businessId:'b1',member:{},conversation:{contact_id:'ct1',social_account_id:'s1'}}:{success:false,status:403,error:'Forbidden'}},
 '@/lib/auth/require-permission':{},'@/lib/facebook/facebook-token-crypto':{decryptFacebookToken:()=> 'synthetic-token'},'@/lib/facebook/get-facebook-page-access-token':{}},
 {AbortSignal,fetch:async(url,options)=>{calls++;assert.equal(new URL(url).searchParams.get('user_id'),psid);assert.equal(new URL(url).searchParams.has('access_token'),false);assert.equal(options.headers.Authorization,'Bearer synthetic-token');return new Response(JSON.stringify({data:[{id:'t_2468',link:payloadLink,participants:{data:[{id:page},{id:participant}]}}]}));}});
 const get=load('app/api/conversations/[conversationId]/facebook-conversation/route.ts').GET;
 return {db,calls:()=>calls,get:(patch={})=>get({method:'GET',url:'http://local/api?'+new URLSearchParams({businessId:'b1',pageId:page,recipientId:psid,lookup:'navigation',...patch})},{params:Promise.resolve({conversationId:'c1'})})};
}
test('authorized navigation matches participants and does not require manual-link tables or write',async()=>{const a=setup();const r=await a.get(),body=await r.json();assert.equal(r.status,200);assert.equal(body.conversationLink,link);assert.equal(body.linkSource,'meta_conversations_api');assert.equal(body.navigationAvailable,true);assert.equal(a.calls(),1);assert.ok(a.db.history.every(q=>q.op==='read'&&q.table!=='facebook_inbox_links'));assert.equal(JSON.stringify(body).includes('synthetic-token'),false);});
test('overlapping and repeated navigation requests share one provider lookup even with refresh requested',async()=>{const a=setup();await Promise.all([a.get(),a.get()]);await a.get({refresh:'1'});assert.equal(a.calls(),1);});
for(const options of [{payloadLink:null},{payloadLink:'https://evil.test/'},{payloadLink:`https://www.facebook.com/${page}/inbox/2468/?section=messages`},{participant:'99999'}])test('unavailable or unsupported exact destination offers only Page inbox '+JSON.stringify(options),async()=>{const a=setup(options);const body=await(await a.get()).json();assert.equal(body.navigationAvailable,false);assert.equal(body.conversationLink,null);assert.equal(body.pageInboxUrl,`https://business.facebook.com/latest/inbox/all?asset_id=${page}`);await a.get();assert.equal(a.calls(),1);});
test('denied workspace performs no provider or additional database reads',async()=>{const a=setup({authorized:false});assert.equal((await a.get()).status,403);assert.equal(a.calls(),0);assert.equal(a.db.history.length,0);});
for(const patch of [{businessId:'b2'},{pageId:'other'},{recipientId:'other'}])test('changed navigation context rejected before provider request '+JSON.stringify(patch),async()=>{const a=setup();assert.equal((await a.get(patch)).status,409);assert.equal(a.calls(),0);});
test('comments cannot enter Messenger navigation',async()=>{const a=setup({source:'comment'});assert.equal((await a.get()).status,400);assert.equal(a.calls(),0);});
test('provider URL removes tokens and redirect parameters before browser delivery',async()=>{const a=setup({payloadLink:link+'&access_token=do-not-expose&redirect=https%3A%2F%2Fevil.test'});const body=await(await a.get()).json();assert.equal(body.conversationLink,link);assert.equal(JSON.stringify(body).includes('do-not-expose'),false);});
test('provider link to another Page cannot select a conversation',async()=>{const a=setup({payloadLink:link.replace('asset_id=12345','asset_id=99999')});const body=await(await a.get()).json();assert.equal(body.navigationAvailable,false);assert.equal(body.conversationLink,null);});
