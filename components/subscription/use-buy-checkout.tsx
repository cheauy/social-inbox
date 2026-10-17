"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BillingCycle, PlanCode } from "@/lib/subscription/plan-catalog";
import { SubscriptionPaymentView } from "./subscription-payment-view";

type Purchase = { planCode: PlanCode; billingCycle: BillingCycle; connections?: number; users?: number };
type Prepared = { purchase: Purchase; businessId: string; paymentUrl: string };

/** Run the existing checkout guards while the customer stays on their Buy button. */
export function useBuyCheckout() {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [planCode, setPlanCode] = useState<PlanCode | null>(null);
  const [manualHref, setManualHref] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const knownWorkspace = useRef<{ key: string; value: Prepared } | null>(null);
  const epoch = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const { data } = createClient().auth.onAuthStateChange(event => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      epoch.current += 1;
      request.current?.abort();
      knownWorkspace.current = null;
      active.current = false;
      setPrepared(null);
      setManualHref(null);
      setBusy(false);
      setOpened(false);
      setError(null);
    });
    return () => { mounted.current = false; request.current?.abort(); data.subscription.unsubscribe(); };
  }, []);

  const fail = useCallback((message: string) => {
    if (!mounted.current) return;
    setError(message);
    setPrepared(null);
    setBusy(false);
    active.current = false;
  }, []);
  const showAttempt = useCallback(() => {
    if (!mounted.current) return;
    setOpened(true);
    setBusy(false);
  }, []);

  async function start(purchase: Purchase) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setPlanCode(purchase.planCode);
    setError(null);
    const identity = epoch.current;
    const controller = new AbortController();
    request.current = controller;
    const key = JSON.stringify(purchase);
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      // A later preflight/plugin failure retries this known workspace, rather
      // than creating another unpaid workspace or another payment identity.
      let target = knownWorkspace.current?.key === key ? knownWorkspace.current.value : null;
      if (!target) {
        const response = await fetch("/api/workspaces/create-subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(purchase), signal: controller.signal });
        const result = await response.json() as { success?: boolean; error?: string; businessId?: string; paymentUrl?: string };
        if (!mounted.current || identity !== epoch.current || controller.signal.aborted) return;
        const url = new URL(result.paymentUrl ?? "", window.location.origin);
        const businessId = result.businessId ?? url.searchParams.get("purchase_business");
        if (!response.ok || !result.success || !result.paymentUrl || url.origin !== window.location.origin || url.pathname !== "/dashboard/subscription/payment" || !businessId || url.searchParams.get("purchase_business") !== businessId) {
          throw new Error(result.error ?? "Unable to prepare subscription checkout. Try again.");
        }
        target = { purchase, businessId, paymentUrl: `${url.pathname}${url.search}` };
        knownWorkspace.current = { key, value: target };
        setManualHref(target.paymentUrl);
      }
      if (mounted.current && identity === epoch.current && !controller.signal.aborted) setPrepared(target);
    } catch (failure) {
      if (mounted.current && identity === epoch.current) fail(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "Unable to prepare subscription checkout. Try again.");
    } finally { clearTimeout(timeout); }
  }

  return {
    start, busy, opened, error, planCode, manualHref,
    view: prepared ? <div data-buy-checkout className={opened ? "h-full min-h-0 overflow-y-auto" : "contents"}><SubscriptionPaymentView planCode={prepared.purchase.planCode} billingCycle={prepared.purchase.billingCycle}
      purchaseBusinessId={prepared.businessId} customConnections={prepared.purchase.connections} customUsers={prepared.purchase.users}
      inlineBuy onCheckoutOpened={showAttempt} onCheckoutError={fail} /></div> : null,
  };
}
