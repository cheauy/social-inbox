import type { TelegramStickerChoice } from "@/lib/telegram/sticker-catalog";

/** A native first-party Meta Messenger sticker returned by Meta's Sticker API. */
export type MetaStickerChoice = {
  provider: "meta";
  stickerId: string;
  label: string;
  previewUrl: string | null;
  packId: string | null;
  width: number | null;
  height: number | null;
  animated: boolean;
};

export type MetaStickerPack = {
  packId: string;
  name: string;
  description: string | null;
  previewUrl: string | null;
  stickerCount: number | null;
};


/** @deprecated Build-compatibility only for the retired external sticker component.
 * Facebook's active picker no longer imports or sends this type. */
export type StipopStickerChoice = {
  provider: "stipop";
  stickerId: string;
  label: string;
  imageUrl: string;
  selectionToken: string;
  expiresAt: number;
};

/** @deprecated Build-compatibility only. The active Facebook picker gets packs from Meta. */
export const STIPOP_CATEGORIES = [
  { query: "hello", title: "Hello", icon: "👋" },
  { query: "thank you", title: "Thanks", icon: "🙏" },
  { query: "happy", title: "Happy", icon: "😊" },
  { query: "love", title: "Love", icon: "❤️" },
  { query: "sorry", title: "Sorry", icon: "🥺" },
  { query: "ok", title: "OK", icon: "👌" },
] as const;

export type InboxStickerChoice = TelegramStickerChoice | MetaStickerChoice;

export function isMetaSticker(sticker: InboxStickerChoice): sticker is MetaStickerChoice {
  return "provider" in sticker && sticker.provider === "meta";
}
