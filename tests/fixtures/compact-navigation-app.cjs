/* Actual navigation/Inbox/Settings components; provider and account traffic are isolated mocks. */
const {usePathname}=require('next/navigation');
const {WorkspacePermissionsProvider}=require('@/lib/auth/use-workspace-permissions');
const SettingsLayout=require('@/app/dashboard/settings/layout').default;

module.exports=async function({React,createRoot,InboxView,header,DashboardUtilityNavigationProvider,InboxReturnContextProvider,h,uuid,rows,messages}){
  const originalFetch=window.fetch;
  const admin=new URLSearchParams(location.search).get('admin')==='true';
  const denied=new URLSearchParams(location.search).get('denied')==='true';
  const longName='TENH customer support workspace with a very long name that must never push Profile off screen';
  rows[3].social_account={...rows[0].social_account};rows[3].social_account_id=rows[0].social_account_id;
  window.fixtureSwitches=JSON.parse(sessionStorage.getItem('fixture-switches')||'[]');
  const response=data=>Response.json({success:true,...data});
  const notification={id:uuid(990),business_id:uuid(900),recipient_member_id:uuid(901),notification_type:'reminder',title:'Fixture reminder',body:'Isolated test notification',link:null,room_id:null,conversation_id:null,contact_id:null,is_read:false,read_at:null,created_at:'2026-10-12T06:00:00Z'};
  window.fetch=async(url,options={})=>{
    const route=new URL(String(url),location.origin).pathname;
    if(['/api/workspaces','/api/workspaces/switch','/api/team/permissions','/api/team-notifications','/api/reminders'].includes(route)){
      window.fixtureRequests.push({url:String(url),method:options.method||'GET'});
      if(route==='/api/workspaces')return response({currentBusinessId:sessionStorage.getItem('fixture-workspace')||uuid(900),workspaces:[
        {memberId:uuid(901),businessId:uuid(900),businessName:longName,role:'owner',subscription:null,subscriptionOperational:true},
        {memberId:uuid(904),businessId:uuid(903),businessName:'Second fixture workspace',role:'owner',subscription:null,subscriptionOperational:true},
      ]});
      if(route==='/api/workspaces/switch'){
        const data=JSON.parse(options.body);window.fixtureSwitches.push(data);sessionStorage.setItem('fixture-switches',JSON.stringify(window.fixtureSwitches));sessionStorage.setItem('fixture-workspace',data.businessId);return response({});
      }
      if(route==='/api/team/permissions')return response({isOwner:!denied,permissions:denied?{channels:'none'}:{}});
      if(route==='/api/team-notifications')return response({notifications:[0,1,2].map(i=>({...notification,id:uuid(990+i)})),memberIds:[uuid(901)],businessIds:[uuid(900)],currentBusinessId:uuid(900)});
      if(route==='/api/reminders')return response({count:1,reminders:[]});
    }
    return originalFetch(url,options);
  };
  const inboxProps={conversations:rows,messages:[],activeStatus:'all',statusCounts:{all:45,open:45,pending:0,resolved:0,closed:0,spam:0},teamMembers:[{id:uuid(901),business_id:uuid(900),full_name:'Fixture Agent',role:'owner'}],currentBusinessId:uuid(900),currentMemberId:uuid(901),accessibleBusinessIds:[uuid(900),uuid(903)]};
  function App(){
    const pathname=usePathname(),inInbox=pathname==='/dashboard/inbox';
    const selected=new URLSearchParams(location.search).get('conversation');
    const page=inInbox?h('div',{'data-inbox-page':'',className:'flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-50 p-1.5 sm:p-2.5'},h(InboxView,{...inboxProps,activeConversationId:selected,messages:selected?messages(selected):[]})):
      pathname.startsWith('/dashboard/settings')?h(SettingsLayout,null,h('div',{'data-fixture-settings':'',className:'p-4'},'Existing Settings content fixture')):
      h('div',{'data-fixture-destination':pathname,className:'h-full overflow-y-auto p-5'},h('h1',null,pathname.split('/').at(-1)));
    return h(DashboardUtilityNavigationProvider,{isAdmin:admin},h(InboxReturnContextProvider,{userId:uuid(902),businessId:uuid(900),memberId:uuid(901)},h(WorkspacePermissionsProvider,null,
      h('div',{'data-dashboard-shell':'',className:'flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-100'},header,h('main',{className:'min-h-0 min-w-0 flex-1 overflow-hidden'},page)))));
  }
  createRoot(document.getElementById('root')).render(h(App));window.fixtureReady=true;
};
