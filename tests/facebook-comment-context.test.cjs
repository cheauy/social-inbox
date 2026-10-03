const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { loader, base, uuid, setup, hooks, nodes, tick } = require('./inbox-recovery-harness.cjs');
const load = loader(), data = load('lib/facebook/post-preview-data.ts'), context = load('lib/facebook/comment-context-data.ts');
const source = fs.readFileSync('components/inbox/message-panel.tsx', 'utf8');
const ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['getSafeFacebookCommentGroupInfo', 'collectFacebookCommentDescendants'];
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
const grouping = new Function('facebookCommentIdentity', 'facebookCommentRenderRoot', ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nreturn {collectFacebookCommentDescendants,getSafeFacebookCommentGroupInfo};')(context.facebookCommentIdentity, context.facebookCommentRenderRoot);
const photo = (id, suffix = id) => ({ id, src: `https://scontent.fbcdn.net/${suffix}.jpg`, permalink_url: `https://www.facebook.com/verified/photos/${id}` });
const preview = { id: 'page1_post1', message: 'Original album caption', permalink_url: 'https://www.facebook.com/verified/source', full_picture: photo('a').src, photos: [photo('a'), photo('b')], attachments_complete: true, comment_object_id: 'page1_post1' };
function message(id, parent = null, patch = {}) {
  return { id, conversation_id: uuid(1), business_id: 'b1', platform_message_id: id, direction: 'incoming', message_type: 'comment', message_text: `Body ${id}`, raw_payload: { item: 'comment', comment_id: id, post_id: preview.id, parent_id: parent, post_preview: preview }, ...patch };
}
function card(props = {}, result = { success: true, preview, parent_id: props.parentId ?? null }) {
  const rt = hooks(), calls = [], opened = [];
  const api = loader({ react: rt.React, 'react/jsx-runtime': rt.jsx }, { AbortController, URLSearchParams, fetch: async (url, init) => { calls.push({ url, init }); return Response.json(result); } })('components/inbox/facebook-post-card.tsx');
  const fixed = { conversationId: uuid(1), messageId: uuid(11), postId: preview.id, savedPreview: preview, accountName: 'Page staff', isKhmer: false, onOpenImage: i => opened.push(i), ...props };
  return { rt, calls, opened, render: () => rt.render(api.FacebookPostCard, fixed) };
}
const copy = tree => Array.isArray(tree) ? tree.map(copy).join('') : typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? copy(tree.props?.children) : '';
const links = tree => nodes(tree, n => n.type === 'a').map(n => n.props.href);
function routeFixture(opts = {}) {
  const seed = base(); seed.social_accounts[0].account_name = 'Page staff'; seed.messages = [message(uuid(11), opts.parentId, { platform_message_id: 'child', raw_payload: { item: 'comment', comment_id: 'child', post_id: preview.id, parent_id: opts.parentId ?? null, post_preview: preview, ...opts.payload } })];
  seed.conversations.push({ id: uuid(2), business_id: 'b1', social_account_id: 's1' });
  if (opts.parent) seed.messages.push(message('parent-row', null, { platform_message_id: opts.parentId, conversation_id: uuid(2), ...opts.parent }));
  if (opts.conversationPatch) Object.assign(seed.conversations[1], opts.conversationPatch);
  return setup({ seed, preview, ...opts });
}
async function get(h) { const response = await h.load('app/api/facebook/post-preview/route.ts').GET(h.getRequest({ conversationId: uuid(1), messageId: uuid(11), postId: 'untrusted', parentId: 'untrusted' })); return { status: response.status, ...await response.json() }; }
function graph(results) {
  const calls = [];
  const api = loader({ '@/lib/facebook/get-facebook-page-access-token': { getFacebookPageAccessToken: async () => 'fixture-token', refreshFacebookPageAccessToken: async () => 'fixture-token', isFacebookAccessTokenError: e => e?.code === 190 } }, { console: { ...console, warn() {} }, fetch: async (url, init) => { calls.push({ url, init }); const value = results.shift(); if (value instanceof Error) throw value; return Response.json(value ?? {}, { status: value?.error ? 400 : 200 }); } })('lib/facebook/get-post-preview.ts');
  return { api, calls };
}

test('normal single-photo card keeps caption, image, source permalink and image action', () => {
  const h = card({ savedPreview: { ...preview, photos: [photo('a')] } }), tree = h.render();
  assert.equal(nodes(tree, n => n.type === 'img').length, 1); assert.match(copy(tree), /Original album caption/); assert.ok(links(tree).includes(preview.permalink_url));
  nodes(tree, n => n.type === 'button' && n.props['aria-label'] === 'Open Facebook post image')[0].props.onClick(); assert.equal(h.opened[0].src, photo('a').src); assert.equal(h.calls.length, 0); h.rt.cleanup();
});
test('whole-album comments display both verified photos and whole-post context', () => {
  const h = card({ savedPreview: { ...preview, comment_object_id: preview.id } }), tree = h.render();
  assert.equal(nodes(tree, n => n.type === 'img').length, 2); assert.match(copy(tree), /whole post/i); assert.ok(links(tree).includes(preview.permalink_url)); h.rt.cleanup();
});
test('exact photo association displays the associated photo and only supplied photo/comment permalinks', async () => {
  const h = card({ savedPreview: { ...preview, photo_id: 'b', comment_object_id: 'b', attachments_complete: undefined } }, { success: true, preview: { ...preview, photo_id: 'b', comment_object_id: 'b' }, parent_id: null, comment_permalink_url: 'https://www.facebook.com/provider/child' });
  h.render(); await tick(); const tree = h.render(); assert.deepEqual(nodes(tree, n => n.type === 'img').map(n => n.props.src), [photo('b').src]);
  assert.ok(links(tree).includes(photo('b').permalink_url)); assert.ok(links(tree).includes('https://www.facebook.com/provider/child')); assert.ok(links(tree).includes(preview.permalink_url)); h.rt.cleanup();
});
test('unknown photo association shows album without claiming a nearby photo', () => {
  const h = card({ savedPreview: { ...preview, comment_object_id: 'unknown-photo' } }), tree = h.render(); assert.equal(nodes(tree, n => n.type === 'img').length, 2); assert.match(copy(tree), /not identified/i); assert.ok(!links(tree).includes(photo('a').permalink_url)); h.rt.cleanup();
});
test('no provider permalink means no manufactured source/comment/photo URL', () => {
  const h = card({ savedPreview: { ...preview, permalink_url: null, photos: [ { ...photo('a'), permalink_url: null } ] } }); assert.deepEqual(links(h.render()), []); assert.equal(data.safePostLink(null, 'page1_post1'), null); h.rt.cleanup();
});
test('different source identity cannot inherit stale caption/image/permalink', () => {
  const next = data.mergePostPreview(preview, { id: 'page1_other' }, 'page1_other'); assert.equal(next.message, null); assert.equal(next.full_picture, null); assert.equal(next.permalink_url, null); assert.deepEqual(Array.from(next.photos ?? []), []);
});
test('fixture reproduces customer reply to Page reply with exact immediate author and body', () => {
  const root = message('root'), staff = message('staff', 'root', { direction: 'outgoing', message_text: 'Size M is available' }), customer = message('customer', 'staff', { message_text: 'Please reserve M' });
  const parent = context.facebookCommentParentPreview(customer, [root, staff, customer], 'Page staff'); assert.equal(parent.id, 'staff'); assert.equal(parent.author, 'Page staff'); assert.equal(parent.text, 'Size M is available');
  const h = card({ parentId: 'staff', savedParent: parent, showPost: false }), tree = h.render(); assert.match(copy(tree), /Reply to Page staff/); assert.match(copy(tree), /Size M is available/); assert.ok(links(tree).includes(preview.permalink_url)); h.rt.cleanup();
});
test('deeper nesting preserves immediate parent rather than flattening quoted context to root', () => {
  const chain = [message('root'), message('staff', 'root', { direction: 'outgoing' }), message('customer', 'staff'), message('staff2', 'customer', { direction: 'outgoing' }), message('customer2', 'staff2')];
  assert.equal(context.facebookCommentParentPreview(chain[4], chain, 'Page').id, 'staff2'); assert.equal(context.facebookCommentRenderRoot(chain[4], chain).id, 'root');
  assert.deepEqual(Array.from(grouping.collectFacebookCommentDescendants(chain, 'root'), x => [x.reply.id, x.depth]), [['staff', 1], ['customer', 2], ['staff2', 3], ['customer2', 4]]);
});
test('pagination keeps orphan intermediate parent and all descendants visible exactly once', () => {
  const chain = [message('staff', 'outside-page', { direction: 'outgoing' }), message('child', 'staff'), message('grandchild', 'child')];
  const roots = chain.filter(m => context.facebookCommentRenderRoot(m, chain).id === m.id); assert.deepEqual(roots.map(m => m.id), ['staff']);
  assert.deepEqual(Array.from(grouping.collectFacebookCommentDescendants(chain, 'staff'), x => x.reply.id), ['child', 'grandchild']);
  const complete = [message('outside-page'), ...chain]; assert.equal(context.facebookCommentRenderRoot(chain[2], complete).id, 'outside-page');
  assert.equal(grouping.collectFacebookCommentDescendants(complete, 'outside-page').length, 3);
});
test('deleted root and parent cycles cannot swallow remaining replies', () => {
  const root = message('root', null, { comment_is_deleted: true }), child = message('child', 'root'), grandchild = message('grandchild', 'child');
  assert.equal(context.facebookCommentRenderRoot(grandchild, [root, child, grandchild]).id, 'child'); assert.equal(grouping.collectFacebookCommentDescendants([root, child, grandchild], 'child').length, 1);
  const a = message('a', 'b'), b = message('b', 'a'); assert.equal(context.facebookCommentRenderRoot(a, [a, b]).id, 'a'); assert.equal(context.facebookCommentRenderRoot(b, [a, b]).id, 'b');
});
test('same sender on multiple posts stays per message and never borrows nearby parent', () => {
  const parent = message('staff', null, { raw_payload: { item: 'comment', post_id: 'page1_other' } }), child = message('child', 'staff');
  assert.equal(context.facebookCommentParentPreview(child, [parent, child], 'Page'), null); assert.equal(context.facebookCommentRenderRoot(child, [parent, child]).id, 'child');
  assert.equal(context.facebookCommentIdentity(child).postId, preview.id);
});
test('same customer on different album photos never shares a source card; unknown associations remain separate', () => {
  const a = message('comment-a', null, { sender_platform_id: 'customer', raw_payload: { item: 'comment', post_id: preview.id, post_preview: { ...preview, photo_id: 'a' } } });
  const b = message('comment-b', null, { sender_platform_id: 'customer', raw_payload: { item: 'comment', post_id: preview.id, post_preview: { ...preview, photo_id: 'b' } } });
  assert.notEqual(grouping.getSafeFacebookCommentGroupInfo(a).groupKey, grouping.getSafeFacebookCommentGroupInfo(b).groupKey);
  const unknown = message('unknown', null, { sender_platform_id: 'customer', raw_payload: { item: 'comment', post_id: preview.id, post_preview: { ...preview, comment_object_id: null } } }); assert.equal(grouping.getSafeFacebookCommentGroupInfo(unknown).groupKey, null);
  const legacy = message('legacy', null, { sender_platform_id: 'customer', raw_payload: { item: 'comment', post_id: preview.id, post_preview: { id: preview.id, full_picture: photo('a').src } } }); assert.equal(grouping.getSafeFacebookCommentGroupInfo(legacy).groupKey, null);
  const single = message('single', null, { sender_platform_id: 'customer', raw_payload: { item: 'comment', post_id: preview.id, post_preview: { ...preview, photos: [photo('a')] } } }); assert.ok(grouping.getSafeFacebookCommentGroupInfo(single).groupKey);
});
test('loaded messages in another conversation do not become a local render parent', () => {
  const parent = message('staff', null, { conversation_id: uuid(2) }), child = message('child', 'staff'); assert.equal(context.facebookCommentRenderRoot(child, [parent, child]).id, 'child'); assert.equal(context.facebookCommentParentPreview(child, [parent, child], 'Page'), null);
});
test('verified top-level snapshot overrides raw photo parent and successful endpoint clears stale quote', async () => {
  const m = message('child', 'a', { raw_payload: { comment_id: 'child', post_id: preview.id, parent_id: 'a', comment_context: { id: 'child', parent_id: null } } }); assert.equal(context.facebookCommentIdentity(m).parentId, null);
  const h = card({ parentId: 'a', savedPreview: { ...preview, attachments_complete: undefined } }, { success: true, preview, parent_id: null, parent: null }); h.render(); await tick(); assert.doesNotMatch(copy(h.render()), /Reply to unavailable/); h.rt.cleanup();
});
for (const kind of ['deleted', 'unavailable', 'media']) test(`accurate ${kind} parent fallback never fabricates text`, () => {
  const h = card({ parentId: 'parent', savedParent: { id: 'parent', author: null, text: null, image: null, permalink_url: null, status: kind } });
  const tree = h.render(); assert.match(copy(tree), kind === 'deleted' ? /Parent comment was deleted/ : kind === 'media' ? /Media reply · preview unavailable/ : /Parent comment is unavailable/); assert.doesNotMatch(copy(tree), /Reply to comment → Comment/); h.rt.cleanup();
});
test('synthetic ingest text is not quoted for media-only parent; video is never used as image', () => {
  const parent = message('parent', null, { message_text: 'Facebook comment', message_type: 'video', attachment_url: 'https://video.fbcdn.net/clip.mp4', raw_payload: { item: 'comment', post_id: preview.id, attachment: { type: 'video' } } });
  const p = context.facebookCommentParentPreview(message('child', 'parent'), [parent], 'Page'); assert.equal(p.text, null); assert.equal(p.image, null); assert.equal(p.status, 'media');
});
test('failed parent photo preview has an accurate media fallback', () => {
  const h = card({ parentId: 'parent', savedParent: { id: 'parent', author: 'Staff', text: null, image: photo('a').src, permalink_url: null, status: 'media' } });
  let tree = h.render(); nodes(tree, n => n.type === 'img' && n.props.alt === 'Parent reply')[0].props.onError(); tree = h.render(); assert.match(copy(tree), /Media reply · preview unavailable/); assert.equal(nodes(tree, n => n.type === 'img' && n.props.alt === 'Parent reply').length, 0); h.rt.cleanup();
});
test('authorized exact parent outside loaded page or in another customer thread is recovered read-only', async () => {
  const h = routeFixture({ parentId: 'staff', parent: { direction: 'outgoing', message_text: 'Exact staff answer' } }), result = await get(h);
  assert.equal(result.status, 200); assert.equal(result.parent.id, 'staff'); assert.equal(result.parent.author, 'Page staff'); assert.equal(result.parent.text, 'Exact staff answer'); assert.equal(result.preview.id, preview.id); assert.ok(h.db.history.every(q => q.op === 'read'));
  assert.ok(h.db.history.some(q => q.columns.includes('conversations!inner') && q.max === 1));
});
for (const boundary of ['tenant', 'Page', 'post']) test(`parent recovery cannot cross ${boundary} boundary`, async () => {
  const h = routeFixture({ parentId: 'staff', parent: boundary === 'tenant' ? { business_id: 'b2', message_text: 'PRIVATE' } : boundary === 'post' ? { raw_payload: { post_id: 'page1_other' }, message_text: 'PRIVATE' } : { message_text: 'PRIVATE' }, conversationPatch: boundary === 'Page' ? { social_account_id: 's2' } : {} });
  const result = await get(h); assert.equal(result.parent.status, 'unavailable'); assert.equal(result.parent.text, null); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});
for (const opts of [{ denied: true }, { permissionDenied: true }]) test(`authorization precedes all provider context lookups ${JSON.stringify(opts)}`, async () => {
  let calls = 0; const h = routeFixture({ ...opts, commentContext: () => { calls++; throw Error('must not call'); }, photoContext: () => { calls++; throw Error('must not call'); } }); assert.equal((await get(h)).status, 403); assert.equal(calls, 0);
});
test('known local parent deletion overrides a cached provider snapshot', async () => {
  const h = routeFixture({ parentId: 'staff', parent: { comment_is_deleted: true }, commentContext: { id: 'child', object_id: preview.id, parent_id: 'staff', parent: { id: 'staff', text: 'Stale body', image: photo('a').src, status: 'available' } } });
  const result = await get(h); assert.equal(result.parent.status, 'deleted'); assert.equal(result.parent.text, null); assert.equal(result.parent.image, null);
});
test('saved exact parent snapshot survives provider unavailability', async () => {
  const h = routeFixture({ payload: { comment_context: { id: 'child', object_id: preview.id, parent_id: 'staff', parent: { id: 'staff', author: 'Staff', text: 'Saved exact answer', status: 'available' } } } });
  assert.equal((await get(h)).parent.text, 'Saved exact answer');
});
test('provider omission of an inaccessible parent cannot erase the stored exact relationship', async () => {
  const h = routeFixture({ parentId: 'staff', parent: { comment_is_deleted: true }, commentContext: { id: 'child', object_id: preview.id, parent_id: null, parent_resolved: false } });
  const result = await get(h); assert.equal(result.parent_id, 'staff'); assert.equal(result.parent.status, 'deleted');
});
test('verified child photo-to-story association selects exact photo without changing original post permalink', async () => {
  const h = routeFixture({ commentContext: { id: 'child', object_id: 'b', parent_id: null, parent: null, permalink_url: 'https://www.facebook.com/provider/child' }, photoContext: { id: 'b', post_id: preview.id, full_picture: photo('b').src, permalink_url: photo('b').permalink_url } });
  const result = await get(h); assert.equal(result.preview.photo_id, 'b'); assert.equal(result.preview.permalink_url, preview.permalink_url); assert.equal(result.parent_id, null); assert.equal(result.comment_permalink_url, 'https://www.facebook.com/provider/child');
});
test('verified direct post identity replaces stale stored source; foreign Page object is rejected', async () => {
  const h = routeFixture({ commentContext: { id: 'child', object_id: 'page1_new', parent_id: null }, preview: { id: 'page1_new', message: 'New post', permalink_url: 'https://www.facebook.com/provider/new' } });
  const result = await get(h); assert.equal(h.previewCalls[0][0], 'page1_new'); assert.equal(result.preview.message, 'New post'); assert.equal(result.preview.full_picture, null);
  const foreign = routeFixture({ payload: { post_id: null, post_preview: null }, commentContext: { id: 'child', object_id: 'foreign_post', parent_id: 'foreign-parent', parent: { id: 'foreign-parent', text: 'PRIVATE', status: 'available' } } }); const rejected = await get(foreign); assert.equal(rejected.preview, null); assert.equal(rejected.parent, null); assert.doesNotMatch(JSON.stringify(rejected), /PRIVATE/); assert.equal(foreign.previewCalls.length, 0);
});
test('verified photo story replaces stale stored post and does not retain its caption or permalink', async () => {
  const h = routeFixture({ commentContext: { id: 'child', object_id: 'exact-photo', parent_id: null }, photoContext: { id: 'exact-photo', post_id: 'page1_new', full_picture: photo('exact-photo').src }, preview: { id: 'page1_new', message: 'Verified new album' } });
  const result = await get(h); assert.equal(h.previewCalls[0][0], 'page1_new'); assert.equal(result.preview.message, 'Verified new album'); assert.equal(result.preview.permalink_url, null); assert.equal(result.preview.photo_id, 'exact-photo');
});
test('rich provider request keeps all album leaf images even when full_picture exists', async () => {
  const h = graph([{ id: preview.id, full_picture: photo('cover').src, attachments: { data: [{ media: { image: { src: photo('cover').src } }, subattachments: { data: [photo('a'), photo('b')].map(p => ({ target: { id: p.id, url: p.permalink_url }, media: { image: { src: p.src } } })) } }] } }]);
  const result = await h.api.getFacebookPostPreview(preview.id, 'page1'); assert.deepEqual(Array.from(result.photos, p => p.id), ['a', 'b']); assert.equal(result.attachments_complete, true); assert.equal(h.calls.length, 1);
});
test('pagination on attachments never certifies complete album context or follows unbounded next links', async () => {
  const h = graph([{ id: preview.id, attachments: { data: [{ target: { id: 'a' }, media: { image: { src: photo('a').src } } }], paging: { next: 'https://graph.facebook.com/unbounded' } } }]);
  assert.equal((await h.api.getFacebookPostPreview(preview.id, 'page1')).attachments_complete, false); assert.equal(h.calls.length, 1);
});
test('legacy attachment-only fallback preserves normal recoverable media', async () => {
  const h = graph([{ error: { code: 100 } }, { id: preview.id, message: 'Legacy caption', attachments: { data: [{ media: { image: { src: photo('a').src } } }] } }]);
  const result = await h.api.getFacebookPostPreview(preview.id, 'page1'); assert.equal(result.full_picture, photo('a').src); assert.equal(result.attachments_complete, false); assert.equal(h.calls.length, 2); assert.ok(!new URL(h.calls[1].url).searchParams.get('fields').includes('target'));
});
test('exact child provider result gives immediate parent and authoritative permalink; coalesces rerenders', async () => {
  const h = graph([{ id: 'child', object: { id: preview.id }, permalink_url: 'https://www.facebook.com/provider/child', parent: { id: 'staff', from: { name: 'Page staff' }, message: 'Exact staff reply', permalink_url: 'https://www.facebook.com/provider/staff' } }]);
  const results = await Promise.all([h.api.getFacebookCommentContext('child', 'page1'), h.api.getFacebookCommentContext('child', 'page1')]); assert.equal(results[0].parent.text, 'Exact staff reply'); assert.equal(results[0].parent_id, 'staff'); assert.equal(results[0].permalink_url, 'https://www.facebook.com/provider/child'); await h.api.getFacebookCommentContext('child', 'page1'); assert.equal(h.calls.length, 1);
});
test('parent ID-only response performs one exact read; wrong child identity is never accepted', async () => {
  const h = graph([{ id: 'child', parent: { id: 'staff' }, object: { id: preview.id } }, { id: 'staff', message: 'Exact read' }]); assert.equal((await h.api.getFacebookCommentContext('child', 'page1')).parent.text, 'Exact read'); assert.match(h.calls[1].url.pathname, /staff$/); assert.equal(h.calls.length, 2);
  const bad = graph([{ id: 'nearby', parent: { id: 'staff', message: 'Invented relation' } }]); assert.equal(await bad.api.getFacebookCommentContext('child', 'page1'), null);
});
test('fallback post ID lookup validates the exact requested child ID', async () => {
  const h = graph([{ id: 'child', object: { id: preview.id } }]); assert.equal(await h.api.getFacebookPostIdForComment('child', 'page1'), preview.id); assert.equal(new URL(h.calls[0].url).searchParams.get('fields'), 'id,object');
  const bad = graph([{ id: 'nearby', object: { id: 'foreign_post' } }]); assert.equal(await bad.api.getFacebookPostIdForComment('child', 'page1'), null);
});
test('missing/media-only provider parents produce factual placeholders and top-level photo has no comment parent', async () => {
  const missing = graph([{ id: 'child', parent: { id: 'staff' } }, { error: { code: 100 } }]); assert.equal((await missing.api.getFacebookCommentContext('child', 'page1')).parent.status, 'unavailable');
  const media = graph([{ id: 'child', parent: { id: 'staff', attachment: { type: 'video' } } }]); assert.equal((await media.api.getFacebookCommentContext('child', 'page1')).parent.status, 'media'); assert.equal(media.calls.length, 1);
  const top = graph([{ id: 'child', object: { id: 'photo' }, parent: { id: 'photo' } }]); assert.equal((await top.api.getFacebookCommentContext('child', 'page1')).parent_id, null); assert.equal(top.calls.length, 1);
});
test('photo context uses provider story/link and largest safe image; caches by authorized Page', async () => {
  const response = { id: 'photo', page_story_id: preview.id, link: 'https://www.facebook.com/provider/photo', images: [{ source: 'http://unsafe.test/a', width: 9999 }, { source: photo('small').src, width: 40, height: 40 }, { source: photo('large').src, width: 400, height: 400 }] };
  const h = graph([response, response]); const result = await h.api.getFacebookPhotoContext('photo', 'page1'); assert.equal(result.full_picture, photo('large').src); assert.equal(result.permalink_url, response.link); assert.equal(result.post_id, preview.id); await h.api.getFacebookPhotoContext('photo', 'page1'); assert.equal(h.calls.length, 1); await h.api.getFacebookPhotoContext('photo', 'page2'); assert.equal(h.calls.length, 2);
});

function ingestFixture(graphResult, outgoing = false) {
  const { database, baseSeed } = require('./tenh-seven/harness.cjs');
  const seed = baseSeed(), pageId = seed.social_accounts[0].platform_account_id, customerId = seed.contacts[0].platform_user_id;
  seed.conversations[0].source_type = 'comment'; seed.conversations[0].unread_count = 2;
  if (outgoing) seed.messages.push({ id: 'root-row', platform_message_id: 'root', conversation_id: 'conv1', business_id: 'b1', sender_platform_id: customerId, direction: 'incoming', message_text: 'Root', raw_payload: { post_id: `${pageId}_post` } });
  const db = database(seed), calls = [], detected = [];
  const api = loader({
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/facebook/get-facebook-page-access-token': { getFacebookPageAccessToken: async () => 'fixture-token', refreshFacebookPageAccessToken: async () => 'fixture-token', isFacebookAccessTokenError: e => e?.code === 190 },
    '@/lib/facebook/get-post-preview': { getFacebookPostPreview: async id => { const saved = { ...preview, id }; delete saved.comment_object_id; return saved; } },
    '@/lib/facebook/mark-comment-thread-deleted': { markFacebookCommentThreadDeleted: async () => {} },
    '@/lib/inbox/save-detected-customer-phone': { saveDetectedCustomerPhone: async input => detected.push(input) },
  }, { console: { log() {}, warn() {}, error() {} }, fetch: async (url, init) => {
    calls.push({ url, init }); const parsed = new URL(url);
    if (parsed.pathname.endsWith('/child')) return Response.json(graphResult);
    return Response.json({ id: customerId, name: 'Customer', picture: { data: { url: photo('profile').src } } });
  } })('lib/facebook/process-comment.ts');
  return { db, calls, detected, run: () => api.processFacebookComment({ pageId, value: { item: 'comment', verb: 'add', comment_id: 'child', post_id: `${pageId}_post`, parent_id: outgoing ? 'root' : 'staff', message: 'Reserve 012345678', from: { id: outgoing ? pageId : customerId } } }) };
}
for (const outgoing of [false, true]) test(`ingestion retains verified immediate parent and exact reply permalink ${outgoing ? 'for Page reply' : 'for customer reply'}`, async () => {
  const h = ingestFixture({ id: 'child', message: 'Reserve 012345678', permalink_url: 'https://www.facebook.com/provider/child', from: { name: outgoing ? 'Page staff' : 'Customer' }, parent: { id: outgoing ? 'root' : 'staff', message: 'Exact answered text', from: { name: 'Verified parent' }, permalink_url: 'https://www.facebook.com/provider/parent' } }, outgoing);
  await h.run(); const row = h.db.tables.messages.find(m => m.platform_message_id === 'child'); assert.ok(row); assert.equal(row.raw_payload.comment_context.parent.text, 'Exact answered text'); assert.equal(row.raw_payload.comment_context.permalink_url, 'https://www.facebook.com/provider/child'); assert.equal(row.raw_payload.parent_id, outgoing ? 'root' : 'staff'); assert.equal(row.direction, outgoing ? 'outgoing' : 'incoming'); assert.equal(h.calls.filter(c => new URL(c.url).pathname.endsWith('/child')).length, 1);
  if (!outgoing) { assert.equal(h.detected.length, 1); assert.equal(h.detected[0].text, 'Reserve 012345678'); }
});
test('ingestion never persists a context snapshot from a mismatched provider child ID', async () => {
  const h = ingestFixture({ id: 'nearby', parent: { id: 'wrong', message: 'Unrelated answer' } }); await h.run(); const row = h.db.tables.messages.find(m => m.platform_message_id === 'child'); assert.ok(row); assert.equal(row.raw_payload.comment_context, undefined); assert.equal(row.raw_payload.parent_id, 'staff');
});
test('ingestion preserves exact webhook parent when provider omits unavailable parent content', async () => {
  const h = ingestFixture({ id: 'child', from: { name: 'Customer' } }); await h.run(); const row = h.db.tables.messages.find(m => m.platform_message_id === 'child'); assert.equal(row.raw_payload.comment_context.parent_id, 'staff'); assert.equal(row.raw_payload.comment_context.parent.status, 'unavailable'); assert.equal(row.raw_payload.comment_context.parent.text, null);
});
test('complete ingested album preview without comment association enriches once and selects exact photo', async () => {
  const ingestion = ingestFixture({ id: 'child', object: { id: 'b' }, parent: { id: 'b' }, from: { name: 'Customer' } }); await ingestion.run();
  const row = ingestion.db.tables.messages.find(m => m.platform_message_id === 'child'); assert.equal(row.raw_payload.comment_context.object_id, 'b'); assert.equal(row.raw_payload.comment_context.parent_id, null);
  const h = card({ postId: row.raw_payload.post_id, savedPreview: row.raw_payload.post_preview }, { success: true, parent_id: null, preview: { ...preview, id: row.raw_payload.post_id, photo_id: 'b', comment_object_id: 'b' } });
  h.render(); assert.equal(h.calls.length, 1); await tick(); const tree = h.render(); assert.deepEqual(nodes(tree, n => n.type === 'img').map(n => n.props.src), [photo('b').src]); h.render(); h.render(); assert.equal(h.calls.length, 1); h.rt.cleanup();
});
