const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const {loader,uuid}=require('./inbox-recovery-harness.cjs');
const business=uuid(900),other=uuid(901),channel=uuid(700),conversation=uuid(1);
const location={businessId:business,memberId:'member',accessibleBusinessIds:[business,other],query:'channel='+channel,
 selected:{id:conversation,businessId:business,channelId:channel}};

test('return URL has only bounded validated filters and an accessible matching thread',()=>{
 const {buildInboxReturnHref:build}=loader({}, {URLSearchParams})('components/dashboard/inbox-return-context.tsx');
 assert.equal(build(location),`/dashboard/inbox?channel=${channel}&conversation=${conversation}`);
 assert.equal(build({...location,query:'page='+channel+'&status=pending&view=comment&unsafe=payload&conversation=untrusted'}),`/dashboard/inbox?channel=${channel}&status=pending&view=comment&conversation=${conversation}`);
 assert.equal(build({...location,query:'workspace='+other}),`/dashboard/inbox?workspace=${other}`);
 assert.equal(build({...location,selected:{...location.selected,businessId:'revoked'}}),`/dashboard/inbox?channel=${channel}`);
 for(const query of ['channel=bad','workspace='+uuid(999),'view=admin','status=invalid','x'.repeat(2049)])assert.equal(build({...location,query}),null);
 assert.equal(build({...location,accessibleBusinessIds:Array(101).fill(business)}),null);
});

function installedNext(win,navigate){
 const source=fs.readFileSync(require.resolve('next/dist/client/app-dir/link'),'utf8'),ast=ts.createSourceFile('link.js',source,ts.ScriptTarget.Latest,true);
 const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&['isModifiedEvent','linkClicked'].includes(n.name?.text));assert.equal(functions.length,2);
 const ctx={window:win,_react:{default:React},_islocalurl:{isLocalURL:h=>h.startsWith('/dashboard/')},
  _routerreducertypes:require('next/dist/client/components/router-reducer/router-reducer-types'),require:name=>{assert.equal(name,'../components/app-router-instance');return{dispatchNavigateAction:navigate}}};
 vm.createContext(ctx);vm.runInContext(functions.map(n=>n.getText(ast)).join('\n')+'\nglobalThis.click=linkClicked;',ctx);return ctx.click;
}

test('real React dashboard lifetime restores Inbox through installed Next navigation and isolates identity/reset/deep links',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/dashboard/inbox?channel='+channel}),old={};
 for(const[k,v]of Object.entries({window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true})){old[k]=global[k];global[k]=v;}
 const root=createRoot(dom.window.document.getElementById('root')),win=dom.window;let selected=location.selected,identity={userId:'user-a',businessId:business,memberId:'member'},mounted=true,explicitHref='/dashboard/inbox',navCount=0,restores=0,routeUrl=new URL(win.location.href);
 const routerAst=ts.createSourceFile('app-router.js',fs.readFileSync(require.resolve('next/dist/client/components/app-router'),'utf8'),ts.ScriptTarget.Latest,true);let copy,push;
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='copyNextJsInternalHistoryState')copy=n.getText(routerAst);if(ts.isBinaryExpression(n)&&n.left.getText(routerAst)==='window.history.pushState'&&ts.isFunctionExpression(n.right))push=n.right.getText(routerAst);ts.forEachChild(n,visit);}visit(routerAst);assert.ok(copy&&push);
 const historyContext={window:win,originalPushState:win.history.pushState.bind(win.history),applyUrlFromHistoryPushReplace:url=>{restores++;routeUrl=new URL(url,win.location.href)}};
 vm.createContext(historyContext);vm.runInContext(copy+'\nwindow.history.pushState='+push,historyContext);
 const click=installedNext(win,href=>{navCount++;win.history.pushState(null,'',href);render();});
 const Link=props=>React.createElement('a',{href:props.href,'data-prefetch':String(props.prefetch),onClick:e=>click(e,props.href,{current:null},false,undefined,props.onNavigate)},props.children);
 const load=loader({'next/navigation':{usePathname:()=>routeUrl.pathname},'next/link':{__esModule:true,default:Link,useLinkStatus:()=>({pending:false})}}, {window:win,URLSearchParams});
 const api=load('components/dashboard/inbox-return-context.tsx'),Nav=load('components/dashboard/dashboard-nav-link.tsx').DashboardNavLink;
 function Inbox(){api.useRememberInboxReturn({...location,businessId:identity.businessId,memberId:identity.memberId,query:routeUrl.search,selected});return React.createElement('div',{id:'inbox'});}
 function App(){if(!mounted)return null;return React.createElement(api.InboxReturnContextProvider,{...identity,key:JSON.stringify(identity)},React.createElement(Nav,{href:explicitHref},'Inbox'),routeUrl.pathname==='/dashboard/inbox'?React.createElement(Inbox):React.createElement('div',{id:'analytics'}));}
 function render(){root.render(React.createElement(App));}
 const href=()=>win.document.querySelector('a').getAttribute('href');
 const go=async path=>{await act(async()=>{win.history.pushState(null,'',path);render();});};
 try{
  await act(async()=>render());assert.equal(href(),'/dashboard/inbox');
  await go('/dashboard/analytics');assert.equal(href(),`/dashboard/inbox?channel=${channel}&conversation=${conversation}`);assert.equal(win.document.querySelector('a').getAttribute('data-prefetch'),'false');
  await act(async()=>win.document.querySelector('a').dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true})));
  assert.equal(navCount,1);assert.equal(win.location.search,`?channel=${channel}&conversation=${conversation}`);assert.ok(win.document.querySelector('#inbox'));assert.equal(href(),'/dashboard/inbox');
  await act(async()=>win.document.querySelector('a').dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true})));
  assert.equal(navCount,1,'active Inbox does not navigate');assert.equal(win.location.search,`?channel=${channel}&conversation=${conversation}`,'active click preserves filters and selection');
  await go('/dashboard/analytics');explicitHref='/dashboard/inbox?conversation='+uuid(99);await act(async()=>render());assert.equal(href(),explicitHref,'explicit deep link wins over remembered context');explicitHref='/dashboard/inbox';
  await act(async()=>{win.dispatchEvent(new win.Event('tenh:workspace-data-changed'));render();});assert.equal(href(),'/dashboard/inbox');
  await go('/dashboard/inbox?channel='+channel);await go('/dashboard/analytics');assert.ok(href().includes('conversation='));
  identity={...identity,userId:'user-b'};await act(async()=>render());assert.equal(href(),'/dashboard/inbox','new identity gets no previous URL');
  await go('/dashboard/inbox?channel='+channel);await go('/dashboard/analytics');mounted=false;await act(async()=>render());mounted=true;await act(async()=>render());assert.equal(href(),'/dashboard/inbox','unmount/new login or document reset loses snapshot');
  selected=null;await go('/dashboard/inbox');await go('/dashboard/analytics');assert.equal(href(),'/dashboard/inbox','explicit bare Inbox reset becomes the latest context');
  assert.ok(restores>0,'installed Next history wrapper synchronizes route state');
 }finally{await act(async()=>root.unmount());win.close();for(const[k,v]of Object.entries(old)){if(v===undefined)delete global[k];else global[k]=v;}}
});

test('restored destination server rejects revoked selection and independently reads fresh accessible messages',async()=>{
 const calls=[],scope={currentBusinessId:business,currentMemberId:'member',accessibleBusinessIds:[business]};let revoked=false,signedOut=false;
 const row={id:conversation,business_id:business,social_account:{id:channel},status:'open'};
 const load=loader({'@/lib/inbox/get-conversations':{preloadInboxConversationChannels:async()=>{},getInboxConversationScope:async()=>{if(signedOut)throw Error('sign in');return scope},getConversations:async(ids,filter)=>{calls.push(['selected',ids,filter]);return revoked||!ids.includes(row.business_id)?[]:[row]}},
  '@/lib/inbox/get-conversation-page':{ConversationPagingUnavailable:class extends Error{},getConversationPage:async request=>{calls.push(['page',request]);return{conversations:[],counts:{statusCounts:{}},total:0,hasMore:false,cursor:null}}},
  '@/lib/inbox/get-team-members':{getTeamMembers:async()=>[]},'@/lib/inbox/get-messages':{getMessages:async id=>{calls.push(['messages',id]);return[{id:'fresh'}]}},
  '@/components/inbox/inbox-view':{InboxView:'view'}},{URLSearchParams});
 const page=load('app/dashboard/inbox/page.tsx').default;
 const props={searchParams:Promise.resolve({channel,conversation})};
 let tree=await page(props),view=tree.props.children.props.children;assert.equal(view.props.activeConversationId,conversation);assert.equal(view.props.messages[0].id,'fresh');assert.equal(calls.filter(c=>c[0]==='messages').length,1);
 calls.length=0;revoked=true;tree=await page(props);view=tree.props.children.props.children;assert.equal(view.props.activeConversationId,null);assert.equal(view.props.messages.length,0);assert.equal(calls.filter(c=>c[0]==='messages').length,0);
 assert.deepEqual(calls.find(c=>c[0]==='selected')[1],[business]);assert.equal(calls.find(c=>c[0]==='selected')[2].channelId,channel);
 calls.length=0;revoked=false;scope.accessibleBusinessIds=[];tree=await page(props);view=tree.props.children.props.children;assert.equal(view.props.activeConversationId,null);assert.equal(calls.filter(c=>c[0]==='messages').length,0);
 calls.length=0;signedOut=true;await assert.rejects(page(props),/sign in/);assert.equal(calls.length,0);
});
