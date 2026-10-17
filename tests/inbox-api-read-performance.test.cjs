const test=require('node:test'),assert=require('node:assert/strict');
const {apiFixture,uuid}=require('./inbox-api-performance-harness.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const identity={userId:uuid(902),businessId:uuid(900)};
test('page scope and personal views share one active-membership read within a request',async()=>{
  const d=apiFixture(),r=await d.call('page');assert.equal(r.status,200);
  assert.deepEqual(r.body.page.conversations.map(row=>row.id),[uuid(1)]);
  assert.equal(d.events.filter(e=>e.table==='team_members').length,2,'selected membership plus one all-active membership read');
});
test('live-state discovery and hydration share active channel metadata within a request',async()=>{
  const d=apiFixture(),r=await d.call('live');assert.equal(r.status,200);
  assert.deepEqual(r.body.hydratedConversations.map(row=>row.id),[uuid(1)]);
  assert.equal(d.events.filter(e=>e.table==='social_accounts'&&e.columns==='id,platform,facebook_token_status,telegram_token_status').length,1);
  assert.deepEqual(r.body.accessibleBusinessIds,[uuid(900)]);assert.deepEqual(r.body.activeChannelIds,[uuid(800)]);
});
test('hydration overlaps independent subscription/channel/privacy reads after authentication',async()=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;});
  const d=apiFixture({hold:e=>e.table==='social_accounts'&&e.columns==='id,platform,facebook_token_status,telegram_token_status'?blocked:undefined});
  const read=d.load('lib/inbox/get-conversations.ts').getConversations;
  const pending=d.context.run(identity,()=>d.scoped(()=>read([uuid(900)],{conversationIds:[uuid(1)]}))());
  try{await tick();assert.ok(d.events.some(e=>e.table==='social_accounts'&&e.columns==='id,business_id'),'privacy metadata begins without waiting for channel metadata');}
  finally{release();}
  assert.equal((await pending)[0].id,uuid(1));
  const authEnd=d.events.find(e=>e.kind==='auth').end;
  assert.ok(d.events.filter(e=>e.table==='business_subscriptions'||e.table==='social_accounts').every(e=>e.start>=authEnd));
});
test('notification privacy read overlaps the authorized reminder/read pipeline and still gates the response',async()=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;});
  const d=apiFixture({hold:e=>e.table==='conversation_reminders'?blocked:undefined});
  const pending=d.call('notifications');
  try{await tick();assert.ok(d.events.some(e=>e.table==='social_accounts'),'privacy metadata begins while reminders are pending');}
  finally{release();}
  const r=await pending;assert.equal(r.status,200);assert.deepEqual(r.body.notifications,[]);
});
test('two concurrent users stay isolated and a later request sees revoked membership',async()=>{
  const d=apiFixture();const[a,b]=await Promise.all([d.call('page'),d.call('page',{userId:uuid(912),businessId:uuid(910)})]);
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.deepEqual(a.body.page.conversations.map(row=>row.business_id),[uuid(900)]);
  assert.deepEqual(b.body.page.conversations.map(row=>row.business_id),[uuid(910)]);
  d.tables.team_members[0].is_active=false;
  const later=await d.call('page');assert.equal(later.status,403);assert.equal(later.body.success,false);
});
test('signed-out and forbidden workspace requests never reach page RPC or customer reads',async()=>{
  const d=apiFixture();const signedOut=await d.call('page',{userId:null,businessId:uuid(900)});assert.equal(signedOut.status,401);
  assert.equal(d.events.filter(e=>e.kind==='db'||e.kind==='rpc').length,0);
  d.events.length=0;const denied=await d.call('page',identity,{workspaceId:uuid(910)});assert.equal(denied.status,500);
  assert.equal(d.events.filter(e=>e.kind==='rpc'||e.table==='conversations').length,0);
});
test('channel cache canonicalizes the identical tenant set without widening a subset',async()=>{
  const d=apiFixture(),read=d.load('lib/inbox/get-active-inbox-channels.ts').getActiveInboxChannels;
  const all=[uuid(900),uuid(910)];
  await d.scoped(async()=>{
    const first=read(all),same=read([uuid(910),uuid(900),uuid(900)]);
    assert.equal(first,same);
    const [both,a,b]=await Promise.all([first,read([uuid(900)]),read([uuid(910)])]);
    assert.deepEqual(Array.from(both,row=>row.id).sort(),[uuid(800),uuid(810)]);
    assert.deepEqual(Array.from(a,row=>row.id),[uuid(800)]);assert.deepEqual(Array.from(b,row=>row.id),[uuid(810)]);
  })();
  assert.equal(d.events.filter(e=>e.table==='social_accounts').length,3);
});
test('membership failures are retryable, duplicate active rows remain available and expired workspaces stay out of page views',async()=>{
  let once=true;const d=apiFixture({fail:e=>e.table==='team_members'&&e.columns==='id,business_id'&&once?(once=false,true):false});
  const read=d.load('lib/inbox/get-active-inbox-memberships.ts').getActiveInboxMemberships;
  await d.scoped(async()=>{await assert.rejects(read(uuid(902)),/Unable to load/);assert.equal((await read(uuid(902))).length,1);})();
  d.tables.team_members.push({...d.tables.team_members[0],id:uuid(903),created_at:'2026-02-01T00:00:00Z'});
  d.tables.team_members.push({...d.tables.team_members[0],id:uuid(904),business_id:uuid(910)});
  d.tables.business_subscriptions[1].status='expired';
  const r=await d.call('page');assert.equal(r.status,200);
  const args=d.events.filter(e=>e.name==='tenh_inbox_page').at(-1).args;
  assert.deepEqual(Array.from(args.p_business_ids),[uuid(900)]);assert.equal(args.p_request.memberIds[uuid(900)],uuid(903));assert.equal(args.p_request.memberIds[uuid(910)],undefined);
});
test('all hydration gates settle before any authorized row callback or customer query',async()=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;});let callbacks=0;
  const d=apiFixture({hold:e=>e.table==='social_accounts'&&e.columns==='id,business_id'?blocked:undefined});
  const read=d.load('lib/inbox/get-conversations.ts').getConversations;
  const pending=d.context.run(identity,()=>d.scoped(()=>read([uuid(900)],{conversationIds:[uuid(1)],onAuthorizedRows(){callbacks++;}}))());
  await tick();assert.equal(callbacks,0);assert.equal(d.events.filter(e=>e.table==='conversations').length,0);
  release();await pending;assert.equal(callbacks,1);
  for(const table of ['business_subscriptions','social_accounts']){
    const failed=apiFixture({fail:e=>e.table===table});let exposed=false;
    const load=failed.load('lib/inbox/get-conversations.ts').getConversations;
    await assert.rejects(failed.context.run(identity,()=>failed.scoped(()=>load([uuid(900)],{onAuthorizedRows(){exposed=true;}}))()));
    assert.equal(exposed,false);assert.equal(failed.events.filter(e=>e.table==='conversations').length,0);
  }
});
test('privacy failure still waits for mocked reminder upsert and notification SELECT to finish',async()=>{
  let release;const blocked=new Promise(resolve=>{release=resolve;});let settled=false;
  const d=apiFixture({allowNotificationMaterialization:true,hold:e=>e.kind==='fixture_mutation'?blocked:undefined,fail:e=>e.table==='social_accounts'&&e.columns==='id,business_id'});
  d.tables.conversation_reminders.push({id:uuid(5000),business_id:uuid(900),conversation_id:uuid(1),contact_id:null,note:'Fixture reminder',remind_at:'2026-01-01T00:00:00Z',status:'open'});
  const pending=d.call('notifications').then(value=>{settled=true;return value;},error=>{settled=true;throw error;});
  await tick();assert.equal(settled,false);assert.ok(d.events.some(e=>e.kind==='fixture_mutation'));
  release();await assert.rejects(pending,/Unable to verify Telegram Personal visibility/);
  const mutation=d.events.find(e=>e.kind==='fixture_mutation'),select=d.events.find(e=>e.table==='team_notifications'&&e.kind==='db');
  assert.ok(select.start>=mutation.end);assert.equal(d.tables.team_notifications.length,1);
});
test('legacy Facebook and Telegram token rules remain with each caller',async()=>{
  const d=apiFixture();
  const channels=[['facebook',null,true],['facebook','disconnected',false],['telegram','verified',true],['telegram','invalid',false],['other','disconnected',true]];
  for(const[i,[platform,status]]of channels.entries()){
    const channel={id:uuid(820+i),business_id:uuid(900),is_active:true,platform,facebook_token_status:status,telegram_token_status:status};
    d.tables.social_accounts.push(channel);d.tables.conversations.push({...d.tables.conversations[0],id:uuid(30+i),social_account_id:channel.id,platform,social_account:channel});
  }
  const read=d.load('lib/inbox/get-conversations.ts').getConversations;
  const rows=await d.context.run(identity,()=>d.scoped(()=>read([uuid(900)]))());
  const ids=Array.from(rows,row=>row.id);
  for(const[i,[,,expected]]of channels.entries())assert.equal(ids.includes(uuid(30+i)),expected);
  const live=await d.call('live');assert.equal(live.status,200);
  assert.ok(live.body.activeChannelIds.includes(uuid(820)));assert.ok(live.body.activeChannelIds.includes(uuid(822)));
  for(const i of [1,3,4])assert.ok(!live.body.activeChannelIds.includes(uuid(820+i)));
});
test('expired subscriptions and failed channel/visibility reads remain fail-closed',async()=>{
  const d=apiFixture();d.tables.business_subscriptions[0].status='expired';
  const r=await d.call('live');assert.equal(r.status,200);assert.deepEqual(r.body.conversations,[]);assert.deepEqual(r.body.accessibleBusinessIds,[]);
  for(const columns of ['id,platform,facebook_token_status,telegram_token_status','id,business_id']){
    const broken=apiFixture({fail:e=>e.table==='social_accounts'&&e.columns===columns});
    const response=await broken.call('live');assert.ok(response.status>=500);assert.equal(response.body.success,false);assert.equal(response.body.conversations,undefined);
  }
});
