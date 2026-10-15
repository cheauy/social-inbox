"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

function GoogleIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.2c1.9-1.8 3-4.4 3-7.5Z" /><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3v2.7A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.4H3A10 10 0 0 0 2 12c0 1.6.4 3.1 1 4.6l3.4-2.7Z" /><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.4l3.4 2.7C7.2 7.7 9.4 5.9 12 5.9Z" /></svg>;
}
function FacebookIcon() {
  return <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#1877F2" /><path fill="white" d="M13.7 21v-7h2.4l.3-2.7h-2.7V9.5c0-.8.2-1.3 1.4-1.3h1.4V5.8c-.2 0-1-.1-2.1-.1-2.1 0-3.5 1.3-3.5 3.6v2H8.5V14h2.4v7h2.8Z" /></svg>;
}
const inputClass = "mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100";
const subscribeHydration = () => () => {};

export function LoginForm() {
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const params = useSearchParams();
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  const requestedNext = params.get("next")?.trim() ?? "";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.includes("\\") ? requestedNext : "/dashboard/inbox";
  const invitationToken = next.startsWith("/invite/accept") ? new URL(next, "https://tenh.local").searchParams.get("token") : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [rememberDays, setRememberDays] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<"email" | "google" | "facebook" | null>(null);
  const [error, setError] = useState<"login" | "rate" | "unavailable" | null>(params.get("error") ? "login" : null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/policy", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!controller.signal.aborted && response.ok && result.success && Number.isInteger(result.rememberDays) && result.rememberDays >= 1 && result.rememberDays <= 90) setRememberDays(result.rememberDays);
    }).catch(() => {});
    return () => { controller.abort(); active.current?.abort(); active.current = null; };
  }, []);

  async function signIn(provider?: "google" | "facebook") {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(provider ?? "email"); setError(null);
    try {
      const response = await fetch(provider ? "/api/auth/oauth" : "/api/auth/login", { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify(provider ? { provider, rememberMe, next } : { email: email.trim().toLowerCase(), password, rememberMe, next }) });
      const result = await response.json();
      if (!response.ok || !result.success) { setError(response.status === 429 ? "rate" : response.status >= 500 ? "unavailable" : "login"); return; }
      const destination = provider ? result.url : result.redirect;
      if (typeof destination !== "string" || (!provider && (!destination.startsWith("/") || destination.startsWith("//") || destination.includes("\\")))) throw new Error("Invalid sign-in destination");
      if (!controller.signal.aborted) window.location.assign(destination);
    } catch {
      if (!controller.signal.aborted) setError("unavailable");
    } finally {
      if (!controller.signal.aborted) { active.current = null; setBusy(null); }
    }
  }
  function handleEmailLogin(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (email.trim() && password) void signIn(); }

  // Password managers mutate server-rendered controls before React hydrates them.
  if (!hydrated) return <div aria-hidden="true" className="mt-8 h-96 animate-pulse rounded-xl bg-slate-50" />;
  return <div className="mt-8">
    {params.has("expired") ? <p role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t("Your session expired. Please sign in again.", "វគ្គចូលគណនីរបស់អ្នកបានផុតកំណត់។ សូមចូលម្ដងទៀត។")}</p> : null}
    {params.get("logout") === "uncertain" ? <p role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">{t("Signed out on this device. Remote session revocation could not be confirmed; access on other devices may take time to end.", "បានចាកចេញលើឧបករណ៍នេះ។ មិនអាចបញ្ជាក់ការបញ្ចប់វគ្គពីចម្ងាយបានទេ។ សិទ្ធិចូលលើឧបករណ៍ផ្សេងអាចត្រូវការពេលដើម្បីបញ្ចប់។")}</p> : null}
    {params.get("reset") === "complete" ? <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{t("Password reset. Sign in with your new password.", "បានកំណត់ពាក្យសម្ងាត់ឡើងវិញ។ ចូលដោយប្រើពាក្យសម្ងាត់ថ្មីរបស់អ្នក។")}</p> : null}
    <div className="space-y-3">
      <button type="button" onClick={() => void signIn("google")} disabled={busy !== null} className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><GoogleIcon />{busy === "google" ? t("Connecting…", "កំពុងភ្ជាប់…") : t("Continue with Google", "បន្តជាមួយ Google")}</button>
      <button type="button" onClick={() => void signIn("facebook")} disabled={busy !== null} className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#1877F2] px-5 py-3 font-semibold text-white hover:bg-[#166FE5] disabled:opacity-60"><FacebookIcon />{busy === "facebook" ? t("Connecting…", "កំពុងភ្ជាប់…") : t("Continue with Facebook", "បន្តជាមួយ Facebook")}</button>
    </div>
    <div className="my-6 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-xs font-semibold text-slate-400">{t("OR USE EMAIL", "ឬប្រើអ៊ីមែល")}</span><div className="h-px flex-1 bg-slate-200" /></div>
    <form onSubmit={handleEmailLogin} className="space-y-5">
      <div><label htmlFor="login-email" className="text-sm font-bold text-slate-900">{t("Email address", "អាសយដ្ឋានអ៊ីមែល")}</label><input id="login-email" type="email" value={email} onChange={event => setEmail(event.target.value)} disabled={busy !== null} autoComplete="username" required className={inputClass} /></div>
      <div><div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="login-password" className="text-sm font-bold text-slate-900">{t("Password", "ពាក្យសម្ងាត់")}</label><a href="/forgot-password" className="text-sm font-bold text-blue-600 hover:text-blue-700">{t("Forgot password?", "ភ្លេចពាក្យសម្ងាត់?")}</a></div><div className="relative"><input id="login-password" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} disabled={busy !== null} autoComplete="current-password" required className={`${inputClass} pr-16`} /><button type="button" onClick={() => setShowPassword(value => !value)} disabled={busy !== null} aria-label={showPassword ? t("Hide password", "លាក់ពាក្យសម្ងាត់") : t("Show password", "បង្ហាញពាក្យសម្ងាត់")} className="absolute right-2 top-1/2 mt-1 -translate-y-1/2 rounded-lg px-2 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100">{showPassword ? t("Hide", "លាក់") : t("Show", "បង្ហាញ")}</button></div></div>
      <div><label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-700"><input id="remember-me" type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} disabled={busy !== null} className="h-4 w-4 rounded border-slate-300 accent-blue-600" />{t("Remember me", "ចងចាំខ្ញុំ")}</label><p className="mt-2 text-xs leading-5 text-slate-500">{rememberMe ? rememberDays === null ? t("Your sign-in lasts for the duration set by TENH.", "ការចូលគណនីមានរយៈពេលតាមការកំណត់របស់ TENH។") : t(`Stay signed in for up to ${rememberDays} days on this device.`, `បន្តចូលគណនីរហូតដល់ ${rememberDays} ថ្ងៃនៅលើឧបករណ៍នេះ។`) : t("Session cookies, up to 24 hours. Browser restoration may retain them.", "ខូគីវគ្គកម្មវិធីរុករក រហូតដល់ ២៤ ម៉ោង។ ការស្ដារកម្មវិធីរុករកអាចរក្សាវាបាន។")}</p></div>
      {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error === "rate" ? t("Too many attempts. Wait and try again.", "បានព្យាយាមច្រើនពេក។ សូមរង់ចាំហើយព្យាយាមម្ដងទៀត។") : error === "unavailable" ? t("Sign-in is temporarily unavailable. Try again.", "ការចូលគណនីមិនអាចប្រើបានបណ្ដោះអាសន្ន។ សូមព្យាយាមម្ដងទៀត។") : t("Unable to sign in. Check your details or try another sign-in method.", "មិនអាចចូលគណនីបាន។ ពិនិត្យព័ត៌មាន ឬសាកល្បងវិធីចូលផ្សេង។")}</p> : null}
      <button type="submit" disabled={busy !== null || !email.trim() || !password} className="flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">{busy === "email" ? t("Signing in…", "កំពុងចូល…") : t("Sign in", "ចូលគណនី")}</button>
      <p className="text-center text-sm text-slate-500">{t("Don't have an account?", "មិនមានគណនី?")} <a href={invitationToken ? `/register?invite=${encodeURIComponent(invitationToken)}` : "/register"} className="font-bold text-blue-600">{t("Create account", "បង្កើតគណនី")}</a></p>
    </form>
    <p className="mt-6 text-center text-xs text-slate-500">© 2026 TENH Chat</p>
  </div>;
}
