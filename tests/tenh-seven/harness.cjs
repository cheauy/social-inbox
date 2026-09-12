const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.env.TENH_TEST_ROOT || path.resolve(__dirname, '../..');
const ts = require('node:module').createRequire(path.join(ROOT, 'package.json'))('typescript');
const clone = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
function database(seed) {
 const tables = clone(seed), history = [], failures = [];
 function val(row,key) { if(key==='conversation.social_account_id') return tables.conversations?.find(c=>c.id===row.conversation_id)?.social_account_id;return row[key]; }
 class Query {
  constructor(name){this.name=name;this.op='read';this.filters=[];this.body=null;this.options={};this.singleResult=false;this.count=Infinity;}
  select(){return this;} order(){return this;}limit(n){this.count=n;return this;}
  eq(k,v){this.filters.push(row=>k==='raw_payload'?JSON.stringify(row[k])===(typeof v==='string'?v:JSON.stringify(v)):val(row,k)===v);return this;}
  is(k,v){this.filters.push(row=>(val(row,k)??null)===v);return this;}
  in(k,vs){this.filters.push(row=>vs.includes(val(row,k)));return this;}
  gt(k,v){this.filters.push(row=>val(row,k)>v);return this;}
  or(s){this.filters.push(row=>s.split(',').some(part=>{const [key,op,...vs]=part.split('.');const value=vs.join('.');return op==='is'?row[key]==null:op==='lt'?row[key]!=null&&row[key]<value:false;}));return this;}
  update(body){this.op='update';this.body=clone(body);return this;}
  upsert(body,options){this.op='upsert';this.body=clone(body);this.options=options||{};return this;}
  insert(body){this.op='insert';this.body=clone(body);return this;}
  delete(){this.op='delete';return this;}
  maybeSingle(){this.singleResult=true;return this.execute();}single(){this.singleResult=true;return this.execute();}
  then(resolve,reject){return this.execute().then(resolve,reject);}
  async execute(){
   history.push({table:this.name,op:this.op,body:clone(this.body)});
   const fail = failures.find(f=>f.table===this.name && (!f.op||f.op===this.op) && (!f.when||f.when(this)));
   if(fail){if(fail.once) failures.splice(failures.indexOf(fail),1);return {data:null,error:{message:fail.message||'Injected error',code:fail.code||'FAIL'}};}
   if(!tables[this.name]) return {data:null,error:{code:'42P01',message:'Missing table'}};
   const rows=tables[this.name];let found=rows.filter(r=>this.filters.every(fn=>fn(r))).slice(0,this.count);
   if(this.op==='update')found.forEach(r=>Object.assign(r,clone(this.body)));
   if(this.op==='upsert'||this.op==='insert') {
    const body=clone(this.body); const keys=(this.options.onConflict||'id').split(','); const old=rows.find(r=>keys.every(k=>body[k]!==undefined&&r[k]===body[k]));
    if(old) {if(!this.options.ignoreDuplicates)Object.assign(old,body); found=[old];}
    else{if(this.name==='facebook_customer_blocks'){Object.assign(body,{is_blocked:false,operation_id:null,operation_started_at:null,requested_blocked:null});}rows.push(body);found=[body];}
   }
   if(this.singleResult&&found.length>1)return {data:null,error:{code:'PGRST116',message:'Multiple rows'}};
   return {data:clone(this.singleResult?(found[0]||null):found),error:null};
  }
 }
 return {tables,history,failures,from:name=>new Query(name)};
}
function loader(overrides={},globals={}) {
 const cache=new Map();
 function load(file){
  const full=path.isAbsolute(file)?file:path.join(ROOT,file);
  if(cache.has(full))return cache.get(full).exports;
  const module={exports:{}};cache.set(full,module);
  const src=fs.readFileSync(full,'utf8');const code=ts.transpileModule(src,{fileName:full,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const req=spec=>{
   if(Object.prototype.hasOwnProperty.call(overrides,spec))return overrides[spec];
   if(spec==='server-only')return {};
   if(spec==='next/server')return {NextResponse:{json:(data,init={})=>new Response(JSON.stringify(data),{status:init.status||200,headers:{'Content-Type':'application/json'}})}};
   if(spec.startsWith('@/')||spec.startsWith('.')) {
    let resolved=spec.startsWith('@/')?path.join(ROOT,spec.slice(2)):path.resolve(path.dirname(full),spec);
    if(!path.extname(resolved))resolved+='.ts';return load(resolved);
   }
   return require(spec);
  };
  const sandbox={module,exports:module.exports,require:req,console,URL,Request,Response,Headers,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,process:{env:{FACEBOOK_GRAPH_VERSION:'v26.0'}},...globals};
  vm.runInNewContext(code,sandbox,{filename:full});return module.exports;
 }
 return load;
}
const baseSeed=()=>({
 conversations:[{id:'conv1',business_id:'b1',contact_id:'c1',social_account_id:'s1',last_message_at:'2026-09-12T00:00:00Z'}],
 contacts:[{id:'c1',business_id:'b1',platform:'facebook',platform_user_id:'100076611888104',facebook_profile_id:null,facebook_profile_url:null,updated_at:'2026-09-12T00:00:00Z',full_name:'Customer'}],
 social_accounts:[{id:'s1',business_id:'b1',platform:'facebook',platform_account_id:'393342417206745',is_active:true}],
 facebook_customer_blocks:[],team_chat_rooms:[],messages:[],conversation_activity:[]
});
function setup(options={}) {
 const db=database(options.seed||baseSeed());const member={id:'m1',user_id:'u1',business_id:'b1',role:options.role||'owner',full_name:'Agent One'};
 const access=async id=>options.denied?{success:false,status:403,error:'Forbidden'}:{success:true,member,businessId:'b1',user:{id:'u1'},conversation:db.tables.conversations.find(x=>x.id===id)};
 let calls=[],refreshes=0;
 const load=loader({
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/inbox/get-inbox-resource-access':{getInboxConversationAccess:access},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>!options.permissionDenied},
  '@/lib/auth/get-current-member':{getCurrentMember:async()=>options.denied?{success:false,status:401,error:'Unauthorized'}:{success:true,member}},
  '@/lib/extension/device-auth':{authenticateDevice:async()=>options.denied?{success:false,status:403,error:'Revoked'}:{success:true,device:{id:'d1',business_id:'b1',member_id:'m1'},member}},
  '@/lib/facebook/get-facebook-page-access-token':{getFacebookPageAccessToken:async()=> 'FAKE_TOKEN',refreshFacebookPageAccessToken:async()=>{refreshes++;return 'NEW_FAKE_TOKEN'},isFacebookAccessTokenError:e=>e?.code===190||e?.code===102},
  '@/lib/inbox/create-conversation-activity':{createConversationActivity:async entry=>db.tables.conversation_activity.push(entry)},
  '@/lib/team/team-chat-server':{canManageTeamChat:role=>['owner','admin'].includes(role),roomIconFromSlug:()=> 'heart',slugWithRoomIcon:(name,icon)=>`${name}-${icon}`,safeDetails:()=>({})},
 },{fetch:async(url,init)=>{calls.push({url,init});if(options.fetchThrow)throw new Error('Network');const result=options.fetchResults?.shift()||{success:true};return new Response(JSON.stringify(result),{status:result.error?400:200});}});
 const request=(body,method='POST',origin='https://app.tenhchat.com')=>new Request('https://app.tenhchat.com/api/test',{method,headers:{'Content-Type':'application/json',Origin:origin},...(method==='GET'?{}:{body:JSON.stringify(body)})});
 return {db,load,request,calls,refreshes:()=>refreshes,context:{params:Promise.resolve({conversationId:'conv1',roomId:'r1'})}};
}
module.exports={ROOT,loader,database,baseSeed,setup,clone};
