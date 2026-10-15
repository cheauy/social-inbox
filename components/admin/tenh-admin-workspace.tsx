"use client";
import { UsageMonitor } from "@/components/admin/usage-monitor";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Activity, BarChart3, Bell, Building2, Code2, CreditCard, Flag, Home, Menu, Plug, Shield, X, type LucideIcon } from "lucide-react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { AdminBillingAnalytics } from "@/components/admin/admin-billing-analytics";
import { AdminBillingManagement } from "@/components/admin/admin-billing-management";
import { AdminChannelHealth } from "@/components/admin/admin-channel-health";
import { AdminConnections } from "@/components/admin/admin-connections";
import { AdminSecurityCenter } from "@/components/admin/admin-security-center";
import { AdminWebhookEvents } from "@/components/admin/admin-webhook-events";
import { CustomerReportReview } from "@/components/admin/customer-report-review";
import { SystemAnnouncementAdmin } from "@/components/admin/system-announcement-admin";
import { ManualPaymentAdmin } from "@/components/billing/manual-payment-admin";

type AdminTab =
  | "usage"
  | "overview"
  | "billing"
  | "manual-payments"
  | "customer-reports"
  | "announcements"
  | "channel-health"
  | "connections"
  | "webhook-events"
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

type AdminNavigationItem = {
  id: AdminTab;
  label: string;
  kmLabel: string;
  pageLabel?: string;
  description: string;
  icon: LucideIcon;
};

export const adminNavigationGroups: Array<{
  label: string;
  kmLabel: string;
  items: AdminNavigationItem[];
}> = [
  { label: "GENERAL", kmLabel: "ទូទៅ", items: [
    { id: "overview", label: "Overview", kmLabel: "ទិដ្ឋភាពទូទៅ", description: "Revenue, subscriptions, and admin queues", icon: Home },
    { id: "billing", label: "Workspaces", kmLabel: "កន្លែងធ្វើការ", description: "Any customer's plan, payments, channels, and activity", icon: Building2 },
    { id: "usage", label: "Usage", kmLabel: "ការប្រើប្រាស់", description: "Workspace traffic and safeguards", icon: BarChart3 },
  ] },
  { label: "BILLING & SUPPORT", kmLabel: "ការទូទាត់ និងជំនួយ", items: [
    { id: "manual-payments", label: "Payment reviews", kmLabel: "ពិនិត្យការទូទាត់", pageLabel: "Manual payment review", description: "Approve or reject transfer receipts", icon: CreditCard },
    { id: "customer-reports", label: "Customer reports", kmLabel: "របាយការណ៍អតិថិជន", description: "Review messages reported to TENH", icon: Flag },
    { id: "announcements", label: "User alerts", kmLabel: "ការជូនដំណឹង", pageLabel: "User update alerts", description: "Notify users about TENH updates", icon: Bell },
  ] },
  { label: "CHANNELS", kmLabel: "ឆានែល", items: [
    { id: "connections", label: "Connections", kmLabel: "ការតភ្ជាប់", pageLabel: "Channel connections", description: "Every Page and Bot, and releasing a Bot for a new subscription", icon: Plug },
    { id: "webhook-events", label: "Webhooks", kmLabel: "Webhooks", pageLabel: "Webhook delivery", description: "Whether Meta is sending each Page anything at all", icon: Code2 },
    { id: "channel-health", label: "Diagnostics", kmLabel: "ការវិនិច្ឆ័យ", pageLabel: "Run diagnostics", description: "Messenger and Telegram health", icon: Activity },
  ] },
  { label: "SETTINGS", kmLabel: "ការកំណត់", items: [
    { id: "security", label: "Security", kmLabel: "សុវត្ថិភាព", description: "Platform security, sessions, RLS, webhooks, and audit logs", icon: Shield },
  ] },
];
const tabs = adminNavigationGroups.flatMap(group => group.items);

export function resolveAdminTab(pathname: string, tab: string | null): AdminTab {
  if (pathname === "/dashboard/admin/mfa" || pathname.startsWith("/dashboard/admin/mfa/")) return "security";
  return tabs.find(item => item.id === tab)?.id ?? "overview";
}

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

export { tabBadge as adminTabBadge };

function AdminNavigation({
  activeTab, summary, loading, isKhmer, onNavigate,
}: { activeTab: AdminTab; summary: AdminSummary; loading: boolean; isKhmer: boolean; onNavigate: (tab: AdminTab) => void }) {
  return (
    <nav data-admin-navigation aria-busy={loading} aria-label={isKhmer ? "ម៉ឺនុយអ្នកគ្រប់គ្រង" : "Admin navigation"}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
      {adminNavigationGroups.map((group, index) => (
        <section key={group.label} aria-label={isKhmer ? group.kmLabel : group.label}
          className={index ? "mt-4 border-t border-slate-100 pt-4" : ""}>
          <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase leading-4 tracking-[0.1em] text-slate-400">
            {isKhmer ? group.kmLabel : group.label}
          </h2>
          <ul className="space-y-1">
            {group.items.map(tab => {
              const active = activeTab === tab.id;
              const badge = tabBadge(tab.id, summary);
              const Icon = tab.icon;
              return (
                <li key={tab.id}>
                  <a href={`/dashboard/admin?tab=${tab.id}`} data-admin-tab={tab.id}
                    aria-current={active ? "page" : undefined}
                    onClick={event => {
                      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      onNavigate(tab.id);
                    }}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm leading-5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${active
                      ? "bg-indigo-50 font-semibold text-indigo-700 hover:bg-indigo-100"
                      : "font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-950"}`}>
                    <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="min-w-0 flex-1 break-words">{isKhmer ? tab.kmLabel : tab.label}</span>
                    {badge > 0 ? <span data-admin-badge
                      className={`flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${tab.id === "announcements" ? "bg-violet-100 text-violet-700" : "bg-rose-100 text-rose-700"}`}>
                      {badge > 99 ? "99+" : badge}
                    </span> : null}
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function AdminBrand() {
  return <div className="flex min-w-0 items-center gap-2">
    <span className="whitespace-nowrap text-sm font-bold tracking-tight text-slate-950">TENH CHAT</span>
    <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">Admin</span>
  </div>;
}

export function TenhAdminWorkspace({
  adminEmail,
  initialTab,
  adminMfaRequired,
}: TenhAdminWorkspaceProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = resolveAdminTab(pathname ?? "/dashboard/admin", searchParams ? searchParams.get("tab") : initialTab);
  const searchKey = searchParams?.toString() ?? "";
  const isKhmer = useWorkspaceLanguageId() === "km";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial summary fetch; keep the existing poll and queue-event loader.
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

  useEffect(() => { drawerRef.current?.close(); }, [pathname, searchKey]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeOnDesktop = () => { if (desktop.matches) drawerRef.current?.close(); };
    desktop.addEventListener("change", closeOnDesktop);
    const drawer = drawerRef.current;
    return () => { desktop.removeEventListener("change", closeOnDesktop); drawer?.close(); };
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    const content = contentRef.current;
    const contentOverflow = content?.style.overflowY ?? "";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (content) content.style.overflowY = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      if (content) content.style.overflowY = contentOverflow;
    };
  }, [drawerOpen]);

  function chooseTab(tab: AdminTab) {
    const url = new URL(window.location.href);
    url.pathname = "/dashboard/admin";
    url.searchParams.set("tab", tab);
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
    drawerRef.current?.close();
  }

  return (
    <div data-admin-shell className="flex h-full min-h-0 min-w-0 overflow-hidden bg-slate-50">
      <aside data-admin-sidebar className="hidden h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white xl:flex">
        <div className="flex min-h-[72px] shrink-0 items-center px-6 py-4"><AdminBrand /></div>
        <AdminNavigation activeTab={activeTab} summary={summary} loading={summaryLoading} isKhmer={isKhmer} onNavigate={chooseTab} />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 xl:hidden">
          <button ref={menuButtonRef} data-admin-menu-trigger type="button"
            aria-label={isKhmer ? "បើកម៉ឺនុយអ្នកគ្រប់គ្រង" : "Open admin menu"}
            aria-haspopup="dialog" aria-expanded={drawerOpen} aria-controls="admin-navigation-drawer"
            onClick={() => {
              drawerRef.current?.showModal();
              setDrawerOpen(true);
              closeButtonRef.current?.focus();
            }}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <AdminBrand />
        </header>
        <div ref={contentRef} data-admin-main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
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
            <p className="mt-1 break-all text-sm font-semibold text-slate-800">
              {adminEmail}
            </p>
          </div>
        </div>
            <section className="min-w-0">

            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                    {currentTab.pageLabel ?? currentTab.label}
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

            {activeTab === "usage" ? <UsageMonitor /> : activeTab === "overview" ? (
              <div className="space-y-4">
                {summaryError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {summaryError}
                  </div>
                ) : null}

                {summary.manualSubmitted > 0 ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-amber-400 bg-amber-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                      <span aria-hidden="true">⚠</span>
                      <span>
                        {summary.manualSubmitted} manual payment{summary.manualSubmitted === 1 ? "" : "s"} waiting for review
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => chooseTab("manual-payments")}
                      className="self-start rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-950 transition hover:bg-white sm:self-auto"
                    >
                      Review →
                    </button>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  {summary.reportActionable === 0 && summary.activeAnnouncements === 0 ? (
                    <span>No customer reports or user alerts open.</span>
                  ) : (
                    <>
                      {summary.reportActionable > 0 ? (
                        <button
                          type="button"
                          onClick={() => chooseTab("customer-reports")}
                          className="font-semibold text-blue-700 hover:underline"
                        >
                          {summary.reportActionable} customer report{summary.reportActionable === 1 ? "" : "s"} need attention
                        </button>
                      ) : null}
                      {summary.activeAnnouncements > 0 ? (
                        <button
                          type="button"
                          onClick={() => chooseTab("announcements")}
                          className="font-semibold text-violet-700 hover:underline"
                        >
                          {summary.activeAnnouncements} active user alert{summary.activeAnnouncements === 1 ? "" : "s"}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>

                <AdminBillingAnalytics />
              </div>
            ) : activeTab === "billing" ? (
              <AdminBillingManagement />
            ) : activeTab === "manual-payments" ? (
              <ManualPaymentAdmin onQueueChanged={loadSummary} />
            ) : activeTab === "customer-reports" ? (
              <CustomerReportReview onQueueChanged={loadSummary} />
            ) : activeTab === "announcements" ? (
              <SystemAnnouncementAdmin />
            ) : activeTab === "channel-health" ? (
              <AdminChannelHealth />
            ) : activeTab === "connections" ? (
              <AdminConnections />
            ) : activeTab === "webhook-events" ? (
              <AdminWebhookEvents />
            ) : (
              <AdminSecurityCenter
                adminMfaRequired={adminMfaRequired}
              />
            )}
            </section>
          </div>
        </div>
      </div>
      <dialog ref={drawerRef} id="admin-navigation-drawer" data-admin-drawer
        aria-modal="true" aria-label={isKhmer ? "ម៉ឺនុយអ្នកគ្រប់គ្រង" : "Admin menu"}
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
        className="fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-dvh w-72 max-w-[calc(100vw-2rem)] border-0 border-r border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/45"
        onCancel={event => { event.preventDefault(); drawerRef.current?.close(); }}
        onClose={() => {
          setDrawerOpen(false);
          if (!window.matchMedia("(min-width: 1280px)").matches) menuButtonRef.current?.focus();
        }}
        onKeyDown={event => {
          if (event.key !== "Tab") return;
          const items = event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]");
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}
        onClick={event => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) drawerRef.current?.close();
        }}>
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex min-h-[72px] shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <AdminBrand />
            <button ref={closeButtonRef} data-admin-drawer-close type="button"
              aria-label={isKhmer ? "បិទម៉ឺនុយអ្នកគ្រប់គ្រង" : "Close admin menu"}
              onClick={() => drawerRef.current?.close()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <AdminNavigation activeTab={activeTab} summary={summary} loading={summaryLoading} isKhmer={isKhmer} onNavigate={chooseTab} />
        </div>
      </dialog>
    </div>
  );
}
