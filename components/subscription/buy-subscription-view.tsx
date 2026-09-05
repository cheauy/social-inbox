"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { CustomSubscriptionBuilder } from "@/components/subscription/custom-subscription-builder";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

import {
  TENH_BILLING_CYCLES,
  TENH_PLANS,
  calculatePlanTotalCents,
  formatUsdFromCents,
  type BillingCycle,
  type FixedPlanCode,
} from "@/lib/subscription/plan-catalog";

function ArrowRightIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function ArrowLeftIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </svg>
  );
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function StarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="m12 2.8 2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84-5.4 2.84 1.03-6-4.36-4.25 6.03-.88L12 2.8Z" />
    </svg>
  );
}

function RocketIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M14.5 5.5c2.9-2.9 5.8-2.5 5.8-2.5s.4 2.9-2.5 5.8l-4.9 4.9-4.3-4.3 5.9-3.9Z" />
      <path d="M9.2 8.8 5.8 8l-2.6 2.6 4.4 1.1M13 14.2l1.1 4.4 2.6-2.6-.8-3.4" />
      <circle cx="15.7" cy="7.5" r="1.5" />
      <path d="M7.3 15.2c-1.5.2-3 1.1-3.8 2.6-.5 1-.6 2.2-.3 3.2 1 .3 2.2.2 3.2-.3 1.5-.8 2.4-2.3 2.6-3.8" />
    </svg>
  );
}

function TeamIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3.3" />
      <path d="M3.5 20v-1.4A4.6 4.6 0 0 1 8.1 14h1.8a4.6 4.6 0 0 1 4.6 4.6V20" />
      <path d="M16 5.2a3 3 0 0 1 0 5.8M17.2 14.2a4.6 4.6 0 0 1 3.3 4.4V20" />
    </svg>
  );
}

function CrownIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m3 7 4.2 4 4.8-7 4.8 7L21 7l-2 11H5L3 7Z" />
      <path d="M6 21h12" />
    </svg>
  );
}

function PlanIcon({ planName }: { planName: string }) {
  const normalized = planName.toLowerCase();

  if (normalized.includes("team")) {
    return (
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
        <TeamIcon />
      </span>
    );
  }

  if (normalized.includes("pro")) {
    return (
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
        <CrownIcon />
      </span>
    );
  }

  return (
    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
      <RocketIcon />
    </span>
  );
}

export function BuySubscriptionView() {
  const searchParams = useSearchParams();
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);
  const cycleLabel = (label: string, months: number) => {
    if (!isKhmer) return label;
    if (months === 1) return "1 ខែ";
    if (months === 12) return "1 ឆ្នាំ";
    return `${months} ខែ`;
  };
  const planDescription = (planId: string, fallback: string) => {
    if (!isKhmer) return fallback;
    if (planId === "standard") {
      return "សម្រាប់អ្នកលក់ឯករាជ្យ និងហាងតូចៗដែលទើបចាប់ផ្តើមប្រើ TENH។";
    }
    if (planId === "team") {
      return "សម្រាប់ក្រុមតូចៗដែលគ្រប់គ្រង Page, Bot និងភ្នាក់ងារច្រើន។";
    }
    if (planId === "pro") {
      return "សម្រាប់ក្រុមគាំទ្រដែលកំពុងរីកចម្រើន និងត្រូវការឆានែល និងភ្នាក់ងារច្រើន។";
    }
    return fallback;
  };

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
            t("Unable to create subscription.", "មិនអាចបង្កើតការជាវបានទេ។"),
        );
      }

      window.location.assign(result.paymentUrl);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t("Unable to create subscription.", "មិនអាចបង្កើតការជាវបានទេ។"),
      );
      setWorkingPlan(null);
    }
  }

  return (
    <div className="h-full min-h-0 w-full overflow-y-auto overscroll-y-contain bg-gradient-to-b from-slate-50/70 via-white to-white">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-5 pb-9 sm:px-5 lg:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-blue-600">
              {t("Buy subscription", "ទិញការជាវ")}
            </p>

            <h1 className="mt-2 text-[23px] font-extrabold tracking-[-0.03em] text-slate-950 sm:text-[32px]">
              {t("Choose a TENH subscription", "ជ្រើសរើសការជាវ TENH")}
            </h1>

            <p className="mt-1.5 max-w-2xl text-xs leading-5 text-slate-500 sm:text-sm">
              {t(
                "Choose Standard, Team, or Pro. If you need different connection and user limits, build a Custom Subscription.",
                "ជ្រើស Standard, Team ឬ Pro។ ប្រសិនបើអ្នកត្រូវការចំនួនការតភ្ជាប់ និងអ្នកប្រើប្រាស់ខុសពីនេះ សូមបង្កើត Custom Subscription។",
              )}
            </p>
          </div>

          <Link
            href="/dashboard/subscription"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <ArrowLeftIcon />
            {t("Back to Subscription", "ត្រឡប់ទៅការជាវ")}
          </Link>
        </div>

        <section className="mt-5 rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-4">
          <div>
            <p className="text-sm font-extrabold text-slate-950">
              {t("Billing duration", "រយៈពេលការជាវ")}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {t(
                "Longer prepaid periods receive the TENH duration discount.",
                "ការបង់ជាមុនសម្រាប់រយៈពេលវែងជាង នឹងទទួលបានការបញ្ចុះតម្លៃតាមរយៈពេលពី TENH។",
              )}
            </p>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {TENH_BILLING_CYCLES.map((item) => {
              const active = cycle === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCycle(item.id)}
                  className={`relative min-h-[70px] rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-blue-700 bg-blue-600 text-white shadow-[0_10px_25px_rgba(37,99,235,0.22)]"
                      : "border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:bg-blue-50/30"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        active
                          ? "border-white/20 bg-white text-blue-600"
                          : "border-slate-300 bg-white text-transparent"
                      }`}
                    >
                      <CheckIcon />
                    </span>

                    <div>
                      <span
                        className={`block text-sm font-extrabold ${
                          active ? "text-white" : "text-slate-900"
                        }`}
                      >
                        {cycleLabel(item.label, item.months)}
                      </span>
                      <span
                        className={`mt-0.5 block text-xs font-semibold ${
                          active ? "text-blue-100" : "text-blue-600"
                        }`}
                      >
                        {item.discount > 0
                          ? isKhmer
                            ? `សន្សំ ${Math.round(item.discount * 100)}%`
                            : `Save ${Math.round(item.discount * 100)}%`
                          : t("Standard price", "តម្លៃស្តង់ដារ")}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {TENH_PLANS.map((plan) => {
            const totalCents =
              calculatePlanTotalCents(plan.id, cycle) ?? plan.monthlyCents;
            const effectiveMonthlyCents =
              selectedCycle.months > 0
                ? Math.round(totalCents / selectedCycle.months)
                : plan.monthlyCents;
            const working = workingPlan === plan.id;
            const popular = plan.name === "Team";

            return (
              <section
                key={plan.id}
                className={`relative flex min-h-[350px] flex-col overflow-hidden rounded-[22px] border bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition ${
                  popular
                    ? "border-blue-500 ring-1 ring-blue-100"
                    : "border-slate-200"
                }`}
              >
                {popular ? (
                  <span className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white shadow-sm">
                    <StarIcon />
                    {t("Popular", "ពេញនិយម")}
                  </span>
                ) : null}

                <PlanIcon planName={plan.name} />

                <div className="mt-3">
                  <h2 className="text-[23px] font-extrabold tracking-[-0.025em] text-slate-950">
                    {plan.name}
                  </h2>

                  <p className="mt-1.5 min-h-[44px] text-xs leading-5 text-slate-500">
                    {planDescription(plan.id, plan.description)}
                  </p>
                </div>

                <div className="mt-4 rounded-xl bg-gradient-to-br from-slate-50 to-blue-50/50 p-4">
                  <div className="flex items-end gap-1.5">
                    <span className="text-[31px] font-extrabold tracking-[-0.03em] text-slate-950">
                      {formatUsdFromCents(effectiveMonthlyCents)}
                    </span>
                    <span className="pb-1 text-xs font-medium text-slate-500">
                      {t("/mo", "/ខែ")}
                    </span>
                  </div>

                  <p className="mt-1.5 text-xs font-semibold text-slate-700">
                    {isKhmer
                      ? `${plan.channels} ការតភ្ជាប់ · ${plan.users} អ្នកប្រើប្រាស់`
                      : `${plan.channels} connections · ${plan.users} user${plan.users === 1 ? "" : "s"}`}
                  </p>
                  {selectedCycle.discount > 0 ? (
                    <p className="mt-1 text-[10px] font-semibold text-blue-600">
                      {isKhmer
                        ? `តម្លៃសមមូលប្រចាំខែបន្ទាប់ពីបញ្ចុះ · សន្សំ ${Math.round(selectedCycle.discount * 100)}%`
                        : `Discounted monthly equivalent · save ${Math.round(selectedCycle.discount * 100)}%`}
                    </p>
                  ) : null}
                </div>

                <div className="mt-4 flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    {cycleLabel(selectedCycle.label, selectedCycle.months)} {t("total", "សរុប")}
                  </span>
                  <span className="font-extrabold text-slate-950">
                    {formatUsdFromCents(totalCents)}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={Boolean(workingPlan)}
                  onClick={() => void createFixedSubscription(plan.id)}
                  className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>
                    {working
                      ? isKhmer
                        ? `កំពុងបង្កើត ${plan.name}...`
                        : `Creating ${plan.name}...`
                      : isKhmer
                        ? `ទិញ ${plan.name}`
                        : `Buy ${plan.name}`}
                  </span>
                  {!working ? <ArrowRightIcon /> : null}
                </button>
              </section>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          className="mt-5 flex w-full items-center gap-4 overflow-hidden rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-left shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:border-blue-300 hover:bg-blue-50/30 sm:px-5"
        >
          <img
            src="/images/custom.png"
            alt={t("Custom Subscription", "ការជាវផ្ទាល់ខ្លួន")}
            className="h-20 w-32 shrink-0 object-contain sm:h-24 sm:w-36"
            draggable={false}
          />

          <div className="min-w-0 flex-1">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-600">
              {t("Build your own", "បង្កើតតាមតម្រូវការ")}
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-[-0.02em] text-slate-950">
              {t("Custom Subscription", "ការជាវផ្ទាល់ខ្លួន")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {t(
                "Create a plan that fits your needs with flexible connection and user limits.",
                "បង្កើតគម្រោងដែលសមនឹងតម្រូវការរបស់អ្នក ដោយកំណត់ចំនួនការតភ្ជាប់ និងអ្នកប្រើប្រាស់បានតាមតម្រូវការ។",
              )}
            </p>
          </div>

          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
            <ArrowRightIcon className="h-5 w-5" />
          </span>
        </button>

        {/*
          Last, under Custom. Someone who has read every plan and still has not
          picked one is exactly who needs to ask, and by then Custom has already
          been offered as the answer to "none of these fit".
        */}
        <p className="mt-4 text-center text-xs leading-5 text-slate-500">
          {t(
            "Not sure which plan fits your business?",
            "មិនច្បាស់ថាគម្រោងណាសមនឹងអាជីវកម្មរបស់អ្នក?",
          )}{" "}
          <a
            href="https://t.me/tenhchat_support_bot"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-700"
          >
            {t("Ask TENH support", "សួរផ្នែកជំនួយ TENH")}
          </a>
        </p>

        {customOpen ? (
          <div
            className="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/40 p-3 backdrop-blur-[2px] sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label={t("Create Custom Subscription", "បង្កើតការជាវផ្ទាល់ខ្លួន")}
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
                  aria-label={t("Close custom subscription", "បិទការជាវផ្ទាល់ខ្លួន")}
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
