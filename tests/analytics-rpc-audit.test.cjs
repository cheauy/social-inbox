const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=require('./fixtures/analytics-metrics.cjs');
const {loader}=require('./tenh-seven/harness.cjs');
const metrics=loader()('lib/analytics/overview-metrics.ts');
const root=process.cwd(),modulePath=process.env.TENH_ANALYTICS_PGLITE;
test('approved human overview and deployed RPCs replay on isolated PostgreSQL with independent expected counts',{skip:!modulePath},async()=>{
 const {PGlite}=require(modulePath),db=new PGlite();
 try {
  await db.exec(fs.readFileSync(path.join(root,'tests/fixtures/analytics-schema.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'docs/evidence/analytics-redesign-20261007/reviewed-rpc-definitions.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'db/proposals/20261007_analytics_overview.sql'),'utf8'));
  await fixture.seed(db);
  const overview=async(start=fixture.start,end=fixture.end,zone='UTC',business=fixture.A,member=fixture.M1,user=fixture.U)=>
   (await db.query('SELECT public.get_tenh_analytics_overview($1,$2,$3,$4,$5,$6,600,$7) data',[business,member,user,start,end,fixture.snapshot,zone])).rows[0].data;
  const data=await overview();assert.equal(metrics.verifiedOverview(data),true);
  // Hand-counted fixture ledger; do not calculate expected values with the SQL algorithm.
  assert.deepEqual(data.current,{unassigned:6,unread:8,waitingOverSla:4,unknownWaiting:1,overdue:3});
  assert.deepEqual(data.period,{conversations:8,commentThreads:1,resolved:2,firstResponses:4,avgFirstResponseSeconds:270,
   slaMet:4,slaMissed:2,slaDenominator:6,slaRate:67,humanEvaluableConversations:7,unknownHumanConversations:1});
  assert.deepEqual(data.messages,{incoming:12,outgoing:12,humanOutgoing:9,botOutgoing:2,unknownOutgoing:1});
  assert.deepEqual(data.customers,{active:10,new:4,returning:7});
  assert.deepEqual(data.channels,[{channel:'comment',value:1},{channel:'messenger',value:7},{channel:'telegram',value:1}]);
  assert.deepEqual(data.daily,[{date:'2026-10-05',received:8,resolved:2}]);
  assert.equal(data.hours.length,24);assert.equal(data.hours.reduce((s,r)=>s+r.value,0),12);
  assert.equal(data.hours.find(r=>r.hour===0).value,2);assert.equal(data.hours.find(r=>r.hour===1).value,2);
  assert.equal(data.hours.find(r=>r.hour===5).value,2);assert.equal(data.hours.find(r=>r.hour===20).value,1);
  const zone=await overview(fixture.start,fixture.end,'Asia/Phnom_Penh');assert.equal(zone.hours.find(r=>r.hour===7).value,2);
  assert.equal(zone.hours.find(r=>r.hour===3).value,1);assert.equal(zone.daily.reduce((s,r)=>s+r.received,0),8);
  const empty=await overview('2026-09-20T00:00:00Z','2026-09-21T00:00:00Z');assert.equal(empty.period.conversations,0);
  assert.equal(empty.period.slaRate,null);assert.equal(empty.period.avgFirstResponseSeconds,null);assert.deepEqual(empty.current,data.current);
  const instant=await overview(fixture.start,fixture.start);assert.equal(instant.period.conversations,0);assert.equal(instant.period.slaRate,null);assert.deepEqual(instant.current,data.current);
  const waiting=await overview('2026-10-05T23:58:00Z',fixture.end);assert.equal(waiting.period.conversations,1);
  assert.equal(waiting.period.firstResponses,0);assert.equal(waiting.period.slaDenominator,0);assert.equal(waiting.period.slaRate,null);
  await assert.rejects(overview(fixture.start,fixture.end,'UTC',fixture.B),/analytics_scope_denied/);
  await assert.rejects(overview(fixture.start,fixture.end,'Invalid/Zone'),/analytics_range_invalid/);
  await assert.rejects(overview('2025-01-01T00:00:00Z',fixture.end),/analytics_range_invalid/);
  const year=await overview('2025-10-06T00:00:00Z',fixture.snapshot);assert.equal(metrics.verifiedOverview(year),true);assert.equal(year.period.conversations,12);
  assert.equal(year.period.firstResponses,6);assert.equal(year.period.avgFirstResponseSeconds,250);assert.equal(year.period.slaRate,67);
  // Thirteen received Inbox threads plus the outgoing-only contact form 14 active contact IDs.
  assert.deepEqual(year.messages,{incoming:17,outgoing:16,humanOutgoing:12,botOutgoing:2,unknownOutgoing:2});assert.deepEqual(year.customers,{active:14,new:17,returning:0});
  const legacy={};for(const [name,report] of [['get_tenh_conversation_reports','conversations'],['get_tenh_customer_insights','customers'],['get_tenh_sla_analytics','sla'],['get_tenh_agent_performance','agents']]){
   const args=name==='get_tenh_customer_insights'?'$1,$2,$3,0':name==='get_tenh_agent_performance'?'$1,$2,$3,600':'$1,$2,$3,600,0';
   legacy[report]=(await db.query(`SELECT public.${name}(${args}) data`,[fixture.A,fixture.start,fixture.end])).rows[0].data;
  }
  assert.equal(legacy.sla.summary.received,9);assert.equal(legacy.conversations.summary.receivedConversations,11);
  assert.equal(legacy.customers.summary.activeCustomers,12);assert.equal(legacy.agents.summary.attributedFirstResponses,5);
  const expectedLegacy={
   conversations:{currentOpen:9,currentSpam:1,currentClosed:1,currentUnread:6,totalMessages:28,currentPending:0,resolutionRate:18,waitingOverSla:2,currentResolved:0,incomingMessages:14,outgoingMessages:13,currentUnassigned:3,receivedConversations:11,resolvedConversations:2},
   customers:{newCustomers:4,openCustomers:14,inactive30Days:14,totalCustomers:18,activeCustomers:12,incomingMessages:14,messagesInPeriod:28,outgoingMessages:13,returningCustomers:9},
   sla:{slaMet:7,slaRate:78,waiting:1,received:9,resolved:1,responded:8,slaMissed:2,slaWaiting:0,avgResolutionSeconds:300,avgFirstResponseSeconds:525,medianFirstResponseSeconds:120},
   agents:{slaMet:4,slaRate:80,slaMissed:1,totalOutgoing:13,attributionRate:77,attributedOutgoing:10,totalFirstResponses:8,unattributedOutgoing:3,avgFirstResponseSeconds:804,attributedFirstResponses:5,unattributedFirstResponses:3},
  };
  for(const key of Object.keys(expectedLegacy))assert.deepEqual(legacy[key].summary,expectedLegacy[key]);
  const emptyLegacy=(await db.query('SELECT public.get_tenh_sla_analytics($1,$2,$3,600,0) data',[fixture.A,'2026-09-20T00:00:00Z','2026-09-21T00:00:00Z'])).rows[0].data;
  assert.equal(emptyLegacy.summary.slaRate,100,'deployed SQL gap is demonstrated; web API normalizes the empty denominator to null');
  const output=path.join(root,'docs/evidence/analytics-redesign-20261007');
  const agentConversationUnion=Number((await db.query(`SELECT count(DISTINCT m.conversation_id) n FROM public.messages m
    JOIN public.conversations c ON c.id=m.conversation_id AND c.business_id=$1
    JOIN public.team_members tm ON tm.id=m.sent_by_member_id AND tm.business_id=$1
    WHERE m.business_id=$1 AND m.direction='outgoing' AND coalesce(c.source_type,'messenger')<>'comment'
      AND coalesce(m.platform_created_at,m.created_at)>=$2 AND coalesce(m.platform_created_at,m.created_at)<$3`,[fixture.A,fixture.start,fixture.end])).rows[0].n);
  assert.equal(agentConversationUnion,7);assert.equal(legacy.agents.agents.reduce((s,a)=>s+a.conversationsReplied,0),9);
 const expectedOverview={current:{unassigned:6,unread:8,waitingOverSla:4,unknownWaiting:1,overdue:3},
  period:{conversations:8,commentThreads:1,resolved:2,firstResponses:4,avgFirstResponseSeconds:270,slaMet:4,slaMissed:2,slaDenominator:6,slaRate:67,humanEvaluableConversations:7,unknownHumanConversations:1},
  messages:{incoming:12,outgoing:12,humanOutgoing:9,botOutgoing:2,unknownOutgoing:1},customers:{active:10,new:4,returning:7},
  channels:[{channel:'comment',value:1},{channel:'messenger',value:7},{channel:'telegram',value:1}],daily:[{date:'2026-10-05',received:8,resolved:2}],
  hours:Array.from({length:24},(_,hour)=>({hour,value:({0:2,1:2,2:1,3:1,4:2,5:2,20:1,23:1})[hour]??0}))};
 for(const key of Object.keys(expectedOverview))assert.deepEqual(data[key],expectedOverview[key]);
 fs.writeFileSync(path.join(output,'fixture-results.json'),JSON.stringify({fixture:'isolated in-memory PostgreSQL (PGlite); no production data',expectedOverview,overview:data,longYearOverview:year,expectedLegacy,legacy,agentConversationUnion,emptyLegacy:emptyLegacy.summary,
   payloadBytes:{before:['customers','conversations','agents'].reduce((sum,key)=>sum+Buffer.byteLength(JSON.stringify({success:true,businessId:fixture.A,analytics:legacy[key]})),0),after:Buffer.byteLength(JSON.stringify({success:true,businessId:fixture.A,analytics:data}))}},null,2));
 await db.exec('BEGIN');
 await db.query("UPDATE public.messages SET sent_by_member_id=$1 WHERE raw_payload ? 'auto_reply_job_id'",[fixture.M1]);
 assert.deepEqual((await overview()).period,data.period);assert.equal((await overview()).messages.botOutgoing,2);
 await db.query('UPDATE public.messages SET sent_by_member_id=$1 WHERE conversation_id=$2 AND direction=$3',[fixture.id(90),fixture.id(215),'outgoing']);
 const foreign=await overview();assert.equal(foreign.period.firstResponses,3);assert.equal(foreign.period.unknownHumanConversations,2);
 await db.query('UPDATE public.conversations SET social_account_id=$1 WHERE id=$2',[fixture.id(34),fixture.id(204)]);
 assert.equal((await overview()).period.conversations,7);
 await db.exec('ROLLBACK');
 await db.exec('BEGIN');
 await db.query('INSERT INTO public.messages(id,business_id,conversation_id,direction,created_at) VALUES($1,$2,$3,$4,$5)',[fixture.id(998),fixture.A,fixture.id(212),'system',fixture.start]);
 const systemOnly=await overview();assert.equal(systemOnly.customers.active,11);assert.deepEqual(systemOnly.messages,data.messages);
 await db.exec('ROLLBACK');
 await db.exec('SET ROLE authenticated');
 await db.exec('RESET ROLE');
 const sessionTimezone=(await db.query('SHOW TimeZone')).rows[0].TimeZone;
 await db.exec("SET TIME ZONE 'UTC'");assert.deepEqual(await overview(),data,'IANA buckets independent of DB session timezone');
 const utcLegacy=(await db.query('SELECT public.get_tenh_conversation_reports($1,$2,$3,600,0) data',[fixture.A,fixture.start,fixture.end])).rows[0].data;
 assert.deepEqual(utcLegacy.daily,[{date:'2026-10-05',received:11,resolved:2}]);
 const saved=JSON.parse(fs.readFileSync(path.join(output,'fixture-results.json')));saved.timezoneAudit={sessionTimezone,legacySessionDaily:legacy.conversations.daily,expectedUtcDaily:[{date:'2026-10-05',received:11,resolved:2}],legacyUtcDaily:utcLegacy.daily,newOverviewIndependentOfSessionTimezone:true};fs.writeFileSync(path.join(output,'fixture-results.json'),JSON.stringify(saved,null,2));
 await db.exec('SET ROLE authenticated');
 await assert.rejects(overview(),/permission denied/);await db.exec('RESET ROLE');
 await db.exec('SET ROLE service_role');assert.equal((await overview()).period.conversations,8);await db.exec('RESET ROLE');
 } finally {await db.close();}
});
test('calendar windows respect exact boundaries, rolling periods, timezone changes and DST',()=>{
 const range=(period,now,zone)=>metrics.overviewRange(period,new Date(now),zone);
 assert.equal(range('today','2026-10-05T02:00:00Z','Asia/Phnom_Penh').start.toISOString(),'2026-10-04T17:00:00.000Z');
 const spring=range('yesterday','2026-03-09T12:00:00Z','America/New_York');assert.equal(spring.end-spring.start,23*3600000);
 const fall=range('yesterday','2026-11-02T12:00:00Z','America/New_York');assert.equal(fall.end-fall.start,25*3600000);
 assert.equal(range('7d','2026-10-05T12:00:00Z','UTC').start.toISOString(),'2026-09-28T12:00:00.000Z');
 assert.equal(metrics.explicitAnalyticsRange(new URLSearchParams('start=bad&end=bad'),new Date(fixture.snapshot),{start:new Date(fixture.start),end:new Date(fixture.end)}),null);
});
test('missing fields, incomplete hourly buckets and inconsistent chart totals cannot become zero or 100 percent',()=>{
 assert.equal(metrics.verifiedOverview({}),false);
 const evidence=path.join(root,'docs/evidence/analytics-redesign-20261007/fixture-results.json');if(!fs.existsSync(evidence))return;
 const base=JSON.parse(fs.readFileSync(evidence)).overview;
 for(const mutate of [x=>delete x.current.unread,x=>x.hours.pop(),x=>x.channels[0].value++,x=>x.daily[0].received++,x=>x.period.slaRate=100]){
  const data=structuredClone(base);mutate(data);assert.equal(metrics.verifiedOverview(data),false);
 }
});
