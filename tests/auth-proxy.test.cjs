/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
const {loader}=require('./tenh-seven/harness.cjs');
const {Buffer}=require('node:buffer');
const app='https://app.tenhchat.com';
function jar(initial=[],headers){
  const values=new Map(initial.map(x=>[x.name,{...x}]));
  const sync=()=>{if(headers)headers.set('cookie',[...values.values()].map(x=>`${x.name}=${x.value}`).join('; '));};
  return {getAll:()=>[...values.values()],get:name=>values.get(name),
    set:(name,value,options={})=>{values.set(name,{name,value,...options});sync();},delete:name=>{values.delete(name);sync();}};
}
function fixture(options={}){
  let sdkCalls=0,policyCalls=0,nextCalls=0,sdkOptions;
  const response=(status,headers)=>{const value=new Response(null,{status,headers});value.cookies=jar();return value;};
  const load=loader({
    '@supabase/ssr':{createServerClient:(url,key,config)=>{sdkOptions=config;sdkCalls++;return {auth:{getUser:async()=>{
      for(const batch of options.batches??[])await config.cookies.setAll(batch.cookies,batch.headers??{});
      return {data:{user:options.anonymous?null:{id:'user'}},error:options.authError??null};
    }}};}},
    'next/server':{NextResponse:{next:args=>{nextCalls++;const value=response(200);value.requestHeaders=args?.request?.headers??args?.request?.headers;return value;},
      redirect:(url,status=307)=>response(status,{Location:String(url)}),json:(body,init)=>{const value=Response.json(body,init);value.cookies=jar();return value;}}},
    '@/lib/auth/session-policy':{checkSessionPolicy:async(client,user,config)=>{policyCalls++;assert.equal(config.allowRecovery,true);
      for(const batch of options.policyBatches??[])await sdkOptions.cookies.setAll(batch.cookies,batch.headers??{});
      return options.policy??{allowed:true,sessionId:'session',kind:options.recovery?'recovery':'normal'};}},
    '@/lib/auth/auth-ticket':{verifyAuthTicket:()=>options.validHint===true},
  },{Buffer,process:{env:{NODE_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture'}}});
  const loaded=load('proxy.ts');
  const run=async(path='/dashboard/inbox',cookies=[])=>{
    const url=new URL(path,options.host??app);url.clone=()=>new URL(url);
    const headers=new Headers({host:url.host,...options.headers});
    const request={url:String(url),nextUrl:url,headers,cookies:jar(cookies,headers)};
    return {response:await loaded.proxy(request),request};
  };
  return {run,module:loaded,counts:()=>({sdkCalls,policyCalls,nextCalls})};
}
const refreshed=[
  {cookies:[{name:'sb-project-auth-token.0',value:'batch-one',options:{path:'/',httpOnly:true,maxAge:31536000}}],headers:{'x-sdk-first':'one','Cache-Control':'private, no-store','Vary':'Authorization'}},
  {cookies:[{name:'sb-project-auth-token.1',value:'batch-two',options:{path:'/',sameSite:'lax',maxAge:31536000}}],headers:{'x-sdk-second':'two',Expires:'0',Pragma:'no-cache'}},
];
test('all refresh cookie batches and SDK headers survive both dashboard Next and auth redirects',async()=>{
  for(const path of ['/dashboard/inbox','/login']){
    const h=fixture({batches:refreshed}),{response,request}=await h.run(path);
    assert.equal(response.cookies.get('sb-project-auth-token.0')?.value,'batch-one');
    assert.equal(response.cookies.get('sb-project-auth-token.1')?.value,'batch-two');
    assert.equal(response.headers.get('x-sdk-first'),'one');assert.equal(response.headers.get('x-sdk-second'),'two');
    assert.equal(response.headers.get('Expires'),'0');assert.match(response.headers.get('cache-control'),/private/);assert.match(response.headers.get('cache-control'),/no-store/);
    assert.match(response.headers.get('vary'),/Authorization/);assert.match(response.headers.get('vary'),/Cookie/);
    assert.equal(request.cookies.get('sb-project-auth-token.0').value,'batch-one');
    if(path==='/dashboard/inbox')assert.match(response.requestHeaders.get('cookie'),/sb-project-auth-token\.1=batch-two/);
    if(path==='/login')assert.equal(new URL(response.headers.get('location')).pathname,'/dashboard/inbox');
  }
});
test('a policy-time refresh is retained and browser-session cookies cannot become persistent',async()=>{
  const hint=Buffer.from(JSON.stringify({remembered:false,expiresAt:'2026-10-16T12:00:00Z',sessionId:'session'})).toString('base64url')+'.signature';
  const h=fixture({batches:[refreshed[0]],policyBatches:[refreshed[1]],validHint:true}),{response}=await h.run('/dashboard/inbox',[{name:'tenh_session_hint',value:hint}]);
  assert.equal(response.cookies.get('sb-project-auth-token.0').maxAge,undefined);
  assert.equal(response.cookies.get('sb-project-auth-token.1').maxAge,undefined);
  assert.equal(response.cookies.get('sb-project-auth-token.1').expires,undefined);
});
test('staged legacy sessions keep SDK persistence without any hint; present invalid hints become session-only',async()=>{
  const expires=new Date('2027-10-15T12:00:00Z'),batches=[{cookies:[{name:'sb-project-auth-token.0',value:'refreshed',options:{maxAge:31536000,expires,path:'/'}}]}];
  for(const present of [false,true]){
    const h=fixture({batches,policy:{allowed:true,sessionId:'legacy',kind:'legacy',expiresAt:null,remembered:null}});
    const {response}=await h.run('/dashboard/inbox',present?[{name:'tenh_session_hint',value:'invalid-signature'}]:[]);
    assert.equal(response.status,200);
    const cookie=response.cookies.get('sb-project-auth-token.0');assert.equal(cookie.maxAge,present?undefined:31536000);
    assert.equal(cookie.expires?.toISOString(),present?undefined:expires.toISOString());
  }
});
test('remembered refresh expires at the signed hint deadline; invalid hints do not extend persistence',async()=>{
  const expiresAt='2026-11-15T12:00:00Z';
  const hint=Buffer.from(JSON.stringify({remembered:true,expiresAt,sessionId:'session'})).toString('base64url')+'.signature';
  for(const validHint of [true,false]){
    const h=fixture({batches:refreshed,validHint}),{response}=await h.run('/dashboard/inbox',[{name:'tenh_session_hint',value:hint}]);
    const cookie=response.cookies.get('sb-project-auth-token.0');assert.equal(cookie.maxAge,undefined);
    assert.equal(cookie.expires?.toISOString(),validHint?expiresAt.replace('Z','.000Z'):undefined);
  }
});
test('expired policy clears every private auth cookie on redirect and keeps the safe return destination',async()=>{
  const h=fixture({batches:refreshed,policy:{allowed:false,status:401,reason:'expired'}});
  const cookies=['tenh_session_hint','tenh_auth_intent','tenh_recovery_grant','tenh_active_business_id','sb-project-auth-token.0','sb-project-code-verifier','theme'].map(name=>({name,value:'private'}));
  const {response,request}=await h.run('/dashboard/contacts?q=saved',cookies),location=new URL(response.headers.get('location'));
  assert.equal(location.pathname,'/login');assert.equal(location.searchParams.get('reason'),'session_expired');assert.equal(location.searchParams.get('next'),'/dashboard/contacts?q=saved');
  for(const cookie of cookies.filter(x=>x.name!=='theme')){assert.equal(response.cookies.get(cookie.name)?.maxAge,0,cookie.name);assert.equal(request.cookies.get(cookie.name),undefined);}
  assert.equal(response.cookies.get('sb-project-auth-token.1').maxAge,0);assert.equal(request.cookies.get('theme').value,'private');
});
test('anonymous dashboard redirects preserve only centrally validated return paths, not arbitrary login parameters',async()=>{
  const h=fixture({anonymous:true});
  const {response}=await h.run('/dashboard/settings?next=https%3A%2F%2Fattacker.invalid&token=private'),location=new URL(response.headers.get('location'));
  assert.equal(location.pathname,'/login');assert.equal(location.searchParams.get('token'),null);
  assert.equal(location.searchParams.get('next'),'/dashboard/settings?next=https%3A%2F%2Fattacker.invalid&token=private');
  assert.equal(h.counts().policyCalls,0);
});
test('signed-in Auth-page redirects reject control/encoded external next values and preserve safe application paths',async()=>{
  for(const next of ['https://attacker.invalid','//attacker.invalid','/%2Fattacker.invalid','/dashboard/%0Aattacker','/login','/dashboard/contacts?view=saved']){
    const h=fixture(),{response}=await h.run('/login?next='+encodeURIComponent(next));
    assert.equal(response.headers.get('location'),app+(next==='/dashboard/contacts?view=saved'?next:'/dashboard/inbox'));
  }
});
test('recovery sessions cannot enter dashboard or login and can render their reset form',async()=>{
  for(const path of ['/dashboard/inbox','/login','/register','/forgot-password']){
    const h=fixture({recovery:true}),{response}=await h.run(path);assert.equal(new URL(response.headers.get('location')).pathname,'/reset-password');
  }
  const h=fixture({recovery:true}),{response}=await h.run('/reset-password');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
});
test('API and provider callbacks are no-store pass-throughs without human Auth lookup or redirect',async()=>{
  for(const path of ['/api/auth/login','/api/account/password','/auth/callback?code=fixture','/auth/confirm?token_hash=fixture']){
    const h=fixture(),{response}=await h.run(path);assert.equal(response.status,200);assert.equal(h.counts().sdkCalls,0);assert.match(response.headers.get('cache-control'),/no-store/);
  }
  const h=fixture(),{response}=await h.run('/api/telegram/webhook');assert.equal(response.status,200);assert.equal(h.counts().sdkCalls,0);
  assert.equal(response.headers.get('cache-control'),null);
  for(const options of [{headers:{Authorization:'Bearer fixture'}},{}]){
    const api=fixture(options),{response}=await api.run('/api/workspace-storage/files',options.headers?[]:[{name:'sb-project-auth-token.0',value:'private'}]);
    assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('vary'),/Authorization/);assert.equal(api.counts().sdkCalls,0);
  }
});
test('policy outages stop private rendering without destructively clearing an otherwise valid session',async()=>{
  const h=fixture({batches:refreshed,policy:{allowed:false,status:503,reason:'policy-unavailable'}}),{response}=await h.run();
  assert.equal(response.status,503);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.cookies.get('sb-project-auth-token.0')?.value,'batch-one');
});
test('provider outage preserves cookies while invalid provider credentials clear them before redirect',async()=>{
  for(const status of [401,429,503]){
    const h=fixture({authError:{message:'fixture failure',status}}),{response}=await h.run('/dashboard/inbox',[{name:'sb-project-auth-token.0',value:'private'}]);
    assert.equal(response.status,status===401?307:503);assert.equal(response.cookies.get('sb-project-auth-token.0')?.maxAge,status===401?0:undefined);
    assert.equal(h.counts().policyCalls,0);
  }
});
test('marketing host redirects retain path/query and never inspect Auth; matcher covers all new Auth surfaces',async()=>{
  const h=fixture({host:'https://www.tenhchat.com'}),{response}=await h.run('/login?next=%2Fdashboard%2Fcontacts');
  assert.equal(response.status,307);assert.equal(response.headers.get('location'),'https://app.tenhchat.com/login?next=%2Fdashboard%2Fcontacts');assert.equal(h.counts().sdkCalls,0);
  for(const path of ['/api/:path*','/auth/:path*','/verify-email','/forgot-password','/reset-password'])assert.ok(h.module.config.matcher.includes(path));
});

test('real NextRequest/NextResponse carry refreshed chunks to downstream requests and redirect responses',async()=>{
  const {NextRequest,NextResponse}=require('next/server');
  for(const path of ['/dashboard/inbox','/login']){
    const run=loader({'next/server':{NextResponse},'@supabase/ssr':{createServerClient:(url,key,config)=>({auth:{getUser:async()=>{
      for(const batch of refreshed)await config.cookies.setAll(batch.cookies,batch.headers);return {data:{user:{id:'fixture'}},error:null};
    }}})},'@/lib/auth/session-policy':{checkSessionPolicy:async()=>({allowed:true,kind:'normal'})},'@/lib/auth/auth-ticket':{verifyAuthTicket:()=>false}},
    {process:{env:{NODE_ENV:'test',NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture'}}})('proxy.ts').proxy;
    const response=await run(new NextRequest(app+path));
    assert.equal(response.cookies.get('sb-project-auth-token.0').value,'batch-one');assert.equal(response.cookies.get('sb-project-auth-token.1').value,'batch-two');
    assert.equal(response.headers.get('x-sdk-first'),'one');assert.equal(response.headers.get('x-sdk-second'),'two');
    if(path==='/dashboard/inbox')assert.match(response.headers.get('x-middleware-request-cookie'),/sb-project-auth-token\.1=batch-two/);
    else assert.equal(new URL(response.headers.get('location')).pathname,'/dashboard/inbox');
  }
});
