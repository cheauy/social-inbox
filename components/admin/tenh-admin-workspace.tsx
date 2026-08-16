"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { AdminBillingAnalytics } from "@/components/admin/admin-billing-analytics";
import { AdminBillingManagement } from "@/components/admin/admin-billing-management";
import { AdminSecurityPanel } from "@/components/admin/admin-security-panel";
import { CustomerReportReview } from "@/components/admin/customer-report-review";
import { SystemAnnouncementAdmin } from "@/components/admin/system-announcement-admin";
import { ManualPaymentAdmin } from "@/components/billing/manual-payment-admin";

type AdminTab =
  | "overview"
  | "billing"
  | "manual-payments"
  | "customer-reports"
  | "announcements"
  | "security";

type TenhAdminWorkspaceProps = {
  adminEmail: string;
  initialTab: AdminTab;
  adminMfaRequired: boolean;
};

type AdminSummary = {
  manualSubmitted: number;
  manualApproved: number;
  manualRejected: number;
  reportsOpen: number;
  reportsReviewing: number;
  reportsResolved: number;
  reportActionable: number;
  activeAnnouncements: number;
  actionable: number;
};

const EMPTY_SUMMARY: AdminSummary = {
  manualSubmitted: 0,
  manualApproved: 0,
  manualRejected: 0,
  reportsOpen: 0,
  reportsReviewing: 0,
  reportsResolved: 0,
  reportActionable: 0,
  activeAnnouncements: 0,
  actionable: 0,
};

const tabs: Array<{
  id: AdminTab;
  label: string;
  description: string;
}> = [
  {
    id: "overview",
    label: "Overview",
    description: "Revenue, subscriptions, and admin queues",
  },
  {
    id: "billing",
    label: "Billing management",
    description: "Search workspace billing details and history",
  },
  {
    id: "manual-payments",
    label: "Manual payment review",
    description: "Approve or reject transfer receipts",
  },
  {
    id: "customer-reports",
    label: "Customer reports",
    description: "Review messages reported to TENH",
  },
  {
    id: "announcements",
    label: "User update alerts",
    description: "Notify users about TENH updates",
  },
  {
    id: "security",
    label: "Security",
    description: "Admin identity and two-factor authentication",
  },
];

function tabBadge(
  tab: AdminTab,
  summary: AdminSummary,
) {
  if (tab === "overview") return summary.actionable;
  if (tab === "billing") return 0;
  if (tab === "manual-payments") return summary.manualSubmitted;
  if (tab === "customer-reports") return summary.reportActionable;
  if (tab === "announcements") return summary.activeAnnouncements;
  return 0;
}

export function TenhAdminWorkspace({
  adminEmail,
  initialTab,
  adminMfaRequired,
}: TenhAdminWorkspaceProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [summary, setSummary] = useState<AdminSummary>(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadSummary = useCallback(async (quiet = false) => {
    if (!quiet) {
      setSummaryLoading(true);
    }
    setSummaryError(null);

    try {
      const response = await fetch("/api/tenh-admin/summary", {
        cache: "no-store",
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        summary?: Partial<AdminSummary>;
      };

      if (!response.ok || !result.success || !result.summary) {
        throw new Error(
          result.error ?? "Unable to load TENH admin summary.",
        );
      }

      setSummary({
        ...EMPTY_SUMMARY,
        ...result.summary,
      });
    } catch (error) {
      if (!quiet) {
        setSummaryError(
          error instanceof Error
            ? error.message
            : "Unable to load TENH admin summary.",
        );
      }
    } finally {
      if (!quiet) {
        setSummaryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadSummary();

    const timer = window.setInterval(() => {
      void loadSummary(true);
    }, 15_000);

    function handleSummaryChanged() {
      void loadSummary(true);
    }

    window.addEventListener(
      "tenh-admin-summary-changed",
      handleSummaryChanged,
    );

    return () => {
      window.clearInterval(timer);
      window.removeEventListener(
        "tenh-admin-summary-changed",
        handleSummaryChanged,
      );
    };
  }, [loadSummary]);

  const currentTab = useMemo(
    () => tabs.find((item) => item.id === activeTab) ?? tabs[0],
    [activeTab],
  );

  function chooseTab(tab: AdminTab) {
    setActiveTab(tab);
    router.replace(
      `/dashboard/admin?tab=${encodeURIComponent(tab)}`,
      { scroll: false },
    );
  }

  return (
    <div className="min-h-full bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
                TENH Admin
              </p>
              {summary.actionable > 0 ? (
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                  {summary.actionable > 99 ? "99+" : summary.actionable} needs attention
                </span>
              ) : null}
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
              Administration center
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Monitor revenue and subscription health, then review billing, manual payments, customer reports, and user update alerts from one protected workspace.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Signed in as
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              {adminEmail}
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-[24px] border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-4">
            <p className="px-3 pb-2 pt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              Admin menu
            </p>

            <div className="space-y-1.5">
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                const badge = tabBadge(tab.id, summary);

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => chooseTab(tab.id)}
                    className={`w-full rounded-2xl px-3.5 py-3 text-left transition ${
                      active
                        ? "bg-slate-950 text-white shadow-sm"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold">{tab.label}</p>
                      {badge > 0 ? (
                        <span
                          className={`flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-black ${
                            active
                              ? "bg-red-500 text-white"
                              : tab.id === "announcements"
                                ? "bg-violet-100 text-violet-700"
                                : "bg-red-100 text-red-700"
                          }`}
                        >
                          {badge > 99 ? "99+" : badge}
                        </span>
                      ) : null}
                    </div>
                    <p
                      className={`mt-1 text-xs leading-4 ${
                        active ? "text-slate-300" : "text-slate-400"
                      }`}
                    >
                      {tab.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-w-0">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                    {currentTab.label}
                  </p>
                  {tabBadge(activeTab, summary) > 0 ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700">
                      {tabBadge(activeTab, summary)}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {currentTab.description}
                </p>
              </div>
            </div>

            {activeTab === "overview" ? (
              <div className="space-y-5">
                <AdminBillingAnalytics />

                {summaryError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {summaryError}
                  </div>
                ) : null}

                <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                        Admin attention
                      </p>
                      <h2 className="mt-1 text-lg font-bold text-slate-950">
                        Operations queue
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Only actionable admin counts are kept here. Historical billing and report totals stay in their dedicated tabs.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSummary()}
                      disabled={summaryLoading}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {summaryLoading ? "Refreshing..." : "Refresh queues"}
                    </button>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => chooseTab("manual-payments")}
                      className="relative rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left transition hover:bg-amber-100"
                    >
                      {summary.manualSubmitted > 0 ? (
                        <span className="absolute right-3 top-3 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                          {summary.manualSubmitted}
                        </span>
                      ) : null}
                      <p className="pr-8 text-sm font-bold text-amber-950">
                        Manual payments waiting
                      </p>
                      <p className="mt-2 text-3xl font-black text-amber-950">
                        {summary.manualSubmitted}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-amber-800/70">
                        Submitted transfer proofs waiting for approval or rejection
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => chooseTab("customer-reports")}
                      className="relative rounded-2xl border border-blue-200 bg-blue-50 p-4 text-left transition hover:bg-blue-100"
                    >
                      {summary.reportActionable > 0 ? (
                        <span className="absolute right-3 top-3 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                          {summary.reportActionable}
                        </span>
                      ) : null}
                      <p className="pr-8 text-sm font-bold text-blue-950">
                        Customer reports needing attention
                      </p>
                      <p className="mt-2 text-3xl font-black text-blue-950">
                        {summary.reportActionable}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-blue-800/70">
                        {summary.reportsOpen} open · {summary.reportsReviewing} under review
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => chooseTab("announcements")}
                      className="relative rounded-2xl border border-violet-200 bg-violet-50 p-4 text-left transition hover:bg-violet-100"
                    >
                      {summary.activeAnnouncements > 0 ? (
                        <span className="absolute right-3 top-3 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-black text-white">
                          {summary.activeAnnouncements}
                        </span>
                      ) : null}
                      <p className="pr-8 text-sm font-bold text-violet-950">
                        Active user update alerts
                      </p>
                      <p className="mt-2 text-3xl font-black text-violet-950">
                        {summary.activeAnnouncements}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-violet-800/70">
                        TENH announcements currently visible to users
                      </p>
                    </button>
                  </div>
                </section>

                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => chooseTab("billing")}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                  >
                    <p className="font-bold text-slate-950">Billing management</p>
                    <p className="mt-1 text-sm text-slate-500">Search workspace subscriptions, receipts, transactions, and lifecycle history.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseTab("manual-payments")}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-amber-200 hover:bg-amber-50"
                  >
                    <p className="font-bold text-slate-950">Manual payment review</p>
                    <p className="mt-1 text-sm text-slate-500">Approve or reject submitted bank-transfer payment proofs.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseTab("customer-reports")}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                  >
                    <p className="font-bold text-slate-950">Customer reports</p>
                    <p className="mt-1 text-sm text-slate-500">Review customer-reported conversations and support issues.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => chooseTab("security")}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <p className="font-bold text-slate-950">Admin security</p>
                    <p className="mt-1 text-sm text-slate-500">Review protected admin identity and MFA requirements.</p>
                  </button>
                </section>
              </div>
            ) : activeTab === "billing" ? (
              <AdminBillingManagement />
            ) : activeTab === "manual-payments" ? (
              <ManualPaymentAdmin onQueueChanged={loadSummary} />
            ) : activeTab === "customer-reports" ? (
              <CustomerReportReview onQueueChanged={loadSummary} />
            ) : activeTab === "announcements" ? (
              <SystemAnnouncementAdmin />
            ) : (
              <AdminSecurityPanel
                adminMfaRequired={adminMfaRequired}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
