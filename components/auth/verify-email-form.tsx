"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

function useVerificationStorage(key: string) {
  return useSyncExternalStore(callback => { window.addEventListener("storage", callback); return () => window.removeEventListener("storage", callback); }, () => { try { return sessionStorage.getItem(key) ?? ""; } catch { return ""; } }, () => "");
}

export function VerifyEmailForm() {
  const params = useSearchParams();
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  const storedEmail = useVerificationStorage("tenh_verification_email");
  const storedInvite = useVerificationStorage("tenh_pending_invitation_token");
  const [enteredEmail, setEmail] = useState<string | null>(params.get("email"));
  const email = enteredEmail ?? storedEmail;
  const inviteToken = params.get("invite")?.trim() || storedInvite;
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"confirm" | "resend" | null>(null);
  const [error, setError] = useState<"invalid" | "rate" | "unavailable" | null>(null);
  const [resent, setResent] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const requestedNext = params.get("next")?.trim() ?? "";
  const next = inviteToken ? `/invite/accept?token=${encodeURIComponent(inviteToken)}` : requestedNext.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.includes("\\") ? requestedNext : "/dashboard/inbox";

  async function request(action: "confirm" | "resend") {
    if (active.current || !email.trim() || (action === "confirm" && !token.trim())) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(action); setError(null); setResent(false);
    try {
      const response = await fetch(`/api/auth/${action}`, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ email: email.trim().toLowerCase(), next, ...(action === "confirm" ? { token: token.trim() } : {}) }) });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !result.success) { setError(response.status === 429 ? "rate" : response.status >= 500 ? "unavailable" : "invalid"); return; }
      if (action === "resend") { setResent(true); return; }
      if (typeof result.redirect !== "string" || !result.redirect.startsWith("/") || result.redirect.startsWith("//") || result.redirect.includes("\\")) throw new Error("Invalid confirmation destination");
      try { sessionStorage.removeItem("tenh_verification_email"); } catch { /* Storage availability does not affect verification. */ }
      window.location.assign(result.redirect);
    } catch { if (!controller.signal.aborted) setError("unavailable"); }
    finally { if (!controller.signal.aborted) { active.current = null; setBusy(null); } }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void request("confirm"); }
  return <form onSubmit={submit} className="mt-7 space-y-5">
    <div><label htmlFor="verification-email" className="text-sm font-bold text-slate-900">{t("Email address", "អាសយដ្ឋានអ៊ីមែល")}</label><input id="verification-email" type="email" autoComplete="email" required disabled={busy !== null} value={email} onChange={event => setEmail(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></div>
    <div><label htmlFor="verification-code" className="text-sm font-bold text-slate-900">{t("Verification code", "លេខកូដផ្ទៀងផ្ទាត់")}</label><input id="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" required disabled={busy !== null} value={token} onChange={event => setToken(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-center font-mono text-xl font-bold tracking-widest text-slate-950 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></div>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error === "rate" ? t("Too many attempts. Wait and try again.", "បានព្យាយាមច្រើនពេក។ សូមរង់ចាំហើយព្យាយាមម្ដងទៀត។") : error === "unavailable" ? t("Verification is temporarily unavailable. Try again.", "ការផ្ទៀងផ្ទាត់មិនអាចប្រើបានបណ្ដោះអាសន្ន។ សូមព្យាយាមម្ដងទៀត។") : t("The code is invalid or expired. Check it or request a new code.", "លេខកូដមិនត្រឹមត្រូវ ឬផុតកំណត់។ សូមពិនិត្យ ឬស្នើលេខកូដថ្មី។")}</p> : null}
    {resent ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{t("If your email needs verification, a new code will arrive shortly.", "ប្រសិនបើអ៊ីមែលត្រូវការផ្ទៀងផ្ទាត់ លេខកូដថ្មីនឹងមកដល់ឆាប់ៗ។")}</p> : null}
    <button type="submit" disabled={busy !== null || !email.trim() || !token.trim()} className="w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{busy === "confirm" ? t("Verifying…", "កំពុងផ្ទៀងផ្ទាត់…") : t("Verify email", "ផ្ទៀងផ្ទាត់អ៊ីមែល")}</button>
    <button type="button" onClick={() => void request("resend")} disabled={busy !== null || !email.trim()} className="w-full text-center text-sm font-bold text-blue-600 disabled:text-slate-400">{busy === "resend" ? t("Sending…", "កំពុងផ្ញើ…") : t("Resend verification code", "ផ្ញើលេខកូដផ្ទៀងផ្ទាត់ម្ដងទៀត")}</button>
    <a href="/login" className="block text-center text-sm font-bold text-blue-600">{t("Back to sign in", "ត្រឡប់ទៅចូលគណនី")}</a>
  </form>;
}
