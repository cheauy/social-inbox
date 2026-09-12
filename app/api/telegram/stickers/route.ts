import { NextRequest, NextResponse } from "next/server";
import { getStickerConversation, loadStickerSet, StickerStoreError } from "@/lib/telegram/sticker-store-server";
import { telegramStickerPreviewUrl } from "@/lib/telegram/sticker-catalog";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const query = new URL(request.url).searchParams; const conversationId = query.get("conversationId") || "";
    if (!conversationId || conversationId.length > 100) throw new StickerStoreError("Select a Telegram conversation first.");
    const scope = await getStickerConversation(conversationId);
    const pack = await loadStickerSet(scope, query.get("set"));
    return NextResponse.json({ success: true, name: pack.name, title: pack.title,
      stickers: pack.stickers.filter(s => s.type === "regular").slice(0, 120).map(s => ({
        setName: pack.name, stickerId: s.file_unique_id, label: s.emoji || pack.title,
        emoji: s.emoji || null, format: s.is_video ? "video" : s.is_animated ? "animated" : "static",
        previewUrl: s.thumbnail || (!s.is_animated && !s.is_video) ? telegramStickerPreviewUrl(conversationId, pack.name, s.file_unique_id) : null,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof StickerStoreError ? error.message : "Telegram could not load this pack. Check the bot connection or try another pack." }, { status: error instanceof StickerStoreError ? error.status : 502 });
  }
}
