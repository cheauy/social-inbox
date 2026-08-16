"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type CustomerReportRow = {
  id: string;
  businessId: string;
  businessName: string;
  reporterMemberId: string | null;
  reporterName: string | null;
  reporterEmail: string | null;
  category: string;
  subject: string;
  message: string;
  status: "open" | "reviewing" | "resolved";
  adminReply: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  attachmentFileName: string | null;
  attachmentMimeType: string | null;
  attachmentSizeBytes: number | null;
  attachmentUrl: string | null;
  createdAt: string;
};

type CustomerReportReviewProps = {
  onQueueChanged?: () => void | Promise<void>;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatFileSize(value: number | null) {
  if (!value || value <= 0) return "";
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function statusClass(status: CustomerReportRow["status"]) {
  if (status === "resolved") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (status === "reviewing") {
    return "bg-blue-100 text-blue-700";
  }

  return "bg-amber-100 text-amber-700";
}

function statusLabel(status: CustomerReportRow["status"]) {
  if (status === "reviewing") return "Under review";
  if (status === "resolved") return "Resolved";
  return "Open";
}

export function CustomerReportReview({
  onQueueChanged,
}: CustomerReportReviewProps) {
  const [rows, setRows] = useState<CustomerReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] =
    useState<"all" | "open" | "reviewing" | "resolved">("open");
  const [replyById, setReplyById] = useState<Record<string, string>>({});

  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch(
        "/api/tenh-admin/customer-reports",
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        reports?: CustomerReportRow[];
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to load customer reports.",
        );
      }

      const reports = result.reports ?? [];
      setRows(reports);
      setReplyById((current) => {
        const next = { ...current };
        for (const report of reports) {
          if (next[report.id] === undefined) {
            next[report.id] = report.adminReply ?? "";
          }
        }
        return next;
      });
    } catch (loadError) {
      if (!quiet) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load customer reports.",
        );
      }
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();

    const timer = window.setInterval(() => {
      void load(true);
    }, 20_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [load]);

  const counts = useMemo(
    () => ({
      open: rows.filter((row) => row.status === "open").length,
      reviewing: rows.filter((row) => row.status === "reviewing").length,
      resolved: rows.filter((row) => row.status === "resolved").length,
      all: rows.length,
    }),
    [rows],
  );

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((row) => row.status === statusFilter);
  }, [rows, statusFilter]);

  async function updateReport(
    row: CustomerReportRow,
    status: CustomerReportRow["status"],
  ) {
    setBusyId(row.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(
        "/api/tenh-admin/customer-reports",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            reportId: row.id,
            status,
            adminReply: replyById[row.id]?.trim() ?? "",
          }),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        unchanged?: boolean;
        customerNotificationCreated?: boolean;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to update the customer report.",
        );
      }

      setNotice(
        result.unchanged
          ? "No changes to save."
          : result.customerNotificationCreated
            ? "Report updated. The customer was notified in the TENH bell."
            : "Report updated.",
      );

      await load();
      await onQueueChanged?.();
      window.dispatchEvent(
        new Event("tenh-admin-summary-changed"),
      );
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update the customer report.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            ["open", "reviewing", "resolved", "all"] as const
          ).map((status) => {
            const count = counts[status];
            const active = statusFilter === status;

            return (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span>
                  {status === "all"
                    ? "All"
                    : status === "reviewing"
                      ? "Under review"
                      : status.charAt(0).toUpperCase() + status.slice(1)}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                    active
                      ? "bg-white/15 text-white"
                      : count > 0 &&
                          (status === "open" || status === "reviewing")
                        ? "bg-red-100 text-red-700"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading customer reports…
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No customer reports in this view.
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredRows.map((row) => (
            <article
              key={row.id}
              className={`overflow-hidden rounded-[24px] border bg-white shadow-sm ${
                row.status === "open"
                  ? "border-amber-200"
                  : "border-slate-200"
              }`}
            >
              <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${statusClass(row.status)}`}
                      >
                        {statusLabel(row.status)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-500">
                        {row.category}
                      </span>
                    </div>
                    <h3 className="mt-2 text-lg font-bold text-slate-950">
                      {row.subject}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400">
                      {row.businessName} · {formatDate(row.createdAt)}
                    </p>
                  </div>

                  {row.status === "open" ? (
                    <span className="rounded-full bg-red-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white">
                      Needs attention
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-5 p-5 sm:p-6 xl:flex-row">
                <div className="min-w-0 flex-1">
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-400">
                        Customer
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {row.reporterName ?? "TENH user"}
                      </p>
                      <p className="mt-0.5 break-all text-xs text-slate-500">
                        {row.reporterEmail ?? "Email unavailable"}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-xs font-semibold text-slate-400">
                        Workspace
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {row.businessName}
                      </p>
                      <p className="mt-0.5 break-all text-xs text-slate-500">
                        {row.businessId}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-400">
                      Customer message
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {row.message}
                    </p>
                  </div>

                  {row.attachmentFileName ? (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {row.attachmentFileName}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          Customer attachment
                          {row.attachmentSizeBytes
                            ? ` · ${formatFileSize(row.attachmentSizeBytes)}`
                            : ""}
                        </p>
                      </div>
                      {row.attachmentUrl ? (
                        <a
                          href={row.attachmentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                        >
                          View attachment
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  <dl className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                    <div>
                      <dt className="font-semibold text-slate-900">
                        Last reviewed
                      </dt>
                      <dd className="mt-0.5">
                        {formatDate(row.reviewedAt)}
                        {row.reviewedByEmail
                          ? ` · ${row.reviewedByEmail}`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-900">
                        Report ID
                      </dt>
                      <dd className="mt-0.5 break-all">{row.id}</dd>
                    </div>
                  </dl>
                </div>

                <div className="w-full shrink-0 xl:max-w-sm">
                  <label className="block text-sm font-semibold text-slate-800">
                    Reply to customer
                    <textarea
                      rows={6}
                      maxLength={2000}
                      value={replyById[row.id] ?? ""}
                      onChange={(event) =>
                        setReplyById((current) => ({
                          ...current,
                          [row.id]: event.target.value,
                        }))
                      }
                      placeholder="Write a support reply. When saved, the customer receives a bell notification."
                      className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>

                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void updateReport(row, row.status)}
                    className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Save / send reply
                  </button>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    {row.status !== "reviewing" ? (
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() =>
                          void updateReport(row, "reviewing")
                        }
                        className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                      >
                        Mark under review
                      </button>
                    ) : null}

                    {row.status !== "resolved" ? (
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() =>
                          void updateReport(row, "resolved")
                        }
                        className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busyId === row.id ? "Saving…" : "Resolve report"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void updateReport(row, "open")}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
