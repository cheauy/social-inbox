const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, imports, extra = {}) {
 const exports = {};
 const code = ts.transpileModule(fs.readFileSync(path,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>{if(n==='server-only')return {};if(n in imports)return imports[n];throw Error(n);},...extra});
 return exports;
}

test('Facebook CDN signature changes reuse photos without merging different images or crops', () => {
 const media=load('mobile/lib/media-key.ts',{}, {URL,process:{env:{}}});
 const first='https://scontent-a.fbcdn.net/v/t/photo.jpg?oh=old&oe=111&_nc_cat=1&stp=crop-a';
 const refreshed='https://scontent-b.fbcdn.net/v/t/photo.jpg?stp=crop-a&oe=222&oh=new&_nc_cat=2';
 assert.equal(media.stableMediaKey(first),media.stableMediaKey(refreshed));
 assert.notEqual(media.stableMediaKey(first),media.stableMediaKey(refreshed.replace('crop-a','crop-b')));
 assert.notEqual(media.stableMediaKey(first),media.stableMediaKey(refreshed.replace('photo.jpg','other.jpg')));
 const external='https://example.com/image?oh=1&oe=2';
 assert.equal(media.stableMediaKey(external),external);
 const lookalike='https://fbcdn.net.example.com/image?oh=1';
 assert.equal(media.stableMediaKey(lookalike),lookalike);
});

test('comment Page avatars use a Page id and omit missing or malformed ids', () => {
 const photo=load('mobile/lib/facebook-page-photo.ts',{});
 assert.equal(photo.facebookPagePhoto(' 12345 '),'https://graph.facebook.com/12345/picture?type=large&width=96&height=96');
 assert.equal(photo.facebookPagePhoto(null),null);
 assert.equal(photo.facebookPagePhoto('../wrong'),null);
});
test('signed URLs are reused, deduplicated and separated by bucket', async () => {
 let calls=0;
 const api=load('lib/media/signed-urls.ts',{'@/lib/supabase/admin':{supabaseAdmin:{storage:{from:bucket=>({createSignedUrls:async paths=>{calls++;return {data:paths.map(path=>({path,signedUrl:bucket+'/'+path+'/'+calls})),error:null};}})}}}});
 const [a,b]=await Promise.all([api.cachedSignedUrls('a',['p','p'],600),api.cachedSignedUrls('a',['p'],600)]);
 assert.equal(calls,1);assert.equal(a[0].signedUrl,b[0].signedUrl);
 assert.equal((await api.cachedSignedUrls('a',['p'],600))[0].signedUrl,a[0].signedUrl);assert.equal(calls,1);
 assert.notEqual((await api.cachedSignedUrls('b',['p'],600))[0].signedUrl,a[0].signedUrl);assert.equal(calls,2);
});
test('signed URLs refresh before expiry and failures are not cached', async () => {
 let now=1000,calls=0,fail=true;
 const api=load('lib/media/signed-urls.ts',{'@/lib/supabase/admin':{supabaseAdmin:{storage:{from:()=>({createSignedUrls:async paths=>{calls++;return fail?{error:Error('failed')}:{data:paths.map(path=>({path,signedUrl:'url'+calls}))};}})}}}}, {Date:{now:()=>now}});
 await assert.rejects(api.cachedSignedUrls('a',['p'],300));fail=false;
 await api.cachedSignedUrls('a',['p'],300);assert.equal(calls,2);
 now+=241000;await api.cachedSignedUrls('a',['p'],300);assert.equal(calls,3);
});
function mobileHarness({ contentLength = 1024 } = {}) {
 let now=1000000,downloads=0,active=0,maxActive=0,heads=0;
 const entries=new Map();const directories=new Set();
 const uri = parts=>parts.map(p=>typeof p==='string'?p:p.uri).join('/');
 class Directory {
  constructor(...parts){this.uri=uri(parts)}
  get exists(){return directories.has(this.uri)}
  create(){directories.add(this.uri)}
  list(){return [...entries.keys()].filter(k=>k.startsWith(this.uri+'/')).map(k=>new File(k))}
  delete(){for(const k of entries.keys())if(k.startsWith(this.uri+'/'))entries.delete(k);directories.delete(this.uri)}
 }
 class File {
  constructor(...parts){this.uri=uri(parts)}
  get name(){return this.uri.split('/').at(-1)}
  get exists(){return entries.has(this.uri)}
  get size(){return entries.get(this.uri)?.size??0}
  get modificationTime(){return entries.get(this.uri)?.time??0}
  delete(){entries.delete(this.uri)}
  move(target){entries.set(target.uri,entries.get(this.uri));entries.delete(this.uri);this.uri=target.uri}
  write(text){entries.set(this.uri,{text,size:text.length,time:now})}
  textSync(){return entries.get(this.uri)?.text}
  static async downloadFileAsync(url,file){downloads++;active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,3));active--;entries.set(file.uri,{size:1024,time:now});return file}
 }
 const api=load('mobile/lib/media-cache.ts',{'expo-file-system':{Directory,File,Paths:{cache:'cache'}}},{Date:{now:()=>now}, AbortSignal, fetch:async()=>{heads++;return {ok:true,headers:{get:()=>String(contentLength)}};}});
 return {api,entries,counts:()=>({downloads,maxActive,heads}),advance:(days=1)=>now+=days*86400000+1};
}
test('mobile images reuse disk across signed links and isolate account/workspace',async()=>{
 const h=mobileHarness();const a=await h.api.cacheMedia('https://s/a?token=1','attachment',undefined,'user:workspace');
 const b=await h.api.cacheMedia('https://s/a?token=2','attachment',undefined,'user:workspace');
 assert.equal(a,b);assert.equal(h.counts().downloads,1);
 const c=await h.api.cacheMedia('https://s/a','attachment',undefined,'other:workspace');assert.notEqual(a,c);
 h.advance();await h.api.cacheMedia('https://s/a','attachment',undefined,'user:workspace');assert.equal(h.counts().downloads,2);
 h.advance(7);await h.api.cacheMedia('https://s/a','attachment',undefined,'user:workspace');assert.equal(h.counts().downloads,3);
});
test('mobile cache coalesces requests, limits concurrency, and clears on logout',async()=>{
 const h=mobileHarness();
 await Promise.all(Array.from({length:12},(_,i)=>h.api.cacheMedia('https://s/'+i,'key'+Math.floor(i/2),undefined,'scope')));
 assert.equal(h.counts().downloads,6);assert(h.counts().maxActive<=3);
 h.api.clearMediaCache();assert.equal(h.entries.size,0);
 assert.equal(await h.api.cacheMedia('https://s/a','key'),null);
});
test('logout during a mobile download prevents that file being retained',async()=>{
 const h=mobileHarness();const work=h.api.cacheMedia('https://s/a','a',undefined,'scope');h.api.clearMediaCache();
 assert.equal(await work,null);assert.equal(h.entries.size,0);
});

test('warm media bypasses busy downloads and avatars refresh sooner than attachments', async () => {
 const h=mobileHarness();
 const cached=await h.api.cacheMedia('https://s/photo','photo',undefined,'scope');
 const busy=Array.from({length:6},(_,i)=>h.api.cacheMedia('https://s/'+i,'busy'+i,undefined,'scope'));
 assert.equal(h.api.getCachedMedia('photo','scope'),cached);
 assert.equal(await h.api.cacheMedia('https://s/photo','photo',undefined,'scope'),cached);
 assert.equal(h.counts().downloads,4); // three active misses + original warm file
 await Promise.all(busy);
 const avatar='/api/contacts/a/facebook-avatar';
 await h.api.cacheMedia('https://s/avatar',avatar,undefined,'scope');
 h.advance();
 assert.equal(h.api.getCachedMedia(avatar,'scope'),null);
 assert.equal(h.api.getCachedMedia('photo','scope'),cached);
});

test('opened videos cache once; large or unknown-size videos stream without a duplicate download', async () => {
 const h=mobileHarness();
 const first=await h.api.cacheMedia('https://s/video','video',undefined,'scope',true);
 assert.ok(first);
 assert.equal(await h.api.cacheMedia('https://s/video','video',undefined,'scope',true),first);
 assert.equal(h.counts().downloads,1);
 assert.equal(h.counts().heads,1);
 for(const contentLength of [0,30*1024*1024]) {
  const large=mobileHarness({contentLength});
  assert.equal(await large.api.cacheMedia('https://s/video','video',undefined,'scope',true),null);
  assert.equal(large.counts().downloads,0);
 }
});

test('evicting a corrupt mobile photo preserves the other workspace copy', async () => {
 const h=mobileHarness();
 const a=await h.api.cacheMedia('https://s/a','photo',undefined,'user:a');
 const b=await h.api.cacheMedia('https://s/a','photo',undefined,'user:b');
 h.api.removeCachedMedia('photo','user:a');
 assert.equal(h.entries.has(a),false);assert.equal(h.entries.has(a+'.json'),false);
 assert.equal(h.entries.has(b),true);
 await h.api.cacheMedia('https://s/a','photo',undefined,'user:a');
 assert.equal(h.counts().downloads,3);
});


test('quick reply thumbnail checks ownership before reading cached image bytes', async () => {
 const boundary=load('lib/settings/saved-reply-media-path.ts',{});
 let reads=0;
 const api=load('app/api/saved-replies/media/route.ts',{
  'next/server':{NextResponse:class extends Response{static json(data,options){return Response.json(data,options)}static redirect(url,status){return Response.redirect(url,status)}}},
  '@/lib/media/load-stored-avatar':{loadStoredAvatar:async()=>{reads++;return {data:new Blob(['thumbnail'],{type:'image/webp'})}}},
  '@/lib/media/signed-urls':{},
  '@/lib/server/usage-context':{},
  '@/lib/server/request-scope':{withRequestScope:f=>f},
  '@/lib/auth/get-current-member':{getCurrentMember:async()=>({success:true,member:{business_id:'mine'}})},
  '@/lib/auth/require-permission':{},
  '@/lib/settings/saved-reply-attachments':{...boundary,SAVED_REPLY_MEDIA_BUCKET:'private'},
  '@/lib/supabase/admin':{},
 },{Response,Blob,URL});
 for(const path of ['saved-replies/theirs/photo.jpg','saved-replies/mine/../theirs/photo.jpg']){
  assert.equal((await api.GET({nextUrl:new URL('https://app.test/api?thumbnail=1&path='+encodeURIComponent(path))})).status,404);
 }
 assert.equal(reads,0);
 const ok=await api.GET({nextUrl:new URL('https://app.test/api?thumbnail=1&path=saved-replies/mine/photo.jpg')});
 assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'private, max-age=3600');assert.equal(reads,1);
});
