/** External artwork is delivered to Facebook as an image attachment, not as a native Facebook store item. */
export type StipopStickerChoice = {
  provider: "stipop";
  stickerId: string;
  label: string;
  imageUrl: string;
  selectionToken: string;
  expiresAt: number;
};
export const STIPOP_CATEGORIES = [
  { query: "hello", title: "Hello", icon: "👋" },
  { query: "thank you", title: "Thanks", icon: "🙏" },
  { query: "happy", title: "Happy", icon: "😊" },
  { query: "love", title: "Love", icon: "❤️" },
  { query: "sorry", title: "Sorry", icon: "🥺" },
  { query: "ok", title: "OK", icon: "👌" },
] as const;

import type { TelegramStickerChoice } from "@/lib/telegram/sticker-catalog";
export type InboxStickerChoice = TelegramStickerChoice | StipopStickerChoice;
export function isStipopSticker(sticker: InboxStickerChoice): sticker is StipopStickerChoice {
  return "provider" in sticker && sticker.provider === "stipop";
}
