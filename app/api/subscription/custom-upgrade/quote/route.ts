import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import { buildCustomUpgradeQuote } from "@/lib/subscription/custom-upgrade";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getCurrentMember();
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  if (auth.member.role !== "owner") return NextResponse.json({ success: false, error: "Only the subscription Owner can upgrade." }, { status: 403 });

  const url = new URL(request.url);
  const { data: subscription, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select("status,plan_code,billing_cycle,member_limit,channel_limit,current_period_start,current_period_end,pricing_snapshot")
    .eq("business_id", auth.member.business_id)
    .maybeSingle();
  if (error || !subscription) return NextResponse.json({ success: false, error: "Unable to load this subscription." }, { status: 404 });

  try {
    const quote = buildCustomUpgradeQuote({
      subscription,
      targetConnections: Number(url.searchParams.get("connections")),
      targetUsers: Number(url.searchParams.get("users")),
      targetBillingCycle: url.searchParams.get("cycle") ?? "",
    });
    return NextResponse.json({ success: true, quote });
  } catch (reason) {
    return NextResponse.json({ success: false, error: reason instanceof Error ? reason.message : "Unable to calculate upgrade." }, { status: 409 });
  }
}
