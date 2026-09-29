const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader } = require('./tenh-seven/harness.cjs');

const read = (file) => fs.readFileSync(file, 'utf8');

test('conversation status filter is beside search and no longer in the left rail', () => {
  const source = read('components/inbox/conversation-list.tsx');
  const search = source.indexOf('Search conversations, contacts or messages...');
  const headerFilter = source.indexOf('Filter conversation status', search);
  assert.ok(search >= 0 && headerFilter > search);
  assert.match(source.slice(search, headerFilter + 400), /<FilterIcon\s*\/>/);
  assert.doesNotMatch(source, /group relative mx-auto flex h-11 w-11[\s\S]{0,800}Filter by status/);
});

test('Facebook Comment rail shortcut sits directly after Unread and filters the comment built-in view', () => {
  const source = read('components/inbox/conversation-list.tsx');
  const rail = source.slice(source.indexOf('const railViews'), source.indexOf('const isSmartViewSelected'));
  const unread = rail.indexOf('"unread"');
  const comment = rail.indexOf('"comment"');
  const pinned = rail.indexOf('"pinned"');
  assert.ok(unread >= 0 && comment > unread && pinned > comment);
  assert.match(rail.slice(comment, pinned), /builtInCounts\.comment/);
  assert.match(rail.slice(comment, pinned), /<CommentIcon\s*\/>/);
  assert.match(source, /key === "comment"[\s\S]{0,220}=== "comment"/);
});

test('Unread mark-all action is icon-only beside Clear view', () => {
  const source = read('components/inbox/conversation-list.tsx');
  const active = source.slice(source.indexOf('activeViewLabel ?'), source.indexOf('No conversations found'));
  assert.match(active, /selectedViewKey === "unread" && onMarkAllRead/);
  assert.match(active, /aria-label=\{isKhmer \? "សម្គាល់ទាំងអស់ថាបានអាន" : "Mark all as read"\}/);
  assert.match(active, /<span className="sr-only">[\s\S]{0,180}Mark all as read/);
  assert.match(active, /Mark all as read[\s\S]{0,1600}Clear view/);
  assert.doesNotMatch(source, /inline-flex items-center gap-1\.5[\s\S]{0,500}Mark all as read/);
});

test('selecting a quick reply restores focus to composer so Enter can send immediately', () => {
  const source = read('components/inbox/reply-box.tsx');
  const selector = source.slice(source.indexOf('<SavedReplySelector'), source.indexOf('<TenhStickerPicker'));
  assert.match(selector, /onReplyChange\(message\)/);
  assert.match(selector, /window\.requestAnimationFrame/);
  assert.match(selector, /replyInputRef\.current/);
  assert.match(selector, /input\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /event\.key !== "Enter"[\s\S]{0,900}requestSubmit\(\)/);
});

test('photo replies render a thumbnail and suppress literal [image] placeholder', () => {
  const source = read('components/inbox/message-panel.tsx');
  assert.match(source, /replyImageReference \? <ReplyImageThumbnail/);
  assert.match(source, /`Reply to \$\{replyImageReference \? "Photo" : telegramReplyPreview\.kind\}`/);
  assert.match(source, /\^\\\[\(image\|photo\)\\\]\$/);
});

test('stickers are image-proxy eligible and failed artwork retries through authorized message media', () => {
  const { getMessageImageUrl } = loader()('lib/inbox/message-actions.ts');
  const sticker = {
    id: 's1', conversation_id: 'c1', platform_message_id: 'mid1', direction: 'incoming',
    message_type: 'sticker', message_text: '[Sticker]', attachment_url: 'https://scontent.xx.fbcdn.net/sticker.png', raw_payload: {},
  };
  assert.equal(getMessageImageUrl(sticker), sticker.attachment_url);
  const panel = read('components/inbox/message-panel.tsx');
  assert.match(panel, /function ResilientStickerImage/);
  assert.match(panel, /const proxySrc = inboxImageEndpoint\(\{ conversationId, messageId \}\)/);
  assert.match(panel, /setUseProxy\(true\)/);
  const route = read('app/api/inbox/message-image/route.ts');
  assert.match(route, /original\.message_type === "sticker" \? "file" : "photo"/);
  assert.match(route, /refreshFacebookMessageImage/);
  assert.match(route, /Authorization: `Bearer \$\{token\}`/);
});
