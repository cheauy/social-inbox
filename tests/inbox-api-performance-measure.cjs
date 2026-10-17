/* Controlled artificial per-transport delay; never a prediction of production ms. */
const fs=require('node:fs');
const {apiFixture,uuid}=require('./inbox-api-performance-harness.cjs');
(async()=>{
  const result={kind:'Actual server source with Node auth/database doubles and fixed artificial transport latency; no browser/hosted DB/provider measurements',authModel:'createClient is mocked at validated getUser boundary; SDK/JWT/session-policy work is excluded and unchanged',sourceRoot:process.env.TENH_TEST_ROOT||process.cwd(),delayMsPerTransport:20,routes:{}};
  for(const kind of ['page','live','notifications','messages','workspaces']){
    const d=apiFixture({delayMs:20});
    if(kind==='page'||kind==='live')for(let i=1;i<30;i++){
      const row=JSON.parse(JSON.stringify(d.tables.conversations[0]));row.id=uuid(100+i);row.contact_id=uuid(1000+i);row.contact.id=row.contact_id;
      row.last_message_text='Fixture preview '.repeat(6);d.tables.conversations.push(row);
    }
    const now=process.env.TENH_API_FIXTURE_TIME?Date.parse(process.env.TENH_API_FIXTURE_TIME):Date.now();
    if(kind==='messages')d.tables.messages=Array.from({length:25},(_,i)=>({id:uuid(10000+i),conversation_id:uuid(1),direction:'incoming',sender_type:'customer',message_type:'text',message_text:'Fixture message '.repeat(6),created_at:new Date(now-i*1000).toISOString(),platform_created_at:new Date(now-i*1000).toISOString(),raw_payload:{}}));
    const r=await d.call(kind);
    result.routes[kind]={status:r.status,elapsedMs:r.elapsedMs,fixtureDecodeMs:r.fixtureDecodeMs,responseBytes:r.responseBytes,responseSHA256:r.responseSHA256,fixtureSerializationMs:d.events.filter(e=>e.kind==='fixture_serialization').reduce((sum,e)=>sum+e.end-e.start,0),authTransports:d.events.filter(e=>e.kind==='auth').length,databaseTransports:d.events.filter(e=>e.kind==='db'||e.kind==='rpc').length,maxConcurrentTransports:d.maxActive,
      queries:d.events.map(e=>({kind:e.kind,table:e.table,name:e.name,columns:e.columns,start:e.start,end:e.end,durationMs:e.end-e.start}))};
    if(r.status!==200)throw Error(kind+' fixture failed '+JSON.stringify(r.body));
  }
  const out=process.env.TENH_API_MEASUREMENT_OUT;
  if(out)fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
