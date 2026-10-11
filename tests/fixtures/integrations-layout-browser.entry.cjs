/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS entry required by the isolated webpack fixture. */
const React=require('react'),{createRoot}=require('react-dom/client'),Page=require('integration-page').default,Layout=require('@/app/dashboard/integrations/layout').default;
const query=new URLSearchParams(location.search);window.fixtureMode=query.get('mode')||'default';window.fixtureRequests=[];window.fixtureQueries=[];window.fixtureNavigation=[];
const mode=window.fixtureMode;window.fixtureAccounts=mode==='empty'?[]:[
{id:'page-apex',platform:'facebook',platform_account_id:'fixture-apex',account_name:'Apex Clothing',is_active:true,facebook_token_status:'valid'},
{id:'page-melody',platform:'facebook',platform_account_id:'fixture-melody',account_name:'Melody Clothing',is_active:mode!=='attention',facebook_token_status:'valid'},
{id:'page-melody-2',platform:'facebook',platform_account_id:'fixture-melody-2',account_name:'Melody Clothing II',is_active:true,facebook_token_status:mode==='attention'?'expired':'valid'}];
if(mode==='long'){window.fixtureAccounts[0].account_name='VeryLongFixturePageName'.repeat(6);window.fixtureAccounts[0].platform_account_id='fixture-long-id'.repeat(12);window.fixtureAccounts[1].platform_account_id=null;}
const bot={id:'fixture-bot',botId:'fixture-bot-id',botName:'TENH Shop Assistant',username:'tenh_fixture_bot',isActive:true,status:'verified',connectedAt:'2026-10-07T10:00:00Z',lastError:null,webhookStatus:'registered'};
let fixtureBots=mode==='telegram-empty'?[]:mode==='telegram-multiple'?[{...bot,webhookStatus:'active'},{...bot,id:'fixture-bot-2',botId:'fixture-bot-id-2',botName:'Second Fixture Bot',username:'second_fixture_bot',isActive:false,webhookStatus:'disabled'}]:[bot];
const fixtureWebhookStatus=new Map(fixtureBots.map(item=>[item.id,item.webhookStatus]));

window.fetch=async(input,options={})=>{const url=String(input),method=options.method||'GET';window.fixtureRequests.push({url,method,body:options.body||null});let data={success:true},status=200;
if(url.includes('/api/subscription/usage-management'))data={connections:[...window.fixtureAccounts.map(row=>({platform:'facebook',is_active:row.is_active})),{platform:'telegram',is_active:true}]};
else if(url.includes('telegram-personal')){data={success:false,error:'feature_disabled'};status=404;}
else if(url.includes('/api/telegram/webhook')){
const id=new URL(url,'http://fixture.invalid').searchParams.get('connectionId');if(method==='POST'||method==='DELETE')fixtureWebhookStatus.set(id,method==='POST'?'active':'disabled');
data={success:true,webhook:{status:fixtureWebhookStatus.get(id)||'registered',url:'https://fixture.invalid/webhook',registeredAt:'2026-10-07T10:00:00Z',lastError:null},remote:{url:'https://fixture.invalid/webhook',pendingUpdateCount:0,lastErrorAt:null,lastErrorMessage:null,allowedUpdates:[]}};
}
else if(url.includes('/api/telegram/connection')){
if(method==='DELETE'){if(window.fixtureFail){data={success:false,error:'Isolated Telegram disconnect failure'};status=409;}else{const id=new URL(url,'http://fixture.invalid').searchParams.get('connectionId');fixtureBots=fixtureBots.filter(item=>item.id!==id);}}
if(status===200)data={success:true,canManage:mode!=='view-only',connection:fixtureBots[0]||null,connections:fixtureBots};
}
else if(url.includes('/api/facebook/connections/')){data=window.fixtureFail?{success:false,error:'Isolated disconnect failure'}:{success:true};status=window.fixtureFail?409:200;}
else {data={success:false,error:'Unexpected fixture request'};status=404;}
return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});};
document.addEventListener('click',event=>{const link=event.target.closest('a');if(link){event.preventDefault();window.fixtureNavigation.push({kind:'link',url:link.getAttribute('href')});}});
document.addEventListener('submit',event=>{event.preventDefault();window.fixtureNavigation.push({kind:'form',url:event.target.getAttribute('action'),method:event.target.getAttribute('method')||'GET'});});
Page({searchParams:Promise.resolve(mode==='notice'?{facebook:'connected',warning:'Isolated permission reminder'}:{})}).then(element=>{createRoot(document.getElementById('root')).render(React.createElement(Layout,null,element));window.fixtureReady=true;}).catch(error=>{document.getElementById('root').textContent=error.message;window.fixtureError=error.message;});
