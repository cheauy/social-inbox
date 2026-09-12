import {
  normalizeStickerSetName,
  telegramStickerPreviewUrl,
  type TelegramStickerChoice,
} from "@/lib/telegram/sticker-catalog";

/** Presentation helpers only; sending still belongs to the existing composer/API. */
export const MAX_RECENT_STICKER_CHOICES = 24;
export const STICKER_PACK_CACHE_MS = 5 * 60 * 1000;

export function rememberStickerChoice<T>(items: T[], next: T, key: (item: T) => string): T[] {
  return [next, ...items.filter(item => key(item) !== key(next))].slice(0, MAX_RECENT_STICKER_CHOICES);
}

export function stickerMatchesSearch(query: string, ...values: Array<string | null | undefined>) {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || values.some(value => (value || "").toLocaleLowerCase().includes(normalized));
}

export type StickerPanelLayout = { left: number; top: number; width: number; height: number };

/** Keeps the portal inside the visual viewport, including an open mobile keyboard. */
export function stickerPanelLayout(
  anchor: { left: number; top: number; bottom: number },
  viewport: { width: number; height: number; left?: number; top?: number },
): StickerPanelLayout {
  const margin = 8, gap = 8;
  const vx = viewport.left || 0, vy = viewport.top || 0;
  const width = Math.max(1, Math.min(420, viewport.width - margin * 2));
  const left = Math.max(vx + margin, Math.min(anchor.left - 12, vx + viewport.width - margin - width));
  const above = Math.max(0, anchor.top - gap - vy - margin);
  const below = Math.max(0, vy + viewport.height - margin - anchor.bottom - gap);
  if (Math.max(above, below) >= 250) {
    const useAbove = above >= 300 || above >= below;
    const height = Math.max(1, Math.min(450, useAbove ? above : below, viewport.height - margin * 2));
    const desiredTop = useAbove ? anchor.top - gap - height : anchor.bottom + gap;
    const top = Math.max(vy + margin, Math.min(desiredTop, vy + viewport.height - margin - height));
    return { left, top, width, height };
  }
  // A short screen/keyboard may cover the input; scrolling inside the picker remains available.
  return { left, top: vy + margin, width, height: Math.max(1, Math.min(450, viewport.height - margin * 2)) };
}

/** Retain only this conversation's returned set. Do not accept arbitrary preview hosts. */
export function readStickerPack(
  data: unknown,
  expectedSet: string,
  conversationId: string,
): { title: string; stickers: TelegramStickerChoice[] } | null {
  if (!data || typeof data !== "object" || !normalizeStickerSetName(expectedSet)) return null;
  const pack = data as Record<string, unknown>;
  if (pack.success !== true || !Array.isArray(pack.stickers)) return null;
  if (typeof pack.name === "string" && pack.name.toLowerCase() !== expectedSet.toLowerCase()) return null;
  const stickers: TelegramStickerChoice[] = [];
  const seen = new Set<string>();
  for (const raw of pack.stickers.slice(0, 120)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.setName !== "string" || item.setName.toLowerCase() !== expectedSet.toLowerCase()) continue;
    if (typeof item.stickerId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(item.stickerId) || seen.has(item.stickerId)) continue;
    if (item.format !== "static" && item.format !== "animated" && item.format !== "video") continue;
    seen.add(item.stickerId);
    stickers.push({
      setName: item.setName,
      stickerId: item.stickerId,
      label: typeof item.label === "string" ? item.label.slice(0, 160) : expectedSet,
      emoji: typeof item.emoji === "string" ? item.emoji.slice(0, 40) : null,
      format: item.format,
      // Always rebuild an authenticated local preview, never expose a Telegram bot-token URL.
      previewUrl: item.previewUrl ? telegramStickerPreviewUrl(conversationId, item.setName, item.stickerId) : null,
    });
  }
  return { title: typeof pack.title === "string" ? pack.title.slice(0, 160) : expectedSet, stickers };
}
