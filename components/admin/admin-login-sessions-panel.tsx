"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

export function AdminLoginSessionsPanel() {
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  const [days, setDays] = useState("");
  const [savedDays, setSavedDays] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [error, setError] = useState<"forbidden" | "verification" | "unavailable" | null>(null);
  const [saved, setSaved] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/tenh-admin/login-sessions", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !result.success) { setError(response.status === 403 ? "forbidden" : "unavailable"); return; }
      if (!Number.isInteger(result.rememberDays) || result.rememberDays < 1 || result.rememberDays > 90) throw new Error("Invalid session policy");
      setDays(String(result.rememberDays)); setSavedDays(result.rememberDays); setRequiresMfa(result.requiresMfa === true);
    }).catch(() => { if (!controller.signal.aborted) setError("unavailable"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); active.current?.abort(); active.current = null; };
  }, [revision]);
  const valid = /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 90;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || !valid || requiresMfa || savedDays === null) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null); setSaved(false);
    try {
      const response = await fetch("/api/tenh-admin/login-sessions", { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ rememberDays: Number(days) }) });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !result.success) { const verification = result.requiresMfa === true || ["mfa_required", "recent_auth_required", "recent_mfa_required", "recent_authentication_required"].includes(result.code); setError(verification ? "verification" : response.status === 403 ? "forbidden" : "unavailable"); if (verification) setRequiresMfa(true); return; }
      if (!Number.isInteger(result.rememberDays) || result.rememberDays < 1 || result.rememberDays > 90) throw new Error("Invalid saved session policy");
      setDays(String(result.rememberDays)); setSavedDays(result.rememberDays); setSaved(true);
    } catch { if (!controller.signal.aborted) setError("unavailable"); }
    finally { if (!controller.signal.aborted) { active.current = null; setBusy(false); } }
  }
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <h2 className="text-xl font-bold text-slate-950">{t("Login sessions", "វគ្គចូលគណនី")}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t("Set how long Remember me keeps users signed in across TENH. This global setting applies to new remembered sign-ins. The default is 30 days.", "កំណត់រយៈពេលដែល «ចងចាំខ្ញុំ» រក្សាការចូលនៅទូទាំង TENH។ ការកំណត់សកលនេះអនុវត្តចំពោះការចូលថ្មីដែលបានជ្រើសចងចាំ។ លំនាំដើមគឺ ៣០ ថ្ងៃ។")}</p>
    {loading ? <p role="status" className="mt-5 text-sm text-slate-600">{t("Loading session policy…", "កំពុងផ្ទុកគោលការណ៍វគ្គចូល…")}</p> : <form onSubmit={save} className="mt-6 space-y-4">
      <label className="block max-w-sm text-sm font-semibold text-slate-800" htmlFor="remember-days">{t("Remember me duration (days)", "រយៈពេលចងចាំខ្ញុំ (ថ្ងៃ)")}<input id="remember-days" type="number" inputMode="numeric" min={1} max={90} step={1} required disabled={busy || savedDays === null || requiresMfa} value={days} onChange={event => { setDays(event.target.value); setSaved(false); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100" /></label>
      <p className="text-xs leading-5 text-slate-500">{t("Choose a whole number from 1 to 90. With Remember me unchecked, browser-session cookies last up to 24 hours and may survive browser restoration. Only verified TENH administrators can change this setting.", "ជ្រើសលេខគត់ពី ១ ដល់ ៩០។ បើមិនធីក «ចងចាំខ្ញុំ» ខូគីវគ្គកម្មវិធីរុករកមានរយៈពេលអតិបរមា ២៤ ម៉ោង ហើយអាចនៅសល់ក្រោយការស្ដារកម្មវិធីរុករក។ មានតែអ្នកគ្រប់គ្រង TENH ដែលបានផ្ទៀងផ្ទាត់ប៉ុណ្ណោះអាចកែប្រែបាន។")}</p>
      <button type="submit" disabled={busy || !valid || requiresMfa || savedDays === null || Number(days) === savedDays} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? t("Saving…", "កំពុងរក្សាទុក…") : t("Save duration", "រក្សាទុករយៈពេល")}</button>
    </form>}
    {requiresMfa ? <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">{t("Verify your administrator sign-in with a recent authenticator code before changing this policy.", "ផ្ទៀងផ្ទាត់ការចូលអ្នកគ្រប់គ្រងដោយលេខកូដកម្មវិធីផ្ទៀងផ្ទាត់ថ្មី មុនកែប្រែគោលការណ៍នេះ។")} <a href="/dashboard/admin/mfa" className="font-bold underline">{t("Verify administrator access", "ផ្ទៀងផ្ទាត់សិទ្ធិអ្នកគ្រប់គ្រង")}</a></p> : null}
    {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error === "forbidden" ? t("This setting is available only to TENH administrators.", "ការកំណត់នេះសម្រាប់អ្នកគ្រប់គ្រង TENH ប៉ុណ្ណោះ។") : error === "verification" ? t("Recent administrator verification is required. Verify access, then reload this policy.", "ត្រូវការការផ្ទៀងផ្ទាត់អ្នកគ្រប់គ្រងថ្មី។ ផ្ទៀងផ្ទាត់សិទ្ធិ រួចផ្ទុកគោលការណ៍ឡើងវិញ។") : t("Unable to load or save the session policy. Try again.", "មិនអាចផ្ទុក ឬរក្សាទុកគោលការណ៍បានទេ។ សូមព្យាយាមម្ដងទៀត។")}</p> : null}
    {saved ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{t(`Remember me duration saved: ${savedDays} days.`, `បានរក្សាទុករយៈពេលចងចាំខ្ញុំ៖ ${savedDays} ថ្ងៃ។`)}</p> : null}
    {!loading && error !== "forbidden" ? <button type="button" disabled={busy} onClick={() => { setLoading(true); setError(null); setSaved(false); setRevision(value => value + 1); }} className="mt-4 text-sm font-bold text-blue-600">{t("Reload policy", "ផ្ទុកគោលការណ៍ឡើងវិញ")}</button> : null}
  </section>;
}
