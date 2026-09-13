import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Legacy external image-sticker sending was retired. Never degrade a native Meta sticker to an image. */
export async function POST() {
  return NextResponse.json({
    success: false,
    code: "LEGACY_STICKER_ROUTE_RETIRED",
    error: "Refresh TENH. Facebook stickers are now sent by Meta sticker ID.",
    replacement: "/api/facebook/stickers/send",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
