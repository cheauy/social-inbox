const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const profile=path.join(process.env.TEMP,`tenh-search-check-${Date.now()}`);
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--no-sandbox','--disable-background-networking','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank',
],{windowsHide:true,stdio:'ignore'});
let socket,next=0;const pending=new Map();
let stage="launch";
const guard=setTimeout(()=>{socket?.close();chrome.kill();console.error('Search fixture timed out at '+stage);process.exitCode=1;},45000);
(async()=>{try{
  let port;for(let attempt=0;attempt<60;attempt++){await pause(100);const marker=path.join(profile,'DevToolsActivePort');if(fs.existsSync(marker)){port=fs.readFileSync(marker,'utf8').split(/\r?\n/)[0];break;}}
  if(!port)throw Error('No Chrome debugging port');
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(tabs.find(tab=>tab.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  socket.onmessage=event=>{const result=JSON.parse(event.data);if(result.id&&pending.has(result.id)){const {resolve,reject}=pending.get(result.id);pending.delete(result.id);result.error?reject(Error(result.error.message)):resolve(result.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  stage='page setup';await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1000,height:700,deviceScaleFactor:1,mobile:false});
  stage='navigate';await send('Page.navigate',{url:'file:///'+path.join(process.env.TEMP,'tenh-search-browser.html').replaceAll('\\','/')});
  stage="fixture";let result;for(let attempt=0;attempt<300;attempt++){await pause(100);const read=await send('Runtime.evaluate',{expression:'document.getElementById("result")?.textContent',returnByValue:true});const text=read.result?.value;if(text&&text!=='PENDING'){result=JSON.parse(text);break;}}
  if(!result){const dom=await send('Runtime.evaluate',{expression:'document.body.innerText',returnByValue:true});throw Error('Fixture remained pending: '+dom.result?.value);}
  fs.writeFileSync(path.join(process.env.TEMP,'tenh-search-browser-result.json'),JSON.stringify(result,null,2));
  const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.TEMP,'tenh-search-browser.png'),Buffer.from(screenshot.data,'base64'));
  console.log(JSON.stringify(result));if(!result.success)process.exitCode=1;
  await send('Browser.close').catch(()=>{});
 }catch(error){console.error(error.message);process.exitCode=1;}finally{clearTimeout(guard);socket?.close();chrome.kill();}})();
