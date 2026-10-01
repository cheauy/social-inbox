import { NextRequest, NextResponse } from "next/server";
import { runTenhBotWorker } from "@/lib/bot/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (process.env.TENH_BOT_EXECUTION_ENABLED !== "true") return NextResponse.json({ paused: true, processed: 0 });
  try { return NextResponse.json(await runTenhBotWorker(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Bot worker unavailable; check its ledger before retrying effects." }, { status: 503 }); }
}
