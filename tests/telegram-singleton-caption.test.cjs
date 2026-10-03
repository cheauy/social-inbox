const test = require('node:test'), assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');

// Execute the actual endpoint AND Telegram transport helpers. Only the network,
// credential resolver and storage are mocked; bytes/recipients are synthetic.
async function singleton(kind, inputCaption) {
  const db = database({
    conversations: [{ id: 'conv1', business_id: 'b1', contact_id: 'c1', social_account_id: 's1', platform: 'telegram' }],
    contacts: [{ id: 'c1', business_id: 'b1', platform: 'telegram', platform_user_id: 'mock-chat' }],
    social_accounts: [{ id: 's1', business_id: 'b1', platform: 'telegram', platform_account_id: 'mock-bot', is_active: true, telegram_token_status: 'verified', telegram_bot_token_encrypted: 'mock-encrypted' }],
    messages: [],
  });
  const calls = [];
  const route = loader({
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/inbox/get-inbox-resource-access': { getInboxConversationAccess: async () => ({ success: true, member: { id: 'm1', business_id: 'b1' } }) },
    '@/lib/auth/require-permission': { memberHasPermission: async () => true },
    '@/lib/channels/channel-token-crypto': { decryptChannelCredential: () => 'mock-token' },
    '@/lib/telegram/telegram-message-media': {
      TENH_TELEGRAM_OUTGOING_PHOTO_MAX_BYTES: 4 * 1024 * 1024,
      inferTelegramPhotoContentType: () => 'image/jpeg', inferTelegramVideoContentType: () => 'video/mp4',
      saveTelegramMessageMedia: async ({ messageId }) => ({ attachmentUrl: `/api/messages/${messageId}/media` }),
      deleteTelegramMessageMedia: async () => {},
    },
  }, {
    File, FormData,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true, result: { message_id: 42, date: 1, caption: init.body.get('caption'),
        ...(kind === 'video' ? { video: { file_id: 'mock-video' } } : { photo: [{ file_id: 'mock-photo' }] }),
      } });
    },
    console: { info() {}, error() {} },
  })('app/api/telegram/send-photo/route.ts');
  const form = new FormData(); form.set('conversationId', 'conv1');
  form.set('file', new File([new Uint8Array([0,1,2,3])], kind === 'video' ? 'mock.mp4' : 'mock.jpg', { type: kind === 'video' ? 'video/mp4' : 'image/jpeg' }));
  if (inputCaption !== undefined) form.set('caption', inputCaption);
  const response = await route.POST(new Request('https://mock.invalid/api/telegram/send-photo', { method: 'POST', body: form }));
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, kind === 'video' ? /\/sendVideo$/ : /\/sendPhoto$/);
  assert.equal(calls[0].init.body.get('chat_id'), 'mock-chat');
  return { db, form: calls[0].init.body };
}

for (const kind of ['photo','video']) {
  test(`actual singleton ${kind} sends its caption to Telegram, matching saved local history`, async () => {
    const f = await singleton(kind, '  Mock caption 📎 & <plain text>  ');
    const expected = 'Mock caption 📎 & <plain text>';
    assert.equal(f.form.get('caption'), expected);
    assert.equal(f.form.get('parse_mode'), null);
    assert.equal(f.db.tables.messages[0].message_text, expected);
  });
  test(`singleton ${kind} retains the existing empty-caption request shape`, async () => {
    const f = await singleton(kind); assert.equal(f.form.has('caption'), false);
  });
  test(`singleton ${kind} forwards the same bounded caption it stores`, async () => {
    const f = await singleton(kind, 'x'.repeat(1100));
    assert.equal(f.form.get('caption'), 'x'.repeat(1024));
    assert.equal(f.db.tables.messages[0].message_text, f.form.get('caption'));
  });
}
