const test=require('node:test'),assert=require('node:assert/strict');
const {loader,hooks,tick}=require('./inbox-recovery-harness.cjs');
test('seven simultaneous workspace consumers use one request and independent readable bodies',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r);
 const helper=loader({}, {fetch:async()=>{calls++;await gate;return Response.json({success:true,workspaces:[{businessId:'b1'}]})}})('lib/workspaces/read-workspaces.ts');
 const reads=Array.from({length:7},()=>helper.readWorkspaces());assert.equal(calls,1);release();const results=await Promise.all(reads);const data=await Promise.all(results.map(r=>r.json()));assert.equal(data.length,7);assert.equal(data[6].workspaces[0].businessId,'b1');
 await helper.readWorkspaces();assert.equal(calls,2,'completed responses are not cached across account changes');
});
test('failed workspace read retries and mutation never joins a pre-switch read',async()=>{
 let calls=0,release;const helper=loader({}, {fetch:()=>{calls++;if(calls===1)return Promise.reject(Error('offline'));if(calls===2)return new Promise(r=>release=r);return Promise.resolve(Response.json({currentBusinessId:'new'}))}})('lib/workspaces/read-workspaces.ts');
 await assert.rejects(helper.readWorkspaces(),/offline/);const old=helper.readWorkspaces();helper.invalidateWorkspaceRead();assert.equal((await (await helper.readWorkspaces()).json()).currentBusinessId,'new');release(Response.json({currentBusinessId:'old'}));await old;assert.equal(calls,3);
});
test('workspace lifecycle pauses hidden polls and batches visible focus/resume/reconnect',async()=>{
 const h=hooks(),events=new Map(),jobs=new Map(),intervals=[];let calls=0,n=0,subscribe;
 const doc={visibilityState:'visible',addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const win={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name),setTimeout:fn=>{jobs.set(++n,fn);return n},clearTimeout:id=>jobs.delete(id),setInterval:fn=>{intervals.push(fn);return 1},clearInterval(){}};
 const channel={on(){return this},subscribe(fn){subscribe=fn;return this}};
 const component=loader({react:h.React,'react/jsx-runtime':h.jsx,'next/navigation':{usePathname:()=>'/dashboard/inbox',useRouter:()=>({refresh(){}})},'@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=> 'en'},'@/lib/display/workspace-storage':{setActiveWorkspaceUiId(){}},'@/lib/supabase/client':{createClient:()=>({channel:()=>channel,removeChannel:async()=>{}})}},{document:doc,window:win,fetch:async()=>{calls++;return Response.json({success:true,workspaces:[]})}})('components/dashboard/workspace-switcher.tsx').WorkspaceSwitcher;
 try{h.render(component,{});await tick();assert.equal(calls,1);doc.visibilityState='hidden';for(let i=0;i<3;i++)intervals[0]();events.get('focus')();subscribe('SUBSCRIBED');await tick();assert.equal(calls,1);
 doc.visibilityState='visible';events.get('visibilitychange')();events.get('focus')();subscribe('SUBSCRIBED');assert.equal(jobs.size,1);for(const fn of jobs.values())fn();jobs.clear();await tick();assert.equal(calls,2);intervals[0]();await tick();assert.equal(calls,3);
 }finally{h.cleanup()}
});
function deferredHarness(){const h=hooks();let intersection,resize,renderCount=0;
 const container={scrollTop:500,getBoundingClientRect:()=>({top:0})};const element={height:160,top:-500,contains:()=>false,querySelectorAll:()=>[],getBoundingClientRect(){return {top:this.top,bottom:this.top+this.height,height:this.height}}};
 const jsx={...h.jsx,jsx:(type,props)=>{if(type==='div')props.ref(element);return h.jsx.jsx(type,props)}};
 const Component=loader({react:h.React,'react/jsx-runtime':jsx},{document:{activeElement:null},IntersectionObserver:class{constructor(fn){intersection=fn}observe(){}disconnect(){}},ResizeObserver:class{constructor(fn){resize=fn}observe(){}disconnect(){}}})('components/inbox/deferred-inbox-item.tsx').DeferredInboxItem;
 const props={enabled:true,initiallyVisible:false,forceVisible:false,containerRef:{current:container},onElement(){},children:()=>{renderCount++;element.height=300;return 'bubble'}};
 return {h,element,container,render:()=>h.render(Component,props),intersect:value=>intersection([{isIntersecting:value}]),resize:()=>resize(),count:()=>renderCount,props};
}
test('offscreen bubbles defer rendering; measured height and above-viewport expansion preserve scroll',()=>{
 const d=deferredHarness();try{const placeholder=d.render();assert.equal(d.count(),0);assert.equal(placeholder.props.style.height,160);d.intersect(true);d.render();assert.equal(d.count(),1);assert.equal(d.container.scrollTop,640);d.element.height=450;d.resize();assert.equal(d.container.scrollTop,790);d.intersect(false);const hidden=d.render();assert.equal(d.count(),1);assert.equal(hidden.props.style.height,450);assert.equal(d.container.scrollTop,790)}finally{d.h.cleanup()}
});
test('reply jump mounts an offscreen target and short threads render without virtualization',()=>{
 const d=deferredHarness();try{d.render();d.props.forceVisible=true;d.render();assert.equal(d.count(),1);d.props.forceVisible=false;d.props.enabled=false;d.render();assert.equal(d.count(),2)}finally{d.h.cleanup()}
});
test('1000-row comparable fixture mounts 40 rich rows instead of 1000; data remains complete',()=>{
 let current,element,calls=0;const observers=[];const React={};for(const name of ['useRef','useState','useEffect','useLayoutEffect'])React[name]=(...args)=>current.React[name](...args);
 const jsx={jsx:(type,props)=>{props.ref?.(element);return {type,props}}};
 const Component=loader({react:React,'react/jsx-runtime':jsx},{document:{activeElement:null},IntersectionObserver:class{constructor(fn){observers.push(fn)}observe(){}disconnect(){}},ResizeObserver:class{observe(){}disconnect(){}}})('components/inbox/deferred-inbox-item.tsx').DeferredInboxItem;
 const records=Array.from({length:1000},(_,i)=>({id:`m${i}`,text:'Customer history '.repeat(30)}));const inputBytes=Buffer.byteLength(JSON.stringify(records));
 const run=enabled=>{calls=0;for(let i=0;i<records.length;i++){current=hooks();element={getBoundingClientRect:()=>({height:160,top:0,bottom:160})};const props={enabled,initiallyVisible:i>=960,forceVisible:false,containerRef:{current:{getBoundingClientRect:()=>({top:0}),scrollTop:0}},children:()=>{calls++;return records[i].text}};current.render(Component,props);current.cleanup()}return calls};
 assert.equal(run(false),1000);assert.equal(run(true),40);assert.equal(records.length,1000);assert.equal(Buffer.byteLength(JSON.stringify(records)),inputBytes);
});
test('focused controls and playing media survive leaving the viewport',()=>{
 const d=deferredHarness();try{d.props.initiallyVisible=true;d.render();d.element.contains=()=>true;d.intersect(false);d.render();assert.equal(d.count(),2);d.element.contains=()=>false;d.element.querySelectorAll=()=>[{paused:false}];d.intersect(false);d.render();assert.equal(d.count(),3)}finally{d.h.cleanup()}
});
test('browsers without IntersectionObserver render all history normally',()=>{
 const h=hooks();const Component=loader({react:h.React,'react/jsx-runtime':h.jsx})('components/inbox/deferred-inbox-item.tsx').DeferredInboxItem;let count=0;try{h.render(Component,{enabled:true,initiallyVisible:false,forceVisible:false,containerRef:{current:null},children:()=>{count++;return 'history'}});assert.equal(count,1)}finally{h.cleanup()}
});
test('moving a reply target into view discards stale above-viewport anchoring',()=>{
 const d=deferredHarness();try{d.render();d.intersect(false);d.element.top=20;d.props.forceVisible=true;d.render();assert.equal(d.container.scrollTop,500)}finally{d.h.cleanup()}
});
test('one workspace consumer aborts without cancelling another shared read',async()=>{
 let release,calls=0;const helper=loader({}, {fetch:()=>{calls++;return new Promise(resolve=>release=resolve)}})('lib/workspaces/read-workspaces.ts');const controller=new AbortController();const cancelled=helper.readWorkspaces(controller.signal);const other=helper.readWorkspaces();controller.abort();await assert.rejects(cancelled);release(Response.json({success:true}));assert.equal((await (await other).json()).success,true);assert.equal(calls,1);
});
test('recovered insertion above a long thread preserves its visible message; append and duplicate do not jump',()=>{
 const helpers=loader()('lib/inbox/scroll-anchor.ts');const rows=Array.from({length:1000},(_,i)=>({id:`m${i}`}));const container={scrollTop:500,getBoundingClientRect:()=>({top:0})};let order=rows;let reads=0;
 const elementFor=id=>{const index=order.findIndex(r=>r.id===id);if(index<0)return;return {getBoundingClientRect:()=>{reads++;return {top:index*100-container.scrollTop,bottom:(index+1)*100-container.scrollTop}}}};
 const anchor=helpers.captureScrollAnchor(rows,elementFor,container);assert.equal(anchor.id,'m5');assert.ok(reads<=13,'logarithmic element measurements');order=[{id:'recovered'},...rows];helpers.restoreScrollAnchor(anchor,elementFor,container);assert.equal(container.scrollTop,600);order=[...order,{id:'incoming'}];helpers.restoreScrollAnchor(anchor,elementFor,container);assert.equal(container.scrollTop,600);helpers.restoreScrollAnchor(anchor,elementFor,container);assert.equal(container.scrollTop,600);
});
test('native list anchoring does not receive a second manual offset',()=>{
 const d=deferredHarness();try{d.props.manualAnchoring=false;d.render();d.intersect(true);d.render();assert.equal(d.container.scrollTop,500);d.element.height=450;d.resize();assert.equal(d.container.scrollTop,500)}finally{d.h.cleanup()}
});
