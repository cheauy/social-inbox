/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS isolated browser fixture. */
// Real React hooks/effects in an isolated browser. All quote requests are mocked.
const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom');
const {CustomUpgradeModal}=require('../../components/subscription/custom-upgrade-modal.tsx');
const {buildCustomUpgradeQuote}=require('../../lib/subscription/custom-upgrade.ts');
const snapshots={a:{status:'active',plan_code:'mini',billing_cycle:'monthly',member_limit:1,channel_limit:3,
  current_period_start:'2026-01-01T00:00:00Z',current_period_end:'2026-02-01T00:00:00Z',pricing_snapshot:{}},b:null};
snapshots.b={...snapshots.a};
const requests=[],checks=[];let deferred=false;
window.fetch=(url,options)=>new Promise(resolve=>{
  const params=new URL(url,location.href).searchParams,workspace=params.get('business_id');
  const subscription={...snapshots[workspace]},now=new Date('2026-01-16T12:00:00Z');
  let value,error;
  try {value=buildCustomUpgradeQuote({subscription,targetConnections:Number(params.get('connections')),
    targetUsers:Number(params.get('users')),targetBillingCycle:params.get('cycle'),extensionBillingCycle:params.get('extension'),now});}
  catch(reason){error=reason.message;}
  const request={workspace,extension:params.get('extension'),signal:options.signal,value,
    respond:()=>resolve({ok:!error,json:async()=>error?{success:false,error}:{success:true,quote:value}})};
  requests.push(request);if(!deferred)request.respond();
});
const root=createRoot(document.getElementById('app'));let props={open:true,currentConnections:3,currentUsers:1,currentBillingCycle:'monthly',
  currentPeriodEnd:snapshots.a.current_period_end,targetBusinessId:'a',onClose:()=>{}};
const render=changes=>{props={...props,...changes};flushSync(()=>root.render(React.createElement(CustomUpgradeModal,props)));};
const text=()=>document.getElementById('app').textContent;
const button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent.includes(label));
const continueButton=()=>[...document.querySelectorAll('button')].at(-1);
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,message){for(let i=0;i<100;i++){if(predicate())return;await pause(20);}throw Error(message);}
const click=label=>{const node=button(label);assert(node,'Missing button '+label);flushSync(()=>node.click());};
const tick=async()=>{await pause(0);await pause(0);};

(async()=>{try{
  render({});await until(()=>requests.length===1,'Initial quote effect did not run');
  click('Add 3 Months');assert(continueButton().disabled,'Unquoted selection was enabled');
  await until(()=>!continueButton().disabled,'Initial duration selection did not become payable');
  assert(text().includes('$37.05')&&text().includes('May 1, 2026'),'Initial quote/expiry incorrect');
  checks.push('real effect/debounce fetch renders duration-only quote and initial expiry');

  const beforeExpiry=requests.length;snapshots.a.current_period_end='2026-03-01T00:00:00Z';
  render({currentPeriodEnd:snapshots.a.current_period_end});
  assert(continueButton().disabled,'Expiry change reused old quote');
  assert(!text().includes('May 1, 2026'),'Expiry change displayed stale expiry');
  await until(()=>requests.length>beforeExpiry&&!continueButton().disabled,'Expiry change did not refetch without changing selections');
  assert(requests.at(-1).extension==='3-months','Expiry refetch reset the selected duration');
  assert(text().includes('Jun 1, 2026'),'Refetched baseline expiry preview incorrect');
  checks.push('baseline expiry change refetches with unchanged selection and reenables only matching quote');

  deferred=true;click('Add 6 Months');
  const beforeA=requests.length;await until(()=>requests.length>beforeA,'Deferred A quote was not requested');
  const oldA=requests.at(-1);assert(oldA.workspace==='a'&&oldA.extension==='6-months','Wrong deferred A request');
  snapshots.b={...snapshots.a};const beforeB=requests.length;
  render({targetBusinessId:'b'});assert(continueButton().disabled,'Identical B workspace reused A quote during debounce');
  await until(()=>requests.length>beforeB,'Identical workspace switch did not refetch');
  const baseB=requests.at(-1);assert(baseB.workspace==='b','Quote request was not bound to B');baseB.respond();await tick();
  assert(continueButton().disabled,'No-change B quote should not be payable');
  click('Add 3 Months');const beforeBSelection=requests.length;
  await until(()=>requests.length>beforeBSelection,'B duration quote was not requested');
  const paidB=requests.at(-1);assert(paidB.workspace==='b'&&paidB.extension==='3-months','Wrong B duration request');
  paidB.respond();await until(()=>!continueButton().disabled,'B matching quote did not enable Continue');
  assert(oldA.signal.aborted,'Workspace switch did not abort previous request');
  oldA.respond();await tick();assert(!continueButton().disabled,'Late aborted A response damaged valid B quote');
  assert(text().includes('$37.05')&&!text().includes('$70.20'),'Late A response replaced B preview');
  checks.push('identical workspace switch invalidates immediately, refetches B and ignores late aborted A response');

  const beforeClosed=requests.length;click('Add 1 Year');render({open:false});await pause(220);
  assert(requests.length===beforeClosed,'Closed modal sent deferred quote');
  checks.push('closing modal cancels the real scheduled quote effect');

  window.__durationLanguage='km';render({open:true});await tick();
  assert(text().includes('1, 3, 6 ឬ 12 ខែ')&&text().includes('ចាប់ពីថ្ងៃផុតកំណត់នោះ'),'Khmer optional extension explanation missing');
  assert(!text().includes('មិនអាចប្តូរទៅរយៈពេលខ្លីជាងបានទេ'),'Khmer still states obsolete duration restriction');
  checks.push('Khmer copy describes optional added months after existing expiry');
  render({open:false});
  document.getElementById('result').textContent=JSON.stringify({success:true,real_react_effects:true,provider_calls:false,checks_passed:checks.length,checks});
}catch(error){document.getElementById('result').textContent=JSON.stringify({success:false,error:error.stack,checks});}})();
