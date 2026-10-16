/* eslint-disable @typescript-eslint/no-require-imports */
// Agent-owned headless browser + synthetic loopback admin responses. No financial/auth/provider operations.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(process.env.TEMP||'C:/Users/TUF/AppData/Local/Temp','tenh-original-plan-ui-'));
const {chromium}=require(process.env.TENH_PLAYWRIGHT_MODULE||'C:/Users/TUF/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const webpackModule=require('next/dist/compiled/webpack/webpack'),webpack=webpackModule.webpack||webpackModule.default;
const write=(name,body)=>{const file=path.join(temp,name);fs.writeFileSync(file,body);return file;};
async function run(){
 const loader=write('loader.cjs',`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
 const language=write('language.cjs',"exports.useWorkspaceLanguageId=()=>new URLSearchParams(location.search).get('lang')||'en';");
 const feature=write('feature.cjs',"exports.KHQR_CHECKOUT_ENABLED=new URLSearchParams(location.search).get('mode')!=='disabled';");
 const entry=write('entry.cjs',`
 const React=require('react'),{createRoot}=require('react-dom/client');const {BakongOriginalPlanButton}=require(${JSON.stringify(path.join(root,'components/billing/bakong-original-plan-button.tsx'))});
 const mode=new URLSearchParams(location.search).get('mode');window.requests=[];window.applied=0;
 window.fetch=async(url,init={})=>{if(url!=='/api/bakong/admin'||init.method!=='POST')throw Error('Forbidden fixture request');const body=JSON.parse(init.body);window.requests.push(body);await new Promise(resolve=>setTimeout(resolve,100));if(mode==='conflict')return Response.json({success:false,outcome:'conflict',code:'OVERLAPPING_PURCHASE'},{status:409});if(mode==='uncertain'&&window.requests.length===1)return Response.json({success:false,code:'RESOLUTION_UNCERTAIN'},{status:503});return Response.json({success:true,outcome:'applied'});};
 function Fixture(){React.useEffect(()=>{window.fixtureRendered=true;},[]);return React.createElement(BakongOriginalPlanButton,{payment:{id:'00000000-0000-4000-8000-000000000001',workspaceName:'SYNTHETIC WORKSPACE',amount:'13.00',currency:'USD',transactionReference:'a'.repeat(64),planCode:'mini',billingCycle:'monthly',canApplyOriginal:true},onApplied:()=>{window.applied++;}});}
 createRoot(document.getElementById('root')).render(React.createElement(Fixture));
 `);
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry,output:{path:temp,filename:'bundle.js'},resolve:{modules:[path.join(root,'node_modules')],extensions:['.tsx','.ts','.js','.cjs'],alias:{'@/components/display/workspace-language-text$':language,'@/lib/billing/payment-cancellation-feature$':feature,'@':root}},module:{rules:[{test:/\.tsx?$/,use:loader}]}},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
 const {compile}=require('@tailwindcss/node'),compiled=await compile('@import "tailwindcss";',{base:root,onDependency(){}});
 const css=compiled.build(['components/billing/bakong-original-plan-button.tsx','components/ui/confirm-action-dialog.tsx'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join(' ').split(/[\s"'`<>]+/));
 write('fixture.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body style="background:#f8fafc;padding:12px"><aside style="padding:12px;background:#fef3c7;margin-bottom:12px">LOCAL ADMIN PREVIEW — NO FINANCIAL ACTIONS</aside><main id="root"></main><script src="/bundle.js"></script></body></html>');
 const server=http.createServer((request,response)=>{const file=new URL(request.url,'http://127.0.0.1').pathname==='/bundle.js'?'bundle.js':'fixture.html';response.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'none'; form-action 'none'"});response.end(fs.readFileSync(path.join(temp,file)));});
 let browser;const reports=[],errors=[],network=[];
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.TENH_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking','--no-first-run','--no-default-browser-check']});
  for(const[width,height,language,mode]of [[390,844,'en','success'],[768,1024,'km','success'],[844,390,'en','conflict'],[1440,900,'en','uncertain']]){
   const page=await browser.newPage({viewport:{width,height}});page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>network.push(request.url()));await page.goto(origin+'/?lang='+language+'&mode='+mode);
   const trigger=page.locator('main button');await trigger.click();const dialog=page.getByRole('alertdialog');await dialog.waitFor();assert.equal(await page.evaluate(()=>window.requests.length),0);
   const confirm=dialog.locator('button').last();assert.equal(await confirm.isDisabled(),true);await page.keyboard.press('Shift+Tab');assert.ok(await dialog.evaluate(element=>element.contains(document.activeElement)));
   await dialog.locator('textarea').fill('Reviewed original bank receipt and verified no overlapping purchases.');assert.equal(await confirm.isEnabled(),true);
   const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1,'responsive modal fits');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if([390,768].includes(width))await page.screenshot({path:path.join(temp,'original-plan-'+width+'-'+language+'.png')});
   await confirm.evaluate(element=>{element.click();element.click();});
   if(mode==='conflict'){
    await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').textContent(),/overlaps/);assert.equal(await page.evaluate(()=>window.applied),0);assert.equal(await page.evaluate(()=>window.requests.length),1);await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.ok(await trigger.evaluate(element=>element===document.activeElement));
   }else if(mode==='uncertain'){
    await dialog.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.applied),0);await confirm.click();await dialog.waitFor({state:'detached'});const requests=await page.evaluate(()=>window.requests);assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(await page.evaluate(()=>window.applied),1);
   }else{await dialog.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>window.requests.length),1);assert.equal(await page.evaluate(()=>window.applied),1);}
   reports.push({width,height,language,mode,passed:true});await page.close();
  }
  const page=await browser.newPage({viewport:{width:768,height:700}});await page.goto(origin);await page.locator('main button').click();await page.evaluate(()=>document.documentElement.style.zoom='2');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% zoom no horizontal overflow');await page.keyboard.press('Escape');await page.close();
  const disabled=await browser.newPage();await disabled.goto(origin+'/?mode=disabled');await disabled.waitForFunction(()=>window.fixtureRendered===true);assert.equal(await disabled.locator('main button').count(),0);assert.equal(await disabled.evaluate(()=>window.requests.length),0);await disabled.close();
  assert.deepEqual(errors,[]);assert.ok(network.every(url=>url.startsWith(origin)||url.startsWith('data:')),'only isolated loopback content');write('preview-results.json',JSON.stringify({passed:true,syntheticOnly:true,agentOwnedBrowser:true,zoom200:true,disabledGate:true,reports,errors},null,2));console.log(JSON.stringify({passed:true,cases:reports.length,zoom200:true,disabledGate:true,evidence:temp}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error.stack);console.error('Fixture evidence: '+temp);process.exitCode=1;});
