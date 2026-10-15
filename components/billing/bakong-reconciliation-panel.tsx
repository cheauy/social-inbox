"use client";
import { useEffect, useRef, useState } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
type Item = { id: string; businessId: string; workspaceName: string; amount: string; currency: string; environment: string;
  state: string; reference: string; transactionReference: string | null; reason: string | null };
export function BakongReconciliationPanel() {
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  const [items, setItems] = useState<Item[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(false), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    async function load() {
      setLoading(true); setError(false);
      try {
        const response = await fetch("/api/bakong/admin", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error();
        if (!controller.signal.aborted) { setItems(result.items); setCursor(result.nextCursor); }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { if (!controller.signal.aborted) setLoading(false); if (active.current === controller) active.current = null; }
    }
    void load(); return () => { controller.abort(); active.current?.abort(); active.current = null; };
  }, [revision]);
  async function act(id?: string) {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setBusy(id ?? "more"); setError(false);
    try {
      const response = await fetch(id ? "/api/bakong/admin" : `/api/bakong/admin?before=${encodeURIComponent(cursor ?? "")}`,
        { method: id ? "POST" : "GET", cache: "no-store", signal: controller.signal,
          ...(id ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: id, action: "reconcile" }) } : {}) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error();
      if (controller.signal.aborted) return;
      if (id) setRevision(value => value + 1);
      else { setItems(previous => [...new Map([...previous, ...result.items].map(item => [item.id, item])).values()]); setCursor(result.nextCursor); }
    } catch { if (!controller.signal.aborted) setError(true); }
    finally { if (active.current === controller) { active.current = null; setBusy(null); } }
  }
  return <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <h2 className="font-bold text-slate-950">Bakong KHQR</h2>
    <p className="mt-1 text-sm text-slate-500">{t("Payment reconciliation", "ផ្ទៀងផ្ទាត់ការទូទាត់")}</p>
    {loading ? <p role="status" className="mt-3 text-sm">{t("Loading…", "កំពុងផ្ទុក…")}</p> : null}
    {error ? <div role="alert" className="mt-3 text-sm text-red-700">{t("Unable to load payments.", "មិនអាចផ្ទុកការទូទាត់។")} <button type="button" className="min-h-11 underline" onClick={() => setRevision(value => value + 1)}>{t("Try again", "ព្យាយាមម្ដងទៀត")}</button></div> : null}
    {!loading && !error && !items.length ? <p className="mt-3 text-sm text-slate-500">{t("No pending payments", "គ្មានការទូទាត់កំពុងរង់ចាំ")}</p> : null}
    <ul className="mt-3 divide-y divide-slate-100">{items.map(item => <li key={item.id} className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-sm"><p className="break-words font-semibold">{item.workspaceName} · {item.currency} {item.amount}</p>
        <p className="mt-1 text-xs text-slate-500">{item.environment === "sandbox" ? t("Test payment", "ការទូទាត់សាកល្បង") : t("Production", "ការទូទាត់ពិត")} · {item.state}</p>
        <p className="mt-1 break-all text-xs">{item.reference}</p>
        {item.transactionReference ? <p className="mt-1 break-all text-xs text-slate-500">{item.transactionReference}</p> : null}
        {item.reason ? <p className="mt-1 break-words text-xs text-amber-800">{item.reason}</p> : null}
      </div>
      <button type="button" className="min-h-11 shrink-0 rounded-xl border border-slate-200 px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50" disabled={busy !== null || loading} onClick={() => void act(item.id)}>{busy === item.id ? t("Checking…", "កំពុងពិនិត្យ…") : t("Reconcile", "ផ្ទៀងផ្ទាត់")}</button>
    </li>)}</ul>
    {cursor ? <button type="button" className="mt-3 min-h-11 rounded-xl border px-4 text-sm" disabled={busy !== null} onClick={() => void act()}>{t("Load more", "ផ្ទុកបន្ថែម")}</button> : null}
  </section>;
}
