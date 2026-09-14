const test=require('node:test'); const assert=require('node:assert/strict');
const {loader}=require('./tenh-seven/harness.cjs');
function setup(authorized=true, manage=true){
 const cookies=[]; const redirect=[];
 const load=loader({
  'next/server':{NextResponse:{json:(_,init)=>({status:init.status}),redirect:url=>{redirect.push(url);return {cookies:{set:(...args)=>cookies.push(args)},headers:{set(){}}};}}},
  '@/lib/auth/get-current-member':{getCurrentMember:async()=>authorized?{success:true,member:{business_id:'workspace1'}}:{success:false,error:'Unauthorized'}},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>manage},
 },{process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co'}}});
 const {GET}=load('app/api/mobile/facebook-connect/route.ts');
 return {cookies,redirect,get:()=>GET({url:'https://app.tenhchat.com/api/mobile/facebook-connect',nextUrl:new URL('https://app.tenhchat.com/api/mobile/facebook-connect'),cookies:{getAll:()=>[{name:'sb-project-auth-token.0',value:'private'},{name:'sb-other-auth-token',value:'other'},{name:'tenh_active_business_id',value:'wrong'},{name:'unrelated',value:'value'}]}})};
}
test('unauthenticated bridge cannot establish cookies',async()=>{const h=setup(false);assert.equal((await h.get()).status,401);assert.equal(h.cookies.length,0);});
test('bridge requires channel management permission',async()=>{const h=setup(true,false);assert.equal((await h.get()).status,403);assert.equal(h.cookies.length,0);});
test('bridge scopes private cookies and fixed redirect',async()=>{const h=setup();await h.get();assert.equal(h.redirect[0].pathname,'/api/facebook/oauth/connect');assert.deepEqual(h.cookies.map(c=>c[0]),['sb-project-auth-token.0','tenh_active_business_id']);assert.equal(h.cookies[1][1],'workspace1');for(const c of h.cookies){assert.equal(c[2].httpOnly,true);assert.equal(c[2].secure,true);assert.equal(c[2].maxAge,600);}});
