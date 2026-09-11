const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('tenh-extension/src/background.js', 'utf8');
const functions = source.slice(source.indexOf('function isSafeFacebookProfileUrl('), source.indexOf('async function warmFacebookCompanion('));
const sender = {tab:{id:10,url:'https://app.tenhchat.com/dashboard/inbox'}};
function harness(result = {profileUrl:'https://www.facebook.com/thy.thy.886036#',selectedItemId:'61555135812581'}) {
  const created=[], removed=[];
  const context=vm.createContext({URL, URLSearchParams, crypto:webcrypto, TENH_ORIGIN:'https://app.tenhchat.com',
    waitForFacebookBridge:async()=>true,
    chrome:{tabs:{create:async options=>{created.push(options);return {id:created.length+100}}, remove:async id=>removed.push(id)},
      scripting:{executeScript:async()=>[{result}]}}});
  vm.runInContext(functions,context);
  return {context,created,removed};
}
const options={pageId:'393342417206745',threadId:'27032083679825383',customerName:'Test Customer'};
test('lookup never opens a blank or foreground Suite tab; confirmation opens only real profile once',async()=>{
  const {context,created,removed}=harness();
  const result=await context.openFacebookCustomerProfile(options,sender);
  assert.equal(result.resolved,true);
  assert.equal(created.length,1);
  assert.equal(created[0].active,false);
  assert.equal(removed.length,1);
  assert.equal(created.some(tab=>tab.url==='about:blank'),false);
  assert.equal((await context.openResolvedFacebookProfile(result.openToken,sender)).opened,true);
  assert.equal(created[1].url,'https://www.facebook.com/thy.thy.886036');
  assert.equal(created[1].active,true);
  assert.equal((await context.openResolvedFacebookProfile(result.openToken,sender)).opened,false);
  assert.equal(created.length,2);
});
test('another app tab and lookalike origin cannot consume a profile ticket',async()=>{
  const {context,created}=harness();
  const result=await context.openFacebookCustomerProfile(options,sender);
  for(const invalid of [{tab:{...sender.tab,id:11}},{tab:{...sender.tab,url:'https://app.tenhchat.com.evil.example/'}}]){
    assert.equal((await context.openResolvedFacebookProfile(result.openToken,invalid)).opened,false);
  }
  assert.equal(created.length,1);
  assert.equal((await context.openResolvedFacebookProfile(result.openToken,sender)).opened,true);
});
test('failed resolution cleans up its inactive tab without opening another profile',async()=>{
  const {context,created,removed}=harness({reason:'customer_not_found'});
  const result=await context.openFacebookCustomerProfile(options,sender);
  assert.equal(result.opened,false);
  assert.equal(result.reason,'customer_not_found');
  assert.equal(result.openToken,undefined);
  assert.equal(created.length,1);
  assert.equal(removed.length,1);
});
test('rejects Suite, redirect, credentials and Messenger ID profile candidates',async()=>{
  for(const profileUrl of ['https://business.facebook.com/latest/inbox/all/','https://www.facebook.com/login','https://www.facebook.com/l.php?u=https://evil.example','https://user:pass@www.facebook.com/thy.thy.886036','https://www.facebook.com/profile.php?id=27032083679825383','https://www.facebook.com/27032083679825383']){
    const {context,created}=harness({profileUrl});
    const result=await context.openFacebookCustomerProfile(options,sender);
    assert.equal(result.opened,false,profileUrl);
    assert.equal(result.openToken,undefined,profileUrl);
    assert.equal(created.length,1);
  }
});
