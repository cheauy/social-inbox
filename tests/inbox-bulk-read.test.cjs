const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const {loader,uuid,base,setup}=require('./inbox-recovery-harness.cjs');
const helpers=loader()('lib/inbox/bulk-read.ts');
const target=row=>({id:row.id,lastMessageAt:row.last_message_at,updatedAt:row.updated_at??null,unreadCount:row.unread_count});
function route(h){return h.load('app/api/inbox/mark-all-read/route.ts');}
async function call(h,targets){const r=await route(h).POST(h.request({targets}));return {status:r.status,...await r.json()};}
test('snapshot covers unread rows beyond the visible window and deduplicates IDs',()=>{
 const rows=Array.from({length:143},(_,i)=>({...base().conversations[0],id:uuid(i+1),unread_count:i%2?2:0}));const result=helpers.snapshotUnread([...rows,rows[1]]);
 assert.equal(result.length,71);assert.equal(result.at(-1).id,uuid(142));assert.equal(new Set(result.map(r=>r.id)).size,result.length);
});
test('read snapshots reject invalid IDs, timestamps, counts and injected filters',()=>{
 const valid=target(base().conversations[0]);assert.equal(helpers.validReadTarget(valid),true);
 for(const invalid of [{...valid,id:'x)'},{...valid,lastMessageAt:'2026-09-29T00:00:00Z),id.neq.x'},{...valid,updatedAt:'never'},{...valid,unreadCount:0},{...valid,unreadCount:1.2},{...valid,unreadCount:'2'},null])assert.equal(helpers.validReadTarget(invalid),false);
});
test('read receipt applies only to the captured message state, not one arriving 100ms later',()=>{
 const row=base().conversations[0],snapshot=target(row),receipt={...row,unread_count:0,updated_at:new Date(Date.now()+1000).toISOString()};
 assert.equal(helpers.receiptStillApplies(row,receipt,snapshot),true);
 assert.equal(helpers.receiptStillApplies({...row,last_message_at:'2026-09-29T05:00:00.100Z'},receipt,snapshot),false);
 assert.equal(helpers.receiptStillApplies({...row,unread_count:3},receipt,snapshot),false);
 assert.equal(helpers.receiptStillApplies({...row,updated_at:new Date(Date.now()+2000).toISOString()},receipt,snapshot),false);
});
test('successful mark-all-read updates only requested unread rows and returns receipts',async()=>{
 const seed=base();seed.conversations.push({...seed.conversations[0],id:uuid(2)});const h=setup({seed}),result=await call(h,[target(seed.conversations[0])]);
 assert.equal(result.status,200);assert.equal(result.conversations.length,1);assert.equal(result.conversations[0].unread_count,0);assert.equal(h.db.tables.conversations[1].unread_count,2);
 assert.deepEqual(h.db.history.find(q=>q.op==='update').body,{unread_count:0});
});
for(const mode of ['message','count','version'])test(`compare-and-swap preserves ${mode} that changes after the click`,async()=>{
 const seed=base(),snapshot=target(seed.conversations[0]),h=setup({seed});let did=false;
 h.db.setBefore(q=>{if(q.op==='update'&&!did){did=true;const row=h.db.tables.conversations[0];if(mode==='message')row.last_message_at='2026-09-29T05:00:00.100Z';if(mode==='count')row.unread_count++;if(mode==='version')row.updated_at=new Date(Date.parse(row.updated_at)+1).toISOString();}});
 const result=await call(h,[snapshot]);assert.equal(result.conversations.length,0);assert.deepEqual(result.skippedIds,[uuid(1)]);assert.ok(h.db.tables.conversations[0].unread_count>0);
});
test('legacy client without updated_at uses freshly verified database version',async()=>{
 const seed=base(),h=setup({seed}),snapshot={...target(seed.conversations[0]),updatedAt:null},result=await call(h,[snapshot]);assert.equal(result.conversations.length,1);
});
test('null last-message timestamp can be marked read safely',async()=>{
 const seed=base();seed.conversations[0].last_message_at=null;const h=setup({seed}),result=await call(h,[target(seed.conversations[0])]);assert.equal(result.conversations.length,1);
});
test('already-read rows are skipped, not counted as a successful new write',async()=>{
 const seed=base(),snapshot=target(seed.conversations[0]);seed.conversations[0].unread_count=0;const h=setup({seed}),result=await call(h,[snapshot]);assert.equal(result.conversations.length,0);assert.deepEqual(result.skippedIds,[uuid(1)]);
});
test('mixed authorized and unauthorized IDs reject the whole request before writing',async()=>{
 const seed=base();seed.conversations.push({...seed.conversations[0],id:uuid(2),business_id:'b2'});const h=setup({seed}),result=await call(h,seed.conversations.map(target));assert.equal(result.status,403);assert.equal(h.db.history.some(q=>q.op==='update'),false);
});
for(const options of [{signedOut:true},{denied:true},{permissionDenied:true},{businesses:[]}])test('bulk read respects access '+JSON.stringify(options),async()=>{
 const h=setup(options),result=await call(h,[target(h.db.tables.conversations[0])]);assert.ok([401,403].includes(result.status));assert.equal(h.db.history.some(q=>q.op==='update'),false);
});
for(const channelPatch of [{is_active:false},{facebook_token_status:'disconnected'},{platform:'telegram',telegram_token_status:'invalid'}])test('inactive or disconnected channel is not writable '+JSON.stringify(channelPatch),async()=>{
 const seed=base();Object.assign(seed.social_accounts[0],channelPatch);const h=setup({seed}),result=await call(h,[target(seed.conversations[0])]);assert.equal(result.status,403);assert.equal(h.db.history.some(q=>q.op==='update'),false);
});
test('bounded batches report partial database failure accurately without clearing unconfirmed rows',async()=>{
 const seed=base();seed.conversations=Array.from({length:60},(_,i)=>({...seed.conversations[0],id:uuid(i+1)}));const h=setup({seed});let batch=0;
 h.db.faults.push({table:'conversations',op:'update',when:()=>++batch===2});const result=await call(h,seed.conversations.map(target));
 assert.equal(result.conversations.length,35);assert.equal(result.failedIds.length,25);assert.equal(result.skippedIds.length,0);assert.equal(h.db.history.filter(q=>q.op==='update').length,3);
 assert.equal(h.db.tables.conversations.filter(row=>row.unread_count>0).length,25);
});
for(const kind of ['empty','too-many','duplicates','bad'])test('invalid bulk request '+kind+' performs no writes',async()=>{
 const seed=base(),one=target(seed.conversations[0]);const targets=kind==='empty'?[]:kind==='too-many'?Array.from({length:101},(_,i)=>({...one,id:uuid(i+1)})):kind==='duplicates'?[one,one]:[{...one,id:'x'}];const h=setup({seed}),result=await call(h,targets);assert.equal(result.status,400);assert.equal(h.db.history.length,0);
});
test('Unread action passes every filtered row, not the first visible page',()=>{
 const code=fs.readFileSync('components/inbox/conversation-list.tsx','utf8');assert.match(code,/selectedViewKey === "unread" && onMarkAllRead/);assert.match(code,/await onMarkAllRead\(filteredConversations\)/);assert.doesNotMatch(code,/onMarkAllRead\(visibleConversations\)/);
});
