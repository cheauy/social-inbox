const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.TENH_PLAYWRIGHT_PATH || 'playwright');
const selectors = fs.readFileSync('tenh-extension/src/facebook-selectors.js','utf8');
const resolver = fs.readFileSync('tenh-extension/src/facebook-profile-resolver.js','utf8');
function fixture(name='Uy Chea',href='https://www.facebook.com/thy.thy.886036#',duplicate=false) {
 return `<meta charset="utf-8"><style>input{position:absolute;left:100px;top:200px;width:310px;height:40px}.row{position:absolute;left:100px;top:310px;width:450px;height:70px}.second{top:400px}aside{position:absolute;left:1300px;top:150px;width:350px;height:100px}h3{margin:5px}</style>
 <input aria-label="Search" value="unchanged"/><div class="row" role="button"><span>Uy Chea</span></div>
 ${duplicate?'<div class="row second" role="button"><span>Uy Chea</span></div>':''}
 <aside><h3>${name}</h3><a href="${href}">View profile</a></aside>
 <script>window.interactions=0;['click','input','change','focusin'].forEach(type=>document.addEventListener(type,()=>window.interactions++));</script>`;
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1900,height:950}});
  let html=fixture();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));
  const base='https://business.facebook.com/latest/inbox/all/?asset_id=164836150054638&mailbox_id=164836150054638&selected_item_id=61555135812581&thread_type=FB_MESSAGE';
  const load=async()=>{await page.goto(base);await page.addScriptTag({content:selectors});await page.addScriptTag({content:resolver});};
  const options={pageId:'164836150054638',customerName:'Uy Chea',disallowedId:'27032083679825383'};
  const read=()=>page.evaluate(options=>TenhFacebookProfileResolver.readCurrent(options),options);
  await load();
  assert.equal((await read()).profileUrl,'https://www.facebook.com/thy.thy.886036');
  assert.equal(await page.evaluate(()=>window.interactions),0);
  assert.equal(await page.locator('input').inputValue(),'unchanged');
  assert.equal(page.url(),base);
  console.log('PASS: read real username link without clicks, searches, focus or navigation');
  html=fixture('Different Customer');await load();assert.equal((await read()).reason,'profile_link_missing');
  console.log('PASS: previously selected different customer rejected');
  html=fixture('Uy Chea',undefined,true);await load();assert.equal((await read()).reason,'ambiguous_customer');
  console.log('PASS: duplicate customer names rejected');
  html=fixture();await load();
  assert.equal((await page.evaluate(options=>TenhFacebookProfileResolver.readCurrent({...options,pageId:'99999'}),options)).reason,'page_mismatch_or_sign_in');
  console.log('PASS: another Page rejected');
  for(const href of ['https://www.facebook.com/profile.php?id=27032083679825383','https://business.facebook.com/latest/inbox/all/']) {
    html=fixture('Uy Chea',href);await load();assert.equal((await read()).reason,'profile_link_missing');
  }
  console.log('PASS: Messenger ID and Business Suite profile links rejected');
  html=fixture().replaceAll('Uy Chea','សុខ សាន្ត');await load();
  assert.equal((await page.evaluate(options=>TenhFacebookProfileResolver.readCurrent({...options,customerName:'សុខ សាន្ត'}),options)).profileUrl,'https://www.facebook.com/thy.thy.886036');
  console.log('PASS: Khmer name identity supported');
  html=fixture('Previous Customer');await load();
  assert.equal((await page.evaluate(options=>TenhFacebookProfileResolver.resolveAutomatic(options),options)).reason,'facebook_tab_in_use');
  assert.equal(await page.locator('input').inputValue(),'unchanged');
  console.log('PASS: automatic lookup does not change a visible Facebook tab');
  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
    const row=document.querySelector('.row');
    row.hidden=true;
    row.onclick=()=>{document.querySelector('h3').textContent='Uy Chea';};
    const button=document.createElement('button');
    button.textContent='Search in Messenger conversations';
    button.style='position:absolute;left:100px;top:255px;width:450px;height:45px';
    button.onclick=()=>{window.submitted=(window.submitted||0)+1;row.hidden=false;button.hidden=true;};
    document.body.append(button);
  });
  const [automatic,busy,reading]=await page.evaluate(options=>Promise.all([
    TenhFacebookProfileResolver.resolveAutomatic(options),
    TenhFacebookProfileResolver.resolveAutomatic(options),
    TenhFacebookProfileResolver.readCurrent(options)
  ]),options);
  assert.equal(automatic.profileUrl,'https://www.facebook.com/thy.thy.886036');
  assert.equal(busy.reason,'profile_lookup_busy');
  assert.equal(reading.reason,'profile_lookup_busy');
  assert.equal(await page.evaluate(()=>window.submitted),1);
  assert.equal(page.context().pages().length,1);
  console.log('PASS: automatic full search selects matching customer without another Suite tab or manual URL; concurrent lookup rejected');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
