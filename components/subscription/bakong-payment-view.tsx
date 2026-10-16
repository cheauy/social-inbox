"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { createClient } from "@/lib/supabase/client";
import type { BakongPaymentView as Payment } from "@/lib/bakong/types";

const button = "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50";
export function BakongPaymentView({ attemptId, businessId, qrClosed = false }: { attemptId: string; businessId?: string | null; qrClosed?: boolean }) {
  const router = useRouter();
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState(false), [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0), [serverNow, setServerNow] = useState(0);
  const active = useRef<AbortController | null>(null);
  const identity = useRef<{ userId: string; memberId: string; expiresAt: string } | null>(null);
  const anchor = useRef<{ server: number; client: number } | null>(null);
  const latest = useRef<Payment | null>(null), closing = useRef(false);
  const automaticChecks = useRef(0);
  const endpoint = `/api/bakong/payments/${encodeURIComponent(attemptId)}?purchase_business=${encodeURIComponent(businessId ?? "")}`;
  const accept = useCallback((saved: Payment, requestedAt: number) => {
    if (saved.id !== attemptId || saved.businessId !== businessId || !saved.userId || !saved.memberId ||
        !Number.isFinite(Date.parse(saved.serverTime)) || !Number.isFinite(Date.parse(saved.expiresAt)) ||
        (identity.current && (saved.userId !== identity.current.userId || saved.memberId !== identity.current.memberId || saved.expiresAt !== identity.current.expiresAt))) throw new Error("Payment identity changed");
    identity.current = { userId: saved.userId, memberId: saved.memberId, expiresAt: saved.expiresAt };
    const client = performance.now(), previous = anchor.current;
    // Count response transit conservatively; rechecks must never extend the countdown.
    const server = Math.max(Date.parse(saved.serverTime) + Math.max(0, client - requestedAt), previous ? previous.server + client - previous.client : 0);
    anchor.current = { server, client }; latest.current = saved;
    setServerNow(server); setPayment(saved); setError(false);
  }, [attemptId, businessId]);

  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    async function load() {
      const requestedAt = performance.now();
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.success || !result.attempt) throw new Error();
        if (!controller.signal.aborted && active.current === controller) accept(result.attempt, requestedAt);
      } catch { if (!controller.signal.aborted) { setPayment(null); setError(true); } }
      finally { if (active.current === controller) active.current = null; }
    }
    void load();
    const { data } = createClient().auth.onAuthStateChange(event => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      active.current?.abort(); active.current = null; identity.current = null; latest.current = null; anchor.current = null; setPayment(null); setError(true);
    });
    const timer = setInterval(() => { const clock = anchor.current; if (clock) setServerNow(clock.server + performance.now() - clock.client); }, 1000);
    const recheck = () => { if (!document.hidden && navigator.onLine !== false && !active.current) setRevision(value => value + 1); };
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => { controller.abort(); active.current?.abort(); active.current = null; data.subscription.unsubscribe(); clearInterval(timer); window.removeEventListener("online", recheck); document.removeEventListener("visibilitychange", recheck); };
  }, [endpoint, accept, revision]);

  const check = useCallback(async () => {
    if (closing.current || active.current || navigator.onLine === false) return;
    const controller = new AbortController(); active.current = controller;
    const requestedAt = performance.now();
    setBusy(true); setError(false);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId, action: "check" }) });
      const result = await response.json();
      if (!response.ok || !result.success || !result.attempt) throw new Error();
      if (!controller.signal.aborted && active.current === controller) accept(result.attempt, requestedAt);
    } catch { if (!controller.signal.aborted) { setPayment(null); setError(true); } }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }, [endpoint, businessId, accept]);

  useEffect(() => {
    const saved = latest.current, clock = anchor.current;
    if (qrClosed || closing.current || !saved || !clock || saved.state !== "pending") return;
    const close = () => {
      if (closing.current || latest.current?.state !== "pending") return;
      closing.current = true;
      setServerNow(Math.max(Date.parse(saved.expiresAt), clock.server + performance.now() - clock.client));
      // Closing a QR is navigation only: the saved obligation and reconciliation remain intact.
      router.replace(`/dashboard/subscription?bakong_closed=${encodeURIComponent(attemptId)}&purchase_business=${encodeURIComponent(saved.businessId)}`);
    };
    const remaining = Date.parse(saved.expiresAt) - (clock.server + performance.now() - clock.client);
    if (remaining <= 0) { close(); return; }
    const timer = setTimeout(close, remaining);
    return () => clearTimeout(timer);
  }, [payment, qrClosed, router, attemptId]);

  useEffect(() => {
    if (!payment || !payment.canCheck || automaticChecks.current >= 3 || payment.automaticChecksRemaining <= 0 || !["pending", "verified"].includes(payment.state)) return;
    const delay = Math.max(300000, Date.parse(payment.nextCheckAt) - Date.parse(payment.serverTime));
    const timer = setTimeout(() => { if (!document.hidden && navigator.onLine !== false) { automaticChecks.current += 1; void check(); } }, delay);
    return () => clearTimeout(timer);
  }, [payment, check]);

  async function continueToSubscription() {
    if (!payment || active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(true);
    try {
      const response = await fetch("/api/workspaces/switch", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: payment.businessId }) });
      const result = await response.json();
      if (!response.ok || !result.success || result.businessId !== payment.businessId) throw new Error();
      if (!controller.signal.aborted) window.location.assign("/dashboard/subscription");
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (active.current === controller) { active.current = null; setBusy(false); } }
  }

  const now = serverNow;
  const expires = payment ? Math.max(0, Math.ceil((Date.parse(payment.expiresAt) - now) / 1000)) : 0;
  const cooldown = payment ? Math.max(0, Math.ceil((Date.parse(payment.nextCheckAt) - now) / 1000)) : 0;
  const title = !payment ? t("Payment status", "ស្ថានភាពទូទាត់") : payment.state === "test_paid" ? t("Test payment confirmed", "បានបញ្ជាក់ការទូទាត់សាកល្បង") :
    payment.application === "active" ? t("Subscription active", "ការជាវសកម្ម") : payment.state === "review" ? t("Payment needs review", "ការទូទាត់ត្រូវការពិនិត្យ") :
    payment.state === "verified" || payment.state === "applied" ? t("Payment received", "បានទទួលការទូទាត់") : t("Waiting for payment", "កំពុងរង់ចាំការទូទាត់");
  return <section className="mx-auto w-full max-w-xl space-y-4 p-4 sm:p-6" aria-busy={busy}>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Bakong KHQR</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-950">{title}</h1>
      {payment?.environment === "sandbox" ? <p className="mt-3 rounded-lg bg-amber-50 p-3 font-bold text-amber-800">{t("Test payment · no paid access", "ការទូទាត់សាកល្បង · គ្មានសិទ្ធិបង់ប្រាក់")}</p> : null}
      {!payment && !error ? <p role="status" className="mt-4 text-sm">{t("Loading…", "កំពុងផ្ទុក…")}</p> : null}
      {payment ? <>
        <p className="mt-3 break-words text-sm text-slate-600">{payment.workspaceName} · {payment.planCode} · {payment.billingCycle}</p>
        <p className="mt-2 text-3xl font-bold tabular-nums">{payment.currency} {payment.amount}</p>
        <p className="mt-2 break-all text-xs text-slate-500">{t("Reference", "លេខយោង")}: {payment.reference}</p>
        {payment.transactionReference ? <p className="mt-2 break-all text-xs text-slate-500">{t("Transaction", "ប្រតិបត្តិការ")}: {payment.transactionReference}</p> : null}
        {payment.state === "pending" && !qrClosed && expires > 0 && payment.qrImage ? <div className="mt-5 text-center">
          {/* The QR is private attempt data, delivered as an inline image; no external asset request. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mx-auto h-auto w-full max-w-[280px]" width={280} height={280} src={payment.qrImage} alt={t("Scan Bakong KHQR to pay", "ស្កេន Bakong KHQR ដើម្បីទូទាត់")} />
          <p className="mt-2 text-sm tabular-nums">{Math.floor(expires / 60)}:{String(expires % 60).padStart(2, "0")}</p>
        </div> : null}
        {payment.state === "pending" && (qrClosed || expires === 0) && !payment.reconciliationRequired ? <p role="status" className="mt-4 text-sm text-amber-800">{t("QR closed. Your payment attempt is saved for verification. Do not pay again.", "QR បានបិទ។ ការទូទាត់របស់អ្នកត្រូវបានរក្សាទុកសម្រាប់ផ្ទៀងផ្ទាត់។ កុំទូទាត់ម្ដងទៀត។")}</p> : null}
        {payment.state === "verified" ? <p className="mt-4 text-sm">{t("Activation pending. No new payment needed.", "កំពុងរង់ចាំបើកដំណើរការ។ មិនចាំបាច់បង់ម្ដងទៀត។")}</p> : null}
        {payment.state === "review" ? <p className="mt-4 text-sm">{t("TENH support must review this payment. Do not pay again.", "ក្រុម TENH ត្រូវពិនិត្យការទូទាត់នេះ។ កុំបង់ម្ដងទៀត។")}</p> : null}
        {payment.application === "historical" ? <p className="mt-4 text-sm">{t("This payment belongs to an earlier subscription period.", "ការទូទាត់នេះជារបស់រយៈពេលជាវមុន។")}</p> : null}
        {payment.reconciliationRequired ? <p role="status" className="mt-4 text-sm text-amber-800">{t("This payment is unresolved. TENH support must review the saved attempt. Do not pay again.", "ការទូទាត់នេះមិនទាន់ច្បាស់លាស់។ សូមទាក់ទង TENH ដើម្បីពិនិត្យ។ កុំបង់ប្រាក់ម្តងទៀត។")}</p> : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {payment.canCheck ? <button type="button" className={button} disabled={busy || (payment.state !== "verified" && cooldown > 0)} onClick={() => void check()}>{t("Check payment", "ពិនិត្យការទូទាត់")}{cooldown > 0 && payment.state !== "verified" ? ` · ${Math.ceil(cooldown / 60)}m` : ""}</button> : null}
          {payment.application === "active" ? <button type="button" className={button} disabled={busy} onClick={() => void continueToSubscription()}>{t("Continue", "បន្ត")}</button> : null}
          {payment.invoiceId ? <Link className={button} href={`/dashboard/subscription/invoices/${encodeURIComponent(payment.invoiceId)}`}>{t("TENH Receipt", "បង្កាន់ដៃ TENH")}</Link> : null}
        </div>
      </> : null}
      {error ? <div role="alert" className="mt-4 text-sm text-red-700"><p>{t("Unable to check payment. Your attempt is saved.", "មិនអាចពិនិត្យការទូទាត់។ ប្រតិបត្តិការរបស់អ្នកត្រូវបានរក្សាទុក។")}</p><button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => setRevision(value => value + 1)}>{t("Try again", "ព្យាយាមម្ដងទៀត")}</button></div> : null}
    </div>
    <Link className={button} href="/dashboard/subscription">{t("Back to subscription", "ត្រឡប់ទៅការជាវ")}</Link>
  </section>;
}
