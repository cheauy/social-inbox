const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),ts=require('typescript');
const {loader,hooks,tick}=require('./inbox-recovery-harness.cjs');
const RETIRED='app/api/team-chat/[[...retired]]/route.ts';
test('all retired room operations reject without reading or mutating stored data',async()=>{
 const api=loader()(RETIRED);
 for(const method of ['GET','POST','PUT','PATCH','DELETE']) {
  const result=await api[method](new Request('https://test.local/api/team-chat/rooms/r1/messages',{method,...(method==='GET'?{}:{body:'private'})}));
  assert.equal(result.status,410);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json()).code,'TEAM_CHAT_RETIRED');
 }
 assert.doesNotMatch(fs.readFileSync(RETIRED,'utf8'),/supabase|\.from\(|fetch\(/);
});
test('saved web and mobile room links redirect to existing customer Inbox',()=>{
 const page=loader({'next/navigation':{redirect:href=>{assert.equal(href,'/dashboard/inbox');throw Error('redirect')}}})('app/dashboard/group-chat/page.tsx');
 assert.throws(()=>page.default(),/redirect/);
 const h=hooks();const Redirect=Symbol('Redirect');
 for(const file of ['mobile/app/(tabs)/group-chat.tsx','mobile/app/room/[id]/index.tsx','mobile/app/room/[id]/details.tsx']) {
  const component=loader({'expo-router':{Redirect},'react/jsx-runtime':h.jsx})(file).default;
  const rendered=component();assert.equal(rendered.type,Redirect);assert.equal(rendered.props.href,'/(tabs)');
 }
 assert.ok(fs.existsSync('mobile/app/(tabs)/index.tsx'));
});
test('updated app has no room API callers, room subscriptions or room search links',()=>{
 function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)): /\.(ts|tsx)$/.test(e.name)?[path.join(dir,e.name)]:[])}
 for(const file of [...walk('components'),...walk('mobile/app'),...walk('mobile/lib'),...walk('lib')])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/\/api\/team-chat\/|table:\s*["']team_chat_|\/dashboard\/group-chat\?room/,file);
 assert.match(fs.readFileSync('components/inbox/customer-notes.tsx','utf8'),/MentionComposer/);
 assert.match(fs.readFileSync('mobile/app/_layout.tsx','utf8'),/<PresenceProvider>/);
});
test('shared team access helpers preserve member listing and extension management roles',async()=>{
 let table;const query={select(){return this},eq(){return this},order:async()=>({data:[{id:'member'}],error:null})};
 const helpers=loader({'@/lib/supabase/admin':{supabaseAdmin:{from:name=>{table=name;return query}}}})('lib/team/team-members-server.ts');
 for(const role of ['owner','admin'])assert.equal(helpers.canManageTeamSettings(role),true);
 for(const role of ['agent','viewer'])assert.equal(helpers.canManageTeamSettings(role),false);
 assert.equal((await helpers.loadActiveBusinessMembers('b1'))[0].id,'member');assert.equal(table,'team_members');
});
test('mobile bootstrap, resume and reconnect retain customer updates with no room requests',async()=>{
 const h=hooks();h.React.createContext=()=>({Provider:Symbol('Provider')});h.React.useContext=()=>null;
 const session={user:{id:'u1'}},workspace={businessId:'b1',memberId:'m1',subscriptionOperational:true};
 const requests=[],channels=[],listeners=[],jobs=new Map();let timer=0,sounds=0;
 const appState={currentState:'active',addEventListener:(event,fn)=>{listeners.push(fn);return {remove(){}}}};
 const client={removeChannel:async()=>{},channel(name){const channel={name,events:[],on(kind,filter,fn){this.events.push({filter,fn});return this},subscribe(fn){this.status=fn;fn?.('SUBSCRIBED');return this}};channels.push(channel);return channel}};
 const load=loader({react:h.React,'react/jsx-runtime':h.jsx,'react-native':{AppState:appState},'./auth/provider':{useAuth:()=>({session})},'./notification-sound':{useNotificationSound:()=>({enabled:true,play:()=>sounds++})},'./supabase/client':{supabase:client},'./auth/secure-storage':{sessionStorage:{getItem:async key=>key.startsWith('workspace.')?'b1':'',setItem:async()=>{}}},'./inbox-cache':{readInboxCache:async()=>null,writeInboxCache(){},clearInboxCache:async()=>{}},'./api/client':{ApiError:class extends Error{},api:async url=>{requests.push(url);if(url==='/api/workspaces')return {workspaces:[workspace]};if(url.startsWith('/api/mobile/bootstrap'))return {conversations:[{id:'c1'}],member:{id:'m1'},permissions:{},hasMore:false};if(url==='/api/team-notifications')return {notifications:[]};return {announcement:null}}}}, {setTimeout:fn=>{jobs.set(++timer,fn);return timer},clearTimeout:id=>jobs.delete(id),setInterval:()=>++timer,clearInterval(){}});
 const Provider=load('mobile/lib/inbox-provider.tsx').InboxProvider;
 async function settle(){for(let i=0;i<8;i++){h.render(Provider,{children:null});await tick()}}
 async function flush(){for(const [id,fn] of [...jobs]){jobs.delete(id);await fn()}await settle()}
 try{
  await settle();assert.ok(requests.some(url=>url.startsWith('/api/mobile/bootstrap')));
  const inbox=channels.find(c=>c.name==='tenh-mobile-b1');assert.ok(inbox);
  assert.ok(inbox.events.some(e=>e.filter.table==='messages'));assert.ok(inbox.events.some(e=>e.filter.table==='conversations'));assert.ok(inbox.events.some(e=>e.filter.table==='contacts'));
  assert.equal(channels.flatMap(c=>c.events).some(e=>e.filter.table?.startsWith('team_chat_')),false);
  requests.length=0;appState.currentState='background';listeners.forEach(fn=>fn('background'));await flush();assert.equal(requests.length,0);
  appState.currentState='active';listeners.forEach(fn=>fn('active'));await flush();assert.ok(requests.some(url=>url.startsWith('/api/mobile/bootstrap')));
  requests.length=0;inbox.status('CLOSED');inbox.status('SUBSCRIBED');await flush();assert.ok(requests.some(url=>url.startsWith('/api/mobile/bootstrap')));
  requests.length=0;inbox.events.find(e=>e.filter.table==='messages'&&e.filter.event==='*').fn({new:{conversation_id:'c1'},old:{},eventType:'INSERT'});await flush();assert.ok(requests.some(url=>url.includes('conversationIds=c1')));
  const notification=channels.find(c=>c.name==='tenh-mobile-alerts-m1');assert.ok(notification);
  notification.events[0].fn({eventType:'INSERT',new:{is_read:false,notification_type:'team_chat_mention'}});assert.equal(sounds,0);
  notification.events[0].fn({eventType:'INSERT',new:{is_read:false,notification_type:'conversation_reminder'}});assert.equal(sounds,1);
  assert.equal(requests.some(url=>url.includes('/api/team-chat')),false);
 }finally{h.cleanup()}
});
test('changed mobile consumers parse without installed Expo dependencies',()=>{
 for(const file of ['mobile/app/(tabs)/_layout.tsx','mobile/app/(tabs)/notifications.tsx','mobile/app/(tabs)/group-chat.tsx','mobile/app/room/[id]/index.tsx','mobile/app/room/[id]/details.tsx','mobile/lib/inbox-provider.tsx','mobile/lib/api/read-cache.ts','mobile/lib/types/index.ts']){
  const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
  assert.deepEqual(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[],file);
 }
});
test('notification reads exclude retired room mentions while preserving reminder and other alerts',async()=>{
 const seed={team_members:[{id:'m1',business_id:'b1',user_id:'u1',is_active:true}],business_subscriptions:[],conversation_reminders:[],team_notifications:[{id:'retired',business_id:'b1',recipient_member_id:'m1',notification_type:'team_chat_mention'},{id:'reminder',business_id:'b1',recipient_member_id:'m1',notification_type:'conversation_reminder'},{id:'note',business_id:'b1',recipient_member_id:'m1',notification_type:'customer_note_mention'}]};
 const admin={from(table){let rows=seed[table];if(!rows)throw Error(table);const q={select(){return q},eq(k,v){rows=rows.filter(r=>r[k]===v);return q},neq(k,v){rows=rows.filter(r=>r[k]!==v);return q},in(k,values){rows=rows.filter(r=>values.includes(r[k]));return q},lte(){return q},order(){return q},limit(n){rows=rows.slice(0,n);return q},then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve)}};return q}};
 const route=loader({'@/lib/supabase/admin':{supabaseAdmin:admin},'@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'u1'}}})}})},'next/headers':{cookies:async()=>({get:()=>({value:'b1'})})},'@/lib/auth/get-current-member':{TENH_ACTIVE_BUSINESS_COOKIE:'active'}})('app/api/team-notifications/route.ts');
 const response=await route.GET();assert.equal(response.status,200);assert.deepEqual((await response.json()).notifications.map(n=>n.id),['reminder','note']);assert.equal(seed.team_notifications.length,3);
});
