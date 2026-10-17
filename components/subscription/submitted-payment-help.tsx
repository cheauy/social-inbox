"use client";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

export function SubmittedPaymentHelp() {
  const km = useWorkspaceLanguageId() === "km";
  const t = (en: string, kh: string) => km ? kh : en;
  return <section className="mt-5 border-t border-slate-100 pt-5">
    <h2 className="text-base font-bold text-slate-950">{t("Need help?", "ត្រូវការជំនួយ?")}</h2>
    <p className="mt-2 text-sm leading-6 text-slate-500">{t("Copy your payment reference and send it with your receipt to the admin.", "ចម្លងលេខយោងការទូទាត់ រួចផ្ញើជាមួយបង្កាន់ដៃទៅ Admin")}</p>
    <a href="https://t.me/tenhchat_support_bot" target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-600">{t("Contact admin", "ទាក់ទងអ្នកគ្រប់គ្រង")}</a>
  </section>;
}
