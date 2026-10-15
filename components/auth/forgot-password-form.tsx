"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

export function ForgotPasswordForm() {
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<"rate" | "unavailable" | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || !email.trim()) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/auth/recover", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim().toLowerCase() }), signal: controller.signal });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !result.success) { setError(response.status === 429 ? "rate" : "unavailable"); return; }
      setSent(true);
    } catch { if (!controller.signal.aborted) setError("unavailable"); }
    finally { if (!controller.signal.aborted) { active.current = null; setBusy(false); } }
  }
  return <div className="mt-7">
    {sent ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">{t("If an account can use this email, a password reset link will arrive shortly. Check your inbox and spam folder.", "ប្រសិនបើគណនីអាចប្រើអ៊ីមែលនេះ តំណកំណត់ពាក្យសម្ងាត់ឡើងវិញនឹងមកដល់ឆាប់ៗ។ សូមពិនិត្យប្រអប់សារ និងថតសារឥតបានការ។")}</p> : <form onSubmit={submit} className="space-y-5">
      <div><label htmlFor="recovery-email" className="text-sm font-bold text-slate-900">{t("Account email", "អ៊ីមែលគណនី")}</label><input id="recovery-email" type="email" autoComplete="email" required disabled={busy} value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100" /></div>
      <p className="text-xs leading-5 text-slate-500">{t("Use your sign-in email. A backup contact email cannot receive password reset links.", "ប្រើអ៊ីមែលចូលគណនីរបស់អ្នក។ អ៊ីមែលទំនាក់ទំនងបម្រុងមិនអាចទទួលតំណកំណត់ពាក្យសម្ងាត់ឡើងវិញបានទេ។")}</p>
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error === "rate" ? t("Too many requests. Wait before trying again.", "បានស្នើច្រើនពេក។ សូមរង់ចាំមុនព្យាយាមម្ដងទៀត។") : t("Unable to send a reset link right now. Try again.", "មិនអាចផ្ញើតំណឥឡូវនេះបានទេ។ សូមព្យាយាមម្ដងទៀត។")}</p> : null}
      <button type="submit" disabled={busy || !email.trim()} className="w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? t("Sending…", "កំពុងផ្ញើ…") : t("Send reset link", "ផ្ញើតំណកំណត់ឡើងវិញ")}</button>
    </form>}
    <a href="/login" className="mt-6 block text-center text-sm font-bold text-blue-600">{t("Back to sign in", "ត្រឡប់ទៅចូលគណនី")}</a>
  </div>;
}
