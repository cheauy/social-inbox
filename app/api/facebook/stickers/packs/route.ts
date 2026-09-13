import { NextRequest, NextResponse } from "next/server";
import { listMetaStickerPacks, metaStickerConversation, MetaStickerError } from "@/lib/stickers/meta-messenger-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const q = new URL(request.url).searchParams;
    const scope = await metaStickerConversation(q.get("conversationId") || "");
    const result = await listMetaStickerPacks(scope, q.get("after"));
    return NextResponse.json({ success: true, provider: "meta", ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const known = error instanceof MetaStickerError;
    return NextResponse.json({ success: false, error: known ? error.message : "Unable to load Meta sticker packs.", code: known ? error.code : "META_STICKER_PACKS_FAILED", ...(known && error.details ? { details: error.details } : {}) }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
