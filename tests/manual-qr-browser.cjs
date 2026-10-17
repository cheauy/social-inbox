/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic loopback checkout only. No bank credentials, real QR, provider or hosted requests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tenh-manual-qr-'));
const {chromium}=require(process.env.TENH_PLAYWRIGHT_MODULE||'C:/Users/TUF/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const webpack=require('next/dist/compiled/webpack/webpack').webpack;
const write=(name,content)=>{const file=path.join(temp,name);fs.writeFileSync(file,content);return file;};
const loader=write('loader.cjs',`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{fileName:this.resourcePath,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText};`);
const language=write('language.cjs','exports.useWorkspaceLanguageId=()=>window.fixtureLanguage;');
const supabase=write('supabase.cjs','exports.createClient=()=>window.fixtureClient;');
const navigation=write('navigation.cjs','exports.useRouter=()=>({replace:url=>window.navigations.push(url)});');
const script=write('script.cjs','module.exports=()=>null;');
const link=write('link.cjs','const React=require("react");module.exports=({children,...props})=>React.createElement("a",props,children);');
const image=write('image.cjs','const React=require("react");module.exports=({priority,fill,quality,unoptimized,...props})=>React.createElement("img",props);');
const entry=write('entry.cjs',`
const React=require('react'),{createRoot}=require('react-dom/client');
const {SubscriptionPaymentView}=require(${JSON.stringify(path.join(root,'components/subscription/subscription-payment-view.tsx'))});
const business='00000000-0000-4000-8000-000000000002';
window.fixtureLanguage=new URLSearchParams(location.search).get('lang')||'en';window.navigations=[];window.requests=[];window.uploads=0;window.saved=null;
window.fixtureClient={auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},storage:{from:()=>({uploadToSignedUrl:async()=>{
 window.uploads++;if(window.failUpload)return{error:{message:'Fixture upload failed. Please try again.'}};window.uploaded=true;return{error:null};
}})}};
window.fetch=async(url,init={})=>{
 const body=init.body?JSON.parse(init.body):null;window.requests.push({url,method:init.method||'GET',body});
 if(url.startsWith('/api/bakong/checkout?'))return Response.json({success:true,retired:true,enabled:false,businessId:business,userId:'user',memberId:'member'});
 if(url.startsWith('/api/manual-payments?'))return Response.json({success:true,businessId:business,config:{enabled:true,bankName:'Fixture bank',accountName:'TENH fixture',accountNumber:'00000000',qrImageUrl:'/qr.svg'},request:null});
 if(url==='/api/manual-payments'){
  if(body.action==='prepare-upload'){
   if(!window.saved)window.saved={id:body.requestId,kind:'manual',businessId:business,businessName:'Fixture workspace',planCode:'mini',billingCycle:'monthly',amount:13,currency:'USD',reference:body.requestId,status:'prepared',environment:'manual',application:'pending'};
   return Response.json({success:true,requestId:window.saved.id,proofUploaded:!!window.uploaded,upload:{bucket:'fixture',path:'same-synthetic-path',token:'synthetic'}});
  }
  if(body.action!=='finalize-upload')throw Error('Unexpected action');
  await new Promise(resolve=>setTimeout(resolve,180));
  if(window.failFinalize)return Response.json({success:false,error:'Fixture submission not confirmed. Please retry.'},{status:503});
  window.saved.status='submitted';return Response.json({success:true,request:window.saved});
 }
 if(url.startsWith('/api/subscription/payment-status?'))return window.saved?Response.json({success:true,attempt:window.saved}):Response.json({success:false},{status:404});
 throw Error('Unexpected request '+url);
};
createRoot(document.getElementById('root')).render(React.createElement(SubscriptionPaymentView,{planCode:'mini',billingCycle:'monthly',purchaseBusinessId:business}));
`);
async function run(){
 await new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry,output:{path:temp,filename:'bundle.js'},resolve:{modules:[path.join(root,'node_modules')],extensions:['.tsx','.ts','.js','.cjs'],alias:{'next/script$':script,'next/link$':link,'next/image$':image,'next/navigation$':navigation,'@/lib/supabase/client$':supabase,'@/components/display/workspace-language-text$':language,'@':root}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
 const {compile}=require('@tailwindcss/node'),compiled=await compile('@import "tailwindcss";',{base:root,onDependency(){}});
 const sources=['subscription-payment-view.tsx','checkout-dialog.tsx','manual-qr-preview.tsx','payment-attempt-view.tsx','payment-success-card.tsx'].map(file=>fs.readFileSync(path.join(root,'components/subscription',file),'utf8')).join(' ');
 const css=compiled.build(sources.split(/[\s"'`<>]+/));
 write('fixture.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body style="background:#f8fafc;padding:12px"><main id="root"></main><script src="/bundle.js"></script></body></html>');
 write('qr.svg','<svg xmlns="http://www.w3.org/2000/svg" width="400" height="640" viewBox="0 0 400 640"><rect width="400" height="640" fill="white"/><text x="200" y="48" text-anchor="middle" font-size="18">UI FIXTURE — NOT FOR PAYMENT</text><rect x="48" y="108" width="304" height="304" fill="#111"/><path d="M80 140h88v88H80zM232 140h88v88h-88zM80 292h88v88H80z" fill="white"/><text x="200" y="536" text-anchor="middle" font-size="20">FULL IMAGE / QUIET MARGINS</text></svg>');
 const server=http.createServer((req,res)=>{
  const file=req.url.startsWith('/bundle.js')?'bundle.js':req.url.startsWith('/qr.svg')?'qr.svg':'fixture.html';
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(temp,file)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.TENH_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const base='http://127.0.0.1:'+server.address().port,evidence=path.join(root,'docs/evidence/manual-qr-20261017');fs.mkdirSync(evidence,{recursive:true});let cases=0;
 try{
  for(const language of ['en','km'])for(const width of [360,390,768,820,1024,1440]){
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(base+'/?lang='+language);
   const t=(en,km)=>language==='en'?en:km;
   await page.locator('[data-checkout-method-chooser] button').filter({hasText:t('Manual bank transfer','ផ្ទេរប្រាក់តាមធនាគារដោយដៃ')}).click();
   const footer=page.locator('[data-checkout-footer] button');await footer.click();
   const transfer=page.getByRole('dialog',{name:t('Manual bank transfer','ផ្ទេរប្រាក់តាមធនាគារដោយដៃ'),exact:true});await transfer.waitFor();
   const bounds=await transfer.boundingBox();assert.ok(bounds.width<=572&&bounds.x>=0&&bounds.x+bounds.width<=width);
   await transfer.locator('input[type=file]').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('synthetic receipt')});
   await transfer.locator('textarea').fill('Keep my selected receipt and note');
   const trigger=transfer.getByRole('button',{name:t('View QR code','មើលកូដ QR'),exact:true});await trigger.scrollIntoViewIfNeeded();
   if(language==='en'&&[390,768,1440].includes(width))await page.screenshot({path:path.join(evidence,'manual-'+width+'.png')});
   for(const mode of ['close','escape','close']){
    const scroll=await transfer.evaluate(el=>el.scrollTop);await trigger.click();
    const preview=page.getByRole('dialog',{name:t('Manual transfer QR code','QR សម្រាប់ផ្ទេរប្រាក់តាមធនាគារ'),exact:true});await preview.waitFor();
    const close=preview.getByRole('button',{name:t('Close QR preview','បិទការមើល QR')});assert.ok(await close.evaluate(el=>el===document.activeElement));
    const qr=preview.getByRole('img');await qr.evaluate(img=>img.decode());
    const imageBounds=await qr.boundingBox(),modal=await preview.boundingBox();
    assert.ok(Math.abs(imageBounds.width/imageBounds.height-400/640)<0.01);assert.ok(imageBounds.x>=0&&imageBounds.y>=0&&imageBounds.x+imageBounds.width<=width&&imageBounds.y+imageBounds.height<=900);
    assert.ok(modal.height<=900&&modal.width<=width);assert.equal(await qr.evaluate(el=>getComputedStyle(el).objectFit),'contain');
    assert.equal(await page.evaluate(()=>document.body.style.overflowY),'hidden');
    const pageScroll=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,400);
    assert.equal(await page.evaluate(()=>document.querySelector('dialog').scrollTop),scroll);
    assert.equal(await page.evaluate(()=>scrollY),pageScroll);
    await page.keyboard.press('Tab');assert.ok(await close.evaluate(el=>el===document.activeElement));await page.keyboard.press('Shift+Tab');assert.ok(await close.evaluate(el=>el===document.activeElement));
    if(mode==='close'&&language==='en'&&[390,768,1440].includes(width))await page.screenshot({path:path.join(evidence,'preview-'+width+'.png')});
    if(mode==='escape')await page.keyboard.press('Escape');else await close.click();await preview.waitFor({state:'detached'});
    assert.ok(await trigger.evaluate(el=>el===document.activeElement));assert.ok(Math.abs((await transfer.evaluate(el=>el.scrollTop))-scroll)<2);
    assert.equal(await transfer.locator('textarea').inputValue(),'Keep my selected receipt and note');assert.equal(await transfer.locator('input[type=file]').evaluate(el=>el.files[0].name),'receipt.png');
   }
   assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='POST').length),0);
   await page.keyboard.press('Escape');await transfer.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.body.style.overflowY),'');assert.ok(await footer.evaluate(el=>el===document.activeElement));
   await footer.click();assert.equal(await transfer.locator('textarea').inputValue(),'Keep my selected receipt and note');
   const submit=transfer.locator('button[aria-busy]');await page.evaluate(()=>window.failUpload=true);await submit.click();await transfer.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.saved.status),'prepared');
   await page.evaluate(()=>{window.failUpload=false;window.failFinalize=true;});await submit.click();await transfer.getByRole('alert').filter({hasText:'Fixture submission not confirmed'}).waitFor();
   assert.equal(await transfer.locator('textarea').inputValue(),'Keep my selected receipt and note');assert.equal(await page.evaluate(()=>window.saved.status),'prepared');
   const uploads=await page.evaluate(()=>window.uploads);await page.evaluate(()=>window.failFinalize=false);await submit.click();assert.ok(await submit.isDisabled());
   await page.getByRole('heading',{name:t('Payment submitted','បានដាក់ស្នើការទូទាត់'),exact:true}).waitFor();assert.equal(await transfer.count(),0);
   assert.equal(await page.evaluate(()=>window.saved.status),'submitted');assert.equal(await page.evaluate(()=>window.uploads),uploads);
   assert.ok(await page.getByText(t('Approval usually takes 1-2 business days.','ការអនុម័តជាធម្មតាចំណាយពេល 1-2 ថ្ងៃធ្វើការ។'),{exact:true}).isVisible());
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();cases++;
  }
  for(const language of ['en','km']){
   const page=await browser.newPage({viewport:{width:740,height:320}}),t=(en,km)=>language==='en'?en:km;
   await page.goto(base+'/?lang='+language);
   await page.locator('[data-checkout-method-chooser] button').filter({hasText:t('Manual bank transfer','ផ្ទេរប្រាក់តាមធនាគារដោយដៃ')}).click();
   await page.locator('[data-checkout-footer] button').click();
   await page.getByRole('button',{name:t('View QR code','មើលកូដ QR'),exact:true}).click();
   const preview=page.getByRole('dialog',{name:t('Manual transfer QR code','QR សម្រាប់ផ្ទេរប្រាក់តាមធនាគារ'),exact:true});
   await preview.getByRole('img').evaluate(img=>img.decode());const bounds=await preview.getByRole('img').boundingBox();
   assert.ok(bounds.y>=0&&bounds.y+bounds.height<=320);assert.ok(bounds.x>=0&&bounds.x+bounds.width<=740);
   await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),1);await page.close();
  }
  console.log(JSON.stringify({passed:true,cases,landscape:true,receiptPreserved:true,uploadAndSubmissionRetries:true,evidence}));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
