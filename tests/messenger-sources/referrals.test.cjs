const test = require('node:test');
const assert = require('node:assert/strict');
const {createHmac} = require('node:crypto');
const {loader, database, baseSeed, clone} = require('../tenh-seven/harness.cjs');
const page = '393342417206745', customer = '100076611888104';
const timestamp = Date.parse('2026-09-13T10:00:00.000Z');
const referral = () => ({source:'ADS',type:'OPEN_THREAD',ad_id:'120211222333444',ads_context_data:{post_id:page+'_444555',ad_title:'Autumn collection',photo_url:'https://example.com/source.jpg'}});
const event = (patch={}) => ({sender:{id:customer},recipient:{id:page},timestamp,referral:referral(),...patch});
const pure = loader()('lib/facebook/messenger-source.ts');

function setup(seed=baseSeed()) {
  seed.conversations.forEach(c=>{c.facebook_messenger_sources??=[];c.unread_count??=3;c.status??='resolved';c.last_message_text??='Existing message';});
  const db=database(seed), from=db.from;
  let nextId=0;
  db.from=table=>{
    const q=from(table), eq=q.eq, upsert=q.upsert, insert=q.insert;
    q.eq=function(k,v){if(k==='facebook_messenger_sources'){this.filters.push(row=>JSON.stringify(row[k])===v);return this;}return eq.call(this,k,v)};
    q.upsert=function(body,options){return upsert.call(this,{id:'new-'+(++nextId),...body},options)};
    q.insert=function(body){return insert.call(this,{id:'new-'+(++nextId),...body})};
    return q;
  };
  const calls=[];
  const load=loader({
    '@/lib/supabase/admin':{supabaseAdmin:db},
    '@/lib/facebook/process-message':{processFacebookMessage:async e=>calls.push(['message',e])},
    '@/lib/facebook/process-message-reaction':{processFacebookMessageReaction:async e=>calls.push(['reaction',e])},
    '@/lib/facebook/process-message-status':{processFacebookMessageStatus:async e=>calls.push(['status',e])},
    '@/lib/facebook/process-comment':{processFacebookComment:async e=>calls.push(['comment',e])},
    '@/lib/facebook/mark-comment-thread-deleted':{markFacebookCommentThreadDeleted:async()=>{}},
  },{Buffer,process:{env:{FACEBOOK_APP_SECRET:'test-secret'}},fetch:async()=>{throw Error('Referral context must not request Graph or send messages');}});
  const process=load('lib/facebook/process-messenger-referral.ts').processFacebookMessengerReferral;
  return {db,load,process,calls};
}

test('message, standalone and postback referrals expose exact IDs and the supplied photo',()=>{
  for(const input of [event(),event({referral:undefined,message:{mid:'m_source',text:'Hello',referral:referral()}}),event({referral:undefined,postback:{mid:'p_source',referral:referral()}})]){
    const source=pure.messengerSourceFromEvent(input);
    assert.equal(source.ad_id,'120211222333444');assert.equal(source.post_id,page+'_444555');
    assert.equal(source.image_url,'https://example.com/source.jpg');assert.equal(source.title,'Autumn collection');
    assert.equal(source.post_url,`https://www.facebook.com/${page}/posts/444555`);
    assert.equal(source.occurred_at,'2026-09-13T10:00:00.000Z');
  }
});
test('video_url is a thumbnail and string postback timestamps are supported',()=>{
  const r=referral();delete r.ads_context_data.photo_url;r.ads_context_data.video_url='https://example.com/video-thumbnail.jpg';
  const source=pure.messengerSourceFromEvent(event({timestamp:String(timestamp/1000),referral:r}));
  assert.equal(source.image_url,r.ads_context_data.video_url);assert.equal(source.occurred_at,'2026-09-13T10:00:00.000Z');
});
test('ordinary messages, user_ref, arbitrary m.me refs and echoes never become guessed post/ad context',()=>{
  for(const input of [event({referral:undefined,message:{mid:'m_plain',text:'hello'}}),event({referral:{source:'SHORTLINK',ref:'post_123'}}),event({referral:{product:{id:'111'}}}),event({message:{is_echo:true}})])assert.equal(pure.messengerSourceFromEvent(input),null);
});
test('unsafe media/link schemes and imprecise numeric IDs are excluded',()=>{
  for(const url of ['javascript:alert(1)','data:image/svg+xml,hello','http://example.com/image','https://u:p@example.com/image'])assert.equal(pure.messengerSourceImageUrl(url),null);
  const r=referral();r.ad_id=120211222333444;r.ads_context_data.post_id='../other';r.ads_context_data.photo_url='javascript:alert(1)';
  const source=pure.messengerSourceFromEvent(event({referral:r}));assert.equal(source.ad_id,null);assert.equal(source.post_id,null);assert.equal(source.image_url,null);
  const saved=pure.readMessengerSources([{...pure.messengerSourceFromEvent(event()),post_url:'https://evil.example/post',image_url:'javascript:x'}])[0];assert.equal(saved.post_url,null);assert.equal(saved.image_url,null);
});
test('missing photo retains the available IDs without substituting the customer photo',()=>{
  const r=referral();delete r.ads_context_data.photo_url;
  const source=pure.messengerSourceFromEvent(event({referral:r}));assert.equal(source.image_url,null);assert.equal(source.ad_id,r.ad_id);assert.equal(source.post_id,r.ads_context_data.post_id);
});

test('normal post metadata is persisted once and reused without calling Graph',async()=>{
  const h=setup();
  const r=referral();delete r.ad_id;r.source='POST';
  r.post_id=r.ads_context_data.post_id;delete r.ads_context_data.post_id;
  const postEvent=event({referral:undefined,message:{mid:'m_post',text:'Post question',referral:r}});
  await h.process(postEvent,page);
  const writes=h.db.history.filter(x=>x.table==='conversations'&&x.op==='update').length;
  await h.process(postEvent,page);
  assert.equal(h.db.history.filter(x=>x.table==='conversations'&&x.op==='update').length,writes);
  const saved=h.db.tables.conversations[0].facebook_messenger_sources;
  assert.equal(saved[0].kind,'post');assert.equal(saved[0].ad_id,null);
  const row={id:'message1',platform_message_id:'m_post',direction:'incoming',created_at:new Date(timestamp).toISOString(),raw_payload:{}};
  const card=pure.messengerSourceTimeline(saved,[row]).before.get(row.id)[0];
  assert.equal(card.image_url,r.ads_context_data.photo_url);assert.equal(card.post_id,r.post_id);
});

test('a shared Facebook link and a post-looking message never become origin attribution',()=>{
  for (const raw of [
    {message:{mid:'m_direct',text:'Post ID 123456'}},
    {message:{mid:'m_direct',attachments:[{type:'share',payload:{url:'https://www.facebook.com/123456/posts/777777'}}]}},
  ]) assert.equal(pure.messengerSourceFromEvent(raw),null);
});

test('partial incoming payloads may use their exact row mid, but outgoing rows cannot gain cards',()=>{
  const row={id:'row1',platform_message_id:'m_partial',direction:'incoming',created_at:new Date(timestamp).toISOString(),raw_payload:{message:{referral:referral()}}};
  const timeline=pure.messengerSourceTimeline([],[row]);
  assert.equal(timeline.before.get('row1')[0].message_id,'m_partial');
  assert.equal(pure.messengerSourceTimeline([],[{...row,direction:'outgoing'}]).before.size,0);
});
test('repeat event is idempotent even when PostgreSQL returns JSON object keys in another order',async()=>{
  const h=setup();const before=clone(h.db.tables.conversations[0]);
  await h.process(event(),page);
  const row=h.db.tables.conversations[0];assert.equal(row.facebook_messenger_sources.length,1);
  const writes=h.db.history.filter(x=>x.table==='conversations'&&x.op==='update').length;
  row.facebook_messenger_sources[0]=Object.fromEntries(Object.entries(row.facebook_messenger_sources[0]).reverse());
  await h.process(event(),page);
  assert.equal(h.db.history.filter(x=>x.table==='conversations'&&x.op==='update').length,writes);
  assert.deepEqual({...row,facebook_messenger_sources:[]},before);
  assert.equal(h.db.tables.messages.length,0);assert.equal(h.db.tables.conversation_activity.length,0);
});
test('same customer across Pages is scoped to the connected recipient Page and workspace',async()=>{
  const seed=baseSeed();seed.social_accounts.push({id:'s2',business_id:'b2',platform:'facebook',platform_account_id:'777777',is_active:true});
  seed.contacts.push({id:'c2',business_id:'b2',platform:'facebook',platform_user_id:customer});
  seed.conversations.push({id:'conv2',business_id:'b2',social_account_id:'s2',contact_id:'c2'});
  const h=setup(seed);await h.process(event(),page);
  assert.equal(h.db.tables.conversations[0].facebook_messenger_sources.length,1);assert.equal(h.db.tables.conversations[1].facebook_messenger_sources.length,0);
});
for(const [name,change,entry] of [
  ['mismatched entry Page',{},'777777'],['missing entry Page',{},undefined],
  ['Page echo',{message:{is_echo:true}},page],['user_ref without a PSID',{sender:{user_ref:'anonymous-ref'}},page],
  ['Page as customer',{sender:{id:page}},page],['unknown Page',{recipient:{id:'777777'}},'777777'],
])test(`${name} cannot create referral state`,async()=>{
  const h=setup();await h.process(event(change),entry);assert.equal(h.db.history.some(x=>x.op!=='read'),false);
});
test('disconnected Pages and blocked customers do not update conversation sources',async()=>{
  const h=setup();h.db.tables.social_accounts[0].is_active=false;await h.process(event(),page);assert.equal(h.db.tables.conversations[0].facebook_messenger_sources.length,0);
  h.db.tables.social_accounts[0].is_active=true;h.db.tables.facebook_customer_blocks.push({business_id:'b1',social_account_id:'s1',contact_id:'c1',is_blocked:true});
  await h.process(event(),page);assert.equal(h.db.tables.conversations[0].facebook_messenger_sources.length,0);
});
test('a referral can precede the first real message without unread/preview or synthetic messages',async()=>{
  const seed=baseSeed();seed.contacts=[];seed.conversations=[];const h=setup(seed);await h.process(event(),page);
  const row=h.db.tables.conversations[0];assert.equal(row.facebook_messenger_sources.length,1);assert.equal(row.unread_count,0);assert.equal(row.last_message_at,undefined);assert.equal(row.last_message_text,undefined);assert.equal(h.db.tables.messages.length,0);
});
test('a concurrent referral update is merged instead of overwritten',async()=>{
  const h=setup(),from=h.db.from;let raced=false;
  h.db.from=table=>{const q=from(table),execute=q.execute;q.execute=async function(){
    if(table==='conversations'&&this.op==='update'&&!raced){raced=true;h.db.tables.conversations[0].facebook_messenger_sources=[clone(pure.messengerSourceFromEvent(event({timestamp:timestamp-1000})))];return {data:null,error:null};}
    return execute.call(this);
  };return q;};
  await h.process(event(),page);assert.equal(h.db.tables.conversations[0].facebook_messenger_sources.length,2);
});
test('out-of-order events keep the latest 20 contexts; a duplicate cannot erase its photo',()=>{
  const sources=Array.from({length:25},(_,i)=>pure.messengerSourceFromEvent(event({timestamp:timestamp+i*1000})));
  const saved=pure.mergeMessengerSources([],sources.reverse());assert.equal(saved.length,20);assert.equal(saved[0].occurred_at,new Date(timestamp+5000).toISOString());
  const last=saved.at(-1);assert.equal(pure.mergeMessengerSources(saved,[{...last,image_url:null}]).at(-1).image_url,last.image_url);
});
test('timeline deduplicates message context, hides standalone opens and preserves older loaded referrals',()=>{
  const embedded=event({referral:undefined,message:{mid:'m_source',referral:referral()}});
  const row={id:'message1',platform_message_id:'m_source',direction:'incoming',created_at:new Date(timestamp).toISOString(),raw_payload:embedded};
  const timeline=pure.messengerSourceTimeline([pure.messengerSourceFromEvent(embedded)],[row]);assert.equal(timeline.before.get('message1').length,1);assert.equal(timeline.after.length,0);
  const later=pure.messengerSourceFromEvent(event({timestamp:timestamp+5000}));assert.equal(pure.messengerSourceTimeline([later],[row]).after.length,0);
  const earliest=pure.messengerSourceFromEvent(event({timestamp:timestamp-5000}));assert.equal(pure.messengerSourceTimeline([earliest],[{...row,raw_payload:{}}]).before.size,0);
  const history=Array.from({length:25},(_,i)=>({...row,id:`m${i}`,raw_payload:{...embedded,timestamp:timestamp+i*1000,message:{...embedded.message,mid:`mid${i}`}},platform_message_id:`mid${i}`,created_at:new Date(timestamp+i*1000).toISOString()}));
  assert.equal(pure.messengerSourceTimeline([],history).before.size,25);
});
test('signed webhook handles both envelopes and preserves delivery/read/reaction/feed dispatch',async()=>{
  const seed=baseSeed();seed.webhook_events=[];const h=setup(seed),post=h.load('app/api/webhooks/facebook/route.ts').POST;
  const payload={object:'page',entry:[{id:page,messaging:[event({referral:undefined,message:{mid:'m_source',referral:referral()}}),{delivery:{mids:['m1']}},{read:{watermark:1}},{reaction:{mid:'m1'}}],changes:[{field:'messaging_referrals',value:event({timestamp:timestamp+1000})},{field:'messaging_postbacks',value:event({timestamp:timestamp+2000,referral:undefined,postback:{referral:referral()}})},{field:'feed',value:{item:'comment',verb:'add',comment_id:'123_456',post_id:'123_789'}}]}]};
  const body=JSON.stringify(payload),signature='sha256='+createHmac('sha256','test-secret').update(body).digest('hex');
  const request=sig=>new Request('https://app.tenhchat.com/api/webhooks/facebook',{method:'POST',body,headers:{'x-hub-signature-256':sig}});
  assert.equal((await post(request('invalid'))).status,401);assert.equal(h.db.history.length,0);
  assert.equal((await post(request(signature))).status,200);
  assert.equal(h.db.tables.conversations[0].facebook_messenger_sources.length,3);
  assert.deepEqual(h.calls.map(x=>x[0]),['message','status','status','reaction','comment']);
});
test('database failure retains original webhook payload and does not prevent the next event',async()=>{
  const seed=baseSeed();seed.webhook_events=[];const h=setup(seed);h.db.failures.push({table:'conversations',op:'update',once:true});
  const payload={object:'page',entry:[{id:page,messaging:[event(),event({timestamp:timestamp+1000})]}]};
  const body=JSON.stringify(payload),signature='sha256='+createHmac('sha256','test-secret').update(body).digest('hex');
  const result=await h.load('app/api/webhooks/facebook/route.ts').POST(new Request('https://app.tenhchat.com/api/webhooks/facebook',{method:'POST',body,headers:{'x-hub-signature-256':signature}}));
  assert.equal(result.status,200);assert.equal(h.db.tables.conversations[0].facebook_messenger_sources.length,1);assert.deepEqual(h.db.tables.webhook_events[0].payload,payload);
});

test('a bare history response keeps the original message referral and its timestamp',()=>{
  const normalize=loader()('lib/inbox/normalize-messages.ts').normalizeMessages;
  const row={id:'message1',conversation_id:'conv1',direction:'incoming',platform_message_id:'m_source',created_at:new Date(timestamp).toISOString(),raw_payload:event({referral:undefined,message:{mid:'m_source',referral:referral()}})};
  const merged=normalize([{...row,raw_payload:{message:{mid:'m_source',text:'Hello'}}}],[row])[0];
  const source=pure.messengerSourceFromEvent(merged.raw_payload);assert.equal(source.ad_id,referral().ad_id);assert.equal(source.occurred_at,new Date(timestamp).toISOString());assert.equal(merged.raw_payload.message.text,'Hello');
});
