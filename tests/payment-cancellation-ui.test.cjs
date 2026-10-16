/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const {loader}=require('./tenh-seven/harness.cjs');
async function fixture(options={}){
  const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid'}),previous={};
  for(const key of ['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT']){
    previous[key]=global[key];global[key]=key==='IS_REACT_ACT_ENVIRONMENT'?true:dom.window[key];
  }
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const requests=[],results=[];let resolve,reject;
  const load=loader({react:React,'@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=>options.language??'en'}},
    {window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,fetch:(url,init)=>{
      requests.push({url,body:JSON.parse(init.body)});return new Promise((ok,fail)=>{resolve=ok;reject=fail;});
    }});
  const Button=load('components/subscription/cancel-payment-button.tsx').CancelPaymentButton,root=createRoot(dom.window.document.querySelector('#root'));
  await act(async()=>root.render(React.createElement(Button,{kind:options.kind??'payway',paymentId:'synthetic',businessId:'business',submitted:options.submitted,onResult:r=>results.push(r)})));
  const click=async label=>act(async()=>[...dom.window.document.querySelectorAll('button')].find(x=>x.textContent===label).click());
  return{dom,requests,results,click,
    confirm:()=>act(async()=>{const buttons=[...dom.window.document.querySelectorAll('dialog button')];buttons.at(-1).click();buttons.at(-1).click();}),
    finish:async(outcome='cancelled')=>act(async()=>resolve(Response.json({success:true,outcome}))),
    fail:async()=>act(async()=>reject(Error('timeout'))),
    close:async()=>{await act(async()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(previous)){if(value===undefined)delete global[key];else global[key]=value;}}
  };
}
test('opening, closing and reopening only confirms; repeated clicks submit once and pending dialog cannot dismiss',async()=>{
  const f=await fixture();try{
    await f.click('Cancel payment');await f.click('Cancel payment');
    assert.equal(f.dom.window.document.querySelectorAll('dialog').length,1);assert.equal(f.requests.length,0);
    await f.click('Keep payment');assert.equal(f.dom.window.document.querySelector('dialog'),null);
    assert.equal(f.dom.window.document.activeElement.textContent,'Cancel payment');
    await f.click('Cancel payment');await f.confirm();assert.equal(f.requests.length,1);
    assert.equal(f.requests[0].body.confirmed,true);assert.equal(f.requests[0].body.action,'cancel');
    assert.ok([...f.dom.window.document.querySelectorAll('dialog button')].every(x=>x.disabled));
    await f.finish();assert.deepEqual(f.results,['cancelled']);assert.equal(f.dom.window.document.querySelector('dialog'),null);
  }finally{await f.close();}
});
test('submitted manual proof has an explicit withdrawal; uncertain outcomes and failures stay actionable',async()=>{
  const f=await fixture({kind:'manual',submitted:true});try{
    await f.click('Withdraw proof');assert.match(f.dom.window.document.querySelector('dialog').textContent,/proof and payment records will be retained/);
    await f.confirm();assert.equal(f.requests[0].body.action,'withdraw');
    await f.fail();assert.ok(f.dom.window.document.querySelector('dialog [role="alert"]'));assert.equal(f.results.length,0);
    await f.click('Keep payment');await f.click('Withdraw proof');await f.confirm();await f.finish('withdrawn');
    assert.deepEqual(f.results,['withdrawn']);
  }finally{await f.close();}
});
test('Khmer cancellation includes transfer limitation and returns reconciliation instead of claiming cancellation',async()=>{
  const f=await fixture({kind:'bakong',language:'km'});try{
    await f.click('បោះបង់ការទូទាត់');assert.match(f.dom.window.document.querySelector('dialog').textContent,/QR/);
    await f.confirm();await f.finish('reconciliation_required');assert.deepEqual(f.results,['reconciliation_required']);
  }finally{await f.close();}
});
