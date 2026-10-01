import { NextRequest, NextResponse } from "next/server";
import { runAutoReplyBatch } from "@/lib/facebook/auto-reply";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  // Fail closed until deployment setup is explicitly completed. No credentials created here.
  if (process.env.FACEBOOK_AUTO_REPLY_WORKER_ENABLED !== "true") return NextResponse.json({ paused: true });
  try {
    return NextResponse.json(await runAutoReplyBatch(), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Auto Reply worker unavailable." }, { status: 503 }); }
}

