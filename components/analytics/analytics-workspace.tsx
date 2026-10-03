"use client";

import { useSearchParams } from "next/navigation";

import {
  useMemo,
} from "react";

import { DashboardPanelFrame, dashboardPanelSurfaceClassName } from "@/components/dashboard/dashboard-panel-frame";
import { DashboardUtilityNavigation } from "@/components/dashboard/dashboard-utility-navigation";

import { AgentPerformancePanel } from "@/components/analytics/agent-performance-panel";
import { CustomerInsightsPanel } from "@/components/analytics/customer-insights-panel";
import { DashboardOverviewPanel } from "@/components/analytics/dashboard-overview-panel";
import { ConversationReportsPanel } from "@/components/analytics/conversation-reports-panel";
import { ChannelPerformancePanel } from "@/components/analytics/channel-performance-panel";
import { SlaAnalyticsPanel } from "@/components/analytics/sla-analytics-panel";
import { AgentWorkloadPanel } from "@/components/inbox/agent-workload-panel";

type AnalyticsView =
  | "dashboard"
  | "team-performance"
  | "agent-performance"
  | "team-workload"
  | "customer-insights"
  | "conversation-reports"
  | "channel-performance";

type MenuItem = {
  id: string;
  label: string;
  description: string;
  icon:
    | "dashboard"
    | "performance"
    | "workload"
    | "agent"
    | "customer"
    | "report"
    | "channel";
  view?: AnalyticsView;
  badge?: "Next" | "Soon";
};

const menuSections: Array<{
  label: string;
  items: MenuItem[];
}> = [
  {
    label: "Overview",
    items: [
      {
        id: "dashboard",
        view: "dashboard",
        label: "Dashboard",
        description:
          "Business health at a glance",
        icon: "dashboard",
      },
    ],
  },
  {
    label: "Performance",
    items: [
      {
        id: "team-performance",
        view: "team-performance",
        label: "Team performance",
        description:
          "SLA and response time",
        icon: "performance",
      },
      {
        id: "agent-performance",
        view: "agent-performance",
        label: "Agent performance",
        description:
          "Per-agent response results",
        icon: "agent",
      },
      {
        id: "channel-performance",
        view: "channel-performance",
        label: "Channel performance",
        description:
          "Compare Messenger, comments and Telegram",
        icon: "channel",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        id: "team-workload",
        view: "team-workload",
        label: "Team workload",
        description:
          "Queue and agent load",
        icon: "workload",
      },
    ],
  },
];

function AnalyticsIcon({
  icon,
}: {
  icon:
    MenuItem["icon"];
}) {
  if (
    icon ===
    "dashboard"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }

  if (
    icon ===
    "performance"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path
          d="M4 19V9m5 10V5m5 14v-7m5 7V3"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (
    icon ===
    "workload"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path
          d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
          strokeLinecap="round"
        />
        <circle
          cx="9"
          cy="7"
          r="4"
        />
        <path
          d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (
    icon ===
    "agent"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <circle
          cx="9"
          cy="8"
          r="3"
        />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path
          d="m16 12 2 2 3-4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (
    icon ===
    "customer"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="8"
          r="3.5"
        />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    );
  }

  if (
    icon ===
    "channel"
  ) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path
          d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"
          strokeLinejoin="round"
        />
        <path
          d="M8 9h8M8 12.5h5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M5 3h11l3 3v15H5z" />
      <path
        d="M9 10h6M9 14h6M9 18h4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function isAnalyticsView(
  value:
    | string
    | null,
): value is AnalyticsView {
  return (
    value ===
      "dashboard" ||
    value ===
      "team-performance" ||
    value ===
      "agent-performance" ||
    value ===
      "team-workload" ||
    value ===
      "customer-insights" ||
    value ===
      "conversation-reports" ||
    value ===
      "channel-performance"
  );
}

function updateViewInUrl(
  view: AnalyticsView,
) {
  if (
    typeof window ===
    "undefined"
  ) {
    return;
  }

  const url =
    new URL(
      window.location.href,
    );

  url.searchParams.set(
    "view",
    view,
  );

  window.history.replaceState(
    // Passing Next's __NA-marked state skips its URL synchronization wrapper.
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function AnalyticsWorkspace() {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const activeView: AnalyticsView = isAnalyticsView(requestedView) ? requestedView : "dashboard";

  const pageCopy =
    useMemo(() => {
      if (
        activeView ===
        "dashboard"
      ) {
        return {
          eyebrow:
            "Analytics",
          title:
            "Dashboard",
          description:
            "See customer activity, conversation pressure, team response, workload, and urgent items in one place.",
        };
      }

      if (
        activeView ===
        "team-workload"
      ) {
        return {
          eyebrow:
            "Operations",
          title:
            "Team workload",
          description:
            "Monitor active conversations, unread pressure, unassigned work, and overdue follow-ups.",
        };
      }

      if (
        activeView ===
        "customer-insights"
      ) {
        return {
          eyebrow:
            "Customers",
          title:
            "Customer insights",
          description:
            "Understand customer growth, repeat activity, engagement, tags, and channel usage.",
        };
      }

      if (
        activeView ===
        "conversation-reports"
      ) {
        return {
          eyebrow:
            "Reports",
          title:
            "Conversation reports",
          description:
            "Understand conversation volume, resolution, channel mix, busy hours, and customers still waiting.",
        };
      }

      if (
        activeView ===
        "channel-performance"
      ) {
        return {
          eyebrow:
            "Performance",
          title:
            "Channel performance",
          description:
            "Compare conversation volume, response speed, SLA performance, and customer activity by channel.",
        };
      }

      if (
        activeView ===
        "agent-performance"
      ) {
        return {
          eyebrow:
            "Performance",
          title:
            "Agent performance",
          description:
            "Compare verified per-agent reply volume, first-response speed, SLA performance, and resolution actions.",
        };
      }

      return {
        eyebrow:
          "Performance",
        title:
          "Team performance",
        description:
          "Monitor customer response speed, SLA health, and service performance.",
      };
    }, [activeView]);

  function selectView(
    view:
      AnalyticsView,
  ) {
    updateViewInUrl(
      view,
    );
  }

  return (
    <DashboardPanelFrame><main data-analytics-workspace className={dashboardPanelSurfaceClassName}>
      <div className="flex h-full min-h-0">
        <aside data-dashboard-context-menu="analytics" data-analytics-icon-rail aria-label="Analytics sections" className="relative z-30 flex h-full w-15 shrink-0 flex-col overflow-visible border-r border-slate-200/70 bg-slate-50 py-3">
          <h2 className="sr-only">Analytics — Insights &amp; reports</h2>
          <nav aria-label="Analytics reports" className="space-y-3 px-2">
            {menuSections.map((section,index) => <div key={section.label} role="group" aria-label={section.label} className={index ? "space-y-1 border-t border-slate-200 pt-3" : "space-y-1"}>
              {section.items.map(item => <button key={item.id} type="button" title={item.label} aria-label={item.label}
                aria-current={item.view===activeView?"page":undefined} disabled={!item.view}
                onClick={()=>{if(item.view)selectView(item.view)}}
                className={`group relative flex h-10 w-10 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${item.view===activeView?"bg-blue-50 text-blue-600 after:pointer-events-none after:absolute after:-left-2 after:top-1/2 after:h-6 after:w-[3px] after:-translate-y-1/2 after:rounded-full after:bg-blue-600":"text-slate-500 hover:bg-slate-100 hover:text-slate-800"}`}>
                <AnalyticsIcon icon={item.icon}/>
                <span className="pointer-events-none absolute left-full z-[150] ml-2 hidden whitespace-nowrap rounded-lg bg-slate-950 px-2 py-1 text-xs text-white group-hover:block group-focus-visible:block">{item.label}</span>
              </button>)}
            </div>)}
          </nav>
          <DashboardUtilityNavigation placement="analytics"/>
        </aside>

        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto">

          <div className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)]">
            {activeView !== "dashboard" &&
            activeView !== "team-workload" ? (
              <div className="mb-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
                  {
                    pageCopy.eyebrow
                  }
                </p>

                <h1 className="mt-1 text-2xl font-bold text-slate-950">
                  {
                    pageCopy.title
                  }
                </h1>

                <p className="mt-1 text-sm text-slate-500">
                  {
                    pageCopy.description
                  }
                </p>
              </div>
            ) : null}

            {activeView ===
            "dashboard" ? (
              <DashboardOverviewPanel
                onOpenChannelPerformance={() => selectView("channel-performance")}
              />
            ) : activeView ===
            "team-performance" ? (
              <SlaAnalyticsPanel />
            ) : activeView ===
              "channel-performance" ? (
              <ChannelPerformancePanel />
            ) : activeView ===
              "agent-performance" ? (
              <AgentPerformancePanel />
            ) : activeView ===
              "customer-insights" ? (
              <CustomerInsightsPanel />
            ) : activeView ===
              "conversation-reports" ? (
              <ConversationReportsPanel />
            ) : (
              <AgentWorkloadPanel />
            )}
          </div>
        </section>
      </div>
    </main></DashboardPanelFrame>
  );
}
