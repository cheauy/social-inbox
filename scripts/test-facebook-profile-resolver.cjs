/* Browser fixture tests: real Chromium DOM; no external Facebook requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.TENH_PLAYWRIGHT_PATH || 'playwright');
const selectors = fs.readFileSync('tenh-extension/src/facebook-selectors.js','utf8');
const resolver = fs.readFileSync('tenh-extension/src/facebook-profile-resolver.js','utf8');
const PUBLIC='https://www.facebook.com/profile.php?id=61555135812581';
const opts={pageId:'123456',threadId:'987654',disallowedId:'987654',customerName:'Test Customer'};
const BASE='https://business.facebook.com/latest/inbox/all?asset_id=123456&selected_item_id=987654&thread_type=FB_MESSAGE';
function fixture({name='Test Customer',href=PUBLIC,input=true,duplicate=false,nameLink=false}={}) {
  return `<meta charset="utf-8"><style>input{position:absolute;left:40px;top:130px;width:270px;height:40px}.row{position:absolute;left:40px;top:210px;width:280px;height:50px}aside{position:absolute;left:930px;top:130px;width:330px;height:180px}h2{margin:5px}</style>
  ${input?'<input aria-label="Search" value="unchanged"/>':''}<div class="row" role="button"><span>Test Customer</span></div>
  <aside><h2>${name}</h2><a href="${href}">${nameLink?name:'View profile'}</a>${duplicate?'<a href="https://www.facebook.com/another.customer">View profile</a>':''}</aside>
  <script>window.interactions=0;['click','input','change','focusin'].forEach(type=>document.addEventListener(type,()=>window.interactions++));</script>`;
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.TENH_CHROMIUM_PATH||undefined,headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({viewport:{width:1320,height:900}});
  let html=fixture();
  // All fixtures are local/about:blank. A lexical URL stand-in lets the
  // unchanged detector code read a Facebook-shaped location without network.
  const load=async(url=BASE)=>{
    await page.setContent(html);
    const setup=`(() => { const location = new URL(${JSON.stringify(url)}); const window = new Proxy(globalThis.window, { get(target,key) { return key === "location" ? location : Reflect.get(target,key); } }); ${selectors}\n${resolver} })();`;
    await page.addScriptTag({content:setup});
  };
  const read=(options=opts)=>page.evaluate(o=>TenhFacebookProfileResolver.readCurrent(o),options);
  await load();let r=await read();assert.equal(r.profileUrl,PUBLIC);assert.equal(r.matchedThreadId,opts.threadId);
  assert.equal(await page.evaluate(()=>window.interactions),0);assert.equal(await page.locator('input').inputValue(),'unchanged');
  console.log('PASS exact Page/thread -> visible profile link, without mutating the active inbox');
  html=fixture({input:false,nameLink:true});await load();assert.equal((await read()).profileUrl,PUBLIC);
  console.log('PASS name/profile header link works without the inbox search box');
  html=fixture();await load(BASE.replace('987654','222222'));assert.equal((await read()).reason,'conversation_mismatch');
  console.log('PASS same-name different selected conversation rejected');
  await load(BASE.replace('123456','222222'));assert.equal((await read()).reason,'page_mismatch_or_sign_in');
  console.log('PASS other Facebook Page rejected');
  await load(BASE+'&selected_item_id=222222');assert.equal((await read()).reason,'conversation_mismatch');
  console.log('PASS conflicting conversation URL parameters rejected');
  html=fixture({name:'Previous Customer'});await load();assert.equal((await read()).reason,'profile_link_missing');
  console.log('PASS previous customer details are not accepted while the new thread loads');
  html=fixture({duplicate:true});await load();assert.equal((await read()).reason,'ambiguous_profile');
  console.log('PASS ambiguous profile links rejected');
  for(const href of [`https://www.facebook.com/profile.php?id=${opts.threadId}`,`https://www.facebook.com/${opts.threadId}`,'https://business.facebook.com/latest/inbox/all','https://www.facebook.com.evil.test/person','https://www.facebook.com/profile.php?id=123456&id=777777']) {
    html=fixture({href});await load();assert.equal((await read()).reason,'profile_link_missing',href);
  }
  console.log('PASS scoped IDs, lookalike domains and invalid profile URLs rejected');
  html=fixture({name:'សុខ សាន្ត'});await load();assert.equal((await read({...opts,customerName:'សុខ សាន្ត'})).profileUrl,PUBLIC);
  console.log('PASS Khmer customer heading supported');
  html=fixture();await load();assert.equal((await page.evaluate(o=>TenhFacebookProfileResolver.resolveAutomatic(o),opts)).reason,'facebook_tab_in_use');
  assert.equal(await page.evaluate(()=>window.interactions),0);
  console.log('PASS visible Facebook tab is never automatically searched/clicked');
  await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}));
  const [automatic,busy]=await page.evaluate(o=>Promise.all([TenhFacebookProfileResolver.resolveAutomatic(o),TenhFacebookProfileResolver.resolveAutomatic(o)]),opts);
  assert.equal(automatic.profileUrl,PUBLIC);assert.equal(busy.reason,'profile_lookup_busy');assert.equal(await page.evaluate(()=>window.interactions),0);
  console.log('PASS inactive lookup settles exact context; concurrent lookup blocked');
  // Strict validation of the public profile destination (not global navigation).
  html='<main><h1>Test Customer</h1><a href="/person/photos">Photos</a></main>';await load(PUBLIC);
  const validate=()=>page.evaluate(o=>TenhFacebookSelectors.validateCurrentProfilePage(o.customerName,o.threadId),opts);
  assert.equal((await validate()).valid,true);assert.equal((await validate()).url,PUBLIC);
  console.log('PASS visible real profile heading accepted');
  html='<nav>Test Customer<a aria-label="My profile">Profile</a></nav><main><h1>Someone Else</h1><a href="/friends">Friends</a></main>';await load(PUBLIC);
  assert.equal((await validate()).valid,false);
  console.log('PASS wrong profile rejected even if navigation contains the expected name');
  html='<main><h1>Test Customer</h1><p>This content isn\'t available right now</p></main>';await load(PUBLIC);
  assert.equal((await validate()).reason,'facebook_content_unavailable');
  console.log('PASS unavailable Facebook profile page rejected');
  html='<main><h1>Test Customer</h1></main>';await load(`https://www.facebook.com/profile.php?id=${opts.threadId}`);
  assert.equal((await validate()).reason,'profile_scoped_id');
  console.log('PASS a Messenger ID is never returned as a public profile ID');
  html=`<link rel="canonical" href="${PUBLIC}"><main><h1>Test Customer</h1></main>`;await load('https://www.facebook.com/customer.example');
  assert.equal((await validate()).url,PUBLIC);
  console.log('PASS numeric ID is read from rendered public-profile metadata, not derived from PSID');
  html='<main><h1>Test Customer</h1></main>';await load('https://www.facebook.com/customer.example');
  assert.equal((await validate()).url,'https://www.facebook.com/customer.example');
  console.log('PASS username is retained when no numeric public ID is exposed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
