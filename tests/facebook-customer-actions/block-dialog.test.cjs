const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const req=require('node:module').createRequire(path.resolve(__dirname,'../../package.json'));
const React=req('react'),{act}=React,{createRoot}=req('react-dom/client'),{JSDOM}=require('jsdom');
const {loader}=require('../tenh-seven/harness.cjs');
async function mount(t,options={}){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://app.tenhchat.com'});
 global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const requests=[],errors=[];let refreshes=0;const originalError=console.error;console.error=(...args)=>errors.push(args.map(String).join(' '));
 const load=loader({react:React,'react/jsx-runtime':req('react/jsx-runtime'),'react-dom':req('react-dom'),'lucide-react':req('lucide-react'),
  '@/lib/inbox/use-facebook-block':{FACEBOOK_BLOCK_CHANGED:'block-changed',useFacebookBlock:()=>({blocked:options.blocked||false,mode:options.mode||'messages',loaded:true,available:true,refresh:async()=>{refreshes++;}})}
 },{document:dom.window.document,window:dom.window,CustomEvent:dom.window.CustomEvent,fetch:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});if(options.fetch)return options.fetch();return new Response(JSON.stringify({success:true}));}});
 const {CustomerMessageBlock}=load('components/inbox/customer-message-block.tsx');const root=createRoot(document.getElementById('root'));
 const render=async(id='c1')=>act(async()=>root.render(React.createElement(CustomerMessageBlock,{key:id,conversation:{id,business_id:'b1',social_account:{id:'s1',platform:'facebook',account_name:'Melody Clothing'},contact:{id:'contact-'+id,full_name:'Customer '+id}}})));
 t.after(async()=>{try{await act(async()=>root.unmount());}finally{console.error=originalError;dom.window.close();}});
 await render();
 const button=(label,scope=document)=>[...scope.querySelectorAll('button')].find(x=>x.textContent===label);
 const click=async element=>{assert.ok(element,'click target exists');await act(async()=>element.click());};
 const dialog=()=>document.querySelector('[role="dialog"]');
 return {render,button,click,dialog,requests,errors,refreshes:()=>refreshes,dom};
}
test('Block opens two choices; Next requires a choice and Cancel never calls the API',async t=>{
 const ui=await mount(t);await ui.click(ui.button('Block user'));assert.ok(ui.dialog());assert.equal(document.querySelectorAll('input[type="radio"]').length,2);
 assert.equal(ui.button('Next').disabled,true);await ui.click(ui.button('Cancel'));assert.equal(ui.dialog(),null);assert.equal(ui.requests.length,0);assert.deepEqual(ui.errors,[]);
});
test('Page ban requires review, sends the selected mode once and refreshes after confirmation',async t=>{
 const ui=await mount(t);await ui.click(ui.button('Block user'));await ui.click(document.querySelector('input[value="page"]'));await ui.click(ui.button('Next'));
 assert.equal(ui.requests.length,0);assert.match(ui.dialog().textContent,/Ban Customer c1 from Melody Clothing/);
 await ui.click(ui.button('Ban user',ui.dialog()));assert.deepEqual(ui.requests,[{url:'/api/conversations/c1/facebook-block',body:{blocked:true,mode:'page'}}]);
 assert.equal(ui.dialog(),null);assert.equal(ui.refreshes(),1);assert.deepEqual(ui.errors,[]);
});
test('provider refusal stays in the dialog without reporting success',async t=>{
 const ui=await mount(t,{fetch:async()=>new Response(JSON.stringify({success:false,error:'Meta permission denied',providerCode:200}),{status:502})});
 await ui.click(ui.button('Block user'));await ui.click(document.querySelector('input[value="messages"]'));await ui.click(ui.button('Next'));await ui.click(ui.button('Block user',ui.dialog()));
 assert.match(ui.dialog().textContent,/Meta permission denied/);assert.equal(ui.refreshes(),0);assert.equal(ui.requests[0].body.mode,'messages');assert.deepEqual(ui.errors,[]);
});
test('unban confirmation restores Page and Messenger communication with the recorded mode',async t=>{
 const ui=await mount(t,{blocked:true,mode:'page'});await ui.click(ui.button('Remove user ban'));assert.match(ui.dialog().textContent,/Remove the Page ban and message block/);
 await ui.click(ui.button('Remove ban and unblock'));assert.deepEqual(ui.requests[0].body,{blocked:false,mode:'page'});assert.equal(ui.dialog(),null);
});
test('conversation switching removes the old dialog and keeps actions bound to the new customer',async t=>{
 const ui=await mount(t);await ui.click(ui.button('Block user'));await ui.render('c2');assert.equal(ui.dialog(),null);
 await ui.click(ui.button('Block user'));await ui.click(document.querySelector('input[value="messages"]'));await ui.click(ui.button('Next'));await ui.click(ui.button('Block user',ui.dialog()));
 assert.equal(ui.requests[0].url,'/api/conversations/c2/facebook-block');assert.deepEqual(ui.errors,[]);
});
test('Escape cancels and restores focus to the trigger',async t=>{
 const ui=await mount(t);const trigger=ui.button('Block user');trigger.focus();await ui.click(trigger);assert.equal(document.activeElement,ui.dialog());
 await act(async()=>ui.dialog().dispatchEvent(new ui.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.equal(ui.dialog(),null);assert.equal(document.activeElement,trigger);assert.equal(ui.requests.length,0);
});
test('double confirmation submits once and an in-flight request cannot be dismissed',async t=>{
 let finish;const ui=await mount(t,{fetch:()=>new Promise(resolve=>{finish=resolve;})});
 await ui.click(ui.button('Block user'));await ui.click(document.querySelector('input[value="messages"]'));await ui.click(ui.button('Next'));
 const confirm=ui.button('Block user',ui.dialog());await act(async()=>{confirm.click();confirm.click();});
 assert.equal(ui.requests.length,1);assert.equal(ui.button('Cancel').disabled,true);
 await act(async()=>ui.dialog().dispatchEvent(new ui.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.ok(ui.dialog());
 await act(async()=>finish(new Response(JSON.stringify({success:true}))));assert.equal(ui.dialog(),null);assert.deepEqual(ui.errors,[]);
});
