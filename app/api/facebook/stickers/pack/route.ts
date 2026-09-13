import { NextRequest, NextResponse } from "next/server";
import { listMetaStickers, metaStickerConversation, MetaStickerError } from "@/lib/stickers/meta-messenger-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const q = new URL(request.url).searchParams;
    const scope = await metaStickerConversation(q.get("conversationId") || "");
    const result = await listMetaStickers(scope, q.get("packId") || "", q.get("after"));
    return NextResponse.json({ success: true, provider: "meta", packId: q.get("packId"), ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const known = error instanceof MetaStickerError;
    return NextResponse.json({ success: false, error: known ? error.message : "Unable to load this Meta sticker pack.", code: known ? error.code : "META_STICKER_PACK_FAILED", ...(known && error.details ? { details: error.details } : {}) }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
