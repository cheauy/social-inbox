"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { AgentPerformancePanel } from "@/components/analytics/agent-performance-panel";
import { CustomerInsightsPanel } from "@/components/analytics/customer-insights-panel";
import { DashboardOverviewPanel } from "@/components/analytics/dashboard-overview-panel";
import { ConversationReportsPanel } from "@/components/analytics/conversation-reports-panel";
import { SlaAnalyticsPanel } from "@/components/analytics/sla-analytics-panel";
import { AgentWorkloadPanel } from "@/components/inbox/agent-workload-panel";

type AnalyticsView =
  | "dashboard"
  | "team-performance"
  | "agent-performance"
  | "team-workload"
  | "customer-insights"
  | "conversation-reports";

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
    | "report";
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
      {
        id: "customer-insights",
        view: "customer-insights",
        label: "Customer insights",
        description:
          "Growth and customer activity",
        icon: "customer",
      },
    ],
  },
  {
    label: "Reports",
    items: [
      {
        id: "conversation-reports",
        view: "conversation-reports",
        label:
          "Conversation reports",
        description:
          "Volume, status and busy hours",
        icon: "report",
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
      "conversation-reports"
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
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function AnalyticsWorkspace() {
  const [
    activeView,
    setActiveView,
  ] =
    useState<AnalyticsView>(
      "dashboard",
    );

  useEffect(() => {
    if (
      typeof window ===
      "undefined"
    ) {
      return;
    }

    const requestedView =
      new URL(
        window.location.href,
      ).searchParams.get(
        "view",
      );

    if (
      isAnalyticsView(
        requestedView,
      )
    ) {
      setActiveView(
        requestedView,
      );
    }
  }, []);

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
    setActiveView(
      view,
    );
    updateViewInUrl(
      view,
    );
  }

  return (
    <main className="h-[calc(100vh-72px)] overflow-hidden bg-slate-50">
      <div className="grid h-full min-h-0 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 px-5 py-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
              Analytics
            </p>

            <h2 className="mt-1 text-lg font-bold text-slate-950">
              Insights & reports
            </h2>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Performance and operations in one place.
            </p>
          </div>

          <nav className="space-y-5 p-3">
            {menuSections.map(
              (section) => (
                <div
                  key={
                    section.label
                  }
                >
                  <p className="px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    {
                      section.label
                    }
                  </p>

                  <div className="mt-2 space-y-1">
                    {section.items.map(
                      (
                        item,
                      ) => {
                        const isActive =
                          item.view ===
                          activeView;
                        const isAvailable =
                          Boolean(
                            item.view,
                          );

                        return (
                          <button
                            key={
                              item.id
                            }
                            type="button"
                            onClick={() => {
                              if (
                                item.view
                              ) {
                                selectView(
                                  item.view,
                                );
                              }
                            }}
                            disabled={
                              !isAvailable
                            }
                            className={`group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition ${
                              isActive
                                ? "bg-blue-50 text-blue-700"
                                : isAvailable
                                  ? "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                                  : "cursor-default text-slate-400"
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                                isActive
                                  ? "border-blue-200 bg-white text-blue-600"
                                  : "border-slate-200 bg-white"
                              }`}
                            >
                              <AnalyticsIcon
                                icon={
                                  item.icon
                                }
                              />
                            </span>

                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="truncate text-sm font-semibold">
                                  {
                                    item.label
                                  }
                                </span>

                                {item.badge ? (
                                  <span
                                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                                      item.badge ===
                                      "Next"
                                        ? "bg-violet-100 text-violet-700"
                                        : "bg-slate-100 text-slate-500"
                                    }`}
                                  >
                                    {
                                      item.badge
                                    }
                                  </span>
                                ) : null}
                              </span>

                              <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 group-disabled:text-slate-400">
                                {
                                  item.description
                                }
                              </span>
                            </span>
                          </button>
                        );
                      },
                    )}
                  </div>
                </div>
              ),
            )}
          </nav>
        </aside>

        <section className="min-h-0 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto w-full max-w-7xl">
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

            {activeView ===
            "dashboard" ? (
              <DashboardOverviewPanel />
            ) : activeView ===
            "team-performance" ? (
              <SlaAnalyticsPanel />
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
              <section className="min-h-[650px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <AgentWorkloadPanel />
              </section>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
