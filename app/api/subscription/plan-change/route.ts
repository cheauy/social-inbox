import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { memberHasPermission } from "@/lib/auth/require-permission";
import {
  loadPlanChangeState,
  type PlanChangeState,
} from "@/lib/subscription/plan-change-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: Record<string, unknown>, init?: { status?: number }) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function publicPlanChangeState(state: PlanChangeState) {
  return {
    mode: state.mode,
    canManage: state.canManage,
    isOwner: state.isOwner,
    currentPlan: state.currentPlan,
    currentRank: state.currentRank,
    usage: state.usage,
  };
}

/*
 * Read-only endpoint. It reports the workspace's current plan-change security
 * state so Subscription can decide which purchase paths to offer.
 *
 * The former POST handler ("schedule-downgrade" / "cancel-downgrade") was
 * removed together with the scheduled-downgrade feature. A smaller plan is now
 * bought as a new prepaid subscription instead of being scheduled.
 */
export async function GET() {
  try {
    const authResult = await getCurrentMember();

    if (!authResult.success) {
      return noStoreJson(
        { success: false, error: authResult.error },
        { status: authResult.status },
      );
    }

    const member = authResult.member;
    const canManageBilling = await memberHasPermission(
      member,
      "billing",
      "manage",
    );
    const state = await loadPlanChangeState(member.business_id, {
      canManage: canManageBilling,
      isOwner: member.role === "owner",
    });
    return noStoreJson({ success: true, ...publicPlanChangeState(state) });
  } catch (error) {
    console.error("[TENH] Unable to load plan-change state:", error);

    return noStoreJson(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load subscription plan-change information.",
      },
      { status: 500 },
    );
  }
}
