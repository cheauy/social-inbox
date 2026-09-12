const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function routeHarness({authorized=true,photo=true,repaired=true}={}){
 let downloads=0,repairs=0;const image=new Blob(['photo'],{type:'image/jpeg'});
 const chain={select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:'contact',business_id:'business',platform:'facebook'}})};
 const exports={};vm.runInNewContext(compile('app/api/contacts/[contactId]/facebook-avatar/route.ts'),{exports,require:name=>{
 if(name==='next/server')return {NextResponse:class extends Response{static json(data,options){return Response.json(data,options)}}};
 if(name.includes('get-inbox-resource-access'))return {getInboxContactAccess:async()=>authorized?{success:true,member:{business_id:'business'}}:{success:false,status:403,error:'Denied'}};
 if(name.includes('repair-facebook-avatar'))return {repairFacebookAvatar:async(b,c)=>{assert.equal(b,'business');assert.equal(c,'contact');repairs++;return repaired}};
 if(name.includes('facebook-profile-photo'))return {FACEBOOK_AVATAR_BUCKET:'avatars',facebookAvatarStoragePath:({businessId,contactId})=>businessId+'/'+contactId};
 if(name.includes('load-stored-avatar'))return {loadStoredAvatar:async()=>{downloads++;return photo||downloads>1?{data:image,error:false}:{data:null,error:true}}};
 if(name.includes('supabase/admin'))return {supabaseAdmin:{from:()=>chain,storage:{from:()=>({download:async()=>{downloads++;return photo||downloads>1?{data:image,error:null}:{data:null,error:{message:'missing'}}}})}}};
 throw Error(name);
 }});
 return {run:()=>exports.GET({nextUrl:new URL('https://app.test/api/avatar')}, {params:Promise.resolve({contactId:'contact'})}),counts:()=>({downloads,repairs})};
}
test('stored photo returns immediately without Facebook repair',async()=>{const h=routeHarness();const r=await h.run();assert.equal(r.status,200);assert.equal(await r.text(),'photo');assert.deepEqual(h.counts(),{downloads:1,repairs:0});});
test('missing photo repairs then serves image in the same request',async()=>{const h=routeHarness({photo:false});const r=await h.run();assert.equal(r.status,200);assert.equal(await r.text(),'photo');assert.deepEqual(h.counts(),{downloads:2,repairs:1});});
test('Facebook refusal retains initials without repeated download',async()=>{const h=routeHarness({photo:false,repaired:false});assert.equal((await h.run()).status,404);assert.deepEqual(h.counts(),{downloads:1,repairs:1});});
test('authorization failure never reads or repairs another workspace photo',async()=>{const h=routeHarness({authorized:false});assert.equal((await h.run()).status,403);assert.deepEqual(h.counts(),{downloads:0,repairs:0});});
function repairHarness({accountBusiness='business',stored=true}={}){
 let syncs=0;const filters=[];const exports={};const cache=new Map();
 const chain={select(){return this},eq(k,v){filters.push([k,v]);return this},maybeSingle:async()=>({data:{id:'contact',platform_user_id:'psid',conversations:[{social_account:{business_id:accountBusiness,platform:'facebook',platform_account_id:'page',is_active:true}}]}})};
 vm.runInNewContext(compile('lib/facebook/repair-facebook-avatar.ts'),{exports,Map,JSON,require:name=>{
 if(name==='server-only')return {};
 if(name==='next/cache')return {unstable_cache:(fn,keys,options)=>{assert.equal(options.revalidate,3600);return (...args)=>{const k=JSON.stringify(args);if(!cache.has(k))cache.set(k,fn(...args));return cache.get(k)}}};
 if(name.includes('supabase/admin'))return {supabaseAdmin:{from:()=>chain}};
 if(name.includes('get-facebook-page-access-token'))return {getFacebookPageAccessToken:async page=>{assert.equal(page,'page');return 'private-test-token'}};
 if(name.includes('facebook-profile-photo'))return {syncFacebookContactProfilePhoto:async options=>{syncs++;assert.equal(options.customerId,'psid');assert.equal(options.businessId,'business');return {stored}}};
 throw Error(name);
 }});return {run:()=>exports.repairFacebookAvatar('business','contact'),count:()=>syncs,filters};
}
test('concurrent repairs and repeated denied lookups are coalesced and cached',async()=>{const h=repairHarness({stored:false});assert.deepEqual(await Promise.all([h.run(),h.run()]),[false,false]);await h.run();assert.equal(h.count(),1);assert.ok(h.filters.some(([k,v])=>k==='business_id'&&v==='business'));});
test('repair never uses a Page from a different workspace',async()=>{const h=repairHarness({accountBusiness:'other'});assert.equal(await h.run(),false);assert.equal(h.count(),0);});
const jsx=(type,props,key)=>({type,props,key});
function avatarHarness(){let state=[],lastKey;const exports={};vm.runInNewContext(compile('components/customer-avatar.tsx'),{exports,require:name=>name==='react'?{useState:()=>[state,update=>state=update(state)]}:{jsx,jsxs:jsx}});return props=>{const element=exports.CustomerAvatar(props);if(element.key!==lastKey){state=[];lastKey=element.key;}return element.type(element.props).props.children[1];};}
test('Facebook uses stable stored photo before expiring remote URL and falls back on failure',()=>{const render=avatarHarness();const props={src:'https://example.test/expiring.jpg',contactId:'contact',platform:'facebook'};const img=render(props);assert.equal(img.props.src,'/api/contacts/contact/facebook-avatar');img.props.onError();assert.equal(render(props).props.src,props.src);});
test('late photo sync retries a previously failed proxy even when its path is unchanged',()=>{const render=avatarHarness();const props={src:null,contactId:'contact',platform:'facebook'};render(props).props.onError();assert.equal(render(props),null);assert.equal(render({...props,src:'/api/contacts/contact/facebook-avatar'}).props.src,'/api/contacts/contact/facebook-avatar');});
