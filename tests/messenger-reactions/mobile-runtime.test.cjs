const test = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('../tenh-seven/harness.cjs');

for (const runtime of [{ name: 'no Segmenter', Intl: {} }, { name: 'no Intl', Intl: undefined }]) {
  test(`mobile reactions render safely with ${runtime.name}`, () => {
    const reactions = loader({}, { Intl: runtime.Intl })('lib/facebook/message-reactions.ts');
    const valid = reactions.MESSENGER_QUICK_REACTIONS.map(item => item.emoji).concat([
      '🇰🇭', '👨‍👩‍👧‍👦', '👍🏽', '1️⃣', '#️⃣', '👩🏾‍💻', '🏳️‍🌈',
      '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
    ]);
    for (const emoji of valid) {
      assert.equal(reactions.isMessengerReactionEmoji(emoji), true, emoji);
      const raw = reactions.withMessengerReaction({}, 'customer', { emoji, timestamp: 100 });
      assert.equal(reactions.getMessengerReaction(raw, 'customer').emoji, emoji);
      const removed = reactions.withMessengerReaction(raw, 'customer', { emoji: null, timestamp: 200 });
      assert.equal(reactions.getMessengerReaction(removed, 'customer').emoji, null);
    }
    for (const value of ['', 'hello', '❤️hello', '<img>', '123', ' ❤️', '❤️❤️', '👍🏽👍', '🇰🇭🇺🇸', '1️⃣2️⃣', '👩‍', '‍👩', {}, null]) {
      assert.equal(reactions.isMessengerReactionEmoji(value), false, String(value));
      assert.equal(reactions.getMessengerReaction({ tenh_messenger_reactions: { page: { emoji: value, timestamp: 1 } } }, 'page')?.emoji ?? null, null);
    }
  });
}
