const test=require('node:test'),assert=require('node:assert/strict');
const {loader,hooks,tick,uuid}=require('./inbox-recovery-harness.cjs');
const {fixturePage,fixturePageResponse}=require('./fixtures/inbox-interaction-page.cjs');
test('browser fixture responses pass through the real pager for channel, unread, pin and empty navigation',async()=>{
  const rows=loader()('lib/inbox/conversation-page-contract.ts').sortConversationPage(Array.from({length:45},(_,i)=>({id:uuid(i+1),business_id:uuid(900),social_account_id:uuid(i%2?801:800),status:'open',unread_count:i<8?1:0,is_pinned:i===2,last_message_at:'2026-10-17T00:00:00Z',contact:{full_name:'Fixture '+i},social_account:{id:uuid(i%2?801:800)}})));
  const h=hooks(),window=new EventTarget(),document=new EventTarget();document.visibilityState='visible';
  let request={status:'all',view:'all',search:'',channelId:null,workspaceId:null,workspaceContextId:uuid(900),cursor:null};
  const page=fixturePage(rows,request),initial={request,page:{...page,ids:page.conversations.map(row=>row.id)}};
  const read=loader({react:h.React,'@/lib/display/foreground-loading':{beginForegroundLoading:()=>()=>{}}},{window,document,AbortController,CustomEvent,
    fetch:async(url,options)=>{assert.equal(url,'/api/inbox/conversation-page');return fixturePageResponse(rows,JSON.parse(options.body));}})('lib/inbox/use-conversation-pages.ts').useConversationPages;
  const render=()=>h.render(()=>read(initial,request,rows),{});
  try{
    render();
    for(const change of [{channelId:uuid(801)},{view:'unread'},{view:'pinned'},{channelId:null,view:'pinned'},{status:'closed',view:'all'}]){
      request={...request,...change};render();await tick();const result=render();
      assert.equal(result.error,null);assert.equal(result.loading,false);
      assert.deepEqual(Array.from(result.rows,row=>row.id),Array.from(fixturePage(rows,request).conversations,row=>row.id));
    }
  }finally{h.cleanup();}
});
