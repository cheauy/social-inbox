const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./tenh-seven/harness.cjs');
const { getMessageActions } = loader()('lib/inbox/message-actions.ts');
const row = (platform, direction, type) => ({ id: 'm1', conversation_id: 'c1', platform_message_id: platform === 'telegram' ? 'telegram:123:45' : 'mid1', direction, message_type: type, message_text: type === 'text' ? 'Hello' : null, attachment_url: type === 'text' ? null : 'https://example.com/media', raw_payload: {} });
for (const platform of ['facebook', 'telegram']) {
  for (const direction of ['incoming', 'outgoing']) test(`${platform} ${direction} text and media can be pinned`, () => {
    for (const type of ['text', 'image', 'video', 'audio', 'file', 'sticker']) {
      const actions = getMessageActions(row(platform, direction, type), platform);
      assert.equal(actions.pin, true);
      assert.equal(actions.edit, platform === 'telegram' && direction === 'outgoing' && type === 'text');
    }
  });
  test(`${platform} temporary and deleted messages cannot be pinned`, () => {
    const message = row(platform, 'incoming', 'text');
    assert.equal(getMessageActions({ ...message, id: 'optimistic:1' }, platform).pin, false);
    assert.equal(getMessageActions({ ...message, raw_payload: { tenh_deleted: true } }, platform).pin, false);
  });
}
