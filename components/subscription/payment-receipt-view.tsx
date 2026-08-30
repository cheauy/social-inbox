
"use client";

import Link from "next/link";
import Image from "next/image";
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

type ReceiptCustomer = {
  name?: string | null;
  email?: string | null;
};

type ReceiptItem = {
  title?: string | null;
  subtitle?: string | null;
  amountLabel?: string | null;
  amount?: number | string | null;
  periodLabel?: string | null;
  periodSubLabel?: string | null;
};

type ReceiptData = {
  reference?: string | null;
  title?: string | null;
  planName?: string | null;
  billedToTitle?: string | null;
  customer?: ReceiptCustomer | null;
  issuedAt?: string | null;
  paidAt?: string | null;
  paymentMethod?: string | null;
  transactionId?: string | null;
  approvalCode?: string | null;
  item?: ReceiptItem | null;
  subtotal?: number | string | null;
  totalPaid?: number | string | null;
  coverageStart?: string | null;
  coverageEnd?: string | null;
  coverageDays?: string | null;
  pdfHref?: string | null;
  onDownloadPdf?: (() => void) | null;
  onCopyReference?: (() => void) | null;
  footerNote?: string | null;
  footerMeta?: string | null;
};

function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "$0.00";
  if (typeof value === "string") {
    if (value.startsWith("$")) return value;
    const n = Number(value);
    if (!Number.isNaN(n)) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
      }).format(n);
    }
    return value;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDateInput(value?: string | null) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    }
  } catch {}
  return value;
}

function formatDateTimeInput(value?: string | null) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
  } catch {}
  return value;
}

export default function PaymentReceiptView({
  data,
}: {
  data: ReceiptData;
}) {
  const reference = data.reference ?? "TENH-202608-000025";
  const billedToTitle = data.billedToTitle ?? "Standard Subscription";
  const planName = data.planName ?? "TENH Chat Mini";
  const customerName = data.customer?.name ?? "Long Seavlay";
  const customerEmail = data.customer?.email ?? "waynehe7@hotmail.com";
  const paymentMethod = data.paymentMethod ?? "ABA Pay / KHQR";

  const subtotal = formatMoney(data.subtotal ?? data.totalPaid ?? data.item?.amount ?? 13);
  const totalPaid = formatMoney(data.totalPaid ?? data.item?.amount ?? 13);

  const title = data.title ?? "Official subscription receipt";
  const periodLabel =
    data.item?.periodLabel ??
    `${formatDateInput(data.coverageStart)} → ${formatDateInput(data.coverageEnd)}`;
  const periodSubLabel = data.item?.periodSubLabel ?? (data.coverageDays || "31 days");

  const copyReference = async () => {
    try {
      if (data.onCopyReference) {
        data.onCopyReference();
        return;
      }
      await navigator.clipboard.writeText(reference);
    } catch {}
  };

  return (
    <section className="h-full min-h-0 overflow-y-auto overscroll-y-contain bg-slate-50 px-3 py-4 sm:px-5 sm:py-5 lg:px-6">
      <div className="mx-auto w-full max-w-[1120px]">
        <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
          {/* Receipt header */}
          <header className="border-b border-slate-200 px-6 py-6 sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-[20px] border border-slate-200 bg-white shadow-sm">
                  <Image
                    src="/images/tenh-logo.png"
                    alt="TENH Chat"
                    width={76}
                    height={76}
                    className="h-[54px] w-[54px] object-contain"
                  />
                </div>

                <div className="pt-1">
                  <h1 className="text-[25px] font-extrabold tracking-[-0.03em] text-slate-950">
                    TENH Chat
                  </h1>
                  <p className="mt-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
                    {title}
                  </p>
                  <div className="mt-3 inline-flex items-center gap-2 text-sm text-slate-500">
                    <CheckCircle2 className="h-4 w-4 text-blue-600" strokeWidth={2.2} />
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
                      {reference}
                    </p>
                    <button
                      type="button"
                      onClick={copyReference}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Copy receipt reference"
                    >
                      <Copy className="h-4 w-4" strokeWidth={2.1} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Customer + payment details */}
          <div className="grid gap-8 px-6 py-7 sm:px-8 lg:grid-cols-[1fr_0.92fr]">
            <section>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-blue-600">
                Billed to
              </p>

              <h2 className="mt-3 text-[29px] font-extrabold tracking-[-0.03em] text-slate-950">
                {billedToTitle}
              </h2>

              <div className="mt-5 flex items-center gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-base font-extrabold text-white shadow-sm">
                  {(customerName || "L").trim().charAt(0).toUpperCase()}
                </div>

                <div>
                  <p className="text-base font-bold text-slate-950">
                    {customerName}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {customerEmail}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-[20px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="divide-y divide-slate-200">
                <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <CalendarDays className="h-4 w-4 text-blue-600" strokeWidth={2.1} />
                    <span>Issued</span>
                  </div>
                  <span className="text-right text-sm font-bold text-slate-900">
                    {formatDateInput(data.issuedAt)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <CheckCircle2 className="h-4 w-4 text-blue-600" strokeWidth={2.1} />
                    <span>Paid</span>
                  </div>
                  <span className="text-right text-sm font-bold text-slate-900">
                    {formatDateTimeInput(data.paidAt)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <CreditCard className="h-4 w-4 text-blue-600" strokeWidth={2.1} />
                    <span>Payment method</span>
                  </div>
                  <span className="text-right text-sm font-bold text-slate-900">
                    {paymentMethod}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 py-3">
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <Hash className="h-4 w-4 text-blue-600" strokeWidth={2.1} />
                    <span>Transaction ID</span>
                  </div>
                  <span className="max-w-[58%] break-all text-right text-sm font-bold text-slate-900">
                    {data.transactionId || "178739087381966"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
                  <div className="flex items-center gap-3 text-sm text-slate-500">
                    <ShieldCheck className="h-4 w-4 text-blue-600" strokeWidth={2.1} />
                    <span>Approval code</span>
                  </div>
                  <span className="text-right text-sm font-bold text-slate-900">
                    {data.approvalCode || "249616"}
                  </span>
                </div>
              </div>
            </section>
          </div>

          {/* Table labels */}
          <div className="grid grid-cols-[1.1fr_0.95fr_0.35fr] border-y border-slate-200 bg-slate-50 px-6 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400 sm:px-8">
            <div>Description</div>
            <div>Billing period</div>
            <div className="text-right">Amount</div>
          </div>

          {/* Table row */}
          <div className="grid gap-5 px-6 py-6 sm:grid-cols-[1.1fr_0.95fr_0.35fr] sm:px-8 sm:items-center">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Star className="h-5 w-5" strokeWidth={2.1} />
              </div>
              <div>
                <p className="text-[17px] font-extrabold text-slate-950">
                  {planName}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {data.item?.subtitle ?? "Prepaid subscription · Monthly"}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[16px] font-bold text-slate-900">
                {periodLabel}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {periodSubLabel}
              </p>
            </div>

            <div className="text-right">
              <p className="text-[27px] font-extrabold tracking-[-0.03em] text-slate-950">
                {totalPaid}
              </p>
            </div>
          </div>

          {/* Coverage + totals */}
          <div className="grid gap-5 px-6 pb-6 sm:px-8 lg:grid-cols-[1.06fr_0.94fr]">
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
                    {formatDateInput(data.coverageStart)} → {formatDateInput(data.coverageEnd)}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2 text-sm leading-6 text-slate-500">
                <p>
                  This receipt confirms an approved TENH prepaid subscription payment.
                </p>
                <p>
                  TENH does not automatically renew or charge the next billing period
                  unless a future recurring-billing feature is enabled separately.
                </p>
              </div>
            </section>

            <section className="rounded-[20px] bg-[#031D4C] p-5 text-white shadow-[0_14px_35px_rgba(3,29,76,0.28)]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-white/80">Subtotal</span>
                <span className="text-base font-bold">{subtotal}</span>
              </div>

              <div className="my-4 border-t border-dashed border-white/20" />

              <div className="flex items-end justify-between gap-4">
                <span className="text-base text-white/85">Total Paid</span>
                <span className="text-[30px] font-extrabold tracking-[-0.035em]">
                  {totalPaid}
                </span>
              </div>

              <div className="my-4 border-t border-white/20" />

              <div className="flex items-center gap-3 text-sm text-emerald-200">
                <ShieldCheck className="h-5 w-5" strokeWidth={2.1} />
                <span>Payment verified and approved</span>
              </div>
            </section>
          </div>

          {/* Receipt actions */}
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

              {data.onDownloadPdf ? (
                <button
                  type="button"
                  onClick={data.onDownloadPdf}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                >
                  <Download className="h-4 w-4" strokeWidth={2.1} />
                  Download PDF
                </button>
              ) : (
                <Link
                  href={data.pdfHref || "#"}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50"
                >
                  <Download className="h-4 w-4" strokeWidth={2.1} />
                  Download PDF
                </Link>
              )}
            </div>
          </div>

          {/* Footer */}
          <footer className="border-t border-slate-200 px-6 py-4 text-center sm:px-8">
            <p className="text-sm font-medium text-slate-500">
              {data.footerMeta || `TENH Chat payment receipt · Reference ${reference}`}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {data.footerNote ||
                "This document is a payment receipt/invoice record. Tax/VAT invoice fields are not configured in this version."}
            </p>
          </footer>
        </div>
      </div>
    </section>
  );
}
