"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type ManualPaymentRow = {
  id: string;
  businessId: string;
  businessName: string;
  requestedByMemberId: string | null;
  requesterName: string;
  requesterEmail: string | null;
  requesterRole: string | null;
  planCode: string;
  billingCycle: string;
  amount: number;
  currency: string;
  status: string;
  customerNote: string | null;
  proofFileName: string;
  proofMimeType: string;
  proofSizeBytes: number;
  proofUrl: string | null;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  approvedAt: string | null;
  createdAt: string;
};

type StatusFilter =
  | "all"
  | "submitted"
  | "approved"
  | "rejected";

type ManualPaymentAdminProps = {
  onQueueChanged?: () => void | Promise<void>;
};

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function statusClass(status: string) {
  if (status === "approved") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (status === "rejected") {
    return "bg-red-100 text-red-700";
  }

  return "bg-amber-100 text-amber-700";
}

function statusLabel(status: string) {
  if (status === "submitted") return "Waiting review";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return status;
}

function fileSizeLabel(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ManualPaymentAdmin({
  onQueueChanged,
}: ManualPaymentAdminProps) {
  const [rows, setRows] = useState<ManualPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] =
    useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<
    Record<string, string>
  >({});
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("submitted");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/manual-payments/admin", {
        cache: "no-store",
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        requests?: ManualPaymentRow[];
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to load manual payments.",
        );
      }

      setRows(result.requests ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load manual payments.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const submitted = rows.filter(
      (row) => row.status === "submitted",
    ).length;
    const approved = rows.filter(
      (row) => row.status === "approved",
    ).length;
    const rejected = rows.filter(
      (row) => row.status === "rejected",
    ).length;

    return {
      submitted,
      approved,
      rejected,
      all: rows.length,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((row) => row.status === statusFilter);
  }, [rows, statusFilter]);

  async function tellAdminQueueChanged() {
    window.dispatchEvent(
      new Event("tenh-admin-summary-changed"),
    );

    if (onQueueChanged) {
      await onQueueChanged();
    }
  }

  async function decide(
    row: ManualPaymentRow,
    decision: "approve" | "reject",
  ) {
    const reviewNote = (reviewNotes[row.id] ?? "").trim();

    if (decision === "reject" && reviewNote.length < 3) {
      setError(
        "Add a short review note before rejecting. The customer will see this reason in TENH and in the bell notification.",
      );
      return;
    }

    const confirmation = window.confirm(
      decision === "approve"
        ? `Approve ${row.businessName} ${row.planCode.toUpperCase()} payment for ${formatMoney(row.amount, row.currency)}? This activates the subscription and notifies the customer.`
        : `Reject this payment proof from ${row.businessName}? The customer will receive your review note.`,
    );

    if (!confirmation) return;

    setBusyId(row.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/manual-payments/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: row.id,
          decision,
          reviewNote,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        notificationSent?: boolean;
        notificationWarning?: string | null;
        wasAlreadyApproved?: boolean;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to review the payment.",
        );
      }

      const actionLabel =
        decision === "approve" ? "approved" : "rejected";

      if (result.wasAlreadyApproved) {
        setSuccessMessage(
          "This payment was already approved. The subscription remains active; no duplicate customer notification was sent.",
        );
      } else if (result.notificationWarning) {
        setSuccessMessage(
          `Payment ${actionLabel}. ${result.notificationWarning}`,
        );
      } else {
        setSuccessMessage(
          `Payment ${actionLabel}. The customer was notified in the TENH bell.`,
        );
      }

      setReviewNotes((current) => ({
        ...current,
        [row.id]: "",
      }));

      await load();
      await tellAdminQueueChanged();
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : "Unable to review the payment.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const filterItems: Array<{
    id: StatusFilter;
    label: string;
    count: number;
    attention?: boolean;
  }> = [
    {
      id: "submitted",
      label: "Waiting review",
      count: counts.submitted,
      attention: true,
    },
    {
      id: "approved",
      label: "Approved",
      count: counts.approved,
    },
    {
      id: "rejected",
      label: "Rejected",
      count: counts.rejected,
    },
    {
      id: "all",
      label: "All",
      count: counts.all,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-950">
                Manual payment queue
              </h2>
              {counts.submitted > 0 ? (
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">
                  {counts.submitted}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Verify the real bank transfer and receipt before approving. Approval activates the plan immediately.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {filterItems.map((item) => {
            const active = statusFilter === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setStatusFilter(item.id)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-slate-950 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {item.label}
                <span
                  className={`flex min-h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-black ${
                    active
                      ? item.attention && item.count > 0
                        ? "bg-red-500 text-white"
                        : "bg-white/15 text-white"
                      : item.attention && item.count > 0
                        ? "bg-red-100 text-red-700"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {item.count > 99 ? "99+" : item.count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {successMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          {successMessage}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Loading manual payments…
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          No manual payments in this view.
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredRows.map((row) => (
            <article
              key={row.id}
              className={`rounded-[24px] border bg-white p-5 shadow-sm ${
                row.status === "submitted"
                  ? "border-amber-200"
                  : "border-slate-200"
              }`}
            >
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-950">
                      {row.businessName}
                    </h3>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(row.status)}`}
                    >
                      {statusLabel(row.status)}
                    </span>
                  </div>

                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    {row.planCode.toUpperCase()} · {row.billingCycle} · {formatMoney(row.amount, row.currency)}
                  </p>

                  <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Submitted by
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {row.requesterName}
                      </p>
                      {row.requesterEmail ? (
                        <p className="mt-0.5 break-all text-xs text-slate-500">
                          {row.requesterEmail}
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Submitted
                      </p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {formatDate(row.createdAt)}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Receipt
                      </p>
                      <p className="mt-1 break-all font-semibold text-slate-900">
                        {row.proofFileName}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {[row.proofMimeType, fileSizeLabel(row.proofSizeBytes)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Request ID
                      </p>
                      <p className="mt-1 break-all font-mono text-xs text-slate-600">
                        {row.id}
                      </p>
                    </div>
                  </div>

                  {row.customerNote ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                      <span className="font-semibold text-slate-900">
                        Customer note: {" "}
                      </span>
                      {row.customerNote}
                    </div>
                  ) : null}

                  {row.reviewNote ? (
                    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                      <span className="font-semibold text-blue-950">
                        TENH review note: {" "}
                      </span>
                      {row.reviewNote}
                    </div>
                  ) : null}
                </div>

                <div className="w-full max-w-sm shrink-0 space-y-3">
                  {row.proofUrl ? (
                    <a
                      href={row.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-full items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-100"
                    >
                      Open payment proof
                    </a>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                      Proof link is unavailable. Refresh to create a new signed link.
                    </div>
                  )}

                  {row.status === "submitted" ? (
                    <>
                      <div>
                        <label
                          htmlFor={`review-note-${row.id}`}
                          className="text-xs font-bold uppercase tracking-wide text-slate-500"
                        >
                          Message to customer
                        </label>
                        <textarea
                          id={`review-note-${row.id}`}
                          value={reviewNotes[row.id] ?? ""}
                          onChange={(event) =>
                            setReviewNotes((current) => ({
                              ...current,
                              [row.id]: event.target.value,
                            }))
                          }
                          rows={4}
                          maxLength={1000}
                          placeholder="Optional for approval · required for rejection"
                          className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                        <p className="mt-1 text-[11px] leading-4 text-slate-400">
                          This note appears in the customer payment status and the bell notification.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void decide(row, "reject")}
                          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={busyId === row.id}
                          onClick={() => void decide(row, "approve")}
                          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {busyId === row.id ? "Saving…" : "Approve"}
                        </button>
                      </div>

                      <p className="text-[11px] leading-4 text-slate-400">
                        Approve only after you confirm the transfer reached your real bank account and the amount matches this request.
                      </p>
                    </>
                  ) : (
                    <div className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                      <p>
                        Reviewed {formatDate(row.reviewedAt)}
                        {row.reviewedByEmail
                          ? ` by ${row.reviewedByEmail}`
                          : ""}
                        .
                      </p>
                      {row.status === "approved" && row.approvedAt ? (
                        <p className="mt-1 text-emerald-700">
                          Subscription activated {formatDate(row.approvedAt)}.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
