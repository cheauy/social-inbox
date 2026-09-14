const test=require('node:test'),assert=require('node:assert/strict');
const {loader,database}=require('./tenh-seven/harness.cjs');
function setup(matching=true){let calls=0;const load=loader({
 'next/server':{NextResponse:Response},'next/headers':{cookies:async()=>({get:()=>({value:'encrypted'})})},
 '@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,member:{id:'m1',business_id:'b1'}})},
 '@/lib/auth/require-permission':{memberHasPermission:async()=>true},
 '@/lib/facebook/facebook-oauth-session':{FACEBOOK_OAUTH_SESSION_COOKIE:'oauth',decodeFacebookOAuthSession:()=>({memberId:matching?'m1':'other',businessId:'b1',userAccessToken:'secret-user-token'})},
 '@/lib/facebook/facebook-authorized-pages':{getFacebookAuthorizedPages:async()=>{calls++;return {pages:[{id:'123',name:'Test </script> Page',access_token:'secret-page-token'}]};}},
 '@/lib/supabase/admin':{supabaseAdmin:database({social_accounts:[]})},
 });return{get:load('app/api/mobile/facebook-pages/route.ts').GET,calls:()=>calls};}
test('native page bridge excludes secrets and escapes HTML',async()=>{const h=setup();const r=await h.get();const body=await r.text();assert.doesNotMatch(body,/secret-user-token|secret-page-token|Test <\/script>/);assert.match(body,/Not|connected/);assert.match(r.headers.get('content-security-policy'),/form-action 'self'/);});
test('another member cannot read the OAuth session pages',async()=>{const h=setup(false);const body=await(await h.get()).text();assert.match(body,/different workspace/);assert.equal(h.calls(),0);});
