/* eslint-disable @typescript-eslint/no-require-imports */
// Agent-owned Chrome profile + nonpayable loopback fixture. No user browser, auth or bank APIs.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const temp=fs.mkdtempSync(path.join(process.env.TEMP||'C:/Users/TUF/AppData/Local/Temp','tenh-khqr-popup-'));
const {chromium}=require(process.env.TENH_PLAYWRIGHT_MODULE||'C:/Users/TUF/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const webpackModule=require('next/dist/compiled/webpack/webpack'),webpack=webpackModule.webpack||webpackModule.default;
const write=(name,content)=>{const file=path.join(temp,name);fs.writeFileSync(file,content);return file;};
async function run(){
 const qr=await require('qrcode').toDataURL('TENH LOCAL UI PREVIEW - NOT A PAYMENT',{width:280,margin:2});
 const loader=write('loader.cjs',`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
 const language=write('language.cjs',"exports.useWorkspaceLanguageId=()=>new URLSearchParams(location.search).get('lang')||'en';");
 const navigation=write('navigation.cjs',"const router={replace:href=>window.navigations.push(href)};exports.useRouter=()=>router;");
 const link=write('link.cjs',"const React=require('react');module.exports=({children,...props})=>React.createElement('a',props,children);");
 const supabase=write('supabase.cjs',"exports.createClient=()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}});");
 const feature=write('feature.cjs',"exports.KHQR_CHECKOUT_ENABLED=new URLSearchParams(location.search).get('future')==='1';");
 const entry=write('entry.cjs',`
 const React=require('react'),{createRoot}=require('react-dom/client');
 const {BakongPaymentView}=require(${JSON.stringify(path.join(root,'components/subscription/bakong-payment-view.tsx'))});
 const mode=new URLSearchParams(location.search).get('mode'),start=Date.now();window.navigations=[];window.paymentRequests=[];window.failCancellation=true;
 const record={id:'00000000-0000-4000-8000-000000000001',businessId:'00000000-0000-4000-8000-000000000002',userId:'synthetic-user',memberId:'synthetic-member',workspaceName:'SUPPORT ONLY WORKSPACE',recipientName:'SYNTHETIC RECEIVER',planCode:'custom',billingCycle:'12-months',amount:'9.99',currency:'USD',reference:'LOCAL-SUPPORT-REFERENCE',transactionReference:null,environment:'production',state:'pending',application:'none',checkout:'open',qrImage:${JSON.stringify(qr)},createdAt:new Date(start).toISOString(),expiresAt:new Date(start+900000).toISOString(),serverTime:new Date(start).toISOString(),nextCheckAt:new Date(start+300000).toISOString(),invoiceId:null,canCheck:true,automaticChecksRemaining:3};
 if(mode==='checking'){record.createdAt=new Date(start-300001).toISOString();record.expiresAt=new Date(start+590000).toISOString();record.nextCheckAt=new Date(start-1).toISOString();}
 if(mode==='terminal')Object.assign(record,{state:'applied',application:'active',qrImage:null,canCheck:false});
 if(mode==='review')Object.assign(record,{state:'review',qrImage:null,canCheck:false});
 window.savedAttempt=record;
 window.fetch=async(url,init={})=>{const method=init.method||'GET';window.paymentRequests.push({url,method});if(url==='/api/subscription/cancel-payment'&&new URLSearchParams(location.search).get('future')==='1'&&method==='POST'){if(window.failCancellation)return Response.json({success:false},{status:503});record.checkout='cancelled';record.qrImage=null;return Response.json({success:true,outcome:'checkout_closed'});}if(!url.startsWith('/api/bakong/payments/'))throw Error('Forbidden fixture request');if(method==='POST'&&mode==='checking')return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));if(method==='GET')return mode==='error'?Response.json({success:false},{status:503}):Response.json({success:true,attempt:record});throw Error('Forbidden fixture mutation');};
 document.getElementById('opener').focus();
 createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(BakongPaymentView,{attemptId:record.id,businessId:record.businessId})));
 `);
 await new Promise((resolve,reject)=>webpack({mode:'development',entry,output:{path:temp,filename:'bundle.js'},resolve:{modules:[path.join(root,'node_modules')],extensions:['.tsx','.ts','.js','.cjs'],alias:{'next/link$':link,'next/navigation$':navigation,'@/lib/supabase/client$':supabase,'@/components/display/workspace-language-text$':language,'@/lib/billing/payment-cancellation-feature$':feature,'@':root}},module:{rules:[{test:/\.tsx?$/,use:loader}]},devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
 const {compile}=require('@tailwindcss/node'),compiled=await compile('@import "tailwindcss";',{base:root,onDependency(){}});
 const sources=['components/subscription/bakong-payment-view.tsx','components/subscription/cancel-payment-button.tsx','components/ui/confirm-action-dialog.tsx'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join(' ');
 const css=compiled.build(sources.split(/[\s"'`<>]+/));
 write('fixture.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><style>body{background:#f8fafc;font-family:Arial,sans-serif}aside{padding:12px;background:#fef3c7;color:#78350f;text-align:center}</style></head><body><aside>LOCAL PREVIEW — NOT FOR PAYMENT</aside><button id="opener">Open saved payment</button><div id="root"></div><script src="/bundle.js"></script></body></html>');
 const assets={'/':[path.join(temp,'fixture.html'),'text/html; charset=utf-8'],'/bundle.js':[path.join(temp,'bundle.js'),'text/javascript'],'/images/khqr.png':[path.join(root,'public/images/khqr.png'),'image/png']};
 const server=http.createServer((request,response)=>{const asset=assets[new URL(request.url,'http://127.0.0.1').pathname];if(!asset){response.writeHead(404);response.end();return;}response.writeHead(200,{'Content-Type':asset[1],'Content-Security-Policy':"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'none'; form-action 'none'"});fs.createReadStream(asset[0]).pipe(response);});
 let browser;const reports=[],failures=[],requests=[];
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.TENH_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking','--no-first-run','--no-default-browser-check']});
  for(const [width,height,language,mode]of [[320,568,'en','waiting'],[390,844,'en','waiting'],[768,1024,'km','waiting'],[1024,768,'en','waiting'],[844,390,'en','waiting'],[1440,900,'en','waiting'],[390,844,'en','checking'],[390,844,'en','error'],[390,844,'en','terminal'],[390,844,'en','review']]){
   const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',error=>failures.push(error.message));page.on('request',request=>requests.push(request.url()));
   await page.goto(origin+'/?lang='+language+'&mode='+mode);await page.locator('dialog[role="dialog"][open]').waitFor();
   if(mode==='error')await page.getByRole('alert').waitFor();else await page.locator('[aria-live="polite"]').waitFor();
   if(mode==='checking')await page.waitForFunction(()=>window.paymentRequests.some(request=>request.method==='POST'));
   if(['waiting','checking'].includes(mode))await page.waitForFunction(()=>[...document.querySelectorAll('figure img')].every(img=>img.complete&&img.naturalWidth));
   const result=await page.evaluate(()=>{const dialog=document.querySelector('dialog[role="dialog"]'),section=dialog.querySelector('section'),button=dialog.querySelector('button'),timer=button.previousElementSibling,box=dialog.getBoundingClientRect(),b=button.getBoundingClientRect(),t=timer?.getBoundingClientRect(),card=dialog.querySelector('figure'),qr=card?.querySelectorAll('img')[1],q=qr?.getBoundingClientRect(),quiet=qr&&getComputedStyle(qr.parentElement),details=[...dialog.querySelectorAll('details')].find(x=>x.querySelector('summary')?.textContent==='Payment details'),clone=dialog.cloneNode(true);clone.querySelectorAll('details').forEach(x=>x.remove());return {bounds:{x:box.x,y:box.y,width:box.width,height:box.height},overflow:document.documentElement.scrollWidth>innerWidth,internalScroll:section.scrollHeight>section.clientHeight,closeSize:{width:b.width,height:b.height},timerGap:t?b.left-t.right:null,qrWidth:q?.width,qrSquare:q?Math.abs(q.width-q.height)<1:null,quietPadding:quiet?parseFloat(quiet.paddingLeft):null,amount:card?.querySelector('figcaption [aria-label]')?.getAttribute('aria-label'),qrUnchanged:qr?qr.getAttribute('src')===window.savedAttempt.qrImage:null,detailsClosed:details?!details.open:null,outerMetadata:clone.textContent.includes('LOCAL-SUPPORT-REFERENCE')||clone.textContent.includes('SUPPORT ONLY WORKSPACE')||clone.textContent.includes('Bakong KHQR'),focusedClose:document.activeElement===button,busy:section.getAttribute('aria-busy'),spinner:!!dialog.querySelector('[class*="animate-spin"]'),requests:window.paymentRequests};});
   assert.ok(!result.overflow,'no horizontal overflow');assert.ok(result.bounds.x>=0&&result.bounds.y>=0&&result.bounds.x+result.bounds.width<=width+1&&result.bounds.y+result.bounds.height<=height+1,'modal fits');
   assert.ok(Math.abs(result.bounds.x+result.bounds.width/2-width/2)<2&&Math.abs(result.bounds.y+result.bounds.height/2-height/2)<2,'centered');assert.ok(result.closeSize.width>=44&&result.closeSize.height>=44);assert.ok(result.focusedClose);assert.equal(result.outerMetadata,false);
   if(['waiting','checking'].includes(mode)){assert.ok(result.timerGap>=8);assert.ok(result.qrSquare&&result.qrWidth>=220);assert.ok(result.quietPadding>=12);assert.equal(result.qrUnchanged,true);assert.equal(result.amount,'9.99 USD');assert.equal(result.spinner,true);}
   else assert.equal(result.spinner,false);
   assert.equal(result.busy,mode==='checking'?'true':'false');assert.ok(result.requests.every(request=>request.method==='GET'||mode==='checking'));
   if(language==='en'&&mode==='waiting'){
    assert.equal(result.detailsClosed,true);const close=page.getByRole('button',{name:'Close payment window',exact:true});
    await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('dialog summary').last().evaluate(element=>element===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await close.evaluate(element=>element===document.activeElement),true);
    if([390,1440].includes(width))await page.screenshot({path:path.join(temp,'popup-'+width+'x'+height+'.png')});
    if(width===390){await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('[class*="animate-spin"]').evaluate(element=>getComputedStyle(element).animationName),'none');await page.getByText('Payment details',{exact:true}).click();assert.ok(await page.getByText('Reference: LOCAL-SUPPORT-REFERENCE',{exact:true}).isVisible());}
    const saved=await page.evaluate(()=>JSON.stringify(window.savedAttempt));await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').evaluate(element=>element.open),false);assert.deepEqual(await page.evaluate(()=>window.navigations),['/dashboard/subscription']);assert.equal(await page.evaluate(()=>JSON.stringify(window.savedAttempt)),saved);assert.equal(await page.locator('#opener').evaluate(element=>element===document.activeElement),true);
   }
   if(language==='km')await page.screenshot({path:path.join(temp,'popup-tablet-km.png')});
   if(width===844)assert.equal(result.internalScroll,true,'short screen scrolls inside body');reports.push({width,height,language,mode,...result});await page.close();
  }
  const page=await browser.newPage({viewport:{width:768,height:700}});await page.goto(origin);await page.locator('figure').waitFor();await page.evaluate(()=>document.documentElement.style.zoom='2');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% zoom no horizontal overflow');await page.close();
  // Future feature is opted in inside this mock bundle only. It never changes the runtime code gate.
  const future=await browser.newPage({viewport:{width:390,height:844}});future.on('pageerror',error=>failures.push(error.message));future.on('request',request=>requests.push(request.url()));
  await future.goto(origin+'/?future=1');const checkout=future.locator('dialog[role="dialog"]'),cancel=checkout.getByRole('button',{name:'Cancel payment',exact:true});await cancel.waitFor();
  await cancel.click();const confirmation=future.getByRole('alertdialog');await confirmation.waitFor();assert.equal(await future.evaluate(()=>window.paymentRequests.filter(request=>request.method==='POST').length),0);
  await future.keyboard.press('Shift+Tab');assert.ok(await confirmation.evaluate(element=>element.contains(document.activeElement)),'nested focus remains in confirmation');
  await future.keyboard.press('Escape');await confirmation.waitFor({state:'detached'});assert.equal(await checkout.evaluate(element=>element.open),true);assert.ok(await cancel.evaluate(element=>element===document.activeElement));assert.deepEqual(await future.evaluate(()=>window.navigations),[]);
  await cancel.click();await confirmation.getByRole('button',{name:'Cancel payment',exact:true}).click();await confirmation.getByRole('alert').waitFor();assert.deepEqual(await future.evaluate(()=>window.navigations),[]);assert.equal(await checkout.evaluate(element=>element.open),true);
  await future.screenshot({path:path.join(temp,'future-cancel-error.png')});const expiry=await future.evaluate(()=>window.savedAttempt.expiresAt);await future.evaluate(()=>{window.failCancellation=false;});
  await confirmation.getByRole('button',{name:'Cancel payment',exact:true}).click();await confirmation.waitFor({state:'detached'});assert.equal(await checkout.evaluate(element=>element.open),false);assert.deepEqual(await future.evaluate(()=>window.navigations),['/dashboard/subscription']);assert.equal(await future.evaluate(()=>window.savedAttempt.expiresAt),expiry);assert.equal(await future.evaluate(()=>window.savedAttempt.state),'pending');assert.equal(await future.evaluate(()=>window.savedAttempt.checkout),'cancelled');assert.equal(await future.locator('#opener').evaluate(element=>element===document.activeElement),true);
  assert.equal(await future.evaluate(()=>window.paymentRequests.filter(request=>request.method==='POST').length),2);await future.close();
  assert.deepEqual(failures,[]);assert.ok(requests.every(url=>url.startsWith(origin)||url.startsWith('data:')),'loopback and synthetic data only');
  write('preview-results.json',JSON.stringify({passed:true,nonpayable:true,agentOwnedBrowser:true,zoom200:true,futureMockCancellation:true,reports,failures},null,2));console.log(JSON.stringify({passed:true,cases:reports.length,zoom200:true,futureMockCancellation:true,evidence:temp}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error.stack);console.error('Fixture evidence: '+temp);process.exitCode=1;});
