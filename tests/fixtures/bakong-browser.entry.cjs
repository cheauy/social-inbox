/* eslint-disable @typescript-eslint/no-require-imports */
const React = require('react'), { createRoot } = require('react-dom/client'), { flushSync } = require('react-dom');
const { SubscriptionPaymentView } = require('../../components/subscription/subscription-payment-view.tsx');
const { PaymentAttemptView } = require('../../components/subscription/payment-attempt-view.tsx');
const h = React.createElement, root = createRoot(document.getElementById('root'));
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
const params = new URLSearchParams(location.search);
const demoMode = process.env.TENH_TEST_BAKONG_DEMO === 'true';
window.fixtureLanguage = params.get('lang') || sessionStorage.getItem('bakong-language') || 'en';
sessionStorage.setItem('bakong-language',window.fixtureLanguage);
const t = (en,km) => window.fixtureLanguage === 'km' ? km : en;
const checks = [], requests = [], navigations = [], listeners = new Set();
let records = new Map(JSON.parse(sessionStorage.getItem('bakong-records') || '[]')), generation = 0, providerChecks = 0, sequence = 200;
for (const id of records.keys()) sequence = Math.max(sequence,Number(id.slice(-12)));
let pendingOnly = false, denied = false, delayA = false, releaseA = null, loseStart = true;
const nativeTimeout = window.setTimeout.bind(window), nativeClear = window.clearTimeout.bind(window), nativeInterval = window.setInterval.bind(window);
const nativePerformance = performance.now.bind(performance);
let offset = 0, timerId = 1000000000;
const longTimers = new Map(), pollDelays = [];
Object.defineProperty(performance,'now',{configurable:true,value:()=>nativePerformance()+offset});
const now = () => Date.now()+offset;
window.setTimeout = (callback,delay,...args) => {
  if (!demoMode && delay >= 300000) { const id = ++timerId; pollDelays.push(delay); longTimers.set(id,{at:now()+delay,callback:()=>callback(...args)}); return id; }
  return nativeTimeout(callback,delay >= 3000 && delay <= 30000 ? 120 : delay,...args);
};
window.clearTimeout = id => { if (!longTimers.delete(id)) nativeClear(id); };
window.setInterval = (callback,delay,...args) => nativeInterval(callback,!demoMode&&delay===1000?20:delay,...args);
const pause = ms => new Promise(resolve=>nativeTimeout(resolve,ms));
const copy = value => JSON.parse(JSON.stringify(value));
function save() { sessionStorage.setItem('bakong-records',JSON.stringify([...records])); }
function check(name,value) { checks.push({name,passed:Boolean(value)}); if (!value) throw Error(name); }
async function until(predicate,label) { for(let i=0;i<160;i++){if(predicate())return;await pause(25);}throw Error('Timed out '+label+': '+document.body.innerText.slice(0,600)); }
const buttons = () => [...document.querySelectorAll('button')];
const button = (en,km) => buttons().find(node=>node.textContent.trim().startsWith(t(en,km)));
function mount(Component,props) { flushSync(()=>root.render(h(React.StrictMode,null,h('main',{className:'min-h-dvh bg-slate-50'},h(Component,{...props,key:++generation}))))); }
const status = record => mount(PaymentAttemptView,{kind:'bakong',attemptId:record.id,businessId:record.businessId});
const checkout = () => mount(SubscriptionPaymentView,{planCode:'mini',billingCycle:'monthly',purchaseBusinessId:A});
function saved(businessId=A,state='pending',environment='sandbox') {
  const id = `00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
  const value = {id,businessId,userId:'fixture-user',memberId:'fixture-member',workspaceName:businessId===A?'Fixture workspace A':'Fixture workspace B',
    planCode:'mini',billingCycle:'monthly',amount:'13.00',currency:'USD',reference:'TC-SYNTHETIC-UI',transactionReference:null,
    environment,state,application:'none',qrImage:process.env.TENH_TEST_BAKONG_QR_IMAGE,expiresAt:new Date(now()+900000).toISOString(),
    serverTime:new Date(now()).toISOString(),nextCheckAt:new Date(now()).toISOString(),invoiceId:null,canCheck:true,automaticChecksRemaining:3};
  records.set(id,value);save();return value;
}
window.fixtureRouter = { replace(url) {
  navigations.push(url); const target=new URL(url,location.href);target.searchParams.set('lang',window.fixtureLanguage);
  history.replaceState(null,'','/fixture.html?'+target.searchParams.toString());
} };
window.TenhAbaPaywayBridge = {isReady:()=>true,checkout:()=>{throw Error('No external payment may start');}};
window.fixtureSupabase = {auth:{onAuthStateChange(callback){listeners.add(callback);return{data:{subscription:{unsubscribe(){listeners.delete(callback);}}}};}}};
window.fetch = async (url,options={}) => {
  const target=new URL(url,location.href),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
  const record={path:target.pathname,method,body,mocked:true};requests.push(record);
  options.signal?.addEventListener('abort',()=>{record.aborted=true;});
  if(target.origin!==location.origin)throw Error('External network forbidden');
  if(target.pathname==='/api/bakong/checkout') {
    const businessId=body?.businessId||target.searchParams.get('purchase_business');
    let existing=[...records.values()].find(item=>item.businessId===businessId&&['pending','verified','review'].includes(item.state));
    if(method==='POST') {existing ||= saved(businessId);existing.purchaseIntent=body.purchaseIntent;save();if(loseStart){loseStart=false;throw new TypeError('Synthetic committed response lost');}return Response.json({success:true,attemptId:existing.id,businessId,userId:'fixture-user',memberId:'fixture-member'});}
    const resume=[...records.values()].find(item=>item.businessId===businessId&&item.purchaseIntent===target.searchParams.get('purchase_intent'));
    return Response.json({success:true,enabled:true,environment:'sandbox',pendingAttemptId:existing?.id??null,resumeAttemptId:resume?.id??null,businessId,userId:'fixture-user',memberId:'fixture-member'});
  }
  if(target.pathname.startsWith('/api/bakong/payments/')) {
    const item=records.get(target.pathname.split('/').at(-1));
    if(!item||denied)return Response.json({success:false},{status:denied?403:404});
    if(method==='POST') {
      if(item.state==='verified') {item.state='applied';item.application='active';item.canCheck=false;}
      else {providerChecks++;item.automaticChecksRemaining=Math.max(0,item.automaticChecksRemaining-1);if(!pendingOnly){item.state=item.environment==='sandbox'?'test_paid':'verified';item.qrImage=null;item.canCheck=item.state==='verified';}}
      item.nextCheckAt=new Date(now()+300000).toISOString();save();
    }
    const value={...copy(item),serverTime:new Date(now()).toISOString()};
    if(delayA&&item.businessId===A&&method==='GET')await new Promise(resolve=>{releaseA=resolve;});
    return Response.json({success:true,attempt:value});
  }
  if(target.pathname==='/api/manual-payments')return Response.json({success:true,businessId:target.searchParams.get('purchase_business')||A,memberId:'fixture-member',request:null,preparedAttempt:null,config:{enabled:true,bankName:'Fixture Bank',accountName:'TENH Fixture',accountNumber:'SYNTHETIC',qrImageUrl:null}});
  if(target.pathname==='/api/workspaces/switch')return Response.json({success:false},{status:503});
  throw Error('Unexpected mocked request '+target.pathname);
};
async function checkoutChecks(prepare = true) {
  records.clear();save();checkout();
  await until(()=>buttons().some(node=>node.textContent.includes('Bakong KHQR')),'method cards');
  check('three distinct compact methods remain present',document.body.textContent.includes('ABA KHQR')&&document.body.textContent.includes('Bakong KHQR')&&Boolean(button('Manual bank transfer','ផ្ទេរប្រាក់តាមធនាគារដោយដៃ')));
  button('Bakong KHQR','Bakong KHQR').click();await pause(30);
  check('method selection makes no financial mutation',!requests.some(item=>item.method==='POST'));
  buttons().find(node=>node.querySelector('p')?.textContent==='ABA KHQR').click();button('Bakong KHQR','Bakong KHQR').click();await pause(30);
  if(!prepare)return;
  const show=button('Show QR','បង្ហាញ QR');show.click();show.click();
  await until(()=>document.querySelector('figure img')&&document.body.textContent.includes('USD 13.00'),'saved QR status');
  check('double click prepares one purchase',requests.filter(item=>item.path==='/api/bakong/checkout'&&item.method==='POST').length===1);
  check('checkout is left and attempt/workspace are preserved in the URL',location.search.includes('bakong_attempt=')&&location.search.includes('purchase_business=')&&!button('Show QR','បង្ហាញ QR'));
  check('QR status shows exact amount, reference, workspace, expiry and test warning',document.body.textContent.includes('USD 13.00')&&document.body.textContent.includes('TC-SYNTHETIC-UI')&&document.body.textContent.includes('Fixture workspace A')&&document.body.textContent.includes(t('Test payment','ការទូទាត់សាកល្បង'))&&/\d+:\d\d/.test(document.body.textContent));
  check('mobile/tablet/desktop have no horizontal overflow',document.documentElement.scrollWidth<=innerWidth+1);
  return {id:[...records.keys()][0]};
}
async function reloadChecks() {
  const id=new URLSearchParams(location.search).get('bakong_attempt'),item=records.get(id);check('deep link retains the committed attempt after real page reload',Boolean(item));
  status(item);await until(()=>document.querySelector('figure img'),'restored QR');
  const before=requests.filter(item=>item.method==='POST').length;
  checkout();await until(()=>document.querySelector('figure img')&&document.body.textContent.includes('USD 13.00'),'old checkout recovery');
  check('back to old checkout discovers pending attempt without preparing or showing other pay controls',requests.filter(item=>item.method==='POST').length===before&&!button('Show QR','បង្ហាញ QR'));
}
async function stateChecks() {
  const first=[...records.values()][0];
  button('Check payment','ពិនិត្យការទូទាត់').click();await until(()=>document.querySelector('h1')?.textContent===t('Test payment confirmed','បានបញ្ជាក់ការទូទាត់សាកល្បង'),'test paid');
  check('sandbox has no active subscription or another payment form',!document.body.textContent.includes(t('Payment successful','ការទូទាត់ជោគជ័យ'))&&!button('Show QR','បង្ហាញ QR')&&!document.querySelector('figure img'));
  const production=saved(B,'verified','production');production.qrImage=null;save();status(production);
  await until(()=>document.querySelector('h1')?.textContent===t('Payment received','បានទទួលការទូទាត់'),'activation pending');
  const calls=providerChecks;button('Check payment','ពិនិត្យការទូទាត់').click();
  await until(()=>document.querySelector('h1')?.textContent===t('Payment successful','ការទូទាត់ជោគជ័យ'),'active entitlement');
  check('activation retry does not verify or pay again',providerChecks===calls&&Boolean(button('Go to inbox','ទៅប្រអប់សារ')));
  button('Go to inbox','ទៅប្រអប់សារ').click();await pause(50);
  check('Continue pins the purchased workspace and a navigation failure creates no new payment',requests.some(item=>item.path==='/api/workspaces/switch'&&item.body.businessId===B)&&providerChecks===calls);
  production.application='historical';save();status(production);await until(()=>document.body.textContent.includes(t('earlier subscription period','រយៈពេលជាវមុន')),'historical receipt');
  check('historical approval cannot label current entitlement active',document.querySelector('h1')?.textContent!==t('Payment successful','ការទូទាត់ជោគជ័យ'));
  first.state='review';first.qrImage=null;first.canCheck=false;save();status(first);await until(()=>document.querySelector('h1')?.textContent===t('Payment needs review','ការទូទាត់ត្រូវការពិនិត្យ'),'review');
  check('late/conflicting payment has review copy and no retry charge',!button('Show QR','បង្ហាញ QR')&&!document.querySelector('figure img'));
}
async function advance(ms) {offset+=ms;for(const[id,timer]of [...longTimers])if(timer.at<=now()){longTimers.delete(id);timer.callback();}await pause(100);}
async function pollChecks() {
  const item=saved(A);pendingOnly=true;status(item);await until(()=>document.querySelector('figure img'),'poll fixture');
  const calls=providerChecks;await advance(60000);check('there is no provider poll every few seconds or after one minute',providerChecks===calls);
  for(let i=0;i<3;i++)await advance(300000);
  check('automatic checks are five-minute minimum and globally persisted remaining count stops at three',providerChecks-calls===3&&pollDelays.every(delay=>delay>=300000));
  await advance(3600000);check('expired QR and exhausted automatic checks do not declare unpaid or open replacement checkout',providerChecks-calls===3&&!document.querySelector('figure img')&&!button('Show QR','បង្ហាញ QR')&&document.body.textContent.includes(t('QR expired','QR ផុតកំណត់')));
  pendingOnly=false;offset=0;
}
async function isolationChecks() {
  const a=saved(A),b=saved(B);delayA=true;status(a);await until(()=>releaseA,'delayed A response');
  status(b);await until(()=>document.body.textContent.includes('Fixture workspace B'),'workspace B');releaseA();delayA=false;await pause(80);
  check('delayed A response cannot contaminate B or restore its QR',document.body.textContent.includes('Fixture workspace B')&&!document.body.textContent.includes('Fixture workspace A'));
  denied=true;status(b);await until(()=>document.querySelector('[role=alert]'),'revocation');
  check('revoked access removes private QR and payment details',!document.querySelector('figure img')&&!document.body.textContent.includes('Fixture workspace B'));denied=false;
  status(b);await until(()=>document.querySelector('figure img'),'auth boundary fixture');for(const listener of listeners)listener('SIGNED_OUT');await pause(50);
  check('session change immediately removes private payment state',!document.querySelector('figure img')&&!document.body.textContent.includes('Fixture workspace B'));
}
window.bakongFixture={checkoutChecks,reloadChecks,stateChecks,pollChecks,isolationChecks,result:()=>({checks,requests,navigations,mockedProviderChecks:providerChecks,actualProviderRequests:0,realPayments:0,realCredentialsUsed:false,language:window.fixtureLanguage})};

if (demoMode) {
  if (params.get('reset') === '1') { records.clear(); save(); history.replaceState(null,'','/fixture.html?lang='+window.fixtureLanguage); }
  const existing = records.get(params.get('bakong_attempt'));
  if (existing) status(existing);
  else {
    checkout();
    void until(()=>Boolean(button('Bakong KHQR','Bakong KHQR')),'demo checkout').then(()=>button('Bakong KHQR','Bakong KHQR').click());
  }
}
