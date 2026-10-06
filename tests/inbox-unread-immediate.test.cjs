const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('components/inbox/inbox-view.tsx','utf8');
const parsed=ts.createSourceFile('inbox.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='markConversationReadRealtime')handler=n;ts.forEachChild(n,visit);}visit(parsed);
function setup(){let rows=[{id:'a',last_message_at:'2026-10-02T01:00:00Z',unread_count:0},{id:'b',unread_count:2}],release,refreshes=0;
 const ref=v=>({current:v});const context={document:{visibilityState:'visible',hasFocus:()=>true},manualUnreadConversationIdsRef:ref(new Set()),readInFlightRef:ref(new Set()),readPromisesRef:ref(new Map()),pendingReadIdsRef:ref(new Set(['a'])),pendingReadCountsRef:ref(new Map([['a',3]])),readBarrierMessageTimeRef:ref(new Map()),readRowVersionRef:ref(new Map()),liveConversations:rows,setLiveConversations:fn=>rows=fn(rows),rowTime:v=>Date.parse(v)||0,fetch:()=>new Promise((resolve,reject)=>release={resolve,reject}),router:{refresh:()=>refreshes++},console:{error:()=>{}}};
 vm.createContext(context);vm.runInContext(ts.transpileModule(handler.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return {context,rows:()=>rows,update:fn=>rows=fn(rows),release:()=>release,refreshes:()=>refreshes};}
test('failed read restores only its unread count; current selection and other conversations remain untouched',async()=>{const d=setup(),p=d.context.markConversationReadRealtime('a');d.release().reject(Error('offline'));await p;assert.equal(d.rows()[0].unread_count,3);assert.equal(d.rows()[1].unread_count,2);assert.equal(d.refreshes(),1);assert.equal(d.context.pendingReadCountsRef.current.size,0);});
test('newer customer message and manual-unread edits survive an older failed read',async()=>{for(const unread of [0,5]){const d=setup(),p=d.context.markConversationReadRealtime('a');d.update(rows=>rows.map(r=>r.id==='a'?{...r,last_message_at:'2026-10-02T01:01:00Z',unread_count:unread}:r));d.release().reject(Error('offline'));await p;assert.equal(d.rows()[0].unread_count,unread);}});
test('successful read does not clear a newer incoming unread count',async()=>{const d=setup(),p=d.context.markConversationReadRealtime('a');d.update(rows=>rows.map(r=>r.id==='a'?{...r,unread_count:1,last_message_at:'2026-10-02T01:01:00Z'}:r));d.release().resolve({ok:true,text:async()=>JSON.stringify({success:true,conversation:{updated_at:'2026-10-02T01:00:00Z'}})});await p;assert.equal(d.rows()[0].unread_count,1);assert.equal(d.refreshes(),0);});

test('an in-flight read exposes one promise that settles when the read does (Mark Unread awaits it)', async () => {
 const t = setup(); const pending = t.context.markConversationReadRealtime('a');
 const promise = t.context.readPromisesRef.current.get('a');
 assert.ok(promise, 'tracked while in flight');
 let settled = false; promise.then(() => { settled = true; });
 await Promise.resolve(); assert.equal(settled, false, 'not before the server answers');
 t.release().resolve(Response.json({ success: true, conversation: { id: 'a', unread_count: 0, updated_at: '2026-10-02T01:00:01Z' } }));
 await pending; await promise;
 assert.equal(settled, true);
 assert.equal(t.context.readPromisesRef.current.has('a'), false, 'released afterwards');
});
