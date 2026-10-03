const test = require('node:test'), assert = require('node:assert/strict'), { createHmac } = require('node:crypto');
const { loader, database, baseSeed } = require('./tenh-seven/harness.cjs');

function fixture() {
  const seed=baseSeed(); seed.webhook_events=[];
  seed.conversations[0].source_type='comment'; seed.conversations[0].unread_count=2;
  const db=database(seed), detected=[];
  const load=loader({
    'next/server': { NextResponse: Response, after() {} },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/bot/availability': { TENH_BOT_AVAILABLE:false },
    '@/lib/bot/execution-store': { noteStoredFacebookBotEvent:async()=>{} },
    '@/lib/facebook/auto-reply': { runAutoReplyBatch:async()=>{ throw Error('Must not send'); } },
    '@/lib/facebook/process-comment': { processFacebookComment:async()=>{} },
    '@/lib/facebook/process-messenger-referral': { processFacebookMessengerReferral:async()=>{} },
    '@/lib/facebook/process-message-reaction': { processFacebookMessageReaction:async()=>{} },
    '@/lib/facebook/process-message-status': { processFacebookMessageStatus:async()=>{} },
    '@/lib/facebook/mark-comment-thread-deleted': { markFacebookCommentThreadDeleted:async()=>{} },
    '@/lib/facebook/capture-native-reply': { captureFacebookNativeReply:async()=>null },
    '@/lib/facebook/customer-block': { readFacebookBlock:async()=>({state:null}) },
    '@/lib/facebook/get-facebook-customer-profile': { getFacebookCustomerProfile:async()=>null },
    '@/lib/facebook/get-facebook-page-access-token': { getFacebookPageAccessToken:async()=>{ throw Error('No provider calls'); } },
    '@/lib/facebook/facebook-profile-photo': { syncFacebookContactProfilePhoto:async()=>{ throw Error('No photo mutation'); } },
    '@/lib/inbox/save-detected-customer-phone': { saveDetectedCustomerPhone:async input=>detected.push(input) },
  }, { Buffer, process:{env:{FACEBOOK_APP_SECRET:'fixture-only'}}, console:{log(){},warn(){},error(){}}, fetch(){ throw Error('No network'); } });
  const route=load('app/api/webhooks/facebook/route.ts');
  const event={sender:{id:seed.social_accounts[0].platform_account_id},recipient:{id:seed.contacts[0].platform_user_id},timestamp:Date.now(),message:{mid:'external-mid',text:'External private reply',is_echo:true,app_id:987654321}};
  const deliver=async (entry, signed=true)=>{
    const body=JSON.stringify({object:'page',entry:[entry]});
    return route.POST(new Request('https://fixture.test/api/webhooks/facebook',{method:'POST',body,headers:{'x-hub-signature-256':signed?'sha256='+createHmac('sha256','fixture-only').update(body).digest('hex'):'invalid'}}));
  };
  return { db,event,detected,deliver,entryId:seed.social_accounts[0].platform_account_id };
}
for (const envelope of [false,true]) test(`external app echo ingests once from ${envelope?'field/value':'messaging'} without changing customer channel/unread or phone detection`,async()=>{
  const h=fixture(), entry=envelope?{id:h.entryId,changes:[{field:'message_echoes',value:h.event}]}:{id:h.entryId,messaging:[h.event]};
  assert.equal((await h.deliver(entry)).status,200); assert.equal((await h.deliver(entry)).status,200);
  assert.equal(h.db.tables.messages.length,1); const row=h.db.tables.messages[0];
  assert.equal(row.direction,'outgoing'); assert.equal(row.is_echo,true); assert.equal(row.platform_message_id,'external-mid');
  assert.equal(h.db.tables.conversations[0].source_type,'comment'); assert.equal(h.db.tables.conversations[0].unread_count,2);
  assert.equal(h.detected.length,1); assert.equal(h.detected[0].incoming,false);
});
test('invalid signature never reaches message storage',async()=>{
  const h=fixture(); assert.equal((await h.deliver({id:h.entryId,messaging:[h.event]},false)).status,401);
  assert.equal(h.db.tables.messages.length,0); assert.equal(h.db.history.length,0);
});


test('defensive echo envelope rejects missing explicit echo, wrong Page and missing identity',async()=>{
 for(const mutate of [event=>{delete event.message.is_echo;},event=>{event.sender.id='other-page';},event=>{delete event.recipient;}]){
  const h=fixture();mutate(h.event);await h.deliver({id:h.entryId,changes:[{field:'message_echoes',value:h.event}]});
  assert.equal(h.db.tables.messages.length,0);
 }
});


test('signed third-party app standby echo uses existing storage and deduplicates messaging plus standby',async()=>{
 const h=fixture();const entry={id:h.entryId,messaging:[h.event],standby:[h.event]};
 assert.equal((await h.deliver(entry)).status,200);assert.equal((await h.deliver({id:h.entryId,standby:[h.event]})).status,200);
 assert.equal(h.db.tables.messages.length,1);const stored=h.db.tables.messages[0];
 assert.equal(stored.platform_message_id,'external-mid');assert.equal(stored.raw_payload.message.app_id,987654321);assert.equal(stored.direction,'outgoing');
 assert.equal(h.db.tables.conversations[0].source_type,'comment');assert.equal(h.db.tables.conversations[0].unread_count,2);assert.equal(h.detected.length,1);assert.equal(h.detected[0].incoming,false);
});
test('standby-only ManyChat-style explicit echo is ingested without requiring TENH app_id',async()=>{
 const h=fixture();await h.deliver({id:h.entryId,standby:[h.event]});assert.equal(h.db.tables.messages.length,1);assert.equal(h.db.tables.messages[0].raw_payload.message.app_id,987654321);
});
test('standby rejects malformed identities, wrong Page, missing MID or echo and non-message events',async()=>{
 for(const mutate of [event=>{delete event.message.is_echo;},event=>{event.message.is_echo=false;},event=>{event.sender.id='123456';},event=>{delete event.sender;},event=>{delete event.recipient;},event=>{event.recipient.id='bad-id';},event=>{event.recipient.id=event.sender.id;},event=>{event.message.mid=' ';},event=>{delete event.message.mid;},event=>{delete event.message;}]){
  const h=fixture();mutate(h.event);await h.deliver({id:h.entryId,standby:[null,42,{},h.event]});assert.equal(h.db.tables.messages.length,0);
 }
 const h=fixture();await h.deliver({id:'wrong-page',standby:[h.event]});assert.equal(h.db.tables.messages.length,0);
});
test('unsigned standby echo is rejected before any storage',async()=>{
 const h=fixture();assert.equal((await h.deliver({id:h.entryId,standby:[h.event]},false)).status,401);assert.equal(h.db.history.length,0);
});
