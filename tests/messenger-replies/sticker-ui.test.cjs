const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const req=require('node:module').createRequire(path.resolve(__dirname,'../../package.json'));
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://app.tenhchat.com'});
global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
const React=req('react'),{act}=React,{createRoot}=req('react-dom/client'),{loader}=require('../tenh-seven/harness.cjs');
const icon=()=>React.createElement('i');
let calls=[],observers=[],sendResult,sent=0,timeNow=Date.now();
dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
class Observer {
 constructor(callback){this.callback=callback;this.targets=[];observers.push(this)}
 observe(target){this.targets.push(target)}disconnect(){}
 visible(...ids){this.callback(this.targets.map(target=>({target,isIntersecting:ids.includes(target.dataset.packId)})))}
}
const load=loader({react:React,'react/jsx-runtime':req('react/jsx-runtime'),'lucide-react':{ChevronLeft:icon,ChevronRight:icon,Clock:icon,Loader2:icon,Search:icon,X:icon}},{Date:class extends Date{static now(){return timeNow}},AbortController,URLSearchParams,window:dom.window,document:dom.window.document,Event:dom.window.Event,localStorage:dom.window.localStorage,IntersectionObserver:Observer,CSS:{escape:s=>s},fetch:async(url,init)=>new Promise(resolve=>calls.push({url,init,resolve}))});
const {MetaStickerGrid}=load('components/inbox/meta-sticker-grid.tsx');
const recents=load('lib/stickers/meta-sticker-recents.ts');
let root=createRoot(document.getElementById('root'));
const render=async({id='conv1',businessId='b1',disabled=false}={})=>act(async()=>root.render(React.createElement(MetaStickerGrid,{conversationId:id,businessId,disabled,onSend:async()=>{sent++;return new Promise(resolve=>sendResult=resolve)},onSent(){}})));
const tick=async(ms=50)=>act(async()=>new Promise(resolve=>setTimeout(resolve,ms)));
const resolve=async(call,data)=>act(async()=>call.resolve(Response.json(data)));
const type=async(value)=>act(async()=>{const input=document.querySelector('input');Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
const sticker=(id,label='Cat')=>({provider:'meta',stickerId:id,label,previewUrl:'https://example.com/'+id+'.png',packId:'123',width:240,height:240,animated:false});
const click=async(selector)=>act(async()=>document.querySelector(selector).dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true})));

test('picker loads only visible single-sticker covers, records an unmounted successful send, and ignores failed/stale results',async()=>{
 await render();assert.equal(calls.length,1);
 await resolve(calls[0],{success:true,packs:[{packId:'123',name:'Cats',previewUrl:'https://example.com/collage.png'},{packId:'456',name:'Dogs',previewUrl:'https://example.com/dog-collage.png'}]});
 await tick();assert.equal(document.querySelector('[title="Cats"] img'),null,'never render the composite pack sheet');
 await act(async()=>observers.at(-1).visible('recent','123'));await tick();
 const coverCall=calls.find(c=>c.url.includes('/previews'));assert.equal(new URL(coverCall.url,'https://app.tenhchat.com').searchParams.get('packIds'),'123');
 await resolve(coverCall,{success:true,previews:[{packId:'123',sticker:sticker('11')}]});assert.equal(document.querySelector('[title="Cats"] img').src,'https://example.com/11.png');assert.equal(document.querySelector('[title="Dogs"] img'),null);
 const packCall=calls.find(c=>c.url.includes('/pack?'));await resolve(packCall,{success:true,stickers:[sticker('11')]});
 await click('[aria-label="Send sticker: Cat"]');assert.equal(sent,1);
 await act(async()=>root.unmount());await act(async()=>sendResult(true));
 assert.equal(recents.readMetaStickerRecents('b1')[0].stickerId,'11','confirmed send persisted after picker closes');
 root=createRoot(document.getElementById('root'));await render();assert.ok(document.querySelector('[aria-label="Send sticker: Cat"]'),'Recents appears on reopening');
 assert.equal(document.querySelector('[aria-label="Recently sent stickers"]').getAttribute('aria-selected'),'true');
 await type('love');await tick(280);const search=calls.filter(c=>c.url.includes('/search')).at(-1);await resolve(search,{success:true,stickers:[sticker('12','Love')]});
 await click('[aria-label="Send sticker: Love"]');await act(async()=>sendResult(false));assert.equal(recents.readMetaStickerRecents('b1').some(s=>s.stickerId==='12'),false,'failed send not remembered');
 await type('happy');await tick(280);const stale=calls.filter(c=>c.url.includes('/search')).at(-1);
 await render({id:'conv2',businessId:'b2'});await resolve(stale,{success:true,stickers:[sticker('99','Wrong chat')]});assert.equal(document.querySelector('[aria-label="Send sticker: Wrong chat"]'),null);assert.equal(recents.readMetaStickerRecents('b2').length,0,'workspace recents stay separate');
 await act(async()=>root.unmount());
});

test('recent history is ordered, deduplicated and excludes incoming, failed and other-chat stickers',()=>{
 const row=(id,stickerId,offset=0,patch={})=>({id,conversation_id:'history',direction:'outgoing',platform_message_id:'mid-'+id,created_at:new Date(Date.now()+offset).toISOString(),attachment_url:'https://example.com/'+stickerId+'.png',raw_payload:{tenh_meta_sticker:{sticker_id:stickerId}},...patch});
 recents.rememberMetaStickerMessages('history-business','history',[row('one','1'),row('two','2',1000),row('three','1',2000),row('in','3',3000,{direction:'incoming'}),row('optimistic:failed','4',4000),row('foreign','5',5000,{conversation_id:'other'})]);
 assert.deepEqual(Array.from(recents.readMetaStickerRecents('history-business'),s=>s.stickerId),['1','2']);
 // Recreate the module to model a reload: history survives without a server query.
 const reloaded=loader({}, {localStorage:dom.window.localStorage})('lib/stickers/meta-sticker-recents.ts');assert.deepEqual(Array.from(reloaded.readMetaStickerRecents('history-business'),s=>s.stickerId),['1','2']);
});

test('reopening cached pack content makes no request or loading flash; stale refresh keeps it visible',async()=>{
 root=createRoot(document.getElementById('root'));const start=calls.length;
 await render({businessId:'cache-test',id:'cache-conv'});await resolve(calls[start],{success:true,packs:[{packId:'789',name:'Cached pack'}]});await tick();
 await resolve(calls.find((call,index)=>index>=start&&call.url.includes('/pack?')),{success:true,stickers:[{...sticker('7891','Cached sticker'),packId:'789'}]});
 await act(async()=>root.unmount());const loadedCount=calls.length;
 root=createRoot(document.getElementById('root'));await render({businessId:'cache-test',id:'another-conversation'});
 assert.ok(document.querySelector('[aria-label="Send sticker: Cached sticker"]'));assert.equal(document.querySelector('[role="status"]'),null);
 await act(async()=>observers.at(-1).visible('789'));await tick();assert.equal(calls.length,loadedCount,'fresh cache needs no network across conversations');
 assert.equal(document.querySelector('[title="Cached pack"] img').src,'https://example.com/7891.png');
 await click('[aria-label="Recently sent stickers"]');await click('[title="Cached pack"]');await tick();assert.equal(calls.length,loadedCount);assert.ok(document.querySelector('[aria-label="Send sticker: Cached sticker"]'));
 await act(async()=>root.unmount());timeNow+=6*60*60_000+1;
 root=createRoot(document.getElementById('root'));await render({businessId:'cache-test',id:'cache-conv'});await tick();
 assert.ok(document.querySelector('[aria-label="Send sticker: Cached sticker"]'),'expired metadata remains visible during refresh');assert.equal(document.querySelector('[role="status"]'),null);
 const refreshes=calls.slice(loadedCount);assert.equal(refreshes.length,2);
 for(const call of refreshes)await resolve(call,{success:false,error:'Offline'});
 assert.ok(document.querySelector('[aria-label="Send sticker: Cached sticker"]'));assert.equal(document.querySelector('[role="alert"]'),null);
 await act(async()=>root.unmount());
});

test('closing and reopening during the initial load shares the pending request',async()=>{
 root=createRoot(document.getElementById('root'));const start=calls.length;
 await render({businessId:'warm-test',id:'warm-conv'});await act(async()=>root.unmount());
 root=createRoot(document.getElementById('root'));await render({businessId:'warm-test',id:'warm-conv'});assert.equal(calls.length,start+1);
 await resolve(calls[start],{success:true,packs:[{packId:'987',name:'Warm pack'}]});await tick();assert.ok(document.querySelector('[title="Warm pack"]'));
 const itemCall=calls.at(-1);assert.ok(itemCall.url.includes('/pack?'));
 await act(async()=>root.unmount());await resolve(itemCall,{success:true,stickers:[sticker('9871','Warm sticker')]});const count=calls.length;
 root=createRoot(document.getElementById('root'));await render({businessId:'warm-test',id:'warm-conv'});await tick();assert.equal(calls.length,count);assert.ok(document.querySelector('[aria-label="Send sticker: Warm sticker"]'));
 await act(async()=>root.unmount());
});
