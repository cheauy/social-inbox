/* Actual Inbox + local data doubles. This is a browser fixture, never production latency. */
const {React,createRoot,InboxView,DashboardUtilityNavigationProvider,InboxReturnContextProvider,h,uuid,rows,messages}=require('./inbox-compact-browser.entry.cjs');
const {createInteractionRecorder}=require('./inbox-interaction-recorder.cjs');
const {sortConversationPage}=require('@/lib/inbox/conversation-page-contract');
const {fixturePage,fixturePageResponse}=require('./inbox-interaction-page.cjs');
const baseFetch=window.fetch;
const recorder=createInteractionRecorder({clock:()=>performance.now(),frame:()=>new Promise(requestAnimationFrame),visible:()=>document.visibilityState==='visible',subscribeVisibility:fn=>{document.addEventListener('visibilitychange',fn);return()=>document.removeEventListener('visibilitychange',fn);},tier:'local_browser_mocked_data'});
const inboxRows=sortConversationPage(rows);
const request={status:'all',view:'all',search:'',channelId:null,workspaceId:null,workspaceContextId:uuid(900),cursor:null};
const page=body=>fixturePage(inboxRows,body);
window.fixtureDelayMs=0;window.fixturePageError=false;
window.fetch=recorder.wrapFetch(async(url,options={})=>{
  if(window.fixtureDelayMs)await new Promise((resolve,reject)=>{
    const timer=setTimeout(resolve,window.fixtureDelayMs);
    options.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal.reason);},{once:true});
    if(options.signal?.aborted){clearTimeout(timer);reject(options.signal.reason);}
  });
  options.signal?.throwIfAborted();
  if(String(url)==='/api/inbox/channels')return Response.json({success:true,channels:rows.slice(0,2).map(row=>({id:row.social_account_id,businessId:uuid(900),platform:row.social_account.platform,name:row.social_account.account_name,platformAccountId:'fixture-account',subscriptionId:'TB',subscriptionAccessAllowed:true,accessAllowed:true,role:'owner'}))});
  if(String(url)==='/api/inbox/conversation-page'){
    window.fixtureRequests.push({url:String(url),method:options.method||'GET'});
    if(window.fixturePageError)return Response.json({success:false,error:'Isolated page failure'},{status:503});
    return fixturePageResponse(inboxRows,JSON.parse(options.body));
  }
  return baseFetch(url,options);
});
const initial=page(request);
function mount(){
  createRoot(document.getElementById('root')).render(h(React.Profiler,{id:'Inbox',onRender:recorder.onRender},
    h(DashboardUtilityNavigationProvider,{isAdmin:false},h(InboxReturnContextProvider,{userId:uuid(902),businessId:uuid(900),memberId:uuid(901)},
      h('main',{className:'flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-50'},h(InboxView,{
        conversations:initial.conversations,activeConversationId:null,messages:[],activeStatus:'all',statusCounts:initial.counts.statusCounts,
        teamMembers:[{id:uuid(901),business_id:uuid(900),full_name:'Fixture Agent',role:'owner'}],currentBusinessId:uuid(900),currentMemberId:uuid(901),accessibleBusinessIds:[uuid(900)],
        pagination:{request,page:{...initial,ids:initial.conversations.map(row=>row.id)}},
      }))))));
  window.fixtureReady=true;
}
window.inboxPerformance={...recorder,rows:inboxRows,messages,page,
  visibleRowIds:()=>Array.from(document.querySelectorAll('[data-conversation-list-id]'),node=>node.dataset.conversationListId.split(':').at(-1)),
  // Pass the actual button/link click and an exact visible row/message predicate.
  // Example: measure('cold Telegram filter',()=>telegramLink.click(),()=>sameIds(expectedIds)).
  // No automatic navigation: verify controls and expected content through the browser first.
  instructions:'Use measure(name, actualClick, correctVisibleDataPredicate). Cold/warm must be separate named results. Values cover a development React build and mocked data, not server/provider latency or physical paint. Mutation endpoints remain fixture-only.'};
void recorder.measure('first fixture mount',mount,()=>document.querySelectorAll('[data-conversation-list-id]').length>=initial.conversations.length).catch(error=>window.fixtureErrors.push(error.stack));
