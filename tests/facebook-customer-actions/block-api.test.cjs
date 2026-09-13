const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, baseSeed } = require('../tenh-seven/harness.cjs');
const ROUTE = 'app/api/conversations/[conversationId]/facebook-block/route.ts';
const post = (h, body) => h.load(ROUTE).POST(h.request(body), h.context);
const banSeed = () => { const seed=baseSeed();seed.facebook_customer_blocks.push({business_id:'b1',social_account_id:'s1',contact_id:'c1',is_blocked:true,block_mode:'page',operation_id:null});return seed; };

test('Page ban sends BAN_USER and stores its scope only after positive confirmation', async () => {
 const h=setup();const response=await post(h,{blocked:true,mode:'page'});
 assert.equal(response.status,200);const result=await response.json();
 assert.deepEqual(JSON.parse(h.calls[0].init.body),{user_ids:[{id:'100076611888104'}],actions:['BAN_USER']});
 assert.equal(result.state.is_blocked,true);assert.equal(result.state.block_mode,'page');assert.equal(result.modesAvailable,true);
 assert.equal(h.db.tables.conversation_activity[0].metadata.mode,'page');
});
test('removing a Page ban also unblocks Messenger using the stored mode',async()=>{
 const h=setup({seed:banSeed()});assert.equal((await post(h,{blocked:false})).status,200);
 assert.deepEqual(JSON.parse(h.calls[0].init.body).actions,['UNBAN_USER','UNBLOCK_USER']);
 assert.equal(h.db.tables.facebook_customer_blocks[0].is_blocked,false);
});
for(const blocked of [true,false])test(`messages-only request cannot overwrite a Page ban: ${blocked}`,async()=>{
 const h=setup({seed:banSeed()});assert.equal((await post(h,{blocked,mode:'messages'})).status,409);
 assert.equal(h.calls.length,0);assert.equal(h.db.tables.facebook_customer_blocks[0].block_mode,'page');assert.equal(h.db.tables.facebook_customer_blocks[0].operation_id,null);
});
for(const mode of [null,'all','ban_user',{},42])test(`invalid block mode is rejected before provider call: ${JSON.stringify(mode)}`,async()=>{
 const h=setup();assert.equal((await post(h,{blocked:true,mode})).status,400);assert.equal(h.calls.length,0);
});
test('unban refusal retains the Page ban and releases the lease',async()=>{
 const h=setup({seed:banSeed(),fetchResults:[{error:{code:200,message:'Permission denied'}}]});
 assert.equal((await post(h,{blocked:false,mode:'page'})).status,502);
 const state=h.db.tables.facebook_customer_blocks[0];assert.equal(state.is_blocked,true);assert.equal(state.block_mode,'page');assert.equal(state.operation_id,null);
});
test('ban permission requires customers/manage',async()=>{
 const h=setup({permissionDenied:true});assert.equal((await post(h,{blocked:true,mode:'page'})).status,403);assert.equal(h.calls.length,0);
});
test('failed local persistence reports the exact confirmed action for a safe retry',async()=>{
 const h=setup();h.db.failures.push({table:'facebook_customer_blocks',op:'update',when:q=>q.body.is_blocked===true});
 const response=await post(h,{blocked:true,mode:'page'});const result=await response.json();assert.equal(response.status,503);
 assert.equal(result.providerConfirmed,true);assert.equal(result.requestedMode,'page');assert.equal(result.requestedBlocked,true);
});
test('old schema continues to enforce an existing block while new operations await migration',async()=>{
 const h=setup({seed:banSeed()});const from=h.db.from;
 h.db.from=table=>{const q=from(table),select=q.select.bind(q);q.select=columns=>{q.columns=columns;return select(columns)};return q;};
 h.db.failures.push({table:'facebook_customer_blocks',op:'read',code:'42703',when:q=>q.columns?.includes('block_mode')});
 const guard=h.load('lib/facebook/customer-block.ts');const scope={businessId:'b1',socialAccountId:'s1',contactId:'c1'};
 const state=await guard.readFacebookBlock(scope);assert.equal(state.available,true);assert.equal(state.modesAvailable,false);assert.equal(state.state.is_blocked,true);
 assert.ok(await guard.facebookSendBlockReason(scope));
 assert.equal((await post(h,{blocked:true,mode:'page'})).status,503);assert.equal(h.calls.length,0);
});
for(const method of ['GET','POST'])test(`unexpected access/load failure returns JSON for ${method}`,async()=>{
 const h=setup();h.db.from=()=>{throw new Error('database unavailable');};
 const response=await h.load(ROUTE)[method](h.request(method==='POST'?{blocked:true}:undefined,method),h.context);
 assert.equal(response.status,503);assert.equal((await response.json()).success,false);assert.equal(h.calls.length,0);
});
