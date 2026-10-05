const test=require('node:test'),assert=require('node:assert/strict');
const {loader,hooks,tick,uuid}=require('./inbox-recovery-harness.cjs');

/*
 * Status filter transitions in paging mode.
 *
 * The pager is driven through the real useConversationPages hook with fetch
 * responses released by hand, so request counts, ordering and loading state
 * are observed rather than assumed. The list's scope resolution is the real
 * lib/inbox/status-destination.ts the component uses.
 */

const contract=loader()('lib/inbox/conversation-page-contract.ts');
const dest=loader()('lib/inbox/status-destination.ts');
const request=(extra={})=>({...contract.parseConversationPageRequest({workspaceContextId:uuid(900)}),...extra});
const row=(n,status='open')=>({id:uuid(n),business_id:uuid(900),status,is_pinned:false,
  last_message_at:new Date(Date.UTC(2026,8,30,0,0,1000-n)).toISOString(),updated_at:'2026-09-30T20:00:00Z',unread_count:0});
const counts={views:{all:9,unread:0,my:0,unassigned:9,comment:0,open:9,pinned:0},statusCounts:{all:9,open:3,pending:3,resolved:3,closed:0,spam:0},totalUnreadCount:0,unreadConversationCount:0};
const page=rows=>({conversations:rows,updates:[],matchedKnownIds:[],total:rows.length,hasMore:false,cursor:null,counts,readTargets:[]});
const rowsFor={open:[row(1),row(2),row(3)],pending:[row(11,'pending'),row(12,'pending'),row(13,'pending')],
  resolved:[row(21,'resolved'),row(22,'resolved'),row(23,'resolved')],closed:[],spam:[]};

function harness(){
  const h=hooks(),events=new Map(),jobs=new Map(),calls=[];let timer=0;
  const releases=[];
  // Every read waits until the test releases it, in any order it chooses.
  let answer=(body,signal)=>new Promise((resolve,reject)=>{
    const entry={body,resolve:value=>resolve(value),reject};releases.push(entry);
    signal?.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));
  });
  const doc={visibilityState:'visible',addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:n=>events.delete(n)};
  const win={addEventListener:(n,fn)=>events.set(n,fn),removeEventListener:n=>events.delete(n),dispatchEvent:e=>events.get(e.type)?.(e)};
  const load=loader({react:h.React},{document:doc,window:win,AbortController,CustomEvent,
    setTimeout:fn=>{jobs.set(++timer,fn);return timer},clearTimeout:id=>jobs.delete(id),
    fetch:async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);const result=await answer(body,init.signal);
      return result instanceof Response?result:Response.json({success:true,page:result});}});
  const hook=load('lib/inbox/use-conversation-pages.ts').useConversationPages;
  const initialRows=rowsFor.open;
  const props={initial:{request:request(),page:{...page(initialRows),ids:initialRows.map(r=>r.id)}},request:request(),live:initialRows.slice()};
  props.onRows=rows=>{props.live=contract.mergeConversationPage(props.live,rows);};
  const render=()=>h.render(()=>hook(props.initial,props.request,props.live,props.onRows),{});
  const release=async(status,value)=>{const entry=releases.find(e=>e.body.status===status&&!e.done);entry.done=true;entry.resolve(value??page(rowsFor[status]));await tick();await tick();return render();};
  return {h,props,render,calls,releases,release,setAnswer:fn=>answer=fn};
}

const statuses=state=>[...new Set(state.rows.map(r=>r.status))];

/* ------------------------------------------------ destination resolution */

test('a status link destination keeps exactly the scope the URL will have',()=>{
  const d=dest.destinationFromHref('/dashboard/inbox?channel=abc&status=pending');
  assert.equal(d.status,'pending');assert.equal(d.channel,'abc');
  assert.equal(d.view,null,'the link drops the view, so the destination does too');
  assert.equal(d.workspace,null);
  assert.equal(dest.destinationFromHref('/dashboard/inbox').status,'all','Clear goes to all');
  assert.equal(dest.destinationFromHref('/dashboard/inbox?status=bogus').status,'all');
  assert.equal(dest.destinationFromParams(new URLSearchParams('page=legacy')).channel,'legacy','legacy page alias');
  assert.ok(dest.sameDestination(d,dest.destinationFromParams(new URLSearchParams('channel=abc&status=pending'))));
  assert.ok(!dest.sameDestination(d,dest.destinationFromParams(new URLSearchParams('channel=abc&status=open'))));
});

test('reproduction: title and rows disagree while navigation is in flight (old derivation)',()=>{
  // Before: the title followed the click, the pager request followed the URL.
  const url=new URLSearchParams('status=open'),clicked='pending';
  const before={title:clicked,requestStatus:dest.statusFromParam(url.get('status'))};
  assert.notEqual(before.title,before.requestStatus,'new title above the old filter rows');
  // After: both read one scope -- the pending destination until the URL lands.
  const scope=dest.destinationFromHref('/dashboard/inbox?status=pending');
  const after={title:scope.status,requestStatus:scope.status};
  assert.equal(after.title,after.requestStatus);
});

/* ---------------------------------------------------- pager transitions */

test('reproduction: server props for the same destination do not restart its in-flight read',async()=>{
  const d=harness();
  try{
    d.render();
    d.props.request=request({status:'pending'});d.render();await tick();
    assert.equal(d.calls.length,1,'the click starts one read');
    // The navigation lands: new server props for the same destination.
    d.props.initial={request:request({status:'pending'}),page:{...page(rowsFor.pending),ids:rowsFor.pending.map(r=>r.id)}};
    d.render();await tick();
    assert.equal(d.calls.length,1,'no second read for a destination already being read');
    const s=await d.release('pending');
    assert.deepEqual(statuses(s),['pending']);assert.equal(s.initialLoading,false);
    console.log(JSON.stringify({sameDestinationReads:d.calls.length}));
  }finally{d.h.cleanup()}
});

test('cache miss: loading until the matching rows arrive, never the old filter rows',async()=>{
  const d=harness();
  try{
    d.render();
    d.props.request=request({status:'pending'});let s=d.render();
    assert.equal(s.initialLoading,true,'skeleton, not open rows under a Pending title');
    assert.equal(s.rows.length,0);
    s=await d.release('pending');
    assert.equal(s.initialLoading,false);assert.deepEqual(statuses(s),['pending']);
  }finally{d.h.cleanup()}
});

test('rapid Open -> Pending -> Resolved with out-of-order responses settles on Resolved',async()=>{
  const d=harness();
  try{
    d.render();
    d.props.request=request({status:'pending'});d.render();await tick();
    d.props.request=request({status:'resolved'});d.render();await tick();
    assert.equal(d.calls.length,2);
    let s=await d.release('resolved');
    assert.deepEqual(statuses(s),['resolved']);
    // The older Pending response lands afterwards; it was aborted and must not win.
    const pendingEntry=d.releases.find(e=>e.body.status==='pending');
    pendingEntry.resolve(page(rowsFor.pending));await tick();await tick();s=d.render();
    assert.deepEqual(statuses(s),['resolved'],'a stale response never overrides the newer selection');
    assert.equal(s.loading,false);
  }finally{d.h.cleanup()}
});

test('Back to a visited filter shows its cached rows at once, then revalidates once',async()=>{
  const d=harness();
  try{
    d.render();
    d.props.request=request({status:'pending'});d.render();await tick();await d.release('pending');
    const before=d.calls.length;
    d.props.request=request();const start=performance.now();const s=d.render();const ms=performance.now()-start;
    assert.equal(s.initialLoading,false,'cache hit: no skeleton');
    assert.deepEqual(statuses(s),['open'],'and only Open rows');
    await tick();
    assert.equal(d.calls.length,before+1,'one background revalidation');
    console.log(JSON.stringify({cacheHitRenderMs:Number(ms.toFixed(2)),readsOnReturn:d.calls.length-before}));
  }finally{d.h.cleanup()}
});

test('a valid empty result is loaded, not loading',async()=>{
  const d=harness();
  try{
    d.render();
    d.props.request=request({status:'closed'});d.render();await tick();
    const s=await d.release('closed',page([]));
    assert.equal(s.initialLoading,false);assert.equal(s.loading,false);assert.equal(s.rows.length,0);assert.equal(s.error??null,null);
  }finally{d.h.cleanup()}
});

test('failure shows an error for that filter, and retry loads it',async()=>{
  const d=harness();
  try{
    d.render();
    d.props.request=request({status:'resolved'});d.render();await tick();
    let s=await d.release('resolved',Response.json({success:false,error:'Temporary failure'},{status:500}));
    assert.equal(s.error,'Temporary failure');assert.equal(s.rows.length,0,'no other filter rows shown');
    s.retry();await tick();
    s=await d.release('resolved');
    assert.equal(s.error??null,null);assert.deepEqual(statuses(s),['resolved']);
  }finally{d.h.cleanup()}
});

test('Clear returns to all, from cache when visited',async()=>{
  const d=harness();
  try{
    d.render();
    d.props.request=request({status:'pending'});d.render();await tick();await d.release('pending');
    const clearTo=dest.destinationFromHref('/dashboard/inbox');
    d.props.request=request({status:clearTo.status==='all'?'all':clearTo.status});
    const s=d.render();
    assert.equal(s.initialLoading,false);assert.deepEqual(statuses(s),['open']);
  }finally{d.h.cleanup()}
});
