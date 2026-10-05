/* eslint-disable @typescript-eslint/no-require-imports -- Render the real component with synthetic hooks; no network. */
const test=require('node:test'),assert=require('node:assert/strict');
const {loader}=require('./tenh-seven/harness.cjs');
const {buildCustomUpgradeQuote}=loader()('lib/subscription/custom-upgrade.ts');
const end='2026-02-01T00:00:00.000Z';
const subscription={status:'active',plan_code:'mini',billing_cycle:'monthly',member_limit:1,channel_limit:3,
  current_period_start:'2026-01-01T00:00:00.000Z',current_period_end:end,pricing_snapshot:{}};
const quote=(connections,users,extension)=>buildCustomUpgradeQuote({subscription,targetConnections:connections,targetUsers:users,
  targetBillingCycle:extension==='none'?'monthly':extension,extensionBillingCycle:extension,now:new Date('2026-01-16T12:00:00.000Z')});
const bound=q=>({quote:q,requestKey:JSON.stringify(['synthetic-workspace',q.targetConnections,q.targetUsers,q.extensionBillingCycle??'none',3,1,'monthly','2026-02-01T00:00:00+00:00'])});

function harness({connections=4,users=2,extension='none',fetched=quote(connections,users,extension)}={}){
  const states=[connections,users,extension,bound(fetched),false,null],pushes=[]; let cursor=0;
  const jsx=(type,props)=>({type,props});
  const load=loader({
    react:{useState:initial=>{const i=cursor++;if(states[i]===undefined)states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useMemo:fn=>fn(),useCallback:fn=>fn,useEffect:()=>{}},
    'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
    'next/navigation':{useRouter:()=>({push:url=>pushes.push(url)})},
    '@/components/display/workspace-language-text':{useWorkspaceLanguageId:()=> 'en'},
  },{URLSearchParams});
  const {CustomUpgradeModal:Modal}=load('components/subscription/custom-upgrade-modal.tsx');
  const render=(props={})=>{cursor=0;return Modal({open:true,currentConnections:3,currentUsers:1,currentBillingCycle:'monthly',
    currentPeriodEnd:'2026-02-01T00:00:00+00:00',targetBusinessId:'synthetic-workspace',onClose(){},...props});};
  return {states,pushes,render};
}
function text(node){if(node===null||node===undefined||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(text).join(' ');if(typeof node==='string'||typeof node==='number')return String(node);return text(node.props?.children);}
function elements(node,type){if(!node)return [];if(Array.isArray(node))return node.flatMap(x=>elements(x,type));if(typeof node!=='object')return [];return [...(node.type===type?[node]:[]),...elements(node.props?.children,type)];}
const button=(tree,pattern)=>{const result=elements(tree,'button').find(x=>pattern.test(text(x)));assert.ok(result,`Missing button ${pattern}`);return result;};

test('upgrade modal always renders keep expiry and all four duration choices, including at narrow widths',()=>{
  const h=harness(),tree=h.render();
  for(const pattern of [/Keep current expiry/,/Add\s+1 Month/,/Add\s+3 Months/,/Add\s+6 Months/,/Add\s+1 Year/]){
    const choice=button(tree,pattern);assert.doesNotMatch(choice.props.className,/\bhidden\b/);assert.equal(choice.props.disabled,undefined);
  }
  assert.match(text(tree),/12 months/);
});

for(const [extension,months,amount] of [['none',0,'$3.50'],['monthly',1,'$23.50'],['3-months',3,'$60.50'],['6-months',6,'$111.50'],['12-months',12,'$195.50']]){
  test(`capacity and duration preview, expiry and exact checkout binding: ${extension}`,()=>{
    const h=harness({extension}),tree=h.render(),value=h.states[3].quote;
    assert.match(text(tree),new RegExp(amount.replaceAll('$','\\$').replaceAll('.','\\.')));
    assert.equal(value.extensionMonths,months);assert.equal(value.currentPeriodEnd,end);
    assert.ok(text(tree).includes(new Intl.DateTimeFormat('en-US',{dateStyle:'medium'}).format(new Date(value.newPeriodEnd))));
    const proceed=button(tree,/Continue to payment/);assert.equal(proceed.props.disabled,false);proceed.props.onClick();
    const params=new URL(h.pushes[0],'https://synthetic.invalid').searchParams;
    assert.equal(params.get('extension'),extension);assert.equal(params.get('cycle'),extension==='none'?'monthly':extension);
    assert.equal(params.get('purchase_business'),'synthetic-workspace');assert.equal(params.get('plan'),'custom');
    assert.equal(params.get('connections'),'4');assert.equal(params.get('users'),'2');assert.equal(params.has('amount'),false);
  });
}

test('months-only quote preserves all capacity and existing days in the real modal',()=>{
  const h=harness({connections:3,users:1,extension:'3-months'}),tree=h.render();
  assert.equal(h.states[3].quote.capacityProrationCents,0);assert.equal(h.states[3].quote.totalCents,3705);
  assert.match(text(tree),/\$37\.05/);assert.match(text(tree),/May 1, 2026/);
  assert.equal(button(tree,/Continue to payment/).props.disabled,false);
});

test('selection changes and late mismatching responses hide stale price/expiry and disable Continue immediately',()=>{
  const h=harness({extension:'3-months'});let tree=h.render();assert.equal(button(tree,/Continue to payment/).props.disabled,false);
  button(tree,/Add\s+6 Months/).props.onClick();tree=h.render();
  assert.equal(button(tree,/Continue to payment/).props.disabled,true);assert.doesNotMatch(text(tree),/\$60\.50|May 1, 2026/);
  // Even a late response for the previous selection cannot become the visible quote.
  h.states[3]=bound(quote(4,2,'3-months'));tree=h.render();assert.equal(button(tree,/Continue to payment/).props.disabled,true);
  h.states[3]=bound(quote(4,2,'6-months'));tree=h.render();assert.equal(button(tree,/Continue to payment/).props.disabled,false);
  assert.match(text(tree),/\$111\.50|Aug 1, 2026/);
  h.states[0]=5;tree=h.render();assert.equal(button(tree,/Continue to payment/).props.disabled,true);
});

test('changed source capacity, cycle or expiry cannot reuse a previously valid quote',()=>{
  const h=harness();
  for(const props of [{currentConnections:4},{currentUsers:2},{currentBillingCycle:'3-months'},{currentPeriodEnd:'2026-03-01T00:00:00Z'}]){
    assert.equal(button(h.render(props),/Continue to payment/).props.disabled,true);
  }
});
