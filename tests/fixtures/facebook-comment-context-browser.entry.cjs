const React = require('react'), { createRoot } = require('react-dom/client');
const { FacebookPostCard } = require('../../components/inbox/facebook-post-card.tsx');
const { facebookCommentParentPreview, facebookCommentRenderRoot } = require('../../lib/facebook/comment-context-data.ts');
const { collectFacebookCommentDescendants } = require(process.env.FACEBOOK_GROUPING_FIXTURE);
const h = React.createElement;
const post = { id: 'page1_post1', message: 'Original post: summer collection', permalink_url: 'https://www.facebook.com/provider/post1', full_picture: 'https://fixture.invalid/a.png', photos: [
  { id: 'a', src: 'https://fixture.invalid/a.png', permalink_url: 'https://www.facebook.com/provider/photo-a' },
  { id: 'b', src: 'https://fixture.invalid/b.png', permalink_url: 'https://www.facebook.com/provider/photo-b' },
], attachments_complete: true, comment_object_id: 'page1_post1' };
const parent = { id: 'staff', author: 'Page staff', text: 'Size M is available', image: null, permalink_url: 'https://www.facebook.com/provider/staff', status: 'available' };
let requestCount = 0;
window.fetch = async url => { requestCount++; const fresh = new URL(url, location.href).searchParams.get('messageId') === 'fresh-album'; return { ok: true, json: async () => fresh ? ({ success: true, preview: { ...post, photo_id: 'b', comment_object_id: 'b' }, parent_id: null, parent: null }) : ({ success: true, preview: post, parent_id: 'missing', parent: { id: 'missing', author: null, text: null, image: null, status: 'unavailable' } }) }; };
function msg(id, parentId, patch = {}) { return { id, platform_message_id: id, conversation_id: 'conversation', message_type: 'comment', direction: 'incoming', message_text: id, raw_payload: { item: 'comment', post_id: post.id, parent_id: parentId, from: { name: patch.direction === 'outgoing' ? 'Page staff' : 'Verified customer' } }, ...patch }; }
const orphan = msg('staff', 'outside-page', { direction: 'outgoing', message_text: parent.text });
const child = msg('customer', 'staff', { message_text: 'Please reserve M' });
const grandchild = msg('staff2', 'customer', { direction: 'outgoing', message_text: 'Reserved' });
const messages = [orphan, child, grandchild];
const freshAlbum = { ...post }; delete freshAlbum.comment_object_id;
const scenarios = [
  ['single', { savedPreview: { ...post, photos: [post.photos[0]] } }],
  ['album', { savedPreview: post }],
  ['photo', { savedPreview: { ...post, photo_id: 'b', comment_object_id: 'b' } }],
  ['fresh-album', { savedPreview: freshAlbum }],
  ['unknown', { savedPreview: { ...post, comment_object_id: 'unidentified' } }],
  ['Page-reply', { savedPreview: post, parentId: 'staff', savedParent: parent }],
  ['media', { savedPreview: post, parentId: 'media', savedParent: { ...parent, id: 'media', text: null, status: 'media', permalink_url: null } }],
  ['missing', { savedPreview: post, parentId: 'missing' }],
  ['deleted', { savedPreview: post, parentId: 'deleted', savedParent: { ...parent, id: 'deleted', text: null, status: 'deleted' } }],
];
createRoot(document.getElementById('app')).render(h('main', {}, ...scenarios.map(([id, props]) => h('section', { id, key: id }, h('h2', {}, id), h(FacebookPostCard, {
  conversationId: 'fixture-conversation', messageId: id, postId: post.id, accountName: 'Page staff', isKhmer: false, onOpenImage: image => { window.opened = image; }, ...props,
}))), h('section', { id: 'pagination' }, ...messages.filter(m => facebookCommentRenderRoot(m, messages).id === m.id).map(root => h('div', { key: root.id, 'data-message': root.id }, root.message_text,
  ...collectFacebookCommentDescendants(messages, root.platform_message_id).map(({ reply }) => h('div', { key: reply.id, 'data-message': reply.id }, h(FacebookPostCard, {
    conversationId: 'fixture-conversation', messageId: reply.id, postId: post.id, savedPreview: post, accountName: 'Page staff', isKhmer: false, showPost: false,
    parentId: reply.raw_payload.parent_id, savedParent: facebookCommentParentPreview(reply, messages, 'Page staff'), onOpenImage: () => {},
  }), reply.message_text)))))));
window.checkFacebookContext = () => {
  const checks = [], check = (name, condition) => { checks.push({ name, pass: !!condition }); };
  check('single photo preserved', document.querySelectorAll('#single img').length === 1);
  check('album photos and whole-post label', document.querySelectorAll('#album img').length === 2 && /whole post/.test(document.getElementById('album').textContent));
  check('specific photo', document.querySelectorAll('#photo img').length === 1 && document.querySelector('#photo img').src.endsWith('/b.png'));
  check('fresh ingestion association repair', document.querySelectorAll('#fresh-album img').length === 1 && document.querySelector('#fresh-album img').src.endsWith('/b.png'));
  check('unknown photo is explicit', /Specific photo not identified/.test(document.getElementById('unknown').textContent));
  check('exact staff parent', /Reply to Page staff/.test(document.getElementById('Page-reply').textContent) && /Size M is available/.test(document.getElementById('Page-reply').textContent));
  check('missing fallback', /Parent comment is unavailable/.test(document.getElementById('missing').textContent));
  check('media fallback', /Media reply · preview unavailable/.test(document.getElementById('media').textContent));
  check('deleted fallback', /Parent comment was deleted/.test(document.getElementById('deleted').textContent));
  check('orphan subtree visible once', [...document.querySelectorAll('#pagination [data-message]')].map(n => n.dataset.message).join(',') === 'staff,customer,staff2');
  check('nested immediate parent', /Size M is available/.test(document.querySelector('[data-message=customer]').textContent) && /Reply to Verified customer/.test(document.querySelector('[data-message=staff2]').textContent) && /Please reserve M/.test(document.querySelector('[data-message=staff2]').textContent));
  check('provider post URL', [...document.querySelectorAll('a')].filter(a => /View Post/.test(a.textContent)).every(a => a.href === post.permalink_url));
  document.querySelector('#single button[aria-label="Open Facebook post image"]').click();
  check('image interaction', window.opened?.src === post.photos[0].src);
  check('requests bounded', requestCount === 2);
  check('no viewport overflow', document.documentElement.scrollWidth <= window.innerWidth);
  return { success: checks.every(c => c.pass), checks, requestCount };
};
