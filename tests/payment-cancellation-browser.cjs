/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic loopback fixture. Never loads production pages, credentials or provider APIs.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tenh-cancellation-browser-'));
const {chromium}=require(process.env.TENH_PLAYWRIGHT_MODULE||'C:/Users/TUF/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const webpackModule=require('next/dist/compiled/webpack/webpack'),webpack=webpackModule.webpack||webpackModule.default;
const write=(name,content)=>{const file=path.join(temp,name);fs.writeFileSync(file,content);return file;};
const stub=write('stub.cjs',`exports.useWorkspaceLanguageId=()=>window.fixtureLanguage;exports.createClient=()=>({auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-user'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}});exports.invalidateWorkspaceRead=()=>{};exports.readWorkspaces=async()=>Response.json({success:true,currentBusinessId:window.workspaces[0].businessId,workspaces:window.workspaces});`);
const loader=write('loader.cjs',`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
const entry=write('entry.cjs',`
const React=require('react'),{createRoot}=require('react-dom/client');
const {SubscriptionMembershipList}=require(${JSON.stringify(path.join(root,'components/subscription/subscription-membership-list.tsx'))});
window.fixtureLanguage=new URLSearchParams(location.search).get('lang')||'en';window.cancelCalls=0;
window.workspaces=Array.from({length:4},(_,i)=>({businessId:'workspace-'+i,memberId:'member-'+i,businessName:window.fixtureLanguage==='km'?'កន្លែងធ្វើការសម្រាប់ការសាកល្បងឈ្មោះវែង និងការទូទាត់ '+i:'A long workspace name for payment cancellation '+i,role:'owner',canManageBilling:true,ownerName:'Synthetic owner',usage:{members:1,channels:2},subscription:{id:'sub-'+i,plan_code:'mini',status:'active',member_limit:3,channel_limit:3,current_period_end:'2099-01-01T00:00:00Z',billing_cycle:'monthly',last_paid_amount:13,last_paid_currency:'USD'}}));
window.payments=window.workspaces.map((w,i)=>({kind:['payway','bakong','manual','manual'][i],id:'attempt-'+i,businessId:w.businessId,memberId:w.memberId,planCode:'mini',billingCycle:'monthly',amount:13,currency:'USD',status:i===3?'submitted':'pending',expiresAt:i===1?new Date(Date.now()+600000).toISOString():null,resumeUrl:'/dashboard/subscription/payment?fixture='+i}));
window.fetch=async(url,init={})=>{
 if(url==='/api/subscription/pending-payments')return Response.json({success:true,userId:'synthetic-user',serverTime:new Date().toISOString(),items:window.payments});
 if(url==='/api/subscription/cancel-payment'){
   window.cancelCalls++;const body=JSON.parse(init.body);window.lastCancellation=body;
   await new Promise(resolve=>setTimeout(resolve,250));
   const outcome=body.action==='withdraw'?'withdrawn':body.kind==='bakong'?'reconciliation_required':'cancelled';
   window.payments=window.payments.flatMap(p=>p.id!==body.paymentId?[p]:outcome==='cancelled'?[]:[{...p,status:'reconciliation_required'}]);
   return Response.json({success:true,outcome});
 }
 throw Error('Unexpected request '+url);
};
createRoot(document.getElementById('root')).render(React.createElement(SubscriptionMembershipList));
`);
async function run(){
  await new Promise((resolve,reject)=>webpack({mode:'development',entry,output:{path:temp,filename:'bundle.js'},resolve:{modules:[path.join(root,'node_modules')],extensions:['.tsx','.ts','.js','.cjs'],alias:{'@/lib/supabase/client$':stub,'@/components/display/workspace-language-text$':stub,'@/lib/workspaces/read-workspaces$':stub,'@':root}},module:{rules:[{test:/\.tsx?$/,use:loader}]},devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  const {compile}=require('@tailwindcss/node'),compiled=await compile('@import "tailwindcss";',{base:root,onDependency(){}});
  const sources=['components/subscription/subscription-membership-list.tsx','components/subscription/cancel-payment-button.tsx','components/ui/confirm-action-dialog.tsx'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join(' ');
  const css=compiled.build(sources.split(/[\s"'`<>]+/));
  write('fixture.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body style="background:#f8fafc;padding:12px"><main id="root"></main><script src="/bundle.js"></script></body></html>');
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url.startsWith('/bundle.js')?'application/javascript':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(temp,req.url.startsWith('/bundle.js')?'bundle.js':'fixture.html')));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.TENH_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const evidence=path.join(root,'docs/evidence/payment-cancellation-20261016');fs.mkdirSync(evidence,{recursive:true});
  let cases=0;
  try{
    for(const language of ['en','km'])for(const width of [360,390,768,820,1024,1440]){
      const page=await browser.newPage({viewport:{width,height:800}}),failures=[];page.on('pageerror',e=>failures.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port+'/?lang='+language);
      const cancel=language==='en'?'Cancel payment':'បោះបង់ការទូទាត់';
      await page.getByRole('button',{name:cancel,exact:true}).first().waitFor({timeout:5000}).catch(()=>{throw Error(JSON.stringify({failures,body:page.url()}));});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'card overflow '+language+'/'+width);
      const trigger=page.getByRole('button',{name:cancel,exact:true}).first();await trigger.click();
      const dialog=page.getByRole('alertdialog');await dialog.waitFor();
      assert.equal(await page.evaluate(()=>window.cancelCalls),0);
      const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.height<=800,'dialog fit');
      assert.ok((await dialog.getByRole('button',{name:cancel,exact:true}).boundingBox()).height>=44);
      if(language==='en'&&[390,768,1440].includes(width))await page.screenshot({path:path.join(evidence,'confirmation-'+width+'.png')});
      await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.ok(await trigger.evaluate(el=>el===document.activeElement));
      for(let i=0;i<3;i++){
        await page.getByRole('button',{name:cancel,exact:true}).first().click();
        const button=page.getByRole('alertdialog').getByRole('button',{name:cancel,exact:true});
        await button.click();assert.ok(await page.getByRole('alertdialog').locator('button').last().isDisabled());await page.keyboard.press('Escape');
        await page.getByRole('alertdialog').waitFor({state:'detached'});
      }
      assert.equal(await page.evaluate(()=>window.cancelCalls),3);
      assert.equal(await page.getByRole('button',{name:cancel,exact:true}).count(),0);
      const withdraw=language==='en'?'Withdraw proof':'ដកភស្តុតាងដែលបានដាក់ស្នើ';
      await page.getByRole('button',{name:withdraw,exact:true}).click();
      await page.getByRole('alertdialog').getByRole('button',{name:withdraw,exact:true}).click();
      await page.getByRole('alertdialog').waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>window.lastCancellation.action),'withdraw');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'resolved overflow');
      assert.deepEqual(failures,[]);await page.close();cases++;
    }
    const page=await browser.newPage({viewport:{width:740,height:320}});await page.goto('http://127.0.0.1:'+server.address().port);
    await page.getByRole('button',{name:'Cancel payment',exact:true}).first().click();
    const bounds=await page.getByRole('alertdialog').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=320,'landscape fit');
    await page.keyboard.press('Escape');await page.evaluate(()=>document.documentElement.style.zoom='2');
    await page.getByRole('button',{name:'Cancel payment',exact:true}).first().click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% zoom overflow');await page.close();
    console.log(JSON.stringify({passed:true,cases,landscape:true,zoom200:true,evidence}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
