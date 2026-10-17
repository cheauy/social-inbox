/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
const {loader,database}=require('./tenh-seven/harness.cjs');
const quiet={log(){},warn(){},error(){}};
test('OAuth listing and selection require management before cookies or database side effects',async()=>{
 let reads=0;
 const app=loader({
  '@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,user:{id:'u'},member:{id:'m',business_id:'b'}})},
  '@/lib/auth/require-permission':{memberHasPermission:async(_,key,level)=>{assert.equal(key,'channels');assert.equal(level,'manage');return false;},permissionDenied:error=>Response.json({error},{status:403})},
  'next/headers':{cookies:async()=>{reads++;throw Error('Must not read cookies');}},
  '@/lib/supabase/admin':{supabaseAdmin:{from(){reads++;throw Error('Must not query');}}},
 });
 assert.equal((await app('app/api/facebook/oauth/pages/route.ts').GET({})).status,403);
 assert.equal((await app('app/api/facebook/oauth/select/route.ts').POST({})).status,403);assert.equal(reads,0);
});
function selector(existingMember){
 const db=database({social_accounts:[{id:'foreign',business_id:'B',platform:'facebook',platform_account_id:'123',is_active:true,facebook_token_status:'connected'}],
  team_members:existingMember?[{id:'member-B',user_id:'u',business_id:'B',is_active:true,role:'agent'}]:[]});
 let calls=0;db.rpc=async()=>{calls++;throw Error('No enrollment RPC allowed');};const writes=[];
 const redirect=(url,status=303)=>{const r=new Response(null,{status,headers:{Location:String(url)}});r.cookies={set:(...args)=>writes.push(args)};return r;};
 const app=loader({
  'next/server':{NextResponse:{redirect,json:Response.json},after(){}},'next/headers':{cookies:async()=>({get:()=>({value:'fixture'}),set:(...args)=>writes.push(args)})},
  '@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,user:{id:'u'},member:{id:'m',business_id:'A'}}),TENH_ACTIVE_BUSINESS_COOKIE:'workspace'},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>true},
  '@/lib/facebook/facebook-oauth-session':{FACEBOOK_OAUTH_SESSION_COOKIE:'selection',decodeFacebookOAuthSession:()=>({memberId:'m',businessId:'A',userAccessToken:'fixture'})},
  '@/lib/facebook/facebook-authorized-pages':{getFacebookAuthorizedPages:async()=>({pages:[{id:'123',access_token:'fixture'}]})},
  '@/lib/facebook/facebook-token-crypto':{encryptFacebookToken:()=>'',encryptFacebookUserAuthorization:()=>''},
  '@/lib/facebook/facebook-origin':{getFacebookAppOrigin:()=>'https://fixture.test'},
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/channels/trial-channel-access':{assertTrialChannelAccess:async()=>{}},
  '@/lib/channels/expired-trial-claim':{loadExpiredTrialBusinessIds:async()=>new Set(),releaseFacebookTrialClaims:async()=>{throw Error('No releases');}},
  '@/lib/subscription/get-business-entitlements':{getBusinessEntitlements:async()=>{throw Error('No entitlement mutation');}},
  '@/lib/facebook/facebook-connection-health':{ensureFacebookPageConnectionHealthy:async()=>{throw Error('No subscriptions');}},
  '@/lib/facebook/recover-facebook-missed-data':{recoverRecentFacebookData:async()=>{}},
  '@/lib/facebook/facebook-thread-owner':{},
 },{console:quiet})('app/api/facebook/oauth/select/route.ts');
 const form=new FormData();form.set('pageId','123');return{post:()=>app.POST({formData:async()=>form}),writes,calls:()=>calls};
}
test('a cached grant cannot enroll its viewer in a foreign workspace',async()=>{
 const h=selector(false),r=await h.post();assert.match(new URL(r.headers.get('Location')).searchParams.get('message'),/invitation/);
 assert.equal(h.calls(),0);assert.ok(!h.writes.some(([key])=>key==='workspace'));
});
test('existing active membership may switch workspace without creating membership',async()=>{
 const h=selector(true),r=await h.post();assert.equal(new URL(r.headers.get('Location')).searchParams.get('facebook'),'connected');
 assert.equal(h.calls(),0);assert.ok(h.writes.some(([key,value])=>key==='workspace'&&value==='B'));
});
function legacyPage(){
 const calls=[];const db=database({social_accounts:[
  {id:'own',business_id:'A',platform:'facebook',platform_account_id:'123',is_active:true},
  {id:'foreign',business_id:'B',platform:'facebook',platform_account_id:'999',is_active:true},
  {id:'paused',business_id:'A',platform:'facebook',platform_account_id:'321',is_active:false},
 ]});
 const app=loader({
  '@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,member:{business_id:'A'}})},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>true},'@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/facebook/get-facebook-page-access-token':{getFacebookPageAccessToken:async(page,id)=>{calls.push(['token',page,id]);return 'fixture';}},
 },{File,FormData,console:quiet,process:{env:{FACEBOOK_PAGE_ID:'999'}},fetch:async url=>{calls.push(['graph',String(url)]);return Response.json({id:'fixture'});}});
 const photo=id=>{const form=new FormData();if(id)form.set('socialAccountId',id);form.set('caption','Fixture');form.set('photo',new File(['bytes'],'photo.png',{type:'image/png'}));return{formData:async()=>form};};
 return{app,calls,photo};
}
for(const id of [undefined,'foreign','paused'])test(`legacy endpoints reject ${id||'missing'} Page before token access`,async()=>{
 const h=legacyPage();for(const r of [await h.app('app/api/facebook/posts/create/route.ts').POST(h.photo(id)),await h.app('app/api/facebook/token-check/route.ts').GET(new Request('https://fixture.test/?'+(id?'socialAccountId='+id:'')))])assert.ok(r.status>=400);
 assert.equal(h.calls.length,0);
});
test('legacy endpoints use only the exact owned account, even with a different global Page configured',async()=>{
 const h=legacyPage();assert.equal((await h.app('app/api/facebook/posts/create/route.ts').POST(h.photo('own'))).status,200);
 assert.equal((await h.app('app/api/facebook/token-check/route.ts').GET(new Request('https://fixture.test/?socialAccountId=own'))).status,200);
 assert.deepEqual(h.calls.filter(x=>x[0]==='token'),[['token','123','own'],['token','123','own']]);
 assert.ok(h.calls.some(x=>x[0]==='graph'&&x[1].includes('/123/photos')));
});

test('account-scoped token reads cannot select another row or fall back to a global Page token',async()=>{
 const db=database({social_accounts:[
  {id:'exact',platform:'facebook',platform_account_id:'123',is_active:true,facebook_page_access_token_encrypted:'exact-fixture',created_at:'2020-01-01'},
  {id:'other',platform:'facebook',platform_account_id:'123',is_active:true,facebook_page_access_token_encrypted:'foreign-fixture',created_at:'2026-01-01'},
 ]});
 const api=loader({'@/lib/supabase/admin':{supabaseAdmin:db},'@/lib/facebook/facebook-token-crypto':{decryptFacebookToken:x=>x}},
  {process:{env:{FACEBOOK_PAGE_ACCESS_TOKEN:'global-fixture'}}})('lib/facebook/get-facebook-page-access-token.ts');
 assert.equal(await api.getFacebookPageAccessToken('123','exact'),'exact-fixture');
 db.tables.social_accounts[0].facebook_page_access_token_encrypted=null;
 await assert.rejects(api.getFacebookPageAccessToken('123','exact'),/not connected/);
 await assert.rejects(api.getFacebookPageAccessToken('123','missing'),/not connected/);
});

test('Page discovery stops without next and follows genuine next pages once',async()=>{
 for(const more of [false,true]){
  const calls=[];const app=loader({}, {process:{env:{}},fetch:async url=>{calls.push(String(url));if(calls.length===1)return Response.json({data:[{id:'1'}],paging:{cursors:{after:'cursor'},...(more?{next:'https://graph.facebook.com/next'}:{})}});return Response.json({data:[{id:'2'}],paging:{cursors:{after:'terminal'}}});}})('lib/facebook/facebook-authorized-pages.ts');
  const result=await app.getFacebookAuthorizedPages('fixture');assert.equal(calls.length,more?2:1);assert.equal(result.pages.length,more?2:1);
 }
});
test('invalid pagination cannot report a truncated list as complete',async()=>{
 const app=loader({}, {process:{env:{}},fetch:async()=>Response.json({data:[{id:'1'}],paging:{next:'https://graph.facebook.com/next'}})})('lib/facebook/facebook-authorized-pages.ts');
 await assert.rejects(app.getFacebookAuthorizedPages('fixture'),/incomplete/);
});
