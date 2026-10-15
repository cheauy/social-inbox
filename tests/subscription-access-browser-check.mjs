// Offline rendering of the real gate and workspace switcher. No account or billing traffic.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), root = process.cwd();
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tenh-expiry-'));
const evidence = path.join(root, 'docs/evidence/subscription-expired-20261015');
fs.mkdirSync(evidence, { recursive: true });
const write = (file, data) => fs.writeFileSync(path.join(out, file), data);
write('loader.cjs', `const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
write('navigation.cjs', `const router={refresh(){}};exports.usePathname=()=>location.pathname;exports.useRouter=()=>router;`);
write('link.cjs', `const R=require('react');module.exports=({children,...props})=>R.createElement('a',props,children);`);
write('language.cjs', `exports.useWorkspaceLanguageId=()=>new URLSearchParams(location.search).get('language')==='km'?'km':'en';`);
write('loading.cjs', `exports.useForegroundLoading=()=>{};`);
write('storage.cjs', `exports.setActiveWorkspaceUiId=()=>{};`);
write('supabase.cjs', `const c={on(){return c},subscribe(){return c}};exports.createClient=()=>({channel:()=>c,removeChannel:()=>{}});`);
write('entry.cjs', `
const React=require('react'),{createRoot}=require('react-dom/client');
const {SubscriptionAccessGate}=require('@/components/subscription/subscription-access-gate');
const {WorkspaceSwitcher}=require('@/components/dashboard/workspace-switcher');
const h=React.createElement,q=new URLSearchParams(location.search),reason=q.get('reason')||'expired',planCode=q.get('plan')||'trial';
window.requests=[];window.switchRequests=[];
window.fetch=async(url,options)=>{window.requests.push(url);if(url==='/api/workspaces')return new Response(JSON.stringify({success:true,currentBusinessId:'expired',workspaces:[{memberId:'one',businessId:'expired',businessName:'TENH CHAT — A workspace with a very long name កន្លែងធ្វើការរបស់ក្រុមយើង',role:'owner',subscriptionOperational:false,subscription:{plan_code:'trial',status:'expired'}},{memberId:'two',businessId:'active',businessName:'Active team',role:'owner',subscriptionOperational:true,subscription:{plan_code:'pro',status:'active'}}]}));if(url==='/api/workspaces/switch'){window.switchRequests.push(JSON.parse(options.body));return new Response(JSON.stringify({success:false,error:'Offline fixture: switch observed without changing accounts.'}),{status:409});}throw Error('Unexpected request: '+url);};
const access={hasSubscription:true,locked:!q.has('active'),reason,status:reason,planCode,trialEndsAt:q.has('missing')?null:'2026-09-11T12:00:00Z',currentPeriodEnd:null,subscription:null};
document.documentElement.classList.toggle('dark',q.has('dark'));
createRoot(document.getElementById('root')).render(h('div',{className:'flex h-dvh min-h-0 flex-col overflow-hidden'},
h('header',{'data-dashboard-header':true,className:'flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3'},h('a',{href:'/dashboard/inbox',className:'flex min-h-11 shrink-0 items-center gap-2 font-bold text-slate-950'},h('img',{src:'/images/tenh_logo.png',width:40,height:40,alt:''}),'TENH CHAT'),h(WorkspaceSwitcher)),
h('main',{className:'min-h-0 min-w-0 flex-1 overflow-hidden'},h(SubscriptionAccessGate,{access},h('p',{'data-allowed':true},'Allowed route content')))));
`);
const css = await require('postcss')([require('@tailwindcss/postcss')()]).process(fs.readFileSync('app/globals.css','utf8'), {from:path.join(root,'app/globals.css')});
write('style.css', css.css);
const alias = {};
for (const [name,file] of Object.entries({'next/navigation':'navigation','next/link':'link','@/components/display/workspace-language-text':'language','@/lib/display/foreground-loading':'loading','@/lib/display/workspace-storage':'storage','@/lib/supabase/client':'supabase'})) alias[name+'$'] = path.join(out,file+'.cjs');
alias['@'] = root;
await new Promise((resolve,reject)=>require('next/dist/compiled/webpack/webpack').webpack({mode:'development',devtool:false,entry:path.join(out,'entry.cjs'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js','.cjs'],alias,modules:[path.join(root,'node_modules')]},module:{rules:[{test:/\.tsx?$/,use:path.join(out,'loader.cjs')}]},optimization:{minimize:false}},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
write('index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/style.css"><title>TENH expiry fixture</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://fixture.invalid').pathname;const file=p.startsWith('/images/')?path.join(root,'public',p):path.join(out,['/bundle.js','/style.css'].includes(p)?p:'/index.html');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,profile=fs.mkdtempSync(path.join(os.tmpdir(),'tenh-expiry-edge-'));
const edge=cp.spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],errors=[];
let socket;
try {
  let debugPort;
  for(let i=0;i<100&&!debugPort;i++){try{debugPort=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];}catch{await pause(100);}}
  assert.ok(debugPort,'Headless Edge started');
  const targets=await fetch('http://127.0.0.1:'+debugPort+'/json/list').then(r=>r.json());
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const pending=new Map();let id=0;
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error||m.result?.exceptionDetails)p[1](Error(JSON.stringify(m.error||m.result.exceptionDetails)));else p[0](m.result);});
  const command=(method,params={})=>new Promise((resolve,reject)=>{const call=++id;pending.set(call,[resolve,reject]);socket.send(JSON.stringify({id:call,method,params}));});
  const evaluate=expression=>command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}).then(r=>r.result.value);
  const check=(name,result)=>{assert.ok(result,name);checks.push(name);};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate('Boolean('+expression+')'))return;await pause(100);}throw Error('Timeout: '+expression+'; '+JSON.stringify(errors)+'; '+await evaluate('document.body.innerText'));};
  const navigate=async (query='',route='/dashboard/analytics')=>{await command('Page.navigate',{url:'http://127.0.0.1:'+port+route+query});await wait('document.querySelector("[data-subscription-lock], [data-allowed]")');await wait('document.querySelector("[data-dashboard-workspace-switcher] button")?.getAttribute("aria-label").includes("very long name")');await pause(150);};
  const size=async(width,height)=>{await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(80);};
  const shot=async name=>{const r=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(r.data,'base64'));};
  const layout=async label=>{
    check(label+': no horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll("[data-subscription-lock], [data-subscription-lock] *")].every(e=>e.getBoundingClientRect().right<=innerWidth+1)'));
    check(label+': CTA touch targets',await evaluate('[...document.querySelectorAll("[data-subscription-lock] a,[data-subscription-lock] button")].every(e=>e.getBoundingClientRect().height>=44)'));
    check(label+': footer reachable by scrolling',await evaluate('(()=>{const s=document.querySelector("[data-subscription-lock]");s.scrollTop=s.scrollHeight;const ok=s.querySelector("footer").getBoundingClientRect().bottom<=s.getBoundingClientRect().bottom+1;s.scrollTop=0;return ok;})()'));
  };
  await command('Runtime.enable');await command('Page.enable');
  for(const width of [360,390,768,820,1024,1440]){
    await size(width,1000);await navigate();await layout(width+'px');
    if([390,820,1440].includes(width))await shot(width===390?'mobile':width===820?'tablet':'desktop');
  }
  await size(740,360);await navigate();await layout('short landscape');await shot('landscape');
  // 200% browser zoom reduces the CSS viewport by half. Also enlarge text alone.
  await size(720,450);await navigate();await layout('1440px at 200% zoom equivalent');
  await evaluate('document.documentElement.style.fontSize="200%"');await layout('200% text scaling');await shot('text-200-percent');
  await size(390,1000);await navigate('?language=km');await layout('Khmer mobile');await shot('mobile-khmer');
  await navigate('?dark');await layout('dark mobile');await shot('mobile-dark');
  await navigate('?missing');check('missing optional date omitted',await evaluate('!document.body.innerText.includes("Invalid Date") && !document.body.innerText.includes("Ended")'));
  await navigate();await wait('document.querySelector("[data-dashboard-workspace-switcher] button").title==="Switch workspace"');
  check('long real-state workspace name available',await evaluate('document.querySelector("[data-dashboard-workspace-switcher] button").getAttribute("aria-label").includes("very long name")'));
  await evaluate('document.querySelector("[data-subscription-lock] button").click()');
  await wait('document.querySelector("[role=listbox]")');
  check('secondary opens authorized switcher',await evaluate('document.querySelector("[data-dashboard-workspace-switcher] button").getAttribute("aria-expanded")==="true"'));
  check('expired workspace excluded from switch targets',await evaluate('document.querySelectorAll("[role=option]").length===1 && document.querySelector("[role=option]").textContent.includes("Active team")'));
  await evaluate('document.querySelector("[role=option]").click()');await wait('window.switchRequests.length===1');
  check('real workspace handler posts selected authorized ID',await evaluate('window.switchRequests[0].businessId==="active"'));
  await navigate();check('render performs no billing mutations',await evaluate('window.requests.every(url=>url==="/api/workspaces")'));
  await evaluate('document.querySelector("a[href=\\"/dashboard/subscription\\"]").click()');await wait('document.querySelector("[data-allowed]")');check('primary opens subscription route',await evaluate('location.pathname==="/dashboard/subscription"'));
  await navigate();await evaluate('document.querySelector("[data-subscription-lock] a[href=\\"/dashboard/settings/security\\"]").click()');await wait('document.querySelector("[data-allowed]")');check('security opens existing allowed route',await evaluate('location.pathname==="/dashboard/settings/security"'));
  for(const query of ['?active','?active&plan=pro']){await navigate(query);check(query+': active account sees content',await evaluate('!!document.querySelector("[data-allowed]")'));}
  for(const reason of ['past_due','suspended']){await navigate('?reason='+reason);check(reason+': protected content blocked',await evaluate('!document.querySelector("[data-allowed]")'));}
  await navigate('?plan=business');check('paid expiry keeps Channels destination',await evaluate('!!document.querySelector("[data-subscription-lock] a[href=\\"/dashboard/integrations\\"]")'));
  check('no browser exceptions',errors.length===0);
  fs.writeFileSync(path.join(evidence,'checks.json'),JSON.stringify({fixture:'Offline real gate and switcher; synthetic shell and account data; no live billing or auth',checks,errors},null,2));
  console.log(JSON.stringify({passed:checks.length,evidence}));
} finally {socket?.close();edge.kill();server.close();}
