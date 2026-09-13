const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const root=process.env.TENH_LOCAL_EXTENSION || 'tenh-extension-localhost';
const source=fs.readFileSync(root+'/src/background.js','utf8');
function worker(){
 const data={token:'PRODUCTION_TOKEN',installationId:'PRODUCTION_INSTALL',syncCursor:'PRODUCTION_CURSOR'},events={},calls=[];
 const event=name=>({addListener:fn=>{events[name]=fn;}});
 const storage={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async values=>Object.assign(data,values),remove:async keys=>{for(const k of(Array.isArray(keys)?keys:[keys]))delete data[k];}};
 const chrome={runtime:{id:'test',getManifest:()=>JSON.parse(fs.readFileSync(root+'/manifest.json','utf8')),onMessage:event('message'),onConnect:event('connect'),onInstalled:event('install'),onStartup:event('startup')},storage:{local:storage,session:storage},tabs:{onUpdated:event('tabUpdate'),onRemoved:event('tabRemove')},alarms:{onAlarm:event('alarm')}};
 const sandbox={chrome,URL,URLSearchParams,crypto:require('crypto').webcrypto,console,AbortSignal,setTimeout,clearTimeout,setInterval,clearInterval,
 fetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({success:true}));}};
 vm.runInNewContext(source+'\nheartbeat=async()=>({});flushSyncQueue=async()=>({});deltaSync=async()=>({});ensureRealtimeConnection=async()=>({});warmFacebookCompanion=async()=>({});stopRealtime=()=>{};globalThis.api={readState,writeState,clearAuth,callTenh,handle,profileSenderAllowed,isTenhSenderUrl,isAllowedRealtimeUrl};',sandbox);
 return {api:sandbox.api,data,events,calls};
}
const sender=url=>({id:'test',frameId:0,url,tab:{id:3,url}});
test('manifest injects the TENH bridge on exactly the requested local server',()=>{
 const m=JSON.parse(fs.readFileSync(root+'/manifest.json'));assert.equal(m.version,'1.2.32');assert.ok(m.host_permissions.includes('http://localhost:3000/*'));
 assert.deepEqual(m.content_scripts.find(x=>x.js.includes('src/tenh-bridge.js')).matches,['http://localhost:3000/*']);
});
test('localhost connection cannot inherit production credentials or cursors',async()=>{
 const h=worker(),state=await h.api.readState();assert.equal(state.token,undefined);assert.equal(state.syncCursor,undefined);assert.notEqual(state.installationId,'PRODUCTION_INSTALL');
 assert.equal(h.data.token,'PRODUCTION_TOKEN');
});
test('local pairing is sender-bound and stores credentials separately',async()=>{
 const h=worker();const r=await h.api.handle({type:'TENH_AUTO_CONNECTED',token:'LOCAL_TOKEN',device:{id:'local'}},sender('http://localhost:3000/dashboard/inbox'));
 assert.equal(r.connected,true);assert.equal(h.data['tenh-localhost-3000:token'],'LOCAL_TOKEN');assert.equal(h.data.token,'PRODUCTION_TOKEN');
 const state=await h.api.readState();assert.equal(state.token,'LOCAL_TOKEN');await h.api.clearAuth();assert.equal(h.data.token,'PRODUCTION_TOKEN');assert.equal(h.data['tenh-localhost-3000:token'],undefined);
});
for(const url of ['http://localhost:3001/dashboard','http://localhost:3000.evil.test/','https://app.tenhchat.com/dashboard','http://127.0.0.1:3000/dashboard'])test(`other origins cannot pair or authorize navigation: ${url}`,async()=>{
 const h=worker();assert.equal(h.api.profileSenderAllowed(sender(url)),false);assert.equal(h.api.isTenhSenderUrl(url),false);
 const result=await h.api.handle({type:'TENH_AUTO_CONNECTED',token:'ATTEMPT'},sender(url));assert.equal(result.connected,false);
 assert.equal(h.data['tenh-localhost-3000:token'],undefined);
});
test('local signed-in page can authorize profile/conversation actions',()=>{assert.equal(worker().api.profileSenderAllowed(sender('http://localhost:3000/dashboard/inbox')),true);});
test('API calls target localhost rather than production',async()=>{
 const h=worker();await h.api.callTenh('/api/extension/conversations/open-context',{method:'POST',token:'LOCAL_TOKEN',body:{conversationId:'test'}});
 assert.equal(h.calls[0].url,'http://localhost:3000/api/extension/conversations/open-context');assert.equal(h.calls[0].init.headers.Authorization,'Bearer LOCAL_TOKEN');
});
test('local WebSocket origin is exact and other ports/hosts are rejected',()=>{
 const h=worker();assert.equal(h.api.isAllowedRealtimeUrl('ws://localhost:3000/socket'),true);
 for(const url of ['ws://localhost:3001/socket','wss://app.tenhchat.com/socket','ws://localhost.evil.test:3000/socket','ws://user:pass@localhost:3000/socket'])assert.equal(h.api.isAllowedRealtimeUrl(url),false);
});
test('bridge ignores other localhost ports even if injected manually',()=>{
 vm.runInNewContext(fs.readFileSync(root+'/src/tenh-bridge.js','utf8'),{window:{location:{origin:'http://localhost:3001'}}});
});
test('popup and side panel open the local inbox',()=>{
 for(const file of ['popup.js','sidepanel.js']){
  const text=fs.readFileSync(root+'/src/'+file,'utf8');assert.ok(text.includes('const TENH_ORIGIN = "http://localhost:3000"'));assert.ok(!text.includes('https://app.tenhchat.com'));
 }
});
