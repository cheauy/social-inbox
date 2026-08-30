"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

import {
  TENH_BILLING_CYCLES,
  TENH_CUSTOM_PRICING,
  formatUsdFromCents,
} from "@/lib/subscription/plan-catalog";
import type { CustomUpgradeQuote } from "@/lib/subscription/custom-upgrade";

type Props = {
  open: boolean;
  currentConnections: number;
  currentUsers: number;
  currentBillingCycle: string | null;
  currentPeriodEnd: string | null;
  targetBusinessId?: string | null;
  onClose: () => void;
};

function formatDate(value: string | null, isKhmer = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(isKhmer ? "km-KH" : "en-US", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function ConnectionIcon({ className = "h-6 w-6" }: { className?: string }) {
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
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="m8.1 10.8 7.8-3.6M8.1 13.2l7.8 3.6" />
    </svg>
  );
}

function UsersIcon({ className = "h-6 w-6" }: { className?: string }) {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
      <circle cx="9.5" cy="7" r="4" />
      <path d="M16 4.5a4 4 0 0 1 0 7.6M21 21v-2a4 4 0 0 0-3-3.8" />
    </svg>
  );
}

function CalendarIcon({ className = "h-5 w-5" }: { className?: string }) {
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
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  );
}

function ClockIcon({ className = "h-5 w-5" }: { className?: string }) {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function SparkleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4L12 3Z" />
      <path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14ZM5 13l.7 1.8L7.5 15.5l-1.8.7L5 18l-.7-1.8-1.8-.7 1.8-.7L5 13Z" />
    </svg>
  );
}

function LockIcon({ className = "h-5 w-5" }: { className?: string }) {
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
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function changeBadge(
  before: number | string,
  after: number | string,
  isKhmer = false,
) {
  if (String(before) === String(after)) {
    return (
      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-700">
        {isKhmer ? "មិនប្រែប្រួល" : "No change"}
      </span>
    );
  }

  const beforeNumber = Number(before);
  const afterNumber = Number(after);

  if (Number.isFinite(beforeNumber) && Number.isFinite(afterNumber)) {
    const delta = afterNumber - beforeNumber;
    return (
      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
        +{delta}
      </span>
    );
  }

  return (
    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
      {isKhmer ? "បានធ្វើបច្ចុប្បន្នភាព" : "Updated"}
    </span>
  );
}

export function CustomUpgradeModal({
  open,
  currentConnections,
  currentUsers,
  currentBillingCycle,
  currentPeriodEnd,
  targetBusinessId = null,
  onClose,
}: Props) {
  const router = useRouter();
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);
  const cycleLabel = (label: string, months: number) => {
    if (!isKhmer) return label;
    if (months === 1) return "1 ខែ";
    if (months === 12) return "1 ឆ្នាំ";
    return `${months} ខែ`;
  };

  const currentCycle = useMemo(
    () =>
      TENH_BILLING_CYCLES.find(
        (item) => item.id === currentBillingCycle,
      ) ?? null,
    [currentBillingCycle],
  );

  const allowedCycles = useMemo(
    () =>
      currentCycle
        ? TENH_BILLING_CYCLES.filter(
            (item) => item.months >= currentCycle.months,
          )
        : TENH_BILLING_CYCLES,
    [currentCycle],
  );

  const [connections, setConnections] = useState(currentConnections);
  const [users, setUsers] = useState(currentUsers);
  const [cycle, setCycle] = useState(
    currentBillingCycle ?? "monthly",
  );
  const [quote, setQuote] = useState<CustomUpgradeQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeSafely = useCallback(() => {
    // Clear every transient quote value before the modal is hidden.
    // This prevents a previous subscription's price from flashing when
    // another subscription is selected and Upgrade is opened again.
    setConnections(currentConnections);
    setUsers(currentUsers);
    setCycle(currentBillingCycle ?? "monthly");
    setQuote(null);
    setError(null);
    setLoading(false);
    onClose();
  }, [currentBillingCycle, currentConnections, currentUsers, onClose]);

  useEffect(() => {
    if (!open) return;
    setConnections(currentConnections);
    setUsers(currentUsers);
    setCycle(currentBillingCycle ?? "monthly");
    setQuote(null);
    setError(null);
  }, [
    open,
    currentConnections,
    currentUsers,
    currentBillingCycle,
  ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) =>
      event.key === "Escape" && closeSafely();

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSafely, open]);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          connections: String(connections),
          users: String(users),
          cycle,
        });
        if (targetBusinessId) {
          params.set("business_id", targetBusinessId);
        }

        const response = await fetch(
          `/api/subscription/custom-upgrade/quote?${params.toString()}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const result = (await response.json()) as {
          success?: boolean;
          quote?: CustomUpgradeQuote;
          error?: string;
        };

        if (!response.ok || !result.success || !result.quote) {
          throw new Error(
            result.error ?? t("Unable to calculate this upgrade.", "មិនអាចគណនាការអាប់ក្រេដនេះបានទេ។"),
          );
        }

        setQuote(result.quote);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") {
          setQuote(null);
          setError(
            reason instanceof Error
              ? reason.message
              : t("Unable to calculate this upgrade.", "មិនអាចគណនាការអាប់ក្រេដនេះបានទេ។"),
          );
        }
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, connections, users, cycle, targetBusinessId]);

  if (!open) return null;

  const selectedCycle =
    allowedCycles.find((item) => item.id === cycle) ?? null;

  const canContinue = Boolean(
    quote && quote.totalCents > 0 && !loading,
  );

  const addedConnections = Math.max(0, connections - currentConnections);
  const addedUsers = Math.max(0, users - currentUsers);
  const extensionMonths = quote?.extensionMonths ?? 0;

  const upgradeNote = quote
    ? (() => {
        const hasConnections = addedConnections > 0;
        const hasUsers = addedUsers > 0;
        const hasDuration = extensionMonths > 0;

        if (isKhmer) {
          if (hasDuration && (hasConnections || hasUsers)) {
            const capacityParts = [
              hasConnections ? `ការតភ្ជាប់ ${addedConnections}` : null,
              hasUsers ? `អ្នកប្រើប្រាស់ក្រុម ${addedUsers} នាក់` : null,
            ].filter(Boolean);

            return `អ្នកកំពុងបន្ថែម ${capacityParts.join(" និង ")} និង ${extensionMonths} ខែ។ ការតភ្ជាប់/អ្នកប្រើប្រាស់ត្រូវគិតថ្លៃតែ ${quote.remainingDays} ថ្ងៃដែលនៅសល់ ហើយ ${extensionMonths} ខែត្រូវបានបន្ថែមបន្ទាប់ពីរយៈពេលបច្ចុប្បន្ន។`;
          }

          if (hasConnections && hasUsers) {
            return `អ្នកកំពុងបន្ថែមការតភ្ជាប់ ${addedConnections} និងអ្នកប្រើប្រាស់ក្រុម ${addedUsers} នាក់។ អ្នកបង់តែសម្រាប់ ${quote.remainingDays} ថ្ងៃដែលនៅសល់ប៉ុណ្ណោះ។`;
          }

          if (hasConnections) {
            return `អ្នកកំពុងបន្ថែមការតភ្ជាប់ ${addedConnections}។ អ្នកបង់តែសម្រាប់ ${quote.remainingDays} ថ្ងៃដែលនៅសល់ប៉ុណ្ណោះ។`;
          }

          if (hasUsers) {
            return `អ្នកកំពុងបន្ថែមអ្នកប្រើប្រាស់ក្រុម ${addedUsers} នាក់។ អ្នកបង់តែសម្រាប់ ${quote.remainingDays} ថ្ងៃដែលនៅសល់ប៉ុណ្ណោះ។`;
          }

          if (hasDuration) {
            return `រយៈពេលដែលនៅសល់មិនបាត់បង់ទេ។ អ្នកកំពុងបន្ថែម ${extensionMonths} ខែទៅការជាវបច្ចុប្បន្ន។`;
          }

          return "ការជាវបច្ចុប្បន្នរបស់អ្នកមិនមានការផ្លាស់ប្តូរទេ។";
        }

        if (hasDuration && (hasConnections || hasUsers)) {
          const capacityParts = [
            hasConnections
              ? `${addedConnections} connection${addedConnections === 1 ? "" : "s"}`
              : null,
            hasUsers
              ? `${addedUsers} team user${addedUsers === 1 ? "" : "s"}`
              : null,
          ].filter(Boolean);

          return `You're adding ${capacityParts.join(" and ")} and ${extensionMonths} month${extensionMonths === 1 ? "" : "s"}. Connections/users are charged only for the remaining ${quote.remainingDays} day${quote.remainingDays === 1 ? "" : "s"}; the extra ${extensionMonths} month${extensionMonths === 1 ? " is" : "s are"} added after your current period.`;
        }

        if (hasConnections && hasUsers) {
          return `You're adding ${addedConnections} connection${addedConnections === 1 ? "" : "s"} and ${addedUsers} team user${addedUsers === 1 ? "" : "s"}. You only pay for them for the remaining ${quote.remainingDays} day${quote.remainingDays === 1 ? "" : "s"}.`;
        }

        if (hasConnections) {
          return `You're adding ${addedConnections} connection${addedConnections === 1 ? "" : "s"}. You only pay for ${addedConnections === 1 ? "it" : "them"} for the remaining ${quote.remainingDays} day${quote.remainingDays === 1 ? "" : "s"}.`;
        }

        if (hasUsers) {
          return `You're adding ${addedUsers} team user${addedUsers === 1 ? "" : "s"}. You only pay for ${addedUsers === 1 ? "this user" : "them"} for the remaining ${quote.remainingDays} day${quote.remainingDays === 1 ? "" : "s"}.`;
        }

        if (hasDuration) {
          return `No time is lost. You're adding ${extensionMonths} month${extensionMonths === 1 ? "" : "s"} to your current subscription.`;
        }

        return "Your current subscription stays unchanged.";
      })()
    : "";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-[2px] sm:p-5"
      onMouseDown={(event) =>
        event.target === event.currentTarget && closeSafely()
      }
    >
      <div className="max-h-[94dvh] w-full max-w-[1120px] overflow-y-auto rounded-[28px] bg-white shadow-2xl">
        <div className="sticky top-0 z-20 flex items-start justify-between gap-5 border-b border-slate-100 bg-white/95 px-6 py-5 backdrop-blur sm:px-8">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-600">
              {t("Upgrade subscription", "អាប់ក្រេដការជាវ")}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.02em] text-slate-950 sm:text-[30px]">
              {t("Upgrade your current subscription", "អាប់ក្រេដការជាវបច្ចុប្បន្នរបស់អ្នក")}
            </h2>
            <p className="mt-1.5 text-sm text-slate-500 sm:text-base">
              {t(
                "Keep the same Subscription ID, channels, team, customers, messages, and history.",
                "រក្សាទុក Subscription ID ដដែល ព្រមទាំងឆានែល ក្រុម អតិថិជន សារ និងប្រវត្តិទាំងអស់។",
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={closeSafely}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
            aria-label={t("Close", "បិទ")}
          >
            ×
          </button>
        </div>

        <div className="space-y-6 p-6 sm:p-8">
          <div className="grid gap-5 md:grid-cols-2">
            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <ConnectionIcon className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-lg font-extrabold text-slate-950">
                    {t("Connections", "ការតភ្ជាប់")}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {isKhmer
                      ? `បច្ចុប្បន្ន៖ ${currentConnections} · អាចបន្ថែមបានតែប៉ុណ្ណោះ`
                      : `Current: ${currentConnections} · Can only increase`}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-center gap-8">
                <button
                  type="button"
                  disabled={connections <= currentConnections}
                  onClick={() =>
                    setConnections((value) =>
                      Math.max(currentConnections, value - 1),
                    )
                  }
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-300 text-2xl font-bold text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={t("Decrease connections", "បន្ថយការតភ្ជាប់")}
                >
                  −
                </button>

                <div className="min-w-20 text-center text-3xl font-extrabold text-slate-950">
                  {connections}
                </div>

                <button
                  type="button"
                  disabled={
                    connections >= TENH_CUSTOM_PRICING.maxConnections
                  }
                  onClick={() =>
                    setConnections((value) =>
                      Math.min(
                        TENH_CUSTOM_PRICING.maxConnections,
                        value + 1,
                      ),
                    )
                  }
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-blue-400 text-2xl font-bold text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={t("Increase connections", "បន្ថែមការតភ្ជាប់")}
                >
                  +
                </button>
              </div>

              <p className="mt-4 text-center text-sm text-slate-500">
                {t("Maximum allowed", "អតិបរមាអនុញ្ញាត")}: {TENH_CUSTOM_PRICING.maxConnections}
              </p>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                  <UsersIcon className="h-7 w-7" />
                </div>
                <div>
                  <p className="text-lg font-extrabold text-slate-950">
                    {t("Team users", "អ្នកប្រើប្រាស់ក្នុងក្រុម")}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {isKhmer
                      ? `បច្ចុប្បន្ន៖ ${currentUsers} · អាចបន្ថែមបានតែប៉ុណ្ណោះ`
                      : `Current: ${currentUsers} · Can only increase`}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-center gap-8">
                <button
                  type="button"
                  disabled={users <= currentUsers}
                  onClick={() =>
                    setUsers((value) =>
                      Math.max(currentUsers, value - 1),
                    )
                  }
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-slate-300 text-2xl font-bold text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={t("Decrease users", "បន្ថយអ្នកប្រើប្រាស់")}
                >
                  −
                </button>

                <div className="min-w-20 text-center text-3xl font-extrabold text-slate-950">
                  {users}
                </div>

                <button
                  type="button"
                  disabled={users >= TENH_CUSTOM_PRICING.maxUsers}
                  onClick={() =>
                    setUsers((value) =>
                      Math.min(
                        TENH_CUSTOM_PRICING.maxUsers,
                        value + 1,
                      ),
                    )
                  }
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-violet-400 text-2xl font-bold text-violet-600 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label={t("Increase users", "បន្ថែមអ្នកប្រើប្រាស់")}
                >
                  +
                </button>
              </div>

              <p className="mt-4 text-center text-sm text-slate-500">
                {t("Maximum allowed", "អតិបរមាអនុញ្ញាត")}: {TENH_CUSTOM_PRICING.maxUsers}
              </p>
            </section>
          </div>

          <section>
            <p className="text-lg font-extrabold text-slate-950">
              {t("Billing duration", "រយៈពេលការជាវ")}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {t(
                "You can stay on the current duration or move to a longer duration. Shorter duration is not available during upgrade.",
                "អ្នកអាចរក្សារយៈពេលបច្ចុប្បន្ន ឬប្តូរទៅរយៈពេលវែងជាង។ មិនអាចប្តូរទៅរយៈពេលខ្លីជាងបានទេពេលអាប់ក្រេដ។",
              )}
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {allowedCycles.map((item) => {
                const active = cycle === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCycle(item.id)}
                    className={`relative rounded-2xl border px-5 py-4 text-left transition ${
                      active
                        ? "border-blue-500 bg-blue-50/70 shadow-sm ring-1 ring-blue-100"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-base font-extrabold ${
                              active
                                ? "text-blue-700"
                                : "text-slate-900"
                            }`}
                          >
                            {cycleLabel(item.label, item.months)}
                          </span>

                          {item.discountBasisPoints ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                              -{item.discountBasisPoints / 100}%
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-1 text-sm text-slate-500">
                          {isKhmer
                            ? `${item.months === 12 ? 1 : item.months} ${item.months === 12 ? "ឆ្នាំ" : "ខែ"}`
                            : `${item.months} month${item.months === 1 ? "" : "s"}`}
                        </p>
                      </div>

                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                          active
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-300 bg-white text-transparent"
                        }`}
                      >
                        <CheckIcon />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-[24px] border border-blue-200 bg-blue-50/45 p-5 sm:p-6">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-600">
              {t("Upgrade summary", "សង្ខេបការអាប់ក្រេដ")}
            </p>

            <div className="mt-5 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-blue-600">
                      <ConnectionIcon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-semibold text-slate-800">
                      {t("Connections", "ការតភ្ជាប់")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-950">
                      {currentConnections} → {connections}
                    </span>
                    {changeBadge(currentConnections, connections, isKhmer)}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-violet-600">
                      <UsersIcon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-semibold text-slate-800">
                      {t("Team users", "អ្នកប្រើប្រាស់ក្នុងក្រុម")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold text-slate-950">
                      {currentUsers} → {users}
                    </span>
                    {changeBadge(currentUsers, users, isKhmer)}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-blue-600">
                      <CalendarIcon />
                    </span>
                    <span className="text-sm font-semibold text-slate-800">
                      {t("Duration", "រយៈពេល")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-right text-sm font-extrabold text-slate-950">
                      {currentCycle
                        ? cycleLabel(currentCycle.label, currentCycle.months)
                        : "—"} →{" "}
                      {selectedCycle
                        ? cycleLabel(selectedCycle.label, selectedCycle.months)
                        : cycle}
                    </span>
                    {changeBadge(
                      currentCycle
                        ? cycleLabel(currentCycle.label, currentCycle.months)
                        : "—",
                      selectedCycle
                        ? cycleLabel(selectedCycle.label, selectedCycle.months)
                        : cycle,
                      isKhmer,
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-blue-600">
                      <ClockIcon />
                    </span>
                    <span className="text-sm font-semibold text-slate-800">
                      {t("Expires on", "ផុតកំណត់នៅ")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-right text-sm font-extrabold text-slate-950">
                      {formatDate(currentPeriodEnd, isKhmer)} →{" "}
                      {formatDate(
                        quote?.newPeriodEnd ?? currentPeriodEnd,
                        isKhmer,
                      )}
                    </span>
                    {changeBadge(
                      formatDate(currentPeriodEnd, isKhmer),
                      formatDate(
                        quote?.newPeriodEnd ?? currentPeriodEnd,
                        isKhmer,
                      ),
                      isKhmer,
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t border-blue-200 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                {quote ? (
                  <>
                    <div className="space-y-3 text-sm">
                      <div className="flex items-start justify-between gap-5">
                        <span className="text-slate-600">
                          {isKhmer
                            ? `ការកែសម្រួលសមត្ថភាព · នៅសល់ ${quote.remainingDays} ថ្ងៃ`
                            : `Capacity adjustment · ${quote.remainingDays} day${quote.remainingDays === 1 ? "" : "s"} remaining`}
                        </span>
                        <b className="shrink-0 text-slate-950">
                          {formatUsdFromCents(
                            quote.capacityProrationCents,
                          )}
                        </b>
                      </div>

                      <div className="flex items-start justify-between gap-5">
                        <span className="text-slate-600">
                          {isKhmer
                            ? `ពន្យាររយៈពេល · +${quote.extensionMonths} ខែ`
                            : `Duration extension · +${quote.extensionMonths} month${quote.extensionMonths === 1 ? "" : "s"}`}
                        </span>
                        <b className="shrink-0 text-slate-950">
                          {formatUsdFromCents(
                            quote.durationExtensionCents,
                          )}
                        </b>
                      </div>
                    </div>

                    <div className="mt-5 flex items-end justify-between gap-4 border-t border-blue-200 pt-5">
                      <b className="text-xl text-slate-950">
                        {t("Total upgrade", "សរុបការអាប់ក្រេដ")}
                      </b>
                      <b className="text-3xl text-blue-600">
                        {formatUsdFromCents(quote.totalCents)}
                      </b>
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-24 items-center justify-center text-sm text-slate-500">
                    {loading
                      ? t("Calculating upgrade…", "កំពុងគណនាការអាប់ក្រេដ…")
                      : t(
                          "Adjust capacity or duration to see the upgrade total.",
                          "កែសម្រួលសមត្ថភាព ឬរយៈពេល ដើម្បីមើលសរុបតម្លៃអាប់ក្រេដ។",
                        )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {quote ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-amber-500">
                  <SparkleIcon />
                </span>
                <p className="text-sm font-semibold leading-6 text-amber-800">
                  {upgradeNote}
                </p>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {error}
            </div>
          ) : null}

          <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur sm:-mx-8 sm:-mb-8 sm:flex-row sm:justify-end sm:px-8">
            <button
              type="button"
              onClick={closeSafely}
              className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {t("Cancel", "បោះបង់")}
            </button>

            <button
              type="button"
              disabled={!canContinue}
              onClick={() => {
                const params = new URLSearchParams({
                  plan: "custom",
                  cycle,
                  connections: String(connections),
                  users: String(users),
                  upgrade: "custom",
                });
                if (targetBusinessId) {
                  // Pin checkout to the exact subscription selected by the
                  // customer instead of relying on whichever workspace cookie
                  // happens to be active after switching between subscriptions.
                  params.set("purchase_business", targetBusinessId);
                }

                router.push(
                  `/dashboard/subscription/payment?${params.toString()}`,
                );
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <LockIcon />
              {loading
                ? t("Calculating...", "កំពុងគណនា...")
                : t("Continue to payment", "បន្តទៅការទូទាត់")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
