import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Legacy external sticker search was retired. Facebook now uses Meta's native Sticker API. */
export async function GET() {
  return NextResponse.json({
    success: false,
    code: "LEGACY_STICKER_ROUTE_RETIRED",
    error: "Refresh TENH. Facebook stickers now load from Meta's native Messenger Sticker API.",
    replacement: "/api/facebook/stickers/search",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
