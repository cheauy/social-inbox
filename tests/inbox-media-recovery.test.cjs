const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {loader,base,uuid,setup,hooks,nodes,tick}=require('./inbox-recovery-harness.cjs');
const source={key:'source',kind:'ad',message_id:'mid',post_id:'123_456',ad_id:'789',title:'Saved ad',image_url:'https://example.com/old.jpg'};
function card(fetch){const rt=hooks(),calls=[];const load=loader({react:rt.React,'react/jsx-runtime':rt.jsx},{URLSearchParams,AbortController,fetch:async(url,init)=>{calls.push({url,init});return fetch(url,init);}});const {MessengerSourceCard}=load('components/inbox/messenger-source-card.tsx');const props={source,conversationId:uuid(1),messageId:uuid(11),onOpenImage(){}};return {rt,calls,render:changes=>rt.render(MessengerSourceCard,{...props,...changes})};}
test('ad image failure performs one authorized recovery and does not loop on a failed replacement',async()=>{
 const h=card(async()=>Response.json({success:true,preview:{full_picture:'https://example.com/new.jpg'}}));let tree=h.render();assert.equal(h.calls.length,0);
 nodes(tree,n=>n.type==='img')[0].props.onError();h.render();await tick();tree=h.render();assert.equal(h.calls.length,1);assert.match(h.calls[0].url,/source=1/);assert.equal(nodes(tree,n=>n.type==='img')[0].props.src,'https://example.com/new.jpg');
 nodes(tree,n=>n.type==='img')[0].props.onError();tree=h.render();await tick();h.render();assert.equal(h.calls.length,1);assert.equal(nodes(tree,n=>n.type==='img').length,0);h.rt.cleanup();
});
test('missing ad photo recovers once; unmount cancels the request',async()=>{
 const h=card(async(url,init)=>new Promise(resolve=>init.signal.addEventListener('abort',()=>resolve(Response.json({success:true,preview:null})))));
 h.render({source:{...source,image_url:null}});assert.equal(h.calls.length,1);h.rt.cleanup();await tick();assert.equal(h.calls[0].init.signal.aborted,true);
});
test('ad-only referral cannot guess an image from ad ID or customer identity',async()=>{
 const h=card(async()=>{throw Error('must not fetch')});h.render({source:{...source,image_url:null,post_id:null}});assert.equal(h.calls.length,0);h.rt.cleanup();
});
test('source preview uses only the exact incoming referral and remains read-only',async()=>{
 const seed=base();seed.conversations[0].facebook_messenger_sources=[source];seed.messages=[{id:uuid(11),business_id:'b1',conversation_id:uuid(1),platform_message_id:'mid',direction:'incoming',raw_payload:null}];
 const h=setup({seed,preview:{full_picture:'https://example.com/new.jpg'}}),route=h.load('app/api/facebook/post-preview/route.ts');
 const call=()=>route.GET(h.getRequest({conversationId:uuid(1),messageId:uuid(11),source:'1',postId:'evil',refresh:'1'}));
 assert.equal((await call()).status,200);assert.equal(h.previewCalls[0][0],source.post_id);assert.equal(h.db.history.some(q=>q.op!=='read'),false);
 seed.messages[0].platform_message_id='other';const wrong=setup({seed});await wrong.load('app/api/facebook/post-preview/route.ts').GET(wrong.getRequest({conversationId:uuid(1),messageId:uuid(11),source:'1'}));assert.equal(wrong.previewCalls.length,0);
 seed.messages[0].direction='outgoing';const outgoing=setup({seed});assert.equal((await outgoing.load('app/api/facebook/post-preview/route.ts').GET(outgoing.getRequest({conversationId:uuid(1),messageId:uuid(11),source:'1'}))).status,400);
});
test('sticker normalization skips invalid/empty preferred fields and finds a valid image alias',()=>{
 const api=setup().load('lib/stickers/meta-messenger-server.ts');
 for(const raw of [{preview_url:'',image_url:'https://example.com/valid.png'},{preview_url:'javascript:bad',preview:{url:'',src:'https://example.com/valid.png'}},{preview:{url:'http://unsafe'},image:{uri:'https://example.com/valid.png'}}])assert.equal(api.normalizeMetaSticker({id:'1',...raw}).previewUrl,'https://example.com/valid.png');
});
test('server preview recovery bypasses stale metadata once and coalesces a refresh burst',async()=>{
 let calls=0;const h=setup({globals:{process:{env:{FACEBOOK_APP_ACCESS_TOKEN:'FAKE_TEST_TOKEN'}},fetch:async()=>Response.json({data:[{id:'1',image_url:`https://example.com/${++calls}.png`}]})}});
 const api=h.load('lib/stickers/meta-messenger-server.ts');await api.listMetaStickers({},'123');
 const [first,second]=await Promise.all([api.listMetaStickers({},'123',null,true),api.listMetaStickers({},'123',null,true)]);
 assert.equal(calls,2);assert.equal(first.stickers[0].previewUrl,'https://example.com/2.png');assert.equal(second.stickers[0].previewUrl,first.stickers[0].previewUrl);await api.listMetaStickers({},'123',null,true);assert.equal(calls,2);
});
test('repairing recent artwork preserves send timestamps and sticker order',()=>{
 const storage=new Map(),window=new EventTarget();const api=loader({}, {window,Event,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}})('lib/stickers/meta-sticker-recents.ts');
 api.rememberMetaSticker('b1',{provider:'meta',stickerId:'1',packId:'123',label:'Cat',previewUrl:'https://example.com/old.png'});const before=JSON.parse([...storage.values()][0]);
 api.refreshMetaStickerRecents('b1',[{...before[0].sticker,previewUrl:'https://example.com/new.png'}]);const after=JSON.parse([...storage.values()][0]);assert.equal(after[0].sentAt,before[0].sentAt);assert.equal(after[0].sticker.stickerId,'1');assert.match(after[0].sticker.previewUrl,/new.png/);
});
test('sticker image failures coalesce a pack refresh and recover only matching items',async()=>{
 const rt=hooks(),calls=[];const old={provider:'meta',stickerId:'1',packId:'123',label:'Cat',previewUrl:'https://example.com/old.png'};
 const cache={readMetaStickerCache:(business,key)=>({value:key==='packs'?[{packId:'123',name:'Cats'}]:key.startsWith('preview:')?old:[old],fresh:true}),loadMetaStickerItems:async(...args)=>{calls.push(args);return [{...old,previewUrl:'https://example.com/new.png'}]},metaStickerItemsKey:()=> 'pack:123'};
 const load=loader({react:rt.React,'react/jsx-runtime':rt.jsx,'@/lib/stickers/meta-sticker-cache':cache,'@/lib/stickers/meta-sticker-recents':{readMetaStickerRecents:()=>[],refreshMetaStickerRecents(){},META_STICKER_RECENTS_CHANGED:'recent'}},{window:new EventTarget(),localStorage:{getItem:()=>null}});
 const {MetaStickerGrid}=load('components/inbox/meta-sticker-grid.tsx');const props={businessId:'b1',conversationId:'c1',disabled:false,onSend:async()=>true,onSent(){}};
 let tree=rt.render(MetaStickerGrid,props);const preview=nodes(tree,n=>typeof n.type==='function'&&n.type.name==='StickerPreview')[0];preview.props.onFailure();preview.props.onFailure();await tick();tree=rt.render(MetaStickerGrid,props);
 assert.equal(calls.length,1);assert.equal(calls[0][4],true);assert.equal(nodes(tree,n=>typeof n.type==='function'&&n.type.name==='StickerPreview')[0].props.src,'https://example.com/new.png');rt.cleanup();
});
test('Files panel keeps collection and existing entries while removing creation controls',()=>{
 const source=fs.readFileSync('components/inbox/customer-files-modal.tsx','utf8');assert.doesNotMatch(source,/Add link|Upload file|prepare-upload|add-link|type="file"/);assert.match(source,/conversationAttachments/);assert.match(source,/CustomerFileLibrary/);assert.match(source,/onDownload/);assert.match(source,/onDelete/);assert.match(source,/postgres_changes/);
 assert.match(fs.readFileSync('components/inbox/reply-box.tsx','utf8'),/type="file"/);
});
