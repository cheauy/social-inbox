const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function compile(path){return ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;}
const urlExports={};
vm.runInNewContext(compile('lib/facebook/customer-profile-url.ts'),{exports:urlExports,URL});
const component=compile('components/inbox/customer-facebook-avatar.tsx');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(savedId){
  let answer;
  const pending=new Promise(resolve=>{answer=resolve});
  const windows=[],confirmed=[],cleanups=[],cache=new Map();
  const exports={};
  const states=[],refs=[];let stateIndex=0,refIndex=0;
  const context={exports,window:{open:(...args)=>windows.push(args)},localStorage:{getItem:key=>cache.get(key),setItem:(key,value)=>cache.set(key,value)},
    require:name=>{
      if(name==='react') return {useState:initial=>{const index=stateIndex++;if(!(index in states))states[index]=initial;return [states[index],value=>{states[index]=value}]},useRef:initial=>{const index=refIndex++;return refs[index]??(refs[index]={current:initial})},useEffect:fn=>cleanups.push(fn())};
      if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
      if(name==='@/components/customer-avatar')return {CustomerAvatar:()=>null};
      if(name==='@/lib/facebook/customer-profile-url')return urlExports;
      if(name==='@/lib/facebook/profile-lookup-error')return {profileLookupError:reason=>reason};
      if(name==='@/lib/extension/use-companion')return {useCompanion:()=>({installed:true,version:'1.2.16',openFacebookProfile:()=>pending,openResolvedFacebookProfile:async token=>{confirmed.push(token);return {opened:true}}})};
      throw Error(name);
    }};
  vm.runInNewContext(component,context);
  const render=()=>{stateIndex=0;refIndex=0;return exports.CustomerFacebookAvatar({conversation:{id:'conversation',business_id:'workspace',social_account:{platform:'facebook',platform_account_id:'123456'},contact:{id:'contact',platform_user_id:'987654',full_name:'Customer',facebook_profile_id:savedId}}});};
  let tree=render();
  return {windows,confirmed,cache,answer,rerender:()=>{tree=render();return tree},tree:()=>tree,click:()=>tree.props.children[0].props.onClick(),unmount:()=>cleanups.forEach(fn=>fn?.())};
}
const result={resolved:true,pageId:'123456',profileUrl:'https://www.facebook.com/thy.thy.886036',openToken:'ticket'};
test('unknown photo waits in TENH without blank tabs, then confirms real profile opening',async()=>{
  const h=harness();h.click();assert.equal(h.windows.length,0);
  h.answer(result);await tick();
  assert.deepEqual(h.confirmed,['ticket']);assert.equal(h.windows.length,0);assert.equal(h.cache.size,1);
});
test('changing customers cancels profile opening and caching',async()=>{
  const h=harness();h.click();h.unmount();h.answer(result);await tick();
  assert.equal(h.confirmed.length,0);assert.equal(h.windows.length,0);assert.equal(h.cache.size,0);
});
test('failed and wrong-Page lookups leave no tabs or cached links',async()=>{
  for(const answer of [{reason:'customer_not_found'},{...result,pageId:'999999'}]){
    const h=harness();h.click();h.answer(answer);await tick();
    assert.equal(h.confirmed.length,0);assert.equal(h.windows.length,0);assert.equal(h.cache.size,0);
  }
});
test('known public ID opens real URL immediately without extension lookup or blank tab',()=>{
  const h=harness('61555135812581');h.click();
  assert.deepEqual(h.windows,[['https://www.facebook.com/profile.php?id=61555135812581','_blank','noopener,noreferrer']]);
  assert.equal(h.confirmed.length,0);
});

test('save a customer username link and open it directly on future photo clicks',()=>{
  const h=harness();
  h.tree().props.children.find(child=>child?.type==='button' && child.props.children==='Set Facebook profile link').props.onClick();
  let form=h.rerender().props.children.find(child=>child?.type==='form');
  form.props.children[0].props.children.find(child=>child?.type==='input').props.onChange({target:{value:'https://www.facebook.com/thy.thy.886036#'}});
  form=h.rerender().props.children.find(child=>child?.type==='form');
  form.props.onSubmit({preventDefault(){}});
  assert.equal(h.cache.size,1);
  assert.equal(h.windows[0][0],'https://www.facebook.com/thy.thy.886036');
  h.rerender();h.click();
  assert.equal(h.windows[1][0],'https://www.facebook.com/thy.thy.886036');
  assert.equal(h.confirmed.length,0);
});
test('manual profile link rejects Business Suite and the scoped Messenger ID',()=>{
  for(const value of ['https://business.facebook.com/latest/inbox/all/','https://www.facebook.com/profile.php?id=987654']){
    const h=harness();
    h.tree().props.children.find(child=>child?.type==='button' && child.props.children==='Set Facebook profile link').props.onClick();
    let form=h.rerender().props.children.find(child=>child?.type==='form');
    form.props.children[0].props.children.find(child=>child?.type==='input').props.onChange({target:{value}});
    form=h.rerender().props.children.find(child=>child?.type==='form');
    form.props.onSubmit({preventDefault(){}});
    assert.equal(h.cache.size,0);assert.equal(h.windows.length,0);
  }
});

test('saving a link cancels a pending automatic result',async()=>{
  const h=harness();
  h.tree().props.children.find(child=>child?.type==='button' && child.props.children==='Set Facebook profile link').props.onClick();
  let form=h.rerender().props.children.find(child=>child?.type==='form');
  form.props.children[0].props.children.find(child=>child?.type==='input').props.onChange({target:{value:'https://www.facebook.com/customer.chosen'}});
  form=h.rerender().props.children.find(child=>child?.type==='form');
  h.click();
  form.props.onSubmit({preventDefault(){}});
  h.answer(result);await tick();
  assert.equal(h.confirmed.length,0);
  assert.equal(h.windows.length,1);
  assert.equal([...h.cache.values()][0],'https://www.facebook.com/customer.chosen');
});
