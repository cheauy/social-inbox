"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

export function ResetPasswordForm() {
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  const [status, setStatus] = useState<"loading" | "valid" | "invalid" | "unavailable">("loading");
  const [revision, setRevision] = useState(0);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [revocationPending, setRevocationPending] = useState(false);
  const [error, setError] = useState<"mismatch" | "rate" | "unavailable" | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/recovery-status", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!controller.signal.aborted) setStatus(response.ok && result.success && result.valid === true ? "valid" : [401, 403, 410].includes(response.status) ? "invalid" : "unavailable");
    }).catch(() => { if (!controller.signal.aborted) setStatus("unavailable"); });
    return () => { controller.abort(); active.current?.abort(); active.current = null; };
  }, [revision]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || status !== "valid") return;
    if (password !== confirmation) { setError("mismatch"); return; }
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, confirmPassword: confirmation }), signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !result.success) { if ([401, 403, 410].includes(response.status)) setStatus("invalid"); else setError(response.status === 429 ? "rate" : "unavailable"); return; }
      setPassword(""); setConfirmation(""); setRevocationPending(result.revocationPending === true); setComplete(true);
      if (!result.revocationPending && result.redirect === "/login?reset=complete") window.location.assign(result.redirect);
    } catch { if (!controller.signal.aborted) setError("unavailable"); }
    finally { if (!controller.signal.aborted) { active.current = null; setBusy(false); } }
  }
  if (complete) return <div className="mt-7"><p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">{revocationPending ? t("Your password was reset. Sign-out on other devices is still being completed. Sign in again to continue.", "បានកំណត់ពាក្យសម្ងាត់ឡើងវិញ។ ការចាកចេញលើឧបករណ៍ផ្សេងនៅកំពុងបញ្ចប់។ ចូលគណនីម្ដងទៀតដើម្បីបន្ត។") : t("Your password was reset. Sign in again to continue.", "បានកំណត់ពាក្យសម្ងាត់ឡើងវិញ។ ចូលគណនីម្ដងទៀតដើម្បីបន្ត។")}</p><a href="/login?reset=complete" className="mt-5 block text-center font-bold text-blue-600">{t("Sign in", "ចូលគណនី")}</a></div>;
  if (status !== "valid") return <div className="mt-7 space-y-5">{status === "loading" ? <p role="status" className="text-sm text-slate-600">{t("Checking your reset link…", "កំពុងពិនិត្យតំណរបស់អ្នក…")}</p> : <><p role="alert" className="rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-700">{status === "invalid" ? t("This reset link is invalid, expired, or already used. Request a new link.", "តំណនេះមិនត្រឹមត្រូវ ផុតកំណត់ ឬបានប្រើរួច។ សូមស្នើតំណថ្មី។") : t("Unable to check your reset link. Try again.", "មិនអាចពិនិត្យតំណបានទេ។ សូមព្យាយាមម្ដងទៀត។")}</p>{status === "unavailable" ? <button type="button" onClick={() => { setStatus("loading"); setRevision(value => value + 1); }} className="w-full rounded-xl bg-blue-600 p-3 font-semibold text-white">{t("Try again", "ព្យាយាមម្ដងទៀត")}</button> : null}<a href="/forgot-password" className="block text-center font-bold text-blue-600">{t("Request a new reset link", "ស្នើតំណកំណត់ឡើងវិញថ្មី")}</a></>}</div>;
  return <form onSubmit={submit} className="mt-7 space-y-5">
    <div><label htmlFor="reset-password" className="text-sm font-bold text-slate-900">{t("New password", "ពាក្យសម្ងាត់ថ្មី")}</label><input id="reset-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /><p className="mt-2 text-xs text-slate-500">{t("Use 8–128 characters with letters and numbers.", "ប្រើ ៨–១២៨ តួអក្សរ ដែលមានអក្សរ និងលេខ។")}</p></div>
    <div><label htmlFor="reset-confirmation" className="text-sm font-bold text-slate-900">{t("Confirm new password", "បញ្ជាក់ពាក្យសម្ងាត់ថ្មី")}</label><input id="reset-confirmation" type="password" autoComplete="new-password" required disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></div>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error === "mismatch" ? t("Passwords do not match.", "ពាក្យសម្ងាត់មិនត្រូវគ្នា។") : error === "rate" ? t("Too many attempts. Wait and try again.", "បានព្យាយាមច្រើនពេក។ សូមរង់ចាំហើយព្យាយាមម្ដងទៀត។") : t("Unable to reset your password. Try again.", "មិនអាចកំណត់ពាក្យសម្ងាត់ឡើងវិញបានទេ។ សូមព្យាយាមម្ដងទៀត។")}</p> : null}
    <button type="submit" disabled={busy || password.length < 8 || !confirmation} className="w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? t("Resetting…", "កំពុងកំណត់ឡើងវិញ…") : t("Reset password", "កំណត់ពាក្យសម្ងាត់ឡើងវិញ")}</button>
  </form>;
}
