const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { loader } = require('./tenh-seven/harness.cjs');

async function fixture(compact = true, standalone = false) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/dashboard/inbox' });
  const saved = {};
  for (const [name,value] of Object.entries({ window:dom.window, document:dom.window.document, IS_REACT_ACT_ENVIRONMENT:true })) { saved[name]=global[name]; global[name]=value; }
  dom.window.matchMedia = query => ({ matches:query.includes('display-mode')?standalone:compact, addEventListener(){}, removeEventListener(){} });
  const root = createRoot(dom.window.document.querySelector('#root'));
  const load = loader({ react:React, '@/components/display/workspace-language-text':{ useWorkspaceLanguageId:()=> 'en' } }, { window:dom.window, document:dom.window.document, navigator:dom.window.navigator, MouseEvent:dom.window.MouseEvent });
  return { dom, root, load, close:async()=> { await act(async()=>root.unmount()); dom.window.close(); for (const [name,value] of Object.entries(saved)) { if(value===undefined) delete global[name]; else global[name]=value; } } };
}

test('compact browser Back clears the chat; Forward selects it; desktop keeps its existing selection', async()=> {
  for (const compact of [true,false]) {
    const f = await fixture(compact); const { useUrlConversationSelection }=f.load('lib/inbox/use-url-conversation-selection.ts');
    let selected='A', requested='A', renders, clears=0; const own={current:[]};
    const clear=()=>{selected=null;clears++;};
    function View(){useUrlConversationSelection({requestedConversationId:requested,selectedConversationId:selected,isAvailable:()=>true,select:id=>selected=id,ownPushesRef:own,clearOnEmptyUrl:compact?clear:undefined});return null;}
    renders=async()=>act(async()=>f.root.render(React.createElement(View)));
    try {
      f.dom.window.history.replaceState(null,'','?conversation=A'); await renders();
      own.current.push('B','C'); f.dom.window.history.replaceState(null,'','/dashboard/inbox?view=pinned');
      await act(async()=>f.dom.window.dispatchEvent(new f.dom.window.PopStateEvent('popstate')));
      requested=null; await renders(); assert.equal(selected,compact?null:'A');
      if(compact) {assert.equal(own.current.length,0);assert.ok(clears>0);}
      requested='B'; f.dom.window.history.replaceState(null,'','?conversation=B');
      await act(async()=>f.dom.window.dispatchEvent(new f.dom.window.PopStateEvent('popstate'))); await renders();
      assert.equal(selected,compact?'B':'A');
      const previousClears=clears;requested=null;f.dom.window.history.replaceState(null,'','/dashboard/analytics');await act(async()=>f.dom.window.dispatchEvent(new f.dom.window.PopStateEvent('popstate')));await renders();assert.equal(clears,previousClears);assert.equal(f.dom.window.location.pathname,'/dashboard/analytics');
    } finally {await f.close();}
  }
});

test('compact selection reveals only the actual comment/message actions; scrolling cancels long press',async()=>{
  const f=await fixture(); const { InboxWebShell }=f.load('components/inbox/inbox-web-shell.tsx');
  try {
    await act(async()=>f.root.render(React.createElement(InboxWebShell,{active:true},React.createElement('div',{'data-message-row':'',id:'parent'},React.createElement('span',{id:'text'},'Customer text'),React.createElement('div',{'data-comment-actions':'',id:'parent-actions'},'Reply'),React.createElement('div',{'data-message-row':'',id:'child'},React.createElement('span',{id:'child-text'},'Nested comment'),React.createElement('div',{'data-comment-actions':'',id:'child-actions'},'Like'))))));
    const d=f.dom.window.document, click=id=>d.getElementById(id).dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true}));
    click('text'); assert.ok(d.getElementById('parent-actions').hasAttribute('data-message-actions-visible')); assert.ok(!d.getElementById('child-actions').hasAttribute('data-message-actions-visible'));
    click('child-text'); assert.ok(!d.getElementById('parent-actions').hasAttribute('data-message-actions-visible')); assert.ok(d.getElementById('child-actions').hasAttribute('data-message-actions-visible'));
    d.getElementById('child').dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.querySelectorAll('[data-message-actions-visible]').length,0);
    const event=new f.dom.window.MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10});Object.defineProperty(event,'isPrimary',{value:true});d.getElementById('text').dispatchEvent(event);
    d.getElementById('parent').dispatchEvent(new f.dom.window.Event('scroll',{bubbles:false})); await new Promise(r=>setTimeout(r,480));assert.equal(d.querySelectorAll('[data-message-actions-visible]').length,0);
    assert.equal(d.querySelector('[data-inbox-shell]').dataset.standalone,'false');
  } finally {await f.close();}
});

test('desktop shell installs no compact selection or viewport overrides',async()=>{
  const f=await fixture(false);const { InboxWebShell }=f.load('components/inbox/inbox-web-shell.tsx');
  try {await act(async()=>f.root.render(React.createElement(InboxWebShell,{active:true},React.createElement('div',{'data-message-row':''},'Message'))));f.dom.window.document.querySelector('[data-message-row]').click();assert.equal(f.dom.window.document.querySelectorAll('[data-message-selected]').length,0);assert.equal(f.dom.window.document.documentElement.style.getPropertyValue('--tenh-inbox-height'),'');}finally{await f.close();}
});

test('standalone zoom constraint excludes the media viewer and ordinary browser tabs',async()=>{
  for(const standalone of [true,false]){
    const f=await fixture(true,standalone);const {InboxWebShell}=f.load('components/inbox/inbox-web-shell.tsx');
    try {
      await act(async()=>f.root.render(React.createElement(InboxWebShell,{active:true},React.createElement('div',{id:'chat'},'Chat'),React.createElement('div',{'data-media-viewer':'',id:'media'},'Photo'))));
      const event=id=>{const gesture=new f.dom.window.Event('gesturestart',{bubbles:true,cancelable:true});f.dom.window.document.getElementById(id).dispatchEvent(gesture);return gesture.defaultPrevented;};
      assert.equal(event('chat'),standalone);assert.equal(event('media'),false);
    } finally {await f.close();}
  }
});

test('long press selects a photo without opening it; a later normal tap still opens it',async()=>{
  const f=await fixture();const {InboxWebShell}=f.load('components/inbox/inbox-web-shell.tsx');let opens=0,targets=0;
  try {
    await act(async()=>f.root.render(React.createElement(InboxWebShell,{active:true},React.createElement('div',{'data-message-row':''},React.createElement('button',{id:'photo',onClick:()=>opens++,onContextMenuCapture:()=>targets++},'Photo'),React.createElement('div',{'data-message-action-toolbar':''},'Reply')))));
    const photo=f.dom.window.document.querySelector('#photo'),down=()=>{const e=new f.dom.window.MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10});Object.defineProperty(e,'isPrimary',{value:true});photo.dispatchEvent(e);};
    down();await new Promise(r=>setTimeout(r,480));photo.dispatchEvent(new f.dom.window.Event('pointerup',{bubbles:true}));photo.click();assert.equal(opens,0);assert.equal(targets,1);assert.equal(f.dom.window.document.querySelectorAll('[data-message-actions-visible]').length,1);
    down();photo.dispatchEvent(new f.dom.window.Event('pointerup',{bubbles:true}));photo.click();assert.equal(opens,1);
    down();await act(async()=>f.root.render(React.createElement(InboxWebShell,{active:true},React.createElement('button',{id:'next',onClick:()=>opens++},'Another chat'))));await new Promise(r=>setTimeout(r,480));f.dom.window.document.querySelector('#next').click();assert.equal(opens,2,'retired long press does not swallow another chat keyboard click');
  } finally {await f.close();}
});

test('existing pending/error keepVisible state remains explicit on the contextual toolbar',async()=>{
  const f=await fixture();const {MessageActionToolbar}=f.load('components/inbox/message-action-toolbar.tsx');
  try {await act(async()=>f.root.render(React.createElement(MessageActionToolbar,{outgoing:false,actions:{reply:true,pin:false,edit:false,delete:false},replying:false,pinned:false,keepVisible:true,onReply(){},onPin(){},onEdit(){},onDelete(){}})));assert.equal(f.dom.window.document.querySelector('[data-message-action-toolbar]').dataset.messageActionPersistent,'true');}finally{await f.close();}
});

test('manifest keeps login, internal callbacks and Inbox in scope, without a private-response cache',()=>{
  const manifest=loader()('app/manifest.ts').default();assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'/');assert.equal(manifest.start_url,'/dashboard/inbox');assert.equal(manifest.icons.length,3);const fs=require('fs');for(const icon of manifest.icons)assert.ok(fs.existsSync('public'+icon.src));
});
