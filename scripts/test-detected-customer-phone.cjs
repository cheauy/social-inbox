const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
function compile(file){return ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;}
const detection={};vm.runInNewContext(compile('lib/inbox/detect-customer-phone.ts'),{exports:detection,require});
const code=compile('lib/inbox/save-detected-customer-phone.ts');
function harness({phone=null,activityFails=false,dbFails=false}={}){
 let current=phone,reads=0,writes=0;const activities=[];const exports={};
 const db={from:()=>{
  const filters=[];let patch=null;
  const query={select(){return this},eq(key,value){filters.push([key,value]);return this},is(key,value){filters.push([key,value]);return this},update(value){patch=value;return this},async maybeSingle(){
   if(dbFails)throw Error('database unavailable');
   if(!filters.some(([k,v])=>k==='business_id'&&v==='workspace')||!filters.some(([k,v])=>k==='id'&&v==='contact'))return {data:null};
   if(!patch){reads++;return {data:{id:'contact',phone:current,full_name:'Customer'}};}
   if(filters.some(([k,v])=>k==='phone'&&v===current)){current=patch.phone;writes++;return {data:{id:'contact'}};}
   return {data:null};
  }};return query;
 }};
 vm.runInNewContext(code,{exports,Date,console:{warn(){}},require:name=>{
  if(name==='server-only')return {};
  if(name.includes('supabase/admin'))return {supabaseAdmin:db};
  if(name.includes('detect-customer-phone'))return detection;
  if(name.includes('create-conversation-activity'))return {createConversationActivity:async activity=>{if(activityFails)throw Error('activity unavailable');activities.push(activity)}};
  throw Error(name);
 }});
 return {run:options=>exports.saveDetectedCustomerPhone({businessId:'workspace',contactId:'contact',conversationId:'conversation',messageId:'message',text:'012345678',incoming:true,...options}),state:()=>({phone:current,reads,writes}),activities};
}
test('fills empty phone and emits customer_updated to refresh details',async()=>{const h=harness();await h.run();assert.equal(h.state().phone,'+85512345678');assert.equal(h.activities[0].activityType,'customer_updated');assert.equal(h.activities[0].metadata.changedFields[0].field,'phone');assert.equal(h.activities[0].conversationId,'conversation');});
test('never saves outgoing numbers or non-phone values',async()=>{const h=harness();await h.run({incoming:false});await h.run({text:'order #012345678'});assert.equal(h.state().reads,0);assert.equal(h.state().writes,0);});
test('preserves an existing customer phone',async()=>{const h=harness({phone:'+855961234567'});await h.run();assert.equal(h.state().phone,'+855961234567');assert.equal(h.activities.length,0);});
test('fills legacy whitespace-only fields',async()=>{const h=harness({phone:' '});await h.run();assert.equal(h.state().phone,'+85512345678');});
test('concurrent messages cannot overwrite each other or duplicate activity',async()=>{const h=harness();await Promise.all([h.run(),h.run({text:'0961234567'})]);assert.equal(h.state().writes,1);assert.equal(h.activities.length,1);});
test('database and activity failure never fail incoming message processing',async()=>{const h=harness({dbFails:true});await h.run();assert.equal(h.state().writes,0);const other=harness({activityFails:true});await other.run();assert.equal(other.state().phone,'+85512345678');});
test('contact updates are scoped to the originating workspace',async()=>{const h=harness();await h.run({businessId:'other'});assert.equal(h.state().writes,0);});
