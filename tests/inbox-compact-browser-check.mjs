import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import assert from 'node:assert/strict';

const root=process.cwd(),evidence=path.join(root,'docs/evidence/inbox-compact-web'),baseline=process.argv.includes('--baseline'),out=fs.readFileSync(path.join(evidence,baseline?'baseline-fixture-path.txt':'fixture-path.txt'),'utf8').trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],screenshots=[],errors=[];
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://fixture.invalid').pathname;
  const file=pathname.startsWith('/images/')||pathname.startsWith('/icons/')?path.join(root,'public',pathname):path.join(out,['/bundle.js','/style.css'].includes(pathname)?pathname:'/index.html');
  if(!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,profile=fs.mkdtempSync(path.join(process.env.TEMP,'tenh-inbox-compact-edge-'));
const edge=cp.spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost','--remote-debugging-port=0','--user-data-dir='+profile,'http://127.0.0.1:'+port],{windowsHide:true,stdio:'ignore'});
let socket;
try {
  let debugPort;
  for(let i=0;i<100&&!debugPort;i++){try{debugPort=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];}catch{await pause(100);}}
  if(!debugPort)throw Error('Isolated browser did not start');
  const targets=await fetch('http://127.0.0.1:'+debugPort+'/json/list').then(r=>r.json());socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const pending=new Map();let id=0;
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.error||m.result?.exceptionDetails)p[1](Error(JSON.stringify(m.error||m.result.exceptionDetails)));else p[0](m.result);});
  const command=(method,params={})=>new Promise((resolve,reject)=>{const call=++id;pending.set(call,[resolve,reject]);socket.send(JSON.stringify({id:call,method,params}));});
  const evaluate=expression=>command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}).then(r=>r.result.value);
  const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
  const wait=async(expression)=>{for(let i=0;i<80;i++){if(await evaluate("Boolean("+expression+")"))return;await pause(100);}throw Error('Timed out: '+expression+'; '+JSON.stringify(await evaluate('({body:document.body.innerText,errors:window.fixtureErrors,ready:window.fixtureReady})'))+'; '+JSON.stringify(errors));};
  const navigate=async(query='')=>{await command('Page.navigate',{url:'http://127.0.0.1:'+port+'/dashboard/inbox'+query});await wait('document.querySelector("[data-inbox-surface]")');await pause(700);};
  const size=async(width,height,touch=false)=>{await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch});await command('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:5});await pause(120);};
  const click=async(selector)=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await pause(180);};
  const shot=async(name)=>{const r=await command('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(r.data,'base64'));screenshots.push(name+'.png');};
  await command('Runtime.enable');await command('Page.enable');
  if(baseline){
    for(const [name,width,height,touch] of [['desktop',1440,900,false],['phone-list',390,844,true],['tablet',834,1112,true]]){await size(width,height,touch);await navigate();await shot('before-'+name);}
    console.log(JSON.stringify({baseline:true,screenshots}));socket.close();edge.kill();server.close();process.exit(0);
  }
  await size(390,844,true);await navigate();
  check('no fixture runtime errors on list',(await evaluate('window.fixtureErrors')).length===0);
  check('phone list occupies available width',await evaluate('Math.abs(document.querySelector("[data-inbox-surface]").getBoundingClientRect().width-innerWidth)<2'));
  check('phone has no horizontal page overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
  check('menu precedes original logo',await evaluate('document.querySelector("[data-dashboard-mobile-menu]").compareDocumentPosition(document.querySelector("[data-dashboard-header] a"))&Node.DOCUMENT_POSITION_FOLLOWING'));
  await shot('phone-list');
  await click('[data-dashboard-mobile-menu] summary');check('global menu opens',await evaluate('document.querySelector("[data-dashboard-mobile-menu]").open'));await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await evaluate('document.querySelector("[data-inbox-list-scroll]").scrollTop=480');const anchor=await evaluate('document.querySelector("[data-inbox-list-scroll]").scrollTop');
  await click('[data-conversation-list-id] button');await wait('document.querySelector("[data-inbox-shell]").dataset.chatActive==="true"');await pause(600);
  check('chat hides the global header and list rail',await evaluate('getComputedStyle(document.querySelector("[data-dashboard-header]")).display==="none"&&getComputedStyle(document.querySelector("[data-inbox-list-pane]")).visibility==="hidden"'));
  check('chat Back and channel context are visible',await evaluate('getComputedStyle(document.querySelector("[data-inbox-chat-back]")).display!=="none"&&document.querySelector("[data-inbox-chat-identity]").textContent.includes("Apex Clothing")'));
  check('message rows and toolbar eligibility are rendered',await evaluate('document.querySelectorAll("[data-message-row]").length>0&&document.querySelectorAll("[data-message-action-toolbar]").length>0'));
  const beforeMenu=await evaluate('({requests:fixtureRequests.length,subscriptions:fixtureSubscriptions.length})');
  await click('[data-inbox-chat-more]');await click('[data-inbox-chat-more]');
  check('presentation toggles add no requests or subscriptions',await evaluate(`fixtureRequests.length===${beforeMenu.requests}&&fixtureSubscriptions.length===${beforeMenu.subscriptions}`));
  await evaluate('document.querySelector("[data-message-row]").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))');
  check('context selection reveals message actions',await evaluate('document.querySelectorAll("[data-message-actions-visible]").length>0'));
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await click('button[aria-label="Quick tags"]');check('Quick Tags opens inside viewport',await evaluate('(()=>{const r=document.querySelector("[data-inbox-quick-tag-popover]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'));await click('button[aria-label="Quick tags"]');
  await click('button[aria-label="Quick replies"]');check('Quick Reply remains accessible',await evaluate('Boolean(document.querySelector("[role=dialog][aria-labelledby]"))'));check('ported Quick Reply search uses 16px input text',await evaluate(`getComputedStyle(document.querySelector('input[aria-label="Search quick replies"]')).fontSize==="16px"`));await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await pause(100);
  await click('button.cursor-zoom-in');await wait('document.querySelector("[data-media-viewer]")');
  check('image viewer remains available and outside message selection restrictions',await evaluate('Boolean(document.querySelector("[data-media-viewer] img"))'));await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await pause(100);
  await evaluate('document.querySelector("textarea[name=message]").focus()');await command('Input.insertText',{text:'Keep my isolated draft'});await pause(100);
  await shot('phone-chat');
  const stats=await evaluate('({requests:fixtureRequests.length,subscriptions:fixtureSubscriptions.length,queries:fixtureQueries.length})');
  await click('[data-inbox-chat-more]');check('secondary header actions remain reachable',await evaluate('getComputedStyle(document.querySelector("[data-inbox-chat-actions]")).display==="flex"'));
  await shot('phone-actions');
  await click('button[aria-label="Show customer information"]');await wait('document.querySelector("[data-inbox-customer-sheet]")');
  check('details sheet is modal and bounded',await evaluate('document.querySelector("[data-inbox-customer-sheet]").getAttribute("aria-modal")==="true"&&document.querySelector("[data-inbox-customer-sheet]").getBoundingClientRect().right<=innerWidth'));
  await shot('phone-details');await click('[data-inbox-sheet-close]');
  check('closing sheet restores the same chat',await evaluate('document.querySelector("[data-inbox-shell]").dataset.chatActive==="true"'));
  await click('button[aria-label="Show customer information"]');await evaluate('history.back()');await wait('document.querySelector("[data-inbox-shell]").dataset.chatActive==="false"');check('browser Back also closes the customer sheet',await evaluate('!document.querySelector("[data-inbox-customer-sheet]")'));await evaluate('history.forward()');await wait('document.querySelector("[data-inbox-shell]").dataset.chatActive==="true"');await pause(150);
  await click('[data-inbox-chat-back]');check('Back restores list scroll',await evaluate(`Math.abs(document.querySelector('[data-inbox-list-scroll]').scrollTop-${anchor})<2`));
  check('Back preserves URL filters and clears conversation',await evaluate('!new URL(location.href).searchParams.has("conversation")'));
  await click('[data-conversation-list-id] button');await wait('document.querySelector("textarea[name=message]")');await pause(250);check('Back and reselect preserve the draft',await evaluate('document.querySelector("textarea[name=message]").value==="Keep my isolated draft"'));await click('[data-inbox-chat-back]');
  await evaluate('history.pushState(null,"","/dashboard/inbox?conversation="+fixtureRows[1].id)');await wait('document.querySelector("[data-inbox-shell]").dataset.chatActive==="true"');
  await evaluate('history.back()');await wait('document.querySelector("[data-inbox-shell]").dataset.chatActive==="false"');check('native browser Back returns to list',true);
  await evaluate('history.forward()');await wait('document.querySelector("[data-inbox-shell]").dataset.chatActive==="true"');check('native browser Forward reopens chat',true);
  await shot('phone-telegram');
  await size(390,450,true);check('reduced viewport reserves composer space',await evaluate('(()=>{const c=document.querySelector("[data-inbox-composer]").getBoundingClientRect(),m=document.querySelector("[data-message-scroll-surface]").getBoundingClientRect();return c.bottom<=450&&m.bottom<=c.top+1&&c.top>=76})()'));await shot('reduced-viewport-keyboard-emulation');await size(390,844,true);
  await evaluate('history.pushState(null,"","/dashboard/inbox?conversation="+fixtureRows[10].id);history.pushState(null,"","/dashboard/inbox?conversation="+fixtureRows[11].id);history.pushState(null,"","/dashboard/inbox?conversation="+fixtureRows[12].id)');await pause(400);
  check('rapid URL switches retain the final conversation',await evaluate('document.querySelector("[data-inbox-chat-identity]").textContent.includes("Fixture customer 12")'));
  await evaluate('window.fixtureMessageError=true;history.pushState(null,"","/dashboard/inbox?conversation="+fixtureRows[35].id)');await wait('document.body.innerText.includes("Isolated message failure")');check('failed chat request exposes retry without removing navigation',await evaluate('Boolean(document.querySelector("[data-inbox-chat-back]"))'));
  await evaluate('window.fixtureMessageError=false;[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Retry").click()');await wait('document.querySelectorAll("[data-message-row]").length>0');check('retry recovers the isolated failed request',true);
  for(const [name,width,height,touch] of [['phone-landscape',844,390,true],['tablet-portrait',834,1112,true],['tablet-landscape',1180,820,true],['desktop',1440,900,false]]){
    await size(width,height,touch);check(name+' has no page overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
    check(name+' composer stays within viewport',await evaluate('(()=>{const r=document.querySelector("[data-inbox-composer]").getBoundingClientRect();return r.bottom<=visualViewport.height+visualViewport.offsetTop+2&&r.top>=0})()'));
    if(name.startsWith('tablet'))check(name+' retains split panes and hides global header',await evaluate('getComputedStyle(document.querySelector("[data-inbox-list-pane]")).visibility!=="hidden"&&getComputedStyle(document.querySelector("[data-dashboard-header]")).display==="none"'));
    if(name==='tablet-portrait'){
      await evaluate('document.querySelector("[data-inbox-list-scroll]").scrollTop=100000');await pause(250);await evaluate('document.querySelector("[data-inbox-list-scroll]").scrollTop=100000');await pause(100);await click('[data-inbox-chat-back]');await pause(250);
      const end=await evaluate('(()=>{const list=document.querySelector("[data-inbox-list-scroll]");return {height:list.scrollHeight,viewport:list.clientHeight,top:list.scrollTop}})()');
      check('tablet Back preserves an end-of-list anchor when the global header returns: '+JSON.stringify(end),Math.abs(end.height-end.viewport-end.top)<2);
      await evaluate('history.pushState(null,"","/dashboard/inbox?conversation="+fixtureRows[35].id)');await wait('document.querySelector("[data-inbox-shell]").dataset.chatActive==="true"');await pause(150);
    }
    if(name==='desktop')check('desktop header/actions and grid remain visible',await evaluate('getComputedStyle(document.querySelector("[data-dashboard-header]")).display!=="none"&&getComputedStyle(document.querySelector("[data-inbox-chat-back]")).display==="none"&&getComputedStyle(document.querySelector("[data-inbox-chat-actions]")).display==="flex"'));
    await shot(name);
  }
  await size(320,740,true);await navigate('?language=km');check('small Khmer phone has no overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));await shot('small-phone-khmer');
  await command('Emulation.setEmulatedMedia',{features:[{name:'display-mode',value:'standalone'}]});await navigate();
  await command('Page.addScriptToEvaluateOnNewDocument',{source:'Object.defineProperty(navigator,"standalone",{value:true,configurable:true})'});await navigate();
  check('emulated iOS standalone signal is detected',await evaluate('document.querySelector("[data-inbox-shell]").dataset.standalone==="true"'));await shot('standalone-signal-emulation');
  const final=await evaluate('({requests:fixtureRequests,subscriptions:fixtureSubscriptions,queries:fixtureQueries,refreshes:fixtureRefreshes,errors:fixtureErrors})');
  check('no layout action sent a customer message or refreshed the page',!final.requests.some(r=>/\/send|\/reply/.test(r.url))&&final.refreshes===0);
  check('fixture remains free of runtime errors',final.errors.length===0&&errors.length===0);
  fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify({checks,screenshots,errors,stats,final,physicalDeviceTested:false},null,2));console.log(JSON.stringify({passed:checks.length,screenshots,physicalDeviceTested:false},null,2));
} catch(error) {fs.writeFileSync(path.join(evidence,'browser-failure.txt'),String(error.stack));throw error;}
finally {socket?.close();edge.kill();server.close();}
