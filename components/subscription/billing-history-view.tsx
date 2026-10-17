"use client";

import Link from "next/link";
import { CustomerPaymentReference } from "./customer-payment-reference";
import { BadgeCheck, CalendarDays, CheckCircle2, Copy, CreditCard, Download, Eye, Hash, HelpCircle, ReceiptText, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import {
  type BillingHistoryItem,
  formatBillingDate,
  formatBillingMoney,
  paymentEnvironmentLabel,
  paymentMethodLabel,
  paymentStatusLabel,
  paymentVerificationLabel,
} from "@/lib/billing/payment-display";

type HistoryResponse = {
  success?: boolean;
  error?: string;
  items?: BillingHistoryItem[];
};

type FilterKey = "all" | "approved" | "attention";

function titleCase(value: string) {
  return value
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cycleLabel(value: string, isKhmer = false) {
  if (value === "monthly") return isKhmer ? "ប្រចាំខែ" : "Monthly";
  if (value === "3-months") return isKhmer ? "3 ខែ" : "3 months";
  if (value === "6-months") return isKhmer ? "6 ខែ" : "6 months";
  if (value === "12-months") return isKhmer ? "12 ខែ" : "12 months";
  return titleCase(value);
}

function planLabel(value: string, isKhmer = false) {
  if (!isKhmer) return titleCase(value);
  if (value.toLowerCase() === "custom") return "ផ្ទាល់ខ្លួន";
  if (value.toLowerCase() === "trial") return "សាកល្បងឥតគិតថ្លៃ";
  return titleCase(value);
}

function statusClasses(item: BillingHistoryItem) {
  switch (item.status) {
    case "test_paid":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "approved":
      if (item.environment === "sandbox") return "border-violet-200 bg-violet-50 text-violet-700";
      return item.confirmedPaid
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-amber-200 bg-amber-50 text-amber-700";
    case "pending":
    case "verified":
    case "recovery_required":
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
  return ["declined", "rejected", "failed", "recovery_required"].includes(item.status);
}

export function BillingHistoryView() {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);

  const [items, setItems] = useState<BillingHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"signin" | "forbidden" | "unavailable" | null>(null);
  const [retry, setRetry] = useState(0);
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
        if (!response.ok) {
          if (!cancelled) {
            setError(response.status === 401 ? "signin" : response.status === 403 ? "forbidden" : "unavailable");
          }
          return;
        }
        const result = (await response.json()) as HistoryResponse;

        if (!result.success) {
          if (!cancelled) setError("unavailable");
          return;
        }

        if (!cancelled) {
          setItems((result.items ?? []).filter(item => item.status !== "pending"));
        }
      } catch {
        if (!cancelled) setError("unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [retry]);

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
    { key: "all", label: t("All", "ទាំងអស់"), count: items.length },
    {
      key: "approved",
      label: t("Approved", "បានអនុម័ត"),
      count: items.filter((item) => item.status === "approved").length,
    },
    {
      key: "attention",
      label: t("Needs attention", "ត្រូវការការយកចិត្តទុកដាក់"),
      count: items.filter(isAttention).length,
    },
  ];

  const selectedHasReceipt = selected?.status === "approved" && Boolean(selected.invoiceId);
  const selectedReceiptStatus = selectedHasReceipt
    ? t("Receipt ready to view", "បង្កាន់ដៃរួចរាល់សម្រាប់មើល")
    : selected?.status === "approved"
      ? t("Receipt unavailable.", "មិនមានបង្កាន់ដៃទេ។")
      : selected?.status === "pending"
        ? t("Payment pending.", "ការទូទាត់កំពុងរង់ចាំ។")
        : selected ? paymentStatusLabel(selected, isKhmer) : "";
  const SelectedStatusIcon = selected?.confirmedPaid ? CheckCircle2 : HelpCircle;
  const SelectedVerificationIcon = selected?.provider === "payway" && selected.providerVerified ? ShieldCheck : CreditCard;

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
              {t("Back to subscription", "ត្រឡប់ទៅការជាវ")}
            </Link>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-blue-600">
              {t("Billing & payments", "ការទូទាត់ និងការបង់ប្រាក់")}
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              {t("Billing history", "ប្រវត្តិការទូទាត់")}
            </h1>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
            <p>{error === "signin"
              ? t("Sign in to view billing history.", "ចូលគណនីដើម្បីមើលប្រវត្តិការទូទាត់។")
              : error === "forbidden"
                ? t("Only the workspace owner can view billing history.", "មានតែម្ចាស់កន្លែងធ្វើការប៉ុណ្ណោះដែលអាចមើលប្រវត្តិការទូទាត់បាន។")
                : t("Unable to load billing history.", "មិនអាចផ្ទុកប្រវត្តិការទូទាត់បានទេ។")}</p>
            {error === "signin" ? (
              <Link href="/login" className="mt-3 inline-flex font-bold underline">{t("Sign in", "ចូលគណនី")}</Link>
            ) : error === "unavailable" ? (
              <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-3 font-bold underline">{t("Retry", "ព្យាយាមម្តងទៀត")}</button>
            ) : null}
          </div>
        ) : null}

        <section className="mt-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-950">{t("Payment activity", "សកម្មភាពការទូទាត់")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("Newest payments appear first.", "ការទូទាត់ថ្មីបំផុតបង្ហាញមុន។")}</p>
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
            <div className="p-10 text-center text-sm font-medium text-slate-500">{t("Loading billing history...", "កំពុងផ្ទុកប្រវត្តិការទូទាត់...")}</div>
          ) : error ? null : filteredItems.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl">$</div>
              <p className="mt-4 font-bold text-slate-900">{t("No payments in this view", "មិនមានការទូទាត់ក្នុងទិដ្ឋភាពនេះទេ")}</p>
              <p className="mt-1 text-sm text-slate-500">{t("Payment activity will appear here after checkout or manual submission.", "សកម្មភាពការទូទាត់នឹងបង្ហាញនៅទីនេះ បន្ទាប់ពីការទូទាត់ ឬការដាក់ស្នើដោយដៃ។")}</p>
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[1.15fr_0.9fr_0.85fr_0.75fr_0.75fr_auto] gap-4 border-b border-slate-100 bg-slate-50 px-6 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 lg:grid">
                <span>{t("Payment", "ការទូទាត់")}</span>
                <span>{t("Plan", "គម្រោង")}</span>
                <span>{t("Method", "វិធីបង់ប្រាក់")}</span>
                <span>{t("Amount", "ចំនួនទឹកប្រាក់")}</span>
                <span>{t("Status", "ស្ថានភាព")}</span>
                <span />
              </div>

              <div className="divide-y divide-slate-100">
                {filteredItems.map((item) => (
                  <article
                    key={item.id}
                    className="grid gap-4 px-5 py-5 transition hover:bg-slate-50 sm:px-6 lg:grid-cols-[1.15fr_0.9fr_0.85fr_0.75fr_0.75fr_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{formatBillingDate(item.createdAt, false, isKhmer)}</p>
                      <p className="mt-1 truncate text-xs font-medium text-slate-600">{item.workspaceName}</p>
                      <div className="mt-1 text-slate-500"><CustomerPaymentReference value={item.customerReference} /></div>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-800">{planLabel(item.planCode, isKhmer)}</p>
                      <p className="mt-1 text-xs text-slate-500">{cycleLabel(item.billingCycle, isKhmer)}</p>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-slate-700">{paymentMethodLabel(item.provider, isKhmer)}</p>
                      <p className="mt-1 text-xs text-slate-500">{paymentEnvironmentLabel(item.environment, isKhmer)}</p>
                    </div>

                    <div>
                      <p className="font-bold text-slate-950">{formatBillingMoney(item.amount, item.currency, isKhmer)}</p>
                    </div>

                    <div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusClasses(item)}`}>
                        {paymentStatusLabel(item, isKhmer)}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2 justify-self-start lg:justify-self-end">
                      {item.status === "approved" && item.invoiceId ? (
                        <Link
                          href={`/dashboard/subscription/invoices/${item.invoiceId}`}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          {t("Receipt", "បង្កាន់ដៃ")}
                        </Link>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => setSelected(item)}
                        className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                      >
                        {t("View details", "មើលព័ត៌មានលម្អិត")}
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
    className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-[2px] sm:p-4"
    onMouseDown={(event) => {
      if (event.currentTarget === event.target) setSelected(null);
    }}
  >
    <div role="dialog" aria-modal="true" aria-labelledby="payment-details-title" className="max-h-[92vh] w-full max-w-[920px] overflow-y-auto rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.26)]">
      <div className="flex items-start justify-between gap-5 border-b border-slate-200 px-5 py-5 sm:px-7">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-blue-600">
            {t("Payment details", "ព័ត៌មានលម្អិតការទូទាត់")}
          </p>
          <h2 id="payment-details-title" className="mt-2 text-[30px] font-extrabold tracking-[-0.04em] text-slate-950">
            {cycleLabel(selected.billingCycle, isKhmer)} {planLabel(selected.planCode, isKhmer)}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {t("Review payment information and receipt status for this subscription purchase.", "ពិនិត្យព័ត៌មានការទូទាត់ និងស្ថានភាពបង្កាន់ដៃសម្រាប់ការទិញការជាវនេះ។")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setSelected(null)}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label={t("Close payment details", "បិទព័ត៌មានលម្អិតការទូទាត់")}
        >
          <X className="h-5 w-5" strokeWidth={2.2} />
        </button>
      </div>

      <div className="space-y-5 px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_30%,#9eb4ff_0%,#728dff_44%,#5b7bf6_100%)] text-[40px] font-extrabold text-white shadow-[0_14px_32px_rgba(79,101,255,0.28)]">
              {(selected.planCode || "P").charAt(0).toUpperCase()}
            </div>

            <div className="min-w-0 pt-1">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
                {t("Billed to", "វិក្កយបត្រសម្រាប់")}
              </p>
              <h3 className="mt-2 break-words text-[30px] font-extrabold tracking-[-0.04em] text-slate-950">
                {selected.workspaceName}
              </h3>
              <p className="mt-1 break-words text-[15px] font-semibold text-slate-500">
                {selected.invoiceNumber ?? selected.transactionId ?? "—"}
              </p>
            </div>
          </div>

          <div className="flex w-full max-w-[210px] flex-col items-start gap-3 lg:items-end">
            <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-extrabold ${statusClasses(selected)}`}>
              <SelectedStatusIcon className="h-4 w-4" strokeWidth={2.2} />
              {paymentStatusLabel(selected, isKhmer)}
            </span>

            <div className="w-full text-left lg:text-right">
              <p className="text-xs font-semibold text-slate-500">
                {t("Receipt / Invoice", "បង្កាន់ដៃ / វិក្កយបត្រ")}
              </p>
              <div className="mt-1 flex items-center gap-2 lg:justify-end">
                <p className="text-[16px] font-extrabold tracking-[-0.03em] text-slate-950">
                  {selectedHasReceipt ? selected.invoiceNumber ?? "—" : "—"}
                </p>
                {selectedHasReceipt && selected.invoiceNumber ? <button
                  type="button"
                  onClick={() => {
                    if (selected.invoiceNumber) {
                      void navigator.clipboard?.writeText(selected.invoiceNumber);
                    }
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label={t("Copy receipt number", "ចម្លងលេខបង្កាន់ដៃ")}
                >
                  <Copy className="h-4 w-4" strokeWidth={2.1} />
                </button> : null}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[28px] bg-[linear-gradient(135deg,#042566_0%,#031A49_55%,#021133_100%)] p-5 text-white shadow-[0_20px_50px_rgba(3,29,76,0.28)]">
            <div className="grid gap-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-white/70">
                    {selected.confirmedPaid ? t("Total paid", "បានបង់សរុប") : t("Amount", "ចំនួនទឹកប្រាក់")}
                  </p>
                  <p className="mt-3 text-[56px] font-extrabold leading-none tracking-[-0.06em]">
                    {formatBillingMoney(selected.amount, selected.currency, isKhmer)}
                  </p>
                </div>

                <div className="rounded-2xl bg-white/10 px-4 py-3 text-sm">
                  <p className="text-white/70">{selected.confirmedPaid ? t("Payment completed", "ការទូទាត់បានបញ្ចប់") : selected.status === "pending" ? t("Submitted", "បានដាក់ស្នើ") : t("Reviewed", "បានពិនិត្យ")}</p>
                  <p className="mt-1 font-bold">
                    {formatBillingDate(selected.status === "pending" ? selected.createdAt : selected.status === "approved" ? selected.paidAt ?? selected.reviewedAt : selected.reviewedAt, true, isKhmer)}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 border-t border-white/15 pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
                <div className={`inline-flex items-center gap-3 ${selected.confirmedPaid ? "text-emerald-200" : "text-white/80"}`}>
                  <SelectedVerificationIcon className="h-5 w-5" strokeWidth={2.1} />
                  <span className="text-sm font-semibold">
                    {paymentVerificationLabel(selected, isKhmer)}
                  </span>
                </div>

                <div className="sm:text-right">
                  <p className="text-white/65">{t("Status", "ស្ថានភាព")}</p>
                  <span className={`mt-2 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold ${statusClasses(selected)}`}>
                    <SelectedStatusIcon className="h-4 w-4" strokeWidth={2.1} />
                    {paymentStatusLabel(selected, isKhmer)}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="flex items-center justify-center rounded-[28px] border border-slate-200 bg-slate-50/70 p-6">
            <div className="text-center">
              <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <ReceiptText className="h-14 w-14" strokeWidth={1.8} />
              </div>
              <p className="mt-4 text-sm font-semibold text-slate-500">
                {selectedReceiptStatus}
              </p>
            </div>
          </section>
        </div>

        <div className="grid gap-0 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm md:grid-cols-2">
          <PaymentMetaCell icon={<CreditCard className="h-5 w-5" strokeWidth={2.1} />} accent="blue" label={t("Payment method", "វិធីបង់ប្រាក់")} value={paymentMethodLabel(selected.provider, isKhmer)} />
          <PaymentMetaCell icon={<CalendarDays className="h-5 w-5" strokeWidth={2.1} />} accent="blue" label={t("Submitted", "បានដាក់ស្នើ")} value={formatBillingDate(selected.createdAt, true, isKhmer)} />
          <PaymentMetaCell icon={<Hash className="h-5 w-5" strokeWidth={2.1} />} accent="blue" label={t("Transaction ID", "លេខសម្គាល់ប្រតិបត្តិការ")} value={selected.transactionId ?? "—"} />
          <PaymentMetaCell icon={<Hash className="h-5 w-5" strokeWidth={2.1} />} accent="blue" label={t("Reference", "លេខយោង")} value={<CustomerPaymentReference value={selected.customerReference} />} />
          <PaymentMetaCell icon={<SelectedStatusIcon className="h-5 w-5" strokeWidth={2.1} />} accent={selected.confirmedPaid ? "emerald" : "blue"} label={selected.confirmedPaid ? t("Paid", "បានបង់ប្រាក់") : selected.status === "approved" ? t("Approved", "បានអនុម័ត") : t("Reviewed", "បានពិនិត្យ")} value={formatBillingDate(selected.status === "approved" ? selected.paidAt ?? selected.reviewedAt : selected.reviewedAt, true, isKhmer)} />
          <PaymentMetaCell icon={<CreditCard className="h-5 w-5" strokeWidth={2.1} />} accent="blue" label={t("Provider status", "ស្ថានភាពអ្នកផ្តល់សេវា")} value={selected.providerStatus ?? "—"} />
          <PaymentMetaCell icon={<BadgeCheck className="h-5 w-5" strokeWidth={2.1} />} accent="blue" label={t("Approval code", "លេខកូដអនុម័ត")} value={selected.approvalCode ?? "—"} />
          <PaymentMetaCell icon={<CreditCard className="h-5 w-5" strokeWidth={2.1} />} accent="blue" label={t("Environment", "បរិស្ថាន")} value={paymentEnvironmentLabel(selected.environment, isKhmer)} />
          <PaymentMetaCell icon={<SelectedVerificationIcon className="h-5 w-5" strokeWidth={2.1} />} accent={selected.confirmedPaid ? "emerald" : "blue"} label={t("Verification", "ការផ្ទៀងផ្ទាត់")} value={paymentVerificationLabel(selected, isKhmer)} />
        </div>

        <div className={`rounded-[24px] border p-5 ${selected.confirmedPaid ? "border-emerald-200 bg-[linear-gradient(180deg,#F5FCF8_0%,#F8FCFA_100%)]" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${selected.confirmedPaid ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-blue-600"}`}>
                <CalendarDays className="h-5 w-5" strokeWidth={2.1} />
              </div>
              <div>
                <p className={`text-[11px] font-extrabold uppercase tracking-[0.16em] ${selected.confirmedPaid ? "text-emerald-700" : "text-slate-500"}`}>
                  {t("Billing period", "រយៈពេលការទូទាត់")}
                </p>
                <p className="mt-2 text-[18px] font-extrabold tracking-[-0.03em] text-slate-950">
                  {formatBillingDate(selected.periodStart, false, isKhmer)} → {formatBillingDate(selected.periodEnd, false, isKhmer)}
                </p>
                <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ${selected.confirmedPaid ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {selected.periodStart && selected.periodEnd
                    ? `${Math.max(1, Math.round((new Date(selected.periodEnd).getTime() - new Date(selected.periodStart).getTime()) / 86400000))} ${t("days", "ថ្ងៃ")}`
                    : t("Period not recorded", "មិនបានកត់ត្រារយៈពេល")}
                </div>

                <div className="mt-5 border-t border-dashed border-emerald-200 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {t("Reference", "លេខយោង")}
                  </p>
                  <p className="mt-1 text-[15px] font-bold text-slate-900">
                    {selected.invoiceNumber ?? selected.transactionId ?? "—"}
                  </p>
                </div>
              </div>
            </div>

            {selectedHasReceipt ? (
              <Link
                href={`/dashboard/subscription/invoices/${selected.invoiceId}`}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-white px-5 py-3 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-50"
              >
                <Eye className="h-4 w-4" strokeWidth={2.1} />
                {t("View receipt", "មើលបង្កាន់ដៃ")}
              </Link>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <ReceiptText className="h-4 w-4" strokeWidth={2.1} />
                {selectedReceiptStatus}
              </div>
            )}
          </div>
        </div>

        <div className={`grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50/70 p-5 ${selectedHasReceipt ? "md:grid-cols-2" : ""}`}>
          {selectedHasReceipt ? <Link
            href={`/dashboard/subscription/invoices/${selected.invoiceId}?autoprint=1&return_to=%2Fdashboard%2Fsubscription%2Fbilling-history`}
            className="flex items-center gap-4 rounded-[20px] border border-blue-200 bg-white px-5 py-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blue-200 bg-white text-blue-600">
              <Download className="h-5 w-5" strokeWidth={2.1} />
            </div>
            <div>
              <p className="text-base font-bold text-slate-900">
                {t("Print / Save PDF", "បោះពុម្ព / រក្សាទុក PDF")}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {t("Save a copy for your records", "រក្សាទុកច្បាប់ចម្លងសម្រាប់កំណត់ត្រារបស់អ្នក")}
              </p>
            </div>
          </Link> : null}

          <a
            href="https://t.me/tenhchat_support_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 rounded-[20px] border border-slate-200 bg-white px-5 py-4 transition hover:border-violet-200 hover:bg-violet-50/40"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-violet-200 bg-white text-violet-600">
              <HelpCircle className="h-5 w-5" strokeWidth={2.1} />
            </div>
            <div>
              <p className="text-base font-bold text-slate-900">
                {t("Need help?", "ត្រូវការជំនួយ?")}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {t("Contact TENH Chat support", "ទាក់ទងក្រុមជំនួយ TENH Chat")}
              </p>
            </div>
          </a>
        </div>

        {selected.reviewNote ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-700">
              {t("TENH review note", "កំណត់ចំណាំពិនិត្យរបស់ TENH")}
            </p>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              {selected.reviewNote}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  </div>
) : null}
    </div>
  );
}

function PaymentMetaCell({
  icon,
  accent,
  label,
  value,
}: {
  icon: React.ReactNode;
  accent: "blue" | "emerald";
  label: string;
  value: React.ReactNode;
}) {
  const accentClasses =
    accent === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : "bg-blue-50 text-blue-600";

  return (
    <div className="flex items-center gap-4 border-b border-slate-200 px-5 py-5 last:border-b-0 md:[&:nth-last-child(-n+2)]:border-b-0 md:[&:nth-child(odd)]:border-r">
      <div
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${accentClasses}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
          {label}
        </p>
        <p className="mt-2 break-all text-[15px] font-extrabold text-slate-950">
          {value}
        </p>
      </div>
    </div>
  );
}
