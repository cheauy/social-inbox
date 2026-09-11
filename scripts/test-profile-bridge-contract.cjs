const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function harness(){
  const listeners=new Map(),sent=[],workers=[],timers=new Set();
  const host={location:{origin:'https://app.tenhchat.com'},
    addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn)},
    removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn),
    postMessage:data=>{sent.push(data);queueMicrotask(()=>{for(const fn of [...listeners.get('message')||[]])fn({data,source:host,origin:host.location.origin})})},
    setTimeout:(fn,ms)=>{const id=setTimeout(fn,ms);timers.add(id);return id},
    clearTimeout:id=>{timers.delete(id);clearTimeout(id)},setInterval:()=>1,clearInterval:()=>{},
  };
  const payload={businessId:'workspace',pageId:'123456',threadId:'987654',conversationId:'conversation',customerName:'Customer'};
  const runtime={id:'test-extension',getManifest:()=>({version:'1.2.18'}),onMessage:{addListener:()=>{}},lastError:null,
    sendMessage:(message,callback)=>{
      workers.push(message);
      let result={connected:true};
      if(message.type==='OPEN_FACEBOOK_PROFILE')result={...payload,resolved:true,verified:true,profileUrl:'https://www.facebook.com/customer.test',openToken:'safe-ticket'};
      if(message.type==='OPEN_RESOLVED_FACEBOOK_PROFILE')result={...payload,opened:true,verified:true,profileUrl:'https://www.facebook.com/customer.test'};
      callback(result);
    },
  };
  const context=vm.createContext({window:host,document:{hidden:true,addEventListener:()=>{}},chrome:{runtime},
    setInterval:()=>1,clearInterval:()=>{},setTimeout,clearTimeout,Promise,Date,URL,queueMicrotask,console});
  vm.runInContext(fs.readFileSync('tenh-extension/src/tenh-bridge.js','utf8'),context);
  const helper={};vm.runInNewContext(compile('lib/extension/companion-response.ts'),{exports:helper,window:host,Promise});
  const hook={};vm.runInNewContext(compile('lib/extension/use-companion.ts'),{exports:hook,window:host,Date,Math,Promise,
    require:name=>name==='react'?{useCallback:fn=>fn,useEffect:()=>{},useState:()=>[true,()=>{}]}:helper});
  return {hook:hook.useCompanion(),payload,workers,sent,timers};
}
test('actual hook -> actual content bridge sends both profile commands and all context fields',async()=>{
  const h=harness();const resolved=await h.hook.openFacebookProfile(h.payload);
  assert.equal(resolved.resolved,true);assert.equal(resolved.openToken,'safe-ticket');
  const opened=await h.hook.openResolvedFacebookProfile(resolved.openToken,h.payload);
  assert.equal(opened.opened,true);
  const commands=h.workers.filter(w=>w.type.includes('FACEBOOK_PROFILE'));
  assert.equal(commands.length,2);
  for(const command of commands)for(const key of ['businessId','pageId','threadId','conversationId'])assert.equal(command[key],h.payload[key]);
  assert.equal(commands[1].openToken,'safe-ticket');assert.equal(h.timers.size,0);
});
