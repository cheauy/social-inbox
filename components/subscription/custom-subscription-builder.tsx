"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import {
  TENH_BILLING_CYCLES,
  calculateCustomMonthlyCents,
  calculateCustomTotalCents,
  formatUsdFromCents,
  type BillingCycle,
} from "@/lib/subscription/plan-catalog";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function ConnectionIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M9 12a3 3 0 0 0 3 3h3a3 3 0 1 0 0-6h-1" />
      <path d="M15 12a3 3 0 0 0-3-3H9a3 3 0 1 0 0 6h1" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}


function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.6 2.7 8 7 10 4.3-2 7-5.4 7-10V6l-7-3Z" />
      <path d="m9.5 12 1.7 1.7 3.6-3.7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}
export function CustomSubscriptionBuilder({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);
  const cycleLabel = (label: string, months: number) => {
    if (!isKhmer) return label;
    if (months === 1) return "1 ខែ";
    if (months === 12) return "1 ឆ្នាំ";
    return `${months} ខែ`;
  };

  const [connections, setConnections] = useState(3);
  const [users, setUsers] = useState(1);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthlyCents = useMemo(
    () => calculateCustomMonthlyCents(connections, users) ?? 0,
    [connections, users],
  );

  const totalCents = useMemo(
    () => calculateCustomTotalCents(connections, users, cycle) ?? 0,
    [connections, users, cycle],
  );

  const selectedCycle =
    TENH_BILLING_CYCLES.find((item) => item.id === cycle) ??
    TENH_BILLING_CYCLES[0];

  const grossTotalCents = monthlyCents * selectedCycle.months;

  async function createSubscription() {
    setError(null);
    setWorking(true);

    try {
      const response = await fetch(
        "/api/workspaces/create-subscription",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planCode: "custom",
            connections,
            users,
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
      setWorking(false);
    }
  }

  const savingsCents = Math.max(0, grossTotalCents - totalCents);

  return (
    <section
      id={embedded ? undefined : "custom-subscription"}
      className={`${
        embedded ? "" : "mt-6 "
      }overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.10)]`}
    >
      <div className="grid gap-7 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-8">
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            <div className="relative h-20 w-28 shrink-0 sm:h-24 sm:w-32">
              <img
                src="/images/custom.png"
                alt={t("Custom Subscription", "ការជាវផ្ទាល់ខ្លួន")}
                className="h-full w-full object-contain"
                draggable={false}
              />
            </div>

            <div className="min-w-0 pt-1">
              <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-blue-600">
                {t("Build your plan", "បង្កើតគម្រោងរបស់អ្នក")}
              </p>
              <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.025em] text-slate-950 sm:text-[30px]">
                {t("Create Custom Subscription", "បង្កើតការជាវផ្ទាល់ខ្លួន")}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                {t(
                  "Design a plan that fits your business. Choose your connection capacity, team size, and billing duration to get started.",
                  "រៀបចំគម្រោងដែលសមនឹងអាជីវកម្មរបស់អ្នក។ ជ្រើសចំនួនការតភ្ជាប់ ទំហំក្រុម និងរយៈពេលការជាវ ដើម្បីចាប់ផ្តើម។",
                )}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <ConnectionIcon />
                </span>
                <div>
                  <p className="text-base font-extrabold text-slate-950">
                    {t("Connections", "ការតភ្ជាប់")}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-slate-500">
                    {t(
                      "Number of social channels you can connect.",
                      "ចំនួនឆានែលបណ្តាញសង្គមដែលអ្នកអាចតភ្ជាប់បាន។",
                    )}
                  </p>
                </div>
              </div>

              <div className="shrink-0">
                <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() =>
                      setConnections((value) =>
                        clamp(value - 1, 3, 30),
                      )
                    }
                    className="flex h-12 w-12 items-center justify-center rounded-l-xl border-r border-slate-200 text-xl font-bold text-slate-500 transition hover:bg-slate-50"
                    aria-label={t("Decrease connections", "បន្ថយការតភ្ជាប់")}
                  >
                    −
                  </button>

                  <input
                    type="number"
                    min={3}
                    max={30}
                    value={connections}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setConnections(
                        clamp(Number(event.target.value) || 3, 3, 30),
                      )
                    }
                    className="h-12 w-20 border-0 bg-white text-center text-xl font-extrabold text-slate-950 outline-none"
                    aria-label={t("Connections", "ការតភ្ជាប់")}
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setConnections((value) =>
                        clamp(value + 1, 3, 30),
                      )
                    }
                    className="flex h-12 w-12 items-center justify-center rounded-r-xl border-l border-blue-200 text-xl font-bold text-blue-600 transition hover:bg-blue-50"
                    aria-label={t("Increase connections", "បន្ថែមការតភ្ជាប់")}
                  >
                    +
                  </button>
                </div>
                <p className="mt-2 text-center text-xs font-medium text-slate-500">
                  {t("Min 3 · Max 30", "អប្បបរមា 3 · អតិបរមា 30")}
                </p>
              </div>
            </div>

            <div className="my-5 h-px bg-slate-200" />

            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <TeamIcon />
                </span>
                <div>
                  <p className="text-base font-extrabold text-slate-950">
                    {t("Team users", "អ្នកប្រើប្រាស់ក្នុងក្រុម")}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-slate-500">
                    {t(
                      "Number of team members and agents.",
                      "ចំនួនសមាជិកក្រុម និងភ្នាក់ងារ។",
                    )}
                  </p>
                </div>
              </div>

              <div className="shrink-0">
                <div className="flex items-center rounded-xl border border-slate-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() =>
                      setUsers((value) =>
                        clamp(value - 1, 1, 100),
                      )
                    }
                    className="flex h-12 w-12 items-center justify-center rounded-l-xl border-r border-slate-200 text-xl font-bold text-slate-500 transition hover:bg-slate-50"
                    aria-label={t("Decrease team users", "បន្ថយអ្នកប្រើប្រាស់ក្នុងក្រុម")}
                  >
                    −
                  </button>

                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={users}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setUsers(
                        clamp(Number(event.target.value) || 1, 1, 100),
                      )
                    }
                    className="h-12 w-20 border-0 bg-white text-center text-xl font-extrabold text-slate-950 outline-none"
                    aria-label={t("Team users", "អ្នកប្រើប្រាស់ក្នុងក្រុម")}
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setUsers((value) =>
                        clamp(value + 1, 1, 100),
                      )
                    }
                    className="flex h-12 w-12 items-center justify-center rounded-r-xl border-l border-blue-200 text-xl font-bold text-blue-600 transition hover:bg-blue-50"
                    aria-label={t("Increase team users", "បន្ថែមអ្នកប្រើប្រាស់ក្នុងក្រុម")}
                  >
                    +
                  </button>
                </div>
                <p className="mt-2 text-center text-xs font-medium text-slate-500">
                  {t("Min 1 · Max 100", "អប្បបរមា 1 · អតិបរមា 100")}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-lg font-extrabold text-slate-950">
              {t("Billing duration", "រយៈពេលការជាវ")}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {t(
                "Longer durations come with bigger discounts.",
                "រយៈពេលវែងជាង នឹងទទួលបានការបញ្ចុះតម្លៃកាន់តែច្រើន។",
              )}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {TENH_BILLING_CYCLES.map((item) => {
                const active = cycle === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCycle(item.id)}
                    className={`relative min-h-[108px] rounded-2xl border px-4 py-4 text-center transition ${
                      active
                        ? "border-blue-700 bg-blue-600 shadow-[0_10px_25px_rgba(37,99,235,0.22)]"
                        : "border-slate-200 bg-white hover:border-blue-300"
                    }`}
                  >
                    <span
                      className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full border ${
                        active
                          ? "border-white bg-white text-blue-600"
                          : "border-slate-300 bg-white text-transparent"
                      }`}
                    >
                      <CheckIcon />
                    </span>

                    <span
                      className={`mt-4 block text-sm font-extrabold ${
                        active ? "text-white" : "text-slate-900"
                      }`}
                    >
                      {cycleLabel(item.label, item.months)}
                    </span>

                    <span
                      className={`mt-2 block text-xs font-semibold ${
                        active
                          ? "text-white"
                          : item.discount > 0
                            ? "text-blue-600"
                            : "text-slate-500"
                      }`}
                    >
                      {item.discount > 0
                        ? isKhmer
                          ? `សន្សំ ${Math.round(item.discount * 100)}%`
                          : `Save ${Math.round(item.discount * 100)}%`
                        : t("Standard price", "តម្លៃស្តង់ដារ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-blue-600">
                <ShieldIcon />
              </span>
              <div>
                <p className="text-sm font-extrabold text-blue-700">
                  {t("One-time subscription payment", "ការទូទាត់ការជាវតែម្តង")}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {t(
                    "You pay once for the selected subscription period. Future renewals or new subscriptions require a separate payment.",
                    "អ្នកបង់ប្រាក់តែម្តងសម្រាប់រយៈពេលការជាវដែលបានជ្រើស។ ការបន្តសុពលភាព ឬការជាវថ្មីនៅពេលក្រោយ ត្រូវការការទូទាត់ដាច់ដោយឡែក។",
                  )}
                </p>
              </div>
            </div>
          </div>

          {error ? (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mt-8 flex items-center gap-2 text-xs font-medium text-slate-400">
            <LockIcon />
            <span>{t("Secure one-time payment.", "ការទូទាត់តែម្តងដែលមានសុវត្ថិភាព។")}</span>
          </div>
        </div>

        <aside className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-sm">
          <div className="bg-gradient-to-b from-blue-50 to-white px-6 pb-5 pt-6 text-center">
            <p className="text-xs font-extrabold uppercase tracking-[0.20em] text-blue-600">
              {t("Your custom plan", "គម្រោងផ្ទាល់ខ្លួនរបស់អ្នក")}
            </p>

            <div className="mx-auto mt-5 flex h-16 w-16 items-center justify-center rounded-full border border-blue-100 bg-white shadow-sm">
              <img
                src="/images/custom.png"
                alt={t("Custom Plan", "គម្រោងផ្ទាល់ខ្លួន")}
                className="h-9 w-9 object-contain"
                draggable={false}
              />
            </div>
          </div>

          <div className="p-6">
            <h3 className="text-center text-xl font-extrabold tracking-[-0.02em] text-slate-950">
              {t("Custom Plan", "គម្រោងផ្ទាល់ខ្លួន")}
            </h3>

            <div className="mt-5 space-y-1">
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <ConnectionIcon />
                  <span>{t("Connections", "ការតភ្ជាប់")}</span>
                </div>
                <strong className="text-sm text-slate-950">{connections}</strong>
              </div>

              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <TeamIcon />
                  <span>{t("Team users", "អ្នកប្រើប្រាស់ក្នុងក្រុម")}</span>
                </div>
                <strong className="text-sm text-slate-950">{users}</strong>
              </div>

              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <ClockIcon />
                  <span>{t("Duration", "រយៈពេល")}</span>
                </div>
                <strong className="text-sm text-slate-950">
                  {cycleLabel(selectedCycle.label, selectedCycle.months)}
                </strong>
              </div>
            </div>

            <div className="my-5 h-px bg-slate-200" />

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">{t("Subtotal", "សរុបរង")}</span>
                <strong className="text-slate-950">
                  {formatUsdFromCents(grossTotalCents)}
                </strong>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-500">{t("Duration discount", "ការបញ្ចុះតម្លៃតាមរយៈពេល")}</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-extrabold text-emerald-600">
                  {selectedCycle.discount > 0
                    ? `${Math.round(selectedCycle.discount * 100)}%`
                    : "0%"}
                </span>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-blue-100 bg-slate-50 p-5">
              <p className="text-sm font-medium text-slate-500">
                {t("Total due today", "សរុបត្រូវបង់ថ្ងៃនេះ")}
              </p>
              <p className="mt-1 text-3xl font-extrabold tracking-[-0.03em] text-blue-600">
                {formatUsdFromCents(totalCents)}
              </p>
              <p className="mt-1 text-xs font-bold text-emerald-600">
                {t("After discount", "បន្ទាប់ពីបញ្ចុះតម្លៃ")}
              </p>

              <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                <p className="text-sm font-semibold leading-5 text-emerald-700">
                  {isKhmer
                    ? `អ្នកសន្សំបាន ${formatUsdFromCents(savingsCents)} ជាមួយរយៈពេលនេះ។`
                    : <>You&apos;re saving {formatUsdFromCents(savingsCents)} with this duration.</>}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={working}
              onClick={() => void createSubscription()}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LockIcon />
              {working
                ? t("Creating...", "កំពុងបង្កើត...")
                : t("Continue to payment", "បន្តទៅការទូទាត់")}
            </button>

            <div className="mt-4 flex items-center justify-center gap-2 text-xs font-medium text-slate-400">
              <ShieldIcon />
              <span>{t("Secure checkout – Cancel anytime", "ការទូទាត់មានសុវត្ថិភាព – អាចបោះបង់បានគ្រប់ពេល")}</span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
