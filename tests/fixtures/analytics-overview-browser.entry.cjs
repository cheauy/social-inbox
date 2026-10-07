const React=require('react'),{createRoot}=require('react-dom/client');
const {DashboardOverviewPanel}=require('@/components/analytics/dashboard-overview-panel');
const {AnalyticsWorkspace}=require('../../components/analytics/analytics-workspace.tsx');
const {DashboardUtilityNavigationProvider}=require('../../components/dashboard/dashboard-utility-navigation.tsx');
const {setActiveWorkspaceUiId}=require('../../lib/display/workspace-storage.ts');
const {overviewRange}=require('../../lib/analytics/overview-metrics.ts');
const nativeFetch=window.fetch.bind(window),NativeDate=Date;
window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-06T12:00:00Z']))}static now(){return new NativeDate('2026-10-06T12:00:00Z').getTime()}};
for(const method of ['pushState','replaceState']){const original=history[method].bind(history);history[method]=(...args)=>{original(...args);window.dispatchEvent(new Event('fixture-query'));};}
window.__calls=[];window.__intervals=[];window.setInterval=(callback,ms)=>{window.__intervals.push({callback,ms});return window.__intervals.length};window.clearInterval=()=>{};
window.__mode='normal';window.__workspace='00000000-0000-4000-8000-000000000001';
window.__setWorkspace=id=>{window.__workspace=id;setActiveWorkspaceUiId(id)};window.__setWorkspace(window.__workspace);
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
async function start(){
 const evidence=await nativeFetch('fixture.json').then(r=>r.json());window.__evidence=evidence;
 window.fetch=async(url,init={})=>{
  if(!String(url).startsWith('/api/'))throw Error('Only synthetic API routes are allowed');
  const p=new URL(url,location.href).searchParams,route=String(url).split('?')[0].split('/').pop();
  const call={url,aborted:false,bytes:0};window.__calls.push(call);init.signal?.addEventListener('abort',()=>call.aborted=true);
  const slow=p.get('period')==='30d';await new Promise(r=>setTimeout(r,slow?420:35));
  if(window.__mode==='error')return Response.json({success:false,error:'Synthetic aggregate unavailable'},{status:503});
  const analytics=structuredClone(route==='overview'?(['3m','6m','1y'].includes(p.get('period'))?evidence.longYearOverview:evidence.overview):evidence.legacy[route]??{});
  if(route==='overview'&&slow)analytics.current.unread=999;
  if(route==='overview'&&window.__mode==='empty'){
   for(const key of Object.keys(analytics.period))analytics.period[key]=0;analytics.period.avgFirstResponseSeconds=null;analytics.period.slaRate=null;
   for(const key of Object.keys(analytics.messages))analytics.messages[key]=0;for(const key of Object.keys(analytics.customers))analytics.customers[key]=0;
   analytics.daily=[];analytics.channels.forEach(r=>r.value=0);analytics.hours.forEach(r=>r.value=0);
  }
  if(route==='overview'&&window.__mode==='zero')for(const key of Object.keys(analytics.current))analytics.current[key]=0;
  const range=overviewRange(p.get('period')??'today',new Date(),p.get('timezone')??'UTC');
  const body={success:true,businessId:p.get('businessId')??window.__workspace,analytics,start:range.start.toISOString(),end:range.end.toISOString(),snapshotAt:'2026-10-06T12:00:00.000Z'};
  call.bytes=new TextEncoder().encode(JSON.stringify(body)).length;return Response.json(body);
 };
 const root=createRoot(document.getElementById('root'));
 window.__showWorkspace=()=>root.render(React.createElement(DashboardUtilityNavigationProvider,{isAdmin:false},React.createElement(AnalyticsWorkspace)));
 root.render(React.createElement(DashboardOverviewPanel));window.__ready=true;
}start();
