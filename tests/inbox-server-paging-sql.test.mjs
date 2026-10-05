import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const engineRoot=process.env.TENH_PGLITE_ROOT;
if(!engineRoot){test('isolated Inbox PostgreSQL execution',{skip:'Supply an already installed PGlite through TENH_PGLITE_ROOT; no installation or live access is performed.'},()=>{});}else{
 const {PGlite}=createRequire(resolve(engineRoot,'package.json'))('@electric-sql/pglite');
 const db=new PGlite();
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const U=id(9900),OTHER=id(9901),B=id(9000),B2=id(9001),EXPIRED=id(9002),REVOKED=id(9003),M=id(9100),M2=id(9101),S=id(9200),S2=id(9201),T=id(9300),T2=id(9301);
 const paging=readFileSync(new URL('../db/migrations/20261003_inbox_server_paging.sql',import.meta.url),'utf8');
 before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table businesses(id uuid primary key);
   create table team_members(id uuid primary key,business_id uuid,user_id uuid,is_active boolean,created_at timestamptz default now());
   create table business_subscriptions(business_id uuid,status text,current_period_end timestamptz,trial_ends_at timestamptz,created_at timestamptz default now());
   create table social_accounts(id uuid primary key,business_id uuid,platform text,platform_account_id text,is_active boolean,facebook_token_status text,telegram_token_status text);
   create table contacts(id uuid primary key,business_id uuid,full_name text,phone text,platform_user_id text,telegram_username text);
   create table conversations(id uuid primary key,business_id uuid,social_account_id uuid,contact_id uuid,status text,unread_count integer,is_pinned boolean,last_message_at timestamptz,updated_at timestamptz,assigned_to uuid,source_type text,last_message_text text);
  create table tags(id uuid primary key,business_id uuid,name text);create table contact_tags(contact_id uuid,tag_id uuid);
   create table inbox_saved_views(id uuid primary key,business_id uuid,member_id uuid,filters jsonb);
   create table messages(id uuid primary key default gen_random_uuid(),business_id uuid,conversation_id uuid,message_text text,platform_message_id text,sender_platform_id text,direction text,is_echo boolean default false,raw_payload jsonb,platform_created_at timestamptz,created_at timestamptz default now());`);
  // Execute all three existing Bot migrations alongside paging in the disposable database.
  // Embedded execution substitutes ordinary indexes; concurrent build/locking is not validated.
  for(const file of ['20260930_facebook_auto_reply.sql','20261001_facebook_auto_reply_safety.sql','20261002_facebook_auto_reply_recovery_test_gate.sql'])
   await db.exec(readFileSync(new URL('../db/migrations/'+file,import.meta.url),'utf8').replaceAll('create index concurrently','create index'));
  await db.exec(paging);
  await db.exec('grant select on team_members,business_subscriptions,social_accounts,contacts,conversations,tags,contact_tags,messages to service_role');
 });
 after(()=>db.close());
 beforeEach(async()=>{
  await db.exec('truncate businesses,team_members,business_subscriptions,social_accounts,contacts,conversations,tags,contact_tags,messages,inbox_saved_views cascade');
  await db.query('insert into businesses values($1),($2),($3),($4)',[B,B2,EXPIRED,REVOKED]);
  await db.query('insert into team_members(id,business_id,user_id,is_active) values($1,$2,$3,true),($4,$5,$3,true),($6,$7,$3,true),($8,$9,$3,false)',[M,B,U,M2,B2,id(9102),EXPIRED,id(9103),REVOKED]);
  await db.query("insert into business_subscriptions values($1,'active',now()+interval '1 day',null,now()),($2,'active',now()+interval '1 day',null,now()),($3,'trialing',now()-interval '1 day',now()-interval '1 day',now())",[B,B2,EXPIRED]);
  await db.query("insert into social_accounts values($1,$2,'facebook','123',true,'verified',null),($3,$4,'telegram','tg',true,null,'verified'),($5,$6,'facebook','expired',true,'verified',null),($7,$8,'facebook','revoked',true,'verified',null),($9,$2,'facebook','offline',true,'disconnected',null)",[S,B,S2,B2,id(9202),EXPIRED,id(9203),REVOKED,id(9204)]);
  await db.query("insert into tags values($1,$2,'VIP'),($3,$4,'VIP')",[T,B,T2,B2]);
  for(let n=1;n<=260;n++){
   await db.query("insert into contacts(id,business_id,full_name,phone,platform_user_id) values($1,$2,$3,$4,$5)",[id(2000+n),B,'Customer '+n,'555'+n,'fb'+n]);
   await db.query("insert into conversations values($1,$2,$3,$4,$5,$6,$7,$8,'2026-09-30T20:00:00Z',$9,$10,$11)",[id(n),B,S,id(2000+n),n%10===0?'closed':'open',n%3===0?0:2,n===260?null:[75,175].includes(n),n===260?null:new Date(Date.UTC(2026,8,30,0,0,1000-(n===2?1:n))).toISOString(),n%4===0?M:null,n%5===0?'comment':'messenger','Preview '+n]);
   if(n%7===0)await db.query('insert into contact_tags values($1,$2)',[id(2000+n),T]);
  }
  for(let n=1;n<=30;n++){
   await db.query("insert into contacts values($1,$2,$3,'222',$4,$5)",[id(2500+n),B2,'Telegram '+n,'tg'+n,'@handle'+n]);
   await db.query("insert into conversations values($1,$2,$3,$4,'open',1,false,'2026-09-29T00:00:00Z','2026-09-30T20:00:00Z',$5,'telegram','Telegram preview')",[id(500+n),B2,S2,id(2500+n),n%2===0?M2:null]);
   if(n%7===0)await db.query('insert into contact_tags values($1,$2)',[id(2500+n),T2]);
  }
  for(const [n,b,s]of[[601,EXPIRED,id(9202)],[701,REVOKED,id(9203)],[801,B,id(9204)]])await db.query("insert into conversations values($1,$2,$3,null,'open',1,false,now(),now(),null,'messenger','excluded')",[id(n),b,s]);
 });
 const read=async(request={},views=[],snapshot=false,user=U,businesses=[B,B2,EXPIRED,REVOKED])=>(await db.query('select tenh_inbox_page($1,$2,$3,$4,$5) as page',[user,businesses,JSON.stringify({status:'all',view:'all',search:'',workspaceContextId:B,...request}),JSON.stringify(views),snapshot])).rows[0].page;
 test('combined migration manifest executes; rule/worker defaults remain disabled and trigger detached',async()=>{
  assert.equal((await db.query("select count(*)::integer n from pg_trigger where tgname='facebook_auto_reply_enqueue'")).rows[0].n,0);
  const draft=(await db.query("insert into facebook_auto_reply_rules(business_id,social_account_id,name,public_template,enabled) values($1,$2,'Fixture','No real send',true) returning enabled",[B,S])).rows[0];assert.equal(draft.enabled,false);
  assert.equal((await db.query('select count(*)::integer n from facebook_auto_reply_jobs')).rows[0].n,0);
 });
 test('30-row default/cap, full counts and pin/time/id cursor are complete over all authorized businesses',async()=>{
  const first=await read();assert.equal(first.ids.length,30);assert.equal(first.total,290);assert.equal(first.counts.statusCounts.all,290);assert.equal(first.counts.statusCounts.closed,26);assert.equal(first.counts.views.unread,204);assert.equal(first.counts.totalUnreadCount,378);assert.equal(first.ids[0],id(75));assert.equal(first.ids[1],id(175));assert.equal(first.ids[2],id(2));assert.equal((await read({size:1000})).ids.length,30);
  const seen=[...first.ids];let cursor=first.cursor,more=first.hasMore;while(more){const p=await read({cursor});seen.push(...p.ids);cursor=p.cursor;more=p.hasMore;}assert.equal(seen.length,290);assert.equal(new Set(seen).size,290);assert.equal(seen.at(-1),id(260));
 });
 test('membership, expiry, enabled token rules, workspace/channel and caller identity are enforced',async()=>{
  assert.equal((await read({},[],false,OTHER)).total,0);assert.equal((await read({workspaceId:EXPIRED})).total,0);assert.equal((await read({workspaceId:REVOKED})).total,0);assert.equal((await read({channelId:id(9204)})).total,0);assert.equal((await read({workspaceId:B2,channelId:S})).total,0);assert.equal((await read({channelId:S2})).total,30);
  await db.query("update social_accounts set telegram_token_status='disconnected' where id=$1",[S2]);assert.equal((await read()).total,260);
 });
 test('All/Unread/Comments/Pinned/My/Unassigned/status filters use full counts before LIMIT',async()=>{
  for(const [view,total]of[['all',290],['unread',204],['comment',52],['pinned',2],['my',80],['unassigned',210],['open',264]])assert.equal((await read({view})).total,total,view);
  const open=await read({status:'open',view:'comment'});assert.equal(open.total,26);assert.equal(open.counts.views.all,264);assert.equal(open.counts.statusCounts.all,290);
 });
 test('Smart Views apply scoped tags, legacy names, assignment and workspace context before paging',async()=>{
  const V=id(9500),views=[{id:V,filters:{workspaceScope:'selected',workspaceIds:[B],tagIds:[B+'::'+T],status:'any',assignment:'any',channel:'any',unreadOnly:false,pinnedOnly:false}}];
  const p=await read({view:'saved:'+V},views);assert.equal(p.total,37);assert.equal(p.ids.length,30);assert.equal(p.counts.views['saved:'+V],37);
  views[0].filters.tagIds=['VIP'];assert.equal((await read({view:'saved:'+V},views)).total,37);views[0].filters.workspaceScope='all';assert.equal((await read({view:'saved:'+V},views)).total,0);
  views[0].filters={workspaceScope:'current',tagIds:[],assignment:'me'};assert.equal((await read({view:'saved:'+V,workspaceContextId:B2},views)).total,15);
 });
 test('literal phone/Telegram/history search includes off-page matches beyond the old 200-message cap',async()=>{
  assert.equal((await read({search:'@handle30'})).ids[0],id(530));assert.equal((await read({search:'555259'})).ids[0],id(259));
  for(let n=1;n<=250;n++)await db.query("insert into messages(business_id,conversation_id,message_text) values($1,$2,'needle-only-in-history')",[B,id(n)]);
  const p=await read({search:'needle-only-in-history'});assert.equal(p.total,250);assert.equal(p.ids.length,30);assert.equal((await read({search:'needle-only-in-history',view:'comment'})).total,50);
  assert.equal((await read({search:'%'})).total,0);assert.equal((await read({search:'ne'})).total,0);
 });
 test('targeted membership and complete explicit unread snapshots are read-only',async()=>{
  const p=await read({view:'unread',knownIds:[id(1),id(3),id(601)]});assert.deepEqual(p.matchedKnownIds,[id(1)]);
  const before=(await db.query('select sum(unread_count)::integer n from conversations')).rows[0].n;const snapshot=await read({view:'unread'},[],true);assert.equal(snapshot.ids.length,0);assert.equal(snapshot.readTargets.length,204);assert.ok(snapshot.readTargets.every(r=>r.unreadCount>0&&r.updatedAt));assert.equal((await db.query('select sum(unread_count)::integer n from conversations')).rows[0].n,before);
 });
 test('anonymous/authenticated cannot execute; service-role execution retains tenant filtering',async()=>{
  for(const role of ['anon','authenticated']){assert.equal((await db.query("select has_function_privilege($1,'tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)','EXECUTE') allowed",[role])).rows[0].allowed,false);}
  await db.exec('set role service_role');try{assert.equal((await read()).total,290);}finally{await db.exec('reset role');}
  assert.equal((await db.query("select prosecdef from pg_proc where oid='tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)'::regprocedure")).rows[0].prosecdef,false);
 });
 test('paging migration is rerunnable and grants stay restricted',async()=>{await db.exec(paging);assert.equal((await read()).total,290);assert.equal((await db.query("select has_function_privilege('authenticated','tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)','EXECUTE') allowed")).rows[0].allowed,false);});
 test('a failed paging migration rolls back its DDL and keeps the installed read contract',async()=>{
  const invalid=paging.replace('BEGIN;','BEGIN; CREATE TABLE deployment_atomic_probe(id integer);').replace('FROM conversations c JOIN scope','FROM deployment_missing_core_table c JOIN scope');
  await assert.rejects(db.exec(invalid));await db.exec('ROLLBACK');assert.equal((await db.query("select to_regclass('public.deployment_atomic_probe') name")).rows[0].name,null);assert.equal((await read()).total,290);
 });
 test('optional index proposals execute against compatible fixture columns, without concurrent-build claims',async()=>{
  const proposals=readFileSync(new URL('../docs/sql/inbox-performance-index-proposals.sql',import.meta.url),'utf8');const statements=proposals.match(/CREATE INDEX CONCURRENTLY IF NOT EXISTS[\s\S]*?;/g);assert.equal(statements.length,3);
  for(const statement of statements)await db.exec(statement.replace('CONCURRENTLY ',''));
  const indexes=(await db.query("select indexname,indexdef from pg_indexes where indexname in ('idx_messages_conversation_platform_created_id','idx_conversations_business_inbox_order','idx_messages_platform_message_lookup')")).rows;assert.equal(indexes.length,3);assert.match(indexes.find(r=>r.indexname==='idx_messages_conversation_platform_created_id').indexdef,/platform_created_at DESC/);
 });
 test('real Inbox SSR page and page API execute against isolated SQL with fixture authentication',async()=>{
  const {loader}=createRequire(import.meta.url)('./tenh-seven/harness.cjs');let signedOut=false;
  const admin={from(table){assert.ok(['team_members','inbox_saved_views'].includes(table));const filters=[],params=[];const chain={select:()=>chain,eq:(key,value)=>{assert.match(key,/^[a-z_]+$/);params.push(value);filters.push(key+'=$'+params.length);return chain},in:(key,values)=>{assert.match(key,/^[a-z_]+$/);params.push(values);filters.push(key+'=ANY($'+params.length+')');return chain},then:(yes,no)=>db.query('select * from '+table+(filters.length?' where '+filters.join(' and '):''),params).then(result=>({data:result.rows,error:null})).then(yes,no)};return chain},
   rpc:async(name,args)=>{assert.equal(name,'tenh_inbox_page');return {data:(await db.query('select tenh_inbox_page($1,$2,$3,$4,$5) page',[args.p_user_id,args.p_business_ids,JSON.stringify(args.p_request),JSON.stringify(args.p_views),args.p_snapshot])).rows[0].page,error:null}}};
  const scope=async()=>{if(signedOut)throw Error('Fixture signed out');return {accessibleBusinessIds:[B,B2],currentBusinessId:B}};
  const getRows=async(businesses,filter={})=>(await db.query(`select to_jsonb(c)||jsonb_build_object('contact',to_jsonb(ct),'social_account',to_jsonb(a)) row
   from conversations c join social_accounts a on a.id=c.social_account_id left join contacts ct on ct.id=c.contact_id
   where c.business_id=ANY($1::uuid[]) and c.id=ANY($2::uuid[]) and ($3::uuid is null or c.social_account_id=$3) and ($4::uuid is null or c.business_id=$4)`,[businesses,filter.conversationIds??[],filter.channelId??null,filter.workspaceId??null])).rows.map(r=>r.row);
  const load=loader({'next/server':{NextResponse:Response,after:()=>{}},'@/lib/auth/get-current-member':{getCurrentMember:async()=>signedOut?{success:false,status:401,error:'Fixture signed out'}:{success:true,user:{id:U},member:{id:M,business_id:B}}},
   '@/lib/supabase/admin':{supabaseAdmin:admin},'@/lib/inbox/get-conversations':{preloadInboxConversationChannels:async()=>{},getInboxConversationScope:scope,getConversations:getRows},
   '@/lib/inbox/get-messages':{getMessages:async()=>[]},'@/lib/inbox/get-team-members':{getTeamMembers:async()=>[]},'@/components/inbox/inbox-view':{InboxView:()=>null}});
  const api=load('app/api/inbox/conversation-page/route.ts');const request=body=>new Request('http://127.0.0.1/api/inbox/conversation-page',{method:'POST',body:JSON.stringify(body)});
  const result=await api.POST(request({view:'comment',memberIds:{[B]:id(9999)}}));assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'private, no-store');const payload=await result.json();assert.equal(payload.page.conversations.length,30);assert.equal(payload.page.total,52);
  const snapshot=await api.POST(request({view:'unread',snapshot:true}));assert.equal((await snapshot.json()).page.readTargets.length,204);
  const page=load('app/dashboard/inbox/page.tsx').default;const tree=await page({searchParams:Promise.resolve({conversation:id(260)})});const props=tree.props.children.props.children.props;
  assert.equal(props.conversations.length,31);assert.equal(props.pagination.page.ids.length,30);assert.equal(props.pagination.page.ids.includes(id(260)),false);assert.equal(props.activeConversationId,id(260));
  signedOut=true;assert.equal((await api.POST(request({}))).status,401);
  // Real server route/page functions and SQL; browser hydration and real Supabase cookies are not exercised here.
 });
}
