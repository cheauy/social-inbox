const React=require('react'),{createRoot}=require('react-dom/client');
const {FacebookConversationActionProvider,CompanionFacebookAction}=require('../../components/inbox/companion-facebook-action.tsx');
const {TenhBotComingSoon}=require('../../components/bot/tenh-bot-coming-soon.tsx');
const Integrations=require('../../app/dashboard/integrations/layout.tsx').default,Subscription=require('../../app/dashboard/subscription/layout.tsx').default;
const props={businessId:'b1',conversationId:'c1',pageId:'12345',threadId:'98765',navigationOnly:true};
const root=createRoot(document.getElementById('root')),checks=[],calls=[],popups=[];let release,mode='exact';
const link='https://business.facebook.com/latest/inbox/all?asset_id=12345&selected_item_id=54321&thread_type=FB_MESSAGE';
window.open=()=>{const p={closed:false,opener:{},document:document.implementation.createHTMLDocument(),location:{href:'about:blank',replace(value){this.href=value}},close(){this.closed=true}};popups.push(p);return p};
window.fetch=(url,options)=>{calls.push({url,options});return new Promise(r=>release=()=>r(new Response(JSON.stringify({success:true,...props,recipientId:props.threadId,navigationAvailable:mode==='exact',linkSource:'meta_conversations_api',conversationLink:mode==='exact'?link:null,pageInboxUrl:'https://business.facebook.com/latest/inbox/all?asset_id=12345'}))))};
const pause=()=>new Promise(r=>setTimeout(r,80)),check=(name,value)=>{if(!value)throw Error(name);checks.push(name)};
const renderActions=()=>root.render(React.createElement(FacebookConversationActionProvider,props,React.createElement('header',{'data-header':true},React.createElement(CompanionFacebookAction,{...props,compact:true})),React.createElement('aside',{'data-other':true},React.createElement('h2',null,'Other'),React.createElement(CompanionFacebookAction,{...props,menu:true}))));
(async()=>{try{
  for(const [name,Component,selector] of [['Bot',TenhBotComingSoon,'[data-tenh-bot-coming-soon]'],['Integrations',Integrations,'[data-integrations-panel]'],['Subscription',Subscription,'[data-subscription-panel]']]){
    root.render(React.createElement('div',{style:{height:'100vh'}},React.createElement(Component,null,React.createElement('div',{style:{height:1600}},'Panel content'))));await pause();
    const panel=document.querySelector(selector),box=panel.getBoundingClientRect(),style=getComputedStyle(panel),spacing=innerWidth>=640?10:6;
    check(name+' matches Inbox outer spacing',box.left===spacing&&box.top===spacing&&Math.abs(box.right-(innerWidth-spacing))<1&&Math.abs(box.bottom-(innerHeight-spacing))<1);
    check(name+' matches Inbox 16px radius, light border and subtle shadow',style.borderTopLeftRadius==='16px'&&style.borderTopWidth==='1px'&&style.boxShadow!=='none');
    check(name+' has no horizontal overflow',document.documentElement.scrollWidth<=innerWidth);
    if(name==='Bot')check('Coming Soon contains no configuration controls',panel.textContent.includes('Coming soon')&&!panel.querySelector('input,select,button'));
    else {panel.scrollTop=100;check(name+' content scrolls inside its shell',panel.scrollTop===100)}
  }
  renderActions();await pause();const header=()=>document.querySelector('[data-header] button'),other=()=>document.querySelector('[data-other] button');
  check('no provider lookup on render',calls.length===0);
  check('desktop header label is visible and mobile remains accessible',(getComputedStyle(header().querySelector('span')).display!=='none')===(innerWidth>=1024)&&header().getAttribute('aria-label')==='View conversation');
  check('Other exposes View conversation',other().textContent==='View conversation');
  header().click();await pause();check('both entrypoints share pending state',header().disabled&&other().disabled);other().click();check('one authorized navigation lookup',calls.length===1&&new URL(calls[0].url,'https://fixture.test').searchParams.get('lookup')==='navigation');release();await pause();check('header navigates only verified provider link',popups[0].location.href===link&&popups[0].opener===null);
  other().click();await pause();release();await pause();check('Other also opens verified conversation',calls.length===2&&popups[1].location.href===link);
  mode='missing';other().click();await pause();release();await pause();check('fallback closes loading tab and never guesses a conversation',popups[2].closed&&popups[2].location.href==='about:blank');check('both entrypoints show honest Page inbox fallback',document.querySelectorAll('a').length===2&&[...document.querySelectorAll('a')].every(a=>a.textContent==='Open Page inbox'));
  header().click();await pause();const oldRelease=release;props.conversationId='c2';props.threadId='77777';renderActions();await pause();check('switch aborts shared lookup',calls.at(-1).options.signal.aborted&&popups[3].closed);oldRelease();await pause();check('late response does not navigate old chat',popups[3].location.href==='about:blank'&&!document.querySelector('[role=alert]'));
  document.getElementById('result').textContent=JSON.stringify({passed:true,checks,width:innerWidth});
}catch(error){document.getElementById('result').textContent=JSON.stringify({passed:false,error:error.message,checks,width:innerWidth})}})();
