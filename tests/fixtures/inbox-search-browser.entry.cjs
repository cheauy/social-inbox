const React=require('react'),{createRoot}=require('react-dom/client'),h=React.createElement;
const {CustomerAvatar}=require('../../components/customer-avatar');
const {useConversationPages}=require('../../lib/inbox/use-conversation-pages');
const {searchRowSubtitle}=require('../../lib/inbox/search-match');
const {useSearchJump,createFlightLoader,createOwnedLoader}=require(process.env.SEARCH_JUMP_FIXTURE);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const row={id:id(1),business_id:id(900),status:'open',last_message_text:'🙂 RECEIVE',unread_count:0,updated_at:'2026-10-02T00:00:00Z',last_message_at:'2026-10-02T00:00:00Z'};
const match={messageId:'deep',text:'Call 012345678 tomorrow',sentAt:'2025-01-01T00:00:00Z'};
const counts={views:{all:1},statusCounts:{all:1,open:1},totalUnreadCount:0,unreadConversationCount:0};
const page=query=>({conversations:[row],updates:[],matchedKnownIds:[],total:1,counts,cursor:null,hasMore:false,readTargets:[],searchMatches:query?{[row.id]:query==='slow'?{...match,messageId:'wrong',text:'wrong slow result'}:match}:{}});
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>');
let api,loads=0,notices=[],releaseConcurrent,concurrent=false,crossMode=false;const crossReleases=new Map();
globalThis.fetch=async(url,init)=>{if(url!=='/api/inbox/conversation-page')throw Error('No live network');const body=JSON.parse(init.body);await pause(body.search==='slow'?500:25);return Response.json({success:true,page:page(body.search)});};
function App(){
 const base=React.useMemo(()=>({status:'all',view:'all',search:'',channelId:null,workspaceId:null,workspaceContextId:id(900),cursor:null}),[]);
 const initial=React.useMemo(()=>({request:base,page:{...page(''),ids:[row.id]}}),[]),[request,setRequest]=React.useState(base),[avatar,setAvatar]=React.useState(true),[messages,setMessages]=React.useState([]),[highlight,setHighlight]=React.useState(null);
 const [thread,setThread]=React.useState(row.id),[historyLoading,setHistoryLoading]=React.useState(false);
 const desired=React.useRef(thread),jumpConversationRef=React.useRef(thread);desired.current=thread;jumpConversationRef.current=thread;
 const pager=useConversationPages(initial,request,[row]);
 const latestMessagesRef=React.useRef(messages),loadOlderForJumpRef=React.useRef(),messageElementRefs=React.useRef(new Map()),photoGroups=React.useMemo(()=>new Map(),[]);
 latestMessagesRef.current=messages;
 const olderMessageFlightRef=React.useRef(new Map());
 loadOlderForJumpRef.current=createFlightLoader({resolvedActiveConversationId:row.id,olderMessageFlightRef,loadOlderMessagePage:async()=>{
  if(concurrent){await new Promise(resolve=>{releaseConcurrent=()=>{setMessages(current=>[...current,{id:'second',conversation_id:row.id}]);resolve();};});return true;}
  await pause(5);loads++;if(loads===15)setMessages([{id:'deep',conversation_id:row.id}]);return true;
 }});
 if(crossMode)loadOlderForJumpRef.current=createOwnedLoader({resolvedActiveConversationId:thread,olderMessageFlightRef,desiredConversationIdRef:desired,hasMoreOlderMessages:true,liveMessages:messages,MESSAGE_PAGE_SIZE:25,
  setHasMoreOlderMessages(){},setLoadingOlderMessages:setHistoryLoading,setOlderMessagesError:value=>{if(value)notices.push(value);},setLiveMessages:setMessages,messageOrderMs:message=>Date.parse(message.created_at),readMessagePageResponse:async response=>response,
  fetch:url=>{const name=url.match(/conversations\/([^/]+)/)[1];return new Promise(resolve=>crossReleases.set(name,()=>resolve({messages:[{id:name+'-target',conversation_id:name,created_at:'2026-10-01T00:00:00Z'}],hasMore:false})));}
 });
 const jump=useSearchJump({jumpConversationRef,latestMessagesRef,hasMoreOlderMessagesRef:{current:true},loadOlderForJumpRef,photoGroups,
  resolvePhotoReplyTarget:(rows,target,conversation)=>rows.find(r=>r.id===target&&r.conversation_id===conversation),
  photoElementRefs:{current:new Map()},messageElementRefs,deferredMessageRefs:{current:new Map()},userNearBottomRef:{current:false},setShowScrollToLatest(){},setJumpHighlightedMessageId:setHighlight,showActionNotice:value=>notices.push(value)});
 React.useEffect(()=>{api={setSearch:search=>setRequest({...base,search}),setAvatar,pager,jump,highlight,thread,historyLoading,
  switchThread:next=>{desired.current=next;setThread(next);setMessages([{id:next+'-latest',conversation_id:next,created_at:'2026-10-02T00:00:00Z'}]);setHistoryLoading(false);setHighlight(null);}};});
 const selected=pager.page?.searchMatches?.[row.id];
 return h('main',null,pager.initialLoading?h('p',{'data-skeleton':true},'Loading'):h('section',{'data-row':true},avatar?h(CustomerAvatar,{src:photo,contactId:'synthetic',platform:'facebook',name:'Jane',eager:true}):null,
  h('button',{'data-result':true,onClick:()=>void jump({localMessageId:selected?.messageId,platformMessageId:null,search:true})},searchRowSubtitle(request.search,selected,'012345678',row.last_message_text))),
 h('div',{style:{height:1200}},'Synthetic history'),messages.map(message=>h('div',{key:message.id,'data-message-id':message.id,'data-highlight':highlight===message.id,ref:element=>{if(element)messageElementRefs.current.set(message.id,element);},style:{height:70}},message.id==='second'?'Second matching message':match.text)));
}
createRoot(document.getElementById('app')).render(h(App));
(async()=>{
 while(!api)await pause(10);while(!document.querySelector('img')?.complete||document.querySelector('img')?.getAttribute('src')!==photo)await pause(10);
 api.setAvatar(false);await pause(30);api.setAvatar(true);await pause(30);
 if(document.querySelector('img').getAttribute('src')!==photo)throw Error('Avatar retries missing stored photo');
 api.setSearch('slow');await pause(40);api.setSearch('012345678');while(api.pager.initialLoading)await pause(10);await pause(600);
 if(document.querySelector('[data-result]').textContent!==match.text)throw Error('Stale query or unrelated preview');
 document.querySelector('[data-result]').click();while(api.highlight!=='deep')await pause(10);
 if(loads!==15||notices.length)throw Error('Historical jump failed');
 const exact=document.querySelector('[data-message-id="deep"]');if(exact.dataset.highlight!=='true')throw Error('Wrong message highlighted');
 await pause(400);const at=exact.getBoundingClientRect();if(at.top<0||at.top>innerHeight)throw Error('Target did not scroll into view');
 concurrent=true;const previous=new AbortController();
 const oldJump=api.jump({localMessageId:'missing-old-target',platformMessageId:null,search:true,signal:previous.signal});
 while(!releaseConcurrent)await pause(10);
 previous.abort();await oldJump;
 let cancelled=true;const newJump=api.jump({localMessageId:'second',platformMessageId:null,search:true,signal:new AbortController().signal});
 releaseConcurrent();await newJump;await pause(50);
 if(api.highlight!=='second'||notices.length)throw Error('Same-thread concurrent jump failed');
 const concurrentPassed=cancelled&&api.highlight==='second';
 crossMode=true;api.switchThread('A');while(api.thread!=='A')await pause(10);
 const crossOwner=new AbortController();const abandoned=api.jump({localMessageId:'A-target',platformMessageId:null,search:true,signal:crossOwner.signal});
 while(!crossReleases.has('A'))await pause(10);crossOwner.abort();await abandoned;
 api.switchThread('B');while(api.thread!=='B')await pause(10);
 const bJump=api.jump({localMessageId:'B-target',platformMessageId:null,search:true,signal:new AbortController().signal});
 while(!crossReleases.has('B'))await pause(10);crossReleases.get('A')();await pause(50);
 if(!api.historyLoading||document.querySelector('[data-message-id="A-target"]'))throw Error('Old A changed pending B');
 crossReleases.get('B')();await bJump;await pause(50);
 if(api.highlight!=='B-target'||notices.length||document.querySelector('[data-message-id="B-target"]').dataset.highlight!=='true')throw Error('Cross-thread exact jump failed');
 const owned={active:'A' ,flights:{current:new Map()},desired:{current:'A'},messages:[],loading:false,error:null,releases:new Map(),requests:[]};
 const start=conversation=>{
  owned.active=conversation;owned.desired.current=conversation;owned.loading=false;owned.messages=[{id:conversation+'-latest',conversation_id:conversation,created_at:'2026-10-02T00:00:00Z'}];
  return createOwnedLoader({resolvedActiveConversationId:conversation,olderMessageFlightRef:owned.flights,desiredConversationIdRef:owned.desired,hasMoreOlderMessages:true,liveMessages:owned.messages,MESSAGE_PAGE_SIZE:25,
   setHasMoreOlderMessages(){},setLoadingOlderMessages:value=>{owned.loading=value;},setOlderMessagesError:value=>{owned.error=value;},setLiveMessages:update=>{owned.messages=update(owned.messages);},messageOrderMs:message=>Date.parse(message.created_at),readMessagePageResponse:async response=>response,
   fetch:url=>{const name=url.match(/conversations\/([^/]+)/)[1];owned.requests.push(name);return new Promise(resolve=>owned.releases.set(name,()=>resolve({messages:[{id:name+'-older',conversation_id:name,created_at:'2026-10-01T00:00:00Z'}],hasMore:false})));}
  })();
 };
 const a=start('A'),b=start('B');owned.releases.get('A')();await a;
 if(!owned.loading||owned.error||owned.messages.some(message=>message.conversation_id!=='B')||!owned.flights.current.has('B'))throw Error('A completion overwrote B ownership');
 owned.releases.get('B')();await b;if(owned.messages[0].id!=='B-older')throw Error('B did not load');
 const againA=start('A'),againB=start('B'),returnedA=start('A');owned.releases.get('B')();await againB;
 if(!owned.loading||!owned.flights.current.has('A'))throw Error('B cleanup cleared returned A ownership');
 owned.releases.get('A')();await Promise.all([againA,returnedA]);
 if(owned.messages[0].id!=='A-older'||owned.requests.join(',')!=='A,B,A,B'||owned.flights.current.size)throw Error('Repeated A/B ownership failed');
 const crossThreadPassed=true;
 api.setSearch('');while(api.pager.loading)await pause(10);await pause(40);
 if(api.pager.initialLoading||!document.querySelector('[data-row]'))throw Error('Warm return lost rows');
 document.getElementById('result').textContent=JSON.stringify({success:true,results:{snippet:match.text,staleSearchIgnored:true,avatarPreferredCandidate:true,historicalPages:loads,exactHighlight:true,warmReturn:true,concurrentSameThread:concurrentPassed,crossThread:crossThreadPassed,repeatedABA:true}});
})().catch(error=>document.getElementById('result').textContent=JSON.stringify({success:false,error:error.stack}));
