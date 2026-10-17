"use client";

import { CircleCheck } from "lucide-react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { formatBillingMoney, paymentMethodLabel, type PaymentEnvironment } from "@/lib/billing/payment-display";
import { getBillingCycleDefinition, getPlanDefinition } from "@/lib/subscription/plan-catalog";
import { CustomerPaymentReference } from "./customer-payment-reference";

type Props = {
  workspace: string; planCode: string; billingCycle: string; amount: number | null; currency: string | null;
  provider: "manual" | "payway" | "bakong"; environment: PaymentEnvironment;
  reference: string | null; receiptHref: string | null; busy: boolean; error: boolean;
  onNavigate: (destination: "/dashboard/inbox" | "/dashboard/subscription") => void;
};

// Callers must confirm the saved payment and its current application before showing this card.
export function PaymentSuccessCard(props: Props) {
  const khmer = useWorkspaceLanguageId() === "km";
  const t = (en: string, km: string) => khmer ? km : en;
  const test = props.environment === "sandbox";
  const cycle = getBillingCycleDefinition(props.billingCycle);
  const period = cycle ? khmer ? cycle.months === 12 ? "1 ឆ្នាំ" : `${cycle.months} ខែ` : cycle.label : props.billingCycle;
  const control = "inline-flex min-h-11 w-full items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50";
  return <section className="flex min-h-full w-full items-center justify-center bg-slate-50 px-4 py-8 sm:px-6 sm:py-12" aria-busy={props.busy}>
    <div className="w-full min-w-0 max-w-lg rounded-2xl border border-slate-200 bg-white px-5 py-8 shadow-sm sm:p-10">
      <div className="mb-8 flex items-center justify-center gap-2 text-sm font-bold tracking-wide text-slate-800">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/tenh_logo.png" width={32} height={32} alt="" className="h-8 w-8 object-contain" />TENH CHAT
      </div>
      <div className="text-center" role="status" aria-live="polite">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${test ? "bg-violet-50 text-violet-600" : "bg-emerald-50 text-emerald-600"}`}><CircleCheck aria-hidden="true" className="h-9 w-9" strokeWidth={1.8} /></div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{test ? t("Test payment confirmed", "បានបញ្ជាក់ការទូទាត់សាកល្បង") : t("Payment successful", "ការទូទាត់ជោគជ័យ")}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{test ? t("No real-money settlement.", "មិនមែនការទូទាត់ប្រាក់ពិត។") : t("Your subscription is active.", "ការជាវរបស់អ្នកសកម្មហើយ។")}</p>
        <p className="mt-2 break-words text-sm font-medium text-slate-700">{props.workspace}</p>
      </div>
      <dl className="mt-7 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/60 px-4">
        {[
          [t("Plan", "គម្រោង"), getPlanDefinition(props.planCode)?.name ?? props.planCode],
          [t("Billing period", "រយៈពេលជាវ"), period],
          [test ? t("Test amount", "ចំនួនប្រាក់សាកល្បង") : t("Amount paid", "ចំនួនប្រាក់បានបង់"), formatBillingMoney(props.amount, props.currency, khmer)],
          [t("Payment method", "វិធីទូទាត់"), paymentMethodLabel(props.provider, khmer)],
        ].map(([label, value]) => <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm"><dt className="text-slate-500">{label}</dt><dd className="min-w-0 break-words font-semibold text-slate-900">{value}</dd></div>)}
      </dl>
      {test ? <p className="mt-3 text-center text-xs font-medium text-violet-700">{t("Test payment", "ការទូទាត់សាកល្បង")}</p> : null}
      <div className="mt-3 text-center text-xs text-slate-500">{t("Reference", "លេខយោង")}: <CustomerPaymentReference value={props.reference} /></div>
      <div className="mt-7 space-y-3">
        <button type="button" className={`${control} bg-blue-600 text-white hover:bg-blue-700`} disabled={props.busy} onClick={() => props.onNavigate("/dashboard/inbox")}>{t("Go to inbox", "ទៅប្រអប់សារ")}</button>
        {props.receiptHref ? <a className={`${control} border border-slate-200 text-slate-700 hover:bg-slate-50`} href={props.receiptHref}>{t("View receipt", "មើលបង្កាន់ដៃ")}</a> : <p className="text-center text-xs text-slate-500">{t("Receipt unavailable.", "មិនមានបង្កាន់ដៃ។")}</p>}
        {props.error ? <p role="alert" className="text-center text-sm text-red-700">{t("Unable to open workspace. Try again.", "មិនអាចបើកកន្លែងធ្វើការ។ សូមព្យាយាមម្ដងទៀត។")}</p> : null}
      </div>
      <div className="mt-5 text-center"><button type="button" disabled={props.busy} className="min-h-11 max-w-full rounded px-2 text-sm text-slate-500 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50" onClick={() => props.onNavigate("/dashboard/subscription")}>{t("Back to subscription", "ត្រឡប់ទៅការជាវ")}</button></div>
    </div>
  </section>;
}
