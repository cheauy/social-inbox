const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const req = require('node:module').createRequire(path.resolve(__dirname, '../../package.json'));
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const { JSDOM } = require('jsdom');
const { loader } = require('../tenh-seven/harness.cjs');

// Render the real MessagePanel, source parser/timeline and SourceCard. Mock only
// surrounding controls and network hooks, not the chat's rendering branches.
const empty = () => null;
const overrides = {
  react: React,
  'react/jsx-runtime': req('react/jsx-runtime'),
  'lucide-react': req('lucide-react'),
  '@/lib/inbox/use-facebook-block': { useFacebookBlock: () => ({ blocked: false }) },
  '@/lib/inbox/use-pinned-messages': { usePinnedMessages: () => ({ pins: [], pendingIds: new Set(), toggle: async () => null }) },
  '@/components/inbox/pinned-message-header': { PinnedMessageHeader: empty },
  '@/components/inbox/messenger-message-actions': { MessengerMessageActions: empty },
  '@/components/inbox/conversation-header': { ConversationHeader: empty },
  '@/components/inbox/reply-box': { ReplyBox: empty },
  '@/components/ui/delete-confirm-dialog': { DeleteConfirmDialog: empty },
  '@/components/display/workspace-language-text': { useWorkspaceLanguageId: () => 'en' },
};
const load = loader(overrides);
overrides['@/components/inbox/messenger-source-card'] = load('components/inbox/messenger-source-card.tsx');
const { MessagePanel } = load('components/inbox/message-panel.tsx');
const { messengerSourceFromEvent } = load('lib/facebook/messenger-source.ts');
const timestamp = Date.parse('2026-09-13T08:13:26.000Z');
const page = '203981939455120';
const referral = { type: 'OPEN_THREAD', source: 'ADS', ad_id: '120252832233840092', ads_context_data: {
  post_id: page + '_555555', ad_title: 'Example ad', photo_url: 'https://example.com/source.jpg',
} };
const event = { sender: { id: '123456789' }, recipient: { id: page }, timestamp,
  message: { mid: 'm_test', text: 'Ad test 2', referral } };
const conversation = {
  id: 'conversation1', business_id: 'business1', source_type: 'messenger', status: 'open', unread_count: 1,
  social_account: { id: 'account1', platform: 'facebook', platform_account_id: page, account_name: 'Apex Clothing' },
  contact: { id: 'contact1', business_id: 'business1', full_name: 'Test customer', platform_user_id: '123456789', tags: [] },
};
function message(patch = {}) {
  return { id: 'message1', conversation_id: conversation.id, platform_message_id: 'm_test', direction: 'incoming',
    message_type: 'text', message_text: 'Ad test 2', raw_payload: event,
    created_at: new Date(timestamp).toISOString(), platform_created_at: new Date(timestamp).toISOString(), ...patch };
}
function render(messages, conversationPatch = {}) {
  const html = renderToStaticMarkup(React.createElement(MessagePanel, {
    activeConversation: { ...conversation, ...conversationPatch }, messages,
    teamMembers: [], viewingAgents: [], typingAgents: [], teamPresence: [],
    reply: '', replyingToCommentId: null, replyingToFacebookMessageId: null,
    replyingToTelegramMessageId: null, editingTelegramMessageId: null,
  }));
  return new JSDOM(html).window.document;
}
function cards(doc) { return doc.querySelectorAll('article[aria-label="Message from an ad"], article[aria-label="Opened an ad"]'); }
function assertCard(doc) {
  assert.equal(cards(doc).length, 1, 'exactly one ad source card must render in the real chat panel');
  const card = cards(doc)[0];
  assert.ok(card.textContent.includes(referral.ad_id));
  assert.ok(card.textContent.includes(referral.ads_context_data.post_id));
  assert.equal(card.querySelector('img').getAttribute('src'), referral.ads_context_data.photo_url);
  return card;
}

test('incoming Messenger text renders its ad card before the customer message', () => {
  const doc = render([message()]);
  const card = assertCard(doc);
  const text = [...doc.querySelectorAll('*')].find(node => node.childNodes.length === 1 && node.textContent === 'Ad test 2');
  assert.ok(text);
  assert.ok(card.compareDocumentPosition(text) & 4, 'source card precedes the customer message');
});

for (const kind of ['image', 'video', 'sticker', 'file']) {
  test(`incoming Messenger ${kind} renders its ad source card`, () => {
    const doc = render([message({ message_type: kind, attachment_url: `https://example.com/message.${kind === 'video' ? 'mp4' : 'png'}` })]);
    assertCard(doc);
  });
}

test('a saved ad open stays hidden, including when followed by a direct message', () => {
  const standalone = { ...event, message: undefined, referral };
  const source = messengerSourceFromEvent(standalone);
  assert.equal(cards(render([], { facebook_messenger_sources: [source] })).length, 0);
  const doc = render([message({ raw_payload: { ...event, timestamp: timestamp + 1000, message: { mid: 'm_test', text: 'Ad test 2' } },
    created_at: new Date(timestamp + 1000).toISOString(), platform_created_at: new Date(timestamp + 1000).toISOString() })],
    { facebook_messenger_sources: [source] });
  assert.equal(cards(doc).length, 0);
});

test('saved and embedded copies render once, including on reopening the conversation', () => {
  const saved = messengerSourceFromEvent(event);
  for (let i = 0; i < 2; i++) assertCard(render([message()], { facebook_messenger_sources: [saved] }));
});

test('photo grouping keeps one referral card and both album photos', () => {
  const first = message({ message_type: 'image', attachment_url: 'https://example.com/photo1.jpg' });
  const second = message({ id: 'message2', platform_message_id: 'm_second', message_type: 'image', attachment_url: 'https://example.com/photo2.jpg',
    raw_payload: {}, created_at: new Date(timestamp + 1000).toISOString(), platform_created_at: new Date(timestamp + 1000).toISOString() });
  const doc = render([first, second]);
  assertCard(doc);
  assert.ok(doc.querySelector('img[src="https://example.com/photo1.jpg"]'));
  assert.ok(doc.querySelector('img[src="https://example.com/photo2.jpg"]'));
});

test('ordinary Messenger messages and Telegram conversations do not gain an ad card', () => {
  assert.equal(cards(render([message({ raw_payload: {} })])).length, 0);
  const telegram = { ...conversation.social_account, platform: 'telegram' };
  assert.equal(cards(render([message()], { social_account: telegram })).length, 0);
});

test('an outgoing Seen message keeps its receipt without a standalone ad source', () => {
  const source = messengerSourceFromEvent({ ...event, message: undefined, referral });
  const doc = render([message({ direction: 'outgoing', raw_payload: {}, delivery_status: 'seen', message_text: 'Existing Page reply' })],
    { facebook_messenger_sources: [source] });
  assert.equal(cards(doc).length, 0);
  assert.ok(doc.querySelector('[title="Seen"]'));
});

test('an ad open followed by an attributed message produces only the message card', () => {
  const opened = messengerSourceFromEvent({ ...event, timestamp: timestamp - 5000, message: undefined, referral });
  const sent = messengerSourceFromEvent(event);
  const doc = render([message()], { facebook_messenger_sources: [opened, sent] });
  assertCard(doc);
  assert.equal(doc.querySelector('[aria-label="Opened an ad"]'), null);
});

test('a normal post message uses the same card layout with Post ID and photo, without Ad ID', () => {
  const postReferral = { source: 'POST', post_id: page + '_777777', ads_context_data: {
    ad_title: 'Normal Page post', photo_url: 'https://example.com/post.jpg',
  } };
  const doc = render([message({ raw_payload: { ...event, message: { mid: 'm_test', text: 'Post question', referral: postReferral } } })]);
  const card = doc.querySelector('article[aria-label="Message from a post"]');
  assert.ok(card);
  assert.equal(doc.querySelectorAll('article').length, 1);
  assert.ok(card.textContent.includes(postReferral.post_id));
  assert.equal(card.textContent.includes('Ad ID'), false);
  assert.equal(card.querySelector('img').getAttribute('src'), postReferral.ads_context_data.photo_url);
  assert.equal(card.className, assertCard(render([message()])).className);
});

test('saved message context is reused on reopening and cannot attach to another message', () => {
  const saved = messengerSourceFromEvent(event);
  // Models a bare history payload: metadata comes from the saved conversation.
  for (let reopen = 0; reopen < 3; reopen++) assertCard(render([message({ raw_payload: {} })], { facebook_messenger_sources: [saved] }));
  assert.equal(cards(render([message({ platform_message_id: 'm_direct', raw_payload: {} })], { facebook_messenger_sources: [saved] })).length, 0);
  assert.equal(cards(render([], { facebook_messenger_sources: [saved] })).length, 0);
});

test('saved and embedded copies with different timestamps still render one card per message', () => {
  const saved = messengerSourceFromEvent({ ...event, timestamp: timestamp - 1000 });
  assertCard(render([message()], { facebook_messenger_sources: [saved] }));
});
