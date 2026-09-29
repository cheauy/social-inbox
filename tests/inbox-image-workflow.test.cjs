const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loader, ROOT, database } = require('./tenh-seven/harness.cjs');
const load = loader({}, { URLSearchParams, Uint8Array });
const actions = load('lib/inbox/message-actions.ts');
const { stableConversationOrder } = load('lib/inbox/stable-conversation-order.ts');
const row = (id, patch = {}) => ({ id, business_id: 'b1', is_pinned: false, last_message_at: id, ...patch });
const msg = (patch = {}) => ({ id: 'original', business_id: 'b1', conversation_id: 'conv1', platform_message_id: 'mid_original', direction: 'incoming', message_type: 'image', message_text: '[image]', attachment_url: 'https://scontent.fbcdn.net/one.jpg', raw_payload: {}, ...patch });
const album = (patch = {}) => msg({ raw_payload: { message: { attachments: [
  { type: 'image', payload: { url: 'https://scontent.fbcdn.net/one.jpg' } },
  { type: 'image', payload: { url: 'https://scontent.fbcdn.net/two.jpg' } },
  { type: 'image', payload: { url: 'https://scontent.fbcdn.net/three.jpg' } },
] } }, ...patch });
const ids = rows => Array.from(rows, item => item.id);

test('received/sent activity and reverse-sorted server refreshes update rows without moving them', () => {
  const before = [row('a'), row('b'), row('c')];
  const updated = [row('c', { last_message_at: '2099', unread_count: 8 }), row('b'), row('a')];
  const result = stableConversationOrder(before, updated);
  assert.deepEqual(ids(result), ['a', 'b', 'c']); assert.equal(result[2].unread_count, 8); assert.equal(result[2].last_message_at, '2099');
  assert.deepEqual(ids(before), ['a', 'b', 'c']); assert.deepEqual(ids(updated), ['c', 'b', 'a']);
});
test('new conversations append instead of moving the reader; removed rows stay removed', () => {
  assert.deepEqual(ids(stableConversationOrder([row('a'),row('b')], [row('new'),row('b')])), ['b','new']);
});
test('explicit pin and unpin remain supported', () => {
  const pinned = stableConversationOrder([row('a'),row('b')], [row('a'),row('b',{is_pinned:true})]);
  assert.deepEqual(ids(pinned), ['b','a']);
  const unpinned = stableConversationOrder(pinned,[row('b'),row('a')]);assert.deepEqual(ids(unpinned),['b','a']);
});
test('workspace identities are independent and duplicate refresh entries collapse', () => {
  const result = stableConversationOrder([row('a'),row('b')], [row('b',{business_id:'b2'}),row('a',{business_id:'b2'}),row('a',{business_id:'b2',unread_count:2})]);
  assert.deepEqual(ids(result),['b','a']); assert.equal(result[1].unread_count,2);
});
test('all live conversation writes pass through the stable state setter', () => {
  const source=fs.readFileSync(path.join(ROOT,'components/inbox/inbox-view.tsx'),'utf8');
  assert.equal((source.match(/setRawLiveConversations\(/g)||[]).length,1);
  assert.match(source,/const ordered = stableConversationOrder\(current, next\)/);
  const fn=source.slice(source.indexOf('function updateConversationPreviewOptimistically'), source.indexOf('async function resolveConversationPlatform'));
  assert.doesNotMatch(fn,/\.sort\(/);
});
test('each native album photo has its own UI selection, but the true provider MID is unchanged', () => {
  const photos=actions.expandAlbumPhotos(album()); assert.equal(photos.length,3);
  assert.deepEqual(ids(photos),['original:photo:0','original:photo:1','original:photo:2']);
  assert.ok(photos.every(photo=>photo.platform_message_id==='mid_original'));
  assert.equal(photos[1].attachment_url,'https://scontent.fbcdn.net/two.jpg');
});
test('a selected photo resolves only under its own conversation', () => {
  const selected=actions.resolvePhotoReplyTarget([album()], 'original:photo:1', 'conv1');
  assert.equal(actions.getMessageImageUrl(selected),'https://scontent.fbcdn.net/two.jpg');
  assert.equal(actions.resolvePhotoReplyTarget([album()], 'original:photo:1', 'foreign'),null);
  for (const id of ['original:photo:50','original:photo:-1','original:photo:NaN','original:photo:999999999999999999999']) assert.equal(actions.resolvePhotoReplyTarget([album()],id,'conv1'),null);
});
test('deleted albums expose no photos or reply image data', () => {
  const deleted=album({raw_payload:{...album().raw_payload,tenh_deleted:{source:'customer'}}});
  assert.equal(actions.expandAlbumPhotos(deleted).length,0);assert.equal(actions.getMessageImageUrl(deleted),null);
});
test('saved selected-photo replies use a database ID and retain the precise image index', () => {
  const context=actions.createReplyContext(actions.expandAlbumPhotos(album())[2],'facebook');
  assert.equal(context.reply_to_local_message_id,'original');assert.equal(context.reply_to_platform_message_id,'mid_original');
  assert.equal(context.preview_image_index,2);assert.equal(context.preview_image_url,'https://scontent.fbcdn.net/three.jpg');assert.equal(context.preview_text,'Photo');
});
test('Telegram album photos remain separate real native reply targets', () => {
  const photos=[msg({id:'tg1',platform_message_id:'telegram:123:10'}),msg({id:'tg2',platform_message_id:'telegram:123:11'})];
  const target=actions.resolvePhotoReplyTarget(photos,'tg1','conv1'); const context=actions.createReplyContext(target,'telegram');
  assert.equal(context.reply_to_platform_message_id,'telegram:123:10');assert.equal(context.reply_to_local_message_id,'tg1');
});
test('image placeholders become Photo labels but genuine captions are unchanged', () => {
  for(const label of ['[image]','[photo]',''])assert.equal(actions.getMessageSummary(msg({message_text:label})),'Photo');
  assert.equal(actions.getMessageSummary(msg({message_text:'New blue dress'})),'New blue dress');
  assert.equal(actions.getMessageSummary(msg({message_type:'text',message_text:'[image]'})),'[image]');
});
test('sent reply thumbnails use the selected album image before and after history reload', () => {
  const context=actions.createReplyContext(actions.expandAlbumPhotos(album())[1],'facebook');
  const reply=msg({id:'reply',platform_message_id:'mid_reply',message_type:'text',raw_payload:{reply_to:{mid:'mid_original'},tenh_reply:context}});
  const loaded=actions.getReplyImageReference(reply,[album()]);assert.equal(loaded.url,'https://scontent.fbcdn.net/two.jpg');assert.equal(loaded.photoIndex,1);
  const offscreen=actions.getReplyImageReference(reply,[]);assert.equal(offscreen.url,null);assert.equal(offscreen.messageId,'original');
  const url=new URL(actions.inboxImageEndpoint(offscreen,true),'https://app.tenhchat.com');assert.equal(url.searchParams.get('photoIndex'),'1');assert.equal(url.searchParams.get('thumbnail'),'1');
});
test('Telegram native photo quotes can fetch thumbnails when the parent is outside the loaded page', () => {
  const reply=msg({id:'reply',platform_message_id:'telegram:123:20',message_type:'text',raw_payload:{message:{reply_to_message:{message_id:10,photo:[{file_id:'file'}]}}}});
  const result=actions.getReplyImageReference(reply,[]);assert.equal(result.platformMessageId,'telegram:123:10');assert.equal(result.url,null);
});
test('captured Facebook photo type allows an off-page thumbnail without trusting a saved URL', () => {
  const reply=msg({id:'reply',platform_message_id:'mid_reply',message_type:'text',raw_payload:{reply_to:{mid:'mid_original'},tenh_facebook_reply:{platformMessageId:'mid_original',conversationId:'conv1',messageType:'image'}}});
  const result=actions.getReplyImageReference(reply,[]);assert.equal(result.platformMessageId,'mid_original');assert.equal(result.url,null);
});
test('quotes do not leak another conversation, show deleted photos, or invent failed Telegram quotes', () => {
  const reply=msg({id:'reply',platform_message_id:'mid_reply',message_type:'text',raw_payload:{reply_to:{mid:'mid_original'}}});
  assert.equal(actions.getReplyImageReference(reply,[album({conversation_id:'other'})]),null);
  assert.equal(actions.getReplyImageReference(reply,[msg({raw_payload:{tenh_deleted:{}}})]),null);
  assert.equal(actions.getReplyImageReference({...reply,raw_payload:{tenh_reply_fallback:{reason:'missing'},tenh_reply:{preview_type:'image',reply_to_local_message_id:'original'}}},[]),null);
});
test('ordinary text quotes do not trigger image requests', () => {
  assert.equal(actions.getReplyImageReference(msg({id:'reply',platform_message_id:'mid_reply',message_type:'text',raw_payload:{reply_to:{mid:'mid_original'}}}),[msg({message_type:'text',message_text:'Hi',attachment_url:null})]),null);
});
test('copy/thumbnail URLs carry selected message references, never remote source URLs', () => {
  const url=new URL(actions.inboxImageEndpoint({conversationId:'conv1',messageId:'original:photo:2',url:'https://bad.example/evil'},true),'https://app.tenhchat.com');
  assert.equal(url.searchParams.get('messageId'),'original');assert.equal(url.searchParams.get('photoIndex'),'2');assert.equal(url.searchParams.has('url'),false);
});
test('image paste uses clipboard items only once and preserves files fallback', () => {
  const {clipboardImageFiles}=load('lib/inbox/image-clipboard.ts'); const png=new File(['image'],'image.png',{type:'image/png'}),text=new File(['txt'],'x.txt',{type:'text/plain'});
  const item={kind:'file',getAsFile:()=>png};assert.equal(clipboardImageFiles({items:[item],files:[png]}).length,1);
  assert.equal(clipboardImageFiles({items:[],files:[text,png]})[0],png);
  assert.equal(clipboardImageFiles({items:[{kind:'string',getAsFile:()=>null}],files:[]}).length,0);
});
test('clipboard write starts synchronously and receives a promise containing PNG bytes', async () => {
  const png=new Blob(['png'],{type:'image/png'});let writeCalled=false,finish;
  const fetching=new Promise(resolve=>finish=resolve);
  class Item{constructor(data){this.data=data;}}
  const l=loader({}, {URLSearchParams,Blob,ClipboardItem:Item,navigator:{clipboard:{write(items){writeCalled=true;return items[0].data['image/png'].then(blob=>assert.equal(blob,png));}}},fetch:()=>fetching});
  const copying=l('lib/inbox/image-clipboard.ts').copyInboxImage('https://cdn.example/photo');assert.equal(writeCalled,true);
  finish({ok:true,blob:async()=>png});await copying;
});
test('clipboard CORS failure uses the authorized message-image endpoint', async () => {
  const urls=[];const png=new Blob(['png'],{type:'image/png'});
  class Item{constructor(data){this.data=data;}}
  const l=loader({}, {URLSearchParams,Blob,ClipboardItem:Item,navigator:{clipboard:{write:items=>items[0].data['image/png']}},fetch:async url=>{urls.push(url);if(urls.length===1)throw new Error('CORS');return {ok:true,blob:async()=>png};}});
  await l('lib/inbox/image-clipboard.ts').copyInboxImage('https://scontent.fbcdn.net/photo',{conversationId:'conv1',messageId:'original:photo:1'});
  assert.equal(urls.length,2);assert.match(urls[1],/\/api\/inbox\/message-image\?/);assert.match(urls[1],/photoIndex=1/);
});
test('unsupported clipboard browsers fail honestly without silently copying a URL', async () => {
  let fetched=false;const l=loader({}, {navigator:{},fetch:()=>{fetched=true;}});
  await assert.rejects(l('lib/inbox/image-clipboard.ts').copyInboxImage('/image'),/supported browser/);assert.equal(fetched,false);
});
test('server rejects invented, cross-conversation, cross-workspace and out-of-bounds album selections', async () => {
  const db=database({messages:[album()]});const l=loader({'@/lib/supabase/admin':{supabaseAdmin:db}},{URLSearchParams});
  const {getFacebookSendReply}=l('lib/facebook/send-reply-context.ts');
  for(const [id,b,c] of [['original:photo:3','b1','conv1'],['original:photo:-1','b1','conv1'],['original:photo:999999999999999999999','b1','conv1'],['original:photo:1','other','conv1'],['original:photo:1','b1','other']])await assert.rejects(getFacebookSendReply(id,b,c));
  const result=await getFacebookSendReply('original:photo:1','b1','conv1');
  assert.equal(result.reply_to.mid,'mid_original');assert.equal(result.tenh_reply.preview_image_index,1);assert.equal(result.tenh_reply.preview_image_url,'https://scontent.fbcdn.net/two.jpg');
});
test('photo reference survives bare Messenger echo normalization', () => {
  const {normalizeMessages}=load('lib/inbox/normalize-messages.ts');const context=actions.createReplyContext(actions.expandAlbumPhotos(album())[1],'facebook');
  const prior=msg({id:'reply',platform_message_id:'mid_reply',raw_payload:{reply_to:{mid:'mid_original'},tenh_reply:context}});
  const result=normalizeMessages([{...prior,raw_payload:{message:{text:'Reply'}}}],[prior])[0];
  assert.equal(result.raw_payload.tenh_reply.preview_image_index,1);assert.equal(result.raw_payload.tenh_reply.preview_image_url,context.preview_image_url);
});
