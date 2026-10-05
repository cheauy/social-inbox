/* eslint-disable @typescript-eslint/no-require-imports -- Isolated real React browser regression, no server/provider. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
test('real React effect scheduling refetches expiry and binds identical-workspace switches without stale quotes',async()=>{
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tenh-duration-effects-'));
 const write=(name,body)=>{const target=path.join(temp,name);fs.writeFileSync(target,body);return target;};
 const loader=write('typescript-loader.cjs',`const ts=require(${JSON.stringify(path.join(root,'node_modules/typescript'))});module.exports=function(s){return ts.transpileModule(s,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
 const navigation=write('navigation.cjs',"exports.useRouter=()=>({push:()=>{throw Error('Browser test must not start checkout')}});");
 const language=write('language.cjs',"exports.useWorkspaceLanguageId=()=>window.__durationLanguage||'en';");
 const webpack=require(path.join(root,'node_modules/next/dist/compiled/webpack/webpack')).webpack;
 await new Promise((resolve,reject)=>webpack({mode:'production',entry:path.join(root,'tests/fixtures/payway-upgrade-duration-browser.entry.cjs'),
   output:{path:temp,filename:'bundle.js'},resolve:{extensions:['.ts','.tsx','.js','.cjs'],modules:[path.join(root,'node_modules')],
   alias:{'next/navigation$':navigation,'@/components/display/workspace-language-text$':language,'@':root}},
   module:{rules:[{test:/\.tsx?$/,use:loader}]},optimization:{minimize:false}},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
 write('index.html','<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><pre id="result">PENDING</pre><script src="bundle.js"></script></body></html>');
 const chrome=spawn(process.env.TENH_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--no-sandbox','--disable-background-networking','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0','--user-data-dir='+path.join(temp,'profile'),'about:blank'],{windowsHide:true,stdio:'ignore'});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let socket,next=0;const pending=new Map();
 try{
  let port;for(let i=0;i<80;i++){const marker=path.join(temp,'profile/DevToolsActivePort');if(fs.existsSync(marker)){port=fs.readFileSync(marker,'utf8').split(/\r?\n/)[0];break;}await pause(100);}
  assert.ok(port,'Chrome debugging port unavailable');
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(pages.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const value=JSON.parse(event.data);if(value.id&&pending.has(value.id)){const pair=pending.get(value.id);pending.delete(value.id);if(value.error)pair.reject(Error(value.error.message));else pair.resolve(value.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:'file:///'+path.join(temp,'index.html').replaceAll('\\','/')});
  let result;for(let i=0;i<220;i++){await pause(100);const read=await send('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent',returnByValue:true});if(read.result?.value&&read.result.value!=='PENDING'){result=JSON.parse(read.result.value);break;}}
  assert.ok(result,'Browser effect fixture timed out');write('result.json',JSON.stringify(result,null,2));
  assert.equal(result.success,true,result.error);assert.equal(result.real_react_effects,true);assert.equal(result.checks_passed,5);
  console.log(JSON.stringify({artifact_root:temp,...result}));await send('Browser.close').catch(()=>{});
 }finally{socket?.close();chrome.kill();}
});
