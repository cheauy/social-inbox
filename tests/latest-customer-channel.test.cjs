const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
const { latestCustomerChannel } = loader()('lib/inbox/latest-customer-channel.ts');
const row=(id,time,kind='dm',direction='incoming')=>({id,conversation_id:'c1',direction,platform_message_id:id,message_type:'text',message_text:'Hello',created_at:'2026-09-15T00:00:00Z',platform_created_at:`2026-09-14T${time}:00Z`,raw_payload:kind==='comment'?{item:'comment',comment_id:id}:{message:{mid:id}}});
test('historical comment then customer DM shows Messenger despite newer outgoing replies',()=>{
  assert.equal(latestCustomerChannel([row('comment','10:00','comment'),row('dm','10:01'),row('reply','11:00','dm','outgoing')],'c1'),'messenger');
});
test('new customer comment switches back even if the Page echoes a later DM',()=>{
  assert.equal(latestCustomerChannel([row('dm','10:00'),row('comment','10:01','comment'),row('echo','11:00','dm','outgoing')],'c1'),'comment');
});
test('message timestamps win over storage order and pagination order',()=>{
  assert.equal(latestCustomerChannel([row('dm','10:01'),{...row('comment','10:00','comment'),created_at:'2026-10-01T00:00:00Z'}],'c1'),'messenger');
});
test('outgoing-only pages and messages from another chat do not guess a channel',()=>{
  assert.equal(latestCustomerChannel([row('out','11:00','dm','outgoing'),{...row('other','11:01'),conversation_id:'other'}],'c1'),null);
});
test('ad post metadata does not turn a native Messenger message into a comment',()=>{
  const message=row('ad-dm','10:00');message.raw_payload.post_id='post';
  assert.equal(latestCustomerChannel([message],'c1'),'messenger');
});
test('Telegram and optimistic rows cannot decide the Facebook badge',()=>{
  assert.equal(latestCustomerChannel([{...row('t','10:00'),platform_message_id:'telegram:1:2'},row('optimistic:1','10:01')],'c1'),null);
});
