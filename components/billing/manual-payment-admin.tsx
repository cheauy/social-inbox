"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type PurchaseType =
  | "subscription"
  | "renew-same"
  | "upgrade"
  | "custom-upgrade";

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
  purchaseType: PurchaseType;
  targetMemberLimit: number | null;
  targetChannelLimit: number | null;
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
  currentSubscription: {
    status: string;
    planCode: string;
    billingCycle: string | null;
    memberLimit: number | null;
    channelLimit: number | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    paymentProvider: string | null;
  } | null;
  currentUsage: {
    activeMembers: number;
    activeChannels: number;
  };
  paymentSafety: {
    blocked: boolean;
    kind: "clear" | "pending" | "approved";
    message: string;
    transaction: {
      transactionId: string;
      status: string;
      amount: number;
      currency: string;
      createdAt: string;
      verifiedAt: string | null;
    } | null;
    latestPayWay: {
      transactionId: string;
      status: string;
      planCode: string;
      billingCycle: string;
      amount: number;
      currency: string;
      createdAt: string;
      verifiedAt: string | null;
    } | null;
  };
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
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
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

function formatShortDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatRelativeHours(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.max(0, Math.floor(diffMs / 1000 / 60 / 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "submitted just now";
  if (diffHours < 24) return `submitted ${diffHours}h ago`;
  if (diffDays === 1) return "submitted 1 day ago";
  return `submitted ${diffDays} days ago`;
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

function billingCycleLabel(value: string) {
  if (value === "monthly") return "1 month";
  if (value === "3-months") return "3 months";
  if (value === "6-months") return "6 months";
  if (value === "12-months") return "12 months";
  return value;
}

function purchaseLabel(type: PurchaseType) {
  if (type === "renew-same") return "Reactivation";
  if (type === "upgrade") return "Upgrade";
  if (type === "custom-upgrade") return "Upgrade";
  return "New";
}

function planLabel(value: string | null | undefined) {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function providerLabel(value: string | null | undefined) {
  if (!value) return "—";
  if (value === "payway") return "ABA PayWay";
  if (value === "manual") return "Manual";
  return planLabel(value);
}

function safeLimit(value: number | null) {
  return value === null ? "—" : String(value);
}

function changeLabel(row: ManualPaymentRow) {
  const changePlan =
    row.purchaseType === "upgrade" || row.purchaseType === "custom-upgrade"
      ? `${planLabel(row.currentSubscription?.planCode)} → ${planLabel(row.planCode)}`
      : `${purchaseLabel(row.purchaseType)} · ${planLabel(row.planCode)}`;

  return `${changePlan} · ${billingCycleLabel(row.billingCycle)}`;
}

function decidedSummary(row: ManualPaymentRow) {
  const parts = [purchaseLabel(row.purchaseType), changeLabel(row), formatShortDate(row.createdAt)];
  return parts.filter(Boolean).join(" · ");
}

function PaymentSafetyBanner({ row }: { row: ManualPaymentRow }) {
  if (row.paymentSafety.blocked) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <div className="font-semibold">ABA conflict — a verified PayWay purchase already covered this period</div>
        <div className="mt-1 text-red-700">{row.paymentSafety.message}</div>
      </div>
    );
  }

  if (row.paymentSafety.latestPayWay) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-100/80 px-4 py-3 text-sm text-emerald-900">
        <div className="font-semibold">No duplicate ABA PayWay purchase</div>
        <div className="mt-1 text-emerald-800">
          Latest PayWay transaction: {planLabel(row.paymentSafety.latestPayWay.planCode)} · {formatMoney(row.paymentSafety.latestPayWay.amount, row.paymentSafety.latestPayWay.currency)} · {statusLabel(row.paymentSafety.latestPayWay.status)} {row.paymentSafety.latestPayWay.verifiedAt ? `· approved ${formatShortDate(row.paymentSafety.latestPayWay.verifiedAt)}` : ""}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-100/80 px-4 py-3 text-sm text-emerald-900">
      <div className="font-semibold">No duplicate ABA PayWay purchase</div>
      <div className="mt-1 text-emerald-800">{row.paymentSafety.message}</div>
    </div>
  );
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
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("submitted");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        throw new Error(result.error ?? "Unable to load manual payments.");
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

  useEffect(() => {
    if (!selectedId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedId(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  const counts = useMemo(() => {
    const submitted = rows.filter((row) => row.status === "submitted").length;
    const approved = rows.filter((row) => row.status === "approved").length;
    const rejected = rows.filter((row) => row.status === "rejected").length;

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

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const waitingRows = useMemo(
    () => filteredRows.filter((row) => row.status === "submitted"),
    [filteredRows],
  );

  const decidedRows = useMemo(
    () => filteredRows.filter((row) => row.status !== "submitted"),
    [filteredRows],
  );

  async function tellAdminQueueChanged() {
    window.dispatchEvent(new Event("tenh-admin-summary-changed"));

    if (onQueueChanged) {
      await onQueueChanged();
    }
  }

  async function decide(
    row: ManualPaymentRow,
    decision: "approve" | "reject",
  ) {
    const reviewNote = (reviewNotes[row.id] ?? "").trim();

    if (decision === "approve" && row.paymentSafety.blocked) {
      setError(
        "Manual approval is blocked because TENH detected a matching ABA PayWay payment. Reject this duplicate request or verify the PayWay state first.",
      );
      return;
    }

    if (decision === "reject" && reviewNote.length < 3) {
      setError(
        "Add a short review note before rejecting. The customer will see this reason in TENH and in the bell notification.",
      );
      return;
    }

    const confirmation = window.confirm(
      decision === "approve"
        ? `Approve ${row.businessName} ${purchaseLabel(row.purchaseType)} payment for ${formatMoney(row.amount, row.currency)}? This activates the subscription and notifies the customer.`
        : `Reject this manual payment request from ${row.businessName}? The customer will receive your review note.`,
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
        throw new Error(result.error ?? "Unable to review the payment.");
      }

      const actionLabel = decision === "approve" ? "approved" : "rejected";

      if (result.wasAlreadyApproved) {
        setSuccessMessage(
          "This payment was already approved. The subscription remains active; no duplicate customer notification was sent.",
        );
      } else if (result.notificationWarning) {
        setSuccessMessage(`Payment ${actionLabel}. ${result.notificationWarning}`);
      } else {
        setSuccessMessage(
          `Payment ${actionLabel}. The customer was notified in the TENH bell.`,
        );
      }

      setReviewNotes((current) => ({
        ...current,
        [row.id]: "",
      }));

      setSelectedId(null);
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
  }> = [
    { id: "submitted", label: "Waiting", count: counts.submitted },
    { id: "approved", label: "Approved", count: counts.approved },
    { id: "rejected", label: "Rejected", count: counts.rejected },
    { id: "all", label: "All", count: counts.all },
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400">
              Admin
            </p>
            <h2 className="mt-1 text-[28px] font-bold leading-none text-slate-950">
              Manual payment review
            </h2>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <span aria-hidden="true">⟳</span>
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
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? item.id === "submitted"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-slate-200 text-slate-900"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <span>{item.label}</span>
                <span className="font-semibold">{item.count}</span>
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
        <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="space-y-3">
            {waitingRows.map((row) => (
              <article
                key={row.id}
                className="rounded-2xl border border-amber-300 bg-[#f6dca1] px-4 py-4 text-slate-900"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 gap-4">
                    <div className="shrink-0 text-[34px] font-bold leading-none text-[#7c4a0b]">
                      {formatMoney(row.amount, row.currency)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-slate-900">
                        {row.requesterName}
                      </p>
                      <p className="truncate text-sm text-[#7b5d1f]">
                        {row.purchaseType === "renew-same"
                          ? `Reactivation · ${planLabel(row.currentSubscription?.planCode)} → ${planLabel(row.planCode)} · ${billingCycleLabel(row.billingCycle)}`
                          : `${planLabel(row.currentSubscription?.planCode)} → ${planLabel(row.planCode)} · ${billingCycleLabel(row.billingCycle)}`} · {formatRelativeHours(row.createdAt)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedId(row.id)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-[#c79438] bg-[#f7e5b7] px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-[#f3dda1]"
                  >
                    Review
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </article>
            ))}

            {decidedRows.length > 0 ? (
              <div className="pt-3">
                <div className="flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span>Already decided</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <div className="mt-3 overflow-hidden rounded-[22px] border border-slate-200 bg-white">
                  {decidedRows.map((row, index) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className={`flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-slate-50 ${
                        index !== 0 ? "border-t border-slate-200" : ""
                      }`}
                    >
                      <div className="w-24 shrink-0 text-xl font-bold text-slate-950">
                        {formatMoney(row.amount, row.currency)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-semibold text-slate-900">
                          {row.requesterName}
                        </p>
                        <p className="truncate text-sm text-slate-500">
                          {decidedSummary(row)}
                        </p>
                        {row.paymentSafety.blocked ? (
                          <p className="mt-1 text-sm text-red-600">
                            ⚠ ABA conflict — a verified PayWay purchase already covered this period
                          </p>
                        ) : null}
                      </div>

                      <div className="shrink-0">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(row.status)}`}>
                          {statusLabel(row.status)}
                        </span>
                      </div>

                      <div className="shrink-0 text-lg text-slate-400">›</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      )}

      {selectedRow ? (
        <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 sm:p-6">
          <button
            type="button"
            aria-label="Close payment details"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => setSelectedId(null)}
          />

          <div className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-[#d0b06c] bg-white shadow-2xl">
            <div className="shrink-0 bg-[#f4d993] px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-[#6c5322]">
                    {statusLabel(selectedRow.status)} · {formatRelativeHours(selectedRow.createdAt)}
                  </p>
                  <div className="mt-1 text-[40px] font-bold leading-none text-[#7c4a0b]">
                    {formatMoney(selectedRow.amount, selectedRow.currency)}
                  </div>
                  <p className="mt-2 text-base text-slate-900">
                    {selectedRow.requesterName} · {planLabel(selectedRow.currentSubscription?.planCode)} → {planLabel(selectedRow.planCode)} · {billingCycleLabel(selectedRow.billingCycle)}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#b9934d] bg-[#f8e5b9] text-xl text-slate-700 hover:bg-[#f3dca3]"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-5 p-5 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Transfer proof
                  </p>
                  <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      {selectedRow.proofUrl &&
                      selectedRow.proofMimeType.startsWith("image/") ? (
                        <img
                          src={selectedRow.proofUrl}
                          alt={`Transfer proof ${selectedRow.proofFileName}`}
                          className="h-auto max-h-[300px] w-full object-contain"
                        />
                      ) : (
                        <div className="flex min-h-[180px] items-center justify-center px-4 text-center text-sm font-medium text-slate-400">
                          {selectedRow.proofUrl
                            ? "Preview unavailable for this file type. Use View full size."
                            : "Transfer proof preview unavailable."}
                        </div>
                      )}
                    </div>
                    <div className="mt-3 break-all text-sm font-medium text-slate-500">
                      {selectedRow.proofFileName}
                      {fileSizeLabel(selectedRow.proofSizeBytes)
                        ? ` · ${fileSizeLabel(selectedRow.proofSizeBytes)}`
                        : ""}
                    </div>
                  </div>

                  {selectedRow.proofUrl ? (
                    <a
                      href={selectedRow.proofUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      View full size
                    </a>
                  ) : (
                    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      Proof link is unavailable.
                    </div>
                  )}
                </div>

                <div className="space-y-3 text-sm">
                  <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                    <p className="font-semibold text-slate-500">Customer</p>
                    <div>
                      <p className="font-semibold text-slate-950">
                        {selectedRow.requesterName} · {selectedRow.requesterRole ?? "owner"}
                      </p>
                      <p className="break-all text-slate-500">
                        {selectedRow.requesterEmail ?? "No email"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                    <p className="font-semibold text-slate-500">Workspace</p>
                    <div>
                      <p className="font-semibold text-slate-950">{selectedRow.businessName}</p>
                      <p className="text-slate-500">
                        {planLabel(selectedRow.currentSubscription?.planCode)} · active until {formatDate(selectedRow.currentSubscription?.currentPeriodEnd ?? null)} · {providerLabel(selectedRow.currentSubscription?.paymentProvider)}
                      </p>
                    </div>
                  </div>

                  {selectedRow.customerNote ? (
                    <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                      <p className="font-semibold text-slate-500">Note</p>
                      <div className="whitespace-pre-wrap text-slate-950">
                        {selectedRow.customerNote}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
                    <p className="font-semibold text-slate-500">Request</p>
                    <div className="break-all text-slate-500">{selectedRow.id}</div>
                  </div>
                </div>
              </div>

              <PaymentSafetyBanner row={selectedRow} />

              <section>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  What approving changes
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-sm text-slate-500">Users</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {safeLimit(selectedRow.currentSubscription?.memberLimit ?? null)} → {safeLimit(selectedRow.targetMemberLimit)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Connections</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {safeLimit(selectedRow.currentSubscription?.channelLimit ?? null)} → {safeLimit(selectedRow.targetChannelLimit)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Plan</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {planLabel(selectedRow.currentSubscription?.planCode)} → {planLabel(selectedRow.planCode)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Ends</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {formatDate(selectedRow.currentSubscription?.currentPeriodEnd ?? null)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-500">
                  Using {selectedRow.currentUsage.activeMembers} user and {selectedRow.currentUsage.activeChannels} connections today, so nothing is over the new limits.
                </p>
              </section>

              {selectedRow.reviewNote && selectedRow.status !== "submitted" ? (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <p className="font-semibold text-blue-950">TENH review note</p>
                  <p className="mt-1 whitespace-pre-wrap">{selectedRow.reviewNote}</p>
                </div>
              ) : null}

              {selectedRow.status === "submitted" ? (
                <section className="border-t border-slate-200 pt-4">
                  <textarea
                    id={`review-note-${selectedRow.id}`}
                    value={reviewNotes[selectedRow.id] ?? ""}
                    onChange={(event) =>
                      setReviewNotes((current) => ({
                        ...current,
                        [selectedRow.id]: event.target.value,
                      }))
                    }
                    rows={4}
                    maxLength={1000}
                    placeholder="Message to the customer — required if you reject"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <p className="max-w-xl text-xs leading-5 text-slate-500">
                      Approve only once the transfer has landed in the TENH bank account. A receipt screenshot is not proof.
                    </p>

                    <div className="flex gap-2 sm:justify-end">
                      <button
                        type="button"
                        disabled={busyId === selectedRow.id}
                        onClick={() => void decide(selectedRow, "reject")}
                        className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busyId === selectedRow.id || selectedRow.paymentSafety.blocked}
                        onClick={() => void decide(selectedRow, "approve")}
                        className="rounded-xl bg-[#11a108] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0f9207] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                      >
                        {busyId === selectedRow.id
                          ? "Saving…"
                          : selectedRow.paymentSafety.blocked
                            ? "Approval blocked"
                            : `Approve ${formatMoney(selectedRow.amount, selectedRow.currency)}`}
                      </button>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="border-t border-slate-200 pt-4 text-sm text-slate-500">
                  <p>
                    Reviewed {formatDate(selectedRow.reviewedAt)}
                    {selectedRow.reviewedByEmail
                      ? ` by ${selectedRow.reviewedByEmail}`
                      : ""}
                    .
                  </p>
                  {selectedRow.status === "approved" && selectedRow.approvedAt ? (
                    <p className="mt-1 font-medium text-emerald-700">
                      Subscription activated {formatDate(selectedRow.approvedAt)}.
                    </p>
                  ) : null}
                </section>
              )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
