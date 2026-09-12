/** Public Telegram packs, loaded through the customer's own connected bot.
 * No sticker artwork is bundled or republished to Facebook. Availability and
 * titles are checked with getStickerSet when the agent opens a pack. */
export const TELEGRAM_STICKER_PACKS = [
  { name: "UtyaDuck", title: "Duck", icon: "🦆" },
  { name: "HotCherry", title: "Hot Cherry", icon: "🍒" },
  { name: "Animals", title: "Just zoo it!", icon: "🐾" },
  { name: "AnimatedEmojies", title: "Animated Emoji", icon: "🙂" },
  { name: "HamsterBernard", title: "Hamster Bernard", icon: "🐹" },
  { name: "StripedCat", title: "Striped Cat", icon: "🐱" },
] as const;
export type TelegramStickerChoice = {
  setName: string; stickerId: string; label: string;
  emoji: string | null; format: "static" | "animated" | "video"; previewUrl: string | null;
};
export function normalizeStickerSetName(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 200) return null;
  let name = input.trim();
  if (/^https:\/\//i.test(name)) {
    try { const url = new URL(name);
      if (url.hostname !== "t.me" || url.port || url.username || url.password || url.search || url.hash) return null;
      name = url.pathname.match(/^\/addstickers\/([A-Za-z][A-Za-z0-9_]{0,63})\/?$/)?.[1] || "";
    } catch { return null; }
  }
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) ? name : null;
}
export function telegramStickerPreviewUrl(conversationId: string, setName: string, stickerId: string) {
  return `/api/telegram/stickers/preview?${new URLSearchParams({ conversationId, set: setName, sticker: stickerId })}`;
}
