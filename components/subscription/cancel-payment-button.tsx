"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import type { CancellationOutcome } from "@/lib/billing/cancel-payment";
import { PAYMENT_CANCELLATION_ENABLED } from "@/lib/billing/payment-cancellation-feature";

export function CancelPaymentButton({ kind, paymentId, businessId, submitted = false, onResult }: {
  kind: "manual" | "payway" | "bakong"; paymentId: string; businessId: string; submitted?: boolean;
  onResult: (outcome: CancellationOutcome) => void;
}) {
  const km = useWorkspaceLanguageId() === "km";
  const t = (en: string, kh: string) => km ? kh : en;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const completed = useRef<CancellationOutcome | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open || pending || !completed.current) return;
    const outcome = completed.current;
    completed.current = null;
    // Let the confirmation release its modal focus before the caller dismisses the checkout.
    onResult(outcome);
  }, [open, pending, onResult]);
  async function confirm() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/subscription/cancel-payment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, paymentId, businessId, action: submitted ? "withdraw" : "cancel", confirmed: true }),
      });
      const result = await response.json();
      if (!response.ok || !result.success || !["cancelled", "checkout_closed", "expired", "withdrawn", "paid", "processing", "reconciliation_required"].includes(result.outcome)) {
        throw new Error(t("Unable to confirm cancellation. Refresh the payment status. Do not pay again while it is uncertain.", "មិនអាចបញ្ជាក់ការបោះបង់បានទេ។ សូមផ្ទុកស្ថានភាពឡើងវិញ ហើយកុំទូទាត់ម្ដងទៀត ខណៈស្ថានភាពមិនច្បាស់។"));
      }
      completed.current = result.outcome;
      setOpen(false);
    } catch {
      setError(t("Unable to confirm cancellation. Refresh the payment status. Do not pay again while it is uncertain.", "មិនអាចបញ្ជាក់ការបោះបង់បានទេ។ សូមផ្ទុកស្ថានភាពឡើងវិញ ហើយកុំទូទាត់ម្ដងទៀត ខណៈស្ថានភាពមិនច្បាស់។"));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  const label = submitted ? t("Withdraw proof", "ដកភស្តុតាងដែលបានដាក់ស្នើ") : t("Cancel payment", "បោះបង់ការទូទាត់");
  if (!PAYMENT_CANCELLATION_ENABLED) return null;
  return <>
    <button ref={trigger} type="button" onClick={() => { setError(null); setOpen(true); }}
      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">
      {label}
    </button>
    <ConfirmActionDialog open={open} title={label} confirmLabel={label} loading={pending} error={error}
      cancelLabel={t("Keep payment", "រក្សាការទូទាត់")} loadingLabel={t("Checking…", "កំពុងពិនិត្យ…")}
      closeLabel={t("Close confirmation", "បិទការបញ្ជាក់")} returnFocusRef={trigger}
      description={kind === "bakong" && !submitted ? t("Cancel this checkout? Your current plan stays unchanged. Do not pay with this QR afterwards. Select a plan again for a new QR.", "បោះបង់ការទូទាត់នេះឬ? គម្រោងបច្ចុប្បន្នមិនផ្លាស់ប្តូរទេ។ កុំប្រើ QR នេះទូទាត់ទៀត។ ជ្រើសគម្រោងម្ដងទៀតដើម្បីទទួល QR ថ្មី។") :
        submitted ? t("Withdraw this proof from review? The proof and payment records will be retained. Billing review is required before another checkout.", "ដកភស្តុតាងនេះពីការពិនិត្យឬ? ភស្តុតាង និងកំណត់ត្រាទូទាត់នឹងរក្សាទុក។ ត្រូវពិនិត្យការទូទាត់ មុនការទូទាត់ថ្មី។") :
        t("Request cancellation of this payment? Your current subscription will stay unchanged. If payment cannot be ruled out, this attempt will remain for reconciliation. Do not pay again until its status is resolved.", "ស្នើបោះបង់ការទូទាត់នេះឬ? ការជាវបច្ចុប្បន្នមិនផ្លាស់ប្តូរទេ។ បើមិនអាចបញ្ជាក់ស្ថានភាពបាន សំណើនេះនឹងរក្សាទុកសម្រាប់ពិនិត្យ។ កុំទូទាត់ម្ដងទៀត មុនដោះស្រាយស្ថានភាព។")}
      note={t("Cancellation does not reverse a transfer or invalidate a saved bank QR.", "ការបោះបង់មិនត្រឡប់ប្រាក់ផ្ទេរ ឬធ្វើឱ្យ QR ធនាគារដែលបានរក្សាទុកអសុពលទេ។")}
      onCancel={() => { if (!submitting.current) setOpen(false); }} onConfirm={() => void confirm()} />
  </>;
}
