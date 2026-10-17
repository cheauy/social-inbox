/* eslint-disable @typescript-eslint/no-require-imports */
// Reuse the existing fully mocked deletion harness. No Auth/provider/database network access.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const filename=path.resolve('tests/tiktok-advertiser-account-deletion.test.cjs'),source=fs.readFileSync(filename,'utf8'),moduleFixture={exports:{}};
vm.runInNewContext(source.slice(0,source.indexOf('for (const scenario of ['))+'\nmodule.exports={fixture};',
 {require:createRequire(filename),module:moduleFixture,process,console,Request,Response,URL,structuredClone});
const fixture=options=>moduleFixture.exports.fixture({flag:'false',schemaAbsent:true,connections:[],...options});
const actor=(business='workspace-a',role='owner')=>({id:'actor-'+business,user_id:'deleting-user',business_id:business,role,is_active:true,full_name:'Account owner',email:'owner@fixture.invalid'});
const survivor=(business='workspace-a',role='agent')=>({id:'survivor-'+business,user_id:'other-'+business,business_id:business,role,is_active:true,full_name:'Active colleague',email:'colleague@fixture.invalid'});
const subscription=(business='workspace-a',patch={})=>({id:'sub-'+business,business_id:business,status:'active',last_paid_amount:13,current_period_end:'2099-01-01T00:00:00Z',...patch});
async function get(h){const response=await h.route.GET();assert.equal(response.status,200);return(await response.json()).impact;}

test('no subscriptions is deletable; joined/shared/expired memberships show their real name and status without new closure rules',async()=>{
 const empty=fixture({members:[],subscriptions:[]});assert.deepEqual((await get(empty)).subscriptions,[]);
 assert.equal((await empty.route.DELETE(empty.request())).status,200);
 const h=fixture({members:[actor(),actor('joined','agent'),actor('shared'),actor('expired'),survivor('shared','owner'),survivor()],
  subscriptions:[subscription(),subscription('joined'),subscription('shared'),subscription('expired',{status:'expired'})]});
 h.db.tables.businesses.push({id:'joined',name:'Joined workspace'},{id:'shared',name:'Shared workspace'},{id:'expired',name:'Expired workspace'});
 const impact=await get(h);
 assert.equal(impact.subscriptions.length,4);assert.equal(impact.blockingSubscriptions.length,1);
 assert.equal(impact.blockingSubscriptions[0].businessId,'workspace-a');assert.equal(impact.blockingSubscriptions[0].paidTimeRemaining,true);
 assert.equal(impact.subscriptions.find(s=>s.businessId==='expired').status,'expired');
 assert.equal(impact.subscriptions.find(s=>s.businessId==='joined').businessName,'Joined workspace');
 assert.equal((await h.close()).status,200);
 assert.equal(h.db.tables.business_subscriptions.find(s=>s.business_id==='workspace-a').status,'expired');
 for(const business of ['joined','shared'])assert.equal(h.db.tables.business_subscriptions.find(s=>s.business_id===business).status,'active');
 assert.equal(h.db.tables.team_members.find(m=>m.id==='survivor-shared').is_active,true);
});
test('only verified remaining paid time receives the loss warning; inactive memberships expose no workspace data',async()=>{
 for(const patch of [{status:'trialing'},{last_paid_amount:null},{current_period_end:'2000-01-01T00:00:00Z'}]){
  const h=fixture({members:[actor()],subscriptions:[subscription('workspace-a',patch)]});
  assert.equal((await get(h)).blockingSubscriptions[0].paidTimeRemaining,false);
 }
 const inactive=fixture({members:[{...actor(),is_active:false}]});assert.deepEqual((await get(inactive)).subscriptions,[]);
});
test('new owner or expired subscription arriving during confirmation prevents closure of an unaffected workspace',async()=>{
 for(const change of ['owner','expiry']){
  const h=fixture({members:[actor()],subscriptions:[subscription()]});assert.equal((await get(h)).canDelete,false);
  if(change==='owner')h.db.tables.team_members.push(survivor('workspace-a','owner'));
  else h.db.tables.business_subscriptions[0].status='expired';
  const before=h.db.tables.business_subscriptions[0].current_period_end;
  assert.equal((await h.close()).status,200);
  assert.equal(h.db.tables.business_subscriptions[0].current_period_end,before);
  if(change==='owner')assert.equal(h.db.tables.team_members.find(m=>m.id==='survivor-workspace-a').is_active,true);
 }
});
test('transfer revalidates active identity/workspace; missing, inactive and orphan transferees cannot delete the account',async()=>{
 for(const change of ['inactive','orphan','foreign']){
  const h=fixture({members:[actor(),survivor()]});await get(h);
  if(change==='inactive')h.db.tables.team_members[1].is_active=false;
  if(change==='orphan')h.db.tables.team_members[1].user_id=null;
  if(change==='foreign')h.db.tables.team_members[1].business_id='foreign';
  const response=await h.route.DELETE(h.request({ownerDecision:'transfer',ownerTransfers:[{businessId:'workspace-a',memberId:'survivor-workspace-a'}]}));
  assert.equal(response.status,500);assert.ok(!h.calls.some(c=>c.deletion));assert.equal(h.db.tables.team_members[1].role,'agent');
 }
 const orphan=fixture({members:[actor(),{...survivor(),user_id:null}]});assert.equal((await get(orphan)).blockingSubscriptions[0].candidates.length,0);
});
test('ownership/expiry changing after the impact recheck cannot release channels for a workspace skipped by closure',async()=>{
 for(const change of ['owner','expiry']){
  const h=fixture({members:[actor()],subscriptions:[subscription()]});
  h.db.tables.social_accounts=[{id:'channel-a',business_id:'workspace-a',platform:'telegram',is_active:true,telegram_bot_token_encrypted:'synthetic-retained-credential'}];
  const channels=JSON.stringify(h.db.tables.social_accounts),from=h.db.from;
  let changed=false;
  h.db.from=name=>{const query=from(name),select=query.select;query.select=columns=>{
   if(!changed&&((change==='owner'&&name==='team_members'&&columns==='id')||
     (change==='expiry'&&name==='business_subscriptions'&&columns==='id,business_id,status,current_period_end,trial_ends_at'))){
    changed=true;if(change==='owner')h.db.tables.team_members.push(survivor('workspace-a','owner'));
    else h.db.tables.business_subscriptions[0].status='expired';
   }
   return select.call(query,columns);
  };return query;};
  const response=await h.close();assert.equal(response.status,200);assert.ok(changed);
  assert.deepEqual((await response.json()).endedSubscriptions,[]);
  assert.equal(JSON.stringify(h.db.tables.social_accounts),channels);
 }
});
test('invalid text and missing acknowledgments fail before destructive actions; failed Auth restores staged state and retains shared records',async()=>{
 for(const body of [{confirmation:'DELETE'},{confirmation:'delete my account'},{understood:false}]){
  const h=fixture();assert.equal((await h.route.DELETE(h.request(body))).status,400);assert.equal(h.calls.length,0);
 }
 const h=fixture({members:[actor(),survivor()],subscriptions:[subscription()],authFailure:true});
 h.db.tables.messages=[{id:'shared-message',body:'Shared history'}];h.db.tables.billing_transactions=[{id:'paid-record',status:'approved'}];
 const before=JSON.stringify({messages:h.db.tables.messages,billing:h.db.tables.billing_transactions});
 assert.equal((await h.close()).status,500);assert.equal(h.db.tables.business_subscriptions[0].status,'active');
 assert.equal(h.db.tables.team_members[0].user_id,'deleting-user');assert.equal(h.db.tables.team_members[0].is_active,true);
 assert.equal(JSON.stringify({messages:h.db.tables.messages,billing:h.db.tables.billing_transactions}),before);
 assert.ok(!h.db.history.some(q=>['messages','billing_transactions'].includes(q.table)&&q.op!=='read'));
});
