const test=require('node:test'),assert=require('node:assert/strict');
const {loader,database,baseSeed}=require('../tests/tenh-seven/harness.cjs');
const WORKER='lib/facebook/recover-facebook-today.ts', DAY='lib/facebook/recovery-day.ts';
const page='393342417206745', customer='38260761283571256';
const midnight='2026-09-12T17:00:00.000Z', now='2026-09-13T10:00:00.000Z';
const thread=(id='t_one',updated=now,psid=customer)=>({id,updated_time:updated,participants:{data:[{id:page},{id:psid}]}});
const message=(id='m1',time='2026-09-13T09:00:00.000Z',psid=customer)=>({id,created_time:time,from:{id:psid},to:{data:[{id:page}]},message:'hello'});
const paging=after=>({next:'https://graph.facebook.com/ignored?access_token=SECRET',cursors:{after}});
function setup(options={}){
 let clock=Date.parse(options.now||now);class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const seed=baseSeed();Object.assign(seed.social_accounts[0],{platform_account_id:page,facebook_backfill_requested_at:now});
 seed.facebook_today_recovery=[];const db=database(seed),calls=[],events=[],comments=[],warnings=[];
 const env={TENH_TIMEZONE:'Asia/Phnom_Penh',...options.env};
 const graph=async args=>{
  calls.push(args);const payload=options.graph?await options.graph(args,calls):args.path.endsWith('/conversations')?{data:[thread()]}:{data:[message()]};
  return {ok:!payload.error,status:payload.error?400:200,payload,accessToken:args.accessToken,tokenRepaired:false};
 };
 const processMessage=async event=>{
  if(options.process)await options.process(event);
  events.push(event);db.tables.messages.push({id:'db_'+event.message.mid,platform_message_id:event.message.mid,conversation_id:'conv1'});
 };
 const load=loader({
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/facebook/facebook-connection-health':{facebookGraphJsonWithTokenRecovery:graph},
  '@/lib/facebook/process-message':{processFacebookMessage:processMessage},
  '@/lib/facebook/process-comment':{processFacebookComment:async event=>{comments.push(event);}},
 },{Date:Clock,structuredClone,process:{env},console:{warn:(...args)=>warnings.push(args),info:()=>{}}});
 const run=()=>load(WORKER).recoverFacebookToday({pageId:page,socialAccountId:'s1',accessToken:'PAGE_TOKEN',normalizeAttachment:()=>null});
 return {run,load,db,calls,events,comments,warnings,clock:value=>{clock=Date.parse(value);}};
}
test('today is exact Cambodia midnight, with no one-hour minimum or seconds drift',()=>{
 const h=setup(),f=h.load(DAY).facebookRecoveryDay;
 for(const time of ['2026-09-12T17:00:00.000Z','2026-09-12T17:00:05.999Z','2026-09-12T17:30:22.123Z',now])
  assert.equal(new Date(f(Date.parse(time),'Asia/Phnom_Penh').startMs).toISOString(),midnight);
});
test('invalid timezone falls back to Cambodia and daylight-saving boundaries remain calendar days',()=>{
 const f=setup().load(DAY).facebookRecoveryDay;
 assert.equal(new Date(f(Date.parse(now),'invalid/zone').startMs).toISOString(),midnight);
 assert.equal(new Date(f(Date.parse('2026-03-08T17:00:00Z'),'America/New_York').startMs).toISOString(),'2026-03-08T05:00:00.000Z');
 assert.equal(new Date(f(Date.parse('2026-11-01T17:00:00Z'),'America/New_York').startMs).toISOString(),'2026-11-01T04:00:00.000Z');
});
test('first connection imports today only and rejects missing timestamps and future dates',async()=>{
 const h=setup({now:'2026-09-12T17:05:00Z',graph:async args=>args.path.endsWith('/conversations')?{data:[thread('t_one','2026-09-12T17:04:00Z'),thread('t_old','2026-09-12T16:59:00Z')],paging:paging('OLD')}: {data:[message('today',midnight),message('yesterday','2026-09-12T16:59:59.999Z'),message('unknown','invalid'),message('future','2026-09-13T17:01:00Z')],paging:paging('OLDER')}});
 const r=await h.run();assert.equal(r.recovered,1);assert.equal(r.truncated,false);assert.deepEqual(h.events.map(e=>e.message.mid),['today']);
 assert.equal(h.calls.length,2);assert.equal(h.calls[0].params.limit,20);assert.equal(h.calls[0].params.platform,'MESSENGER');assert.equal(h.calls[1].params.limit,50);
});
test('message pagination resumes after fifty without re-fetching the conversation list or duplicating messages',async()=>{
 const h=setup({graph:async args=>args.path.endsWith('/conversations')?{data:[thread()]}:args.params.after?{data:Array.from({length:10},(_,i)=>message('m'+(i+50)))}:{data:Array.from({length:50},(_,i)=>message('m'+i)),paging:paging('NEXT')}});
 const first=await h.run();assert.equal(first.recovered,50);assert.equal(first.truncated,true);assert.equal(h.db.tables.facebook_today_recovery[0].cursor.active.after,'NEXT');
 const second=await h.run();assert.equal(second.recovered,10);assert.equal(second.truncated,false);assert.equal(h.calls.filter(c=>c.path.endsWith('/conversations')).length,1);
 assert.equal(new Set(h.events.map(e=>e.message.mid)).size,60);assert.ok(h.calls.every(c=>!c.path.startsWith('https:')));
});
test('conversation pagination continues in batches of twenty and each pass stays within its request budget',async()=>{
 const h=setup({graph:async args=>{
  if(args.path.endsWith('/conversations'))return args.params.after?{data:[thread('t_twentyone')]}:{data:Array.from({length:20},(_,i)=>thread('t_'+i)),paging:paging('MORE_THREADS')};
  return {data:[message('m_'+args.path.split('/')[0])]};
 }});
 let r;for(let i=0;i<8;i++){const before=h.calls.length;r=await h.run();assert.ok(h.calls.length-before<=6);if(!r.truncated)break;}
 assert.equal(r.truncated,false);assert.equal(h.events.length,21);assert.equal(h.calls.filter(c=>c.path.endsWith('/conversations')).length,2);
 assert.equal(h.calls.find(c=>c.params.after==='MORE_THREADS').params.limit,20);
});
test('retry after a partial write resumes the same page and skips committed message IDs',async()=>{
 let fail=true;const h=setup({graph:async args=>args.path.endsWith('/conversations')?{data:[thread()]}:{data:[message('first'),message('second')]},process:async e=>{if(e.message.mid==='second'&&fail){fail=false;throw new Error('Temporary failure');}}});
 const a=await h.run();assert.equal(a.failed,1);assert.equal(a.truncated,true);
 const b=await h.run();assert.equal(b.failed,0);assert.equal(b.truncated,false);assert.deepEqual(h.events.map(e=>e.message.mid),['first','second']);
});
test('overlapping OAuth and watchdog batches use a Page lease instead of importing twice',async()=>{
 let finish,started;const began=new Promise(resolve=>{started=resolve;});
 const h=setup({graph:args=>{if(args.path.endsWith('/conversations')){started();return new Promise(resolve=>{finish=()=>resolve({data:[thread()]});});}return {data:[message()]};}});
 const first=h.run();await began;const second=await h.run();assert.equal(second.recovered,0);assert.equal(second.truncated,true);assert.equal(h.calls.length,1);
 finish();await first;assert.equal(h.events.length,1);assert.equal(h.db.tables.facebook_today_recovery[0].lease_id,null);
});
test('an expired lease is reclaimable and a finished checkpoint causes no more Graph reads',async()=>{
 const h=setup();h.db.tables.facebook_today_recovery.push({social_account_id:'s1',cursor:{},lease_id:'old',lease_until:'2026-09-12T00:00:00Z'});
 assert.equal((await h.run()).truncated,false);const n=h.calls.length;assert.equal((await h.run()).truncated,false);assert.equal(h.calls.length,n);
});
test('a new reconnect resets the scan while retaining message deduplication',async()=>{
 const h=setup();await h.run();h.db.tables.social_accounts[0].facebook_backfill_requested_at='2026-09-13T10:01:00Z';h.clock('2026-09-13T10:01:00Z');
 await h.run();assert.equal(h.calls.filter(c=>c.path.endsWith('/conversations')).length,2);assert.equal(h.events.length,1);
});
test('a next-day retry discards the old checkpoint and cannot import yesterday',async()=>{
 let day=0;const h=setup({graph:async args=>args.path.endsWith('/conversations')?{data:[thread('t_one',day?'2026-09-13T17:01:00Z':now)]}:day?{data:[message('new','2026-09-13T17:00:00Z'),message('yesterday','2026-09-13T16:59:59Z')]}:{data:Array.from({length:50},(_,i)=>message('old'+i)),paging:paging('YESTERDAY_CURSOR')}});
 assert.equal((await h.run()).truncated,true);day=1;h.clock('2026-09-13T17:05:00Z');
 const r=await h.run();assert.equal(r.recovered,1);assert.equal(h.events.at(-1).message.mid,'new');assert.equal(h.calls.filter(c=>c.params.after==='YESTERDAY_CURSOR').length,0);
});
test('wrong Page, group participants and mismatched message senders never enter the inbox',async()=>{
 const h=setup({graph:async args=>args.path.endsWith('/conversations')?{data:[thread(),{...thread('t_foreign'),participants:{data:[{id:'OTHER_PAGE'},{id:customer}]}},{...thread('t_group'),participants:{data:[{id:page},{id:customer},{id:'99999'}]}}]}:{data:[message('wrong','2026-09-13T09:00:00Z','99999'),{...message('outgoing'),from:{id:page},to:{data:[{id:customer}]}}]}});
 await h.run();assert.deepEqual(h.events.map(e=>e.message.mid),['outgoing']);assert.equal(h.events[0].message.is_echo,true);
 const foreign=setup();foreign.db.tables.social_accounts[0].platform_account_id='OTHER_PAGE';assert.equal((await foreign.run()).failed,1);assert.equal(foreign.calls.length,0);
});
test('missing migration fails before Meta reads and preserves an incomplete status for retry',async()=>{
 const h=setup();delete h.db.tables.facebook_today_recovery;const r=await h.run();assert.equal(r.failed,1);assert.equal(r.truncated,true);assert.equal(h.calls.length,0);
});
test('rate errors do not fall through to history scans or unbounded retries',async()=>{
 const h=setup({graph:async()=>({error:{code:4,message:'Rate limit'}})});const r=await h.run();assert.equal(r.failed,1);assert.equal(r.truncated,true);assert.equal(h.calls.length,1);assert.equal(h.db.tables.facebook_today_recovery[0].lease_id,null);
});
test('only the bounded attachment-field fallback is retried for an unsupported-field response',async()=>{
 const h=setup({graph:async args=>args.path.endsWith('/conversations')?{data:[thread()]}:args.params.fields.includes('attachments')?{error:{code:100}}:{data:[message()]}});
 const r=await h.run();assert.equal(r.recovered,1);assert.equal(h.calls.length,3);assert.equal(h.calls.at(-1).params.limit,50);
});
test('missing pagination cursors fail without following the provider next URL',async()=>{
 const h=setup({graph:async()=>({data:[thread()],paging:{next:'https://evil.test/steal'}})});const r=await h.run();assert.equal(r.failed,1);assert.equal(h.calls.length,1);assert.equal(h.events.length,0);
});
test('reconnect entry point cannot widen today through lookback arguments or environment overrides',async()=>{
 const h=setup({now:'2026-09-12T17:05:00Z',env:{FACEBOOK_RECONNECT_RECOVERY_LOOKBACK_MINUTES:'10080'},graph:async args=>
  args.path.endsWith('/feed')?{data:[]}:args.path.endsWith('/conversations')?{data:[thread('t_one','2026-09-12T17:04:00Z')]}:{data:[message('today',midnight),message('old','2026-09-12T16:59:59Z')]}});
 const r=await h.load('lib/facebook/recover-facebook-missed-data.ts').recoverRecentFacebookData({pageId:page,socialAccountId:'s1',accessToken:'PAGE_TOKEN',mode:'reconnect',lookbackMinutes:10080});
 assert.equal(r.messenger.recovered,1);assert.deepEqual(h.events.map(e=>e.message.mid),['today']);assert.equal(h.calls.find(c=>c.path.endsWith('/feed')).params.limit,20);
});
test('checkpoint write failure retries committed IDs without losing the page',async()=>{
 const h=setup();h.db.failures.push({table:'facebook_today_recovery',op:'update',once:true,when:q=>q.body.cursor?.done===true});
 assert.equal((await h.run()).failed,1);assert.equal(h.events.length,1);
 const retry=await h.run();assert.equal(retry.truncated,false);assert.equal(h.events.length,1);
});
test('reconnect comments retain the midnight cutoff even if Meta returns older or undated comments',async()=>{
 const h=setup({now:'2026-09-12T17:05:00Z',graph:async args=>args.path.endsWith('/feed')?{data:[{id:'post1'}]}:args.path.endsWith('/comments')?{data:[{id:'today',created_time:midnight},{id:'old',created_time:'2026-09-12T16:59:59Z'},{id:'unknown'}]}:{data:[]}});
 await h.load('lib/facebook/recover-facebook-missed-data.ts').recoverRecentFacebookData({pageId:page,socialAccountId:'s1',accessToken:'PAGE_TOKEN',mode:'reconnect'});
 assert.deepEqual(h.comments.map(c=>c.value.comment_id),['today']);assert.equal(h.calls.find(c=>c.path.endsWith('/comments')).params.limit,50);
});
test('later watchdog runs cannot reimport pre-connection history after the today-only flag clears',async()=>{
 const h=setup({now:'2026-09-12T17:05:00Z',graph:async args=>args.path.endsWith('/feed')?{data:[]}:args.path.endsWith('/conversations')?{data:[{id:'t_one',updated_time:'2026-09-12T17:04:00Z',messages:{data:[message('today',midnight),message('old','2026-09-12T16:59:59Z')]}}]}:message(args.path,args.path==='old'?'2026-09-12T16:59:59Z':midnight)});
 h.db.tables.facebook_today_recovery.push({social_account_id:'s1',cursor:{version:1,pageId:page,dayStart:Date.parse(midnight)}});
 h.db.tables.social_accounts[0].facebook_backfill_requested_at=null;
 await h.load('lib/facebook/recover-facebook-missed-data.ts').recoverRecentFacebookData({pageId:page,socialAccountId:'s1',accessToken:'PAGE_TOKEN',mode:'watchdog'});
 assert.deepEqual(h.events.map(e=>e.message.mid),['today']);assert.ok(!h.calls.some(c=>c.path==='old'));
});
test('ordinary ongoing recovery keeps its rolling window across midnight after an earlier connection day',async()=>{
 const h=setup({now:'2026-09-12T17:05:00Z',graph:async args=>args.path.endsWith('/feed')?{data:[]}:args.path.endsWith('/conversations')?{data:[{id:'t_one',updated_time:'2026-09-12T17:04:00Z',messages:{data:[message('missed','2026-09-12T16:59:59Z')]}}]}:message('missed','2026-09-12T16:59:59Z')});
 h.db.tables.facebook_today_recovery.push({social_account_id:'s1',cursor:{version:1,pageId:page,dayStart:Date.parse('2026-09-11T17:00:00Z')}});
 await h.load('lib/facebook/recover-facebook-missed-data.ts').recoverRecentFacebookData({pageId:page,socialAccountId:'s1',accessToken:'PAGE_TOKEN',mode:'watchdog'});
 assert.deepEqual(h.events.map(e=>e.message.mid),['missed']);
});

function cronSetup(recovery,changeFlag=false) {
 const seed=baseSeed();seed.social_accounts[0].facebook_backfill_requested_at=now;const db=database(seed),calls=[];
 const load=loader({
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/facebook/facebook-connection-health':{ensureFacebookPageConnectionHealthy:async()=>({healthy:true,accessToken:'SECRET',pageName:'Page'})},
  '@/lib/facebook/recover-facebook-missed-data':{recoverRecentFacebookData:async args=>{calls.push(args);if(changeFlag)db.tables.social_accounts[0].facebook_backfill_requested_at='2026-09-13T10:01:00Z';return recovery;}},
 },{process:{env:{CRON_SECRET:'cron'}},console:{warn:()=>{},info:()=>{}}});
 return {db,calls,run:()=>load('app/api/cron/facebook-connection-health/route.ts').GET(new Request('https://tenh.test/api/cron/facebook-connection-health',{headers:{authorization:'Bearer cron'}}))};
}
test('watchdog retains failed or capped reconnect requests and clears only complete ones',async()=>{
 for(const [failed,truncated] of [[1,false],[0,true],[0,false]]){
  const h=cronSetup({messenger:{recovered:0,failed,truncated},comments:{failed:0,recovered:0},tokenRepaired:false});
  const response=await h.run();assert.equal(h.calls[0].mode,'reconnect');assert.equal(h.calls[0].lookbackMinutes,undefined);
  assert.equal(h.db.tables.social_accounts[0].facebook_backfill_requested_at,failed||truncated?now:null);
  assert.ok(!(await response.text()).includes('SECRET'));
 }
});
test('an older background batch cannot clear a newer reconnect request',async()=>{
 const h=cronSetup({messenger:{recovered:1,failed:0,truncated:false},comments:{failed:0,recovered:0},tokenRepaired:false},true);
 await h.run();assert.equal(h.db.tables.social_accounts[0].facebook_backfill_requested_at,'2026-09-13T10:01:00Z');
});
