import { redirect } from "next/navigation";

import { SubscriptionPaymentView } from "@/components/subscription/subscription-payment-view";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  getPlanPurchaseEligibility,
  isPaidPlan,
  loadPlanChangeState,
} from "@/lib/subscription/plan-change-security";
import {
  getBillingCycleDefinition,
  getPlanDefinition,
  type BillingCycle,
  type PlanCode,
} from "@/lib/subscription/plan-catalog";

type PaymentPageProps = {
  searchParams: Promise<{
    plan?: string | string[];
    cycle?: string | string[];
    payway?: string | string[];
    tran_id?: string | string[];
  }>;
};

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function SubscriptionPaymentPage({
  searchParams,
}: PaymentPageProps) {
  const params = await searchParams;
  const planCode = single(params.plan).trim();
  const billingCycle = single(params.cycle).trim();

  if (
    !getPlanDefinition(planCode) ||
    !getBillingCycleDefinition(billingCycle) ||
    !isPaidPlan(planCode)
  ) {
    redirect("/dashboard/subscription");
  }

  const authResult = await getCurrentMember();

  if (!authResult.success) {
    redirect("/login");
  }

  const member = authResult.member;
  const state = await loadPlanChangeState(member.business_id, member.role);
  const eligibility = getPlanPurchaseEligibility(state, planCode);

  // Critical UX/security gate: do not show bank QR/details for a payment that
  // the current subscription is not allowed to make. SQL purchase guards also
  // enforce the same policy if someone bypasses this page and calls APIs.
  if (!eligibility.allowed) {
    const reason = encodeURIComponent(eligibility.reason);
    redirect(`/dashboard/subscription?plan_change_blocked=${reason}`);
  }

  return (
    <div className="h-full overflow-y-auto">
      <SubscriptionPaymentView
        planCode={planCode as PlanCode}
        billingCycle={billingCycle as BillingCycle}
        initialPayWayReturn={single(params.payway).trim() || null}
        initialTransactionId={single(params.tran_id).trim() || null}
      />
    </div>
  );
}
