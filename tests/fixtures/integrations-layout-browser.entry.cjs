/* eslint-disable @typescript-eslint/no-require-imports -- Isolated webpack fixture. */
const React=require('react'),{createRoot}=require('react-dom/client'),Page=require('integration-page').default,Layout=require('@/app/dashboard/integrations/layout').default;
const query=new URLSearchParams(location.search);window.fixtureMode=query.get('mode')||'default';window.fixtureRequests=[];window.fixtureQueries=[];window.fixtureNavigation=[];
const mode=window.fixtureMode;window.fixtureAccounts=mode==='empty'?[]:[
{id:'page-apex',platform:'facebook',platform_account_id:'fixture-apex',account_name:'Apex Clothing',is_active:true,facebook_token_status:'valid'},
{id:'page-melody',platform:'facebook',platform_account_id:'fixture-melody',account_name:'Melody Clothing',is_active:mode!=='attention',facebook_token_status:'valid'},
{id:'page-melody-2',platform:'facebook',platform_account_id:'fixture-melody-2',account_name:'Melody Clothing II',is_active:true,facebook_token_status:mode==='attention'?'expired':'valid'}];
if(mode==='long'){window.fixtureAccounts[0].account_name='VeryLongFixturePageName'.repeat(6);window.fixtureAccounts[0].platform_account_id='fixture-long-id'.repeat(12);window.fixtureAccounts[1].platform_account_id=null;}
const bot={id:'fixture-bot',botId:'100000001',botName:'TENH Shop Assistant',username:'tenh_fixture_bot',isActive:true,status:'verified',connectedAt:'2026-10-07T10:00:00Z',lastError:null,webhookStatus:'active'};
let bots=mode==='telegram-empty'?[]:[bot,{...bot,id:'fixture-bot-2',botId:'100000002',botName:'Second Fixture Bot',username:'second_fixture_bot',isActive:false,webhookStatus:'disabled'}];
if(mode==='attention')bots.push({...bot,id:'invalid',botName:'Reconnect Fixture',status:'invalid',webhookStatus:'error',lastError:'Invalid credentials'});
if(mode==='long')bots=Array.from({length:12},(_,i)=>({...bot,id:'long-'+i,botId:String(100000001+i),botName:'Long Telegram bot name '+i,username:'long_fixture_bot_'+i}));
window.fixtureSyntheticToken='999999999:offline-synthetic-token';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
window.fetch=async(input,options={})=>{
 const url=String(input),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
 // Never retain tokens in traces, even though these are synthetic fixtures.
 window.fixtureRequests.push({url,method,body:body?.token?{token:'[redacted synthetic token]'}:body});
 if(method!=='GET'&&(mode==='view-only'||mode==='no-access'||window.fixtureUnauthorized))return json({success:false,error:'Manage permission required'},403);
 if(url.includes('telegram-personal'))return json({success:false,error:'feature_disabled'},404);
 if(url.includes('/api/subscription/usage-management')){
  if(method==='PATCH'){
   if(body.businessId!=='fixture-business'||body.subscriptionId!=='fixture-subscription')return json({success:false,error:'Workspace context changed'},409);
   if(window.fixtureFail||window.fixtureLimit)return json({success:false,error:window.fixtureLimit?'Channel limit reached':'Isolated update failure'},409);
   const page=window.fixtureAccounts.find(p=>p.id===body.id),tg=bots.find(b=>b.id===body.id);
   if(page)page.is_active=body.active;else if(tg)tg.isActive=body.active;else throw Error('Unknown integration target');
  }
  return json({success:true,businessId:window.fixtureOtherWorkspace?'other-workspace':'fixture-business',subscription:{id:'fixture-subscription'},connections:[...window.fixtureAccounts.filter(p=>p.facebook_token_status!=='disconnected').map(p=>({...p})),...bots.map(b=>({id:b.id,platform:'telegram',is_active:b.isActive}))]});
 }
 if(url.includes('/api/telegram/webhook')){
  const id=new URL(url,'http://fixture.invalid').searchParams.get('connectionId'),tg=bots.find(b=>b.id===id);
  if(!tg)return json({success:false,error:'Unknown bot'},404);
  if(method!=='GET'&&window.fixtureFail)return json({success:false,error:'Isolated Inbox update failure'},409);
  if(method==='POST'){if(!tg.isActive)return json({success:false,error:'Enable the channel first'},409);tg.webhookStatus='active';tg.lastError=null;}
  if(method==='DELETE')tg.webhookStatus='disabled';
  return json({success:true,webhook:{status:tg.webhookStatus,lastError:tg.lastError},remote:{lastErrorMessage:null},remoteError:window.fixtureRemoteError?'Connection could not be verified':null});
 }
 if(url.includes('/api/telegram/connection')){
  if(method==='POST'){
   if(window.fixturePendingConnect)await new Promise(resolve=>{window.fixtureReleaseConnect=resolve;});
   if(window.fixtureConnectFailure)return json({success:false,error:'Isolated connection failure'},409);
   const connected={...bot,id:'fixture-new-bot',botId:'999999999',botName:'New Fixture Bot',username:'new_fixture_bot',webhookStatus:'disabled'};
   if(!bots.some(b=>b.id===connected.id))bots.push(connected);
   if(window.fixtureLostResponse)throw Error('Simulated lost response');
   return json({success:true,connection:connected});
  }
  if(method==='DELETE'){
   if(window.fixtureFail)return json({success:false,error:'Isolated disconnect failure'},409);
   const id=new URL(url,'http://fixture.invalid').searchParams.get('connectionId');bots=bots.filter(b=>b.id!==id);
  }
  return json({success:true,canManage:!window.fixtureOtherWorkspace&&mode!=='view-only'&&mode!=='no-access',connections:window.fixtureOtherWorkspace?[]:bots});
 }
 if(url.includes('/api/facebook/connections/')){
  if(window.fixturePendingAction)await new Promise(resolve=>{window.fixtureReleaseAction=resolve;});
  if(window.fixtureFail)return json({success:false,error:'Isolated disconnect failure'},409);
  const id=url.split('/')[4],page=window.fixtureAccounts.find(p=>p.id===id);if(!page)throw Error('Unknown Page');page.is_active=false;page.facebook_token_status='disconnected';
  return json({success:true,historyPreserved:true});
 }
 throw Error('Unexpected fixture request: '+method+' '+url);
};
const root=createRoot(document.getElementById('root'));
window.fixtureRefresh=async()=>{
 const element=await Page({searchParams:Promise.resolve(window.fixturePageParams||{})});
 root.render(React.createElement(Layout,null,element));window.fixtureReady=true;
};
window.fixtureRefresh().catch(error=>{document.getElementById('root').textContent=error.message;window.fixtureError=error.message;});
