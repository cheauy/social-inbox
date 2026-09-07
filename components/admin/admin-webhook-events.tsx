"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * What Meta has actually delivered, and to which Pages.
 *
 * The list of events is the least interesting thing here. What matters is the
 * Page that is connected, passes every health check, and has received nothing
 * -- because that failure has no error message anywhere. Its token is valid,
 * its subscription lists every required field, Meta accepted the subscribe
 * call. The only symptom is silence, so silence is what this screen is built
 * to show.
 */

type PageRow = {
  socialAccountId: string;
  pageId: string;
  pageName: string;
  workspaceName: string;
  events: number;
  failed: number;
  latest: string | null;
  silent: boolean;
};

type FailureRow = {
  reason: string;
  count: number;
  latest: string;
};

type RecentRow = {
  id: string;
  platform: string | null;
  eventType: string | null;
  status: string | null;
  error: string | null;
  pageId: string | null;
  createdAt: string;
};

type Payload = {
  success?: boolean;
  error?: string;
  hours?: number;
  scanned?: number;
  truncated?: boolean;
  totals?: {
    events: number;
    failed: number;
    withoutPage: number;
  };
  pages?: PageRow[];
  unknownPages?: Array<{
    pageId: string;
    events: number;
    failed: number;
    latest: string | null;
  }>;
  failures?: FailureRow[];
  recent?: RecentRow[];
};

const WINDOWS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 24 * 7, label: "7 days" },
];

function formatWhen(value: string | null) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  const minutes = Math.round(
    (Date.now() - date.getTime()) / 60_000,
  );

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24)
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function AdminWebhookEvents() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (windowHours: number) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/tenh-admin/webhook-events?hours=${windowHours}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as Payload;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to read webhook events.",
        );
      }

      setData(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to read webhook events.",
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void load(hours);
  }, [load, hours]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const silent = (data?.pages ?? []).filter(
    (page) => page.silent,
  );

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <p className="text-sm font-bold text-slate-950">
            Webhook delivery
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            What Meta has sent, and which connected Pages it has
            sent nothing for.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-xl border border-slate-200">
            {WINDOWS.map((window) => (
              <button
                key={window.hours}
                type="button"
                onClick={() => setHours(window.hours)}
                className={`border-r border-slate-200 px-3 py-2 text-xs font-semibold transition last:border-r-0 ${
                  hours === window.hours
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {window.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void load(hours)}
            disabled={loading}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* -------------------------------------------- silent Pages */}
      {silent.length > 0 ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-bold text-red-800">
            {silent.length} connected Page
            {silent.length === 1 ? "" : "s"} received nothing
          </p>
          <p className="mt-1 text-xs leading-5 text-red-700">
            These are connected and pass every health check, but
            Meta has delivered no events in this window. If the Page
            is normally busy, its subscription is not being honoured
            — usually because another app is the Primary Receiver
            under Meta&apos;s Handover Protocol.
          </p>

          <div className="mt-3 space-y-2">
            {silent.map((page) => (
              <div
                key={page.socialAccountId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {page.pageName}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {page.workspaceName} ·{" "}
                    <span className="font-mono">
                      {page.pageId}
                    </span>
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-bold text-red-700">
                  0 events
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------- summary */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            label: "Events received",
            value: data?.totals?.events ?? 0,
          },
          {
            label: "Failed to process",
            value: data?.totals?.failed ?? 0,
            warn: (data?.totals?.failed ?? 0) > 0,
          },
          {
            label: "Pages delivering",
            value: (data?.pages ?? []).filter(
              (page) => !page.silent,
            ).length,
          },
        ].map((tile) => (
          <div
            key={tile.label}
            className={`rounded-2xl border px-5 py-4 ${
              tile.warn
                ? "border-amber-200 bg-amber-50"
                : "border-slate-200 bg-white"
            }`}
          >
            <p
              className={`text-2xl font-bold ${
                tile.warn ? "text-amber-900" : "text-slate-950"
              }`}
            >
              {loading ? "—" : tile.value}
            </p>
            <p className="mt-1 text-[11px] font-medium text-slate-500">
              {tile.label}
            </p>
          </div>
        ))}
      </div>

      {/* --------------------------------------------- per-Page table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-bold text-slate-950">
            Connected Pages
          </h3>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Reading webhook events…
          </p>
        ) : (data?.pages ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            No Facebook Page is connected in any workspace.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-5 py-3">Page</th>
                  <th className="px-3 py-3">Workspace</th>
                  <th className="px-3 py-3">Events</th>
                  <th className="px-3 py-3">Failed</th>
                  <th className="px-5 py-3">Last event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.pages ?? []).map((page) => (
                  <tr
                    key={page.socialAccountId}
                    className={
                      page.silent ? "bg-red-50/60" : "bg-white"
                    }
                  >
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-900">
                        {page.pageName}
                      </p>
                      <p className="font-mono text-[10px] text-slate-400">
                        {page.pageId}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {page.workspaceName}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={
                          page.silent
                            ? "font-bold text-red-600"
                            : "font-semibold text-slate-700"
                        }
                      >
                        {page.events}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {page.failed > 0 ? (
                        <span className="font-bold text-amber-600">
                          {page.failed}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {formatWhen(page.latest)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* -------------------------------------------------- failures */}
      {(data?.failures ?? []).length > 0 ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-sm font-bold text-slate-950">
              Why events failed
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Grouped, because one cause usually produces many
              identical rows.
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {(data?.failures ?? []).map((failure) => (
              <div
                key={failure.reason}
                className="flex items-start justify-between gap-4 px-5 py-3"
              >
                <p className="min-w-0 break-words text-xs text-slate-700">
                  {failure.reason}
                </p>
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-800">
                  {failure.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------- unknown Pages */}
      {(data?.unknownPages ?? []).length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-slate-950">
            Events for Pages not connected here
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Meta is still delivering for these. Usually a Page
            released to another workspace, occasionally a
            subscription nobody removed.
          </p>

          <div className="mt-3 space-y-2">
            {(data?.unknownPages ?? []).map((page) => (
              <div
                key={page.pageId}
                className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-2.5"
              >
                <span className="font-mono text-xs text-slate-600">
                  {page.pageId}
                </span>
                <span className="text-xs text-slate-500">
                  {page.events} event
                  {page.events === 1 ? "" : "s"} ·{" "}
                  {formatWhen(page.latest)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {data?.truncated ? (
        <p className="px-1 text-[11px] text-slate-400">
          Showing the {data.scanned} most recent events in this
          window; older ones are not counted.
        </p>
      ) : null}
    </div>
  );
}
