/* Alternate fresh processes so baseline/current use the same fixture and dependencies. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const baselineRoot=process.env.TENH_API_BASELINE_ROOT,currentRoot=process.cwd();
if(!baselineRoot)throw Error('Set TENH_API_BASELINE_ROOT to a clean released-source checkout.');
const sampleCount=5,samples={before:[],after:[]};
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
for(let sample=0;sample<sampleCount;sample++)for(const kind of ['before','after']){
  const env={...process.env,TENH_TEST_ROOT:kind==='before'?baselineRoot:currentRoot,NODE_PATH:path.join(currentRoot,'node_modules'),TENH_API_FIXTURE_TIME:'2026-10-17T07:13:00Z'};
  delete env.TENH_API_MEASUREMENT_OUT;
  const run=cp.spawnSync(process.execPath,['tests/inbox-api-performance-measure.cjs'],{cwd:currentRoot,env,encoding:'utf8',maxBuffer:8*1024*1024});
  if(run.status!==0)throw Error(kind+' measurement failed: '+run.stderr);
  const result=JSON.parse(run.stdout);samples[kind].push(result);
  if(process.env.TENH_API_RAW_DIR){fs.mkdirSync(process.env.TENH_API_RAW_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.TENH_API_RAW_DIR,kind+'-'+sample+'.json'),run.stdout);}
}
const output={kind:'Synthetic Node server-module fixtures with fixed20ms artificial transport delay; no production/server/network/browser latency claim',baselineRoot,currentRoot,sampleCount,authModel:samples.before[0].authModel,delayMsPerTransport:20,routes:{}};
for(const route of Object.keys(samples.before[0].routes)){
  const hashes=[...samples.before,...samples.after].map(sample=>sample.routes[route].responseSHA256);
  if(new Set(hashes).size!==1)throw Error(route+' response bytes changed between baseline/current fixture samples.');
  output.routes[route]={};
  for(const kind of ['before','after']){
    const rows=samples[kind].map(sample=>sample.routes[route]);
    const first=rows[0],origin=Math.min(...first.queries.map(q=>q.start));
    output.routes[route][kind]={status:first.status,elapsedMsSamples:rows.map(r=>r.elapsedMs),medianElapsedMs:median(rows.map(r=>r.elapsedMs)),
      authTransports:rows.map(r=>r.authTransports),databaseTransports:rows.map(r=>r.databaseTransports),maxConcurrentTransports:rows.map(r=>r.maxConcurrentTransports),
      responseBytes:first.responseBytes,responseSHA256:first.responseSHA256,identicalResponseAcrossAllSamples:true,medianFixtureSerializationMs:median(rows.map(r=>r.fixtureSerializationMs)),
      timeline:first.queries.map(q=>({...q,start:q.start-origin,end:q.end-origin}))};
  }
}
const out='docs/evidence/inbox-api-performance-20261017';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/measurements.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({kind:output.kind,routes:Object.fromEntries(Object.entries(output.routes).map(([name,row])=>[name,Object.fromEntries(Object.entries(row).map(([kind,value])=>[kind,{medianElapsedMs:value.medianElapsedMs,authTransports:value.authTransports[0],databaseTransports:value.databaseTransports[0],maxConcurrentTransports:value.maxConcurrentTransports[0],responseBytes:value.responseBytes,medianFixtureSerializationMs:value.medianFixtureSerializationMs}]))]))},null,2));
