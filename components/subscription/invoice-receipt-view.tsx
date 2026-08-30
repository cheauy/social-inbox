"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Hash,
  ReceiptText,
  ShieldCheck,
  Star,
} from "lucide-react";

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
  autoPrint = false,
  returnTo = "/dashboard/subscription",
}: {
  invoiceId: string;
  autoPrint?: boolean;
  returnTo?: string;
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

  useEffect(() => {
    if (!autoPrint || !invoice) return;

    const safeReturnTo = returnTo.startsWith("/dashboard/")
      ? returnTo
      : "/dashboard/subscription";
    let redirected = false;

    const returnToSubscription = () => {
      if (redirected) return;
      redirected = true;
      window.location.replace(safeReturnTo);
    };

    const handleAfterPrint = () => {
      returnToSubscription();
    };

    window.addEventListener("afterprint", handleAfterPrint);
    const timer = window.setTimeout(() => {
      window.print();
    }, 350);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [autoPrint, invoice, returnTo]);

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
    <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain bg-slate-50 px-3 py-4 sm:px-5 lg:px-6 print:h-auto print:overflow-visible print:bg-white print:p-0">
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

          .tenh-receipt-toolbar {
            display: none !important;
          }

          .tenh-receipt-card {
            box-shadow: none !important;
            border: 0 !important;
            border-radius: 0 !important;
          }
        }
      `}</style>

      <div className="mx-auto w-full max-w-[1120px]">
        {/* Keep existing navigation/print functions */}
        <div className="tenh-receipt-toolbar mb-3 flex items-center justify-between gap-3 print:hidden">
          <Link
            href="/dashboard/subscription/billing-history"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 transition hover:text-blue-700"
          >
            <span aria-hidden="true">←</span>
            Back to billing history
          </Link>
        </div>

        <article className="tenh-receipt-card overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
          {/* Header */}
          <header className="border-b border-slate-200 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-[20px] border border-slate-200 bg-white shadow-sm">
                  <Image
                    src="/images/tenh_logo.png"
                    alt="TENH Chat"
                    width={64}
                    height={64}
                    className="h-[54px] w-[54px] object-contain"
                    priority
                  />
                </div>

                <div className="pt-1">
                  <h1 className="text-[25px] font-extrabold tracking-[-0.03em] text-slate-950">
                    TENH Chat
                  </h1>
                  <p className="mt-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
                    Official subscription receipt
                  </p>

                  <div className="mt-3 inline-flex items-center gap-2 text-sm text-slate-500">
                    <CheckCircle2
                      className="h-4 w-4 text-blue-600"
                      strokeWidth={2.2}
                    />
                    <span>Thank you for your payment!</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-start gap-3 sm:items-end">
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-[13px] font-extrabold uppercase tracking-[0.08em] text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} />
                  Paid
                </span>

                <div className="sm:text-right">
                  <p className="text-xs font-semibold text-slate-500">
                    Receipt / Invoice
                  </p>

                  <div className="mt-1 inline-flex items-center gap-2">
                    <p className="text-[18px] font-extrabold tracking-[-0.02em] text-slate-950 sm:text-[20px]">
                      {invoice.invoiceNumber}
                    </p>

                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(
                          invoice.invoiceNumber,
                        );
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 print:hidden"
                      aria-label="Copy receipt number"
                    >
                      <Copy className="h-4 w-4" strokeWidth={2.1} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Billed-to + payment metadata */}
          <div className="grid gap-8 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_0.92fr]">
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-blue-600">
                Billed to
              </p>

              <h2 className="mt-3 text-[29px] font-extrabold tracking-[-0.03em] text-slate-950">
                {invoice.workspaceName}
              </h2>

              <div className="mt-5 flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base font-extrabold text-white shadow-sm">
                  {(invoice.customerName ?? invoice.workspaceName)
                    .trim()
                    .charAt(0)
                    .toUpperCase()}
                </div>

                <div>
                  {invoice.customerName ? (
                    <p className="text-base font-bold text-slate-950">
                      {invoice.customerName}
                    </p>
                  ) : (
                    <p className="text-base font-bold text-slate-950">
                      {invoice.workspaceName}
                    </p>
                  )}

                  <p className="mt-0.5 text-sm text-slate-500">
                    {invoice.billingEmail ?? "Billing email not recorded"}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-[20px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="divide-y divide-slate-200">
                <InvoiceMetaRow
                  icon={
                    <CalendarDays
                      className="h-4 w-4 text-blue-600"
                      strokeWidth={2.1}
                    />
                  }
                  label="Issued"
                  value={formatDate(invoice.issuedAt)}
                />

                <InvoiceMetaRow
                  icon={
                    <CheckCircle2
                      className="h-4 w-4 text-blue-600"
                      strokeWidth={2.1}
                    />
                  }
                  label="Paid"
                  value={formatDate(invoice.paidAt, true)}
                />

                <InvoiceMetaRow
                  icon={
                    <CreditCard
                      className="h-4 w-4 text-blue-600"
                      strokeWidth={2.1}
                    />
                  }
                  label="Payment method"
                  value={invoice.paymentMethod}
                />

                <InvoiceMetaRow
                  icon={
                    <Hash
                      className="h-4 w-4 text-blue-600"
                      strokeWidth={2.1}
                    />
                  }
                  label="Transaction ID"
                  value={invoice.transactionId}
                  breakValue
                />

                {invoice.approvalCode ? (
                  <InvoiceMetaRow
                    icon={
                      <ShieldCheck
                        className="h-4 w-4 text-blue-600"
                        strokeWidth={2.1}
                      />
                    }
                    label="Approval code"
                    value={invoice.approvalCode}
                  />
                ) : null}
              </div>
            </section>
          </div>

          {/* Table headings */}
          <div className="hidden grid-cols-[1.1fr_0.95fr_0.35fr] border-y border-slate-200 bg-slate-50 px-6 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400 sm:grid sm:px-8">
            <div>Description</div>
            <div>Billing period</div>
            <div className="text-right">Amount</div>
          </div>

          {/* Plan line */}
          <div className="grid gap-5 border-y border-slate-200 px-6 py-6 sm:grid-cols-[1.1fr_0.95fr_0.35fr] sm:items-center sm:border-t-0 sm:px-8">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Star className="h-5 w-5" strokeWidth={2.1} />
              </div>

              <div>
                <p className="text-[17px] font-extrabold text-slate-950">
                  TENH Chat {invoice.planName}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Prepaid subscription · {invoice.billingCycleLabel}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-400 sm:hidden">
                Billing period
              </p>
              <p className="mt-1 text-[16px] font-bold text-slate-900 sm:mt-0">
                {formatDate(invoice.periodStart)} →{" "}
                {formatDate(invoice.periodEnd)}
              </p>
            </div>

            <div className="sm:text-right">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-400 sm:hidden">
                Amount
              </p>
              <p className="mt-1 text-[27px] font-extrabold tracking-[-0.03em] text-slate-950 sm:mt-0">
                {formatMoney(invoice.amount, invoice.currency)}
              </p>
            </div>
          </div>

          {/* Coverage + totals */}
          <div className="grid gap-5 px-6 py-6 sm:px-8 lg:grid-cols-[1.06fr_0.94fr]">
            <section className="rounded-[20px] border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                  <CalendarDays className="h-5 w-5" strokeWidth={2.1} />
                </div>

                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-blue-600">
                    Subscription coverage
                  </p>
                  <p className="mt-2 text-[18px] font-extrabold text-slate-950">
                    {formatDate(invoice.periodStart)} →{" "}
                    {formatDate(invoice.periodEnd)}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2 text-sm leading-6 text-slate-500">
                <p>
                  This receipt confirms an approved TENH prepaid subscription
                  payment.
                </p>
                <p>
                  TENH does not automatically renew or charge the next billing
                  period unless a future recurring-billing feature is enabled
                  separately.
                </p>
              </div>
            </section>

            <section className="rounded-[20px] bg-[#031D4C] p-5 text-white shadow-[0_14px_35px_rgba(3,29,76,0.28)]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-white/80">Subtotal</span>
                <span className="text-base font-bold">
                  {formatMoney(invoice.amount, invoice.currency)}
                </span>
              </div>

              <div className="my-4 border-t border-dashed border-white/20" />

              <div className="flex items-end justify-between gap-4">
                <span className="text-base text-white/85">Total Paid</span>
                <span className="text-[30px] font-extrabold tracking-[-0.035em]">
                  {formatMoney(invoice.amount, invoice.currency)}
                </span>
              </div>

              <div className="my-4 border-t border-white/20" />

              <div className="flex items-center gap-3 text-sm text-emerald-200">
                <ShieldCheck className="h-5 w-5" strokeWidth={2.1} />
                <span>Payment verified and approved</span>
              </div>
            </section>
          </div>

          {/* Receipt action bar */}
          <div className="mx-6 mb-6 rounded-[18px] border border-blue-100 bg-blue-50/50 px-5 py-4 sm:mx-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
                  <ReceiptText className="h-5 w-5" strokeWidth={2.1} />
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    Keep this receipt for your records.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    If you have any questions, please contact TENH Chat support.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 print:hidden"
              >
                <Download className="h-4 w-4" strokeWidth={2.1} />
                Download PDF
              </button>
            </div>
          </div>

          {/* Footer */}
          <footer className="border-t border-slate-200 px-6 py-4 text-center sm:px-8">
            <p className="text-sm font-medium text-slate-500">
              TENH Chat payment receipt · Reference {invoice.invoiceNumber}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              This V3.10.4 document is a payment receipt/invoice record. Tax/VAT
              invoice fields are not configured in this version.
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}

function InvoiceMetaRow({
  icon,
  label,
  value,
  breakValue = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  breakValue?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3 text-sm text-slate-500">
        {icon}
        <span>{label}</span>
      </div>

      <span
        className={`max-w-[58%] text-right text-sm font-bold text-slate-900 ${
          breakValue ? "break-all" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}
