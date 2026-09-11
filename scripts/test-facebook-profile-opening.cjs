const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('tenh-extension/src/background.js', 'utf8');
const functions = source.slice(source.indexOf('function isSafeFacebookProfileUrl('), source.indexOf('async function warmFacebookCompanion('));
const sender = {tab:{id:10,url:'https://app.tenhchat.com/dashboard/inbox'}};
function harness(result = {profileUrl:'https://www.facebook.com/thy.thy.886036#',pageId:'393342417206745',selectedItemId:'61555135812581'}, tabs = [{id:77,active:false,url:'https://business.facebook.com/latest/inbox/all/?asset_id=393342417206745'}]) {
  const created=[], removed=[],executed=[];
  const context=vm.createContext({URL, URLSearchParams, crypto:webcrypto, TENH_ORIGIN:'https://app.tenhchat.com',
    waitForFacebookBridge:async()=>true,
    chrome:{tabs:{query:async()=>tabs,get:async id=>tabs.find(tab=>tab.id===id),update:async()=>{throw Error("Unexpected tab navigation")},create:async options=>{created.push(options);return {id:created.length+100}}, remove:async id=>removed.push(id)},
      scripting:{executeScript:async options=>{executed.push(options.func.toString());return [{result:Array.isArray(result)?result[Math.min(executed.length-1,result.length-1)]:result}]}}}});
  vm.runInContext(functions,context);
  return {context,created,removed,executed};
}
const options={pageId:'393342417206745',threadId:'27032083679825383',customerName:'Test Customer'};
test('lookup creates no Business Suite or blank tabs; confirmation opens only real profile once',async()=>{
  const {context,created,removed}=harness();
  const result=await context.openFacebookCustomerProfile(options,sender);
  assert.equal(result.resolved,true);
  assert.equal(created.length,0);
  assert.equal(removed.length,0);
  assert.equal(created.some(tab=>tab.url==='about:blank'),false);
  assert.equal((await context.openResolvedFacebookProfile(result.openToken,sender)).opened,true);
  assert.equal(created[0].url,'https://www.facebook.com/thy.thy.886036');
  assert.equal(created[0].active,true);
  assert.equal((await context.openResolvedFacebookProfile(result.openToken,sender)).opened,false);
  assert.equal(created.length,1);
});
test('another app tab and lookalike origin cannot consume a profile ticket',async()=>{
  const {context,created}=harness();
  const result=await context.openFacebookCustomerProfile(options,sender);
  for(const invalid of [{tab:{...sender.tab,id:11}},{tab:{...sender.tab,url:'https://app.tenhchat.com.evil.example/'}}]){
    assert.equal((await context.openResolvedFacebookProfile(result.openToken,invalid)).opened,false);
  }
  assert.equal(created.length,0);
  assert.equal((await context.openResolvedFacebookProfile(result.openToken,sender)).opened,true);
});
test('missing profile leaves existing tabs untouched',async()=>{
  const {context,created,removed}=harness({reason:'customer_not_found'});
  const result=await context.openFacebookCustomerProfile(options,sender);
  assert.equal(result.opened,false);
  assert.equal(result.reason,'customer_not_found');
  assert.equal(result.openToken,undefined);
  assert.equal(created.length,0);
  assert.equal(removed.length,0);
});
test('rejects Suite, redirect, credentials and Messenger ID profile candidates',async()=>{
  for(const profileUrl of ['https://business.facebook.com/latest/inbox/all/','https://www.facebook.com/login','https://www.facebook.com/l.php?u=https://evil.example','https://user:pass@www.facebook.com/thy.thy.886036','https://www.facebook.com/profile.php?id=27032083679825383','https://www.facebook.com/27032083679825383']){
    const {context,created}=harness({profileUrl,pageId:options.pageId});
    const result=await context.openFacebookCustomerProfile(options,sender);
    assert.equal(result.opened,false,profileUrl);
    assert.equal(result.openToken,undefined,profileUrl);
    assert.equal(created.length,0);
  }
});

test('no open Facebook tabs never causes a Business Suite fallback',async()=>{
  const {context,created}=harness(undefined,[]);
  const result=await context.openFacebookCustomerProfile(options,sender);
  assert.equal(result.reason,'facebook_session_needed');assert.equal(created.length,0);
});
test('does not read a tab for another Page',async()=>{
  const {context,created}=harness(undefined,[{id:88,url:'https://business.facebook.com/latest/inbox/all/?asset_id=999'}]);
  const result=await context.openFacebookCustomerProfile(options,sender);
  assert.equal(result.reason,'facebook_session_needed');assert.equal(created.length,0);
});

test('automatically searches an existing background Page tab when current customer differs',async()=>{
  const {context,created,executed}=harness([{reason:'profile_link_missing'},{profileUrl:'https://www.facebook.com/thy.thy.886036',pageId:options.pageId}]);
  const result=await context.openFacebookCustomerProfile(options,sender);
  assert.equal(result.resolved,true);
  assert.equal(executed.length,2);
  assert.ok(executed[1].includes('resolveAutomatic'));
  assert.equal(created.length,0);
  assert.equal((await context.openResolvedFacebookProfile(result.openToken,sender)).opened,true);
  assert.equal(created[0].url,'https://www.facebook.com/thy.thy.886036');
});
test('never searches in the Facebook tab currently in use',async()=>{
  const {context,created,executed}=harness({reason:'profile_link_missing'},[{id:77,active:true,url:'https://business.facebook.com/latest/inbox/all/?asset_id=393342417206745'}]);
  const result=await context.openFacebookCustomerProfile(options,sender);
  assert.equal(result.reason,'facebook_tab_in_use');
  assert.equal(executed.length,1);assert.equal(created.length,0);
});
