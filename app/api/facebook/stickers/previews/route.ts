import { NextRequest, NextResponse } from "next/server";
import { listMetaStickers, metaStickerConversation, MetaStickerError } from "@/lib/stickers/meta-messenger-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One individual sticker per visible tab, sharing the full-pack server cache. */
export async function GET(request: NextRequest) {
  try {
    const q = new URL(request.url).searchParams;
    const ids = [...new Set((q.get("packIds") || "").split(","))];
    if (!ids.length || ids.length > 8 || ids.some(id => !/^\d{1,40}$/.test(id))) throw new MetaStickerError("Choose up to 8 sticker packs.");
    const scope = await metaStickerConversation(q.get("conversationId") || "");
    const results = await Promise.allSettled(ids.map(async packId => {
      // Meta documents the pack endpoint without a limit parameter. Return only
      // one sticker to the browser; reuse the cached catalog when the pack opens.
      const { stickers } = await listMetaStickers(scope, packId);
      return { packId, sticker: stickers.find(sticker => sticker.previewUrl) || null };
    }));
    const previews = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    return NextResponse.json({ success: true, previews }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const known = error instanceof MetaStickerError;
    return NextResponse.json({ success: false, error: known ? error.message : "Unable to load sticker previews." }, { status: known ? error.status : 503 });
  }
}
