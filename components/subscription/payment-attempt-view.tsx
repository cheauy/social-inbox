"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import type { PaymentAttempt } from "@/lib/billing/payment-attempt";
import { createClient } from "@/lib/supabase/client";
import { getBillingCycleDefinition } from "@/lib/subscription/plan-catalog";
import { BakongPaymentView } from "./bakong-payment-view";
import { CancelPaymentButton } from "./cancel-payment-button";
import { PaymentSuccessCard } from "./payment-success-card";
import { CustomerPaymentReference } from "./customer-payment-reference";
import { SubmittedPaymentHelp } from "./submitted-payment-help";

type Props = { kind: "manual" | "payway" | "bakong"; attemptId: string; businessId?: string | null; checkoutClosed?: boolean };
const buttonClass = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50";

export function paymentAttemptUrl(kind: Props["kind"], id: string, businessId?: string | null) {
  const params = new URLSearchParams({ [kind === "bakong" ? "bakong_attempt" : kind === "manual" ? "manual_request" : "tran_id"]: id });
  if (businessId) params.set("purchase_business", businessId);
  return `/dashboard/subscription/payment?${params}`;
}

// A keyed boundary clears both data and in-flight work before another identity can render.
export function PaymentAttemptView(props: Props) {
  if (props.kind === "bakong") return <BakongPaymentView key={`${props.attemptId}:${props.businessId ?? ""}`} attemptId={props.attemptId} businessId={props.businessId} />;
  return <AttemptStatus key={`${props.kind}:${props.attemptId}:${props.businessId ?? ""}`} {...props} />;
}

function AttemptStatus({ kind, attemptId, businessId, checkoutClosed = false }: Props) {
  const isKhmer = useWorkspaceLanguageId() === "km";
  const t = (en: string, km: string) => isKhmer ? km : en;
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [actionError, setActionError] = useState(false);
  const [navigationError, setNavigationError] = useState(false);
  const [checkoutCloseError, setCheckoutCloseError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [checkingStopped, setCheckingStopped] = useState(false);
  const [automaticChecking, setAutomaticChecking] = useState(false);
  const [revision, setRevision] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const identityEpoch = useRef(0);
  const requestedVerification = useRef(false);
  const latestAttempt = useRef<PaymentAttempt | null>(null);
  const clock = useRef<{ server: number; client: number } | null>(null);
  const expiryRequested = useRef(false);
  const expiryChecking = useRef(false);
  const expiryController = useRef<AbortController | null>(null);
  const closeController = useRef<AbortController | null>(null);
  const replaced = useRef(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [observedProviderClose, setProviderClosed] = useState(false);
  const providerClosed = checkoutClosed || observedProviderClose || Boolean(attempt?.checkoutSessionClosedAt);
  const providerCloseRequested = useRef(false);
  const dismissalHandled = useRef(false);
  useEffect(() => { providerCloseRequested.current = providerClosed; }, [providerClosed]);
  const query = new URLSearchParams({ [kind === "manual" ? "manual_request" : "tran_id"]: attemptId });
  if (businessId) query.set("purchase_business", businessId);
  const endpoint = `/api/subscription/payment-status?${query}`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; expiryController.current?.abort(); closeController.current?.abort(); };
  }, []);

  const acceptAttempt = useCallback((saved: PaymentAttempt, requestStarted = performance.now()) => {
    const previous = latestAttempt.current;
    // Reads cannot extend a checkout or let an older pending response replace
    // a confirmed result already displayed for this identity.
    if (previous?.checkoutExpiresAt && saved.checkoutExpiresAt !== previous.checkoutExpiresAt) throw 409;
    if (previous?.status === "approved" && saved.status !== "approved") return previous;
    if (saved.checkoutExpiresAt && Number.isFinite(Date.parse(saved.checkoutExpiresAt)) && saved.serverTime && Number.isFinite(Date.parse(saved.serverTime))) {
      const client = performance.now();
      // Conservatively include the whole request/response interval. A delayed
      // response must never grant extra checkout time or start a late inquiry.
      clock.current = { server: Math.max(Date.parse(saved.serverTime) + Math.max(0, client - requestStarted), clock.current ? clock.current.server + client - clock.current.client : 0), client };
    }
    latestAttempt.current = saved;
    setAttempt(saved);
    return saved;
  }, []);

  const finishExpiredCheckout = useCallback(async () => {
    if (!expiryRequested.current || inFlight.current || expiryChecking.current || replaced.current || !mounted.current || latestAttempt.current?.status === "approved") return;
    expiryChecking.current = true;
    const epoch = identityEpoch.current;
    const controller = new AbortController();
    expiryController.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    try {
      // One final saved-state read, after an outstanding verification completes.
      // Countdown ticks never call the provider, cancel, or change access.
      const requestStarted = performance.now();
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      const result = await response.json() as { success?: boolean; attempt?: PaymentAttempt };
      const saved = result.attempt;
      if (controller.signal.aborted || !mounted.current || epoch !== identityEpoch.current) return;
      if (response.ok && result.success && saved?.kind === kind && saved.id === attemptId && saved.businessId && (!businessId || saved.businessId === businessId)) {
        acceptAttempt(saved, requestStarted);
      }
    } catch { /* A closed checkout remains available in saved history for reconciliation. */ }
    finally {
      clearTimeout(timeout);
      expiryChecking.current = false;
      if ((!controller.signal.aborted || timedOut) && mounted.current && epoch === identityEpoch.current && !replaced.current && latestAttempt.current?.status !== "approved") {
        replaced.current = true;
        // PayWay mounts its iframe outside React and can lock body scrolling.
        // A document replacement also removes that provider UI without making
        // a financial cancellation or touching the saved payment.
        window.location.replace("/dashboard/subscription");
      }
    }
  }, [endpoint, kind, attemptId, businessId, acceptAttempt]);

  useEffect(() => {
    if (kind !== "payway" || !attempt?.checkoutExpiresAt || !clock.current || attempt.status === "approved" || attempt.checkoutSessionClosedAt) return;
    const expires = Date.parse(attempt.checkoutExpiresAt);
    if (!Number.isFinite(expires)) return;
    function tick() {
      const current = clock.current;
      if (!current || !mounted.current) return;
      const seconds = Math.max(0, Math.ceil((expires - (current.server + performance.now() - current.client)) / 1000));
      setRemaining(seconds);
      if (seconds === 0) {
        expiryRequested.current = true;
        void finishExpiredCheckout();
      }
    }
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [kind, attempt?.checkoutExpiresAt, attempt?.status, attempt?.checkoutSessionClosedAt, finishExpiredCheckout]);

  useEffect(() => {
    if (kind !== "payway" || checkoutClosed || typeof window.MutationObserver !== "function") return;
    // Observe only the provider's own mounted iframe being removed/hidden.
    // This is presentation evidence, never financial verification.
    let seenOpen = false;
    function inspect() {
      // PayWay mounts desktop and mobile presentations in separate siblings.
      // A hidden sheet created during initialization is not an observed close.
      const frames = document.querySelectorAll('#aba-checkout iframe[name="aba_webservice"], #aba_checkout_sheet #aba_checkout_app iframe[name="aba_webservice"]');
      const open = Array.from(frames).some(frame => {
        for (let element: Element | null = frame; element && element !== document.body; element = element.parentElement) {
          const style = window.getComputedStyle(element);
          if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden") return false;
        }
        return true;
      });
      if (open) seenOpen = true;
      else if (seenOpen) setProviderClosed(true);
    }
    const observer = new window.MutationObserver(inspect);
    inspect();
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "aria-hidden", "hidden"] });
    return () => observer.disconnect();
  }, [kind, checkoutClosed]);

  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange(event => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      identityEpoch.current += 1;
      latestAttempt.current = null;
      clock.current = null;
      expiryRequested.current = false;
      expiryController.current?.abort();
      closeController.current?.abort();
      closeController.current = null;
      setRemaining(null);
      setAttempt(null);
      setVerifying(false);
      setAutomaticChecking(false);
      setRevision(value => value + 1);
    });
    const recheck = () => {
      if (document.hidden || navigator.onLine === false) setAutomaticChecking(false);
      if (!document.hidden && !inFlight.current) { setCheckingStopped(false); setRevision(value => value + 1); }
    };
    window.addEventListener("online", recheck);
    window.addEventListener("offline", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("online", recheck);
      window.removeEventListener("offline", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const epoch = identityEpoch.current;
    const verifyTerminal = requestedVerification.current;
    requestedVerification.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    async function read() {
      const requestStarted = performance.now();
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw response.status;
      const result = await response.json() as { success?: boolean; attempt?: PaymentAttempt };
      const saved = result.attempt;
      if (!result.success || !saved || saved.kind !== kind || saved.id !== attemptId ||
          !saved.businessId || (businessId && saved.businessId !== businessId)) throw 409;
      return { saved, requestStarted };
    }
    async function refresh() {
      if (controller.signal.aborted) return;
      if (document.hidden || navigator.onLine === false || inFlight.current) {
        setAutomaticChecking(false);
        timer = setTimeout(refresh, 5000);
        return;
      }
      inFlight.current = true;
      setAutomaticChecking(kind === "payway");
      polls += 1;
      let shouldPoll = true;
      let timedOut = false;
      const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
      try {
        let result = await read();
        let saved = result.saved;
        if (controller.signal.aborted || epoch !== identityEpoch.current) return;
        saved = acceptAttempt(saved, result.requestStarted);
        const now = clock.current ? clock.current.server + performance.now() - clock.current.client : Number.NaN;
        // Reopening a durably closed attempt is a saved-history view, not a
        // new dismissal. Only a closure initiated here navigates away.
        if (!expiryRequested.current && kind === "payway" && saved.checkoutSessionClosedAt) {
          shouldPoll = false;
          setError(null);
          // A lost acknowledgement of this tab's own close still completes
          // navigation once the exact saved closure is observed.
          if (closeController.current) expiryRequested.current = true;
          return;
        }
        if (expiryRequested.current || (kind === "payway" && saved.status !== "approved" && saved.checkoutExpiresAt && Date.parse(saved.checkoutExpiresAt) <= now)) {
          expiryRequested.current = true;
          shouldPoll = false;
          return;
        }
        if (kind === "payway" && providerCloseRequested.current) {
          shouldPoll = false;
          setError(null);
          return;
        }
        if (kind === "payway" && (["pending", "processing", "draft", "created"].includes(saved.status) ||
            (verifyTerminal && !["approved", "recovery_required"].includes(saved.status)))) {
          const verify = new URLSearchParams({ tran_id: attemptId, purchase_business: saved.businessId, preserve_workspace: "1" });
          setVerifying(true);
          setError(null);
          const response = await fetch(`/api/payway/status?${verify}`, { method: "POST", cache: "no-store", signal: controller.signal });
          if (!response.ok) throw response.status;
          // Verification is server-controlled; resolve its saved result through the same read path.
          result = await read();
          saved = result.saved;
        }
        if (controller.signal.aborted || epoch !== identityEpoch.current) return;
        saved = acceptAttempt(saved, result.requestStarted);
        setCheckingStopped(false);
        setError(null);
        if (saved.status !== "prepared") setActionError(false);
        shouldPoll = ["pending", "processing", "submitted", "draft", "created"].includes(saved.status) || saved.application === "pending";
      } catch (failure) {
        if ((controller.signal.aborted && !timedOut) || epoch !== identityEpoch.current) return;
        const status = typeof failure === "number" ? failure : 503;
        setAutomaticChecking(false);
        setError(status);
        if ([401, 403, 404, 409].includes(status)) {
          setAttempt(null);
          shouldPoll = false;
        }
      } finally {
        clearTimeout(deadline);
        inFlight.current = false;
        if (mounted.current && epoch === identityEpoch.current) setVerifying(false);
        if (mounted.current && epoch === identityEpoch.current && (!shouldPoll || expiryRequested.current)) setAutomaticChecking(false);
        if (!controller.signal.aborted && epoch === identityEpoch.current && expiryRequested.current) void finishExpiredCheckout();
      }
      if (!controller.signal.aborted && !expiryRequested.current && shouldPoll && polls < 20) {
        timer = setTimeout(refresh, Math.min(30000, 4000 * Math.pow(1.4, polls - 1)));
      } else if (!controller.signal.aborted && shouldPoll && mounted.current) {
        setAutomaticChecking(false);
        setCheckingStopped(true);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      expiryController.current?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [endpoint, kind, attemptId, businessId, revision, acceptAttempt, finishExpiredCheckout]);

  const endCheckoutSession = useCallback(async () => {
    if (kind !== "payway" || !attempt || inFlight.current || attempt.status === "approved" || attempt.checkoutSessionClosedAt) return;
    inFlight.current = true;
    const epoch = identityEpoch.current;
    const controller = new AbortController();
    closeController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    let closed = false;
    setBusy(true);
    setCheckoutCloseError(false);
    try {
      const response = await fetch("/api/payway/checkout-session", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, transactionId: attempt.id, businessId: attempt.businessId }), signal: controller.signal });
      const result = await response.json() as { success?: boolean; outcome?: string; transactionId?: string; businessId?: string; closedAt?: string };
      if (controller.signal.aborted || !mounted.current || epoch !== identityEpoch.current) return;
      if (!response.ok || !result.success || result.transactionId !== attempt.id || result.businessId !== attempt.businessId) throw new Error();
      if (result.outcome === "paid") { setRevision(value => value + 1); return; }
      if (result.outcome !== "closed" || !result.closedAt || !Number.isFinite(Date.parse(result.closedAt))) throw new Error();
      acceptAttempt({ ...attempt, checkoutSessionClosedAt: result.closedAt });
      expiryRequested.current = true;
      closed = true;
    } catch {
      if (mounted.current && epoch === identityEpoch.current) {
        // An interrupted response may have committed. Reconcile the exact saved
        // attempt before reporting closure or removing it from the active list.
        setCheckoutCloseError(true);
        setRevision(value => value + 1);
      }
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      if (mounted.current && epoch === identityEpoch.current) setBusy(false);
      if (closed && !controller.signal.aborted && epoch === identityEpoch.current) void finishExpiredCheckout();
    }
  }, [kind, attempt, acceptAttempt, finishExpiredCheckout]);

  useEffect(() => {
    if (kind !== "payway" || !providerClosed || !attempt || verifying || busy || inFlight.current || dismissalHandled.current ||
        !["pending", "processing", "draft", "created"].includes(attempt.status) || attempt.application !== "pending" || attempt.checkoutSessionClosedAt) return;
    dismissalHandled.current = true;
    void endCheckoutSession();
  }, [kind, providerClosed, attempt, verifying, busy, error, automaticChecking, endCheckoutSession]);

  async function continueToSubscription(destination: "/dashboard/inbox" | "/dashboard/subscription" = "/dashboard/subscription") {
    if (!attempt || inFlight.current) return;
    inFlight.current = true;
    const epoch = identityEpoch.current;
    setBusy(true);
    setNavigationError(false);
    setActionError(false);
    try {
      const response = await fetch("/api/workspaces/switch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: attempt.businessId }) });
      const result = await response.json();
      if (!response.ok || !result.success || result.businessId !== attempt.businessId) throw new Error();
      if (mounted.current && epoch === identityEpoch.current) window.location.assign(destination);
    } catch {
      if (mounted.current && epoch === identityEpoch.current) setNavigationError(true);
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
  const manualReview = kind === "manual" && attempt?.status === "submitted";
  const checking = kind === "payway" && !providerClosed && remaining !== 0 && !error && !checkingStopped && (verifying || !attempt ||
    (automaticChecking && pending && attempt.application !== "review" && attempt.application !== "historical"));
  const cycle = getBillingCycleDefinition(attempt?.billingCycle);
  const term = cycle ? isKhmer ? cycle.months === 12 ? "1 ឆ្នាំ" : `${cycle.months} ខែ` : cycle.label : attempt?.billingCycle;
  const title = error ? t("Unable to check payment", "មិនអាចពិនិត្យការទូទាត់បាន")
    : checking ? t("Checking payment", "កំពុងពិនិត្យការទូទាត់") : !attempt ? t("Preparing payment…", "កំពុងរៀបចំការទូទាត់…")
    : attempt.status === "prepared" ? t("Upload interrupted", "ការផ្ទុកបានផ្អាក")
    : manualReview ? t("Payment submitted", "បានដាក់ស្នើការទូទាត់")
    : attempt.application === "scheduled" ? t("Scheduled", "បានកំណត់ពេល")
    : attempt.application === "review" || attempt.status === "recovery_required" ? t("Payment needs review", "ការទូទាត់ត្រូវការពិនិត្យ")
    : attempt.status === "approved" ? attempt.environment === "sandbox" ? t("Test payment approved", "ការទូទាត់សាកល្បងបានអនុម័ត") : t("Payment received", "បានទទួលការទូទាត់")
    : pending ? attempt.checkoutSessionClosedAt ? t("Checkout closed", "បានបិទការទូទាត់") : providerClosed ? t("QR window closed", "បានបិទផ្ទាំង QR") : t("Waiting for payment", "កំពុងរង់ចាំការទូទាត់")
    : ({ rejected: t("Payment rejected", "ការទូទាត់ត្រូវបានបដិសេធ"), declined: t("Payment declined", "ការទូទាត់ត្រូវបានបដិសេធ"), failed: t("Payment failed", "ការទូទាត់បរាជ័យ"), cancelled: t("Cancelled", "បានបោះបង់"), expired: t("Payment request expired", "សំណើទូទាត់ផុតកំណត់") }[attempt.status] ?? t("Payment needs review", "ការទូទាត់ត្រូវការពិនិត្យ"));
  const detail = attempt?.status === "submitted" ? t("Awaiting review", "កំពុងរង់ចាំការពិនិត្យ")
    : attempt?.application === "pending" && attempt.status === "approved" ? t("Activation pending", "កំពុងរង់ចាំការបើកដំណើរការ")
    : attempt?.application === "historical" ? t("Saved payment. This does not confirm current access.", "ការទូទាត់ចាស់។ មិនបញ្ជាក់សិទ្ធិប្រើបច្ចុប្បន្នទេ។")
    : attempt?.status === "prepared" ? t("Choose the same file to resume this request.", "ជ្រើសឯកសារដដែល ដើម្បីបន្តសំណើនេះ។")
    : attempt?.application === "review" ? t("Keep this reference. Do not pay again.", "រក្សាលេខយោងនេះ។ កុំទូទាត់ម្ដងទៀត។") : null;

  if (!error && attempt?.status === "approved" && attempt.application === "active" &&
      ["production", "manual", "sandbox"].includes(attempt.environment)) {
    return <PaymentSuccessCard workspace={attempt.businessName} planCode={attempt.planCode} billingCycle={attempt.billingCycle}
      amount={attempt.amount} currency={attempt.currency} provider={kind} environment={attempt.environment}
      reference={attempt.customerReference ?? null} busy={busy} error={navigationError}
      receiptHref={attempt.invoiceId ? `/dashboard/subscription/invoices/${encodeURIComponent(attempt.invoiceId)}?return_to=${encodeURIComponent(paymentAttemptUrl(kind, attemptId, attempt.businessId))}` : null}
      onNavigate={destination => void continueToSubscription(destination)} />;
  }

  return <section className="mx-auto w-full max-w-md px-4 py-8 sm:py-12" aria-busy={busy || verifying}>
    <div data-payment-card className="relative min-w-0 rounded-2xl border border-slate-200 bg-white px-5 pb-6 pt-2 shadow-[0_12px_40px_-20px_rgba(15,23,42,0.18)] sm:px-7 sm:pb-7">
      <div className="-mr-3 mb-5 flex min-h-11 items-center justify-end gap-2">
        {kind === "payway" && attempt?.checkoutExpiresAt && !attempt.checkoutSessionClosedAt && remaining !== null ? <time dateTime={attempt.checkoutExpiresAt} aria-label={t("Checkout time remaining", "ពេលទូទាត់នៅសល់")} className="rounded-full bg-slate-50 px-3 py-1.5 text-sm font-semibold tabular-nums text-slate-600">
          <span aria-hidden="true">{String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}</span><span className="sr-only">{remaining} {t("seconds", "វិនាទី")}</span>
        </time> : null}
      <a href="/dashboard/subscription" aria-label={t("Close payment status", "បិទស្ថានភាពទូទាត់")}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-5 w-5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </a>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="text-center">
        {checking ? <div aria-hidden="true" className="mx-auto mb-6 h-16 w-16 rounded-full border-[5px] border-teal-100 border-t-teal-600 motion-safe:animate-spin motion-reduce:animate-none" />
          : manualReview ? <div aria-hidden="true" className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-9 w-9"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h5" /></svg>
          </div> : null}
        <h1 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{title}</h1>
        {checking || manualReview ? <p className="mt-2 text-sm text-slate-500">{manualReview ? t("Approval usually takes 1-2 business days.", "ការអនុម័តជាធម្មតាចំណាយពេល 1-2 ថ្ងៃធ្វើការ។") : t("Please wait", "សូមរង់ចាំ")}</p> : null}
      </div>
      {attempt && attempt.amount !== null && attempt.currency ? <div className="mt-6 border-y border-slate-100 py-5 text-center">
        <p className="break-words text-3xl font-bold tracking-tight text-slate-950">{new Intl.NumberFormat("en-US", { style: "currency", currency: attempt.currency }).format(attempt.amount)}</p>
        <p className="mt-1.5 text-xs text-slate-500">{attempt.currency} · {t("Payment amount", "ចំនួនទឹកប្រាក់ទូទាត់")}</p>
      </div> : null}
      {checking || manualReview ? <p className="mt-5 text-center text-sm leading-6 text-slate-500">{manualReview
        ? t("Awaiting manual verification", "កំពុងរង់ចាំការផ្ទៀងផ្ទាត់ដោយបុគ្គលិក")
        : t("Waiting for payment confirmation", "កំពុងរង់ចាំការបញ្ជាក់ការទូទាត់")}</p>
        : checkingStopped && pending ? <p role="status" className="mt-4 text-center text-sm leading-6 text-slate-600">{t("Confirmation is taking longer than expected. Check status or return later.", "ការបញ្ជាក់ចំណាយពេលយូរជាងធម្មតា។ សូមពិនិត្យស្ថានភាព ឬត្រឡប់មកវិញពេលក្រោយ។")}</p>
        : detail ? <p role="status" className="mt-3 text-center text-sm text-slate-600">{detail}</p> : null}
      {providerClosed && pending ? <p className="mt-4 text-center text-sm leading-6 text-slate-500">{t("The PayWay window was closed. Payment is still unconfirmed; keep this reference if you already paid.", "បានបិទផ្ទាំង PayWay។ ការទូទាត់មិនទាន់បានបញ្ជាក់។ សូមរក្សាលេខយោងនេះ បើអ្នកបានបង់រួច។")}</p> : null}
      {remaining === 0 && attempt?.status !== "approved" ? <p role="status" className="mt-4 text-center text-sm text-slate-500">{t("Checkout time ended. Returning to subscription…", "អស់ពេលទូទាត់។ កំពុងត្រឡប់ទៅការជាវ…")}</p> : null}
      {attempt ? <>
        <div data-payment-summary className="mt-5 text-sm">
          {kind === "payway" && !attempt.checkoutExpiresAt ? <p className="mb-3 text-xs text-slate-500">{t("No checkout deadline was saved for this earlier attempt.", "ការទូទាត់ចាស់នេះមិនមានពេលកំណត់ដែលបានរក្សាទុកទេ។")}</p> : null}
          <dl className="mt-3 grid grid-cols-2 gap-4">
          {[ [t("Workspace", "កន្លែងធ្វើការ"), attempt.businessName], [t("Plan / term", "គម្រោង / រយៈពេល"), `${attempt.planCode.toUpperCase()} · ${term}`], [t("Amount", "ចំនួនទឹកប្រាក់"), attempt.amount !== null && attempt.currency ? new Intl.NumberFormat("en-US", { style: "currency", currency: attempt.currency }).format(attempt.amount) : t("Unavailable", "មិនមាន")] ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-slate-500">{label}</dt><dd className="mt-1 break-words font-semibold text-slate-900">{value}</dd></div>)}
          <div className="min-w-0"><dt className="text-slate-500">{t("Reference", "លេខយោង")}</dt><dd className="mt-1 text-slate-900"><CustomerPaymentReference value={attempt.customerReference} /></dd></div>
          {attempt.effectiveAt && attempt.application === "scheduled" ? <div><dt>{t("Effective date", "ថ្ងៃចាប់ផ្តើម")}</dt><dd>{new Date(attempt.effectiveAt).toLocaleDateString()}</dd></div> : null}
        </dl>
        </div>
        {manualReview && !error ? <SubmittedPaymentHelp /> : null}
        {attempt.status === "prepared" ? <div className="mt-5 space-y-3">
          {attempt.upload ? <p className="break-words text-sm text-slate-600">{attempt.upload.fileName}</p> : null}
          <label className="block text-sm font-medium">{t("Payment proof", "ភស្តុតាងការទូទាត់")}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-2 block w-full max-w-full text-sm" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
          <button type="button" className={buttonClass} disabled={!file || busy} onClick={() => void recoverUpload()}>{t("Resume upload", "បន្តផ្ទុក")}</button>{" "}
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void recoverUpload(true)}>{t("Cancel upload", "បោះបង់ការផ្ទុក")}</button>
        </div> : null}
      </> : null}
      {error ? <p role="alert" className="mt-4 text-sm text-red-700">{error === 401 ? t("Sign in to view this payment.", "ចូលគណនីដើម្បីមើលការទូទាត់នេះ។") : [403, 404, 409].includes(error) ? t("Payment unavailable.", "មិនអាចមើលការទូទាត់បាន។") : t("Unable to check status. Try again.", "មិនអាចពិនិត្យស្ថានភាព។ សូមព្យាយាមម្ដងទៀត។")}</p> : null}
      {checkoutCloseError ? <p role="alert" className="mt-4 text-sm text-red-700">{t("Checkout closure is not confirmed. Check status or try Cancel again.", "ការបញ្ចប់វគ្គទូទាត់មិនទាន់បានបញ្ជាក់។ សូមពិនិត្យស្ថានភាព ឬព្យាយាមបោះបង់ម្ដងទៀត។")}</p> : null}
      {actionError ? <p role="alert" className="mt-4 text-sm text-red-700">{t("Upload not confirmed. Check status or retry with the same file.", "ការផ្ទុកមិនទាន់បញ្ជាក់។ ពិនិត្យស្ថានភាព ឬព្យាយាមដោយឯកសារដដែល។")}</p> : null}
      {navigationError ? <p role="alert" className="mt-4 text-sm text-red-700">{t("Unable to open workspace. Try again.", "មិនអាចបើកកន្លែងធ្វើការ។ សូមព្យាយាមម្ដងទៀត។")}</p> : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {attempt?.invoiceId ? <a className={buttonClass} href={`/dashboard/subscription/invoices/${encodeURIComponent(attempt.invoiceId)}?return_to=${encodeURIComponent(paymentAttemptUrl(kind, attemptId, attempt.businessId))}`}>{t("TENH Receipt", "បង្កាន់ដៃ TENH")}</a> : null}
        {error === 401 ? <a className={buttonClass} href="/login">{t("Sign in", "ចូលគណនី")}</a> : error ? <button type="button" className={buttonClass} disabled={busy || verifying} onClick={() => { requestedVerification.current = true; setCheckingStopped(false); setRevision(value => value + 1); }}>{t("Try again", "ព្យាយាមម្ដងទៀត")}</button> : null}
        {!error && (checkingStopped || (kind === "payway" && attempt && ["cancelled", "declined", "failed", "expired"].includes(attempt.status))) ? <button type="button" className={buttonClass} disabled={busy || verifying} onClick={() => { requestedVerification.current = true; setCheckingStopped(false); setRevision(value => value + 1); }}>{t("Check status", "ពិនិត្យស្ថានភាព")}</button> : null}
        {kind !== "payway" && attempt && ["pending", "prepared", "submitted"].includes(attempt.status) && attempt.application !== "review" ?
          <CancelPaymentButton key={`${kind}:${attempt.id}:${attempt.businessId}`} kind={kind} paymentId={attempt.id} businessId={attempt.businessId} submitted={attempt.status === "submitted"}
            onResult={outcome => {
              if (outcome === "cancelled") window.location.assign("/dashboard/subscription");
              else { setAttempt(saved => saved ? { ...saved, status: "recovery_required", application: "review" } : saved); setRevision(value => value + 1); }
            }} /> : null}
      </div>
      {kind === "payway" && pending && !attempt?.checkoutSessionClosedAt && remaining !== 0 ? <div data-checkout-actions className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || verifying || Boolean(attempt?.checkoutSessionClosedAt) || remaining === 0}
          onClick={() => void endCheckoutSession()} className={`${buttonClass} text-slate-600`}>{busy ? t("Cancelling…", "កំពុងបោះបង់…") : t("Cancel", "បោះបង់")}</button>
        {checking && automaticChecking && !busy ? <p data-automatic-payment-check role="status" aria-live="polite" className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 text-center text-xs font-medium text-teal-700">
          <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-teal-100 border-t-teal-600 motion-safe:animate-spin motion-reduce:animate-none" />
          {t("Checking payment automatically…", "កំពុងពិនិត្យការទូទាត់ដោយស្វ័យប្រវត្តិ…")}
        </p> : null}
      </div> : null}
    </div>
  </section>;
}
