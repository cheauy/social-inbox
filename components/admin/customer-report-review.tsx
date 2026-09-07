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
          {filteredRows.map((row) => {
            const draft = replyById[row.id] ?? "";
            const sentReply = row.adminReply?.trim() ?? "";
            const trimmedDraft = draft.trim();

            /*
             * Nothing to send when the box is empty, and nothing to send when
             * it still holds the reply that was already sent. The button used
             * to be clickable in both cases and the server answered "No
             * changes to save" -- a round trip to be told the button should
             * not have been offered.
             */
            const replyIsSendable =
              trimmedDraft.length > 0 &&
              trimmedDraft !== sentReply;

            return (
              <article
                key={row.id}
                className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm"
              >
                {/*
                  One signal, on the edge.

                  An open report carried an amber OPEN chip on the left and a
                  red NEEDS ATTENTION badge on the right saying the same thing
                  -- that badge only ever appeared when the status was open.
                  Two labels for one fact, and the louder one was the
                  redundant one. The accent bar marks the card as needing work
                  without spending a second word on it.
                */}
                {row.status === "open" ? (
                  <span
                    className="absolute inset-y-0 left-0 w-1 bg-amber-400"
                    aria-hidden="true"
                  />
                ) : null}

                <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
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

                  {/*
                    Who wrote it, from where, and when -- on one line. The two
                    boxes this replaces gave a workspace UUID the same weight
                    as the customer's name, and the email was plain text when
                    replying by mail is the obvious next move.
                  */}
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">
                      {row.reporterName ?? "TENH user"}
                    </span>

                    {row.reporterEmail ? (
                      <>
                        <span aria-hidden="true" className="text-slate-300">
                          &middot;
                        </span>
                        <a
                          href={`mailto:${row.reporterEmail}`}
                          className="break-all underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
                        >
                          {row.reporterEmail}
                        </a>
                      </>
                    ) : null}

                    <span aria-hidden="true" className="text-slate-300">
                      &middot;
                    </span>
                    <span>{row.businessName}</span>

                    <span aria-hidden="true" className="text-slate-300">
                      &middot;
                    </span>
                    <span>{formatDate(row.createdAt)}</span>
                  </p>
                </div>

                <div className="flex flex-col gap-5 p-5 sm:p-6 xl:flex-row">
                  <div className="min-w-0 flex-1">
                    {/*
                      The message is the reason the card exists, so it comes
                      first and at reading size. It used to sit third, under
                      two identity boxes, in the same small type as the
                      metadata around it.
                    */}
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-slate-800">
                      {row.message}
                    </p>

                    {row.attachmentFileName ? (
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-3">
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

                    {/*
                      Forensics, not content. The report id and review history
                      were a definition list with bold headings, which gave
                      them the standing of the customer's message; they matter
                      when something has gone wrong and are ignored otherwise.
                    */}
                    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                      <span>
                        Reviewed {formatDate(row.reviewedAt)}
                        {row.reviewedByEmail
                          ? ` by ${row.reviewedByEmail}`
                          : ""}
                      </span>

                      <span aria-hidden="true">&middot;</span>
                      <span className="break-all font-mono">
                        workspace {row.businessId}
                      </span>

                      <span aria-hidden="true">&middot;</span>
                      <span className="break-all font-mono">
                        report {row.id}
                      </span>
                    </p>
                  </div>

                  <div className="w-full shrink-0 xl:max-w-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <label
                        htmlFor={`reply-${row.id}`}
                        className="text-sm font-semibold text-slate-800"
                      >
                        Reply to customer
                      </label>

                      {/*
                        Whether this customer has already been answered was
                        nowhere on the card. The box is seeded with the stored
                        reply, so an admin reading a filled box could not tell
                        a sent answer from a draft they had started earlier.
                      */}
                      {sentReply ? (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                          Replied
                        </span>
                      ) : null}
                    </div>

                    <textarea
                      id={`reply-${row.id}`}
                      rows={6}
                      maxLength={2000}
                      value={draft}
                      onChange={(event) =>
                        setReplyById((current) => ({
                          ...current,
                          [row.id]: event.target.value,
                        }))
                      }
                      placeholder="Type your reply..."
                      className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />

                    {/*
                      This was the placeholder, which is the one place it
                      cannot do its job: it vanished the moment anyone started
                      typing, taking with it the fact that saving pings the
                      customer. maxLength was 2000 and never shown, so the
                      field simply stopped accepting keystrokes.
                    */}
                    <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-slate-400">
                      <span>
                        Saving sends the customer a bell notification.
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {draft.length}/2000
                      </span>
                    </p>

                    <button
                      type="button"
                      disabled={busyId === row.id || !replyIsSendable}
                      onClick={() => void updateReport(row, row.status)}
                      className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                    >
                      {busyId === row.id
                        ? "Sending..."
                        : sentReply
                          ? "Send updated reply"
                          : "Send reply"}
                    </button>

                    {/*
                      Resolving was a solid emerald slab, the brightest thing
                      on the card -- louder than the message and louder than
                      the reply. Closing a report is an outcome, not what an
                      admin came here to do, so both status actions are
                      outlined and sit beneath the reply they follow.
                    */}
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                      {row.status !== "reviewing" ? (
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() =>
                            void updateReport(row, "reviewing")
                          }
                          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
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
                          className="rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          {busyId === row.id ? "Saving..." : "Resolve report"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void updateReport(row, "open")}
                          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Reopen
                        </button>
                      )}
                    </div>

                    {/*
                      Closing a report nobody answered leaves the customer
                      with silence and no sign it was ever read. Said here
                      rather than in a confirmation dialog, so it is read
                      before the click instead of after it.
                    */}
                    {row.status !== "resolved" && !sentReply ? (
                      <p className="mt-2 text-[11px] leading-4 text-amber-700">
                        No reply has been sent. Resolving now closes the report
                        without the customer hearing anything back.
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
