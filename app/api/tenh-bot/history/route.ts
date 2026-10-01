import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/require-permission";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const guard = await requirePermission("channels", "view");
  if (!guard.success) return guard.response;
  const business = guard.context.member.business_id, channel = request.nextUrl.searchParams.get("channelId");
  if (!channel || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(channel)) return NextResponse.json({ error: "Choose a channel." }, { status: 400 });
  const page = await db.from("social_accounts").select("id").eq("id", channel).eq("business_id", business).eq("is_active", true).maybeSingle();
  if (page.error || !page.data) return NextResponse.json({ error: "Channel unavailable." }, { status: 404 });
  const jobs = await db.from("tenh_bot_execution_jobs").select("id,rule_id,status,reason,created_at,action").eq("business_id", business)
    .eq("social_account_id", channel).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(30);
  if (jobs.error) return NextResponse.json({ error: "Execution history storage is not installed or is unavailable." }, { status: 503 });
  return NextResponse.json({ success: true, jobs: jobs.data, limit: 30 }, { headers: { "Cache-Control": "no-store" } });
}
