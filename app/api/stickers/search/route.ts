import { NextRequest, NextResponse } from "next/server";
import { stickerConversation, searchStickers, StipopError } from "@/lib/stickers/stipop-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const params = new URL(request.url).searchParams;
    const scope = await stickerConversation(params.get("conversationId") || "");
    const result = await searchStickers(scope, params.get("q") || "hello", Number(params.get("page") || "1"));
    return NextResponse.json({ success: true, provider: "stipop", ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof StipopError ? error.message : "Unable to load stickers.", code: error instanceof StipopError ? error.code : "STICKER_SERVICE_UNAVAILABLE" }, { status: error instanceof StipopError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
