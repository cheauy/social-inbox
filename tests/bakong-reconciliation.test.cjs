/* eslint-disable @typescript-eslint/no-require-imports */
// Real React + mocked status data; no provider, login or hosted requests.
const test=require('node:test'), assert=require('node:assert/strict');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const {JSDOM}=require('jsdom'),{loader}=require('./tenh-seven/harness.cjs');
test('admin disables exhausted inquiries while retaining safe verified-application retries',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid'}), previous={};
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){
    previous[key]=global[key]; global[key]=value;
  }
  const requests=[],items=[
    {id:'exhausted',workspaceName:'Unresolved workspace',amount:'9.99',currency:'USD',environment:'production',state:'pending',reference:'SYNTHETIC',reason:'INQUIRY_LIMIT_REVIEW',canCheck:false,inquiriesRemaining:0,reconciliationRequired:true},
    {id:'verified',workspaceName:'Verified workspace',amount:'9.99',currency:'USD',environment:'production',state:'verified',reference:'SYNTHETIC2',reason:null,canCheck:true,inquiriesRemaining:0,reconciliationRequired:false},
  ];
  const load=loader({react:React,'@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=> 'en'}},
    {fetch:async(url,init={})=>{requests.push({url,method:init.method??'GET'});return Response.json({success:true,items,nextCursor:null});},AbortController});
  const Component=load('components/billing/bakong-reconciliation-panel.tsx').BakongReconciliationPanel;
  const root=createRoot(dom.window.document.querySelector('#root'));
  try{
    await act(async()=>root.render(React.createElement(Component)));
    const buttons=[...dom.window.document.querySelectorAll('li button')];
    assert.equal(buttons[0].disabled,true); assert.equal(buttons[1].disabled,false);
    assert.match(dom.window.document.body.textContent,/Do not ask the customer to pay again/);
    await act(async()=>buttons[0].click()); assert.equal(requests.filter(r=>r.method==='POST').length,0);
    await act(async()=>buttons[1].click()); assert.equal(requests.filter(r=>r.method==='POST').length,1);
  }finally{
    await act(async()=>root.unmount()); dom.window.close();
    for(const key of Object.keys(previous)){if(previous[key]===undefined)delete global[key];else global[key]=previous[key];}
  }
});
