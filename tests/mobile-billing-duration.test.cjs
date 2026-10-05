/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic native hooks and API; no provider/network. */
const test = require('node:test'), assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
const { buildCustomUpgradeQuote } = loader()('lib/subscription/custom-upgrade.ts');
const cycles = [
  { id: 'monthly', label: '1 month', months: 1, discount: 0 },
  { id: '3-months', label: '3 months', months: 3, discount: .05 },
  { id: '6-months', label: '6 months', months: 6, discount: .1 },
  { id: '12-months', label: '12 months', months: 12, discount: .2 },
];
const source = (cycle = 'monthly', plan = 'mini') => ({ id: 's-A', business_id: 'A', status: 'active',
  plan_code: plan, billing_cycle: cycle, current_period_start: '2026-12-01T00:00:00Z',
  current_period_end: '2027-01-01T00:00:00Z', channel_limit: 3, member_limit: 1,
  pricing_snapshot: {}, last_paid_amount: 13, payment_provider: 'payway' });
const catalog = { plans: [{ id: 'mini', name: 'Mini', channels: 3, users: 1, monthlyCents: 1300 }], cycles,
  custom: { extraConnectionCents: 200, extraUserCents: 500, minConnections: 3, maxConnections: 30, minUsers: 1, maxUsers: 100 },
  manualPayment: { enabled: true, bankName: 'Synthetic bank', accountName: 'Synthetic', accountNumber: 'TEST' } };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function harness({ page = 'plans', extension = 'none', cycle = 'monthly', plan = 'mini', connections = 4, users = 2, intent = 'upgrade', store = new Map(), entry = {}, userId = 'synthetic-user', storageFailure = false } = {}) {
  const slots = [], effects = [], timers = new Map(), calls = [], pushes = [];
  let cursor = 0, timerId = 0, tree, apiOverride, preparedSelection = false;
  const params = { businessId: 'A', intent, extension, cycle, connections: String(connections), users: String(users), ...entry };
  const inbox = { workspace: { businessId: 'B' }, workspaces: [{ businessId: 'A', businessName: 'A' }],
    loadWorkspaces: async()=>{}, refreshAlerts: async()=>{}, settingsRevision: 0 };
  let subscription = source(cycle, plan);
  function memo(fn, deps) { const i=cursor++, old=slots[i]; if (!old || deps.some((v,j)=>!Object.is(v,old.deps[j]))) slots[i]={fn,deps}; return slots[i].fn; }
  function effect(fn, deps) { const i=cursor++, old=slots[i]; if (!old || deps.some((v,j)=>!Object.is(v,old.deps[j]))) effects.push(()=>{ old?.cleanup?.(); slots[i]={deps,cleanup:fn()}; }); }
  const react = { useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial;
    return [slots[i], value=>{ slots[i]=typeof value==='function'?value(slots[i]):value; }]; },
    useRef(initial) { const i=cursor++; return slots[i] ?? (slots[i]={current:initial}); }, useEffect:effect, useCallback:memo };
  const jsx = (type, props) => ({type,props});
  const api = async (path, target, init={}) => {
    calls.push({path,target,init});
    const override = apiOverride?.(path,target,init); if (override !== undefined) return override;
    if (path.includes('/catalog')) return catalog;
    if (path.includes('/current')) return {subscription,usage:{channels:3,members:1}};
    if (path.includes('/plan-change')) return {canManage:true,isOwner:true,mode:intent==='upgrade'?'active-paid':'subscribe'};
    if (path.includes('/custom-upgrade/quote')) { const q=new URL(path,'https://synthetic.invalid').searchParams;
      return {quote:buildCustomUpgradeQuote({subscription,targetConnections:Number(q.get('connections')),targetUsers:Number(q.get('users')),
        targetBillingCycle:q.get('cycle'),extensionBillingCycle:q.get('extension'),now:new Date('2026-12-16T12:00:00Z')})}; }
    if (path==='/api/payway/checkout') return {checkoutUrl:'https://synthetic.invalid',fields:{},transactionId:'TEST'};
    if (path==='/api/manual-payments' && init.body?.action==='prepare-upload') return {requestId:'proof-A',upload:{bucket:'test',path:'test',token:'synthetic'}};
    if (path==='/api/manual-payments' && init.body?.action==='finalize-upload') return {request:{id:'proof-A',status:'submitted',proofFileName:'test.pdf'}};
    if (path==='/api/manual-payments') return {request:null};
    throw Error('Unexpected synthetic API '+path);
  };
  const load=loader({ react, 'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
    'react-native':Object.fromEntries(['ActivityIndicator','Image','Modal','Pressable','Text','TextInput','View'].map(x=>[x,x]).concat([
      ['Alert',{alert(){}}],['Linking',{openURL:async()=>{}}]])),
    '@expo/vector-icons':{Ionicons:'Icon'}, 'expo-router':{useRouter:()=>({push:x=>pushes.push(x),replace:x=>pushes.push(x),setParams:x=>Object.assign(params,x)}),useLocalSearchParams:()=>params,useFocusEffect:fn=>effect(fn,[fn])},
    'expo-router/react-navigation':{usePreventRemove(){}}, 'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:0})},
    'react-native-webview':{WebView:'WebView'}, '../settings-screen':{SettingsGroup:'Group',SettingsScreen:'Screen'},
    '../ui':{ErrorNotice:'ErrorNotice',IconButton:'IconButton',colors:{},styles:{}}, '../../lib/api/client':{api}, '../../lib/inbox-provider':{useInbox:()=>inbox},
    '../../lib/aba-payment':{requestAbaPaymentLink:async()=> 'aba://synthetic'},
    '../../lib/supabase/client':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:userId}}},error:null})},storage:{from:()=>({uploadToSignedUrl:async()=>({error:null})})}}},
    'expo-secure-store':{getItemAsync:async key=>{if(storageFailure)throw Error('Synthetic storage unavailable');return store.get(key)??null;},setItemAsync:async(key,value)=>{if(storageFailure)throw Error('Synthetic storage unavailable');store.set(key,value);},deleteItemAsync:async key=>store.delete(key)},
    'expo-document-picker':{getDocumentAsync:async()=>({canceled:false,assets:[{uri:'synthetic://proof',name:'test.pdf',mimeType:'application/pdf',size:10}]})},
    'expo-file-system':{File:class {async arrayBuffer(){return new ArrayBuffer(10);}}},
    '../../assets/tenh-logo.png':{},'../../assets/aba-khqr.png':{},
  }, {AbortController,URLSearchParams,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  const { SubscriptionFlow: Flow }=load('mobile/components/billing/subscription-flow.tsx');
  function expand(node) { if (!node || typeof node!=='object') return node; if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type==='function') return expand(node.type(node.props)); return {...node,props:{...node.props,children:expand(node.props?.children)}}; }
  function render() {cursor=0;tree=expand(Flow({page}));for(const run of effects.splice(0))run();return tree;}
  async function pump() { for(let i=0;i<32;i++){await Promise.resolve();render();}return tree; }
  async function quote() { await pump();
    if(page==='plans' && !preparedSelection){preparedSelection=true;
      for(let i=3;i<connections;i++){elements(tree).find(x=>x.props?.accessibilityLabel==='Add one connections').props.onPress();render();}
      for(let i=1;i<users;i++){elements(tree).find(x=>x.props?.accessibilityLabel==='Add one team members').props.onPress();render();}
      await pump();
    }
    const timer=[...timers.entries()].find(([,v])=>v.ms===200);assert.ok(timer,'quote debounce scheduled');timers.delete(timer[0]);const pending=timer[1].fn();await pump();return pending; }
  return {render,pump,quote,calls,pushes,params,inbox,store,get tree(){return tree;},get subscription(){return subscription;},set subscription(v){subscription=v;},override(fn){apiOverride=fn;},
    async runTimer(ms){await pump();const timer=[...timers.entries()].find(([,v])=>v.ms===ms);assert.ok(timer,'timer '+ms);timers.delete(timer[0]);await timer[1].fn();await pump();},
    timers,
    async refresh(){inbox.settingsRevision++;render();await pump();}, unmount(){for(const slot of slots)slot?.cleanup?.();} };
}
function text(node){if(!node)return '';if(Array.isArray(node))return node.map(text).join(' ');if(typeof node!=='object')return String(node);return text(node.props?.children);}
function elements(node){if(!node||typeof node!=='object')return [];if(Array.isArray(node))return node.flatMap(elements);return [node,...elements(node.props?.children)];}
function button(h,pattern){const found=elements(h.tree).find(x=>x.type==='Pressable' && pattern.test(text(x)));assert.ok(found,'button '+pattern);return found;}

for(const sourceCycle of cycles) test(`all durations remain selectable from ${sourceCycle.id}, with exact navigation and quote binding`,async()=>{
  const h=harness({cycle:sourceCycle.id});h.render();await h.quote();await h.pump();
  for(const extension of ['none',...cycles.map(c=>c.id)]){
    const option=extension==='none'?/^Keep expiry/:new RegExp('^Add '+cycles.find(c=>c.id===extension).months+' month');
    button(h,option).props.onPress();h.render();if(extension!=='none')await h.quote();await h.pump();
    const request=h.calls.filter(c=>c.path.includes('/quote?')).at(-1), q=new URL(request.path,'https://synthetic.invalid').searchParams;
    assert.equal(q.get('business_id'),'A');assert.equal(request.target,'A');assert.equal(q.get('extension'),extension);
    assert.equal(q.get('cycle'),extension==='none'?sourceCycle.id:extension);
    assert.equal(button(h,/^Continue payment/).props.disabled,false);
  }
  const proceed=button(h,/^Continue payment/);proceed.props.onPress();proceed.props.onPress();assert.equal(h.pushes.length,1);
  assert.equal(h.pushes[0].params.extension,'12-months');assert.equal(h.pushes[0].params.cycle,'12-months');assert.equal(h.pushes[0].params.businessId,'A');
  assert.equal('amount' in h.pushes[0].params,false);h.unmount();
});
test('selection change hides stale amounts before debounce and ignores an aborted late result',async()=>{
  const h=harness();h.render();await h.quote();await h.pump();const oldText=text(h.tree);assert.match(oldText,/Due today \$/);
  const late=deferred();h.override(path=>path.includes('/quote?')?late.promise:undefined);
  button(h,/^Add 3 months/).props.onPress();h.render();assert.equal(button(h,/^Continue payment/).props.disabled,true);assert.doesNotMatch(text(h.tree),/Due today \$/);
  const waiting=h.quote();await h.pump();button(h,/^Add 6 months/).props.onPress();h.render();
  late.resolve({quote:buildCustomUpgradeQuote({subscription:h.subscription,targetConnections:4,targetUsers:2,targetBillingCycle:'3-months',extensionBillingCycle:'3-months',now:new Date('2026-12-16T12:00:00Z')})});
  await waiting;await h.pump();assert.equal(button(h,/^Continue payment/).props.disabled,true);assert.doesNotMatch(text(h.tree),/Due today \$/);h.unmount();
});
test('refreshed expiry invalidates quote and preserves chosen extension; global workspace never retargets purchase',async()=>{
  const h=harness({extension:'3-months'});h.render();await h.quote();await h.pump();
  h.inbox.workspace={businessId:'C'};h.render();assert.equal(button(h,/^Continue payment/).props.disabled,false);
  h.subscription={...h.subscription,current_period_end:'2027-02-01T00:00:00Z'};await h.refresh();
  assert.equal(button(h,/^Continue payment/).props.disabled,true);await h.quote();await h.pump();
  assert.equal(button(h,/^Continue payment/).props.disabled,false);button(h,/^Continue payment/).props.onPress();
  assert.equal(h.pushes[0].params.businessId,'A');assert.equal(h.pushes[0].params.extension,'3-months');h.unmount();
});
test('mismatched provider quote baseline or extension fails closed without displaying a payable total',async()=>{
  for(const changed of [{currentConnections:9},{currentUsers:9},{currentBillingCycle:'12-months'},
    {extensionBillingCycle:'6-months'},{currentPeriodEnd:'2027-03-01T00:00:00Z'},{targetBillingCycle:'monthly'}]){
    const h=harness({page:'payment',extension:'3-months'});
    h.override(path=>path.includes('/quote?')?{quote:{...buildCustomUpgradeQuote({subscription:h.subscription,
      targetConnections:4,targetUsers:2,targetBillingCycle:'3-months',extensionBillingCycle:'3-months',now:new Date('2026-12-16T12:00:00Z')}),...changed}}:undefined);
    h.render();await h.quote();await h.pump();assert.equal(button(h,/^Pay \$/).props.disabled,true);
    assert.doesNotMatch(text(h.tree),/Capacity upgrade/);assert.equal(h.calls.some(c=>c.init.method==='POST'),false);h.unmount();
  }
});
test('unmount aborts pending quote work and a late result cannot schedule payment',async()=>{
  const h=harness({page:'payment'}), late=deferred();h.override(path=>path.includes('/quote?')?late.promise:undefined);
  h.render();const waiting=h.quote();await h.pump();const request=h.calls.find(c=>c.path.includes('/quote?'));assert.ok(request);
  h.unmount();assert.equal(request.init.signal.aborted,true);late.resolve({quote:{totalCents:999999}});await waiting;
  assert.equal(h.calls.some(c=>c.init.method==='POST'),false);assert.equal(h.pushes.length,0);
});
for(const extension of ['none','monthly','3-months','6-months','12-months']) test(`PayWay and both manual proof steps carry the same duration: ${extension}`,async()=>{
  for(const manual of [false,true]){
    const h=harness({page:'payment',extension});h.render();await h.quote();await h.pump();
    if(manual){button(h,/Manual bank transfer/).props.onPress();h.render();await button(h,/Choose receipt image/).props.onPress();await h.pump();}
    const start=button(h,manual?/^Submit \$/ : /^Pay \$/);assert.equal(start.props.disabled,false);
    start.props.onPress();start.props.onPress();await h.pump();
    // Exercise the same stale handler after the first request has finished but before a fresh handler is read.
    start.props.onPress();await h.pump();
    const requests=h.calls.filter(c=>c.init.method==='POST');assert.equal(requests.length,manual?2:1);
    for(const request of requests){assert.equal(request.target,'A');assert.equal(request.init.body.purchaseBusinessId,'A');assert.equal(request.init.body.extensionBillingCycle,extension);
      assert.equal(request.init.body.billingCycle,extension==='none'?'monthly':extension);assert.equal(request.init.body.customUpgrade,true);assert.equal(request.init.body.planCode,'custom');assert.equal('amount' in request.init.body,false);}
    h.unmount();
  }
});
test('months-only upgrades from Custom preserve capacity and zero capacity charge; ordinary purchases omit extension',async()=>{
  const h=harness({plan:'custom',connections:3,users:1,extension:'monthly'});h.render();await h.quote();await h.pump();
  assert.equal(button(h,/^Continue payment/).props.disabled,false);assert.doesNotMatch(text(h.tree),/Increase capacity or duration/);h.unmount();
  const ordinary=harness({page:'payment',intent:'subscribe'});ordinary.render();await ordinary.pump();button(ordinary,/^Pay \$/).props.onPress();await ordinary.pump();
  const request=ordinary.calls.find(c=>c.path==='/api/payway/checkout');assert.ok(request);assert.equal('extensionBillingCycle' in request.init.body,false);assert.equal('customUpgrade' in request.init.body,false);ordinary.unmount();
});
test('successful recovery_required status stops polling, preserves identity and blocks stale checkout/manual/cancel handlers through return and reload',async()=>{
  const h=harness({page:'payment'});h.override(path=>path.startsWith('/api/payway/status?')?{success:true,transactionId:'TEST',paymentState:'recovery_required',providerStatus:'Payment requires billing review. Your subscription has not been changed.'}:undefined);
  h.render();await h.quote();await h.pump();
  const stalePay=button(h,/^Pay \$/).props.onPress;
  button(h,/Manual bank transfer/).props.onPress();h.render();await button(h,/Choose receipt image/).props.onPress();await h.pump();
  const staleManual=button(h,/^Submit \$/).props.onPress;
  button(h,/ABA app/).props.onPress();h.render();stalePay();await h.pump();
  const staleCancel=button(h,/Cancel pending payment/).props.onPress;
  await h.runTimer(2500);
  assert.match(text(h.tree),/Payment requires billing review/);assert.match(text(h.tree),/Do not pay again or cancel/);
  assert.match(text(h.tree),/Workspace:\s+A/);assert.match(text(h.tree),/Transaction:\s+TEST/);
  assert.equal(h.params.businessId,'A');assert.equal(h.params.tran_id,'TEST');assert.equal(h.params.payway,'recovery_required');
  assert.equal([...h.timers.values()].some(t=>t.ms===2500||t.ms===3000),false);
  assert.equal(elements(h.tree).some(x=>x.type==='Pressable' && /Cancel pending payment/.test(text(x))),false);
  assert.equal(elements(h.tree).some(x=>x.type==='Pressable' && /^Open ABA app/.test(text(x))),false);
  for(const pattern of [/Manual bank transfer/,/ABA app/])assert.equal(button(h,pattern).props.disabled,true);
  button(h,/Manual bank transfer/).props.onPress();h.render();assert.equal(button(h,/Choose receipt image|test\.pdf/).props.disabled,true);
  stalePay();staleManual();staleCancel();await h.pump();
  assert.deepEqual(h.calls.filter(c=>c.init.method==='POST').map(c=>c.path),['/api/payway/checkout']);
  const leave=button(h,/Return to subscription/);assert.equal(leave.props.disabled,false);leave.props.onPress();
  assert.equal(h.pushes.at(-1).params.businessId,'A');assert.equal(h.pushes.at(-1).params.tran_id,'TEST');assert.equal(h.pushes.at(-1).params.payway,'recovery_required');
  const returned=harness({page:'overview',store:h.store,entry:h.pushes.at(-1).params});returned.render();await returned.pump();
  assert.match(text(returned.tree),/Transaction:\s+TEST/);assert.doesNotMatch(text(returned.tree),/Buy Subscription|Upgrade subscription/);assert.equal(returned.calls.some(c=>c.init.method==='POST'),false);
  const reload=harness({page:'payment',store:h.store});reload.render();await reload.quote();await reload.pump();
  assert.match(text(reload.tree),/Transaction:\s+TEST/);assert.equal(button(reload,/Billing review required/).props.disabled,true);
  button(reload,/Billing review required/).props.onPress();await reload.pump();assert.equal(reload.calls.some(c=>c.init.method==='POST'),false);
  assert.equal(reload.calls.some(c=>c.path.startsWith('/api/payway/status?')),false);
  h.override(path=>path.startsWith('/api/payway/status?')?{success:true,paymentState:'approved'}:undefined);
  button(h,/Check review status/).props.onPress();await h.pump();
  stalePay();staleManual();staleCancel();await h.pump();
  assert.deepEqual(h.calls.filter(c=>c.init.method==='POST').map(c=>c.path),['/api/payway/checkout']);
  h.unmount();returned.unmount();reload.unmount();
});
test('review refresh remains held for pending/failed/cancelled or error; verified approval alone clears durable hold',async()=>{
  const store=new Map([['tenh.billing.review.v1.synthetic-user.A',JSON.stringify({businessId:'A',transactionId:'TEST'})]]);
  const h=harness({page:'overview',store});h.render();await h.pump();
  for(const state of ['recovery_required','pending','failed','cancelled']){
    h.override(path=>path.startsWith('/api/payway/status?')?{success:true,paymentState:state}:undefined);
    button(h,/Check review status/).props.onPress();button(h,/Check review status/).props.onPress();await h.pump();
    assert.match(text(h.tree),/Payment requires billing review/);assert.equal(store.size,1);
  }
  assert.equal(h.calls.filter(c=>c.path.startsWith('/api/payway/status?')).length,4);
  h.override(path=>path.startsWith('/api/payway/status?')?Promise.reject(Error('Synthetic network error')):undefined);
  button(h,/Check review status/).props.onPress();await h.pump();assert.match(text(h.tree),/Payment requires billing review/);assert.equal(store.size,1);
  h.override(path=>path.startsWith('/api/payway/status?')?{success:true,paymentState:'approved'}:undefined);
  button(h,/Check review status/).props.onPress();await h.pump();assert.equal(store.size,0);assert.doesNotMatch(text(h.tree),/Payment requires billing review/);
  assert.equal(h.params.payway,'');assert.equal(h.params.tran_id,'');assert.equal(h.calls.some(c=>c.init.method==='POST'),false);h.unmount();
});
test('device review records are scoped to signed-in user and workspace; unreadable storage fails closed',async()=>{
  const store=new Map([['tenh.billing.review.v1.other-user.A',JSON.stringify({businessId:'A',transactionId:'OTHER'})],
    ['tenh.billing.review.v1.synthetic-user.B',JSON.stringify({businessId:'B',transactionId:'OTHER'})]]);
  const h=harness({page:'payment',store});h.render();await h.quote();await h.pump();assert.equal(button(h,/^Pay \$/).props.disabled,false);assert.doesNotMatch(text(h.tree),/Payment requires billing review/);h.unmount();
  const broken=harness({page:'payment',storageFailure:true});broken.render();await broken.pump();
  assert.equal(button(broken,/^Pay \$/).props.disabled,true);button(broken,/^Pay \$/).props.onPress();await broken.pump();assert.equal(broken.calls.some(c=>c.init.method==='POST'),false);broken.unmount();
});
