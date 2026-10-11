const React=require('react'),{createRoot}=require('react-dom/client');
const {InboxView}=require('@/components/inbox/inbox-view');
const {DashboardHeader}=require('@/components/dashboard/dashboard-header');
const {DashboardUtilityNavigationProvider}=require('@/components/dashboard/dashboard-utility-navigation');
const {InboxReturnContextProvider}=require('@/components/dashboard/inbox-return-context');
const h=React.createElement,uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
window.fixtureRequests=[];window.fixtureQueries=[];window.fixtureSubscriptions=[];window.fixtureRefreshes=0;window.fixtureErrors=[];
const avatar='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#93c5fd"/><text x="16" y="43" font-size="28" fill="#1e40af">N</text></svg>');
const rows=Array.from({length:45},(_,i)=>({id:uuid(i+1),business_id:uuid(900),contact_id:uuid(100+i),social_account_id:uuid(i%2?801:800),status:'open',source_type:i===3?'comment':'messenger',is_pinned:i===2,unread_count:i<8?i+1:0,last_message_text:i%2?'Hello, can you help?':'សួស្តីបង',last_message_at:'2026-10-11T08:00:00Z',created_at:'2026-10-10T07:00:00Z',updated_at:'2026-10-11T08:00:00Z',assigned_to:null,contact:{id:uuid(100+i),business_id:uuid(900),platform_user_id:'fixture-'+i,full_name:i===0?'Na Solo':'Fixture customer '+i,profile_picture_url:avatar,tags:[]},social_account:{id:uuid(i%2?801:800),business_id:uuid(900),platform:i%2?'telegram':'facebook',account_name:i%2?'Fixture Telegram':'Apex Clothing',platform_account_id:'fixture-account',status:'active'}}));
const photo=URL.createObjectURL(new Blob([decodeURIComponent(avatar.split(",")[1])],{type:"image/svg+xml"}));
const messages=id=>Array.from({length:18},(_,i)=>({id:uuid(1000+Number(id.slice(-3))*30+i),conversation_id:id,platform_message_id:'fixture-message-'+i,direction:i%3?'incoming':'outgoing',sender_type:i%3?'customer':'agent',sender_id:null,message_type:i===8?'image':'text',__local_image_preview:i===8?photo:undefined,attachment_url:i===8?photo:null,message_text:i===8?'Photo':i%3?'Can you share more information?':'Hi! We will help you.',is_outgoing:i%3===0,created_at:`2026-10-11T08:${String(i).padStart(2,'0')}:00Z`,platform_created_at:`2026-10-11T08:${String(i).padStart(2,'0')}:00Z`,raw_payload:{}}));
window.fixtureRows=rows;window.fixtureMessages=messages;
const json=data=>Response.json({success:true,...data});
window.fetch=async(url,options={})=>{
  url=String(url);window.fixtureRequests.push({url,method:options.method||'GET'});
  if(!url.startsWith('/api/'))throw Error('External network blocked in fixture');
  const parsed=new URL(url,location.origin),route=parsed.pathname;
  if(route==='/api/workspaces')return json({currentBusinessId:uuid(900),workspaces:[{businessId:uuid(900),name:'Fixture workspace',businessName:'Fixture workspace',role:'owner',status:'active',subscriptionId:'TB'}]});
  if(route==='/api/inbox/channels')return json({channels:rows.slice(0,2).map(row=>({id:row.social_account_id,businessId:uuid(900),platform:row.social_account.platform,accountName:row.social_account.account_name,platformAccountId:'fixture-account',subscriptionId:'TB',accessAllowed:true,role:'owner'}))});
  if(route==='/api/inbox/views')return json({views:[],memberId:uuid(901)});
  if(route==='/api/inbox/smart-view-options')return json({currentBusinessId:uuid(900),workspaces:[],tags:[]});
  if(route==='/api/reminders')return json({count:0,reminders:[]});
  if(route==='/api/team-notifications')return json({notifications:[],memberIds:[uuid(901)],currentBusinessId:uuid(900)});
  if(route==='/api/system-announcements/current')return json({announcement:null});
  if(route==='/api/inbox/live-state')return json({conversations:[],messages:[],activities:[],deletedMessageIds:[],deletedConversationIds:[]});
  if(/\/conversations\/[^/]+\/messages$/.test(route)){const id=route.split('/')[3];if(window.fixtureMessageError)return Response.json({success:false,error:'Isolated message failure'},{status:503});return json({messages:messages(id),hasMore:false});}
  if(route.endsWith('/read'))return json({unreadCount:0,readAt:'2026-10-11T09:00:00Z'});
  if(route.endsWith('/pin'))return json({conversation:{...rows[0],is_pinned:true}});
  if(route.endsWith('/unread'))return json({unreadCount:1});
  if(route.endsWith('/status'))return json({conversation:{...rows[0],status:JSON.parse(options.body).status}});
  if(route.endsWith('/assignment')||route.endsWith('/claim'))return json({conversation:rows[0]});
  if(route.includes('/send')||route.includes('/reply'))throw Error('Sending is not exercised by the layout fixture');
  return json({data:[],notes:[],events:[],tags:[],replies:[],files:[],links:[],messages:[],pins:[],canManage:true,member:{id:uuid(901),business_id:uuid(900),full_name:'Fixture Agent',role:'owner'}});
};
addEventListener('error',event=>window.fixtureErrors.push(event.message));addEventListener('unhandledrejection',event=>window.fixtureErrors.push(String(event.reason)));
async function run(){const header=await DashboardHeader();const selected=new URLSearchParams(location.search).get('conversation');createRoot(document.getElementById('root')).render(h(DashboardUtilityNavigationProvider,{isAdmin:false},h(InboxReturnContextProvider,{userId:uuid(902),businessId:uuid(900),memberId:uuid(901)},h('div',{'data-dashboard-shell':'',className:'flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-100'},header,h('main',{className:'min-h-0 min-w-0 flex-1 overflow-hidden'},h('div',{'data-inbox-page':'',className:'flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-50 p-1.5 sm:p-2.5'},h(InboxView,{conversations:rows,activeConversationId:selected,messages:selected?messages(selected):[],activeStatus:'all',statusCounts:{all:45,open:45,pending:0,resolved:0,closed:0,spam:0},teamMembers:[{id:uuid(901),business_id:uuid(900),full_name:'Fixture Agent',role:'owner'}],currentBusinessId:uuid(900),currentMemberId:uuid(901),accessibleBusinessIds:[uuid(900)]})))))));window.fixtureReady=true;}
run().catch(error=>{window.fixtureErrors.push(error.stack);document.body.textContent=error.stack;});
