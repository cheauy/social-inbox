const test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const {JSDOM}=require('jsdom'),{loader}=require('./tenh-seven/harness.cjs');

async function fixture(){
  const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/dashboard/inbox'}),saved={};
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){saved[key]=global[key];global[key]=value;}
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  dom.window.HTMLDialogElement.prototype.close=function(){if(!this.open)return;this.removeAttribute('open');this.dispatchEvent(new dom.window.Event('close'));};
  let pathname='/dashboard/inbox',compact=true,mounts=0;
  const h=React.createElement,root=createRoot(dom.window.document.querySelector('#root'));
  const Label=({label})=>label,Link=({href,children,...props})=>h('a',{href,...props},children);
  const load=loader({react:React,'next/link':Link,'next/navigation':{usePathname:()=>pathname},
    '@/lib/inbox/use-compact-web':{useCompactInboxWeb:()=>compact},
    '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=> 'en'},
    './dashboard-nav-link':{DashboardNavLink:Link},'./dashboard-navigation-label':{DashboardNavigationLabel:Label},
  },{window:dom.window,document:dom.window.document});
  const {DashboardMobileMenu}=load('components/dashboard/dashboard-mobile-menu.tsx');
  function Notifications(){React.useEffect(()=>{mounts++;},[]);return h('button',{'data-test-notifications':''},'Notifications');}
  const render=()=>act(async()=>root.render(h(DashboardMobileMenu,{notifications:h(Notifications)},['subscription','integrations','settings'].map(page=>h(Link,{href:'/dashboard/'+page,key:page},page)))));
  const click=selector=>act(async()=>dom.window.document.querySelector(selector).click());
  return{dom,root,load,render,click,mounts:()=>mounts,path:value=>{pathname=value;},compact:value=>{compact=value;},close:async()=>{await act(async()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(saved)){if(value===undefined)delete global[key];else global[key]=value;}}};
}

test('More uses existing destinations and restores focus after close and outside tap',async()=>{
  const f=await fixture();try{
    await f.render();const d=f.dom.window.document;
    assert.equal(d.querySelector('[data-dashboard-bottom-nav]').children.length,4);
    assert.deepEqual([...d.querySelectorAll('[data-dashboard-more-drawer] a')].map(a=>a.pathname),['/dashboard/subscription','/dashboard/integrations','/dashboard/settings']);
    await f.click('[data-more-trigger]');assert(d.querySelector('dialog').open);assert.equal(d.activeElement.getAttribute('aria-label'),'Close More');
    const links=d.querySelectorAll('dialog a');links[links.length-1].focus();
    await act(async()=>d.activeElement.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
    assert.equal(d.activeElement.getAttribute('aria-label'),'Close More');
    await act(async()=>d.activeElement.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));
    assert.equal(d.activeElement,links[links.length-1]);
    await f.click('[aria-label="Close More"]');assert(!d.querySelector('dialog').open);assert.equal(d.activeElement,d.querySelector('[data-more-trigger]'));
    await f.click('[data-more-trigger]');await act(async()=>d.querySelector('dialog').dispatchEvent(new f.dom.window.MouseEvent('click',{bubbles:true,clientX:1000,clientY:1000})));
    assert(!d.querySelector('dialog').open);assert.equal(d.activeElement,d.querySelector('[data-more-trigger]'));
    await f.click('[data-more-trigger]');await act(async()=>d.activeElement.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    assert(!d.querySelector('dialog').open);assert.equal(d.activeElement,d.querySelector('[data-more-trigger]'));
  }finally{await f.close();}
});

test('route and desktop transitions close More while retaining one notification owner',async()=>{
  const f=await fixture();try{
    await f.render();await f.click('[data-more-trigger]');f.path('/dashboard/settings/security');await f.render();assert(!f.dom.window.document.querySelector('dialog').open);
    assert.equal(f.dom.window.document.querySelector('[data-more-trigger]').getAttribute('aria-current'),'page');
    await f.click('[data-more-trigger]');f.compact(false);await f.render();assert(!f.dom.window.document.querySelector('dialog').open);assert.equal(f.mounts(),1);
    await f.click('[data-more-trigger]');await act(async()=>f.dom.window.dispatchEvent(new f.dom.window.PopStateEvent('popstate')));assert(!f.dom.window.document.querySelector('dialog').open);
  }finally{await f.close();}
});

test('Admin is offered inside Settings only for the existing authorized identity',async()=>{
  const f=await fixture();try{
    f.path('/dashboard/settings/general');
    const {DashboardUtilityNavigation,DashboardUtilityNavigationProvider}=f.load('components/dashboard/dashboard-utility-navigation.tsx');
    const render=allowed=>act(async()=>f.root.render(React.createElement(DashboardUtilityNavigationProvider,{isAdmin:allowed},React.createElement(DashboardUtilityNavigation,{placement:'settings'}))));
    await render(false);assert.equal(f.dom.window.document.querySelector('a[href="/dashboard/admin"]'),null);
    await render(true);assert(f.dom.window.document.querySelector('[data-compact-settings-admin] a[href="/dashboard/admin"]'));
  }finally{await f.close();}
});
