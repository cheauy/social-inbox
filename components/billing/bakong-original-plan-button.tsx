"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { PAYMENT_CANCELLATION_ENABLED } from "@/lib/billing/payment-cancellation-feature";

type OriginalPayment = { id: string; workspaceName: string; amount: string; currency: string; transactionReference: string | null;
  planCode?: string | null; billingCycle?: string | null; canApplyOriginal?: boolean; resolutionConflict?: string | null };
export function BakongOriginalPlanButton({ payment, onApplied }: { payment: OriginalPayment; onApplied: () => void }) {
  const km = useWorkspaceLanguageId() === "km", t = (en: string, kh: string) => km ? kh : en;
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null), active = useRef<AbortController | null>(null), reasonId = useId();
  const request = useRef<{ hash: string; reason: string; id: string } | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  function conflictMessage(code?: string | null) {
    if (code === "OVERLAPPING_PURCHASE") return t("Another purchase overlaps this payment, including a later closed checkout. Keep this case in manual review.", "មានការទិញផ្សេងទៀតជាន់គ្នា រួមទាំងផ្ទាំងទូទាត់ដែលបានបិទ។ សូមរក្សាទុកសម្រាប់ពិនិត្យដោយដៃ។");
    if (code === "SUBSCRIPTION_BASELINE_CHANGED") return t("The subscription changed after this purchase. Applying the old plan is blocked.", "ការជាវបានផ្លាស់ប្ដូរក្រោយការទិញនេះ។ មិនអាចអនុម័តគម្រោងចាស់បានទេ។");
    if (code === "PURCHASER_MEMBERSHIP_REMOVED" || code === "PURCHASER_PERMISSION_CHANGED") return t("The purchaser no longer has the required workspace access. Keep this case in review.", "អ្នកទិញលែងមានសិទ្ធិចាំបាច់ក្នុងកន្លែងការងារ។ សូមរក្សាទុកសម្រាប់ពិនិត្យ។");
    if (code === "ALREADY_APPLIED") return t("This purchase was already applied. Refresh its saved status.", "ការទិញនេះត្រូវបានអនុម័តរួចហើយ។ សូមផ្ទុកស្ថានភាពឡើងវិញ។");
    if (code === "ORIGINAL_PLAN_APPLICATION_FAILED") return t("Application failed and its plan/invoice changes were rolled back. Review the case before trying again.", "ការអនុម័តបរាជ័យ ហើយការផ្លាស់ប្ដូរគម្រោងត្រូវបានស្ដារវិញ។ សូមពិនិត្យមុនព្យាយាមម្ដងទៀត។");
    return t("The original plan cannot be safely applied. Keep the payment in manual review.", "មិនអាចអនុម័តគម្រោងដើមដោយសុវត្ថិភាពបានទេ។ សូមរក្សាការទូទាត់សម្រាប់ពិនិត្យដោយដៃ។");
  }
  async function apply() {
    const hash = payment.transactionReference, note = reason.trim();
    if (!payment.canApplyOriginal || !hash || active.current || note.length < 10 || note.length > 500) return;
    if (!request.current || request.current.hash !== hash || request.current.reason !== note) request.current = { hash, reason: note, id: crypto.randomUUID() };
    const controller = new AbortController(); active.current = controller; setPending(true); setError(null);
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    try {
      const response = await fetch("/api/bakong/admin", { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: payment.id, action: "apply_original_plan", requestId: request.current.id,
          reason: note, expectedTransactionReference: hash, confirmed: true }) });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !result.success || result.outcome !== "applied") {
        if (result.code === "RESOLUTION_UNCERTAIN") throw new Error();
        setError(conflictMessage(result.code));
        if (result.outcome === "application_failed") request.current = null;
        return;
      }
      setOpen(false); onApplied();
    } catch {
      if (!controller.signal.aborted || timedOut) setError(t("The result is not confirmed. Retry this same request or refresh saved status before another action. Do not request another payment.", "មិនទាន់បញ្ជាក់លទ្ធផលទេ។ សូមព្យាយាមសំណើដដែល ឬផ្ទុកស្ថានភាពឡើងវិញ មុនធ្វើសកម្មភាពផ្សេង។ កុំស្នើឱ្យបង់ម្ដងទៀត។"));
    } finally {
      clearTimeout(deadline);
      if (active.current === controller) { active.current = null; setPending(false); }
    }
  }
  if (!PAYMENT_CANCELLATION_ENABLED) return null;
  return <div className="min-w-0 sm:max-w-xs">
    <button ref={trigger} type="button" disabled={!payment.canApplyOriginal || pending}
      className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50"
      onClick={() => { request.current = null; setReason(""); setError(null); setOpen(true); }}>{t("Apply original plan", "អនុម័តគម្រោងដើម")}</button>
    {payment.resolutionConflict ? <p className="mt-2 text-xs text-amber-800">{conflictMessage(payment.resolutionConflict)}</p> : null}
    <ConfirmActionDialog open={open} title={t("Apply original plan", "អនុម័តគម្រោងដើម")}
      description={`${payment.workspaceName} · ${payment.planCode ?? ""} · ${payment.billingCycle ?? ""} · ${payment.currency} ${payment.amount}`}
      note={t("Confirm that the saved received-money evidence matches this original purchase. The server blocks overlapping purchases or a changed subscription. This applies the plan once and saves an audit; it does not refund or transfer money.", "បញ្ជាក់ថាភស្តុតាងប្រាក់ដែលបានទទួលត្រូវគ្នានឹងការទិញដើម។ ប្រព័ន្ធទប់ស្កាត់ការទិញជាន់គ្នា ឬការជាវដែលបានផ្លាស់ប្ដូរ។ វាអនុម័តគម្រោងម្ដង និងរក្សាកំណត់ត្រា ដោយមិនសង ឬផ្ទេរប្រាក់។")}
      confirmLabel={t("Apply original plan", "អនុម័តគម្រោងដើម")} cancelLabel={t("Keep in review", "រក្សាទុកសម្រាប់ពិនិត្យ")}
      loadingLabel={t("Applying…", "កំពុងអនុម័ត…")} loading={pending} confirmDisabled={!payment.canApplyOriginal || reason.trim().length < 10 || reason.trim().length > 500}
      error={error} returnFocusRef={trigger} onCancel={() => { if (!active.current) setOpen(false); }} onConfirm={() => void apply()}>
      <label htmlFor={reasonId} className="mt-3 block text-sm font-semibold">{t("Review reason (10–500 characters)", "មូលហេតុពិនិត្យ (១០–៥០០ តួអក្សរ)")}</label>
      <textarea id={reasonId} value={reason} minLength={10} maxLength={500} disabled={pending} onChange={event => setReason(event.target.value)}
        className="mt-2 min-h-24 w-full rounded-xl border border-slate-300 p-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50" />
    </ConfirmActionDialog>
  </div>;
}
