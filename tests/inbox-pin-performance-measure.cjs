/* Real hook source, controlled lifecycle/transport; no browser or production ms. */
const fs=require('node:fs'),cp=require('node:child_process'),vm=require('node:vm'),ts=require('typescript');
const {loader,hooks,tick}=require('./inbox-recovery-harness.cjs');
const baseline='35b5fdd8a4b0cef942fda658506a0daa10b44e98';
async function measure(before){
  const h=hooks(),window=new EventTarget(),document=new EventTarget(),requests=[];
  document.visibilityState='visible';let pinReferenceChanges=0;
  const useState=h.React.useState;
  h.React.useState=function(initial){
    const [state,setState]=useState(initial);
    return [state,update=>setState(current=>{const next=typeof update==='function'?update(current):update;if(Array.isArray(current)&&next!==current)pinReferenceChanges++;return next;})];
  };
  const load=loader(),scriptModule={exports:{}};
  const dependencies={react:h.React,'@/lib/inbox/message-actions':load('lib/inbox/message-actions.ts'),'@/lib/inbox/live-sync':load('lib/inbox/live-sync.ts')};
  const source=before?cp.execFileSync('git',['show',baseline+':lib/inbox/use-pinned-messages.ts'],{encoding:'utf8'}):fs.readFileSync('lib/inbox/use-pinned-messages.ts','utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {module:scriptModule,exports:scriptModule.exports,require:name=>dependencies[name],window,document,AbortController,AbortSignal,CustomEvent,
      fetch:(url,init)=>new Promise(resolve=>requests.push({url,init,resolve}))});
  const render=()=>h.render(()=>scriptModule.exports.usePinnedMessages('a',[]),{});
  try{
    render();for(let i=0;i<3;i++)window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));
    const simultaneousReads=requests.length;
    for(const read of [...requests])read.resolve(Response.json({success:true,pins:[]}));await tick();
    if(requests.length>simultaneousReads){requests.at(-1).resolve(Response.json({success:true,pins:[]}));await tick();}
    pinReferenceChanges=0;
    for(let i=0;i<100;i++)window.dispatchEvent(new CustomEvent('tenh:message-row-changed',{detail:{eventType:'UPDATE',row:{id:'m'+i,conversation_id:'a',raw_payload:{}}}}));
    return {simultaneousPinReads:simultaneousReads,totalPinReadsIncludingTrailingCatchUp:requests.length,ordinaryUnpinnedEvents:100,pinStateReferenceChanges:pinReferenceChanges};
  }finally{h.cleanup();}
}
(async()=>{const result={kind:'source measurement with Node hook/transport doubles; no browser renders or production timing',baseline,before:await measure(true),after:await measure(false)};
  fs.mkdirSync('docs/evidence/inbox-interaction-performance-20261017',{recursive:true});
  fs.writeFileSync('docs/evidence/inbox-interaction-performance-20261017/pin-source-measurements.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
