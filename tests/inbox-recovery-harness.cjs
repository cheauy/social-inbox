// Bounded PostgREST/hook doubles for the real route and component code.
// These tests do not replace database/RLS, a browser, or live provider testing.
const { loader, clone } = require('./tenh-seven/harness.cjs');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function split(s) {let level=0,start=0,out=[];for(let i=0;i<s.length;i++){if(s[i]==='(')level++;if(s[i]===')')level--;if(s[i]===','&&level===0){out.push(s.slice(start,i));start=i+1}}out.push(s.slice(start));return out;}
function condition(s,r) {
 if(s.startsWith('and(')) return split(s.slice(4,-1)).every(x=>condition(x,r));
 if(s.startsWith('or(')) return split(s.slice(3,-1)).some(x=>condition(x,r));
 const [key,op,...rest]=s.split('.'), value=rest.join('.'), current=r[key];
 if(op==='is')return value==='null'&&current==null;
 if(op==='eq')return String(current)===value;
 if(op==='gt')return current>value;
 if(op==='lt')return current<value;
 throw Error('Unsupported test condition '+s);
}
function database(seed) {
 const tables=clone(seed), history=[], faults=[];let before=null;
 class Query {
  constructor(table){this.table=table;this.op='read';this.filters=[];this.orders=[];this.columns='';this.max=Infinity;this.body=null;this.singleton=false;}
  select(columns=''){this.columns=columns;return this;}
  eq(k,v){this.filters.push(r=>r[k]===v);return this;}
  gt(k,v){this.filters.push(r=>r[k]>v);return this;}
  gte(k,v){this.filters.push(r=>r[k]>=v);return this;}
  in(k,v){this.filters.push(r=>v.includes(r[k]));return this;}
  is(k,v){this.filters.push(r=>(r[k]??null)===v);return this;}
  or(s){this.expression=s;this.filters.push(r=>split(s).some(x=>condition(x,r)));return this;}
  order(k,opts={}){this.orders.push([k,opts.ascending!==false]);return this;}
  limit(n){this.max=n;return this;}
  update(body){this.op='update';this.body=clone(body);return this;}
  maybeSingle(){this.singleton=true;return this.run();}single(){return this.maybeSingle();}
  then(a,b){return this.run().then(a,b);}
  async run(){history.push(this);if(before)await before(this);const fault=faults.find(f=>f.table===this.table&&(!f.op||f.op===this.op)&&(!f.when||f.when(this)));if(fault){if(fault.once)faults.splice(faults.indexOf(fault),1);return {data:null,error:{message:fault.message||'injected'}};}
   const all=tables[this.table];if(!all)return {data:null,error:{message:'Missing table '+this.table}};
   const found=all.filter(r=>this.filters.every(fn=>fn(r))).sort((a,b)=>{for(const [key,ascending] of this.orders){if(a[key]!==b[key])return (a[key]>b[key]?1:-1)*(ascending?1:-1);}return 0;}).slice(0,this.max);
   if(this.op==='update')for(const r of found)Object.assign(r,this.body,{updated_at:new Date().toISOString()});
   return {data:clone(this.singleton?found[0]??null:found),error:null};
  }
 }
 return {tables,history,faults,from:name=>new Query(name),setBefore:fn=>before=fn};
}
const base=()=>({conversations:[{id:uuid(1),business_id:'b1',social_account_id:'s1',contact_id:null,unread_count:2,last_message_at:'2026-09-29T05:00:00.000Z',updated_at:new Date().toISOString(),status:'open'}],social_accounts:[{id:'s1',business_id:'b1',platform:'facebook',platform_account_id:'page1',is_active:true,facebook_token_status:'verified'}],messages:[],contact_tags:[]});
function setup(opts={}){
 const db=database(opts.seed||base()),hydrateCalls=[],previewCalls=[],lookupCalls=[];
 const scope={accessibleBusinessIds:opts.businesses||['b1'],currentBusinessId:'b1'};
 const access=async id=>opts.denied?{success:false,status:403,error:'denied'}:{success:true,businessId:'b1',member:{id:'m1',business_id:'b1'},conversation:db.tables.conversations.find(r=>r.id===id)};
 const load=loader({
  'next/server':{NextResponse:Response},'@/lib/server/tenant-read-scope':{withTenantReadScope:fn=>fn},
  '@/lib/supabase/admin':{supabaseAdmin:db},
  '@/lib/inbox/get-conversations':{getInboxConversationScope:async()=>{if(opts.signedOut)throw Error('sign in');return scope;},getConversations:async(businesses,filter)=>{hydrateCalls.push({businesses,filter});return db.tables.conversations.filter(r=>businesses.includes(r.business_id)&&filter.conversationIds.includes(r.id)&&(!filter.workspaceId||r.business_id===filter.workspaceId)&&(!filter.channelId||r.social_account_id===filter.channelId)).map(r=>({...r,contact:{full_name:'Customer '+r.id,tags:[]},social_account:db.tables.social_accounts.find(c=>c.id===r.social_account_id)}));}},
  '@/lib/inbox/get-inbox-resource-access':{getInboxConversationAccess:access,authorizeInboxBusinessAccess:async()=>access(uuid(1))},
  '@/lib/auth/require-permission':{memberHasPermission:async()=>!opts.permissionDenied},
  '@/lib/facebook/get-post-preview':{getFacebookPostPreview:async(...args)=>{previewCalls.push(args);if(opts.previewThrow)throw Error('upstream');return typeof opts.preview==='function'?opts.preview(...args):opts.preview??null;},getFacebookPostIdForComment:async(...args)=>{lookupCalls.push(args);return opts.resolvedPost??null;}},
 },{URLSearchParams,AbortController,Event,CustomEvent,console:{...console,warn(){},error(){}},...opts.globals});
 const request=body=>new Request('https://app.tenhchat.com/api/test',{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}});
 const getRequest=params=>({nextUrl:new URL('https://app.tenhchat.com/api/facebook/post-preview?'+new URLSearchParams(params))});
 return {db,load,request,getRequest,hydrateCalls,previewCalls,lookupCalls};
}
// Minimal React lifecycle: stable deps, effects, cleanup, state and rerender.
function hooks() {
 const slots=[], effects=[], pending=[];let cursor=0;
 const changed=(a,b)=>!a||!b||a.length!==b.length||a.some((x,i)=>!Object.is(x,b[i]));
 const React={Fragment:Symbol('Fragment'),useState(init){const n=cursor++;if(!(n in slots))slots[n]=typeof init==='function'?init():init;return[slots[n],v=>slots[n]=typeof v==='function'?v(slots[n]):v];},useRef(init){const n=cursor++;if(!(n in slots))slots[n]={current:init};return slots[n];},useMemo(fn,deps){const n=cursor++;if(!slots[n]||changed(slots[n].deps,deps))slots[n]={value:fn(),deps};return slots[n].value;},useCallback(fn,deps){return React.useMemo(()=>fn,deps);},useEffect(fn,deps){const n=cursor++;if(!effects[n]||changed(effects[n].deps,deps)){pending.push(()=>{effects[n]?.cleanup?.();effects[n]={deps,cleanup:fn()};});}},useLayoutEffect(fn,deps){return React.useEffect(fn,deps);},memo:fn=>fn};
 const jsx=(type,props,key)=>({type,props:props??{},key});
 return {React,jsx:{jsx,jsxs:jsx,Fragment:React.Fragment},render(fn,props){cursor=0;const result=fn(props);while(pending.length)pending.shift()();return result;},cleanup(){for(const e of effects)e?.cleanup?.();},slots};
}
function nodes(tree,predicate){const found=[];const visit=n=>{if(Array.isArray(n)){n.forEach(visit);return;}if(!n||typeof n!=='object')return;if(predicate(n))found.push(n);visit(n.props?.children);};visit(tree);return found;}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
module.exports={loader,clone,uuid,database,base,setup,hooks,nodes,tick};
