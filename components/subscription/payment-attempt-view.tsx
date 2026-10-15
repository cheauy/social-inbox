"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import type { PaymentAttempt } from "@/lib/billing/payment-attempt";
import { paymentEnvironmentLabel } from "@/lib/billing/payment-display";
import { createClient } from "@/lib/supabase/client";
import { getBillingCycleDefinition } from "@/lib/subscription/plan-catalog";

type Props = { kind: "manual" | "payway"; attemptId: string; businessId?: string | null };
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50";

export function paymentAttemptUrl(kind: Props["kind"], id: string, businessId?: string | null) {
  const params = new URLSearchParams({ [kind === "manual" ? "manual_request" : "tran_id"]: id });
  if (businessId) params.set("purchase_business", businessId);
  return `/dashboard/subscription/payment?${params}`;
}

// A keyed boundary clears both data and in-flight work before another identity can render.
export function PaymentAttemptView(props: Props) {
  return <AttemptStatus key={`${props.kind}:${props.attemptId}:${props.businessId ?? ""}`} {...props} />;
}

function AttemptStatus({ kind, attemptId, businessId }: Props) {
  const isKhmer = useWorkspaceLanguageId() === "km";
  const t = (en: string, km: string) => isKhmer ? km : en;
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [actionError, setActionError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const identityEpoch = useRef(0);
  const requestedVerification = useRef(false);
  const query = new URLSearchParams({ [kind === "manual" ? "manual_request" : "tran_id"]: attemptId });
  if (businessId) query.set("purchase_business", businessId);
  const endpoint = `/api/subscription/payment-status?${query}`;

  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange(event => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      identityEpoch.current += 1;
      setAttempt(null);
      setRevision(value => value + 1);
    });
    const recheck = () => {
      if (!document.hidden && !inFlight.current) setRevision(value => value + 1);
    };
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const epoch = identityEpoch.current;
    const verifyTerminal = requestedVerification.current;
    requestedVerification.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    async function read() {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw response.status;
      const result = await response.json() as { success?: boolean; attempt?: PaymentAttempt };
      const saved = result.attempt;
      if (!result.success || !saved || saved.kind !== kind || saved.id !== attemptId ||
          !saved.businessId || (businessId && saved.businessId !== businessId)) throw 409;
      return saved;
    }
    async function refresh() {
      if (controller.signal.aborted) return;
      if (document.hidden || navigator.onLine === false || inFlight.current) {
        timer = setTimeout(refresh, 5000);
        return;
      }
      inFlight.current = true;
      polls += 1;
      let shouldPoll = true;
      try {
        let saved = await read();
        if (controller.signal.aborted || epoch !== identityEpoch.current) return;
        if (kind === "payway" && (["pending", "processing", "draft", "created"].includes(saved.status) ||
            (verifyTerminal && !["approved", "recovery_required"].includes(saved.status)))) {
          const verify = new URLSearchParams({ tran_id: attemptId, purchase_business: saved.businessId, preserve_workspace: "1" });
          const response = await fetch(`/api/payway/status?${verify}`, { method: "POST", cache: "no-store", signal: controller.signal });
          if (!response.ok) throw response.status;
          // Verification is server-controlled; resolve its saved result through the same read path.
          saved = await read();
        }
        if (controller.signal.aborted || epoch !== identityEpoch.current) return;
        setAttempt(saved);
        setError(null);
        if (saved.status !== "prepared") setActionError(false);
        shouldPoll = ["pending", "processing", "submitted", "draft", "created"].includes(saved.status) || saved.application === "pending";
      } catch (failure) {
        if (controller.signal.aborted || epoch !== identityEpoch.current) return;
        const status = typeof failure === "number" ? failure : 503;
        setError(status);
        if ([401, 403, 404, 409].includes(status)) {
          setAttempt(null);
          shouldPoll = false;
        }
      } finally {
        inFlight.current = false;
      }
      if (!controller.signal.aborted && shouldPoll && polls < 20) {
        timer = setTimeout(refresh, Math.min(30000, 4000 * Math.pow(1.4, polls - 1)));
      }
    }
    void refresh();
    return () => {
      mounted.current = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [endpoint, kind, attemptId, businessId, revision]);

  async function continueToSubscription() {
    if (!attempt || inFlight.current) return;
    inFlight.current = true;
    const epoch = identityEpoch.current;
    setBusy(true);
    setActionError(false);
    try {
      const response = await fetch("/api/workspaces/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: attempt.businessId }) });
      const result = await response.json();
      if (!response.ok || !result.success || result.businessId !== attempt.businessId) throw new Error();
      if (mounted.current && epoch === identityEpoch.current) window.location.assign("/dashboard/subscription");
    } catch {
      if (mounted.current && epoch === identityEpoch.current) setError(503);
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function recoverUpload(abort = false) {
    if (!attempt || inFlight.current || (!abort && !file)) return;
    if (!abort && attempt.upload && (file!.name !== attempt.upload.fileName || file!.type !== attempt.upload.mimeType || file!.size !== attempt.upload.sizeBytes)) {
      setActionError(true);
      return;
    }
    if (abort && !window.confirm(t("Cancel this unfinished upload?", "បោះបង់ការផ្ទុកមិនទាន់រួចនេះ?"))) return;
    inFlight.current = true;
    const epoch = identityEpoch.current;
    setBusy(true);
    setActionError(false);
    try {
      const response = await fetch("/api/manual-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: abort ? "abort-upload" : "resume-upload", requestId: attemptId, purchaseBusinessId: attempt.businessId, ...(file ? { fileName: file.name, mimeType: file.type, sizeBytes: file.size } : {}) }) });
      const result = await response.json();
      if (!mounted.current || epoch !== identityEpoch.current) return;
      if (!response.ok || !result.success) throw new Error();
      if (abort) {
        if (mounted.current) {
          setAttempt({ ...attempt, status: "cancelled", upload: undefined });
          try { window.location.replace("/dashboard/subscription"); } catch { /* Cancellation remains saved. */ }
        }
        return;
      }
      if (!abort) {
        const { bucket, path, token } = result.upload;
        const upload = result.proofUploaded ? { error: null } : await createClient().storage.from(bucket).uploadToSignedUrl(path, token, file!, { contentType: file!.type });
        if (!mounted.current || epoch !== identityEpoch.current) return;
        // The earlier upload may have committed before its response was lost; finalize checks the object.
        if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw upload.error;
        const finalized = await fetch("/api/manual-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finalize-upload", requestId: attemptId, purchaseBusinessId: attempt.businessId, storagePath: path }) });
        const saved = await finalized.json();
        if (!finalized.ok || !saved.success || saved.request?.id !== attemptId) throw new Error();
      }
    } catch {
      if (mounted.current && epoch === identityEpoch.current) setActionError(true);
    } finally {
      // Even a lost finalize response is reconciled against this same attempt, never a new submission.
      inFlight.current = false;
      if (mounted.current) { setBusy(false); if (!abort) setRevision(value => value + 1); }
    }
  }

  const pending = attempt && ["submitted", "pending", "processing", "draft", "created"].includes(attempt.status);
  const cycle = getBillingCycleDefinition(attempt?.billingCycle);
  const term = cycle ? isKhmer ? cycle.months === 12 ? "1 ឆ្នាំ" : `${cycle.months} ខែ` : cycle.label : attempt?.billingCycle;
  const title = !attempt ? t("Payment status", "ស្ថានភាពការទូទាត់")
    : attempt.status === "prepared" ? t("Upload interrupted", "ការផ្ទុកបានផ្អាក")
    : attempt.status === "submitted" ? t("Payment submitted", "បានដាក់ស្នើការទូទាត់")
    : attempt.application === "active" ? t("Subscription active", "ការជាវសកម្ម")
    : attempt.application === "scheduled" ? t("Scheduled", "បានកំណត់ពេល")
    : attempt.application === "review" || attempt.status === "recovery_required" ? t("Payment needs review", "ការទូទាត់ត្រូវការពិនិត្យ")
    : attempt.status === "approved" ? attempt.environment === "sandbox" ? t("Test payment approved", "ការទូទាត់សាកល្បងបានអនុម័ត") : t("Payment received", "បានទទួលការទូទាត់")
    : pending ? t("Awaiting confirmation", "កំពុងរង់ចាំការបញ្ជាក់")
    : ({ rejected: t("Payment rejected", "ការទូទាត់ត្រូវបានបដិសេធ"), declined: t("Payment declined", "ការទូទាត់ត្រូវបានបដិសេធ"), failed: t("Payment failed", "ការទូទាត់បរាជ័យ"), cancelled: t("Cancelled", "បានបោះបង់"), expired: t("Payment request expired", "សំណើទូទាត់ផុតកំណត់") }[attempt.status] ?? t("Payment needs review", "ការទូទាត់ត្រូវការពិនិត្យ"));
  const detail = attempt?.status === "submitted" ? t("Awaiting review", "កំពុងរង់ចាំការពិនិត្យ")
    : attempt?.application === "pending" && attempt.status === "approved" ? t("Activation pending", "កំពុងរង់ចាំការបើកដំណើរការ")
    : attempt?.application === "historical" ? t("Saved payment. This does not confirm current access.", "ការទូទាត់ចាស់។ មិនបញ្ជាក់សិទ្ធិប្រើបច្ចុប្បន្នទេ។")
    : attempt?.status === "prepared" ? t("Choose the same file to resume this request.", "ជ្រើសឯកសារដដែល ដើម្បីបន្តសំណើនេះ។")
    : attempt?.application === "review" ? t("Keep this reference. Do not pay again.", "រក្សាលេខយោងនេះ។ កុំទូទាត់ម្ដងទៀត។") : null;

  return <section className="mx-auto w-full max-w-2xl p-4 sm:p-6" aria-busy={busy}>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <h1 className="text-2xl font-bold text-slate-950">{title}</h1>
      {detail ? <p role="status" className="mt-2 text-sm text-slate-600">{detail}</p> : null}
      {attempt ? <>
        <p className={`mt-4 inline-block rounded-lg px-3 py-1 text-sm font-semibold ${attempt.environment === "sandbox" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"}`}>{paymentEnvironmentLabel(attempt.environment, isKhmer)}</p>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          {[ [t("Workspace", "កន្លែងធ្វើការ"), attempt.businessName], [t("Plan / term", "គម្រោង / រយៈពេល"), `${attempt.planCode.toUpperCase()} · ${term}`], [t("Amount", "ចំនួនទឹកប្រាក់"), attempt.amount !== null && attempt.currency ? new Intl.NumberFormat("en-US", { style: "currency", currency: attempt.currency }).format(attempt.amount) : t("Unavailable", "មិនមាន")], [t("Reference", "លេខយោង"), attempt.reference ?? attempt.id] ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold text-slate-900">{value}</dd></div>)}
          {attempt.effectiveAt && attempt.application === "scheduled" ? <div><dt>{t("Effective date", "ថ្ងៃចាប់ផ្តើម")}</dt><dd>{new Date(attempt.effectiveAt).toLocaleDateString()}</dd></div> : null}
        </dl>
        {attempt.status === "prepared" ? <div className="mt-5 space-y-3">
          {attempt.upload ? <p className="break-words text-sm text-slate-600">{attempt.upload.fileName}</p> : null}
          <label className="block text-sm font-medium">{t("Payment proof", "ភស្តុតាងការទូទាត់")}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-2 block w-full max-w-full text-sm" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
          <button type="button" className={buttonClass} disabled={!file || busy} onClick={() => void recoverUpload()}>{t("Resume upload", "បន្តផ្ទុក")}</button>{" "}
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void recoverUpload(true)}>{t("Cancel upload", "បោះបង់ការផ្ទុក")}</button>
        </div> : null}
      </> : !error ? <p role="status" className="mt-4 text-sm">{t("Loading payment…", "កំពុងផ្ទុកការទូទាត់…")}</p> : null}
      {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error === 401 ? t("Sign in to view this payment.", "ចូលគណនីដើម្បីមើលការទូទាត់នេះ។") : [403, 404, 409].includes(error) ? t("Payment unavailable.", "មិនអាចមើលការទូទាត់បាន។") : t("Unable to check status. Try again.", "មិនអាចពិនិត្យស្ថានភាព។ សូមព្យាយាមម្ដងទៀត។")}</p> : null}
      {actionError ? <p role="alert" className="mt-4 text-sm text-red-700">{t("Upload not confirmed. Check status or retry with the same file.", "ការផ្ទុកមិនទាន់បញ្ជាក់។ ពិនិត្យស្ថានភាព ឬព្យាយាមដោយឯកសារដដែល។")}</p> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {attempt?.application === "active" ? <button type="button" className={`${buttonClass} bg-blue-600 text-white`} disabled={busy} onClick={() => void continueToSubscription()}>{t("Continue", "បន្ត")}</button> : null}
        {attempt?.invoiceId ? <a className={buttonClass} href={`/dashboard/subscription/invoices/${encodeURIComponent(attempt.invoiceId)}?return_to=${encodeURIComponent(paymentAttemptUrl(kind, attemptId, attempt.businessId))}`}>{t("TENH Receipt", "បង្កាន់ដៃ TENH")}</a> : null}
        {error === 401 ? <a className={buttonClass} href="/login">{t("Sign in", "ចូលគណនី")}</a> : <button type="button" className={buttonClass} disabled={busy} onClick={() => { requestedVerification.current = true; setRevision(value => value + 1); }}>{t("Check status", "ពិនិត្យស្ថានភាព")}</button>}
        <a className={buttonClass} href="/dashboard/subscription">{t("Back to subscription", "ត្រឡប់ទៅការជាវ")}</a>
      </div>
    </div>
  </section>;
}
