const test=require('node:test'),assert=require('node:assert/strict');
const {loader}=require('../tenh-seven/harness.cjs');
const pack={packId:'123',name:'Cats',previewUrl:'https://example.com/sheet.png'};
const sticker={provider:'meta',stickerId:'11',label:'Hello',packId:'123',previewUrl:'https://example.com/cat.png',width:240,height:240,animated:false};
function setup({brokenStorage=false,stored=new Map()}={}){
 let clock=Date.now();const calls=[];
 const storage={getItem:key=>{if(brokenStorage)throw Error('Unavailable');return stored.get(key)||null},setItem:(key,value)=>{if(brokenStorage)throw Error('Quota');stored.set(key,value)}};
 const load=()=>loader({}, {window:{},localStorage:storage,URLSearchParams,Date:class extends Date{static now(){return clock}},fetch:async(url,init)=>new Promise(resolve=>calls.push({url,init,resolve}))})('lib/stickers/meta-sticker-cache.ts');
 return {api:load(),reload:load,calls,stored,advance:ms=>clock+=ms,resolve:(call,value,status=200)=>call.resolve(Response.json(value,{status}))};
}
test('fresh catalogs, pack contents and individual previews survive reopening and browser reload',async()=>{
 const h=setup(),index=h.api.loadMetaStickerPacks('b1','conv1');h.resolve(h.calls[0],{success:true,packs:[pack]});await index;
 const items=h.api.loadMetaStickerItems('b1','conv1','123','');h.resolve(h.calls[1],{success:true,stickers:[sticker]});await items;
 const reloaded=h.reload();assert.equal(reloaded.readMetaStickerCache('b1','pack:123').value[0].stickerId,'11');
 assert.equal((await reloaded.loadMetaStickerPacks('b1','another-conversation'))[0].packId,'123');
 assert.equal((await reloaded.loadMetaStickerItems('b1','another-conversation','123',''))[0].stickerId,'11');
 assert.equal((await reloaded.loadMetaStickerPreviews('b1','another-conversation',['123']))['123'].stickerId,'11');assert.equal(h.calls.length,2,'no repeat catalog, pack or preview requests');
 assert.equal(reloaded.readMetaStickerCache('b2','packs'),null,'no workspace cache mixing');
});
test('duplicate in-flight loads share one request and are cached when the consumer closes',async()=>{
 const h=setup();const first=h.api.loadMetaStickerPacks('b1','first');const second=h.api.loadMetaStickerPacks('b1','second');assert.equal(first,second);assert.equal(h.calls.length,1);
 h.resolve(h.calls[0],{success:true,packs:[pack]});await Promise.all([first,second]);assert.equal(h.api.readMetaStickerCache('b1','packs').fresh,true);
});
test('stale data is available immediately, refresh failure preserves it, and the next retry succeeds',async()=>{
 const h=setup();const first=h.api.loadMetaStickerItems('b1','conv1','123','');h.resolve(h.calls[0],{success:true,stickers:[sticker]});await first;
 h.advance(6*60*60_000+1);assert.equal(h.api.readMetaStickerCache('b1','pack:123').fresh,false);
 const refresh=h.api.loadMetaStickerItems('b1','conv1','123','');assert.equal(h.api.readMetaStickerCache('b1','pack:123').value[0].stickerId,'11');h.resolve(h.calls[1],{success:false,error:'Offline'},503);await assert.rejects(refresh,/Offline/);
 assert.equal(h.api.readMetaStickerCache('b1','pack:123').value[0].stickerId,'11');
 const retry=h.api.loadMetaStickerItems('b1','conv1','123','');h.resolve(h.calls[2],{success:true,stickers:[{...sticker,stickerId:'12'}]});await retry;assert.equal(h.api.readMetaStickerCache('b1','pack:123').fresh,true);
 h.advance(8*24*60*60_000);assert.equal(h.api.readMetaStickerCache('b1','pack:123'),null);
});
test('search caching avoids duplicate queries without persisting search text',async()=>{
 const h=setup();const first=h.api.loadMetaStickerItems('b1','conv1','123','love');h.resolve(h.calls[0],{success:true,stickers:[sticker]});await first;
 await h.api.loadMetaStickerItems('b1','conv1','123','love');assert.equal(h.calls.length,1);assert.equal(h.reload().readMetaStickerCache('b1','search:love'),null);
 h.advance(5*60_000+1);assert.equal(h.api.readMetaStickerCache('b1','search:love').fresh,false);
});
test('storage failures keep an in-memory cache; malformed data and failed responses are not cached',async()=>{
 const h=setup({brokenStorage:true});const first=h.api.loadMetaStickerPacks('b1','conv1');h.resolve(h.calls[0],{success:true,packs:[pack]});await first;await h.api.loadMetaStickerPacks('b1','conv2');assert.equal(h.calls.length,1);
 h.api.invalidateMetaStickerCache('b1',['packs']);const bad=h.api.loadMetaStickerPacks('b1','conv1');h.resolve(h.calls[1],{success:true,packs:[{packId:'123',name:{bad:true}}]});await assert.rejects(bad);assert.equal(h.api.readMetaStickerCache('b1','packs'),null);
 const corrupt=setup({stored:new Map([['tenh:messenger-sticker-catalog:v1:b1','{broken']])});assert.equal(corrupt.api.readMetaStickerCache('b1','packs'),null);
});
test('explicit retry invalidates one resource while retaining other cached packs',async()=>{
 const h=setup();for(const id of ['123','456']){const pending=h.api.loadMetaStickerItems('b1','conv1',id,'');h.resolve(h.calls.at(-1),{success:true,stickers:[{...sticker,packId:id}]});await pending}
 h.api.invalidateMetaStickerCache('b1',['pack:123']);assert.equal(h.api.readMetaStickerCache('b1','pack:123'),null);assert.equal(h.api.readMetaStickerCache('b1','pack:456').fresh,true);
});
