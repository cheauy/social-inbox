"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TENH_BILLING_CYCLES,
  TENH_CUSTOM_PRICING,
  formatUsdFromCents,
} from "@/lib/subscription/plan-catalog";
import type { CustomUpgradeQuote } from "@/lib/subscription/custom-upgrade";

type Props = {
  open: boolean;
  currentConnections: number;
  currentUsers: number;
  currentBillingCycle: string | null;
  currentPeriodEnd: string | null;
  onClose: () => void;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

export function CustomUpgradeModal({
  open,
  currentConnections,
  currentUsers,
  currentBillingCycle,
  currentPeriodEnd,
  onClose,
}: Props) {
  const router = useRouter();
  const currentCycle = useMemo(
    () => TENH_BILLING_CYCLES.find((item) => item.id === currentBillingCycle) ?? null,
    [currentBillingCycle],
  );
  const allowedCycles = useMemo(
    () => currentCycle
      ? TENH_BILLING_CYCLES.filter((item) => item.months >= currentCycle.months)
      : TENH_BILLING_CYCLES,
    [currentCycle],
  );

  const [connections, setConnections] = useState(currentConnections);
  const [users, setUsers] = useState(currentUsers);
  const [cycle, setCycle] = useState(currentBillingCycle ?? "monthly");
  const [quote, setQuote] = useState<CustomUpgradeQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConnections(currentConnections);
    setUsers(currentUsers);
    setCycle(currentBillingCycle ?? "monthly");
    setQuote(null);
    setError(null);
  }, [open, currentConnections, currentUsers, currentBillingCycle]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          connections: String(connections),
          users: String(users),
          cycle,
        });
        const response = await fetch(`/api/subscription/custom-upgrade/quote?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json() as { success?: boolean; quote?: CustomUpgradeQuote; error?: string };
        if (!response.ok || !result.success || !result.quote) {
          throw new Error(result.error ?? "Unable to calculate this upgrade.");
        }
        setQuote(result.quote);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") {
          setQuote(null);
          setError(reason instanceof Error ? reason.message : "Unable to calculate this upgrade.");
        }
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, connections, users, cycle]);

  if (!open) return null;

  const canContinue = Boolean(quote && quote.totalCents > 0 && !loading);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[28px] bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Custom upgrade</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-950">Upgrade your current subscription</h2>
            <p className="mt-1 text-sm text-slate-500">Keep the same Subscription ID, channels, team, customers, messages, and history.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-500 hover:bg-slate-200">×</button>
        </div>

        <div className="space-y-6 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-bold text-slate-900">Connections</p>
              <p className="mt-1 text-xs text-slate-500">Current {currentConnections}. Upgrade can only increase.</p>
              <div className="mt-4 flex items-center gap-3">
                <button type="button" disabled={connections <= currentConnections} onClick={() => setConnections((v) => Math.max(currentConnections, v - 1))} className="h-10 w-10 rounded-xl border border-slate-300 font-bold disabled:opacity-30">−</button>
                <div className="min-w-16 text-center text-xl font-bold">{connections}</div>
                <button type="button" disabled={connections >= TENH_CUSTOM_PRICING.maxConnections} onClick={() => setConnections((v) => Math.min(TENH_CUSTOM_PRICING.maxConnections, v + 1))} className="h-10 w-10 rounded-xl border border-slate-300 font-bold disabled:opacity-30">+</button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-bold text-slate-900">Team users</p>
              <p className="mt-1 text-xs text-slate-500">Current {currentUsers}. Upgrade can only increase.</p>
              <div className="mt-4 flex items-center gap-3">
                <button type="button" disabled={users <= currentUsers} onClick={() => setUsers((v) => Math.max(currentUsers, v - 1))} className="h-10 w-10 rounded-xl border border-slate-300 font-bold disabled:opacity-30">−</button>
                <div className="min-w-16 text-center text-xl font-bold">{users}</div>
                <button type="button" disabled={users >= TENH_CUSTOM_PRICING.maxUsers} onClick={() => setUsers((v) => Math.min(TENH_CUSTOM_PRICING.maxUsers, v + 1))} className="h-10 w-10 rounded-xl border border-slate-300 font-bold disabled:opacity-30">+</button>
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-bold text-slate-900">Duration</p>
            <p className="mt-1 text-xs text-slate-500">You can stay on the current duration or move to a longer duration. Shorter duration is not available during Upgrade.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {allowedCycles.map((item) => (
                <button key={item.id} type="button" onClick={() => setCycle(item.id)} className={`rounded-full border px-4 py-2 text-sm font-semibold ${cycle === item.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-600"}`}>
                  {item.label}{item.discountBasisPoints ? ` · -${item.discountBasisPoints / 100}%` : ""}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p><span className="text-slate-500">Connections</span><br/><b>{currentConnections} → {connections}</b></p>
              <p><span className="text-slate-500">Team users</span><br/><b>{currentUsers} → {users}</b></p>
              <p><span className="text-slate-500">Duration</span><br/><b>{currentCycle?.label ?? "—"} → {allowedCycles.find((x) => x.id === cycle)?.label ?? cycle}</b></p>
              <p><span className="text-slate-500">Expires</span><br/><b>{formatDate(currentPeriodEnd)} → {formatDate(quote?.newPeriodEnd ?? currentPeriodEnd)}</b></p>
            </div>

            {quote ? (
              <div className="mt-5 space-y-2 border-t border-blue-200 pt-4 text-sm">
                <div className="flex justify-between"><span>Capacity adjustment · {quote.remainingDays} day{quote.remainingDays === 1 ? "" : "s"} remaining</span><b>{formatUsdFromCents(quote.capacityProrationCents)}</b></div>
                <div className="flex justify-between"><span>Duration extension · +{quote.extensionMonths} month{quote.extensionMonths === 1 ? "" : "s"}</span><b>{formatUsdFromCents(quote.durationExtensionCents)}</b></div>
                <div className="flex justify-between border-t border-blue-200 pt-3 text-base"><b>Total upgrade</b><b>{formatUsdFromCents(quote.totalCents)}</b></div>
              </div>
            ) : null}
          </div>

          {error ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div> : null}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700">Cancel</button>
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => {
                const params = new URLSearchParams({
                  plan: "custom",
                  cycle,
                  connections: String(connections),
                  users: String(users),
                  upgrade: "custom",
                });
                router.push(`/dashboard/subscription/payment?${params.toString()}`);
              }}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"
            >
              {loading ? "Calculating..." : "Continue to payment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
