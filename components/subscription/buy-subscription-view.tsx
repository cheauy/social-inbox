"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CustomSubscriptionBuilder } from "@/components/subscription/custom-subscription-builder";

import {
  TENH_BILLING_CYCLES,
  TENH_PLANS,
  calculatePlanTotalCents,
  formatUsdFromCents,
  type BillingCycle,
  type FixedPlanCode,
} from "@/lib/subscription/plan-catalog";

function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function BuySubscriptionView() {
  const searchParams = useSearchParams();
  const [cycle, setCycle] = useState<BillingCycle>(() => {
    const requested = searchParams.get("cycle");
    return TENH_BILLING_CYCLES.some((item) => item.id === requested)
      ? (requested as BillingCycle)
      : "monthly";
  });
  const [workingPlan, setWorkingPlan] =
    useState<FixedPlanCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const selectedCycle = useMemo(
    () =>
      TENH_BILLING_CYCLES.find((item) => item.id === cycle) ??
      TENH_BILLING_CYCLES[0],
    [cycle],
  );

  useEffect(() => {
    if (!customOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCustomOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [customOpen]);

  async function createFixedSubscription(planCode: FixedPlanCode) {
    if (workingPlan) return;

    setError(null);
    setWorkingPlan(planCode);

    try {
      const response = await fetch(
        "/api/workspaces/create-subscription",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planCode,
            billingCycle: cycle,
          }),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        details?: string;
        paymentUrl?: string;
      };

      if (!response.ok || !result.success || !result.paymentUrl) {
        throw new Error(
          result.error ??
            result.details ??
            "Unable to create subscription.",
        );
      }

      window.location.assign(result.paymentUrl);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create subscription.",
      );
      setWorkingPlan(null);
    }
  }

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto overscroll-y-contain">
      <div className="mx-auto w-full max-w-6xl px-5 py-7 pb-12 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
            Buy subscription
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
            Choose a TENH subscription
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Choose Standard, Team, or Pro. If you need different connection
            and user limits, build a Custom Subscription.
          </p>
        </div>

        <Link
          href="/dashboard/subscription"
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Back to Subscription
        </Link>
      </div>

      <section className="mt-7 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div>
          <p className="text-sm font-bold text-slate-900">
            Billing duration
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Longer prepaid periods receive the TENH duration discount.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TENH_BILLING_CYCLES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCycle(item.id)}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                cycle === item.id
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"
              }`}
            >
              <span className="block text-sm font-bold">
                {item.label}
              </span>
              <span className="mt-1 block text-[11px] opacity-75">
                {item.discount > 0
                  ? `Save ${Math.round(item.discount * 100)}%`
                  : "Standard price"}
              </span>
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {TENH_PLANS.map((plan) => {
          const totalCents =
            calculatePlanTotalCents(plan.id, cycle) ?? plan.monthlyCents;
          const working = workingPlan === plan.id;

          return (
            <section
              key={plan.id}
              className="flex min-h-[300px] flex-col rounded-[26px] border border-slate-200 bg-white p-6 shadow-sm"
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                    TENH plan
                  </p>
                  {plan.name === "Team" ? (
                    <span className="rounded-full bg-blue-600 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white">
                      Popular
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-2 text-2xl font-bold text-slate-950">
                  {plan.name}
                </h2>
                <p className="mt-2 min-h-[48px] text-sm leading-6 text-slate-500">
                  {plan.description}
                </p>
              </div>

              <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-bold text-slate-950">
                    {formatUsdFromCents(plan.monthlyCents)}
                  </span>
                  <span className="pb-1 text-sm text-slate-500">/mo</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  {plan.channels} connections · {plan.users} user
                  {plan.users === 1 ? "" : "s"}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-slate-500">
                  {selectedCycle.label} total
                </span>
                <span className="font-bold text-slate-950">
                  {formatUsdFromCents(totalCents)}
                </span>
              </div>

              <button
                type="button"
                disabled={Boolean(workingPlan)}
                onClick={() => void createFixedSubscription(plan.id)}
                className="mt-auto rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {working ? `Creating ${plan.name}...` : `Buy ${plan.name}`}
              </button>
            </section>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setCustomOpen(true)}
        className="mt-5 flex w-full items-center justify-between rounded-[24px] border border-blue-200 bg-blue-50 px-6 py-5 text-left text-blue-950 transition hover:border-blue-300 hover:bg-blue-100"
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
            Build your own
          </p>
          <h2 className="mt-1 text-xl font-bold">Custom Subscription</h2>

        </div>
        <ArrowRightIcon />
      </button>

      {customOpen ? (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/40 p-3 backdrop-blur-[2px] sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Create Custom Subscription"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setCustomOpen(false);
            }
          }}
        >
          <div className="mx-auto flex min-h-full w-full max-w-5xl items-start justify-center py-4 sm:py-8">
            <div className="relative w-full">
              <button
                type="button"
                onClick={() => setCustomOpen(false)}
                className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-xl font-medium text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-900"
                aria-label="Close custom subscription"
              >
                ×
              </button>

              <CustomSubscriptionBuilder embedded />
            </div>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
