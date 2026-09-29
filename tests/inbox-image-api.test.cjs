const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { loader, database } = require('./tenh-seven/harness.cjs');
const one='https://scontent.xx.fbcdn.net/one.jpg',two='https://scontent.xx.fbcdn.net/two.jpg';
const original=patch=>({id:'photo1',business_id:'b1',conversation_id:'conv1',platform_message_id:'mid1',message_type:'image',message_text:'[image]',direction:'incoming',attachment_url:one,raw_payload:{},...patch});
class NextResponse extends Response { static json(data,init){return new NextResponse(JSON.stringify(data),{...init,headers:{'Content-Type':'application/json',...init?.headers}})} }
async function setup(options={}) {
  const input=await sharp({create:{width:250,height:180,channels:3,background:'#dd2244'}}).jpeg().toBuffer();
  const db=database({messages:options.rows || [original()]});const calls=[],signed=[];
  const l=loader({
    'next/server':{NextResponse}, sharp,
    '@/lib/supabase/admin':{supabaseAdmin:db},
    '@/lib/inbox/get-inbox-resource-access':{getInboxConversationAccess:async id=>options.denied?{success:false,status:403,error:'Denied'}:{success:true,businessId:'b1',member:{id:'m1',role:'owner'},conversation:{id,business_id:'b1'}}},
    '@/lib/auth/require-permission':{memberHasPermission:async(member,key,level)=>{assert.equal(key,'conversations');assert.equal(level,'view');return !options.noPermission;}},
    '@/lib/media/signed-urls':{cachedSignedUrls:async(bucket,paths)=>{signed.push({bucket,paths});return [{signedUrl:'https://project.supabase.co/storage/v1/object/sign/bucket/photo?token=test'}]}},
    '@/lib/telegram/telegram-message-media':{TELEGRAM_MESSAGE_MEDIA_BUCKET:'private-images',telegramMessageMediaStoragePath:({businessId,messageId,mediaKind})=>`${businessId}/${messageId}/${mediaKind}`},
  },{URLSearchParams,Uint8Array,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co'}},fetch:async(url,init)=>{calls.push({url:String(url),init});return options.fetch?options.fetch(url,init,input):new Response(input,{headers:{'Content-Type':'image/jpeg'}})}});
  const route=l('app/api/inbox/message-image/route.ts');
  const get=(query='conversationId=conv1&messageId=photo1')=>route.GET({nextUrl:new URL('https://app.tenhchat.com/api/inbox/message-image?'+query)});
  return {db,calls,signed,get};
}
test('image endpoint returns actual PNG bytes, not an image URL or HTML',async()=>{
 const h=await setup();const response=await h.get();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 const metadata=await sharp(bytes).metadata();assert.equal(metadata.width,250);assert.equal(metadata.height,180);assert.equal(h.calls[0].url,one);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('off-page thumbnails resolve by platform ID and stay small',async()=>{
 const h=await setup();const response=await h.get('conversationId=conv1&platformMessageId=mid1&thumbnail=1');assert.equal(response.status,200);
 const metadata=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.ok(metadata.width<=112&&metadata.height<=112);
});
test('native album photo index fetches the selected photo, not the first photo',async()=>{
 const h=await setup({rows:[original({raw_payload:{message:{attachments:[{type:'image',payload:{url:one}},{type:'image',payload:{url:two}}]}}})]});
 assert.equal((await h.get('conversationId=conv1&messageId=photo1&photoIndex=1')).status,200);assert.equal(h.calls[0].url,two);
});
for(const [name,options]of [
 ['unauthorized',{denied:true}],['without view permission',{noPermission:true}],
 ['other workspace',{rows:[original({business_id:'b2'})]}],['other conversation',{rows:[original({conversation_id:'conv2'})]}],
 ['deleted photo',{rows:[original({raw_payload:{tenh_deleted:{}}})]}],
 ['ordinary text',{rows:[original({message_type:'text',attachment_url:null})]}],
])test(`${name} cannot fetch photo bytes`,async()=>{const h=await setup(options);assert.ok((await h.get()).status>=400);assert.equal(h.calls.length,0);assert.equal(h.signed.length,0);});
test('invalid references and photo indexes are rejected without fetching',async()=>{
 const h=await setup();for(const query of ['', 'messageId=photo1','conversationId=conv1','conversationId=conv1&messageId=photo1&photoIndex=-1','conversationId=conv1&messageId=photo1&photoIndex=1.5','conversationId=conv1&messageId=photo1&photoIndex=1000'])assert.equal((await h.get(query)).status,400);
 assert.equal((await h.get('conversationId=conv1&messageId=photo1&photoIndex=2')).status,404);assert.equal(h.calls.length,0);
});
test('private stored photos use the authorized row storage path and freshly signed link',async()=>{
 const h=await setup({rows:[original({attachment_url:'/api/messages/photo1/media',platform_message_id:'telegram:123:8'})]});assert.equal((await h.get()).status,200);
 assert.deepEqual(Array.from(h.signed[0].paths),['b1/photo1/photo']);assert.match(h.calls[0].url,/project\.supabase\.co\/storage\/v1/);
});
test('client-supplied URL is ignored; untrusted stored URLs are not fetched',async()=>{
 const h=await setup();assert.equal((await h.get('conversationId=conv1&messageId=photo1&url=http://127.0.0.1/private')).status,200);assert.equal(h.calls[0].url,one);
 const evil=await setup({rows:[original({attachment_url:'http://169.254.169.254/latest/meta-data'})]});assert.equal((await evil.get()).status,404);assert.equal(evil.calls.length,0);
});
test('redirects to private or untrusted hosts are stopped before another fetch',async()=>{
 const h=await setup({fetch:async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1/secret'}})});
 assert.equal((await h.get()).status,404);assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.redirect,'manual');
});
test('corrupt bytes and non-image responses fail safely without exposing details',async()=>{
 for(const type of ['text/html','image/jpeg']){const h=await setup({fetch:async()=>new Response('<html>secret</html>',{headers:{'Content-Type':type}})});const res=await h.get();assert.equal(res.status,404);assert.doesNotMatch(await res.text(),/secret/);}
});
test('source allowlist blocks deceptive domains, credentials, custom ports and arbitrary Storage',()=>{
 const {allowedInboxImageUrl}=loader()('lib/media/inbox-image-source.ts');
 for(const url of ['http://scontent.fbcdn.net/x','https://fbcdn.net.evil.test/x','https://evilfbcdn.net/x','https://user:pass@scontent.fbcdn.net/x','https://scontent.fbcdn.net:8443/x','https://other.supabase.co/storage/v1/x','https://project.supabase.co/rest/v1/x','https://127.0.0.1/x'])assert.equal(allowedInboxImageUrl(url,'https://project.supabase.co'),null);
 assert.ok(allowedInboxImageUrl(one));assert.ok(allowedInboxImageUrl('https://lookaside.fbsbx.com/photo'));assert.ok(allowedInboxImageUrl('https://project.supabase.co/storage/v1/x','https://project.supabase.co'));
});
test('stream limits are enforced even when Content-Length is missing or dishonest',async()=>{
 const {readBoundedImage}=loader({}, {Uint8Array})('lib/media/inbox-image-source.ts');
 await assert.rejects(readBoundedImage(new Response(new Uint8Array(12),{headers:{'Content-Type':'image/png'}}),10),/too large/);
 await assert.rejects(readBoundedImage(new Response(new Uint8Array(2),{headers:{'Content-Type':'image/png','Content-Length':'30'}}),10),/too large/);
 assert.equal((await readBoundedImage(new Response(new Uint8Array(8),{headers:{'Content-Type':'image/png'}}),10)).byteLength,8);
});
