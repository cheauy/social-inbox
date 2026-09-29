const test=require('node:test'),assert=require('node:assert/strict');
const {loader,base,uuid,setup,hooks,nodes,tick}=require('./inbox-recovery-harness.cjs');
const helper=loader()('lib/facebook/post-preview-data.ts');
test('failed/partial post lookup never erases saved text or an existing image',()=>{
 const old={id:'p_1',message:'Saved Khmer caption',full_picture:'https://scontent.fbcdn.net/old.jpg'};
 const data=helper.mergePostPreview(old,{message:null,full_picture:null},'p_1');assert.equal(data.message,old.message);assert.equal(data.full_picture,old.full_picture);assert.match(data.permalink_url,/facebook.com/);
});
test('fresh post image replaces the saved URL while preserving existing text',()=>{
 const data=helper.mergePostPreview({message:'Caption',full_picture:'https://scontent.fbcdn.net/old.jpg'},{full_picture:'https://scontent.fbcdn.net/new.jpg'},'p_1');assert.equal(data.message,'Caption');assert.equal(data.full_picture,'https://scontent.fbcdn.net/new.jpg');
});
for(const src of ['javascript:alert(1)','data:image/svg+xml,x','http://insecure.test/image','https://user:password@example.test/x'])test('post media rejects unsafe source '+src,()=>assert.equal(helper.safePostImage(src),null));
test('post link only allows Facebook origins, never a stored javascript or deceptive host',()=>{
 for(const url of ['javascript:alert(1)','https://facebook.com.evil.test/x','https://facebook.com@evil.test','https://evil.test'])assert.equal(helper.safePostLink(url),null);
 assert.equal(helper.safePostLink('https://www.facebook.com/page/posts/1'),'https://www.facebook.com/page/posts/1');
});
function previewSetup(opts={}){const seed=base();seed.messages=[{id:uuid(11),business_id:'b1',conversation_id:uuid(1),platform_message_id:'comment1',message_type:'text',raw_payload:{item:'comment',comment_id:'comment1',post_id:'page1_post1',post_preview:{id:'page1_post1',message:'Saved caption',full_picture:'https://scontent.fbcdn.net/old.jpg'}}}];if(opts.payload!==undefined)seed.messages[0].raw_payload=opts.payload;if(opts.messagePatch)Object.assign(seed.messages[0],opts.messagePatch);if(opts.accountPatch)Object.assign(seed.social_accounts[0],opts.accountPatch);return setup({...opts,seed});}
async function call(h,params={}){const r=await h.load('app/api/facebook/post-preview/route.ts').GET(h.getRequest({conversationId:uuid(1),messageId:uuid(11),...params}));return {status:r.status,...await r.json()};}
test('post preview resolves context from authorized message and cannot be redirected by client URL or post ID',async()=>{
 const h=previewSetup({preview:{id:'page1_post1',full_picture:'https://scontent.fbcdn.net/new.jpg'}}),result=await call(h,{postId:'OTHER',url:'http://127.0.0.1/private',refresh:'1'});
 assert.equal(result.status,200);assert.equal(result.preview.message,'Saved caption');assert.equal(h.previewCalls[0][0],'page1_post1');assert.equal(h.previewCalls[0][1],'page1');assert.equal(h.previewCalls[0][2].refresh,true);assert.equal(h.db.history.some(q=>q.op!=='read'),false);
});
for(const payload of [{item:'comment',comment_id:'c'},{source:'facebook_comment_reply',reply_comment_id:'c'},{tenh_source:'facebook_page_reply',parent_comment_id:'c'},{post_id:'page1_post1'},{source:'facebook_comment',comment_id:'c'}])test('recognizes stored comment shape '+JSON.stringify(payload),async()=>{
 const h=previewSetup({payload,resolvedPost:'page1_post1'}),r=await call(h);assert.equal(r.status,200);assert.equal(h.previewCalls.length,1);
});
test('missing post ID is recovered through the authorized comment only',async()=>{
 const h=previewSetup({payload:{item:'comment',comment_id:'c123'},resolvedPost:'p_123'}),r=await call(h);assert.equal(r.status,200);assert.equal(h.lookupCalls[0][0],'c123');assert.equal(h.lookupCalls[0][1],'page1');assert.equal(r.preview.id,'p_123');
});
test('transient Graph absence returns saved content; endpoint never writes raw_payload',async()=>{
 const h=previewSetup(),r=await call(h);assert.equal(r.preview.message,'Saved caption');assert.equal(r.available,false);assert.equal(h.db.history.some(q=>q.op==='update'),false);
});
for(const options of [{denied:true},{permissionDenied:true},{messagePatch:{business_id:'b2'}},{messagePatch:{conversation_id:uuid(2)}},{messagePatch:{comment_is_deleted:true}},{accountPatch:{facebook_token_status:'disconnected'}}])test('post lookup cannot bypass access/deletion '+JSON.stringify(options),async()=>{
 const h=previewSetup(options),r=await call(h);assert.ok([403,404].includes(r.status));assert.equal(h.previewCalls.length,0);
});
test('ordinary Messenger chat is not accepted as a comment preview request',async()=>{
 const h=previewSetup({payload:{message:{text:'hello'}}}),r=await call(h);assert.equal(r.status,400);assert.equal(h.previewCalls.length,0);
});
test('database/provider exceptions fail the preview only with retryable JSON',async()=>{
 const h=previewSetup({previewThrow:true}),r=await call(h);assert.equal(r.status,503);assert.equal(h.db.history.some(q=>q.op==='update'),false);
});
function graph(results){let calls=[],clock=Date.now();class FakeDate extends Date{static now(){return clock;}}
 const load=loader({'@/lib/facebook/get-facebook-page-access-token':{getFacebookPageAccessToken:async()=> 'TOKEN',isFacebookAccessTokenError:e=>e?.code===190,refreshFacebookPageAccessToken:async()=> 'REFRESH'}},{Date:FakeDate,console:{...console,warn(){}},fetch:async(url,init)=>{calls.push({url,init});const value=results.shift();if(value instanceof Error)throw value;return new Response(JSON.stringify(value??{}),{status:value?.error?400:200});}});
 return {api:load('lib/facebook/get-post-preview.ts'),calls,advance:ms=>clock+=ms};
}
test('concurrent same-post lookups coalesce, cached lookups avoid repeat Graph requests',async()=>{
 const h=graph([{id:'p_1',message:'caption',full_picture:'https://scontent.fbcdn.net/image.jpg'}]);const values=await Promise.all([h.api.getFacebookPostPreview('p_1','page'),h.api.getFacebookPostPreview('p_1','page')]);assert.equal(values.length,2);assert.equal(h.calls.length,1);await h.api.getFacebookPostPreview('p_1','page');assert.equal(h.calls.length,1);assert.ok(h.calls[0].init.signal instanceof AbortSignal);
});
test('failed lookups are briefly cached and can retry after expiry',async()=>{
 const h=graph([new Error('network'),{id:'p_1',full_picture:'https://scontent.fbcdn.net/new.jpg'}]);assert.equal(await h.api.getFacebookPostPreview('p_1','page'),null);await h.api.getFacebookPostPreview('p_1','page');assert.equal(h.calls.length,1);h.advance(61000);assert.ok(await h.api.getFacebookPostPreview('p_1','page'));assert.equal(h.calls.length,2);
});
test('image-failure refresh bypasses aged positive cache but coalesces a burst',async()=>{
 const h=graph([{full_picture:'https://scontent.fbcdn.net/old.jpg'},{full_picture:'https://scontent.fbcdn.net/new.jpg'}]);await h.api.getFacebookPostPreview('p_1','page');h.advance(31000);const result=await h.api.getFacebookPostPreview('p_1','page',{refresh:true});assert.match(result.full_picture,/new.jpg/);await h.api.getFacebookPostPreview('p_1','page',{refresh:true});assert.equal(h.calls.length,2);
});
test('attachment fallback finds album images and never mistakes video source for a photo',async()=>{
 const h=graph([{message:'post'},{attachments:{data:[{media:{source:'https://video.fbcdn.net/video.mp4'},subattachments:{data:[{media:{image:{src:'https://scontent.fbcdn.net/photo.jpg'}}}]}}]}}]);const result=await h.api.getFacebookPostPreview('p','page');assert.equal(result.full_picture,'https://scontent.fbcdn.net/photo.jpg');
 const video=graph([{}, {attachments:{data:[{media:{source:'https://video.fbcdn.net/video.mp4'}}]}}]);assert.equal((await video.api.getFacebookPostPreview('p','page')).full_picture,null);
});
test('cache keys separate Page accounts',async()=>{const h=graph([{full_picture:'https://scontent.fbcdn.net/a.jpg'},{full_picture:'https://scontent.fbcdn.net/b.jpg'}]);await h.api.getFacebookPostPreview('p','pageA');await h.api.getFacebookPostPreview('p','pageB');assert.equal(h.calls.length,2);});
function card(fetch){const rt=hooks(),calls=[],opened=[];const load=loader({react:rt.React,'react/jsx-runtime':rt.jsx},{AbortController,URLSearchParams,fetch:async(url,init)=>{calls.push({url,init});return fetch(url,init);}});const {FacebookPostCard}=load('components/inbox/facebook-post-card.tsx');const props={conversationId:uuid(1),messageId:uuid(11),postId:'p_1',savedPreview:{id:'p_1',message:'Saved caption',full_picture:'https://scontent.fbcdn.net/old.jpg'},accountName:'Melody Clothing',isKhmer:false,onOpenImage:i=>opened.push(i)};return {rt,calls,opened,props,render:changes=>rt.render(FacebookPostCard,{...props,...changes})};}
test('complete saved card does not fetch until image fails; broken image is removed and repaired',async()=>{
 const h=card(async()=>Response.json({success:true,preview:{full_picture:'https://scontent.fbcdn.net/new.jpg'}}));let tree=h.render();assert.equal(h.calls.length,0);nodes(tree,n=>n.type==='img')[0].props.onError();tree=h.render();assert.equal(nodes(tree,n=>n.type==='img').length,0);await tick();tree=h.render();assert.equal(h.calls.length,1);assert.match(nodes(tree,n=>n.type==='img')[0].props.src,/new.jpg/);assert.match(h.calls[0].url,/refresh=1/);h.rt.cleanup();
});
test('missing preview is automatically requested once, including permalink-only data',async()=>{
 const h=card(async()=>Response.json({success:true,preview:null}));const props={savedPreview:{id:'p_1',permalink_url:'https://facebook.com/p_1'}};h.render(props);await tick();h.render(props);h.render(props);assert.equal(h.calls.length,1);h.rt.cleanup();
});
test('failed image during initial metadata load queues exactly one recovery',async()=>{
 let release;const h=card(async()=>h.calls.length===1?new Promise(r=>release=r):Response.json({success:true,preview:{full_picture:'https://scontent.fbcdn.net/new.jpg'}}));const props={savedPreview:{full_picture:'https://scontent.fbcdn.net/old.jpg'}};let tree=h.render(props);await tick();nodes(tree,n=>n.type==='img')[0].props.onError();h.render(props);assert.equal(h.calls.length,1);release(Response.json({success:true,preview:null}));await tick();h.render(props);await tick();tree=h.render(props);assert.equal(h.calls.length,2);assert.match(nodes(tree,n=>n.type==='img')[0].props.src,/new.jpg/);h.rt.cleanup();
});
test('an inaccessible image keeps caption/link and does not enter an automatic retry loop',async()=>{
 const h=card(async()=>Response.json({success:true,preview:{full_picture:'https://scontent.fbcdn.net/old.jpg'}}));let tree=h.render();nodes(tree,n=>n.type==='img')[0].props.onError();h.render();await tick();tree=h.render();for(let i=0;i<5;i++)h.render();assert.equal(h.calls.length,1);assert.equal(nodes(tree,n=>n.type==='img').length,0);assert.ok(nodes(tree,n=>n.type==='p'&&n.props.children==='Saved caption').length);assert.ok(nodes(tree,n=>n.type==='a').length);h.rt.cleanup();
});
test('post card cleanup aborts an in-flight preview request',async()=>{
 const h=card(async(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')))));h.render({savedPreview:null});assert.equal(h.calls.length,1);h.rt.cleanup();await tick();assert.equal(h.calls[0].init.signal.aborted,true);
});
