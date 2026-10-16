/* eslint-disable @typescript-eslint/no-require-imports */
// Portable, opt-in native test runner. Default/help never connects or installs software.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{randomUUID,randomBytes,createHash}=require('node:crypto');
if(!process.argv.includes('--run')){
 console.log('Requires a fresh dedicated loopback PostgreSQL17 cluster, empty tenh_khqr_test_<suffix> database owned by postgres, no application roles, four connections, and an already approved pg client module. Set TENH_KHQR_NATIVE_TEST_URL, TENH_KHQR_NATIVE_PG_MODULE and TENH_KHQR_NATIVE_TEST_OPT_IN=I_APPROVE_DISPOSABLE_LOCAL_TEST_DATA, then explicitly use --run. No automatic creation, deletion, installation, remote/production target or provider call. Fixtures are retained for inspection.');
 process.exit(0);
}
process.env.TENH_PGLITE_MODULE=path.resolve('tests/fixtures/khqr-native-pg-adapter.cjs');
// Canonical function text for the Windows source fixture; no source files are changed.
const read=fs.readFileSync;fs.readFileSync=function(file,...args){const value=read.call(this,file,...args);return typeof file==='string'&&file.endsWith('.sql')&&typeof value==='string'?value.replace(/\r\n/g,'\n'):value;};
const{database,prepare,settle}=require('./bakong-fixture.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const result=async(client,sql,args)=>(await client.query(sql,args)).rows[0].r;
const cancelSql="select tenh_request_payment_cancellation('bakong',$1,$2,$3,$4,false) r";
const cancelArgs=p=>[p.attempt.id,p.businessId,p.userId,p.memberId];
const prepareSql='select tenh_prepare_bakong_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) r';
function freshArgs(p){const args=[...p.args],id=randomUUID(),qr='synthetic-native-test:'+id;args[0]={...args[0],id};args[3]=randomUUID();args[8]=qr;args[9]=createHash('md5').update(qr).digest('hex');args[10]='TC'+id.replaceAll('-','').slice(0,22);args[11]=new Date(Date.now()+900000).toISOString();return args;}
async function blocked(observer,pid,finished){
 const deadline=Date.now()+5000;
 while(Date.now()<deadline){if(finished())throw Error('Contender completed before the expected lock barrier');const row=(await observer.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0];if(row?.wait_event_type==='Lock')return;await delay(25);}
 throw Error('Native lock barrier was not observed');
}
async function run(){
 let ctx,a,b,observer;const reports=[];
 try{
  ctx=await database(true,true,true,'atomic');a=await ctx.db.connection();b=await ctx.db.connection();observer=await ctx.db.connection();const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  async function race(name,firstSql,firstArgs,secondSql,secondArgs,commit){
   await a.query('begin');await a.query(firstSql,firstArgs);let finished=false;
   const pending=b.query(secondSql,secondArgs).then(value=>{finished=true;return value;},error=>{finished=true;throw error;});pending.catch(()=>{});
   try{await blocked(observer,pid,()=>finished);await a.query(commit?'commit':'rollback');const second=await pending;reports.push({name,release:commit?'commit':'rollback',lockObserved:true,passed:true});return second.rows[0].r;}
   finally{await a.query('rollback').catch(()=>{});}
  }
  for(const commit of [true,false]){
   const p=await prepare(ctx);await ctx.db.exec('update tenh_bakong_private.request_budgets set blocked_until=null');
   const second=await race('claim then cancel','select tenh_claim_bakong_check($1,$2,90) r',[p.attempt.id,p.fingerprint],cancelSql,cancelArgs(p),commit);assert.equal(second.outcome,'checkout_closed');
   assert.equal(Number((await ctx.db.query('select count(*) n from tenh_bakong_private.provider_calls where attempt_id=$1',[p.attempt.id])).rows[0].n),commit?1:0);
  }
  for(const commit of [true,false]){
   const p=await prepare(ctx);await result(ctx.db,cancelSql,cancelArgs(p));const left=freshArgs(p),right=freshArgs(p);
   const second=await race('two fresh purchase intents',prepareSql,left,prepareSql,right,commit);assert.equal(second.id,commit?left[0].id:right[0].id);await result(ctx.db,cancelSql,[second.id,p.businessId,p.userId,p.memberId]);
  }
  for(const commit of [true,false]){
   const p=await prepare(ctx,{environment:'production',approvedCapacity:true});await result(ctx.db,cancelSql,cancelArgs(p));await ctx.db.exec('update tenh_bakong_private.request_budgets set blocked_until=null');const hash=randomBytes(32).toString('hex');assert.equal((await settle(ctx,p,hash)).result.state,'review');
   const sql='select tenh_apply_reviewed_bakong_original_plan($1,$2,$3,$4,$5) r',args=[p.attempt.id,p.userId,randomUUID(),'Reviewed synthetic native receipt and no overlapping purchase.',hash];
   const second=await race('two explicit admin retries',sql,args,sql,args,commit);assert.equal(second.outcome,'applied');assert.equal(Number((await ctx.db.query("select count(*) n from tenh_billing_invoices where source_type='bakong' and source_payment_id=$1",[p.attempt.id])).rows[0].n),1);
  }
  console.log(JSON.stringify({passed:true,native:true,providerCalls:0,retainedSyntheticFixtures:true,reports,remainingMatrix:['cancel-before-claim','last global slots','cross-provider insertion','late-old versus replacement application','distinct admin request keys','lock timeout/deadlock recovery']}));
 }finally{for(const client of[a,b,observer])if(client)await client.end().catch(()=>{});await ctx?.db.close();}
}
run().catch(error=>{console.error('Native isolated verification failed: '+(error.code||'ASSERTION_OR_SETUP_FAILURE')+'. No connection details are printed. Inspect only the disposable fixture.');process.exitCode=1;});
