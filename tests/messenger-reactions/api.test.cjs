const test = require('node:test');
const assert = require('node:assert/strict');
const {loader, database, baseSeed, clone} = require('../tenh-seven/harness.cjs');
const page = '393342417206745', customer = '100076611888104';
const row = () => ({id:'message1', business_id:'b1', conversation_id:'conv1', platform_message_id:'m_native_mid', direction:'incoming', message_type:'image', message_text:null, attachment_url:'https://example.com/photo.jpg', sender_platform_id:customer, recipient_platform_id:page, raw_payload:{tenh_message_pin:{pinned:true},message:{mid:'m_native_mid'}}, delivery_status:'seen'});
function setup(options={}) {
  const seed=baseSeed(); seed.facebook_sticker_sends=[]; seed.messages=[{...row(),...options.message}];
  if(options.noPage)seed.social_accounts=[];
  const db=database(seed), calls=[];
  let refreshes=0;
  const load=loader({
    '@/lib/supabase/admin':{supabaseAdmin:db},
    '@/lib/auth/require-permission':{memberHasPermission:async()=>!options.readOnly},
    '@/lib/inbox/get-inbox-resource-access':{getInboxConversationAccess:async()=>options.denied?{success:false,status:403,error:'Denied'}:{success:true,businessId:'b1',member:{id:'member1'},conversation:seed.conversations[0]}},
    '@/lib/facebook/messenger-reply-policy':{getFacebookMessengerReplyPolicy:async()=>({windowState:options.windowState||'standard'})},
    '@/lib/facebook/customer-block':{facebookSendBlockReason:async()=>options.blocked?'Blocked':null},
    '@/lib/facebook/get-facebook-page-access-token':{getFacebookPageAccessToken:async()=>'fake-page-token',refreshFacebookPageAccessToken:async()=>{refreshes++;return 'fake-new-token'},isFacebookAccessTokenError:e=>e?.code===190},
  },{process:{env:{FACEBOOK_APP_ID:'fake-app',FACEBOOK_APP_SECRET:'fake-secret',FACEBOOK_GRAPH_API_VERSION:'v26.0'}},fetch:async(url,init)=>{
    calls.push({url:String(url),init,body:init.body?JSON.parse(init.body):undefined});
    if(options.networkError)throw new Error('network');
    const data=options.responses?.shift()??{recipient_id:customer};
    return Response.json(data,{status:data.error?400:200});
  }});
  const request=(changes={},origin='https://app.tenhchat.com')=>new Request('https://app.tenhchat.com/api/facebook/messages/reaction',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({conversationId:'conv1',messageId:'message1',reaction:'❤️',...changes})});
  return {db,calls,load,request,refreshes:()=>refreshes,post:load('app/api/facebook/messages/reaction/route.ts').POST};
}

test('photo reaction sends native MID and emoji, preserving pins/read status', async()=>{
  const h=setup();const result=await h.post(h.request());assert.equal(result.status,200);assert.equal((await result.json()).success,true);
  assert.deepEqual(h.calls[0].body,{recipient:{id:customer},sender_action:'react',payload:{message_id:'m_native_mid',reaction:'❤️'}});
  assert.equal(h.calls[0].init.headers.Authorization,'Bearer fake-page-token');
  assert.equal(h.db.tables.messages[0].raw_payload.tenh_messenger_reactions.page.emoji,'❤️');
  assert.equal(h.db.tables.messages[0].raw_payload.tenh_message_pin.pinned,true);assert.equal(h.db.tables.messages[0].delivery_status,'seen');
});
test('unreact omits reaction from payload, then another emoji replaces it',async()=>{
  const h=setup();await h.post(h.request());await h.post(h.request({reaction:null}));
  assert.deepEqual(h.calls[1].body,{recipient:{id:customer},sender_action:'unreact',payload:{message_id:'m_native_mid'}});
  assert.equal(h.db.tables.messages[0].raw_payload.tenh_messenger_reactions.page.emoji,null);
  await h.post(h.request({reaction:'🎉'}));assert.equal(h.db.tables.messages[0].raw_payload.tenh_messenger_reactions.page.emoji,'🎉');
});
for(const [name,options,changes,status] of [
 ['membership denied',{denied:true},{},403],['view-only member',{readOnly:true},{},403],['blocked customer',{blocked:true},{},403],
 ['foreign message',{message:{conversation_id:'other'}},{},404],['foreign tenant',{message:{business_id:'other'}},{},404],
 ['different customer',{message:{sender_platform_id:'999'}},{},409],['disconnected Page',{noPage:true},{},409],
 ['comment',{message:{raw_payload:{comment_id:'comment1'}}},{},409],['deleted message',{message:{raw_payload:{tenh_deleted:{source:'tenh'}}}},{},409],
 ['invalid emoji',{}, {reaction:'hello'},400],['two emoji',{}, {reaction:'👍👍'},400],['missing action',{}, {reaction:undefined},400],
])test(`${name} cannot call Meta`,async()=>{const h=setup(options);assert.equal((await h.post(h.request(changes))).status,status);assert.equal(h.calls.length,0);});
test('foreign origin cannot call Meta',async()=>{const h=setup();assert.equal((await h.post(h.request({},'https://evil.example'))).status,403);assert.equal(h.calls.length,0);});
test('Graph rejection and unknown transport outcome never change stored reactions',async()=>{
 for(const options of [{responses:[{error:{code:100,error_subcode:2018311,message:'fake-page-token'}}]},{networkError:true},{responses:[{}]}]){
  const h=setup(options); const result=await h.post(h.request());assert.equal(result.status,502);assert.equal(h.calls.length,1);assert.equal(h.db.tables.messages[0].raw_payload.tenh_messenger_reactions,undefined);
  assert.ok(!(await result.text()).includes('fake-page-token'));
 }
});
test('expired token is refreshed once only after explicit rejection',async()=>{
 const h=setup({responses:[{error:{code:190}},{recipient_id:customer}]});assert.equal((await h.post(h.request())).status,200);assert.equal(h.refreshes(),1);assert.equal(h.calls.length,2);
});
test('database failure after Meta confirms returns success with synchronization warning',async()=>{
 const h=setup();h.db.failures.push({table:'messages',op:'update'});const result=await(await h.post(h.request())).json();assert.equal(result.success,true);assert.match(result.warning,/could not save/);assert.equal(h.calls.length,1);
});
test('catalog uses App token and documented root paths; shared cache avoids repeated calls',async()=>{
 const h=setup({responses:[{data:[{id:'840909108572865',name:'Catster',sticker_count:21,preview_image_url:'https://example.com/pack.png'}]},{data:[{id:'842488328414943',name:'Cat heart',image_url:'https://example.com/sticker.png'}]},{data:[]}]});
 const catalog=h.load('lib/stickers/meta-messenger-server.ts'); const scope=await catalog.metaStickerConversation('conv1');
 const packs=await catalog.listMetaStickerPacks(scope);await catalog.listMetaStickerPacks(scope);
 const stickers=await catalog.listMetaStickers(scope,'840909108572865');await catalog.searchMetaStickers(scope,'love');
 assert.equal(h.calls.length,3);assert.equal(new URL(h.calls[0].url).pathname,'/v26.0/sticker_packs');
 assert.equal(new URL(h.calls[1].url).pathname,'/v26.0/sticker_packs/840909108572865/stickers');
 assert.equal(new URL(h.calls[2].url).pathname,'/v26.0/sticker_search');assert.equal(new URL(h.calls[2].url).searchParams.get('q'),'love');
 assert.ok(h.calls.every(call=>call.init.headers.Authorization==='Bearer fake-app|fake-secret'));
 assert.equal(packs.packs[0].previewUrl,'https://example.com/pack.png');assert.equal(stickers.stickers[0].previewUrl,'https://example.com/sticker.png');
 await assert.rejects(catalog.listMetaStickers(scope,'../bad'));assert.equal(h.calls.length,3);
});
test('native sticker webhook type and transitional image order both render as sticker',()=>{
 const h=setup(), get=h.load('lib/facebook/get-message-content.ts').getFacebookMessageContent;
 for(const attachments of [[{type:'sticker',payload:{sticker_id:'123',url:'https://example.com/sticker.png'}}],[{type:'image',payload:{url:'https://example.com/image.png'}},{type:'sticker',payload:{sticker_id:'123',url:'https://example.com/sticker.png'}}]]){
  const result=get({message:{attachments}});assert.equal(result.messageType,'sticker');assert.equal(result.attachmentUrl,'https://example.com/sticker.png');
 }
 assert.equal(get({message:{attachments:[{type:'image',payload:{url:'https://example.com/photo.png'}}]}}).messageType,'image');
});
test('customer and Page reactions coexist, unreact tombstone rejects delayed webhook',async()=>{
 const h=setup(), processEvent=h.load('lib/facebook/process-message-reaction.ts').processFacebookMessageReaction;
 const event=(timestamp,action,emoji='❤️')=>({sender:{id:customer},recipient:{id:page},timestamp,reaction:{mid:'m_native_mid',action,emoji}});
 await h.post(h.request());await processEvent(event(1000,'react'),page);await processEvent(event(3000,'unreact'),page);await processEvent(event(2000,'react'),page);
 const data=h.db.tables.messages[0];assert.equal(data.raw_payload.tenh_messenger_reactions.page.emoji,'❤️');assert.equal(data.raw_payload.tenh_messenger_reactions.customer.emoji,null);assert.equal(data.raw_payload.tenh_messenger_reactions.customer.timestamp,3000);assert.equal(data.delivery_status,'seen');assert.equal(data.raw_payload.tenh_message_pin.pinned,true);
 const before=clone(data);await processEvent({...event(4000,'react'),sender:{id:'other-customer'}},page);assert.deepEqual(h.db.tables.messages[0],before);
});
test('emoji validator supports flags and families while rejecting text',()=>{
 const {isMessengerReactionEmoji}=setup().load('lib/facebook/message-reactions.ts');
 for(const emoji of ['🇰🇭','👨‍👩‍👧‍👦','👍🏽','1️⃣','❤️','🎉'])assert.equal(isMessengerReactionEmoji(emoji),true,emoji);
 for(const value of ['hello','❤️hello','<img>','123',' ❤️','❤️❤️',{},null])assert.equal(isMessengerReactionEmoji(value),false,String(value));
});
test('history merge keeps newer reaction removal and a separate customer reaction',()=>{
 const h=setup(),{normalizeMessages}=h.load('lib/inbox/normalize-messages.ts');
 const previous={...row(),raw_payload:{tenh_messenger_reactions:{page:{emoji:null,timestamp:3000},customer:{emoji:'🎉',timestamp:2500}}}};
 const stale={...row(),raw_payload:{tenh_messenger_reactions:{page:{emoji:'❤️',timestamp:2000}}}};
 const merged=normalizeMessages([stale],[previous])[0];
 assert.equal(merged.raw_payload.tenh_messenger_reactions.page.emoji,null);assert.equal(merged.raw_payload.tenh_messenger_reactions.customer.emoji,'🎉');
});
test('catalog failure does not expose app secrets and can be retried',async()=>{
 const h=setup({responses:[{error:{code:190,message:'fake-app|fake-secret'}},{data:[]}]});const catalog=h.load('lib/stickers/meta-messenger-server.ts');
 await assert.rejects(catalog.listMetaStickerPacks({}),error=>!`${error.message} ${error.details}`.includes('fake-secret'));
 assert.equal((await catalog.listMetaStickerPacks({})).packs.length,0);assert.equal(h.calls.length,2);
});

const stickerRequest = () => new Request('https://app.tenhchat.com/api/facebook/stickers/send',{method:'POST',headers:{Origin:'https://app.tenhchat.com','Content-Type':'application/json'},body:JSON.stringify({conversationId:'conv1',requestId:'11111111-1111-4111-8111-111111111111',stickerId:'842488328414943',previewUrl:'https://example.com/sticker.png'})});
test('native sticker send uses Page token and receipt prevents duplicate sends',async()=>{
 const h=setup({responses:[{message_id:'m_sticker_new',recipient_id:customer}]});const send=h.load('app/api/facebook/stickers/send/route.ts').POST;
 const first=await(await send(stickerRequest())).json();assert.equal(first.success,true);assert.equal(first.delivery,'native_sticker');
 assert.deepEqual(h.calls[0].body,{recipient:{id:customer},messaging_type:'RESPONSE',message:{sticker_id:'842488328414943'}});
 assert.equal(new URL(h.calls[0].url).searchParams.get('access_token'),'fake-page-token');
 assert.equal((await(await send(stickerRequest())).json()).success,true);assert.equal(h.calls.length,1);
});
for(const windowState of ['human_agent','private_reply_available','waiting_for_customer_reply'])test(`native stickers respect the standard window: ${windowState}`,async()=>{
 const h=setup({windowState});const send=h.load('app/api/facebook/stickers/send/route.ts').POST;const result=await send(stickerRequest());assert.equal(result.status,409);assert.equal(h.calls.length,0);
});
