"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type BillingStatus =
  | "pending"
  | "approved"
  | "declined"
  | "rejected"
  | "cancelled"
  | "failed";

type BillingHistoryItem = {
  id: string;
  sourceId: string;
  source: "payway" | "manual";
  transactionId: string;
  paymentMethod: string;
  planCode: string;
  billingCycle: string;
  amount: number;
  currency: string;
  status: BillingStatus;
  providerStatus: string | null;
  approvalCode: string | null;
  reviewNote: string | null;
  createdAt: string;
  paidAt: string | null;
  reviewedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
};

type HistoryResponse = {
  success?: boolean;
  error?: string;
  items?: BillingHistoryItem[];
  summary?: {
    total: number;
    approved: number;
    pending: number;
    attention: number;
    approvedUsdTotal: number;
    receipts: number;
  };
};

type FilterKey = "all" | "approved" | "pending" | "attention";

function formatMoney(amount: number, currency: string) {
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(amount);
  }

  return `${new Intl.NumberFormat("en-US").format(amount)} ${currency}`;
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return "—";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime
      ? {
          hour: "numeric",
          minute: "2-digit",
        }
      : {}),
  }).format(date);
}

function titleCase(value: string) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cycleLabel(value: string) {
  if (value === "monthly") return "Monthly";
  if (value === "3-months") return "3 months";
  if (value === "6-months") return "6 months";
  if (value === "12-months") return "12 months";
  return titleCase(value);
}

function statusClasses(status: BillingStatus) {
  switch (status) {
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "cancelled":
      return "border-slate-200 bg-slate-100 text-slate-600";
    case "declined":
    case "rejected":
    case "failed":
      return "border-red-200 bg-red-50 text-red-700";
    default:
      return "border-slate-200 bg-white text-slate-700";
  }
}

function isAttention(item: BillingHistoryItem) {
  return ["declined", "rejected", "failed"].includes(item.status);
}

export function BillingHistoryView() {
  const [items, setItems] = useState<BillingHistoryItem[]>([]);
  const [summary, setSummary] = useState<HistoryResponse["summary"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selected, setSelected] = useState<BillingHistoryItem | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/subscription/billing-history", {
          cache: "no-store",
        });
        const result = (await response.json()) as HistoryResponse;

        if (!response.ok || !result.success) {
          throw new Error(result.error ?? "Unable to load billing history.");
        }

        if (!cancelled) {
          setItems(result.items ?? []);
          setSummary(result.summary ?? null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load billing history.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "attention") return items.filter(isAttention);
    return items.filter((item) => item.status === filter);
  }, [filter, items]);

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "all", label: "All", count: summary?.total ?? items.length },
    {
      key: "approved",
      label: "Approved",
      count: summary?.approved ?? items.filter((item) => item.status === "approved").length,
    },
    {
      key: "pending",
      label: "Pending",
      count: summary?.pending ?? items.filter((item) => item.status === "pending").length,
    },
    {
      key: "attention",
      label: "Needs attention",
      count: summary?.attention ?? items.filter(isAttention).length,
    },
  ];

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto w-full max-w-7xl px-5 py-7 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/dashboard/subscription"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 transition hover:text-blue-700"
            >
              <span aria-hidden="true">←</span>
              Back to subscription
            </Link>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-blue-600">
              Billing & payments
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              Billing history
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              Review ABA PayWay attempts and manual bank-transfer payments for this TENH workspace.
            </p>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Payments" value={String(summary?.total ?? 0)} detail="All recorded payment attempts" />
          <SummaryCard
            label="Approved"
            value={String(summary?.approved ?? 0)}
            detail={`${summary?.receipts ?? 0} paid receipt${(summary?.receipts ?? 0) === 1 ? "" : "s"} available`}
            tone="green"
          />
          <SummaryCard label="Pending" value={String(summary?.pending ?? 0)} detail="Still waiting for confirmation" tone="amber" />
          <SummaryCard
            label="Approved total"
            value={formatMoney(summary?.approvedUsdTotal ?? 0, "USD")}
            detail="Approved USD payments"
            tone="blue"
          />
        </section>

        <section className="mt-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">Payment activity</h2>
                <p className="mt-1 text-sm text-slate-500">Newest payments appear first.</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {filters.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition ${
                      filter === item.key
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    }`}
                  >
                    {item.label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        filter === item.key ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {item.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm font-medium text-slate-500">Loading billing history...</div>
          ) : filteredItems.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl">$</div>
              <p className="mt-4 font-bold text-slate-900">No payments in this view</p>
              <p className="mt-1 text-sm text-slate-500">Payment activity will appear here after checkout or manual submission.</p>
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[1.15fr_0.9fr_0.85fr_0.75fr_0.75fr_auto] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 lg:grid">
                <span>Payment</span>
                <span>Plan</span>
                <span>Method</span>
                <span>Amount</span>
                <span>Status</span>
                <span />
              </div>

              <div className="divide-y divide-slate-100">
                {filteredItems.map((item) => (
                  <article
                    key={item.id}
                    className="grid gap-4 px-5 py-5 transition hover:bg-slate-50 sm:px-6 lg:grid-cols-[1.15fr_0.9fr_0.85fr_0.75fr_0.75fr_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{formatDate(item.createdAt)}</p>
                      <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{item.transactionId}</p>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-800">{titleCase(item.planCode)}</p>
                      <p className="mt-1 text-xs text-slate-500">{cycleLabel(item.billingCycle)}</p>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-slate-700">{item.paymentMethod}</p>
                    </div>

                    <div>
                      <p className="font-bold text-slate-950">{formatMoney(item.amount, item.currency)}</p>
                    </div>

                    <div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold capitalize ${statusClasses(item.status)}`}>
                        {item.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-self-start lg:justify-self-end">
                      {item.status === "approved" && item.invoiceId ? (
                        <Link
                          href={`/dashboard/subscription/invoices/${item.invoiceId}`}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          Receipt
                        </Link>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => setSelected(item)}
                        className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                      >
                        View details
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelected(null);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-6 py-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Payment details</p>
                <h2 className="mt-1 text-2xl font-bold text-slate-950">{titleCase(selected.planCode)} · {cycleLabel(selected.billingCycle)}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-lg text-slate-500 transition hover:bg-slate-100"
                aria-label="Close payment details"
              >
                ×
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-950 p-5 text-white">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Amount</p>
                  <p className="mt-1 text-3xl font-black">{formatMoney(selected.amount, selected.currency)}</p>
                </div>
                <span className={`rounded-full border px-3 py-1.5 text-xs font-bold capitalize ${statusClasses(selected.status)}`}>
                  {selected.status}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Detail label="Payment method" value={selected.paymentMethod} />
                <Detail label="Submitted" value={formatDate(selected.createdAt, true)} />
                <Detail label="Transaction ID" value={selected.transactionId} mono />
                <Detail label="Provider status" value={selected.providerStatus ?? "—"} />
                <Detail label="Approved / paid" value={formatDate(selected.paidAt, true)} />
                <Detail label="Approval code" value={selected.approvalCode ?? "—"} mono />
              </div>

              {selected.status === "approved" ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">Billing period</p>
                      <p className="mt-2 font-bold text-emerald-950">
                        {formatDate(selected.periodStart)} → {formatDate(selected.periodEnd)}
                      </p>
                      {selected.invoiceNumber ? (
                        <p className="mt-1 font-mono text-[11px] text-emerald-700">
                          {selected.invoiceNumber}
                        </p>
                      ) : null}
                    </div>

                    {selected.invoiceId ? (
                      <Link
                        href={`/dashboard/subscription/invoices/${selected.invoiceId}`}
                        className="inline-flex shrink-0 items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                      >
                        View receipt
                      </Link>
                    ) : (
                      <span className="text-xs font-semibold text-emerald-700">
                        Receipt is being prepared.
                      </span>
                    )}
                  </div>
                </div>
              ) : null}

              {selected.reviewNote ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-700">TENH review note</p>
                  <p className="mt-2 text-sm leading-6 text-amber-900">{selected.reviewNote}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  tone = "slate",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "slate" | "green" | "amber" | "blue";
}) {
  const classes = {
    slate: "border-slate-200 bg-white",
    green: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    blue: "border-blue-200 bg-blue-50",
  }[tone];

  return (
    <div className={`rounded-[24px] border p-5 shadow-sm ${classes}`}>
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-2 break-words text-sm font-semibold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
