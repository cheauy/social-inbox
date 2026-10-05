/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loader, database } = require('./tenh-seven/harness.cjs');

const message = patch => ({
  id: 'voice1', business_id: 'b1', conversation_id: 'conv1',
  platform_message_id: 'mid.voice.1', message_type: 'audio', raw_payload: {},
  ...patch,
});

function setup(options = {}) {
  const db = database({
    messages: options.rows ?? [message()],
    social_accounts: [{ id: 'page', business_id: 'b1', platform: 'facebook', platform_account_id: '123', is_active: true, facebook_token_status: 'verified' }],
  });
  const graphCalls = [], signedCalls = [];
  const load = loader({
    'next/server': { NextResponse: Response },
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/inbox/get-inbox-resource-access': { getInboxConversationAccess: async id => options.denied
      ? { success: false, status: 403, error: 'Denied' }
      : { success: true, businessId: 'b1', member: { id: 'member' }, conversation: { id, business_id: 'b1', social_account_id: 'page' } } },
    '@/lib/auth/require-permission': { memberHasPermission: async () => !options.noPermission },
    '@/lib/inbox/message-actions': { isMessageDeleted: row => Boolean(row.raw_payload?.tenh_deleted) },
    '@/lib/media/signed-urls': { cachedSignedUrls: async (bucket, paths) => {
      signedCalls.push({ bucket, paths });
      if (options.signError) throw new Error('Missing');
      return options.signedUrl ? [{ path: paths[0], signedUrl: options.signedUrl }] : [];
    } },
    '@/lib/facebook/get-facebook-page-access-token': { getFacebookPageAccessToken: async () => 'FAKE_PAGE_TOKEN' },
    '@/lib/telegram/telegram-message-media': {
      TELEGRAM_MESSAGE_MEDIA_BUCKET: 'private-media',
      telegramMessageMediaStoragePath: ({ businessId, messageId, mediaKind }) => `${businessId}/${messageId}/${mediaKind}`,
    },
  }, {
    process: { env: { FACEBOOK_GRAPH_API_VERSION: 'v26.0' } },
    fetch: async (url, init) => {
      graphCalls.push({ url: String(url), init });
      return options.graphResponse ?? Response.json({ attachments: { data: [
        { type: 'audio', audio_data: { url: 'https://lookaside.fbsbx.com/attachment/fresh' } },
      ] } });
    },
  });
  const route = load('app/api/inbox/message-audio/route.ts');
  const get = (query = 'conversationId=conv1&messageId=voice1') => route.GET({
    nextUrl: new URL(`https://app.tenhchat.com/api/inbox/message-audio?${query}`),
  });
  return { get, graphCalls, signedCalls };
}

test('new stored voice uses a fresh private signed URL before contacting Facebook', async () => {
  const h = setup({ signedUrl: 'https://project.supabase.co/storage/v1/object/sign/private/voice?token=fresh' });
  const response = await h.get();
  assert.equal(response.status, 307);
  assert.match(response.headers.get('location'), /project\.supabase\.co\/storage\/v1/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Array.from(h.signedCalls[0].paths), ['b1/voice1/audio']);
  assert.equal(h.graphCalls.length, 0);
});

test('old voice with no private copy refreshes only its exact Facebook audio attachment', async () => {
  const h = setup({ signError: true });
  const response = await h.get();
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://lookaside.fbsbx.com/attachment/fresh');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(h.graphCalls[0].url, /\/v26\.0\/mid\.voice\.1\?fields=attachments$/);
  assert.equal(h.graphCalls[0].init.headers.Authorization, 'Bearer FAKE_PAGE_TOKEN');
  assert.ok(h.graphCalls[0].init.signal instanceof AbortSignal);
});

for (const [name, options] of [
  ['signed out or foreign workspace', { denied: true }],
  ['without conversation view permission', { noPermission: true }],
  ['other workspace message', { rows: [message({ business_id: 'b2' })] }],
  ['other conversation message', { rows: [message({ conversation_id: 'conv2' })] }],
  ['non-audio message', { rows: [message({ message_type: 'image' })] }],
  ['deleted voice', { rows: [message({ raw_payload: { tenh_deleted: {} } })] }],
]) test(`${name} cannot recover audio`, async () => {
  const h = setup(options);
  assert.ok((await h.get()).status >= 400);
  assert.equal(h.graphCalls.length, 0);
});

test('Telegram IDs never fall through to Facebook Graph', async () => {
  const h = setup({ rows: [message({ platform_message_id: 'telegram:chat:7' })] });
  assert.equal((await h.get()).status, 404);
  assert.equal(h.graphCalls.length, 0);
});

test('a failed refresh or untrusted refreshed URL remains unavailable', async () => {
  for (const graphResponse of [
    new Response(null, { status: 503 }),
    Response.json({ attachments: { data: [{ type: 'audio', audio_data: { url: 'https://evil.example/audio' } }] } }),
    Response.json({ attachments: { data: [{ type: 'image', file_url: 'https://lookaside.fbsbx.com/not-audio' }] } }),
  ]) {
    const h = setup({ graphResponse });
    const response = await h.get();
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('location'), null);
  }
});

test('invalid references stop before storage or provider access', async () => {
  const h = setup();
  for (const query of ['', 'conversationId=conv1', 'messageId=voice1']) {
    assert.equal((await h.get(query)).status, 400);
  }
  assert.equal(h.signedCalls.length, 0);
  assert.equal(h.graphCalls.length, 0);
});
