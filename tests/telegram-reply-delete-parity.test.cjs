const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loader, database } = require('./tenh-seven/harness.cjs');

const load = loader({}, { URLSearchParams });
const actions = load('lib/inbox/message-actions.ts');

function message(patch = {}) {
  return {
    id: 'message-1', business_id: 'business-1', conversation_id: 'conversation-1',
    platform_message_id: 'telegram:123:10', direction: 'incoming', message_type: 'text',
    message_text: 'Original', attachment_url: null, raw_payload: {},
    platform_created_at: '2026-10-02T00:00:00.000Z', created_at: '2026-10-02T00:00:00.000Z',
    ...patch,
  };
}

test('deletion labels use verified actor metadata and never infer the message author', () => {
  const members = [{ id: 'agent-a', full_name: 'Agent A' }, { id: 'agent-b', full_name: 'Agent B' }];
  const deleted = tenh_deleted => ({ raw_payload: { tenh_deleted }, message_text: null });
  assert.equal(actions.getDeletedMessageText(deleted({ source: 'tenh', deleted_by_member_id: 'agent-a', deleted_by_name: 'Old A' }), { teamMembers: members }), 'Message deleted by Agent A');
  assert.equal(actions.getDeletedMessageText(deleted({ source: 'tenh', deleted_by_member_id: 'agent-b', deleted_by_name: 'Old B' }), { teamMembers: members }), 'Message deleted by Agent B');
  assert.equal(actions.getDeletedMessageText(deleted({ source: 'customer' }), { customerName: 'Do not infer this contact' }), 'Message deleted by customer');
  assert.equal(actions.getDeletedMessageText(deleted({ source: 'customer', deleted_by_customer_name: 'API customer' })), 'Message deleted by API customer');
  assert.equal(actions.getDeletedMessageText(deleted({ source: 'unknown', deleted_by_name: 'Invented actor' })), 'Message deleted');
});

test('video and photo replies keep exact provider targets and fail closed when the quote was not applied', () => {
  const video = message({ id: 'video-1', platform_message_id: 'telegram:123:7', message_type: 'video', message_text: 'Launch clip', attachment_url: '/stored/video' });
  const reply = message({ id: 'reply-1', platform_message_id: 'telegram:123:20', raw_payload: { message: { reply_to_message: { message_id: 7, caption: 'Launch clip', video: { file_id: 'video-file' } } } } });
  const reference = actions.getReplyVideoReference(reply, [video]);
  assert.equal(reference.messageId, 'video-1');
  assert.equal(reference.platformMessageId, 'telegram:123:7');
  assert.equal(reference.url, '/stored/video');
  const missingVideo = actions.getReplyVideoReference(reply, []);
  assert.equal(missingVideo.messageId, null);
  assert.equal(missingVideo.platformMessageId, 'telegram:123:7');
  assert.equal(missingVideo.url, null);
  assert.equal(actions.getReplyVideoReference({ ...reply, raw_payload: { ...reply.raw_payload, tenh_reply_fallback: { reason: 'original_unavailable' } } }, [video]), null);
  assert.equal(actions.getReplyVideoReference(reply, [{ ...video, raw_payload: { tenh_deleted: { source: 'tenh' } } }]), null);

  const photoReply = message({ id: 'photo-reply', platform_message_id: 'telegram:123:21', raw_payload: { message: { reply_to_message: { message_id: 8, photo: [{ file_id: 'photo-file' }] } } } });
  const photoReference = actions.getReplyImageReference(photoReply, []);
  assert.equal(photoReference.platformMessageId, 'telegram:123:8');
  assert.equal(photoReference.url, null);
  assert.equal(actions.getReplyImageReference({ ...photoReply, raw_payload: { tenh_reply_fallback: { reason: 'original_unavailable' } } }, []), null);
});

test('quote text is bounded and the shared row keeps 320px truncation plus video fallback UI', () => {
  const long = 'x'.repeat(800);
  assert.equal(actions.createReplyContext(message({ message_text: long }), 'telegram').preview_text.length, 500);
  const panel = fs.readFileSync('components/inbox/message-panel.tsx', 'utf8');
  assert.match(panel, /max-w-\[320px\] truncate/);
  assert.match(panel, /replyVideoReference \? <ReplyVideoThumbnail/);
  assert.match(panel, /replyImageReference \? "Photo" : replyVideoReference \? "Video"/);
  assert.ok(panel.indexOf('if (source.video)') < panel.indexOf('if (caption) return'));
  const thumbnail = fs.readFileSync('components/inbox/reply-image-thumbnail.tsx', 'utf8');
  assert.match(thumbnail, /onError=\{\(\) => setFailedDirect\(true\)\}/);
  assert.doesNotMatch(thumbnail, /reference\.platformMessageId.*src|api\/messages.*reference\.messageId/s);
});

function deletionRoute({ providerError = null, accessBusiness = 'business-1', mutate, authenticated = true } = {}) {
  const db = database({
    messages: [message()],
    conversations: [{ id: 'conversation-1', business_id: 'business-1', platform: 'telegram', social_account_id: 'account-1', last_message_at: '2026-10-02T00:00:00.000Z' }],
    social_accounts: [{ id: 'account-1', business_id: 'business-1', platform: 'telegram', is_active: true, telegram_token_status: 'verified', telegram_bot_token_encrypted: 'encrypted' }],
  });
  const member = { id: 'agent-a', business_id: 'business-1', full_name: 'Agent A' };
  let providerCalls = 0;
  class TelegramApiError extends Error {}
  const overrides = {
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/auth/get-current-member': { getCurrentMember: async () => authenticated ? { success: true, member } : { success: false, status: 401, error: 'Unauthorized' } },
    '@/lib/auth/require-permission': { memberHasPermission: async () => true, permissionDenied: () => new Response(null, { status: 403 }) },
    '@/lib/inbox/get-inbox-resource-access': { getInboxConversationAccess: async () => ({ success: true, member, businessId: accessBusiness }) },
    '@/lib/channels/channel-token-crypto': { decryptChannelCredential: () => 'token' },
    '@/lib/telegram/telegram-api': {
      TelegramApiError,
      editTelegramMessageText: async () => ({}),
      deleteTelegramMessage: async () => { providerCalls += 1; if (providerError) throw providerError; },
    },
  };
  if (mutate) overrides['@/lib/inbox/mutate-message-metadata'] = { mutateMessageMetadata: mutate, MessageMutationError: class extends Error {} };
  const route = loader(overrides, { URLSearchParams, Error })('app/api/telegram/messages/[messageId]/route.ts');
  return { db, providerCalls: () => providerCalls, run: () => route.DELETE(new Request('https://tenh.test/message-1', { method: 'DELETE' }), { params: Promise.resolve({ messageId: 'message-1' }) }) };
}

test('local deletion records the authenticated agent and provider-not-found stays unknown', async () => {
  const own = deletionRoute();
  const ownResponse = await own.run();
  const ownBody = await ownResponse.json();
  assert.equal(ownResponse.status, 200, JSON.stringify(ownBody));
  assert.equal(ownBody.deleted.source, 'tenh');
  assert.equal(ownBody.deleted.deleted_by_member_id, 'agent-a');
  assert.equal(ownBody.messageText, 'Message deleted by Agent A');

  const gone = deletionRoute({ providerError: new Error('Bad Request: message to delete not found') });
  const goneResponse = await gone.run();
  const goneBody = await goneResponse.json();
  assert.equal(goneResponse.status, 200, JSON.stringify(goneBody));
  assert.equal(goneBody.deleted.source, 'unknown');
  assert.equal(goneBody.messageText, 'Message deleted');
  assert.equal(goneBody.deleted.deleted_by_member_id, undefined);
});

test('concurrent different-agent attribution wins; stale workspace and auth stop before Telegram', async () => {
  const concurrent = deletionRoute({ mutate: async (_db, _scope, patch) => patch(message({ raw_payload: { tenh_deleted: { source: 'tenh', deleted_by_member_id: 'agent-b', deleted_by_name: 'Agent B' } } })) });
  const concurrentBody = await (await concurrent.run()).json();
  assert.equal(concurrentBody.deleted.deleted_by_member_id, 'agent-b');
  assert.equal(concurrentBody.messageText, 'Message deleted by Agent B');

  const stale = deletionRoute({ accessBusiness: 'stale-business' });
  assert.equal((await stale.run()).status, 403);
  assert.equal(stale.providerCalls(), 0);
  const unauthorized = deletionRoute({ authenticated: false });
  assert.equal((await unauthorized.run()).status, 401);
  assert.equal(unauthorized.providerCalls(), 0);
});
