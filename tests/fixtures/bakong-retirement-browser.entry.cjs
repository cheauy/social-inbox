/* eslint-disable @typescript-eslint/no-require-imports */
// Real checkout components and synthetic HTTP only. Never opens a provider or makes a payment.
const React = require('react'), { createRoot } = require('react-dom/client'), { flushSync } = require('react-dom');
const { SubscriptionPaymentView } = require('../../components/subscription/subscription-payment-view.tsx');
const businessId = '00000000-0000-4000-8000-000000000001';
window.fixtureLanguage = new URLSearchParams(location.search).get('lang') || 'en';
const t = (en,km) => window.fixtureLanguage === 'km' ? km : en;
const requests = [], checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const buttons = () => [...document.querySelectorAll('button')];
function check(name,value) { checks.push({name,passed:Boolean(value)}); if(!value) throw Error(name); }
async function until(test) { for(let i=0;i<150;i++){if(test())return;await pause(20);}throw Error('Checkout did not settle'); }
window.fixtureRouter = {replace(){}};
window.fixtureSupabase = {auth:{onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}};}}};
window.TenhAbaPaywayBridge = {isReady:()=>true,checkout:()=>{throw Error('Provider checkout is forbidden');}};
window.fetch = async (url,init={}) => {
 const target = new URL(url,location.href), method = init.method || 'GET';
 requests.push({path:target.pathname,method});
 if(target.origin!==location.origin || method!=='GET') throw Error('Unexpected mutation or provider request');
 if(target.pathname==='/api/bakong/checkout') return Response.json({success:true,enabled:true,retired:true,environment:'production',
   businessId,userId:'fixture-user',memberId:'fixture-member',pendingAttemptId:null,resumeAttemptId:null});
 if(target.pathname==='/api/manual-payments') return Response.json({success:true,businessId,request:null,preparedAttempt:null,
   config:{enabled:true,bankName:'Fixture Bank',accountName:'TENH Fixture',accountNumber:'SYNTHETIC',qrImageUrl:null}});
 throw Error('Unexpected request '+target.pathname);
};
const root=createRoot(document.getElementById('root'));
flushSync(()=>root.render(React.createElement(React.StrictMode,null,React.createElement(SubscriptionPaymentView,
 {planCode:'mini',billingCycle:'monthly',purchaseBusinessId:businessId,savedTransactionTotalCents:2537}))));
window.retirementFixture={
 async check(){
  await until(()=>buttons().some(b=>b.textContent.includes('ABA KHQR')));
  check('direct Bakong option is absent even with stale enabled advertisement',!buttons().some(b=>b.textContent.trim().startsWith('KHQR'))&&!document.body.textContent.includes('Bakong'));
  check('production checkout has no test-payment label',!document.body.textContent.includes('Test payment'));
  await until(()=>buttons().some(b=>b.className.includes('min-w-[230px]')&&!b.disabled));
  const payway=buttons().find(b=>b.className.includes('min-w-[230px]'));
  check('PayWay checkout remains available',Boolean(payway));
  check('verified total is preserved',document.body.textContent.includes('$25.37'));
  check('PayWay QR option is preserved',buttons().some(b=>b.textContent.includes('ABA KHQR')));
  const manual=buttons().find(b=>b.textContent.includes(t('Manual bank transfer','ផ្ទេរប្រាក់តាមធនាគារដោយដៃ')));
  check('manual payment option remains enabled',manual&&!manual.disabled);
  check('methods have no horizontal overflow',document.documentElement.scrollWidth<=innerWidth+1);
  check('method discovery makes no mutation',requests.every(r=>r.method==='GET'));
  manual.scrollIntoView({block:'center'});
 },
 async manual(){
  buttons().find(b=>b.textContent.includes(t('Manual bank transfer','ផ្ទេរប្រាក់តាមធនាគារដោយដៃ'))).click();
  await until(()=>document.querySelector('input[type=file]'));
  check('manual receipt form is preserved',Boolean(document.querySelector('input[type=file]')));
  check('manual form has no horizontal overflow',document.documentElement.scrollWidth<=innerWidth+1);
  check('manual selection makes no provider request or mutation',requests.every(r=>r.method==='GET'));
 },
 result:()=>({checks,requests,actualProviderRequests:0,realPayments:0})
};
