"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { customerPaymentReference } from "@/lib/billing/payment-display";

export function CustomerPaymentReference({ value }: { value?: string | null }) {
  const km = useWorkspaceLanguageId() === "km";
  const reference = customerPaymentReference(value);
  const [status, setStatus] = useState<"copied" | "failed" | null>(null);
  async function copy() {
    if (!reference) return;
    try { await navigator.clipboard.writeText(reference); setStatus("copied"); }
    catch { setStatus("failed"); }
  }
  return <span className="inline-flex max-w-full flex-wrap items-center gap-x-1 text-sm">
    <span data-payment-reference className="whitespace-nowrap font-mono font-semibold select-all">{reference ?? (km ? "មិនមាន" : "Unavailable")}</span>
    {reference ? <button type="button" onClick={() => void copy()} className="inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 print:hidden" aria-label={km ? "ចម្លងលេខយោង" : "Copy reference"}><Copy className="h-4 w-4" aria-hidden="true" /></button> : null}
    {status ? <span role="status" className="w-full text-xs text-slate-500 print:hidden">{status === "copied" ? (km ? "បានចម្លងលេខយោង។" : "Reference copied.") : (km ? "មិនអាចចម្លងបាន។ សូមជ្រើសលេខយោង ហើយចម្លង។" : "Unable to copy. Select the reference and copy it.")}</span> : null}
  </span>;
}
