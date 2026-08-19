import { redirect } from "next/navigation";

import { SubscriptionPaymentView } from "@/components/subscription/subscription-payment-view";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  getPlanPurchaseEligibility,
  isPaidPlan,
  loadPlanChangeState,
} from "@/lib/subscription/plan-change-security";
import {
  calculateUpgradeTotalCents,
  getBillingCycleDefinition,
  getPlanDefinition,
  normalizeCustomCapacity,
  type BillingCycle,
  type PlanCode,
} from "@/lib/subscription/plan-catalog";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildCustomUpgradeQuote } from "@/lib/subscription/custom-upgrade";

type PaymentPageProps = {
  searchParams: Promise<{
    plan?: string | string[];
    cycle?: string | string[];
    connections?: string | string[];
    users?: string | string[];
    renew?: string | string[];
    upgrade?: string | string[];
    payway?: string | string[];
    tran_id?: string | string[];
    purchase_business?: string | string[];
  }>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function SubscriptionPaymentPage({ searchParams }: PaymentPageProps) {
  const params = await searchParams;
  const planCode = single(params.plan).trim();
  const billingCycle = single(params.cycle).trim();
  const cycle = getBillingCycleDefinition(billingCycle);
  const renewSame = single(params.renew).trim() === "same";
  const customUpgrade = single(params.upgrade).trim() === "custom";
  const purchaseBusinessId = single(params.purchase_business).trim();

  if (!cycle) redirect("/dashboard/subscription");

  const authResult = await getCurrentMember();
  if (!authResult.success) redirect("/login");

  const member = authResult.member;
  const targetBusinessId = purchaseBusinessId || member.business_id;

  if (purchaseBusinessId && purchaseBusinessId !== member.business_id) {
    const { data: purchaseMember, error: purchaseMemberError } = await supabaseAdmin
      .from("team_members")
      .select("id,role")
      .eq("business_id", purchaseBusinessId)
      .eq("user_id", authResult.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (purchaseMemberError || !purchaseMember || purchaseMember.role !== "owner") {
      redirect("/dashboard/subscription?plan_change_blocked=owner-only");
    }
  } else if (member.role !== "owner") {
    redirect("/dashboard/subscription?plan_change_blocked=owner-only");
  }

  let renewalSnapshot:
    | {
        totalCents: number;
        connections: number;
        users: number;
      }
    | null = null;

  if (renewSame) {
    const { data: previous, error: previousError } =
      await supabaseAdmin
        .from("business_subscriptions")
        .select(
          "status,plan_code,billing_cycle,last_paid_amount,last_paid_currency,member_limit,channel_limit,pricing_snapshot",
        )
        .eq("business_id", targetBusinessId)
        .maybeSingle();

    const previousSnapshot =
      previous?.pricing_snapshot &&
      typeof previous.pricing_snapshot === "object" &&
      !Array.isArray(previous.pricing_snapshot)
        ? (previous.pricing_snapshot as Record<string, unknown>)
        : {};
    const savedRenewalCents = Number(
      previousSnapshot.renewal_total_cents,
    );
    const amount =
      Number.isFinite(savedRenewalCents) && savedRenewalCents > 0
        ? savedRenewalCents / 100
        : Number(previous?.last_paid_amount);
    const eligibleStatus =
      previous?.status === "expired" ||
      previous?.status === "past_due" ||
      previous?.status === "cancelled";

    if (
      previousError ||
      !previous ||
      !eligibleStatus ||
      previous.plan_code !== planCode ||
      previous.billing_cycle !== billingCycle ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      redirect(
        "/dashboard/subscription?plan_change_blocked=renew-same-not-eligible",
      );
    }

    renewalSnapshot = {
      totalCents: Math.round(amount * 100),
      connections: previous.channel_limit,
      users: previous.member_limit,
    };
  }

  if (planCode === "custom") {
    const capacity = renewalSnapshot
      ? {
          connections: renewalSnapshot.connections,
          users: renewalSnapshot.users,
        }
      : normalizeCustomCapacity(
          Number(single(params.connections)),
          Number(single(params.users)),
        );

    if (!capacity) redirect("/dashboard/subscription#custom-subscription");

    const { data: subscription, error } = await supabaseAdmin
      .from("business_subscriptions")
      .select("status,plan_code,billing_cycle,member_limit,channel_limit,current_period_start,current_period_end,pricing_snapshot")
      .eq("business_id", targetBusinessId)
      .maybeSingle();

    if (error || !subscription) redirect("/dashboard/subscription");
    if (subscription.status === "suspended") {
      redirect("/dashboard/subscription?plan_change_blocked=suspended");
    }

    if (customUpgrade) {
      try {
        const quote = buildCustomUpgradeQuote({
          subscription,
          targetConnections: capacity.connections,
          targetUsers: capacity.users,
          targetBillingCycle: cycle.id,
        });
        return (
          <div className="h-full overflow-y-auto">
            <SubscriptionPaymentView
              planCode="custom"
              billingCycle={cycle.id as BillingCycle}
              customConnections={capacity.connections}
              customUsers={capacity.users}
              customUpgrade
              customUpgradeTotalCents={quote.totalCents}
              customUpgradeCurrentPeriodEnd={quote.currentPeriodEnd}
              customUpgradeNewPeriodEnd={quote.newPeriodEnd}
              initialPayWayReturn={single(params.payway).trim() || null}
              initialTransactionId={single(params.tran_id).trim() || null}
                purchaseBusinessId={purchaseBusinessId || null}
            />
          </div>
        );
      } catch {
        redirect("/dashboard/subscription?plan_change_blocked=invalid-custom-upgrade");
      }
    }

    // A normal custom purchase cannot replace an active subscription. Use
    // Custom Upgrade for more capacity/time, or Buy new subscription separately.
    if (subscription.status === "active") {
      redirect("/dashboard/subscription?plan_change_blocked=custom-active-period");
    }

    return (
      <div className="h-full overflow-y-auto">
        <SubscriptionPaymentView
          planCode="custom"
          billingCycle={cycle.id as BillingCycle}
          customConnections={capacity.connections}
          customUsers={capacity.users}
          renewSame={renewSame}
          renewalTotalCents={renewalSnapshot?.totalCents ?? null}
          initialPayWayReturn={single(params.payway).trim() || null}
          initialTransactionId={single(params.tran_id).trim() || null}
          purchaseBusinessId={purchaseBusinessId || null}
        />
      </div>
    );
  }

  if (!getPlanDefinition(planCode) || !isPaidPlan(planCode)) {
    redirect("/dashboard/subscription");
  }

  if (renewalSnapshot) {
    return (
      <div className="h-full overflow-y-auto">
        <SubscriptionPaymentView
          planCode={planCode as PlanCode}
          billingCycle={billingCycle as BillingCycle}
          renewSame
          renewalTotalCents={renewalSnapshot.totalCents}
          initialPayWayReturn={single(params.payway).trim() || null}
          initialTransactionId={single(params.tran_id).trim() || null}
          purchaseBusinessId={purchaseBusinessId || null}
        />
      </div>
    );
  }

  const state = await loadPlanChangeState(targetBusinessId, "owner");
  const eligibility = getPlanPurchaseEligibility(state, planCode);

  if (!eligibility.allowed) {
    const reason = encodeURIComponent(eligibility.reason);
    redirect(`/dashboard/subscription?plan_change_blocked=${reason}`);
  }

  const upgradeTotalCents =
    state.mode === "active-paid" && state.currentPlan
      ? calculateUpgradeTotalCents(
          state.currentPlan,
          planCode,
          billingCycle,
        )
      : null;

  return (
    <div className="h-full overflow-y-auto">
      <SubscriptionPaymentView
        planCode={planCode as PlanCode}
        billingCycle={billingCycle as BillingCycle}
        upgradeFromPlanCode={
          upgradeTotalCents !== null ? state.currentPlan : null
        }
        upgradeTotalCents={upgradeTotalCents}
        initialPayWayReturn={single(params.payway).trim() || null}
        initialTransactionId={single(params.tran_id).trim() || null}
          purchaseBusinessId={purchaseBusinessId || null}
      />
    </div>
  );
}
