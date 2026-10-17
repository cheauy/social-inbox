/* eslint-disable @typescript-eslint/no-require-imports */
// Real components in a synthetic loopback page; all deletion responses are fixtures.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tenh-delete-dialog-'));
const {chromium}=require(process.env.TENH_PLAYWRIGHT_MODULE||'C:/Users/TUF/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const webpackModule=require('next/dist/compiled/webpack/webpack'),webpack=webpackModule.webpack||webpackModule.default;
const write=(name,content)=>{const file=path.join(temp,name);fs.writeFileSync(file,content);return file;};
const loader=write('loader.cjs',`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
const entry=write('entry.cjs',`
const React=require('react'),{createRoot}=require('react-dom/client');
const {DeleteAccountSection}=require(${JSON.stringify(path.join(root,'components/profile/delete-account-section.tsx'))});
const mode=new URLSearchParams(location.search).get('mode')||'sole';window.deletions=[];
const subscription=(id,status='active')=>({businessId:id,businessName:'Workspace '+id+' with a long name សាកល្បងឈ្មោះវែង',status,candidates:mode==='ineligible'?[]:[{memberId:'user-'+id,name:'Active colleague',email:'fixture@example.invalid',role:'agent'}],paidTimeRemaining:status==='active'});
const blocking=mode==='none'?[]:mode==='multiple'?[subscription('a'),subscription('b','trialing')]:[subscription('a')];
const subscriptions=mode==='multiple'?[...blocking,subscription('joined'),subscription('expired','expired')]:blocking;
window.fetch=async(url,init={})=>{
 if(url!=='/api/account/delete')throw Error('Unexpected request '+url);
 if(init.method==='GET')return Response.json({success:true,impact:{canDelete:!blocking.length,membershipCount:subscriptions.length,activeOwnedSubscriptionCount:blocking.length,blockingSubscriptions:blocking,subscriptions}});
 if(init.method==='DELETE'){
  window.deletions.push(JSON.parse(init.body));await new Promise(resolve=>setTimeout(resolve,500));
  if(window.fixtureSuccess)return Response.json({success:true});
  return Response.json({success:false,error:'Fixture: server could not confirm deletion. Account unchanged.'},{status:500});
 }
 throw Error('Unexpected method');
};
createRoot(document.getElementById('root')).render(React.createElement(DeleteAccountSection,{email:'fixture@example.invalid',variant:'row'}));
`);
async function run(){
 await new Promise((resolve,reject)=>webpack({mode:'development',entry,output:{path:temp,filename:'bundle.js'},resolve:{modules:[path.join(root,'node_modules')],extensions:['.tsx','.ts','.js','.cjs'],alias:{'@':root}},module:{rules:[{test:/\.tsx?$/,use:loader}]},devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
 const {compile}=require('@tailwindcss/node'),compiled=await compile('@import "tailwindcss";',{base:root,onDependency(){}});
 const sources=['components/profile/delete-account-section.tsx','components/ui/confirm-action-dialog.tsx'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join(' ');
 const css=compiled.build(sources.split(/[\s"'`<>]+/));
 write('fixture.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body style="background:#f8fafc;padding:24px"><main id="root"></main><script src="/bundle.js"></script></body></html>');
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url.startsWith('/bundle.js')?'application/javascript':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(temp,req.url.startsWith('/bundle.js')?'bundle.js':'fixture.html')));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.TENH_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const base='http://127.0.0.1:'+server.address().port,evidence=path.join(root,'docs/evidence/delete-account-20261017');fs.mkdirSync(evidence,{recursive:true});
 const open=async page=>{await page.getByRole('button',{name:'Delete account',exact:true}).click();await page.getByRole('heading',{name:'Affected subscriptions'}).waitFor();return page.getByRole('alertdialog',{name:'Delete account',exact:true});};
 let cases=0;
 try{
  for(const width of [360,390,768,820,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:820}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/?mode=multiple');const dialog=await open(page);
   assert.equal(await dialog.locator('input[type=radio]:checked').count(),0);
   assert.equal(await dialog.getByRole('button',{name:'Delete account',exact:true}).isDisabled(),true);
   const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=820);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const footer=await dialog.getByRole('button',{name:'Cancel',exact:true}).boundingBox();assert.ok(footer.height>=44&&footer.y+footer.height<=820);
   const close=dialog.getByRole('button',{name:'Close delete account dialog'});await close.focus();await page.keyboard.press('Shift+Tab');
   assert.ok(await dialog.getByRole('button',{name:'Cancel',exact:true}).evaluate(el=>el===document.activeElement));
   await page.keyboard.press('Tab');assert.ok(await close.evaluate(el=>el===document.activeElement));
   if([390,768,1440].includes(width))await page.screenshot({path:path.join(evidence,'dialog-'+width+'.png')});
   await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
   assert.ok(await page.getByRole('button',{name:'Delete account',exact:true}).evaluate(el=>el===document.activeElement));
   await open(page);
   await page.getByRole('link',{name:'Manage users'}).evaluate(el=>el.addEventListener('click',event=>event.preventDefault()));
   await page.getByRole('link',{name:'Manage users'}).click();assert.equal(await dialog.locator('input[type=radio]:checked').count(),0);
   await dialog.getByRole('radio',{name:/End subscription/}).check();
   await dialog.getByLabel(/I understand this permanently deletes/).check();
   await dialog.getByLabel('Type DELETE MY ACCOUNT to confirm',{exact:true}).fill('DELETE');
   assert.ok(await dialog.getByRole('button',{name:'Delete account',exact:true}).isDisabled());
   await dialog.getByLabel('Type DELETE MY ACCOUNT to confirm',{exact:true}).fill('DELETE MY ACCOUNT');
   assert.ok(await dialog.getByRole('button',{name:'Delete account',exact:true}).isDisabled());
   await dialog.getByLabel(/I understand the sole-owner subscriptions/).check();
   await dialog.getByRole('button',{name:'Delete account',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.deletions.length),1);await page.keyboard.press('Escape');assert.equal(await dialog.count(),1);
   await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').textContent(),/Account unchanged/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>window.deletions.length),1);
   await page.close();cases++;
  }
  const page=await browser.newPage({viewport:{width:740,height:320}});await page.goto(base);let dialog=await open(page);
  let bounds=await dialog.boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=320);assert.ok((await dialog.getByRole('button',{name:'Cancel'}).boundingBox()).height>=44);
  await page.keyboard.press('Escape');await page.evaluate(()=>document.documentElement.style.zoom='2');dialog=await open(page);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.keyboard.press('Escape');
  await page.goto(base+'/?mode=ineligible');dialog=await open(page);assert.ok(await dialog.getByRole('radio',{name:/Transfer ownership/}).isDisabled());assert.ok(await dialog.getByText(/Add another active user first/).isVisible());
  await page.goto(base+'/?mode=none');dialog=await open(page);assert.equal(await dialog.getByRole('radio').count(),0);await page.evaluate(()=>window.fixtureSuccess=true);
  await dialog.getByLabel(/I understand this permanently deletes/).check();await dialog.getByLabel('Type DELETE MY ACCOUNT to confirm',{exact:true}).fill('DELETE MY ACCOUNT');
  await dialog.getByRole('button',{name:'Delete account',exact:true}).click();await page.waitForURL('**/login?accountDeleted=1');
  await page.close();console.log(JSON.stringify({passed:true,cases,landscape:true,cssZoom200:true,focusTrap:true,evidence}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
