import { NextResponse } from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  isBillingCycle,
  isPaidPlan,
  loadPlanChangeState,
  paidPlanRanks,
  type BillingCycle,
  type PaidPlanCode,
  type PlanChangeState,
} from "@/lib/subscription/plan-change-security";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlanChangeAction = "schedule-downgrade" | "cancel-downgrade";

type PlanChangeBody = {
  action?: unknown;
  targetPlan?: unknown;
  billingCycle?: unknown;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");

  // Browser mutation requests normally include Origin. Authentication, exact
  // workspace scoping, owner validation, and the SQL RPC still remain mandatory.
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

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
    pendingChange: state.pendingChange,
  };
}

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

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) {
      return noStoreJson(
        {
          success: false,
          error: "Cross-origin subscription changes are not allowed.",
        },
        { status: 403 },
      );
    }

    if (
      !request.headers
        .get("content-type")
        ?.toLowerCase()
        .includes("application/json")
    ) {
      return noStoreJson(
        {
          success: false,
          error: "Subscription changes require a JSON request.",
        },
        { status: 415 },
      );
    }

    const authResult = await getCurrentMember();

    if (!authResult.success) {
      return noStoreJson(
        { success: false, error: authResult.error },
        { status: authResult.status },
      );
    }

    const member = authResult.member;

    // Billing Manage is intentionally limited to PAID UPGRADES. Owner-only
    // plan administration (such as downgrade scheduling/cancellation) stays
    // Owner-only and cannot be granted through Roles & permissions.
    if (member.role !== "owner") {
      return permissionDenied(
        "Only the workspace Owner can change subscription administration settings.",
      );
    }

    const body = (await request.json()) as PlanChangeBody;
    const action = cleanString(body.action) as PlanChangeAction;

    if (action === "cancel-downgrade") {
      const { error: rpcError } = await supabaseAdmin.rpc(
        "tenh_cancel_plan_downgrade",
        {
          p_business_id: member.business_id,
          p_member_id: member.id,
        },
      );

      if (rpcError) {
        return noStoreJson(
          { success: false, error: rpcError.message },
          { status: rpcError.code === "42501" ? 403 : 409 },
        );
      }

      const state = await loadPlanChangeState(member.business_id, { canManage: true, isOwner: true });
      return noStoreJson({ success: true, ...publicPlanChangeState(state) });
    }

    if (action !== "schedule-downgrade") {
      return noStoreJson(
        {
          success: false,
          error: "Unknown subscription plan-change action.",
        },
        { status: 400 },
      );
    }

    const targetPlan = cleanString(body.targetPlan);
    const billingCycle = cleanString(body.billingCycle);

    if (!isPaidPlan(targetPlan)) {
      return noStoreJson(
        { success: false, error: "Choose Mini, Standard, or Pro." },
        { status: 400 },
      );
    }

    if (!isBillingCycle(billingCycle)) {
      return noStoreJson(
        { success: false, error: "Choose a valid billing period." },
        { status: 400 },
      );
    }

    // Friendly precheck only. The service-role-only SQL RPC repeats the
    // identity/state/rank/usage checks while holding a transaction lock.
    const before = await loadPlanChangeState(member.business_id, { canManage: true, isOwner: true });

    if (before.mode !== "active-paid" || !before.currentPlan) {
      return noStoreJson(
        {
          success: false,
          error:
            "Downgrade scheduling is only available for an active paid subscription. Trial, expired, or past-due customers should purchase the chosen plan for the next prepaid period instead.",
        },
        { status: 409 },
      );
    }

    if (paidPlanRanks[targetPlan] >= paidPlanRanks[before.currentPlan]) {
      return noStoreJson(
        {
          success: false,
          error: "The selected plan is not a downgrade from your current plan.",
        },
        { status: 409 },
      );
    }

    const { error: rpcError } = await supabaseAdmin.rpc(
      "tenh_schedule_plan_downgrade",
      {
        p_business_id: member.business_id,
        p_member_id: member.id,
        p_target_plan: targetPlan as PaidPlanCode,
        p_billing_cycle: billingCycle as BillingCycle,
      },
    );

    if (rpcError) {
      return noStoreJson(
        { success: false, error: rpcError.message },
        { status: rpcError.code === "42501" ? 403 : 409 },
      );
    }

    const state = await loadPlanChangeState(member.business_id, { canManage: true, isOwner: true });
    return noStoreJson({ success: true, ...publicPlanChangeState(state) });
  } catch (error) {
    console.error("[TENH] Subscription plan-change failed:", error);

    return noStoreJson(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to change the subscription plan.",
      },
      { status: 500 },
    );
  }
}
