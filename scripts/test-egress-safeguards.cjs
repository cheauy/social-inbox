const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');

function loader(mocks = {}) {
  const loaded = new Map();
  function load(name) {
    if (Object.hasOwn(mocks,name)) return mocks[name];
    if (name === 'server-only') return {};
    if (!name.startsWith('@/')) return require(name);
    if (loaded.has(name)) return loaded.get(name).exports;
    const module = { exports: {} }; loaded.set(name,module);
    const file = path.join(process.cwd(),name.slice(2)+'.ts');
    const code = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    new Function('require','module','exports',code)(load,module,module.exports);
    return module.exports;
  }
  return load;
}

test('concurrent requests never share memoized authentication; repeated reads within one do', async () => {
  const load = loader({ 'next/server': { after() {} } });
  const { requestMemo, withRequestScope } = load('@/lib/server/request-scope');
  let calls = 0;
  const handler = withRequestScope(async identity => Promise.all(Array.from({length:5},() => requestMemo('member',async () => { calls++; await new Promise(r=>setTimeout(r,3)); return identity; }))));
  assert.deepEqual(await Promise.all([handler('shop-a'),handler('shop-b')]), [Array(5).fill('shop-a'),Array(5).fill('shop-b')]);
  assert.equal(calls,2);
  await handler('shop-a'); assert.equal(calls,3, 'access must be rechecked in the next request');
});

test('a failed request-local read can be retried without caching its rejection', async () => {
  const load=loader({'next/server':{after(){}}});
  const {requestMemo,withRequestScope}=load('@/lib/server/request-scope');
  await withRequestScope(async()=>{
    await assert.rejects(requestMemo('read',async()=>{throw Error('offline')}));
    assert.equal(await requestMemo('read',async()=>42),42);
  })();
});

test('usage counts consumed bytes once and preserves the response; outside scope it is untouched', async () => {
  const load=loader();const {usageContext,observedSupabaseFetch}=load('@/lib/server/usage-context');
  const original=global.fetch;let requests=0;
  global.fetch=async()=>{requests++;return new Response('hello',{status:200,headers:{'x-test':'yes'}})};
  try {
    const usage={businessId:'a',databaseRequests:0,databaseResponseBytes:0,storageResponseBytes:0};
    await usageContext.run(usage,async()=>{const r=await observedSupabaseFetch('https://example.test/rest/v1/conversations');assert.equal(r.headers.get('x-test'),'yes');assert.equal(await r.text(),'hello');});
    assert.equal(requests,1); assert.equal(usage.databaseRequests,1);assert.equal(usage.databaseResponseBytes,5);
    await observedSupabaseFetch('https://example.test/rest/v1/conversations');assert.equal(usage.databaseRequests,1);
  } finally {global.fetch=original;}
});

test('configured tenant limiter stops expensive reads with Retry-After; other tenant succeeds', async () => {
  const previous=process.env.TENH_ENFORCE_READ_BUDGETS;process.env.TENH_ENFORCE_READ_BUDGETS='true';
  let business='limited',calls=0;
  const load=loader({'next/server':{NextResponse:Response,after(){}}, '@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,member:{business_id:business}})}, '@/lib/supabase/admin':{supabaseAdmin:{rpc:async(name,args)=>({data:{allowed:args.p_business_id!=='limited',retryAfter:12},error:null})}}});
  try {
    const run=load('@/lib/server/tenant-read-scope').withTenantReadScope(async()=>{calls++;return Response.json({success:true})});
    const denied=await run();assert.equal(denied.status,429);assert.equal(denied.headers.get('retry-after'),'12');assert.equal(calls,0);
    business='other';assert.equal((await run()).status,200);assert.equal(calls,1);
  } finally {if(previous===undefined)delete process.env.TENH_ENFORCE_READ_BUDGETS;else process.env.TENH_ENFORCE_READ_BUDGETS=previous;}
});

test('thumbnail preserves aspect ratio, bounds resolution and reduces a large source', async () => {
  const sharp=require('sharp');const input=await sharp({create:{width:1400,height:700,channels:3,background:'#07a2e8'}}).png().toBuffer();
  const result=await loader()('@/lib/media/avatar-thumbnail').avatarThumbnail(input);
  const meta=await sharp(result).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,256);assert.equal(meta.height,128);assert.ok(result.length<input.length);
});

test('thumbnail rejects invalid content rather than serving it as an image',async()=>{
  await assert.rejects(loader()('@/lib/media/avatar-thumbnail').avatarThumbnail(Buffer.from('<html>not a photo</html>')));
});

test('targeted mobile reads enforce workspace scope and cap IDs before querying',async()=>{
  const business='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';let reads=0;
  const load=loader({
    'next/server':{NextResponse:Response},
    '@/lib/server/tenant-read-scope':{withTenantReadScope:fn=>fn},
    '@/lib/auth/require-permission':{loadPermissionContext:async()=>({success:true,context:{member:{business_id:business},permissions:{}}})},
    '@/lib/inbox/get-conversations':{getInboxConversationScope:async()=>({currentBusinessId:business,accessibleBusinessIds:[business]}),getConversations:async(ids,filter)=>{reads++;assert.deepEqual(ids,[business]);assert.deepEqual(filter.conversationIds,[id]);return [];}},
  });
  const {GET}=load('@/app/api/mobile/bootstrap/route');
  const call=query=>GET({nextUrl:new URL('https://test.local/api/mobile/bootstrap?'+query)});
  const allowed=await call(`workspaceIds=${business}&conversationIds=${id}`);
  assert.equal(allowed.status,200);assert.deepEqual((await allowed.json()).removedConversationIds,[id]);
  assert.equal((await call(`workspaceIds=other&conversationIds=${id}`)).status,403);
  assert.equal((await call(`workspaceIds=${business}&conversationIds=invalid`)).status,400);
  const many=Array.from({length:51},(_,i)=>`${String(i).padStart(8,'0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`).join(',');
  assert.equal((await call(`workspaceIds=${business}&conversationIds=${many}`)).status,400);assert.equal(reads,1);
});

test('Realtime health is true only after every workspace subscribes and falls back on disconnect',async()=>{
  const cleanups=[], callbacks=new Map(), health=[];
  const client={auth:{getSession:async()=>({data:{session:{access_token:'test'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},realtime:{setAuth:async()=>{}},removeChannel:async()=>{},channel(name){const chain={on(){return chain},subscribe(fn){callbacks.set(name,fn);return chain}};return chain}};
  const load=loader({'react':{useRef:value=>({current:value}),useEffect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup);}},'@/lib/supabase/client':{createClient:()=>client}});
  load('@/lib/inbox/use-inbox-realtime').useInboxRealtime({businessIds:['a','b'],onRealtimeEvent(){},onConnectionState:ready=>health.push(ready)});
  await new Promise(resolve=>setImmediate(resolve));
  callbacks.get('tenh-inbox-v3-a')('SUBSCRIBED');assert.equal(health.at(-1),false);
  callbacks.get('tenh-inbox-v3-b')('SUBSCRIBED');assert.equal(health.at(-1),true);
  callbacks.get('tenh-inbox-v3-b')('CLOSED');assert.equal(health.at(-1),false);
  for(const cleanup of cleanups)cleanup();
});

test('a targeted refresh waits for the initial list; failures do not poison later refreshes',async()=>{
  const {SerialTaskQueue}=loader()('@/mobile/lib/serial-task-queue');
  const queue=new SerialTaskQueue();let rows=[],release;
  const gate=new Promise(resolve=>{release=resolve});
  const full=queue.run(async()=>{await gate;rows=['a','b','c']});
  const targeted=queue.run(async()=>{rows=rows.map(id=>id==='b'?'b-updated':id)});
  await Promise.resolve();assert.deepEqual(rows,[]);release();
  await Promise.all([full,targeted]);assert.deepEqual(rows,['a','b-updated','c']);
  await assert.rejects(queue.run(async()=>{throw Error('offline')}));
  await queue.run(async()=>{rows.push('d')});assert.equal(rows.at(-1),'d');
});

test('simultaneous thumbnail requests share a download and different workspace paths stay separate',async()=>{
  const sharp=require('sharp');const input=await sharp({create:{width:32,height:32,channels:3,background:'red'}}).png().toBuffer();let reads=0;
  const load=loader({
    'next/cache':{unstable_cache:fn=>fn},
    '@/lib/supabase/admin':{supabaseAdmin:{storage:{from:()=>({download:async()=>{reads++;await new Promise(r=>setTimeout(r,5));return {data:new Blob([input]),error:null}}})}}},
  });
  const {loadStoredAvatar}=load('@/lib/media/load-stored-avatar');
  const results=await Promise.all([loadStoredAvatar('private','shop-a/contact'),loadStoredAvatar('private','shop-a/contact'),loadStoredAvatar('private','shop-b/contact')]);
  assert.equal(reads,2);assert.ok(results.every(r=>r.data?.type==='image/webp'&&!r.error));
});
