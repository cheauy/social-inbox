import { NextResponse } from "next/server";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import { buildCustomUpgradeQuote } from "@/lib/subscription/custom-upgrade";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await getCurrentMember();
  if (!auth.success) {
    return NextResponse.json(
      { success: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const requestedBusinessId =
    url.searchParams.get("business_id")?.trim() || null;

  let targetBusinessId = auth.member.business_id;
  let billingMember: Pick<typeof auth.member, "id" | "role"> = auth.member;

  // A customer can open Upgrade from a subscription card that is not the
  // currently active workspace. Resolve that exact subscription explicitly
  // so quote pricing can never leak from the previously selected workspace.
  if (
    requestedBusinessId &&
    requestedBusinessId !== auth.member.business_id
  ) {
    const { data: targetMember, error: targetMemberError } =
      await supabaseAdmin
        .from("team_members")
        .select("id,role")
        .eq("business_id", requestedBusinessId)
        .eq("user_id", auth.user.id)
        .eq("is_active", true)
        .maybeSingle();

    if (targetMemberError || !targetMember) {
      return NextResponse.json(
        { success: false, error: "You do not have access to this subscription." },
        { status: 403 },
      );
    }

    targetBusinessId = requestedBusinessId;
    billingMember = targetMember;
  }

  if (!(await memberHasPermission(billingMember, "billing", "manage"))) {
    return permissionDenied(
      "Subscription & billing Manage permission is required to upgrade this workspace.",
    );
  }

  const { data: subscription, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select(
      "status,plan_code,billing_cycle,member_limit,channel_limit,current_period_start,current_period_end,pricing_snapshot",
    )
    .eq("business_id", targetBusinessId)
    .maybeSingle();

  if (error || !subscription) {
    return NextResponse.json(
      { success: false, error: "Unable to load this subscription." },
      { status: 404 },
    );
  }

  try {
    const quote = buildCustomUpgradeQuote({
      subscription,
      targetConnections: Number(url.searchParams.get("connections")),
      targetUsers: Number(url.searchParams.get("users")),
      targetBillingCycle: url.searchParams.get("cycle") ?? "",
    });

    return NextResponse.json({ success: true, quote });
  } catch (reason) {
    return NextResponse.json(
      {
        success: false,
        error:
          reason instanceof Error
            ? reason.message
            : "Unable to calculate upgrade.",
      },
      { status: 409 },
    );
  }
}
