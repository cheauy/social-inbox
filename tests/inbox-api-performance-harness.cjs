/* Actual server modules with in-memory tenant/query/auth doubles. Never connects to Supabase. */
const {AsyncLocalStorage}=require('node:async_hooks');
const {createHash}=require('node:crypto');
const {loader,uuid}=require('./inbox-recovery-harness.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
function apiFixture({delayMs=0,fail=null,hold=null,allowNotificationMaterialization=false}={}){
  const fixedTime=process.env.TENH_API_FIXTURE_TIME;
  const FixtureDate=fixedTime?class extends Date{constructor(...args){super(...(args.length?args:[fixedTime]));}static now(){return Date.parse(fixedTime);}}:Date;
  const context=new AsyncLocalStorage(),events=[],tables={
    team_members:[900,910].map((business,i)=>({id:uuid(901+i*10),user_id:uuid(902+i*10),business_id:uuid(business),is_active:true,role:'owner',full_name:'Fixture Agent',email:'fixture@example.invalid',created_at:'2026-01-01T00:00:00Z'})),
    business_subscriptions:[900,910].map(id=>({id:uuid(id+50),business_id:uuid(id),status:'active',current_period_end:'2099-01-01T00:00:00Z',created_at:'2026-01-01T00:00:00Z'})),
    businesses:[900,910].map(id=>({id:uuid(id),name:'Fixture workspace',slug:'fixture-'+id})),
    social_accounts:[900,910].map(id=>({id:uuid(id-100),business_id:uuid(id),is_active:true,platform:'facebook',facebook_token_status:'verified'})),
    conversations:[900,910].map(id=>({id:uuid(id-899),business_id:uuid(id),contact_id:uuid(id+100),social_account_id:uuid(id-100),platform:'facebook',source_type:'messenger',status:'open',unread_count:1,is_pinned:false,last_message_at:new FixtureDate().toISOString(),updated_at:new FixtureDate().toISOString(),contact:{id:uuid(id+100),business_id:uuid(id),full_name:'Fixture customer',tags:[]},social_account:{id:uuid(id-100),business_id:uuid(id),platform:'facebook',facebook_token_status:'verified'}})),
    contact_tags:[],inbox_saved_views:[],conversation_reminders:[],team_notifications:[],messages:[],telegram_message_reaction_states:[],
  };
  let active=0,maxActive=0;
  async function execute(event,read){
    events.push(event);event.start=performance.now();active++;maxActive=Math.max(maxActive,active);
    try{if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));if(hold)await hold(event);
      if(fail?.(event))return {data:null,error:{message:'Injected fixture failure',code:'FIXTURE'}};
      return {data:clone(read()),error:null};
    }finally{event.end=performance.now();active--;}
  }
  class Query{
    constructor(table){this.table=table;this.filters=[];this.orders=[];this.max=Infinity;this.single=false;this.columns='';}
    select(columns=''){this.columns=columns;return this;}
    eq(key,value){this.filters.push(row=>row[key]===value);return this;}
    neq(key,value){this.filters.push(row=>row[key]!==value);return this;}
    in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}
    gte(key,value){this.filters.push(row=>row[key]>=value);return this;}
    lte(key,value){this.filters.push(row=>row[key]<=value);return this;}
    order(key,options={}){this.orders.push([key,options.ascending!==false]);return this;}
    limit(value){this.max=value;return this;}
    or(){return this;}
    maybeSingle(){this.single=true;return this.run();}
    then(resolve,reject){return this.run().then(resolve,reject);}
    update(){throw Error('A mutation must be explicitly mocked before it can be measured.');}
    insert(){throw Error('A mutation must be explicitly mocked before it can be measured.');}
    upsert(rows){if(this.table!=='team_notifications'||!allowNotificationMaterialization)throw Error('A mutation must be explicitly mocked before it can be measured.');this.upsertRows=clone(rows);return this;}
    run(){return execute({kind:this.upsertRows?'fixture_mutation':'db',table:this.table,columns:this.columns,identity:context.getStore()},()=>{
      if(!Object.hasOwn(tables,this.table))throw Error('Unseeded fixture table '+this.table);
      if(this.upsertRows){for(const row of this.upsertRows)if(!tables[this.table].some(current=>current.id===row.id))tables[this.table].push(row);return [];}
      const rows=tables[this.table].filter(row=>this.filters.every(fn=>fn(row))).sort((a,b)=>{for(const[key,asc]of this.orders)if(a[key]!==b[key])return (a[key]>b[key]?1:-1)*(asc?1:-1);return 0;}).slice(0,this.max);
      return this.single?rows[0]??null:rows;
    });}
  }
  const db={from:table=>new Query(table),rpc:(name,args)=>execute({kind:'rpc',name,args,identity:context.getStore()},()=>{
    if(name==='tenh_sync_subscription_lifecycle')return null; // Explicit fixture-only no-op, no external writes.
    if(name!=='tenh_inbox_page')throw Error('Unseeded fixture RPC '+name);
    const rows=tables.conversations.filter(row=>args.p_business_ids.includes(row.business_id));
    return {ids:rows.map(row=>row.id),total:rows.length,hasMore:false,cursor:null,counts:{views:{all:rows.length,unread:rows.length,pinned:0},statusCounts:{all:rows.length,open:rows.length,pending:0,resolved:0,closed:0,spam:0},totalUnreadCount:rows.length,unreadConversationCount:rows.length},readTargets:[],matchedKnownIds:[]};
  })};
  const load=loader({react:{cache:fn=>fn},'next/server':{NextResponse:{json(data,init){const start=performance.now();const response=Response.json(data,init);events.push({kind:'fixture_serialization',start,end:performance.now()});return response;}},after(){}},
    'next/headers':{cookies:async()=>({get:()=>({value:context.getStore()?.businessId||uuid(900)})})},
    '@/lib/supabase/admin':{supabaseAdmin:db},
    '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>{
      const result=await execute({kind:'auth',identity:context.getStore()},()=>{const id=context.getStore()?.userId;return id?{id,email:'fixture@example.invalid'}:null;});
      return {data:{user:result.data},error:result.error};
    }}})},
    '@/lib/server/usage-context':{attributeUsage(){},usageContext:{run:(_,fn)=>fn()}},
  },{AbortController,CustomEvent,Date:FixtureDate,console:{...console,error(){},warn(){}}});
  const defaultIdentity={userId:uuid(902),businessId:uuid(900)};
  const scoped=load('lib/server/request-scope.ts').withRequestScope;
  async function call(kind,identity=defaultIdentity,body={}){
    const routes={page:['app/api/inbox/conversation-page/route.ts','POST','/api/inbox/conversation-page'],live:['app/api/inbox/live-state/route.ts','POST','/api/inbox/live-state'],notifications:['app/api/team-notifications/route.ts','GET','/api/team-notifications'],messages:['app/api/conversations/[conversationId]/messages/route.ts','GET',`/api/conversations/${uuid(1)}/messages?limit=25`],workspaces:['app/api/workspaces/route.ts','GET','/api/workspaces']};
    const [file,method,url]=routes[kind],route=load(file);
    const payload=kind==='page'?{status:'all',view:'all',search:'',channelId:null,workspaceId:null,workspaceContextId:identity.businessId,cursor:null,...body}:kind==='live'?{conversationIds:[uuid(1)],...body}:null;
    const request=new Request('https://fixture.invalid'+url,{method,...(payload?{body:JSON.stringify(payload),headers:{'Content-Type':'application/json'}}:{})});
    request.nextUrl=new URL(request.url);
    const handler=kind==='notifications'?scoped(route[method]):route[method];
    const start=performance.now();
    const response=await context.run(identity,()=>handler(request,{params:Promise.resolve({conversationId:uuid(1)})}));
    const elapsedMs=performance.now()-start,decodeStart=performance.now(),text=await response.text();
    return {status:response.status,body:JSON.parse(text),elapsedMs,fixtureDecodeMs:performance.now()-decodeStart,responseBytes:Buffer.byteLength(text),responseSHA256:createHash('sha256').update(text).digest('hex')};
  }
  return {call,load,context,scoped,events,tables,db,get maxActive(){return maxActive;}};
}
module.exports={apiFixture,uuid};
