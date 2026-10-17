"use client";

import Image from "next/image";
import Link from "next/link";
import { CustomerPaymentReference } from "./customer-payment-reference";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import {
  type InvoiceRecord,
  formatBillingDate,
  formatBillingMoney,
  paymentEnvironmentLabel,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentVerificationLabel,
} from "@/lib/billing/payment-display";
import {
  CalendarDays,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Hash,
  HelpCircle,
  ReceiptText,
  ShieldCheck,
  Star,
} from "lucide-react";

type InvoiceResponse = {
  success?: boolean;
  invoice?: InvoiceRecord;
};

async function waitForReceiptLayout(receipt: HTMLElement) {
  await document.fonts?.ready;
  await Promise.all(
    Array.from(receipt.querySelectorAll("img")).map((image) => {
      if (image.complete) return image.decode?.().catch(() => {});
      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      }).then(() => image.decode?.().catch(() => {}));
    }),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
  const isKhmer = useWorkspaceLanguageId() === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);
  const [loaded, setLoaded] = useState<{ requestedId: string; invoice: InvoiceRecord } | null>(null);
  const invoice = loaded?.requestedId === invoiceId ? loaded.invoice : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"signin" | "forbidden" | "missing" | "temporary" | null>(null);
  const [retry, setRetry] = useState(0);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState(false);
  const receiptRef = useRef<HTMLElement>(null);
  const printedInvoices = useRef(new Set<string>());
  const printingRef = useRef(false);
  const printCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInvoice() {
      setLoading(true);
      setLoaded(null);
      setError(null);
      setPrintError(false);
      printCleanup.current?.();
      printingRef.current = false;
      setPrinting(false);

      try {
        const response = await fetch(
          `/api/subscription/invoices/${encodeURIComponent(invoiceId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          if (!controller.signal.aborted) {
            setError(response.status === 401 ? "signin" : response.status === 403 ? "forbidden" : response.status === 400 || response.status === 404 ? "missing" : "temporary");
          }
          return;
        }

        const result = (await response.json()) as InvoiceResponse;
        if (!result.success || !result.invoice || result.invoice.id.toLowerCase() !== invoiceId.trim().toLowerCase()) {
          throw new Error("Invalid receipt response");
        }

        if (!controller.signal.aborted) {
          setLoaded({ requestedId: invoiceId, invoice: result.invoice });
        }
      } catch {
        if (!controller.signal.aborted) {
          setError("temporary");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadInvoice();

    return () => {
      controller.abort();
      printCleanup.current?.();
    };
  }, [invoiceId, retry]);

  const openPrintDialog = useCallback((returnAfterPrint: boolean) => {
    const finish = () => {
      printingRef.current = false;
      setPrinting(false);
      printCleanup.current?.();
    };
    const afterPrint = () => {
      finish();
      if (returnAfterPrint && receiptRef.current?.dataset.invoiceId === invoiceId) {
        const destination = new URL(returnTo.startsWith("/dashboard/") ? returnTo : "/dashboard/subscription", window.location.origin);
        window.location.replace(destination.origin === window.location.origin && destination.pathname.startsWith("/dashboard/") ? `${destination.pathname}${destination.search}` : "/dashboard/subscription");
      }
    };
    try {
      if (typeof window.print !== "function") throw new Error("Printing unavailable");
      window.addEventListener("afterprint", afterPrint, { once: true });
      printCleanup.current = () => window.removeEventListener("afterprint", afterPrint);
      window.print();
    } catch {
      finish();
      setPrintError(true);
    }
  }, [invoiceId, returnTo]);

  useEffect(() => {
    if (!autoPrint || !invoice || !receiptRef.current) return;
    let cancelled = false;
    const receipt = receiptRef.current;
    void waitForReceiptLayout(receipt).then(() => {
      if (cancelled || !receipt.isConnected || receipt.dataset.invoiceId !== invoiceId || printedInvoices.current.has(invoice.id) || printingRef.current) return;
      printedInvoices.current.add(invoice.id);
      printingRef.current = true;
      setPrinting(true);
      openPrintDialog(true);
    }).catch(() => {
      if (!cancelled) setPrintError(true);
    });
    return () => { cancelled = true; };
  }, [autoPrint, invoice, invoiceId, openPrintDialog]);

  async function printReceipt() {
    if (!invoice || !receiptRef.current || printingRef.current) return;
    const receipt = receiptRef.current;
    printedInvoices.current.add(invoice.id);
    printingRef.current = true;
    setPrinting(true);
    setPrintError(false);
    try {
      await waitForReceiptLayout(receipt);
      if (!receipt.isConnected || receipt.dataset.invoiceId !== invoiceId) return;
      openPrintDialog(false);
    } catch {
      printingRef.current = false;
      setPrinting(false);
      setPrintError(true);
    }
  }

  const printStyles = <style jsx global>{`
    @media print {
      body > :not(:has(.tenh-receipt-card)),
      body *:has(.tenh-receipt-card) > :not(:has(.tenh-receipt-card)):not(.tenh-receipt-card) {
        display: none !important;
      }
      html, body { background: white !important; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body *:has(.tenh-receipt-card) {
        display: block !important;
        position: static !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .tenh-receipt-toolbar, .tenh-receipt-card button { display: none !important; }
      .tenh-receipt-card { overflow: visible !important; box-shadow: none !important; border: 0 !important; border-radius: 0 !important; }
      .tenh-receipt-card header, .tenh-receipt-card section, .tenh-receipt-card footer, .tenh-receipt-test { break-inside: avoid; }
      .tenh-receipt-card h1, .tenh-receipt-card h2 { break-after: avoid; }
      .tenh-receipt-card p { orphans: 3; widows: 3; }
    }
  `}</style>;

  if (loading || (!invoice && !error)) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-100 p-6">
        {printStyles}
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm font-semibold text-slate-500 shadow-sm">
          {t("Loading receipt…", "កំពុងផ្ទុកបង្កាន់ដៃ…")}
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-full bg-slate-100 px-5 py-8">
        {printStyles}
        <div className="mx-auto max-w-2xl rounded-[28px] border border-red-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">
            {t("TENH Receipt", "បង្កាន់ដៃ TENH")}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">
            {t("Unable to open receipt", "មិនអាចបើកបង្កាន់ដៃបានទេ")}
          </h1>
          <p className="mt-3 text-sm leading-6 text-red-700">
            {error === "signin" ? t("Sign in to view this receipt.", "ចូលគណនីដើម្បីមើលបង្កាន់ដៃនេះ។") : error === "forbidden" ? t("Only the workspace owner can view this receipt.", "មានតែម្ចាស់កន្លែងធ្វើការប៉ុណ្ណោះដែលអាចមើលបង្កាន់ដៃនេះបាន។") : error === "temporary" ? t("Receipts are temporarily unavailable. Please try again.", "បង្កាន់ដៃមិនអាចប្រើបានជាបណ្តោះអាសន្ន។ សូមព្យាយាមម្តងទៀត។") : t("This receipt is unavailable.", "មិនមានបង្កាន់ដៃនេះទេ។")}
          </p>
          {error === "signin" ? <Link href="/login" className="mt-4 inline-flex text-sm font-bold text-blue-700 underline">{t("Sign in", "ចូលគណនី")}</Link> : error === "temporary" ? <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-4 text-sm font-bold text-blue-700 underline">{t("Retry", "ព្យាយាមម្តងទៀត")}</button> : null}
          <Link
            href="/dashboard/subscription/billing-history"
            className="mt-6 inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            {t("Back to billing history", "ត្រឡប់ទៅប្រវត្តិការទូទាត់")}
          </Link>
        </div>
      </div>
    );
  }

  const StatusIcon = invoice.confirmedPaid ? CheckCircle2 : HelpCircle;
  const VerificationIcon = invoice.provider === "payway" && invoice.providerVerified ? ShieldCheck : CreditCard;
  const formatDate = (value: string | null, withTime = false) => formatBillingDate(value, withTime, isKhmer);
  const amount = formatBillingMoney(invoice.amount, invoice.currency, isKhmer);
  const savedPlanName = invoice.planName?.trim() || "—";
  const planName = savedPlanName.toLowerCase() === "custom" ? t("Custom", "ផ្ទាល់ខ្លួន") : savedPlanName.toLowerCase() === "trial" ? t("Trial", "សាកល្បងឥតគិតថ្លៃ") : savedPlanName;
  const cycle = invoice.billingCycle === "monthly" ? t("Monthly", "ប្រចាំខែ") : invoice.billingCycle === "3-months" ? t("3 months", "3 ខែ") : invoice.billingCycle === "6-months" ? t("6 months", "6 ខែ") : invoice.billingCycle === "12-months" ? t("12 months", "12 ខែ") : invoice.billingCycleLabel;

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-y-contain bg-slate-50 px-3 py-4 sm:px-5 lg:px-6 print:h-auto print:overflow-visible print:bg-white print:p-0">
      {printStyles}

      <div className="mx-auto w-full max-w-[1120px]">
        <div className="tenh-receipt-toolbar mb-3 flex items-center justify-between gap-3 print:hidden">
          <Link
            href="/dashboard/subscription/billing-history"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 transition hover:text-blue-700"
          >
            <span aria-hidden="true">←</span>
            {t("Back to billing history", "ត្រឡប់ទៅប្រវត្តិការទូទាត់")}
          </Link>
        </div>

        {printError ? <p role="status" className="tenh-receipt-toolbar mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t("Printing could not open. Use your browser menu: Print → Save as PDF.", "មិនអាចបើកការបោះពុម្ពបានទេ។ ប្រើម៉ឺនុយកម្មវិធីរុករក៖ បោះពុម្ព → រក្សាទុកជា PDF។")}</p> : null}

        <article ref={receiptRef} data-invoice-id={invoiceId} lang={isKhmer ? "km" : "en"} className="tenh-receipt-card overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_16px_45px_rgba(15,23,42,0.08)]">
          {invoice.environment === "sandbox" ? (
            <div className="tenh-receipt-test border-b-2 border-amber-400 bg-amber-50 px-6 py-4 text-amber-950 sm:px-8">
              <p className="text-lg font-extrabold">{t("Test payment", "ការទូទាត់សាកល្បង")}</p>
              <p className="mt-1 text-sm">{t("Sandbox transaction only. This receipt does not confirm a real-money payment.", "នេះជាប្រតិបត្តិការសាកល្បងប៉ុណ្ណោះ។ បង្កាន់ដៃនេះមិនបញ្ជាក់ការទូទាត់ប្រាក់ពិតប្រាកដទេ។")}</p>
            </div>
          ) : invoice.environment === "unknown" ? (
            <div className="tenh-receipt-test border-b border-amber-200 bg-amber-50 px-6 py-4 text-sm text-amber-950 sm:px-8">
              <p className="font-bold">{paymentEnvironmentLabel(invoice.environment, isKhmer)}</p>
              <p className="mt-1">{t("Payment-provider verification and real settlement are not confirmed by this record.", "កំណត់ត្រានេះមិនបញ្ជាក់ការផ្ទៀងផ្ទាត់ពីអ្នកផ្តល់សេវាទូទាត់ ឬការទូទាត់ប្រាក់ពិតប្រាកដទេ។")}</p>
            </div>
          ) : null}
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
                    {t("TENH Receipt", "បង្កាន់ដៃ TENH")}
                  </h1>
                  <p className="mt-1 text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
                    {t("Subscription receipt", "បង្កាន់ដៃការជាវ")}
                  </p>

                  <div className="mt-3 inline-flex items-center gap-2 text-sm text-slate-500">
                    <StatusIcon
                      className="h-4 w-4 text-blue-600"
                      strokeWidth={2.2}
                    />
                    <span>{paymentEnvironmentLabel(invoice.environment, isKhmer)}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-start gap-3 sm:items-end">
                <span className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-extrabold uppercase tracking-[0.08em] ring-1 ring-inset ${invoice.confirmedPaid ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
                  <StatusIcon className="h-4 w-4" strokeWidth={2.2} />
                  {paymentStatusLabel(invoice, isKhmer)}
                </span>

                <div className="sm:text-right">
                  <p className="text-xs font-semibold text-slate-500">
                    {t("Receipt number", "លេខបង្កាន់ដៃ")}
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
                        ).catch(() => {});
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 print:hidden"
                      aria-label={t("Copy receipt number", "ចម្លងលេខបង្កាន់ដៃ")}
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
                {t("Billed to", "ចេញវិក្កយបត្រជូន")}
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
                    {invoice.billingEmail ?? t("Billing email not recorded", "មិនបានកត់ត្រាអ៊ីមែលសម្រាប់ការទូទាត់")}
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
                  label={t("Issued", "កាលបរិច្ឆេទចេញ")}
                  value={formatDate(invoice.issuedAt)}
                />

                <InvoiceMetaRow
                  icon={
                    <CheckCircle2
                      className="h-4 w-4 text-blue-600"
                      strokeWidth={2.1}
                    />
                  }
                  label={invoice.environment === "sandbox" ? t("Test payment date", "កាលបរិច្ឆេទទូទាត់សាកល្បង") : invoice.confirmedPaid ? t("Paid", "បានបង់") : t("Recorded payment date", "កាលបរិច្ឆេទទូទាត់ដែលបានកត់ត្រា")}
                  value={formatDate(invoice.paidAt, true)}
                />

                <InvoiceMetaRow
                  icon={
                    <CreditCard
                      className="h-4 w-4 text-blue-600"
                      strokeWidth={2.1}
                    />
                  }
                  label={t("Payment method", "វិធីបង់ប្រាក់")}
                  value={paymentMethodLabel(invoice.provider, isKhmer)}
                />

                <InvoiceMetaRow
                  icon={
                    <Hash
                      className="h-4 w-4 text-blue-600"
                      strokeWidth={2.1}
                    />
                  }
                  label={t("Transaction ID", "លេខសម្គាល់ប្រតិបត្តិការ")}
                  value={invoice.transactionId ?? t("Not recorded", "មិនបានកត់ត្រា")}
                  breakValue
                />
                <InvoiceMetaRow icon={<Hash className="h-4 w-4 text-blue-600" />} label={t("Payment reference", "លេខយោងការទូទាត់")} value={<CustomerPaymentReference value={invoice.customerReference} />} />

                {invoice.approvalCode ? (
                  <InvoiceMetaRow
                    icon={
                      <ShieldCheck
                        className="h-4 w-4 text-blue-600"
                        strokeWidth={2.1}
                      />
                    }
                    label={t("Approval code", "លេខកូដអនុម័ត")}
                    value={invoice.approvalCode}
                  />
                ) : null}
              </div>
            </section>
          </div>

          {/* Table headings */}
          <div className="hidden grid-cols-[1.1fr_0.95fr_0.35fr] border-y border-slate-200 bg-slate-50 px-6 py-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-400 sm:grid sm:px-8">
            <div>{t("Description", "ការពិពណ៌នា")}</div>
            <div>{t("Billing period", "រយៈពេលការទូទាត់")}</div>
            <div className="text-right">{t("Amount", "ចំនួនទឹកប្រាក់")}</div>
          </div>

          {/* Plan line */}
          <div className="grid gap-5 border-y border-slate-200 px-6 py-6 sm:grid-cols-[1.1fr_0.95fr_0.35fr] sm:items-center sm:border-t-0 sm:px-8">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                <Star className="h-5 w-5" strokeWidth={2.1} />
              </div>

              <div>
                <p className="text-[17px] font-extrabold text-slate-950">
                  TENH Chat {planName}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {t("Prepaid subscription", "ការជាវបង់ប្រាក់ជាមុន")} · {cycle}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-400 sm:hidden">
                {t("Billing period", "រយៈពេលការទូទាត់")}
              </p>
              <p className="mt-1 text-[16px] font-bold text-slate-900 sm:mt-0">
                {formatDate(invoice.periodStart)} →{" "}
                {formatDate(invoice.periodEnd)}
              </p>
            </div>

            <div className="sm:text-right">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-400 sm:hidden">
                {t("Amount", "ចំនួនទឹកប្រាក់")}
              </p>
              <p className="mt-1 text-[27px] font-extrabold tracking-[-0.03em] text-slate-950 sm:mt-0">
                {amount}
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
                    {t("Subscription coverage", "រយៈពេលគ្របដណ្តប់ការជាវ")}
                  </p>
                  <p className="mt-2 text-[18px] font-extrabold text-slate-950">
                    {formatDate(invoice.periodStart)} →{" "}
                    {formatDate(invoice.periodEnd)}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-2 text-sm leading-6 text-slate-500">
                <p>
                  {paymentVerificationLabel(invoice, isKhmer)}
                </p>
                <p>
                  {t("This receipt records the saved subscription and billing period shown above.", "បង្កាន់ដៃនេះបង្ហាញការជាវ និងរយៈពេលការទូទាត់ដែលបានរក្សាទុកខាងលើ។")}
                </p>
              </div>
            </section>

            <section className="rounded-[20px] bg-[#031D4C] p-5 text-white shadow-[0_14px_35px_rgba(3,29,76,0.28)]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-white/80">{t("Subtotal", "សរុបរង")}</span>
                <span className="text-base font-bold">
                  {amount}
                </span>
              </div>

              <div className="my-4 border-t border-dashed border-white/20" />

              <div className="flex items-end justify-between gap-4">
                <span className="text-base text-white/85">{invoice.environment === "sandbox" ? t("Test amount", "ចំនួនទឹកប្រាក់សាកល្បង") : invoice.confirmedPaid ? t("Total paid", "សរុបបានបង់") : t("Recorded amount", "ចំនួនទឹកប្រាក់ដែលបានកត់ត្រា")}</span>
                <span className="text-[30px] font-extrabold tracking-[-0.035em]">
                  {amount}
                </span>
              </div>

              <div className="my-4 border-t border-white/20" />

              <div className="flex items-center gap-3 text-sm text-white/85">
                <VerificationIcon className="h-5 w-5 shrink-0" strokeWidth={2.1} />
                <span>{paymentVerificationLabel(invoice, isKhmer)}</span>
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
                    {t("Keep this receipt for your records.", "រក្សាបង្កាន់ដៃនេះសម្រាប់កំណត់ត្រារបស់អ្នក។")}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("For questions, contact TENH Chat support.", "សម្រាប់សំណួរ សូមទាក់ទងក្រុមជំនួយ TENH Chat។")}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void printReceipt()}
                disabled={printing}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60 print:hidden"
              >
                <Download className="h-4 w-4" strokeWidth={2.1} />
                {t("Print / Save PDF", "បោះពុម្ព / រក្សាទុក PDF")}
              </button>
            </div>
          </div>

          {/* Footer */}
          <footer className="border-t border-slate-200 px-6 py-4 text-center sm:px-8">
            <p className="text-sm font-medium text-slate-500">
              {t("TENH Receipt · Reference", "បង្កាន់ដៃ TENH · លេខយោង")} {invoice.invoiceNumber}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t("This is a subscription receipt, not a tax/VAT invoice.", "នេះជាបង្កាន់ដៃការជាវ មិនមែនជាវិក្កយបត្រពន្ធ/អាករលើតម្លៃបន្ថែមទេ។")}
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
  value: React.ReactNode;
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
