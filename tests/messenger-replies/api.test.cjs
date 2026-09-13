const test = require('node:test');
const assert = require('node:assert/strict');
const {loader, database, baseSeed} = require('../tenh-seven/harness.cjs');
const page='393342417206745', customer='100076611888104';
const original=()=>({id:'original',business_id:'b1',conversation_id:'conv1',platform_message_id:'m_original',direction:'incoming',message_type:'image',message_text:'Photo',attachment_url:'https://example.com/photo.jpg',sender_platform_id:customer,recipient_platform_id:page,raw_payload:{},platform_created_at:new Date().toISOString()});
function setup(options={}) {
 const seed=baseSeed();seed.facebook_sticker_sends=[];seed.messages=[{...original(),...options.target}];
 if(options.echo)seed.messages.push({id:'saved',business_id:'b1',conversation_id:'conv1',platform_message_id:'m_sent',direction:'outgoing',delivery_status:'seen',seen_at:'2026-09-13T06:00:00Z',raw_payload:{tenh_message_pin:{pinned:true}}});
 const db=database(seed),from=db.from;db.from=table=>{const query=from(table),insert=query.insert;query.insert=function(value){return insert.call(this,table==='messages'?{id:'saved',...value}:value)};return query;};
 db.storage={from:()=>({upload:async()=>({error:null})})};
 const calls=[];let refreshes=0;
 const load=loader({
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/inbox/get-inbox-resource-access':{getInboxConversationAccess:async()=>options.denied?{success:false,status:403,error:'Denied'}:{success:true,businessId:'b1',member:{id:'agent',business_id:'b1'},conversation:seed.conversations[0]}},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>!options.readOnly,permissionDenied:message=>Response.json({success:false,error:message},{status:403})},
  '@/lib/facebook/customer-block':{facebookSendBlockReason:async()=>options.blocked?'Blocked':null},
  '@/lib/facebook/get-facebook-page-access-token':{getFacebookPageAccessToken:async()=>'fake-token',isFacebookAccessTokenError:e=>e?.code===190,refreshFacebookPageAccessToken:async()=>{refreshes++;return 'new-token'}},
  '@/lib/facebook/messenger-reply-policy':{getFacebookMessengerReplyPolicy:async()=>({windowState:options.windowState||'standard',latestIncomingCommentId:'post_comment'})},
  '@/lib/telegram/telegram-message-media':{TELEGRAM_MESSAGE_MEDIA_BUCKET:'test',telegramMessageMediaStoragePath:()=>'test/file',telegramMessageMediaUrl:()=>'/test/file'},
 },{FormData,File,fetch:async(url,init={})=>{
  const body=typeof init.body==='string'?JSON.parse(init.body):null;calls.push({url:String(url),body});
  if(String(url).includes('message_attachments'))return Response.json({attachment_id:'upload_'+calls.length});
  if(init.method!=='POST')return Response.json({attachments:{data:[]}});
  const response=options.responses?.shift()||{message_id:'m_sent',recipient_id:customer};return Response.json(response,{status:response.error?400:200});
 }});
 const request=(kind,changes={})=>{
  if(kind==='attachment') {const form=new FormData();form.set('conversationId','conv1');form.set('recipientId',customer);form.set('kind','image');form.set('replyToMessageId','original');form.set('file',new File(['photo'],'photo.png',{type:'image/png'}));form.append('additionalFiles',new File(['photo2'],'photo2.png',{type:'image/png'}));for(const [key,value]of Object.entries(changes))form.set(key,value);return {formData:async()=>form};}
  return new Request(`https://app.tenhchat.com/api/facebook/${kind==='text'?'send':'stickers/send'}`,{method:'POST',headers:{Origin:'https://app.tenhchat.com','Content-Type':'application/json'},body:JSON.stringify({conversationId:'conv1',recipientId:customer,message:'Hello',replyToMessageId:'original',stickerId:'842488328414943',requestId:'11111111-1111-4111-8111-111111111111',...changes})});
 };
 const send=(kind,changes)=>load(`app/api/facebook/${kind==='text'?'send':kind==='attachment'?'send-attachment':'stickers/send'}/route.ts`).POST(request(kind,changes));
 return {db,calls,load,send,refreshes:()=>refreshes};
}
for(const kind of ['text','attachment','sticker']) {
 test(`${kind} reply uses top-level native MID and preserves a fast read receipt`,async()=>{
  const h=setup({echo:true});const result=await h.send(kind);assert.equal(result.status,200);assert.equal((await result.json()).success,true);
  const sends=h.calls.filter(call=>call.body);assert.equal(sends.length,1);const body=sends[0].body;
  assert.deepEqual(body.reply_to,{mid:'m_original'});assert.equal(body.message.reply_to,undefined);assert.equal(body.messaging_type,'RESPONSE');assert.deepEqual(body.recipient,{id:customer});
  if(kind==='attachment')assert.equal(body.message.attachments.length,2);
  const saved=h.db.tables.messages.find(row=>row.id==='saved');assert.equal(saved.raw_payload.reply_to.mid,'m_original');assert.equal(saved.raw_payload.tenh_reply.scope,'facebook');assert.equal(saved.raw_payload.tenh_message_pin.pinned,true);assert.equal(saved.delivery_status,'seen');
 });
 for(const [name,options]of [['other conversation',{target:{conversation_id:'other'}}],['other workspace',{target:{business_id:'b2'}}],['deleted target',{target:{raw_payload:{tenh_deleted:{source:'tenh'}}}}],['comment target',{target:{raw_payload:{comment_id:'post_comment'}}}],['Telegram target',{target:{platform_message_id:'telegram:1:2'}}],['membership denied',{denied:true}],['read only',{readOnly:true}],['blocked customer',{blocked:true}]]) test(`${kind}: ${name} cannot send or upload`,async()=>{const h=setup(options);assert.ok((await h.send(kind)).status>=400);assert.equal(h.calls.length,0)});
 test(`${kind}: native quote cannot bypass the standard messaging window`,async()=>{const h=setup({windowState:'human_agent'});assert.equal((await h.send(kind)).status,409);assert.equal(h.calls.length,0)});
}
test('text may reply to an outgoing Page message',async()=>{const h=setup({target:{direction:'outgoing',sender_platform_id:page,recipient_platform_id:customer}});assert.equal((await h.send('text')).status,200);assert.equal(h.calls[0].body.reply_to.mid,'m_original')});
test('native reply survives token refresh and is never silently removed after a provider error',async()=>{
 const h=setup({responses:[{error:{code:190}},{message_id:'m_sent'}]});assert.equal((await h.send('text')).status,200);assert.equal(h.refreshes(),1);assert.ok(h.calls.every(call=>call.body.reply_to.mid==='m_original'));
 const rejected=setup({responses:[{error:{code:100,message:'Reply rejected'}}]});assert.ok((await rejected.send('text')).status>=400);assert.equal(rejected.calls.length,1);assert.equal(rejected.db.tables.messages.length,1);
});
test('completed sticker receipt cannot be reused with a different reply target',async()=>{
 const h=setup();assert.equal((await h.send('sticker')).status,200);assert.equal((await h.send('sticker',{replyToMessageId:''})).status,409);assert.equal(h.calls.length,1);
});
test('native quote survives a bare history echo and keeps its original snapshot',()=>{
 const h=setup(),{normalizeMessages}=h.load('lib/inbox/normalize-messages.ts');const row={...original(),raw_payload:{reply_to:{mid:'prior'},tenh_facebook_reply:{platformMessageId:'prior',conversationId:'conv1',text:'Original preview'}}};
 const result=normalizeMessages([{...row,raw_payload:{message:{text:'Hello'}}}],[row])[0];assert.equal(result.raw_payload.reply_to.mid,'prior');assert.equal(result.raw_payload.tenh_facebook_reply.text,'Original preview');
});
test('visible pack previews return one individual sticker and reuse the catalog cache',async()=>{
 const seed=baseSeed(),db=database(seed),calls=[];
 const load=loader({'@/lib/supabase/admin':{supabaseAdmin:db},'@/lib/inbox/get-inbox-resource-access':{getInboxConversationAccess:async()=>({success:true,businessId:'b1',member:{},conversation:seed.conversations[0]})}}, {process:{env:{FACEBOOK_APP_ID:'fake-app',FACEBOOK_APP_SECRET:'fake-secret'}},fetch:async(url)=>{calls.push(String(url));return Response.json({data:[{id:'11',name:'One',image_url:'https://example.com/one.png'},{id:'12',name:'Two',image_url:'https://example.com/two.png'}]})}});
 const route=load('app/api/facebook/stickers/previews/route.ts');const request=new Request('https://app.tenhchat.com/api/facebook/stickers/previews?conversationId=conv1&packIds=123,456');
 const body=await(await route.GET(request)).json();assert.equal(body.previews.length,2);assert.ok(body.previews.every(p=>p.sticker.stickerId==='11'));assert.ok(body.previews.every(p=>!p.stickers));
 await load('lib/stickers/meta-messenger-server.ts').listMetaStickers({},'123');assert.equal(calls.length,2);assert.ok(calls.every(url=>!url.includes('limit=')));
 assert.equal((await route.GET(new Request('https://app.tenhchat.com/api/facebook/stickers/previews?conversationId=conv1&packIds=bad'))).status,400);assert.equal(calls.length,2);
});
