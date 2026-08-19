"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type InvoiceRecord = {
  id: string;
  invoiceNumber: string;
  sourceType: "payway" | "manual";
  sourcePaymentId: string;
  transactionId: string;
  workspaceName: string;
  customerName: string | null;
  billingEmail: string | null;
  planCode: string;
  planName: string;
  billingCycle: string;
  billingCycleLabel: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  provider: string;
  approvalCode: string | null;
  status: "paid";
  paidAt: string;
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  createdAt: string;
};

type InvoiceResponse = {
  success?: boolean;
  error?: string;
  invoice?: InvoiceRecord;
};

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

function formatDate(value: string, withTime = false) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "—";
  }

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

export function InvoiceReceiptView({
  invoiceId,
}: {
  invoiceId: string;
}) {
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInvoice() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/subscription/invoices/${encodeURIComponent(invoiceId)}`,
          {
            cache: "no-store",
          },
        );

        const result = (await response.json()) as InvoiceResponse;

        if (!response.ok || !result.success || !result.invoice) {
          throw new Error(
            result.error ?? "Unable to load this billing receipt.",
          );
        }

        if (!cancelled) {
          setInvoice(result.invoice);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load this billing receipt.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadInvoice();

    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-100 p-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm font-semibold text-slate-500 shadow-sm">
          Loading billing receipt...
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-full bg-slate-100 px-5 py-8">
        <div className="mx-auto max-w-2xl rounded-[28px] border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">
            Billing receipt
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">
            Unable to open receipt
          </h1>
          <p className="mt-3 text-sm leading-6 text-red-700">
            {error ?? "Billing receipt was not found."}
          </p>
          <Link
            href="/dashboard/subscription/billing-history"
            className="mt-6 inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            Back to billing history
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-100 px-4 py-6 sm:px-6 lg:px-8 print:bg-white print:p-0">
      <style jsx global>{`
        @media print {
          header:first-of-type {
            display: none !important;
          }

          html,
          body {
            background: #ffffff !important;
          }

          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          main {
            overflow: visible !important;
          }
        }
      `}</style>

      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <Link
            href="/dashboard/subscription/billing-history"
            className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-blue-700"
          >
            <span aria-hidden="true">←</span>
            Back to billing history
          </Link>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
          >
            Print / Save as PDF
          </button>
        </div>

        <article className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-xl print:rounded-none print:border-0 print:shadow-none">
          <div className="border-b border-slate-200 px-6 py-7 sm:px-10 sm:py-9">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <Image
                    src="/images/tenh_logo.png"
                    alt="TENH Chat"
                    width={52}
                    height={52}
                    className="h-12 w-12 object-contain"
                    priority
                  />
                </div>

                <div>
                  <p className="text-xl font-black tracking-tight text-slate-950">
                    TENH Chat
                  </p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Official subscription receipt
                  </p>
                </div>
              </div>

              <div className="sm:text-right">
                <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                  Paid
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-500">
                  Receipt / Invoice
                </p>
                <p className="mt-1 font-mono text-base font-black text-slate-950">
                  {invoice.invoiceNumber}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[1fr_0.85fr]">
            <section>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
                Billed to
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
                {invoice.workspaceName}
              </h1>

              {invoice.customerName ? (
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  {invoice.customerName}
                </p>
              ) : null}

              <p className="mt-1 text-sm text-slate-500">
                {invoice.billingEmail ?? "Billing email not recorded"}
              </p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <ReceiptRow
                label="Issued"
                value={formatDate(invoice.issuedAt)}
              />
              <ReceiptRow
                label="Paid"
                value={formatDate(invoice.paidAt, true)}
              />
              <ReceiptRow
                label="Payment method"
                value={invoice.paymentMethod}
              />
              <ReceiptRow
                label="Transaction"
                value={invoice.transactionId}
                mono
              />
              {invoice.approvalCode ? (
                <ReceiptRow
                  label="Approval code"
                  value={invoice.approvalCode}
                  mono
                />
              ) : null}
            </section>
          </div>

          <div className="border-y border-slate-200">
            <div className="hidden grid-cols-[1.2fr_0.9fr_0.8fr] gap-6 bg-slate-50 px-6 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400 sm:grid sm:px-10">
              <span>Description</span>
              <span>Billing period</span>
              <span className="text-right">Amount</span>
            </div>

            <div className="grid gap-5 px-6 py-6 sm:grid-cols-[1.2fr_0.9fr_0.8fr] sm:items-center sm:px-10">
              <div>
                <p className="font-black text-slate-950">
                  TENH Chat {invoice.planName}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Prepaid subscription · {invoice.billingCycleLabel}
                </p>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400 sm:hidden">
                  Billing period
                </p>
                <p className="mt-1 text-sm font-bold text-slate-800 sm:mt-0">
                  {formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}
                </p>
              </div>

              <div className="sm:text-right">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400 sm:hidden">
                  Amount
                </p>
                <p className="mt-1 text-xl font-black text-slate-950 sm:mt-0">
                  {formatMoney(invoice.amount, invoice.currency)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[1fr_0.75fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                Subscription coverage
              </p>
              <p className="mt-3 text-sm font-bold text-slate-800">
                {formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}
              </p>
              <p className="mt-2 max-w-xl text-xs leading-5 text-slate-500">
                This receipt confirms an approved TENH prepaid subscription payment. TENH does not automatically renew or charge the next billing period unless a future recurring-billing feature is enabled separately.
              </p>
            </div>

            <div className="rounded-2xl bg-slate-950 p-5 text-white">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-slate-400">Subtotal</span>
                <span className="font-bold">
                  {formatMoney(invoice.amount, invoice.currency)}
                </span>
              </div>
              <div className="mt-4 flex items-end justify-between gap-4 border-t border-white/10 pt-4">
                <span className="font-black uppercase tracking-[0.12em] text-slate-300">
                  Total paid
                </span>
                <span className="text-2xl font-black">
                  {formatMoney(invoice.amount, invoice.currency)}
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-6 py-5 text-center sm:px-10">
            <p className="text-xs leading-5 text-slate-500">
              TENH Chat payment receipt · Reference {invoice.invoiceNumber}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              This V3.10.4 document is a payment receipt/invoice record. Tax/VAT invoice fields are not configured in this version.
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}

function ReceiptRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-5 border-b border-slate-200 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <span
        className={`max-w-[65%] break-words text-right text-xs font-bold text-slate-800 ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
