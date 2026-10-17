"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { createClient } from "@/lib/supabase/client";
import type { BakongPaymentView as Payment } from "@/lib/bakong/types";
import { CancelPaymentButton } from "./cancel-payment-button";
import { PaymentSuccessCard } from "./payment-success-card";
import { CustomerPaymentReference } from "./customer-payment-reference";

const button = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50";
export function BakongPaymentView({ attemptId, businessId, qrClosed = false }: { attemptId: string; businessId?: string | null; qrClosed?: boolean }) {
  const router = useRouter();
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [navigationError, setNavigationError] = useState(false);
  const [revision, setRevision] = useState(0), [serverNow, setServerNow] = useState(0);
  const active = useRef<AbortController | null>(null);
  const identity = useRef<{ userId: string; memberId: string; createdAt: string; expiresAt: string } | null>(null);
  const anchor = useRef<{ server: number; client: number } | null>(null);
  const verificationClock = useRef<{ server: number; client: number } | null>(null);
  const latest = useRef<Payment | null>(null), closing = useRef(false);
  const refreshRequested = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null), dismissed = useRef(false);
  const titleId = useId(), descriptionId = useId();
  const showSuccess = Boolean(!error && payment && !payment.reconciliationRequired &&
    ((payment.state === "applied" && payment.application === "active" && payment.environment === "production") ||
      (payment.state === "test_paid" && payment.environment === "sandbox")));
  const closeWindow = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true; closing.current = true; refreshRequested.current = false;
    active.current?.abort();
    dialog.current?.close();
    if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    router.replace("/dashboard/subscription");
  }, [router]);
  useEffect(() => {
    const current = dialog.current, previous = document.activeElement;
    if (!current) return;
    if (previous instanceof window.HTMLElement && previous !== document.body && !current.contains(previous)) previousFocus.current = previous;
    if (!current.open) current.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      current.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, [showSuccess]);
  const endpoint = `/api/bakong/payments/${encodeURIComponent(attemptId)}?purchase_business=${encodeURIComponent(businessId ?? "")}`;
  const accept = useCallback((saved: Payment, requestedAt: number) => {
    if (saved.id !== attemptId || saved.businessId !== businessId || !saved.userId || !saved.memberId ||
        !Number.isFinite(Date.parse(saved.serverTime)) || !Number.isFinite(Date.parse(saved.createdAt)) || !Number.isFinite(Date.parse(saved.nextCheckAt)) || !Number.isFinite(Date.parse(saved.expiresAt)) ||
        (identity.current && (saved.userId !== identity.current.userId || saved.memberId !== identity.current.memberId || saved.createdAt !== identity.current.createdAt || saved.expiresAt !== identity.current.expiresAt))) throw new Error("Payment identity changed");
    identity.current = { userId: saved.userId, memberId: saved.memberId, createdAt: saved.createdAt, expiresAt: saved.expiresAt };
    const client = performance.now(), previous = anchor.current;
    // Count response transit conservatively; rechecks must never extend the countdown.
    const server = Math.max(Date.parse(saved.serverTime) + Math.max(0, client - requestedAt), previous ? previous.server + client - previous.client : 0);
    anchor.current = { server, client }; latest.current = saved;
    // Expiry is conservative; verification waits from the returned server time without adding transit.
    verificationClock.current = { server: Date.parse(saved.serverTime), client };
    setServerNow(server); setPayment(saved); setError(false);
  }, [attemptId, businessId]);
  const finishRequest = useCallback((controller: AbortController) => {
    if (active.current !== controller) return;
    active.current = null; setBusy(false);
    if (refreshRequested.current) { refreshRequested.current = false; setRevision(value => value + 1); }
  }, []);

  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    async function load() {
      const requestedAt = performance.now();
      let timedOut = false;
      const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.success || !result.attempt) throw new Error();
        if (!controller.signal.aborted && active.current === controller) accept(result.attempt, requestedAt);
      } catch { if (!controller.signal.aborted || timedOut) { setPayment(null); setError(true); } }
      finally { clearTimeout(deadline); finishRequest(controller); }
    }
    void load();
    const { data } = createClient().auth.onAuthStateChange(event => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      active.current?.abort(); active.current = null; refreshRequested.current = false; identity.current = null; latest.current = null; anchor.current = null; verificationClock.current = null; setPayment(null); setBusy(false); setError(true);
    });
    const timer = setInterval(() => { const clock = anchor.current; if (clock) setServerNow(clock.server + performance.now() - clock.client); }, 1000);
    const recheck = () => {
      if (document.hidden || navigator.onLine === false) return;
      if (active.current) refreshRequested.current = true;
      else setRevision(value => value + 1);
    };
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => { controller.abort(); active.current?.abort(); active.current = null; data.subscription.unsubscribe(); clearInterval(timer); window.removeEventListener("online", recheck); document.removeEventListener("visibilitychange", recheck); };
  }, [endpoint, accept, finishRequest, revision]);

  const check = useCallback(async (automatic = false) => {
    if (closing.current || active.current || navigator.onLine === false || !latest.current?.canCheck || !identity.current) return;
    if (automatic && latest.current.state === "pending" && (qrClosed || ["cancelled", "expired"].includes(latest.current.checkout))) return;
    const controller = new AbortController(); active.current = controller;
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
    try {
      const verify = async () => {
        if (controller.signal.aborted || closing.current) return;
        if (automatic) {
          // A queued/returning tab reads the current lease and ledger before requesting verification.
          const requestedAt = performance.now();
          const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
          const result = await response.json();
          if (!response.ok || !result.success || !result.attempt) throw new Error();
          if (controller.signal.aborted || active.current !== controller) return;
          accept(result.attempt, requestedAt);
          const saved = latest.current!, clock = verificationClock.current!;
          const now = clock.server + performance.now() - clock.client;
          const due = Math.max(Date.parse(saved.createdAt) + 300000, Date.parse(saved.nextCheckAt));
          if (!saved.canCheck || document.hidden || navigator.onLine === false ||
            (saved.state !== "verified" && (saved.state !== "pending" || qrClosed || ["cancelled", "expired"].includes(saved.checkout) || saved.automaticChecksRemaining <= 0 || due > now || Date.parse(saved.expiresAt) <= now))) return;
        }
        if (controller.signal.aborted || closing.current) return;
        const requestedAt = performance.now(); setBusy(true); setError(false);
        const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId, action: "check" }) });
        const result = await response.json();
        if (!response.ok || !result.success || !result.attempt) throw new Error();
        if (!controller.signal.aborted && active.current === controller) accept(result.attempt, requestedAt);
      };
      // Other browsers/devices still use the authoritative database lease and lifetime inquiry cap.
      if (navigator.locks) await navigator.locks.request(`tenh-khqr:${businessId}:${attemptId}`, { signal: controller.signal }, verify);
      else await verify();
    } catch { if (!controller.signal.aborted || timedOut) { setPayment(null); setError(true); } }
    finally { clearTimeout(deadline); finishRequest(controller); }
  }, [endpoint, businessId, attemptId, accept, finishRequest, qrClosed]);

  useEffect(() => {
    const saved = latest.current, clock = anchor.current;
    if (qrClosed || closing.current || !saved || !clock || saved.state !== "pending") return;
    const close = () => {
      if (closing.current || latest.current?.state !== "pending") return;
      closing.current = true;
      setServerNow(Math.max(Date.parse(saved.expiresAt), clock.server + performance.now() - clock.client));
      // Expiry closes this checkout only. Its record stays in Billing history; a new plan selection issues a new QR.
      router.replace(`/dashboard/subscription?bakong_closed=${encodeURIComponent(attemptId)}&purchase_business=${encodeURIComponent(businessId ?? "")}`);
    };
    const remaining = Date.parse(saved.expiresAt) - (clock.server + performance.now() - clock.client);
    if (remaining <= 0) { close(); return; }
    const timer = setTimeout(close, remaining);
    return () => clearTimeout(timer);
  }, [payment, qrClosed, router, attemptId, businessId]);

  useEffect(() => {
    const clock = verificationClock.current;
    if (!payment || !clock || !payment.canCheck || payment.automaticChecksRemaining <= 0 || !["pending", "verified"].includes(payment.state)) return;
    // Closed QRs have no reserved future inquiries. Saved status stays readable; reconciliation is explicit.
    if (payment.state === "pending" && (qrClosed || ["cancelled", "expired"].includes(payment.checkout))) return;
    const due = Math.max(Date.parse(payment.createdAt) + 300000, Date.parse(payment.nextCheckAt));
    const delay = Math.max(0, due - (clock.server + performance.now() - clock.client));
    const timer = setTimeout(() => { if (!document.hidden && navigator.onLine !== false) void check(true); }, delay);
    return () => clearTimeout(timer);
  }, [payment, check, qrClosed]);

  async function continueToSubscription(destination: "/dashboard/inbox" | "/dashboard/subscription" = "/dashboard/subscription") {
    if (!payment || active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true); setNavigationError(false);
    try {
      const response = await fetch("/api/workspaces/switch", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: payment.businessId }) });
      const result = await response.json();
      if (!response.ok || !result.success || result.businessId !== payment.businessId) throw new Error();
      if (!controller.signal.aborted) window.location.assign(destination);
    } catch { if (!controller.signal.aborted) setNavigationError(true); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }

  const now = serverNow;
  const expires = payment ? Math.max(0, Math.ceil((Date.parse(payment.expiresAt) - now) / 1000)) : 0;
  const cooldown = payment ? Math.max(0, Math.ceil((Date.parse(payment.nextCheckAt) - now) / 1000)) : 0;
  const checkoutClosed = payment?.checkout === "expired" || payment?.checkout === "cancelled";
  const showQr = Boolean(payment && payment.state === "pending" && !checkoutClosed && !qrClosed && expires > 0 && payment.qrImage);
  // An unpaid checkout that expired or was cancelled. Settlement is not asserted; a late payment still goes to review.
  const closed = Boolean(payment && payment.state === "pending" && !payment.transactionReference && !payment.reconciliationRequired && (checkoutClosed || qrClosed || expires === 0));
  const checking = busy && !error && payment?.state === "pending" && !qrClosed && expires > 0 &&
    payment.canCheck && payment.automaticChecksRemaining > 0 && !payment.reconciliationRequired;
  const waiting = showQr && !error && !payment?.reconciliationRequired && !checking;
  const canRecover = payment?.canCheck && (payment.state !== "pending" || checkoutClosed || qrClosed || expires <= 600);
  const title = error ? t("Unable to confirm payment", "មិនអាចបញ្ជាក់ការទូទាត់") : checking ? t("Checking payment…", "កំពុងពិនិត្យការទូទាត់…") :
    closed && payment?.checkout === "cancelled" ? t("Payment cancelled", "បានបោះបង់ការទូទាត់") : closed ? t("QR expired", "QR ផុតកំណត់") : !payment ? t("Payment status", "ស្ថានភាពទូទាត់") : payment.state === "test_paid" ? t("Test payment confirmed", "បានបញ្ជាក់ការទូទាត់សាកល្បង") :
    (payment.state === "review" || payment.reconciliationRequired) ? t("Payment needs review", "ការទូទាត់ត្រូវការពិនិត្យ") :
    payment.state === "verified" || payment.state === "applied" ? t("Payment received", "បានទទួលការទូទាត់") : t("Waiting for payment", "កំពុងរង់ចាំការទូទាត់");
  if (showSuccess && payment) {
    const returnTo = `/dashboard/subscription/payment?${new URLSearchParams({ bakong_attempt: attemptId, purchase_business: payment.businessId })}`;
    return <PaymentSuccessCard workspace={payment.workspaceName} planCode={payment.planCode} billingCycle={payment.billingCycle}
      amount={Number(payment.amount)} currency={payment.currency} provider="bakong" environment={payment.environment}
      reference={payment.customerReference ?? null} busy={busy} error={navigationError}
      receiptHref={payment.invoiceId ? `/dashboard/subscription/invoices/${encodeURIComponent(payment.invoiceId)}?return_to=${encodeURIComponent(returnTo)}` : null}
      onNavigate={destination => void continueToSubscription(destination)} />;
  }
  return <dialog ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
    tabIndex={-1}
    onCancel={event => { if (event.target === event.currentTarget) { event.preventDefault(); closeWindow(); } }}
    onKeyDown={event => {
      if (event.defaultPrevented || event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); event.currentTarget.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) { event.preventDefault(); first.focus(); }
    }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2*max(0.5rem,env(safe-area-inset-top),env(safe-area-inset-bottom)))] w-[calc(100%-2*max(0.5rem,env(safe-area-inset-left),env(safe-area-inset-right)))] max-w-md flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl open:flex backdrop:bg-slate-950/45 backdrop:backdrop-blur-[2px]">
    <h2 id={titleId} className="sr-only">{t("Scan to pay", "ស្កេនដើម្បីទូទាត់")}</h2>
    <p id={descriptionId} className="sr-only">{t("Closing this window keeps your saved payment unchanged.", "ការបិទផ្ទាំងនេះរក្សាការទូទាត់ដែលបានរក្សាទុកដដែល។")}</p>
    <div className="flex shrink-0 items-center justify-end gap-2 px-2 pt-2 sm:px-4">
      {showQr ? <p className="text-right text-xs tabular-nums text-slate-500 sm:text-sm">{t("Expires in", "ផុតកំណត់ក្នុង")} {Math.floor(expires / 60)}:{String(expires % 60).padStart(2, "0")}</p> : null}
      <button ref={closeButton} type="button" onClick={closeWindow} aria-label={t("Close payment window", "បិទផ្ទាំងទូទាត់")}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        <span aria-hidden="true" className="text-2xl leading-none">×</span>
      </button>
    </div>
    <section className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-2 pb-4 sm:px-6 sm:pb-6" aria-busy={busy}>
    <div className="min-w-0">
      <div className="mt-2 flex items-center justify-end gap-3">
        {payment?.state === "pending" && !closed && !payment.reconciliationRequired && !busy && !error ? <CancelPaymentButton key={`${payment.id}:${payment.businessId}`} kind="bakong" paymentId={payment.id} businessId={payment.businessId}
          onResult={outcome => {
            if (outcome === "checkout_closed" || outcome === "expired") closeWindow();
            else setRevision(value => value + 1);
          }} /> : null}
      </div>
      {payment?.environment === "sandbox" ? <p className="mt-3 rounded-lg bg-amber-50 p-3 font-bold text-amber-800">{t("Test payment · no paid access", "ការទូទាត់សាកល្បង · គ្មានសិទ្ធិបង់ប្រាក់")}</p> : null}
      {!payment && !error ? <p role="status" className="mt-4 text-sm">{t("Loading…", "កំពុងផ្ទុក…")}</p> : null}
      {payment ? <>
        {payment.reconciliationReason === "CANCELLATION_PAYMENT_REVIEW" ? <p role="status" className="mt-3 text-sm text-amber-800">{t("A payment arrived after this checkout was cancelled. TENH support will review it. Do not pay again.", "មានការទូទាត់មកដល់ក្រោយបោះបង់។ ក្រុម TENH នឹងពិនិត្យ។ កុំទូទាត់ម្ដងទៀត។")}</p> : null}
        {payment.reconciliationReason === "INQUIRY_LIMIT_REVIEW" ? <p role="status" className="mt-3 text-sm text-amber-800">{t("The verification limit has been reached. Your saved payment needs support review. Do not pay again.", "ដល់កម្រិតផ្ទៀងផ្ទាត់ហើយ។ ការបង់ប្រាក់ដែលបានរក្សាទុកត្រូវការជំនួយពិនិត្យ។ កុំបង់ម្តងទៀត។")}</p> : null}
        {!showQr ? <p className="mt-2 text-3xl font-bold tabular-nums">{payment.currency} {payment.amount}</p> : null}
        {showQr ? <figure aria-label={t("KHQR payment card", "កាតទូទាត់ KHQR")} className="mt-1 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
          <div className="relative flex justify-center bg-[#e2232f] py-4 sm:py-5">
            {/* Keep the supplied logo at its original aspect ratio and the QR itself untouched. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/khqr.png" width={1248} height={514} alt="KHQR" className="h-auto w-[120px] sm:w-[132px]" />
            <span aria-hidden="true" className="absolute right-0 top-full h-6 w-6 bg-[#e2232f] [clip-path:polygon(0_0,100%_0,100%_100%)]" />
          </div>
          <figcaption className="px-6 pb-5 pt-7 sm:px-7 sm:pt-8">
            {payment.recipientName ? <p className="break-words text-base font-medium leading-6 text-slate-700">{payment.recipientName}</p> : null}
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-slate-950" aria-label={payment.amount + " " + payment.currency}>
              <span className="min-w-0 break-all text-[40px] font-bold leading-tight tracking-tight tabular-nums sm:text-[44px]">{payment.amount}</span>
              <span className="text-lg font-semibold">{payment.currency}</span>
            </p>
          </figcaption>
          <div className="border-t border-dashed border-slate-200" />
          <div className="bg-white p-4 sm:p-6">
            <div className="mx-auto max-w-[304px] bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="mx-auto h-auto w-full max-w-[280px]" width={280} height={280} src={payment.qrImage ?? undefined} alt={t("Scan Bakong KHQR to pay", "ស្កេន Bakong KHQR ដើម្បីទូទាត់")} />
            </div>
          </div>
        </figure> : null}
        <div role="status" aria-live="polite" aria-atomic="true" className="mt-4 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm font-semibold text-slate-700">
          {checking || waiting ? <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2 border-slate-200 border-t-red-600 motion-safe:animate-spin motion-reduce:animate-none" /> : null}
          <p>{title}</p>
        </div>
        {closed ? <p role="status" className="mt-4 text-sm text-slate-700">{t("This QR is closed. Your saved payment remains available for verification. Do not pay again while it is unresolved.", "QR នេះបានបិទ។ ការទូទាត់ដែលបានរក្សាទុកនៅតែអាចផ្ទៀងផ្ទាត់បាន។ កុំទូទាត់ម្ដងទៀត ខណៈមិនទាន់ដោះស្រាយ។")}</p> : null}
        {payment.state === "verified" ? <p className="mt-4 text-sm">{t("Activation pending. No new payment needed.", "កំពុងរង់ចាំបើកដំណើរការ។ មិនចាំបាច់បង់ម្ដងទៀត។")}</p> : null}
        {payment.state === "review" ? <p className="mt-4 text-sm">{t("TENH support must review this payment. Do not pay again.", "ក្រុម TENH ត្រូវពិនិត្យការទូទាត់នេះ។ កុំបង់ម្ដងទៀត។")}</p> : null}
        {payment.application === "historical" ? <p className="mt-4 text-sm">{t("This payment belongs to an earlier subscription period.", "ការទូទាត់នេះជារបស់រយៈពេលជាវមុន។")}</p> : null}
        {payment.reconciliationRequired && !["INQUIRY_LIMIT_REVIEW", "CANCELLATION_PAYMENT_REVIEW"].includes(payment.reconciliationReason ?? "") ? <p role="status" className="mt-4 text-sm text-amber-800">{t("This payment is unresolved. TENH support must review the saved attempt. Do not pay again.", "ការទូទាត់នេះមិនទាន់ច្បាស់លាស់។ សូមទាក់ទង TENH ដើម្បីពិនិត្យ។ កុំបង់ប្រាក់ម្តងទៀត។")}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {canRecover && payment.state === "verified" ? <button type="button" className={button} disabled={busy} onClick={() => void check()}>{t("Retry activation", "ព្យាយាមបើកដំណើរការម្តងទៀត")}</button> : null}
          {canRecover && payment.state !== "verified" ? <details className="w-full text-sm text-slate-600">
            <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-blue-600">{t("Payment status not updated?", "ស្ថានភាពទូទាត់មិនទាន់អាប់ដេត?")}</summary>
            <button type="button" className={button} disabled={busy || cooldown > 0} onClick={() => void check()}>{t("Refresh status", "ផ្ទុកស្ថានភាពឡើងវិញ")}</button>
          </details> : null}
          {payment.invoiceId ? <Link className={button} href={`/dashboard/subscription/invoices/${encodeURIComponent(payment.invoiceId)}`}>{t("TENH Receipt", "បង្កាន់ដៃ TENH")}</Link> : null}
        </div>
        <details className="mt-3 text-xs text-slate-500">
          <summary className="min-h-11 cursor-pointer py-3 font-medium focus-visible:outline-2 focus-visible:outline-blue-600">{t("Payment details", "ព័ត៌មានការទូទាត់")}</summary>
          <p className="break-words">{payment.workspaceName} · {payment.planCode} · {payment.billingCycle}</p>
          <div className="mt-2">{t("Reference", "លេខយោង")}: <CustomerPaymentReference value={payment.customerReference} /></div>
          {payment.transactionReference ? <p className="mt-2 break-all">{t("Transaction", "ប្រតិបត្តិការ")}: {payment.transactionReference}</p> : null}
        </details>
      </> : null}
      {error ? <div role="alert" className="mt-4 text-sm text-red-700"><p>{t("Payment confirmation is temporarily unavailable. Your attempt is saved.", "ការបញ្ជាក់ការទូទាត់មិនអាចប្រើបានបណ្ដោះអាសន្ន។ ប្រតិបត្តិការរបស់អ្នកត្រូវបានរក្សាទុក។")}</p><button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => setRevision(value => value + 1)}>{t("Try again", "ព្យាយាមម្ដងទៀត")}</button></div> : null}
    </div>
    </section>
  </dialog>;
}
