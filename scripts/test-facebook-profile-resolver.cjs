const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.TENH_PLAYWRIGHT_PATH || "playwright");
const selectors = fs.readFileSync("tenh-extension/src/facebook-selectors.js", "utf8");
const resolver = fs.readFileSync("tenh-extension/src/facebook-profile-resolver.js", "utf8");
const fixture = (duplicate = false, profileName = "Uy Chea", profileHref = "https://www.facebook.com/profile.php?id=61555135812581") => `
<meta charset="utf-8"><style>body{margin:0}input{position:absolute;left:100px;top:200px;width:310px;height:40px}.row{position:absolute;left:100px;top:310px;width:450px;height:70px}.second{top:400px}aside{position:absolute;left:1300px;top:150px;width:350px;height:100px}h3{margin:5px}</style>
<input aria-label="Search"/><div class="row" role="button" onclick="history.replaceState({},'', '?asset_id=164836150054638&mailbox_id=164836150054638&selected_item_id=61555135812581&thread_type=FB_MESSAGE');document.querySelector('aside').hidden=false"><span>Uy Chea</span></div>
${duplicate ? '<div class="row second" role="button"><span>Uy Chea</span></div>' : ''}
<aside hidden><h3>${profileName}</h3><a href="${profileHref}">View profile</a></aside>`;
(async () => {
 const browser = await chromium.launch({channel:"chrome",headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1900,height:950}});
  let html=fixture();
  await page.route("**/*", route => route.fulfill({contentType:"text/html",body:html}));
  const load=async()=>{await page.goto('https://business.facebook.com/latest/inbox/all/?asset_id=164836150054638&mailbox_id=164836150054638');await page.addScriptTag({content:selectors});await page.addScriptTag({content:resolver});};
  const options={pageId:'164836150054638',customerName:'Uy Chea',disallowedId:'27032083679825383'};
  await load();
  const found=await page.evaluate(options=>TenhFacebookProfileResolver.resolve(options),options);
  assert.equal(found.profileUrl,'https://www.facebook.com/profile.php?id=61555135812581');
  assert.equal(found.pageId,options.pageId); console.log('PASS: search and actual profile link resolve without using Messenger ID');
  // Reproduce Meta's "No results found / Search in Messenger conversations" state.
  // Its previously selected customer's profile remains visible while searching.
  html=fixture(false,'Uy Chea','https://www.facebook.com/thy.thy.886036#')
    .replace('<div class="row"', '<div hidden class="row"')
    .replace("document.querySelector('aside').hidden=false", "document.querySelector('#stale').remove();document.querySelector('aside').hidden=false")
    + `<aside id="stale"><h3>Rotanak Lyna</h3><a href="https://www.facebook.com/another.person">View profile</a></aside>
      <button id="searchAll" style="position:absolute;left:100px;top:255px;width:450px;height:45px"
        onclick="window.searchSubmitted=(window.searchSubmitted||0)+1;setTimeout(()=>{document.querySelector('.row').hidden=false;this.hidden=true},400)">
        <span>Search in Messenger conversations</span></button>`;
  await load();
  const submitted=await page.evaluate(options=>TenhFacebookProfileResolver.resolve(options),options);
  assert.equal(submitted.profileUrl,'https://www.facebook.com/thy.thy.886036');
  assert.equal(await page.evaluate(()=>window.searchSubmitted),1);
  console.log('PASS: full search submitted once; real username profile replaces stale customer');
  html=fixture().replaceAll('Uy Chea','សុខ សាន្ត').replaceAll('164836150054638','393342417206745').replaceAll('61555135812581','100026425303922');
  await load();
  await page.evaluate(()=>history.replaceState({},'', '?asset_id=393342417206745&mailbox_id=393342417206745'));
  const other=await page.evaluate(options=>TenhFacebookProfileResolver.resolve(options),{...options,pageId:'393342417206745',customerName:'សុខ សាន្ត'});
  assert.equal(other.profileUrl,'https://www.facebook.com/profile.php?id=100026425303922');console.log('PASS: different Page, customer and Khmer name supported');
  html=fixture();await load();
  const mismatch=await page.evaluate(options=>TenhFacebookProfileResolver.resolve({...options,pageId:'393342417206745'}),options);
  assert.equal(mismatch.reason,'page_mismatch_or_sign_in');console.log('PASS: wrong Page rejected');
  html=fixture(true);await load();
  const duplicate=await page.evaluate(options=>TenhFacebookProfileResolver.resolve(options),options);
  assert.equal(duplicate.reason,'ambiguous_customer');console.log('PASS: duplicate exact names rejected');
  html=fixture(false,'Different Customer');await load();
  const links=await page.evaluate(()=>{document.querySelector('aside').hidden=false;return TenhFacebookProfileResolver.profileLinks(document.querySelector('input'),'uy chea','27032083679825383');});
  assert.deepEqual(links,[]);console.log('PASS: another customer identity card rejected');
  html=fixture(false,'Uy Chea','https://www.facebook.com/profile.php?id=27032083679825383');await load();
  const psid=await page.evaluate(()=>{document.querySelector('aside').hidden=false;return TenhFacebookProfileResolver.profileLinks(document.querySelector('input'),'uy chea','27032083679825383');});
  assert.deepEqual(psid,[]);console.log('PASS: scoped ID profile candidate rejected');
  html=fixture(false,'Uy Chea','https://business.facebook.com/latest/inbox/all/');await load();
  const suite=await page.evaluate(()=>{document.querySelector('aside').hidden=false;return TenhFacebookProfileResolver.profileLinks(document.querySelector('input'),'uy chea','27032083679825383');});
  assert.deepEqual(suite,[]);console.log('PASS: Business Suite never returned as profile');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
