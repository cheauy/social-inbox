const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('tenh-extension/src/background.js','utf8');
const start=src.indexOf('const FACEBOOK_SESSION_PROBE_TTL_MS');
const end=src.indexOf('async function clearAuth()',start);
const code=src.slice(start,end);
function harness(finalUrl,status=200){let fetches=0,tabs=0;const sandbox={Date,AbortController,setTimeout,clearTimeout,fetch:async()=>{fetches++;return {url:finalUrl,status}},chrome:{tabs:{create:async()=>{tabs++}}}};vm.runInNewContext(code+'\nglobalThis.probe=probeFacebookSession;',sandbox);return {probe:sandbox.probe,get fetches(){return fetches},get tabs(){return tabs}}}
test('detects logged-in Facebook session without opening any tab',async()=>{const h=harness('https://www.facebook.com/profile.php?id=123');const r=await h.probe({force:true});assert.equal(r.loggedIn,true);assert.equal(h.tabs,0);assert.equal(h.fetches,1)});
test('detects login redirect without opening any tab',async()=>{const h=harness('https://www.facebook.com/login/?next=x');const r=await h.probe({force:true});assert.equal(r.loggedIn,false);assert.equal(h.tabs,0)});
