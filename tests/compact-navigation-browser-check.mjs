import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import assert from 'node:assert/strict';

const root=process.cwd(),evidence=path.join(root,'docs/evidence/compact-navigation-20261012'),baseline=process.argv.includes('--baseline'),out=fs.readFileSync(path.join(evidence,baseline?'baseline-fixture-path.txt':'fixture-path.txt'),'utf8').trim();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[],screenshots=[],errors=[];
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://fixture.invalid').pathname;
  const file=pathname.startsWith('/images/')||pathname.startsWith('/icons/')?path.join(root,'public',pathname):path.join(out,['/bundle.js','/style.css'].includes(pathname)?pathname:'/index.html');
  if(!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,profile=fs.mkdtempSync(path.join(process.env.TEMP,'tenh-navigation-edge-'));
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
    for(const [name,w,h,touch] of [['phone',390,844,true],['tablet',834,1112,true],['ipad-pro',1366,1024,true],['desktop',1440,900,false]]){await size(w,h,touch);await navigate();await shot('before-'+name);if(name==='phone')fs.writeFileSync(path.join(evidence,'before-inbox-stats.json'),JSON.stringify(await evaluate('({requests:fixtureRequests.length,subscriptions:fixtureSubscriptions.length})'),null,2));}
    await navigate('?admin=true');await evaluate('history.pushState(null,"","/dashboard/settings/general")');await wait('document.querySelector("[data-settings-surface]")');await pause(200);await shot('before-desktop-settings');
  }else{
    await size(390,844,true);await navigate();await wait('window.fixtureReady && document.querySelector("[data-notifications-trigger]").textContent.includes("3")');
    check('four and only four bottom destinations',await evaluate('document.querySelector("[data-dashboard-bottom-nav]").children.length===4'));
    check('notification badge remains on bottom Notifications',await evaluate('document.querySelector("[data-dashboard-bottom-nav] [data-notifications-trigger]").textContent.includes("3")'));
    check('no duplicate notification owners',await evaluate('document.querySelectorAll("[data-notifications-trigger]").length===1'));
    check('long workspace name keeps Profile inside header',await evaluate('document.querySelector("[aria-label=\\"Open profile menu\\"]").getBoundingClientRect().right<=innerWidth && document.querySelector("[data-dashboard-workspace-switcher] button").getAttribute("aria-label").includes("very long name")'));
    check('search Filter Smart View order',await evaluate('(()=>{const c=document.querySelector("[data-inbox-search-controls]");return c.children[0].querySelector("input") && c.children[1].hasAttribute("data-inbox-filter-control") && c.children[2].hasAttribute("data-inbox-smart-control")})()'));
    check('tabs immediately below search controls',await evaluate('document.querySelector("[data-inbox-search-controls]").nextElementSibling?.hasAttribute("data-inbox-view-tabs")===true'));
    const beforeMore=await evaluate('({requests:fixtureRequests.length,subscriptions:fixtureSubscriptions.length})');
    await shot('phone-inbox');
    await evaluate('document.documentElement.style.setProperty("--tenh-primary","#9333ea");document.documentElement.style.setProperty("--tenh-primary-light","#f3e8ff")');
    await pause(220);
    check('active bottom destination reuses workspace theme colors',await evaluate('getComputedStyle(document.querySelector("[data-dashboard-bottom-nav] a[aria-current=page]")).color==="rgb(147, 51, 234)"'));
    check('active bottom destination reuses workspace theme tint',await evaluate('getComputedStyle(document.querySelector("[data-dashboard-bottom-nav] a[aria-current=page]")).backgroundColor==="rgb(243, 232, 255)"'));
    await evaluate('document.documentElement.style.removeProperty("--tenh-primary");document.documentElement.style.removeProperty("--tenh-primary-light")');
    await pause(220);
    await click('[data-more-trigger]');check('More is a left drawer',await evaluate('document.querySelector("dialog").open && document.querySelector("dialog").getBoundingClientRect().left===0'));
    check('More has exactly the three permitted destinations',await evaluate('JSON.stringify([...document.querySelectorAll("dialog a")].map(a=>a.pathname))===JSON.stringify(["/dashboard/subscription","/dashboard/integrations","/dashboard/settings"])'));
    check('More contains no Profile workspace or Admin controls',await evaluate('!document.querySelector("dialog [data-dashboard-workspace-switcher]") && !document.querySelector("dialog a[href=\\"/dashboard/admin\\"]") && !document.querySelector("dialog a[href=\\"/dashboard/profile\\"]")'));
    await shot('phone-more');
    for(let i=0;i<8;i++){await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});check('native drawer traps focus '+i,await evaluate('document.querySelector("dialog").contains(document.activeElement)'));}
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await pause(120);
    check('Escape closes More and restores trigger focus',await evaluate('!document.querySelector("dialog").open && document.activeElement.hasAttribute("data-more-trigger")'));
    await click('[data-more-trigger]');await command('Input.dispatchMouseEvent',{type:'mousePressed',x:382,y:240,button:'left',clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:382,y:240,button:'left',clickCount:1});await pause(120);
    check('outside tap closes More and restores focus',await evaluate('!document.querySelector("dialog").open && document.activeElement.hasAttribute("data-more-trigger")'));
    await click('[data-more-trigger]');await click('[aria-label="Close More"]');
    check('close button closes More',await evaluate('!document.querySelector("dialog").open'));
    const afterMore=await evaluate('({requests:fixtureRequests.length,subscriptions:fixtureSubscriptions.length})');
    check('drawer toggles add no requests or subscriptions',JSON.stringify(beforeMore)===JSON.stringify(afterMore));
    await click('[data-notifications-trigger]');await wait('document.querySelector("[data-notifications-panel]")');await shot('phone-notifications');
    check('notification panel clears bottom bar',await evaluate('document.querySelector("[data-notifications-panel]").getBoundingClientRect().bottom<document.querySelector("[data-dashboard-bottom-nav]").getBoundingClientRect().top'));
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await pause(100);
    await evaluate('document.documentElement.style.setProperty("--tenh-inbox-height","460px")');await click('[data-notifications-trigger]');
    check('notification panel anchors to reduced visual viewport independently of layout viewport',await evaluate('document.querySelector("[data-notifications-panel]").getBoundingClientRect().bottom<document.querySelector("[data-dashboard-bottom-nav]").getBoundingClientRect().top'));
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await click('[data-more-trigger]');
    check('More respects reduced visual viewport independently of layout viewport',await evaluate('document.querySelector("dialog").getBoundingClientRect().bottom<=document.querySelector("[data-dashboard-bottom-nav]").getBoundingClientRect().top+1'));await click('[aria-label="Close More"]');await evaluate('document.documentElement.style.removeProperty("--tenh-inbox-height")');
    await click('[aria-label="Open profile menu"]');check('existing Profile menu remains available',await evaluate('Boolean(document.querySelector("a[href=\\"/dashboard/profile\\"]"))'));await click('a[href="/dashboard/profile"]');check('Profile destination preserved',await evaluate('location.pathname==="/dashboard/profile"'));
    await click('[data-dashboard-bottom-nav] a[href^="/dashboard/inbox"]');await wait('document.querySelector("[data-inbox-surface]")');
    for(const [label,expected] of [['Unread',8],['Facebook Comment',1],['Pinned',1],['All conversations',45]]){
      await click('[data-inbox-view-tabs] button[aria-label="'+label+'"]');await pause(250);
      if(label==='All conversations'){await evaluate('document.querySelector("[data-inbox-list-scroll]").scrollTop=document.querySelector("[data-inbox-list-scroll]").scrollHeight');await wait('document.querySelectorAll("[data-conversation-list-id]").length===45');await evaluate('document.querySelector("[data-inbox-list-scroll]").scrollTop=0');}
      check(label+' retains its selected state',await evaluate('document.querySelector('+JSON.stringify('[data-inbox-view-tabs] button[aria-label="'+label+'"]')+').getAttribute("aria-pressed")==="true"'));
      check(label+' rows match independent fixture population',await evaluate('document.querySelectorAll("[data-conversation-list-id]").length')===expected);
    }
    await click('[data-inbox-filter-control]');check('Channel control survives inside Filter',await evaluate('!document.querySelector("#inbox-status-filters").hidden && Boolean(document.querySelector("#inbox-status-filters [aria-label=\\"Customer channel\\"]"))'));
    check('previously disabled reminder shortcut stays disabled',await evaluate('!document.querySelector("[data-inbox-reminder-control]")'));
    await click('[aria-label="Customer channel"]');check('existing channel picker opens',await evaluate('Boolean(document.querySelector(".tenh-inbox-channel-popover"))'));await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await pause(120);
    await click('[aria-label="Close filters"]');
    await click('[data-inbox-smart-control]');check('existing Smart View panel opens',await evaluate('Boolean(document.querySelector("[data-inbox-smart-views]"))'));await shot('phone-smart-view');
    await evaluate('[...document.querySelectorAll("[data-inbox-smart-views] button")].find(b=>b.textContent.includes("Unassigned")).click()');await pause(220);
    check('Smart View selection uses its existing route and selected state',await evaluate('new URLSearchParams(location.search).get("view")==="unassigned" && document.querySelector("[data-inbox-smart-control]").getAttribute("aria-pressed")==="true"'));
    await click('[data-inbox-smart-control]');await evaluate('[...document.querySelectorAll("[data-inbox-smart-views] button")].find(b=>b.textContent.includes("Assign to me")).click()');await pause(220);
    check('empty Smart View remains an empty population',await evaluate('new URLSearchParams(location.search).get("view")==="my" && document.querySelectorAll("[data-conversation-list-id]").length===0'));
    await click('[data-inbox-view-tabs] button[aria-label="Unread"]');
    const returnURL=await evaluate('location.pathname+location.search'),notificationOwners=await evaluate('fixtureSubscriptions.filter(n=>n.includes("notification")).length');
    await click('[data-dashboard-bottom-nav] a[href="/dashboard/analytics"]');check('Analytics route and active state',await evaluate('location.pathname==="/dashboard/analytics" && document.querySelector("[data-dashboard-bottom-nav] a[href=\\"/dashboard/analytics\\"]").getAttribute("aria-current")==="page"'));
    await click('[data-dashboard-bottom-nav] a[href^="/dashboard/inbox"]');await wait('document.querySelector("[data-inbox-surface]")');check('Inbox return retains filter URL',await evaluate('location.pathname+location.search')===returnURL);
    check('cross-page navigation retains notification subscription owner',await evaluate('fixtureSubscriptions.filter(n=>n.includes("notification")).length')===notificationOwners);
    for(let i=0;i<2;i++){await click('[data-dashboard-bottom-nav] a[href="/dashboard/analytics"]');await click('[data-dashboard-bottom-nav] a[href^="/dashboard/inbox"]');}
    check('rapid menu switches retain the Inbox destination and filter',await evaluate('location.pathname+location.search')===returnURL);
    const activeRequests=await evaluate('fixtureRequests.length'),activeHistory=await evaluate('history.length');
    await click('[data-dashboard-bottom-nav] a[href^="/dashboard/inbox"]');
    check('already active Inbox adds no reload history or requests',await evaluate('fixtureRefreshes===0 && fixtureRequests.length')===activeRequests && await evaluate('history.length')===activeHistory);
    await click('[data-inbox-view-tabs] button[aria-label="All conversations"]');
    await evaluate('(()=>{const input=document.querySelector("[data-inbox-search-controls] input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Fixture");input.dispatchEvent(new Event("input",{bubbles:true}))})()');await pause(300);
    await evaluate('document.querySelector("[data-inbox-list-scroll]").scrollTop=480');const anchor=await evaluate('document.querySelector("[data-inbox-list-scroll]").scrollTop');
    await click('[data-conversation-list-id] button');await wait('document.querySelector("[data-inbox-shell]").dataset.chatActive==="true"');await pause(350);
    await evaluate('(()=>{const input=document.querySelector("[data-inbox-composer-input] textarea");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"Preserve navigation draft");input.dispatchEvent(new Event("input",{bubbles:true}))})()');
    check('conversation shows one header and hides global navigation',await evaluate('getComputedStyle(document.querySelector("[data-dashboard-header]")).display==="none" && document.querySelectorAll("[data-inbox-chat-header]").length===1'));
    await shot('phone-chat');
    await size(390,460,true);check('reduced viewport leaves composer reachable',await evaluate('document.querySelector("[data-inbox-composer]").getBoundingClientRect().bottom<=innerHeight+1'));await shot('keyboard-viewport-emulation');await size(390,844,true);
    await click('[data-inbox-chat-back]');await pause(250);
    check('conversation Back preserves list search',await evaluate('document.querySelector("[data-inbox-search-controls] input").value==="Fixture"'));
    check('conversation Back preserves scroll anchor',Math.abs((await evaluate('document.querySelector("[data-inbox-list-scroll]").scrollTop'))-anchor)<2);
    await click('[data-conversation-list-id] button');await pause(350);check('conversation Back retains draft',await evaluate('document.querySelector("[data-inbox-composer-input] textarea").value==="Preserve navigation draft"'));
    await evaluate('history.back()');await pause(220);check('browser Back clears phone conversation',await evaluate('document.querySelector("[data-inbox-shell]").dataset.chatActive==="false"'));
    await click('[data-more-trigger]');await evaluate('history.forward()');await pause(350);check('browser Forward restores phone conversation',await evaluate('document.querySelector("[data-inbox-shell]").dataset.chatActive==="true"'));check('query-only Forward cannot leave a modal stuck over chat',await evaluate('!document.querySelector("dialog").open'));await click('[data-inbox-chat-back]');
    for(const [name,w,h,touch] of [['small-phone',320,720,true],['phone-landscape',844,390,true],['tablet-portrait',834,1112,true],['tablet-landscape',1180,820,true],['ipad-pro-portrait',1024,1366,true],['ipad-pro-landscape',1366,1024,true]]){
      await size(w,h,touch);await navigate();check(name+' no horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));check(name+' has four compact destinations',await evaluate('getComputedStyle(document.querySelector("[data-dashboard-bottom-nav]")).display==="grid"'));
      check(name+' content clears bottom bar',await evaluate('document.querySelector("[data-inbox-surface]").getBoundingClientRect().bottom<=document.querySelector("[data-dashboard-bottom-nav]").getBoundingClientRect().top+1'));
      check(name+' keeps Profile on screen',await evaluate('document.querySelector("[aria-label=\\"Open profile menu\\"]").getBoundingClientRect().right<=innerWidth'));await shot(name);
      if(name==='phone-landscape'){
        await click('[data-dashboard-workspace-switcher] > button');check('short landscape workspace picker clears bottom navigation',await evaluate('document.querySelector("[data-dashboard-workspace-switcher] > .absolute").getBoundingClientRect().bottom<=document.querySelector("[data-dashboard-bottom-nav]").getBoundingClientRect().top+1'));await shot('phone-landscape-workspace');await click('[data-dashboard-workspace-switcher] > button');
        await click('[data-inbox-filter-control]');check('short landscape Filter has usable height and clears navigation',await evaluate('document.querySelector("#inbox-status-filters").getBoundingClientRect().height>150 && document.querySelector("#inbox-status-filters").getBoundingClientRect().bottom<=document.querySelector("[data-dashboard-bottom-nav]").getBoundingClientRect().top+1'));await shot('phone-landscape-filter');await click('[aria-label="Close filters"]');
        await click('[data-inbox-smart-control]');check('short landscape Smart View clears navigation',await evaluate('document.querySelector("[data-inbox-smart-views]").getBoundingClientRect().height>150 && document.querySelector("[data-inbox-smart-views]").getBoundingClientRect().bottom<=document.querySelector("[data-dashboard-bottom-nav]").getBoundingClientRect().top+1'));await shot('phone-landscape-smart-view');await click('[aria-label="Close Smart Views"]');
      }
    }
    await size(390,844,true);await navigate('?admin=true');await click('[data-more-trigger]');await click('dialog a[href="/dashboard/settings"]');
    check('authorized Admin appears only inside Settings',await evaluate('Boolean(document.querySelector("[data-settings-surface] [data-compact-settings-admin] a[href=\\"/dashboard/admin\\"]")) && !document.querySelector("dialog a[href=\\"/dashboard/admin\\"]")'));
    await shot('settings-authorized-admin');await click('[data-compact-settings-admin] a');check('Admin destination route is retained',await evaluate('location.pathname==="/dashboard/admin"'));
    await navigate();await click('[data-more-trigger]');await click('dialog a[href="/dashboard/settings"]');check('unauthorized identity has no Admin link',await evaluate('!document.querySelector("[data-compact-settings-admin]")'));await shot('settings-regular-member');
    await navigate('?denied=true');await pause(250);await click('[data-more-trigger]');check('Integrations permission gate is retained',await evaluate('!document.querySelector("dialog a[href=\\"/dashboard/integrations\\"]")'));await click('[aria-label="Close More"]');
    await navigate();for(const page of ['subscription','integrations','settings']){await click('[data-more-trigger]');await click('dialog a[href="/dashboard/'+page+'"]');check(page+' destination and More active state',await evaluate('location.pathname')==='/dashboard/'+page && await evaluate('document.querySelector("[data-more-trigger]").getAttribute("aria-current")==="page"'));}
    await click('[data-dashboard-bottom-nav] a[href^="/dashboard/inbox"]');await wait('document.querySelector("[data-inbox-surface]")');
    await evaluate('document.querySelector("[data-dashboard-shell]").style.setProperty("--tenh-bottom-nav-height","102px")');check('simulated safe-area reserve keeps content clear',await evaluate('document.querySelector("[data-inbox-surface]").getBoundingClientRect().bottom<=document.querySelector("[data-dashboard-bottom-nav]").getBoundingClientRect().top+1'));await shot('safe-area-reserve-emulation');await evaluate('document.querySelector("[data-dashboard-shell]").style.removeProperty("--tenh-bottom-nav-height")');
    await click('[data-dashboard-workspace-switcher] > button');check('workspace popup exposes existing entries',await evaluate('document.body.textContent.includes("Second fixture workspace")'));await shot('workspace-switcher');
    await evaluate('[...document.querySelectorAll("[data-dashboard-workspace-switcher] button")].find(b=>b.textContent.includes("Second fixture workspace")).click()');await pause(650);await wait('window.fixtureReady && document.querySelector("[data-dashboard-workspace-switcher] > button").getAttribute("aria-label").includes("Second fixture")');
    check('workspace change uses one existing switch action',await evaluate('fixtureSwitches.length===1 && fixtureSwitches[0].businessId.endsWith("903")'));
    check('workspace change clears Inbox URL per existing contract',await evaluate('location.pathname==="/dashboard/inbox" && location.search===""'));
    await size(390,844,true);await navigate('?language=km');await evaluate('localStorage.setItem("tenh-display-language","km");window.dispatchEvent(new CustomEvent("tenh:display-language-change",{detail:{id:"km"}}))');await pause(160);
    check('Khmer compact navigation labels remain translated',await evaluate('document.querySelector("[data-dashboard-bottom-nav]").textContent.includes("ការជូនដំណឹង") && document.querySelector("[data-inbox-filter-control]").textContent.includes("តម្រង")'));await shot('phone-khmer');
    await evaluate('sessionStorage.removeItem("fixture-workspace");localStorage.setItem("tenh-display-language","en")');
    await size(1440,900,false);await navigate();check('desktop keeps original header navigation',await evaluate('getComputedStyle(document.querySelector("[data-dashboard-header] nav:not([aria-label])")).display==="flex"'));
    check('desktop has no bottom navigation destinations',await evaluate('getComputedStyle(document.querySelector("[data-compact-destination]")).display==="none" && document.querySelector("[data-notifications-trigger]").getBoundingClientRect().top<72'));
    check('desktop retains original rail and has no compact tabs',await evaluate('Boolean(document.querySelector("[data-conversation-rail]")) && !document.querySelector("[data-inbox-view-tabs]")'));await shot('desktop');
    await navigate('?admin=true');await evaluate('history.pushState(null,"","/dashboard/settings/general")');await wait('document.querySelector("[data-settings-surface]")');await pause(200);
    check('desktop Settings keeps its original columns and hides the compact Admin card',await evaluate('getComputedStyle(document.querySelector("[data-settings-surface]")).display==="grid" && getComputedStyle(document.querySelector("[data-compact-settings-admin]")).display==="none"'));await shot('desktop-settings');
    const final=await evaluate('({requests:fixtureRequests,subscriptions:fixtureSubscriptions,refreshes:fixtureRefreshes,errors:fixtureErrors})');
    check('no customer sends or route refresh calls',!final.requests.some(r=>/\/send|\/reply/.test(r.url))&&final.refreshes===0);
    check('no runtime errors throughout navigation',final.errors.length===0&&errors.length===0);
    fs.writeFileSync(path.join(evidence,'browser-results.json'),JSON.stringify({checks,screenshots,errors,beforeMore,afterMore,final,physicalDeviceTested:false,settingsContentIsFixture:true,reportDestinationsAreFixtures:true},null,2));
  }
  console.log(JSON.stringify({baseline,passed:checks.length,screenshots,physicalDeviceTested:false},null,2));
} catch(error) {fs.writeFileSync(path.join(evidence,'browser-failure.txt'),String(error.stack));throw error;}
finally {socket?.close();edge.kill();server.close();}
