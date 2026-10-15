"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { applyWorkspaceLanguage, WORKSPACE_LANGUAGE_CHANGE_EVENT, WORKSPACE_LANGUAGE_STORAGE_KEY, type WorkspaceLanguageId } from "@/lib/display/workspace-language";
import { writeWorkspaceStorage } from "@/lib/display/workspace-storage";

export function AuthPageShell({ title, description, wide = false, children }: {
  title: { en: string; km: string }; description: { en: string; km: string }; wide?: boolean; children: ReactNode;
}) {
  const language = useWorkspaceLanguageId();
  const t = (en: string, km: string) => language === "km" ? km : en;
  function changeLanguage(id: WorkspaceLanguageId) {
    try { writeWorkspaceStorage(WORKSPACE_LANGUAGE_STORAGE_KEY, id); } catch { /* Language still changes when storage is disabled. */ }
    applyWorkspaceLanguage(id);
    window.dispatchEvent(new CustomEvent(WORKSPACE_LANGUAGE_CHANGE_EVENT, { detail: { id } }));
  }
  return <main className="relative flex min-h-dvh items-center justify-center p-4 sm:p-6" style={{ backgroundImage: "url('/images/background-login.webp')", backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }}>
    <div className="absolute inset-0 bg-slate-950/30" />
    <div className={`relative z-10 w-full overflow-hidden rounded-[30px] border border-white/20 bg-white shadow-[0_30px_100px_rgba(0,0,0,0.45)] ${wide ? "grid max-w-[1080px] lg:grid-cols-2" : "max-w-md"}`}>
      {wide ? <section className="relative hidden min-h-[680px] flex-col overflow-hidden bg-[#08132F]/95 p-12 text-white backdrop-blur-sm lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_45%)]" />
        <Image src="/images/tenh_logo.png" alt="TENH Chat" width={150} height={150} priority className="relative h-28 w-28 object-contain" />
        <h1 className="relative mt-8 text-5xl font-bold tracking-tight">TENH Chat</h1>
        <p className="relative mt-6 text-lg leading-8 text-slate-300">{t("Bring your customer conversations, profiles, notes, tags, and team collaboration together in one powerful platform.", "ប្រមូលផ្ដុំការសន្ទនាជាមួយអតិថិជន ប្រវត្តិរូប កំណត់ចំណាំ ស្លាក និងការសហការរបស់ក្រុម នៅក្នុងវេទិកាតែមួយ។")}</p>
        <div className="relative mt-auto rounded-3xl border border-white/10 bg-white/5 p-6"><p className="text-lg font-semibold">{t("Communication Platform", "វេទិកាទំនាក់ទំនង")}</p><p className="mt-2 text-sm leading-6 text-slate-300">{t("Handle customer messages, assign teammates, and grow your business from a single platform.", "គ្រប់គ្រងសារអតិថិជន ចាត់តាំងមិត្តរួមក្រុម និងពង្រីកអាជីវកម្មរបស់អ្នកពីវេទិកាតែមួយ។")}</p></div>
      </section> : null}
      <section className={`${wide ? "px-7 py-9 sm:px-10 lg:px-14" : "p-7 sm:p-10"} min-w-0`}>
        <div className="mb-6 flex items-center justify-between gap-3"><Image src="/images/tenh_logo.png" alt="TENH Chat" width={64} height={64} priority className={`h-16 w-16 object-contain ${wide ? "lg:invisible" : ""}`} /><div role="group" aria-label={t("Language", "ភាសា")} className="flex rounded-lg border border-slate-200 p-1 text-sm">{([['en', 'EN'], ['km', 'ខ្មែរ']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={language === id} onClick={() => changeLanguage(id)} className={`rounded-md px-2.5 py-1.5 font-semibold ${language === id ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50"}`}>{label}</button>)}</div></div>
        <h2 className={`${wide ? "text-4xl" : "text-3xl"} font-bold tracking-tight text-slate-950`}>{title[language]}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{description[language]}</p>
        {children}
      </section>
    </div>
  </main>;
}
