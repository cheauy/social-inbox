const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('../../tests/tenh-seven/harness.cjs');

function setup() {
  let stored = null;
  const api = loader({ './auth/secure-storage': { sessionStorage: {
    getItem: async () => stored, setItem: async (_, value) => { stored = value; }, removeItem: async () => { stored = null; },
  } } }, { URLSearchParams })('mobile/lib/sticker-recents.ts');
  return { ...api, setRaw: value => { stored = value; } };
}
const sticker = id => ({ provider: 'meta', stickerId: String(id), label: 'Sticker', previewUrl: 'https://example.com/a.png', packId: '1', width: 100, height: 100, animated: false });
test('recent stickers are deduplicated, newest first and limited to 24', async () => {
  const h = setup(), generation = h.stickerRecentGeneration();
  for (let i = 0; i < 30; i++) await h.rememberSticker('u', 'w', 'facebook', sticker(i), generation);
  await h.rememberSticker('u', 'w', 'facebook', sticker(12), generation);
  const items = await h.readStickerRecents('u', 'w', 'facebook', 'c');
  assert.equal(items.length, 24); assert.equal(items[0].stickerId, '12');
  assert.equal(items.filter(item => item.stickerId === '12').length, 1);
});
test('recents are isolated by account, workspace and channel', async () => {
  const h = setup(); await h.rememberSticker('u', 'w', 'facebook', sticker(1), h.stickerRecentGeneration());
  for (const scope of [['other', 'w', 'facebook'], ['u', 'other', 'facebook'], ['u', 'w', 'telegram']]) {
    assert.equal((await h.readStickerRecents(...scope, 'c')).length, 0);
  }
});
test('sign-out clears storage and rejects a send that finishes after sign-out', async () => {
  const h = setup(), before = h.stickerRecentGeneration();
  const pending = h.rememberSticker('u', 'w', 'facebook', sticker(1), before);
  await h.clearStickerRecents(); await pending;
  await h.rememberSticker('u', 'w', 'facebook', sticker(2), before);
  assert.equal((await h.readStickerRecents('u', 'w', 'facebook', 'c')).length, 0);
});
test('Telegram previews use the current conversation without changing the sticker', async () => {
  const h = setup();
  await h.rememberSticker('u', 'w', 'telegram', { setName: 'UtyaDuck', stickerId: 'abc', label: 'Duck', emoji: '🦆', format: 'static', previewUrl: '/api/telegram/stickers/preview?conversationId=old' }, h.stickerRecentGeneration());
  const items = await h.readStickerRecents('u', 'w', 'telegram', 'new');
  assert.match(items[0].previewUrl, /conversationId=new/); assert.equal(items[0].stickerId, 'abc');
});
test('expired, corrupt and oversized cache cannot populate recents', async () => {
  const h = setup();
  for (const value of ['broken', 'x'.repeat(60001), JSON.stringify([{ scope: JSON.stringify(['u', 'w', 'facebook']), at: Date.now() - 31 * 86400000, items: [sticker(1)] }])]) {
    h.setRaw(value); assert.equal((await h.readStickerRecents('u', 'w', 'facebook', 'c')).length, 0);
  }
});
