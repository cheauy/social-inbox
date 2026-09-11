/* Component-level behavior tests using small hook mocks, no live Facebook. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const urlExports={};vm.runInNewContext(compile('lib/facebook/customer-profile-url.ts'),{exports:urlExports,URL});
const component=compile('components/inbox/customer-facebook-avatar.tsx');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const expected={businessId:'workspace',pageId:'123456',threadId:'987654',conversationId:'conversation'};
const profile='https://www.facebook.com/profile.php?id=61555135812581';
const result={...expected,resolved:true,verified:true,profileUrl:profile,openToken:'ticket'};
function harness({savedId,version='1.2.19',installed=true,confirm={opened:true,verified:true,profileUrl:profile},cacheEntry}={}){
  let answer,current={id:'conversation',business_id:'workspace',social_account:{platform:'facebook',platform_account_id:'123456'},contact:{id:'contact',platform_user_id:'987654',full_name:'Customer',facebook_profile_id:savedId}};
  const pending=new Promise(resolve=>{answer=resolve});
  const windows=[],confirmed=[],lookups=[],cache=new Map();
  const exports={},states=[],refs=[],effects=[];let stateIndex=0,refIndex=0,effectIndex=0;
  const context={exports,URL,Date,window:{open:(...args)=>windows.push(args)},
    sessionStorage:{getItem:key=>cacheEntry?JSON.stringify(cacheEntry):cache.get(key),setItem:(key,value)=>cache.set(key,value)},
    localStorage:{getItem:()=>{throw Error('Old localStorage profile cache must not be read')}},
    require:name=>{
      if(name==='react')return {
        useState:initial=>{const i=stateIndex++;if(!(i in states))states[i]=initial;return [states[i],value=>states[i]=value]},
        useRef:initial=>{const i=refIndex++;return refs[i]??(refs[i]={current:initial})},
        useEffect:(fn,deps)=>{const i=effectIndex++;const prev=effects[i];if(!prev||deps.some((d,n)=>prev.deps[n]!==d)){prev?.cleanup?.();effects[i]={deps,cleanup:fn()}}},
      };
      if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
      if(name==='@/components/customer-avatar')return {CustomerAvatar:()=>null};
      if(name==='@/lib/facebook/customer-profile-url')return urlExports;
      if(name==='@/lib/facebook/profile-lookup-error')return {profileLookupError:reason=>reason};
      if(name==='@/lib/extension/use-companion')return {useCompanion:()=>({installed,version,
        openFacebookProfile:options=>{lookups.push(options);return pending},
        openResolvedFacebookProfile:async(token,context)=>{confirmed.push({token,context});return confirm},
      })};
      throw Error(name);
    }};
  vm.runInNewContext(component,context);
  const render=()=>{stateIndex=0;refIndex=0;effectIndex=0;return exports.CustomerFacebookAvatar({conversation:current})};
  let tree=render();
  return {windows,confirmed,lookups,cache,answer,rerender:()=>tree=render(),tree:()=>tree,
    click:()=>tree.props.children[0].props.onClick(),unmount:()=>effects.forEach(e=>e.cleanup?.()),
    switchTo:patch=>{current={...current,...patch};tree=render();return tree},
  };
}
test('unknown photo resolves -> confirms one profile tab and caches only after opening',async()=>{
  const h=harness();h.click();assert.equal(h.windows.length,0);assert.equal(h.cache.size,0);
  h.answer(result);await tick();assert.equal(h.confirmed.length,1);assert.equal(h.confirmed[0].token,'ticket');
  assert.equal(JSON.stringify(h.confirmed[0].context),JSON.stringify(expected));assert.equal(h.cache.size,1);assert.equal(h.windows.length,0);
});
test('TENH request includes correct workspace/Page/thread/conversation',()=>{
  const h=harness();h.click();for(const [key,value] of Object.entries(expected))assert.equal(h.lookups[0][key],value);
});
test('double-click does not start two lookups',()=>{
  const h=harness();h.click();h.click();assert.equal(h.lookups.length,1);
});
test('unmount cancels profile opening and cache updates',async()=>{
  const h=harness();h.click();h.unmount();h.answer(result);await tick();assert.equal(h.confirmed.length,0);assert.equal(h.cache.size,0);
});
test('changing conversation on the same mounted component rejects old completion',async()=>{
  const h=harness();h.click();h.switchTo({id:'different-conversation'});h.answer(result);await tick();
  assert.equal(h.confirmed.length,0);assert.equal(h.cache.size,0);assert.equal(h.windows.length,0);
});
test('wrong Page/thread/workspace/conversation and unverified response cannot open or cache',async()=>{
  for(const patch of [{pageId:'555555'},{threadId:'555555'},{businessId:'other'},{conversationId:'other'},{verified:false},{resolved:false,reason:'profile_link_missing'}]){
    const h=harness();h.click();h.answer({...result,...patch});await tick();assert.equal(h.confirmed.length,0);assert.equal(h.cache.size,0);
  }
});
test('known public ID still opens without extension in the original click',()=>{
  const h=harness({savedId:'61555135812581',installed:false});h.click();
  assert.deepEqual(h.windows,[[profile,'_blank','noopener,noreferrer']]);assert.equal(h.lookups.length,0);
});
test('saved public ID equal to Messenger ID is rejected instead of opening broken page',()=>{
  const h=harness({savedId:'987654'});h.click();assert.equal(h.windows.length,0);assert.equal(h.lookups.length,1);
});
test('old extension is reported instead of timing out silently',()=>{
  const h=harness({version:'1.2.18'});h.click();h.rerender();assert.equal(h.lookups.length,0);
  assert.ok(JSON.stringify(h.tree()).includes('1.2.19'));
});
test('unverified or expired session-cache link is ignored',()=>{
  for(const entry of [{url:profile,verified:false,expiresAt:Date.now()+1000},{url:profile,verified:true,expiresAt:0}]){
    const h=harness({cacheEntry:entry});h.click();assert.equal(h.windows.length,0);assert.equal(h.lookups.length,1);
  }
});
test('confirmed, unexpired session cache opens direct on repeat click',()=>{
  const h=harness({cacheEntry:{url:profile,verified:true,expiresAt:Date.now()+30000}});h.click();
  assert.deepEqual(h.windows,[[profile,'_blank','noopener,noreferrer']]);assert.equal(h.lookups.length,0);
});
test('failed second phase does not poison cache or silently open Business Suite',async()=>{
  const h=harness({confirm:{opened:false,reason:'profile_context_mismatch'}});h.click();h.answer(result);await tick();h.rerender();
  assert.equal(h.cache.size,0);assert.equal(h.windows.length,0);assert.ok(JSON.stringify(h.tree()).includes('profile_context_mismatch'));
});
test('photo UI has no manual URL form',async()=>{
  const h=harness();h.click();h.answer({reason:'profile_link_missing'});await tick();
  assert.equal(h.rerender().props.children.some(child=>child?.type==='form'),false);
});
