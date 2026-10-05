const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { loader, hooks, nodes } = require('./inbox-recovery-harness.cjs');
const { searchSnippet, searchRowSubtitle } = loader()('lib/inbox/search-match.ts');

test('historical message takes priority over unrelated latest preview; contact-only phone has no invented target', () => {
  const match = { messageId: 'historical', text: 'Call 012345678 tomorrow', sentAt: null };
  assert.equal(searchRowSubtitle('012345678', match, '012345678', '🙂 RECEIVE'), match.text);
  assert.equal(searchRowSubtitle('012345678', undefined, '012345678', '🙂 RECEIVE'), '012345678');
  assert.equal(searchRowSubtitle('Jane', undefined, '012345678', 'Latest message'), 'Latest message');
  assert.ok(searchSnippet('before '.repeat(80) + '012345678' + ' after'.repeat(80), '012345678').includes('012345678'));
});

test('batched history matches are scoped, newest and not crowded out by prolific threads', async () => {
  const rows = Array.from({ length: 1000 }, (_, n) => ({ id: 'a' + n, conversation_id: 'a', business_id: 'b1', message_text: '012345678', platform_created_at: String(2000-n) }));
  rows.push({ id: 'old-b', conversation_id: 'b', business_id: 'b1', message_text: 'call 012345678', platform_created_at: '0001' });
  rows.unshift({ id: 'foreign', conversation_id: 'b', business_id: 'b2', message_text: '012345678', platform_created_at: '9999' });
  const calls = [];
  const db = { from() {
    let result = rows.slice(), max = Infinity;
    const q = { select() { return q; }, in(key, values) { result = result.filter(row => values.includes(row[key])); return q; },
      ilike(key, value) { calls.push(value); result = result.filter(row => row[key].includes(value.slice(1,-1))); return q; },
      order() { return q; }, limit(n) { max=n; return q; }, then(resolve) { return Promise.resolve({ data: result.slice(0,max), error: null }).then(resolve); } };
    return q;
  } };
  const { getSearchMatches } = loader({ '@/lib/supabase/admin': { supabaseAdmin: db } })('lib/inbox/get-search-matches.ts');
  const result = await getSearchMatches('012345678', [{ id: 'a', business_id: 'b1' }, { id: 'b', business_id: 'b1' }]);
  assert.equal(result.a.messageId, 'a0'); assert.equal(result.b.messageId, 'old-b'); assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(await getSearchMatches('01', [{ id: 'a', business_id: 'b1' }])), []);
});

test('avatar remount starts with the candidate that loaded; a different identity tries its own photo', () => {
  let h = hooks();
  const React = new Proxy({}, { get(_target, key) { return h.React[key]; } });
  const load = loader({ react: React, 'react/jsx-runtime': h.jsx });
  const { CustomerAvatar } = load('components/customer-avatar.tsx');
  const props = { contactId: 'c1', platform: 'facebook', src: 'https://example.test/photo', name: 'Jane' };
  const outer = CustomerAvatar(props);
  let tree = h.render(outer.type, outer.props), img = nodes(tree, n => n.type === 'img')[0];
  assert.equal(img.props.src, '/api/contacts/c1/facebook-avatar'); img.props.onError();
  tree = h.render(outer.type, outer.props); img = nodes(tree, n => n.type === 'img')[0];
  assert.equal(img.props.src, props.src); img.props.onLoad(); h.cleanup(); h = hooks();
  const again = CustomerAvatar(props); img = nodes(h.render(again.type, again.props), n => n.type === 'img')[0];
  assert.equal(img.props.src, props.src); h.cleanup(); h = hooks();
  const changed = CustomerAvatar({ ...props, contactId: 'c2' });
  assert.equal(nodes(h.render(changed.type, changed.props), n => n.type === 'img')[0].props.src, '/api/contacts/c2/facebook-avatar');
});

function jumpHarness({ cancel = false } = {}) {
  const source = fs.readFileSync('components/inbox/message-panel.tsx', 'utf8');
  const ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'jumpToTelegramReplyTarget') expression = node.initializer.getText(ast); ts.forEachChild(node, visit); };
  visit(ast);
  let loads = 0, highlighted = null, scrolled = false;
  const controller = new AbortController(), current = { current: [] }, conversation = { current: 'c1' };
  const target = { id: 'deep', conversation_id: 'c1' };
  const scope = {
    useCallback: fn => fn, jumpConversationRef: conversation, latestMessagesRef: current, photoGroups: new Map(),
    hasMoreOlderMessagesRef: { current: true }, resolvePhotoReplyTarget: (rows,id,conv) => rows.find(row => row.id===id && row.conversation_id===conv),
    onLoadOlderMessages: async () => { loads++; if (cancel) controller.abort(); if (loads === 15) current.current.push(target); return true; },
    window: { requestAnimationFrame: fn => queueMicrotask(fn), setTimeout() {} },
    messageElementRefs: { current: new Map([['deep', { scrollIntoView() { scrolled=true; } }]]) },
    photoElementRefs: { current: new Map() }, deferredMessageRefs: { current: new Map() },
    userNearBottomRef: { current: true }, setShowScrollToLatest() {}, setJumpHighlightedMessageId: value => { highlighted=value; },
    showActionNotice() {},
  };
  scope.loadOlderForJumpRef = { current: scope.onLoadOlderMessages };
  const code = ts.transpileModule('const run = ' + expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.createContext(scope); vm.runInContext(code, scope);
  return { scope, controller, invoke: options => vm.runInContext('run', scope)(options), run: () => vm.runInContext('run', scope)({ localMessageId: 'deep', platformMessageId: null, search: true, signal: controller.signal }), result: () => ({ loads, highlighted, scrolled }) };
}
test('search jump reaches history beyond the old twelve-page limit and highlights the exact message', async () => {
  const h=jumpHarness(); await h.run(); assert.deepEqual(h.result(), { loads:15, highlighted:'deep', scrolled:true });
});
test('superseded search jump stops without scrolling or highlighting', async () => {
  const h=jumpHarness({ cancel:true }); await h.run(); assert.deepEqual(h.result(), { loads:1, highlighted:null, scrolled:false });
});

test('older-page client cursor uses recovered platform time and excludes another conversation', async () => {
  const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8');
  const ast=ts.createSourceFile('view.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let declaration; const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='loadOlderMessagePage')declaration=node.getText(ast);ts.forEachChild(node,visit);};visit(ast);
  let requested;
  const scope={resolvedActiveConversationId:'c1',hasMoreOlderMessages:true,loadingOlderMessages:false,
    loadOlderInFlightRef:{current:false},desiredConversationIdRef:{current:'c1'},
    liveMessages:[{id:'old',conversation_id:'c1',platform_created_at:'2025-01-02T00:00:00Z',created_at:'2026-10-02T00:00:00Z'}],
    setHasMoreOlderMessages(){},setLoadingOlderMessages(){},setOlderMessagesError(){},
    MESSAGE_PAGE_SIZE:25,URLSearchParams,fetch:async url=>{requested=new URL(url,'https://fixture.test');return{};},
    readMessagePageResponse:async()=>({messages:[],hasMore:false}),console:{error(){}},
  };
  vm.createContext(scope);vm.runInContext(ts.transpileModule(declaration,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
  await vm.runInContext('loadOlderMessagePage()',scope);
  assert.equal(requested.searchParams.get('beforeCreatedAt'),'2025-01-02T00:00:00Z');
  assert.equal(requested.searchParams.get('beforeId'),'old');
});

test('Auto detect number still fills only an empty incoming contact phone and preserves agent edits', async () => {
  const { database, baseSeed } = require('./tenh-seven/harness.cjs');
  const seed=baseSeed(),db=database(seed),activities=[];
  const { saveDetectedCustomerPhone }=loader({ '@/lib/supabase/admin':{supabaseAdmin:db},
    '@/lib/inbox/create-conversation-activity':{createConversationActivity:async value=>activities.push(value)},
  })('lib/inbox/save-detected-customer-phone.ts');
  const input={businessId:'b1',contactId:'c1',conversationId:'conv1',messageId:'mid',text:'Call 012345678',incoming:false};
  await saveDetectedCustomerPhone(input);assert.equal(db.history.length,0);
  await saveDetectedCustomerPhone({...input,incoming:true});assert.equal(db.tables.contacts[0].phone,'+85512345678');assert.equal(activities.length,1);
  db.tables.contacts[0].phone='+855961234567';
  await saveDetectedCustomerPhone({...input,incoming:true});assert.equal(db.tables.contacts[0].phone,'+855961234567');assert.equal(activities.length,1);
});


test('same-thread replacement jump joins the pending page and cancelled owner settles before the page', async () => {
 const h=jumpHarness();let release,requests=0,notices=[];
 h.scope.showActionNotice=notice=>notices.push(notice);
 const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8');
 const ast=ts.createSourceFile('view.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let wrapper;const visit=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='handleLoadOlderMessages')wrapper=node.getText(ast);ts.forEachChild(node,visit);};visit(ast);
 const flightScope={setLoadingOlderMessages(){},resolvedActiveConversationId:'c1',olderMessageFlightRef:{current:new Map()},loadOlderMessagePage:()=>{requests++;return new Promise(resolve=>{release=()=>{h.scope.latestMessagesRef.current.push({id:'deep',conversation_id:'c1'});resolve(true);};});}};
 vm.createContext(flightScope);vm.runInContext(ts.transpileModule(wrapper,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,flightScope);
 h.scope.loadOlderForJumpRef.current=vm.runInContext('handleLoadOlderMessages',flightScope);
 const old=h.invoke({localMessageId:'missing-old',platformMessageId:null,search:true,signal:h.controller.signal});
 h.controller.abort();
 assert.equal(await Promise.race([old.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),150))]),true,'cancel must settle without waiting for the network');
 const replacement=h.invoke({localMessageId:'deep',platformMessageId:null,search:true,signal:new AbortController().signal});
 assert.equal(requests,1,'replacement should join the same pending page');release();await replacement;
 assert.equal(h.result().highlighted,'deep');assert.equal(h.result().scrolled,true);assert.deepEqual(notices,[]);
});


function ownedHistoryHarness() {
 const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8'),ast=ts.createSourceFile('view.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions=[];
 const visit=node=>{if(ts.isFunctionDeclaration(node)&&['handleLoadOlderMessages','loadOlderMessagePage'].includes(node.name?.text))functions.push(node.getText(ast));ts.forEachChild(node,visit);};visit(ast);
 const releases=new Map(),requests=[],state={messages:[],loading:false,error:null,more:true};
 const scope={resolvedActiveConversationId:'A',olderMessageFlightRef:{current:new Map()},desiredConversationIdRef:{current:'A'},hasMoreOlderMessages:true,liveMessages:[],MESSAGE_PAGE_SIZE:25,URLSearchParams,
 setHasMoreOlderMessages:value=>state.more=value,setLoadingOlderMessages:value=>state.loading=value,setOlderMessagesError:value=>state.error=value,
 setLiveMessages:update=>{state.messages=update(state.messages);scope.liveMessages=state.messages;},messageOrderMs:message=>Date.parse(message.platform_created_at??message.created_at),
 fetch:url=>{const conversation=url.match(/conversations\/([^/]+)/)[1];requests.push(conversation);return new Promise((resolve,reject)=>releases.set(conversation,{resolve,reject}));},readMessagePageResponse:async response=>response,console:{error(){}}};
 vm.createContext(scope);vm.runInContext(ts.transpileModule(functions.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);
 const select=conversation=>{scope.resolvedActiveConversationId=conversation;scope.desiredConversationIdRef.current=conversation;state.loading=false;state.error=null;state.more=true;scope.liveMessages=state.messages=[{id:conversation+'-latest',conversation_id:conversation,created_at:'2026-10-02T00:00:00Z',platform_created_at:'2026-10-02T00:00:00Z'}];};
 select('A');return {scope,state,requests,select,load:()=>vm.runInContext('handleLoadOlderMessages()',scope),release:(conversation,error=false)=>error?releases.get(conversation).reject(Error('old failed')):releases.get(conversation).resolve({messages:[{id:conversation+'-older',conversation_id:conversation,created_at:'2026-10-01T00:00:00Z',platform_created_at:'2026-10-01T00:00:00Z'}],hasMore:false})};
}
for(const failA of [false,true])test('A completion cannot change pending B history, loading or errors '+(failA?'(failure)':'(success)'),async()=>{
 const h=ownedHistoryHarness(),a=h.load();h.select('B');const b=h.load();assert.deepEqual(h.requests,['A','B']);h.release('A',failA);await a;
 assert.equal(h.state.loading,true);assert.equal(h.state.error,null);assert.deepEqual(Array.from(h.state.messages,row=>row.id),['B-latest']);assert.equal(h.scope.olderMessageFlightRef.current.has('B'),true);
 h.release('B');assert.equal(await b,true);assert.equal(h.state.loading,false);assert.deepEqual(Array.from(h.state.messages,row=>row.id),['B-older','B-latest']);assert.equal(h.scope.olderMessageFlightRef.current.size,0);
});
test('repeated A -> B -> A joins A flight; B cleanup cannot clear A ownership',async()=>{
 const h=ownedHistoryHarness(),a=h.load();h.select('B');const b=h.load();h.select('A');const again=h.load();assert.equal(h.state.loading,true);assert.deepEqual(h.requests,['A','B']);
 h.release('B');await b;assert.equal(h.scope.olderMessageFlightRef.current.has('A'),true);assert.deepEqual(Array.from(h.state.messages,row=>row.id),['A-latest']);
 h.release('A');assert.equal(await a,true);assert.equal(await again,true);assert.deepEqual(Array.from(h.state.messages,row=>row.id),['A-older','A-latest']);assert.equal(h.scope.olderMessageFlightRef.current.size,0);
});
