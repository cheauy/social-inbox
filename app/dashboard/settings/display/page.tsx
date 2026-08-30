"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_WORKSPACE_ENGLISH_FONT_ID,
  DEFAULT_WORKSPACE_KHMER_FONT_ID,
  WORKSPACE_ENGLISH_FONT_STORAGE_KEY,
  WORKSPACE_KHMER_FONT_STORAGE_KEY,
  WORKSPACE_FONT_CHANGE_EVENT,
  applyWorkspaceEnglishFont,
  applyWorkspaceKhmerFont,
  getWorkspaceEnglishFont,
  getWorkspaceKhmerFont,
  isWorkspaceEnglishFontId,
  isWorkspaceKhmerFontId,
  workspaceEnglishFonts,
  workspaceKhmerFonts,
  type WorkspaceEnglishFontId,
  type WorkspaceKhmerFontId,
} from "@/lib/display/workspace-fonts";
import {
  DEFAULT_WORKSPACE_LANGUAGE_ID,
  WORKSPACE_LANGUAGE_CHANGE_EVENT,
  WORKSPACE_LANGUAGE_STORAGE_KEY,
  applyWorkspaceLanguage,
  getWorkspaceLanguage,
  isWorkspaceLanguageId,
  workspaceLanguages,
  type WorkspaceLanguageId,
} from "@/lib/display/workspace-language";
import {
  DEFAULT_WORKSPACE_THEME_ID,
  WORKSPACE_THEME_CHANGE_EVENT,
  WORKSPACE_THEME_STORAGE_KEY,
  applyWorkspaceTheme,
  isAvailableWorkspaceThemeId,
  workspaceThemes,
  type WorkspaceThemeId,
} from "@/lib/display/workspace-themes";

import {
  DEFAULT_WORKSPACE_COLOR_PRESET_ID,
  DEFAULT_WORKSPACE_COLORS,
  WORKSPACE_COLOR_CHANGE_EVENT,
  WORKSPACE_COLOR_STORAGE_KEY,
  applyWorkspaceColors,
  getStoredWorkspaceColorSettings,
  getWorkspaceColorPreset,
  isValidHexColor,
  serializeWorkspaceColorSettings,
  workspaceColorPresets,
  type WorkspaceColorPresetId,
  type WorkspaceColorSettings,
  type WorkspaceColorValues,
} from "@/lib/display/workspace-colors";
import {
  TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
  readWorkspaceStorage,
  writeWorkspaceStorage,
} from "@/lib/display/workspace-storage";

type DisplayTab =
  | "theme"
  | "font"
  | "language"
  | "colors"
  | "background";

type ThemePreset = {
  id: string;
  name: string;
  src: string;
};

const BACKGROUND_STORAGE_KEY =
  "tenh-chat-background-theme";

const themePresets: ThemePreset[] = [
  {
    id: "theme-1",
    name: "Theme 1",
    src: "/images/bg-theme1.png",
  },
  {
    id: "theme-2",
    name: "Theme 2",
    src: "/images/bg-theme2.png",
  },
  {
    id: "theme-3",
    name: "Theme 3",
    src: "/images/bg-theme3.png",
  },
  {
    id: "theme-4",
    name: "Theme 4",
    src: "/images/bg-theme4.png",
  },
  {
    id: "theme-5",
    name: "Theme 5",
    src: "/images/bg-theme5.png",
  },
];

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="m5 12 4 4 10-10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="m6 6 12 12M18 6 6 18"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6M12 7h.01" strokeLinecap="round" />
    </svg>
  );
}

function TabIcon({ tab }: { tab: DisplayTab }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    className: "h-4 w-4",
    "aria-hidden": true,
  } as const;

  if (tab === "font") {
    return (
      <span className="text-[13px] font-bold leading-none">
        Aa
      </span>
    );
  }

  if (tab === "language") {
    return (
      <span className="inline-flex min-w-5 items-center justify-center text-[10px] font-bold leading-none">
        A/ក
      </span>
    );
  }

  if (tab === "theme") {
    return (
      <svg {...common}>
        <path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-2.2a2 2 0 0 1-2-2V5.1A2.1 2.1 0 0 0 12.7 3H12Z" />
        <circle cx="7.5" cy="12" r="1" />
        <circle cx="10" cy="7.5" r="1" />
        <circle cx="8.5" cy="16" r="1" />
      </svg>
    );
  }

  if (tab === "colors") {
    return (
      <svg {...common}>
        <path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-2.2a2 2 0 0 1-2-2V5.1A2.1 2.1 0 0 0 12.7 3H12Z" />
        <circle cx="7" cy="11" r="1" />
        <circle cx="10" cy="7" r="1" />
        <circle cx="8" cy="16" r="1" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8" cy="9" r="1.5" />
      <path d="m5 17 4.5-4.5 3 3 2.2-2.2L19 17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5 8.5 8.5 0 1 0 20.5 14.6Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DimIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16V4Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ThemeMiniPreview({ themeId }: { themeId: WorkspaceThemeId }) {
  const palette =
    themeId === "light"
      ? {
          shell: "bg-[#F6F3FF]",
          sidebar: "bg-white",
          panel: "bg-white",
          line: "bg-[#D8D2F3]",
          soft: "bg-[#EFEAFB]",
          bubble: "bg-[#CFC0F7]",
        }
      : themeId === "dark"
        ? {
            shell: "bg-[#0B1120]",
            sidebar: "bg-[#111827]",
            panel: "bg-[#111827]",
            line: "bg-[#334155]",
            soft: "bg-[#1E293B]",
            bubble: "bg-[#7057D9]",
          }
        : {
            shell: "bg-[#202733]",
            sidebar: "bg-[#29313E]",
            panel: "bg-[#29313E]",
            line: "bg-[#465466]",
            soft: "bg-[#343E4D]",
            bubble: "bg-[#8B7BEA]",
          };

  return (
    <div className={`grid h-[116px] grid-cols-[30%_70%] overflow-hidden rounded-[10px] border border-white/10 ${palette.shell}`}>
      <div className={`p-3 ${palette.sidebar}`}>
        <div className={`h-3 w-3 rounded-full ${palette.line}`} />
        <div className={`mt-3 h-2 w-12 rounded-full ${palette.line}`} />
        <div className={`mt-2 h-2 w-9 rounded-full ${palette.line}`} />
        <div className={`mt-2 h-2 w-11 rounded-full ${palette.line}`} />
      </div>
      <div className={`relative p-4 ${palette.panel}`}>
        <div className={`h-2 w-16 rounded-full ${palette.line}`} />
        <div className={`mt-3 h-7 w-28 rounded-md ${palette.soft}`} />
        <div className={`absolute bottom-4 right-4 h-7 w-24 rounded-md ${palette.bubble}`} />
      </div>
    </div>
  );
}

function ThemePreviewModal({
  open,
  onClose,
  themeId,
}: {
  open: boolean;
  onClose: () => void;
  themeId: WorkspaceThemeId;
}) {
  if (!open) return null;

  const dark = themeId !== "light";
  const dim = themeId === "dim";
  const bg = dark ? (dim ? "#202733" : "#0B1120") : "#F6F8FC";
  const panel = dark ? (dim ? "#29313E" : "#111827") : "#FFFFFF";
  const border = dark ? (dim ? "#465466" : "#334155") : "#E2E8F0";
  const strong = dark ? "#F8FAFC" : "#0F172A";
  const muted = dark ? "#94A3B8" : "#64748B";

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Theme preview" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-full max-w-[820px] overflow-hidden rounded-[24px] border shadow-[0_30px_90px_rgba(0,0,0,0.32)]" style={{ backgroundColor: panel, borderColor: border }}>
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: border }}>
          <div>
            <p className="text-[15px] font-semibold" style={{ color: strong }}>Preview in chat</p>
            <p className="mt-0.5 text-xs" style={{ color: muted }}>{workspaceThemes.find((theme) => theme.id === themeId)?.name} theme</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: muted }} aria-label="Close preview"><CloseIcon /></button>
        </div>
        <div className="p-5" style={{ backgroundColor: bg }}>
          <div className="overflow-hidden rounded-[18px] border" style={{ backgroundColor: panel, borderColor: border }}>
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: border }}>
              <div className="flex items-center gap-3">
                <img src="/images/tenh_logo.png" alt="TENH Chat" className="h-9 w-9 object-contain" />
                <div><p className="font-bold" style={{ color: strong }}>TENH Chat</p><p className="text-xs" style={{ color: muted }}>Customer messaging</p></div>
              </div>
              <button type="button" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">New conversation</button>
            </div>
            <div className="grid min-h-[330px] md:grid-cols-[220px_1fr]">
              <aside className="border-r p-4" style={{ borderColor: border }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: muted }}>Inbox</p>
                <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: dark ? (dim ? "#343E4D" : "#1E293B") : "#EFF6FF" }}>
                  <p className="font-semibold" style={{ color: strong }}>Dara</p>
                  <p className="mt-1 text-sm" style={{ color: muted }}>Hello, how much is this bag?</p>
                </div>
                <div className="mt-2 rounded-xl p-3"><p className="font-semibold" style={{ color: strong }}>Piseth</p><p className="mt-1 text-sm" style={{ color: muted }}>Thank you!</p></div>
              </aside>
              <div className="flex flex-col p-5">
                <div><p className="text-lg font-bold" style={{ color: strong }}>Dara</p><p className="mt-1 text-sm" style={{ color: muted }}>Demon Shop</p></div>
                <div className="mt-8 flex-1 space-y-3">
                  <div className="max-w-[72%] rounded-2xl rounded-bl-md px-4 py-3 text-sm" style={{ backgroundColor: dark ? (dim ? "#343E4D" : "#1E293B") : "#F1F5F9", color: strong }}>Hello, how much is this bag?</div>
                  <div className="ml-auto max-w-[72%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-sm text-white">Hello! This bag is $30.</div>
                </div>
                <div className="mt-6 rounded-xl border px-4 py-3 text-sm" style={{ borderColor: border, color: muted }}>Write a reply...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({
  open,
  onClose,
  previewLanguageId,
  englishFontId,
  khmerFontId,
}: {
  open: boolean;
  onClose: () => void;
  previewLanguageId: WorkspaceLanguageId;
  englishFontId: WorkspaceEnglishFontId;
  khmerFontId: WorkspaceKhmerFontId;
}) {
  if (!open) {
    return null;
  }

  const isKhmer = previewLanguageId === "km";
  const font = isKhmer
    ? getWorkspaceKhmerFont(khmerFontId)
    : getWorkspaceEnglishFont(englishFontId);

  const copy = isKhmer
    ? {
        title: "មើលគំរូពុម្ពអក្សរ",
        subtitle: `មើលថា ${font.name} បង្ហាញយ៉ាងដូចម្តេចមុនពេលរក្សាទុក។`,
        workspace: "កន្លែងធ្វើការសម្រាប់ឆ្លើយតបអតិថិជន",
        newConversation: "ការសន្ទនាថ្មី",
        inbox: "ប្រអប់សារ",
        firstMessage: "សួស្តី តម្លៃកាបូបនេះប៉ុន្មាន?",
        secondMessage: "អរគុណ!",
        outgoing: "សួស្តី! កាបូបនេះតម្លៃ $30។",
        reply: "សរសេរឆ្លើយតប...",
        sampleTitle: "អក្សរខ្មែរ ១២៣",
        sampleBody:
          "TENH ជួយឲ្យក្រុមរបស់អ្នកឆ្លើយតបអតិថិជនបានលឿន ច្បាស់ និងមានវិជ្ជាជីវៈ។",
        done: "រួចរាល់",
      }
    : {
        title: "Preview font",
        subtitle: `See how ${font.name} looks before saving.`,
        workspace: "Customer messaging workspace",
        newConversation: "New conversation",
        inbox: "Inbox",
        firstMessage: "Hello, how much is this bag?",
        secondMessage: "Thank you!",
        outgoing: "Hello! This bag is $30.",
        reply: "Write a reply...",
        sampleTitle: "Aa Bb Cc 123",
        sampleBody:
          "The quick brown fox jumps over the lazy dog. TENH helps your team reply quickly and clearly.",
        done: "Done",
      };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Font preview"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-[760px] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.24)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div style={{ fontFamily: font.family }}>
            <p className="text-[15px] font-semibold text-slate-950">
              {copy.title}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {copy.subtitle}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close preview"
          >
            <CloseIcon />
          </button>
        </div>

        <div
          className="bg-[#F7F9FC] p-6"
          style={{ fontFamily: font.family }}
        >
          <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm">
                  <img
                    src="/images/tenh_logo.png"
                    alt="TENH Chat"
                    className="h-9 w-9 object-contain"
                    draggable={false}
                  />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-lg font-bold text-slate-950">
                    TENH Chat
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {copy.workspace}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
              >
                {copy.newConversation}
              </button>
            </div>

            <div className="grid min-h-[320px] md:grid-cols-[230px_1fr]">
              <div className="border-r border-slate-200 p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">
                  {copy.inbox}
                </p>
                <div className="mt-3 rounded-xl bg-blue-50 p-3">
                  <p className="font-semibold text-slate-900">
                    Dara
                  </p>
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {copy.firstMessage}
                  </p>
                </div>
                <div className="mt-2 rounded-xl p-3">
                  <p className="font-semibold text-slate-900">
                    Piseth
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {copy.secondMessage}
                  </p>
                </div>
              </div>

              <div className="flex flex-col p-5">
                <div>
                  <p className="text-lg font-bold text-slate-950">
                    Dara
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Demon Shop
                  </p>
                </div>

                <div className="mt-8 flex-1 space-y-3">
                  <div className="max-w-[72%] rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm text-slate-800">
                    {copy.firstMessage}
                  </div>
                  <div className="ml-auto max-w-[72%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-3 text-sm text-white">
                    {copy.outgoing}
                  </div>
                </div>

                <div className="mt-6 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-400">
                  {copy.reply}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-3xl font-bold tracking-[-0.03em] text-slate-950">
              {copy.sampleTitle}
            </p>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              {copy.sampleBody}
            </p>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700"
            style={{ fontFamily: font.family }}
          >
            {copy.done}
          </button>
        </div>
      </div>
    </div>
  );
}

function BackgroundPreviewModal({
  open,
  onClose,
  src,
  isKhmer,
}: {
  open: boolean;
  onClose: () => void;
  src: string;
  isKhmer: boolean;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Background preview"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <p className="font-semibold text-slate-950">
            {isKhmer ? "មើលផ្ទៃខាងក្រោយជាមុន" : "Background preview"}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="p-5">
          <div
            className="relative h-[390px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 bg-cover bg-center"
            style={{ backgroundImage: `url("${src}")` }}
          >
            <div className="relative flex h-full flex-col justify-end gap-3 p-5">
              <div className="max-w-[62%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
                {isKhmer ? "សួស្តី តើទំនិញនេះតម្លៃប៉ុន្មាន?" : "Hello, how much is this item?"}
              </div>
              <div className="ml-auto max-w-[62%] rounded-2xl rounded-br-md bg-emerald-50 px-4 py-3 text-sm text-slate-800 shadow-sm">
                {isKhmer ? "សួស្តី! ទំនិញនេះមានតម្លៃ $30។" : "Hi! It is available for $30."}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function ColorSwatches({
  colors,
}: {
  colors: WorkspaceColorValues;
}) {
  return (
    <div className="flex items-center justify-center -space-x-1.5">
      {[colors.primary, colors.accent, colors.primaryLight].map(
        (color, index) => (
          <span
            key={`${color}-${index}`}
            className="h-7 w-7 rounded-full border-2 border-white shadow-sm"
            style={{ backgroundColor: color }}
          />
        ),
      )}
    </div>
  );
}

function PaletteGridIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="1" />
      <circle cx="12" cy="7" r="1" />
      <circle cx="17" cy="7" r="1" />
      <circle cx="7" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="17" cy="12" r="1" />
      <circle cx="7" cy="17" r="1" />
      <circle cx="12" cy="17" r="1" />
      <circle cx="17" cy="17" r="1" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function ColorLivePreview({
  colors,
  compact = false,
}: {
  colors: WorkspaceColorValues;
  compact?: boolean;
}) {
  return (
    <div
      className={`overflow-hidden rounded-[14px] border bg-white ${
        compact ? "min-h-[230px]" : "min-h-[350px]"
      }`}
      style={{ borderColor: colors.neutral }}
    >
      <div
        className="flex h-11 items-center justify-between border-b px-4"
        style={{ borderColor: colors.neutral }}
      >
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-md text-white"
            style={{ backgroundColor: colors.primary }}
          >
            <span className="h-2.5 w-2.5 rounded-sm border border-white/80" />
          </span>
          <span className="h-2.5 w-20 rounded-full bg-slate-200" />
        </div>
        <div className="flex items-center gap-2">
          <span className="h-5 w-5 rounded-full bg-slate-200" />
          <span className="h-4 w-10 rounded-full bg-slate-100" />
        </div>
      </div>

      <div className="grid grid-cols-[34%_66%]">
        <aside
          className="border-r p-3"
          style={{ borderColor: colors.neutral }}
        >
          <div className="space-y-2">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-lg p-2"
                style={
                  item === 0
                    ? { backgroundColor: colors.primaryLight }
                    : undefined
                }
              >
                <span
                  className="h-6 w-6 rounded-full"
                  style={{
                    backgroundColor:
                      item === 0 ? colors.primary : "#E2E8F0",
                  }}
                />
                <div className="min-w-0 flex-1">
                  <span className="block h-2 w-14 rounded-full bg-slate-300" />
                  <span className="mt-1.5 block h-1.5 w-20 rounded-full bg-slate-200" />
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="flex flex-col p-4">
          <div className="flex items-center gap-2">
            <span className="h-7 w-7 rounded-full bg-slate-200" />
            <div>
              <span className="block h-2 w-16 rounded-full bg-slate-300" />
              <span className="mt-1.5 block h-1.5 w-24 rounded-full bg-slate-200" />
            </div>
          </div>

          <div className="mt-5 flex-1 space-y-3">
            <div className="h-9 w-[62%] rounded-xl bg-slate-100" />
            <div
              className="ml-auto h-9 w-[62%] rounded-xl"
              style={{ backgroundColor: colors.primary }}
            />
            {!compact ? (
              <div className="flex gap-2 pt-2">
                <span
                  className="h-6 w-14 rounded-lg"
                  style={{ backgroundColor: colors.success }}
                />
                <span
                  className="h-6 w-14 rounded-lg"
                  style={{ backgroundColor: colors.warning }}
                />
                <span
                  className="h-6 w-14 rounded-lg"
                  style={{ backgroundColor: colors.error }}
                />
              </div>
            ) : null}
          </div>

          <div
            className="mt-4 flex h-9 items-center justify-between rounded-xl border px-3"
            style={{ borderColor: colors.neutral }}
          >
            <span className="h-2 w-24 rounded-full bg-slate-200" />
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-white"
              style={{ backgroundColor: colors.accent }}
            >
              →
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorPreviewModal({
  open,
  onClose,
  colors,
}: {
  open: boolean;
  onClose: () => void;
  colors: WorkspaceColorValues;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Color preview"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[820px] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_30px_90px_rgba(15,23,42,0.28)]">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-[15px] font-semibold text-slate-950">
              Preview colors in chat
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Review your workspace colors before saving.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close preview"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="bg-slate-50 p-6">
          <ColorLivePreview colors={colors} />
        </div>
        <div className="flex justify-end border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl px-5 text-[13px] font-semibold text-white"
            style={{ backgroundColor: colors.primary }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const colorFieldMeta: Array<{
  key: keyof WorkspaceColorValues;
  label: string;
  description: string;
}> = [
  {
    key: "primary",
    label: "Primary color",
    description: "Main brand color, buttons, active states",
  },
  {
    key: "primaryLight",
    label: "Primary light",
    description: "Hover states, highlights, selected backgrounds",
  },
  {
    key: "accent",
    label: "Accent color",
    description: "Links, mentions, important elements",
  },
  {
    key: "success",
    label: "Success color",
    description: "Success messages, positive actions",
  },
  {
    key: "warning",
    label: "Warning color",
    description: "Warnings, alerts",
  },
  {
    key: "error",
    label: "Error color",
    description: "Errors, destructive actions",
  },
  {
    key: "neutral",
    label: "Neutral color",
    description: "Borders, dividers, subtle elements",
  },
];

const colorFieldKhmerMeta: Record<
  keyof WorkspaceColorValues,
  { label: string; description: string }
> = {
  primary: {
    label: "ពណ៌ចម្បង",
    description: "ពណ៌ម៉ាកចម្បង ប៊ូតុង និងស្ថានភាពដែលកំពុងជ្រើសរើស",
  },
  primaryLight: {
    label: "ពណ៌ចម្បងស្រាល",
    description: "ស្ថានភាពពេលដាក់ Mouse លើ ការរំលេច និងផ្ទៃខាងក្រោយដែលបានជ្រើសរើស",
  },
  accent: {
    label: "ពណ៌សង្កត់",
    description: "តំណ ការលើកឡើង និងធាតុសំខាន់ៗ",
  },
  success: {
    label: "ពណ៌ជោគជ័យ",
    description: "សារជោគជ័យ និងសកម្មភាពវិជ្ជមាន",
  },
  warning: {
    label: "ពណ៌ព្រមាន",
    description: "ការព្រមាន និងការជូនដំណឹង",
  },
  error: {
    label: "ពណ៌កំហុស",
    description: "កំហុស និងសកម្មភាពដែលអាចលុប ឬបំផ្លាញទិន្នន័យ",
  },
  neutral: {
    label: "ពណ៌អព្យាក្រឹត",
    description: "ស៊ុម បន្ទាត់បែងចែក និងធាតុលម្អិតស្រាលៗ",
  },
};

export default function DisplaySettingsPage() {
  const [activeTab, setActiveTab] =
    useState<DisplayTab>("theme");

  const [selectedThemeId, setSelectedThemeId] =
    useState<WorkspaceThemeId>(DEFAULT_WORKSPACE_THEME_ID);
  const [savedThemeId, setSavedThemeId] =
    useState<WorkspaceThemeId>(DEFAULT_WORKSPACE_THEME_ID);
  const [themePreviewOpen, setThemePreviewOpen] =
    useState(false);
  const [themeSavedNotice, setThemeSavedNotice] =
    useState(false);

  const [selectedColorPresetId, setSelectedColorPresetId] =
    useState<WorkspaceColorPresetId>(
      DEFAULT_WORKSPACE_COLOR_PRESET_ID,
    );
  const [savedColorPresetId, setSavedColorPresetId] =
    useState<WorkspaceColorPresetId>(
      DEFAULT_WORKSPACE_COLOR_PRESET_ID,
    );
  const [selectedColors, setSelectedColors] =
    useState<WorkspaceColorValues>({ ...DEFAULT_WORKSPACE_COLORS });
  const [savedColors, setSavedColors] =
    useState<WorkspaceColorValues>({ ...DEFAULT_WORKSPACE_COLORS });
  const [colorPreviewOpen, setColorPreviewOpen] =
    useState(false);
  const [colorSavedNotice, setColorSavedNotice] =
    useState(false);

  const [selectedFontId, setSelectedFontId] =
    useState<WorkspaceEnglishFontId>(
      DEFAULT_WORKSPACE_ENGLISH_FONT_ID,
    );
  const [savedFontId, setSavedFontId] =
    useState<WorkspaceEnglishFontId>(
      DEFAULT_WORKSPACE_ENGLISH_FONT_ID,
    );
  const [selectedKhmerFontId, setSelectedKhmerFontId] =
    useState<WorkspaceKhmerFontId>(
      DEFAULT_WORKSPACE_KHMER_FONT_ID,
    );
  const [savedKhmerFontId, setSavedKhmerFontId] =
    useState<WorkspaceKhmerFontId>(
      DEFAULT_WORKSPACE_KHMER_FONT_ID,
    );
  const [fontPreviewOpen, setFontPreviewOpen] =
    useState(false);
  const [fontPreviewLanguageId, setFontPreviewLanguageId] =
    useState<WorkspaceLanguageId>(
      DEFAULT_WORKSPACE_LANGUAGE_ID,
    );
  const [fontSavedNotice, setFontSavedNotice] =
    useState(false);

  const [selectedLanguageId, setSelectedLanguageId] =
    useState<WorkspaceLanguageId>(
      DEFAULT_WORKSPACE_LANGUAGE_ID,
    );
  const [savedLanguageId, setSavedLanguageId] =
    useState<WorkspaceLanguageId>(
      DEFAULT_WORKSPACE_LANGUAGE_ID,
    );
  const [languageSavedNotice, setLanguageSavedNotice] =
    useState(false);

  const [selectedBackgroundId, setSelectedBackgroundId] =
    useState(themePresets[0].id);
  const [savedBackgroundId, setSavedBackgroundId] =
    useState(themePresets[0].id);
  const [backgroundPreviewOpen, setBackgroundPreviewOpen] =
    useState(false);
  const [backgroundSavedNotice, setBackgroundSavedNotice] =
    useState(false);

  useEffect(() => {
    function loadWorkspaceDisplaySettings() {
      try {
        const savedFont = readWorkspaceStorage(
          WORKSPACE_ENGLISH_FONT_STORAGE_KEY,
        );

        const nextFont = isWorkspaceEnglishFontId(savedFont)
          ? savedFont
          : DEFAULT_WORKSPACE_ENGLISH_FONT_ID;
        setSelectedFontId(nextFont);
        setSavedFontId(nextFont);

        const savedKhmerFont = readWorkspaceStorage(
          WORKSPACE_KHMER_FONT_STORAGE_KEY,
        );
        const nextKhmerFont = isWorkspaceKhmerFontId(savedKhmerFont)
          ? savedKhmerFont
          : DEFAULT_WORKSPACE_KHMER_FONT_ID;
        setSelectedKhmerFontId(nextKhmerFont);
        setSavedKhmerFontId(nextKhmerFont);

        const savedLanguage = readWorkspaceStorage(
          WORKSPACE_LANGUAGE_STORAGE_KEY,
        );
        const nextLanguage = isWorkspaceLanguageId(savedLanguage)
          ? savedLanguage
          : DEFAULT_WORKSPACE_LANGUAGE_ID;
        setSelectedLanguageId(nextLanguage);
        setSavedLanguageId(nextLanguage);
        setFontPreviewLanguageId(nextLanguage);

        const savedTheme = readWorkspaceStorage(
          WORKSPACE_THEME_STORAGE_KEY,
        );
        const nextTheme = isAvailableWorkspaceThemeId(savedTheme)
          ? savedTheme
          : DEFAULT_WORKSPACE_THEME_ID;
        if (!isAvailableWorkspaceThemeId(savedTheme)) {
          // Dark / Dim are coming soon. Keep stale values isolated to
          // this workspace and force the supported Light theme.
          writeWorkspaceStorage(
            WORKSPACE_THEME_STORAGE_KEY,
            DEFAULT_WORKSPACE_THEME_ID,
          );
        }
        setSelectedThemeId(nextTheme);
        setSavedThemeId(nextTheme);
        applyWorkspaceTheme(nextTheme);

        const savedColorSettings = getStoredWorkspaceColorSettings();
        setSelectedColorPresetId(savedColorSettings.presetId);
        setSavedColorPresetId(savedColorSettings.presetId);
        setSelectedColors({ ...savedColorSettings.colors });
        setSavedColors({ ...savedColorSettings.colors });

        const savedBackground = readWorkspaceStorage(
          BACKGROUND_STORAGE_KEY,
        );
        const nextBackground =
          savedBackground &&
          themePresets.some((theme) => theme.id === savedBackground)
            ? savedBackground
            : themePresets[0].id;
        setSelectedBackgroundId(nextBackground);
        setSavedBackgroundId(nextBackground);
      } catch {
        // Browser storage can be unavailable in restricted contexts.
      }
    }

    loadWorkspaceDisplaySettings();
    window.addEventListener(
      TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
      loadWorkspaceDisplaySettings,
    );

    return () => {
      window.removeEventListener(
        TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
        loadWorkspaceDisplaySettings,
      );
    };
  }, []);

  const selectedBackground = useMemo(
    () =>
      themePresets.find(
        (theme) => theme.id === selectedBackgroundId,
      ) ?? themePresets[0],
    [selectedBackgroundId],
  );

  const fontHasChanges =
    selectedFontId !== savedFontId ||
    selectedKhmerFontId !== savedKhmerFontId;
  const languageHasChanges =
    selectedLanguageId !== savedLanguageId;
  const themeHasChanges = selectedThemeId !== savedThemeId;
  const colorsHaveChanges =
    selectedColorPresetId !== savedColorPresetId ||
    JSON.stringify(selectedColors) !== JSON.stringify(savedColors);
  const backgroundHasChanges =
    selectedBackgroundId !== savedBackgroundId;

  function saveTheme() {
    if (!isAvailableWorkspaceThemeId(selectedThemeId)) {
      setSelectedThemeId(DEFAULT_WORKSPACE_THEME_ID);
      return;
    }

    try {
      writeWorkspaceStorage(
        WORKSPACE_THEME_STORAGE_KEY,
        selectedThemeId,
      );
      applyWorkspaceTheme(selectedThemeId);
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_THEME_CHANGE_EVENT, {
          detail: { id: selectedThemeId },
        }),
      );
    } catch {
      // Keep the UI usable even if storage is blocked.
    }

    setSavedThemeId(selectedThemeId);
    setThemeSavedNotice(true);
    window.setTimeout(() => setThemeSavedNotice(false), 1800);
  }

  function resetThemeToDefault() {
    setSelectedThemeId(DEFAULT_WORKSPACE_THEME_ID);
  }

  function cancelThemeChanges() {
    setSelectedThemeId(savedThemeId);
  }

  function selectColorPreset(id: WorkspaceColorPresetId) {
    if (id === "custom") {
      setSelectedColorPresetId("custom");
      return;
    }

    const preset = getWorkspaceColorPreset(id);
    if (!preset) return;

    setSelectedColorPresetId(id);
    setSelectedColors({ ...preset.colors });
  }

  function updateColorValue(
    key: keyof WorkspaceColorValues,
    value: string,
  ) {
    setSelectedColorPresetId("custom");
    setSelectedColors((current) => ({
      ...current,
      [key]: value.toUpperCase(),
    }));
  }

  function saveColors() {
    const everyColorValid = Object.values(selectedColors).every(
      (value) => isValidHexColor(value),
    );

    if (!everyColorValid) return;

    const settings: WorkspaceColorSettings = {
      presetId: selectedColorPresetId,
      colors: selectedColors,
    };

    try {
      writeWorkspaceStorage(
        WORKSPACE_COLOR_STORAGE_KEY,
        serializeWorkspaceColorSettings(settings),
      );
      applyWorkspaceColors(selectedColors, selectedColorPresetId);
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_COLOR_CHANGE_EVENT, {
          detail: settings,
        }),
      );
    } catch {
      // Keep the UI usable even if storage is blocked.
    }

    setSavedColorPresetId(selectedColorPresetId);
    setSavedColors({ ...selectedColors });
    setColorSavedNotice(true);
    window.setTimeout(() => setColorSavedNotice(false), 1800);
  }

  function resetColorsToDefault() {
    setSelectedColorPresetId(DEFAULT_WORKSPACE_COLOR_PRESET_ID);
    setSelectedColors({ ...DEFAULT_WORKSPACE_COLORS });
  }

  function cancelColorChanges() {
    setSelectedColorPresetId(savedColorPresetId);
    setSelectedColors({ ...savedColors });
  }

  function saveFont() {
    try {
      writeWorkspaceStorage(
        WORKSPACE_ENGLISH_FONT_STORAGE_KEY,
        selectedFontId,
      );
      writeWorkspaceStorage(
        WORKSPACE_KHMER_FONT_STORAGE_KEY,
        selectedKhmerFontId,
      );

      if (savedLanguageId === "km") {
        applyWorkspaceKhmerFont(selectedKhmerFontId);
      } else {
        applyWorkspaceEnglishFont(selectedFontId);
      }

      window.dispatchEvent(
        new CustomEvent(WORKSPACE_FONT_CHANGE_EVENT, {
          detail: {
            language: savedLanguageId,
            englishId: selectedFontId,
            khmerId: selectedKhmerFontId,
            id:
              savedLanguageId === "km"
                ? selectedKhmerFontId
                : selectedFontId,
          },
        }),
      );
    } catch {
      // Keep the UI usable even if storage is blocked.
    }

    setSavedFontId(selectedFontId);
    setSavedKhmerFontId(selectedKhmerFontId);
    setFontSavedNotice(true);
    window.setTimeout(() => setFontSavedNotice(false), 1800);
  }

  function resetFontToDefault() {
    setSelectedFontId(DEFAULT_WORKSPACE_ENGLISH_FONT_ID);
    setSelectedKhmerFontId(DEFAULT_WORKSPACE_KHMER_FONT_ID);
  }

  function cancelFontChanges() {
    setSelectedFontId(savedFontId);
    setSelectedKhmerFontId(savedKhmerFontId);
  }

  function saveLanguage() {
    try {
      writeWorkspaceStorage(
        WORKSPACE_LANGUAGE_STORAGE_KEY,
        selectedLanguageId,
      );
      applyWorkspaceLanguage(selectedLanguageId);

      if (selectedLanguageId === "km") {
        applyWorkspaceKhmerFont(savedKhmerFontId);
      } else {
        applyWorkspaceEnglishFont(savedFontId);
      }

      window.dispatchEvent(
        new CustomEvent(WORKSPACE_LANGUAGE_CHANGE_EVENT, {
          detail: { id: selectedLanguageId },
        }),
      );
    } catch {
      // Keep the UI usable even if storage is blocked.
    }

    setSavedLanguageId(selectedLanguageId);
    setFontPreviewLanguageId(selectedLanguageId);
    setLanguageSavedNotice(true);
    window.setTimeout(
      () => setLanguageSavedNotice(false),
      1800,
    );
  }

  function cancelLanguageChanges() {
    setSelectedLanguageId(savedLanguageId);
  }


  function saveBackground() {
    try {
      writeWorkspaceStorage(
        BACKGROUND_STORAGE_KEY,
        selectedBackgroundId,
      );
      writeWorkspaceStorage(
        `${BACKGROUND_STORAGE_KEY}:src`,
        selectedBackground.src,
      );
      document.documentElement.style.setProperty(
        "--tenh-chat-background-image",
        `url("${selectedBackground.src}")`,
      );
      window.dispatchEvent(
        new CustomEvent(
          "tenh:chat-background-theme-change",
          {
            detail: {
              id: selectedBackground.id,
              src: selectedBackground.src,
            },
          },
        ),
      );
    } catch {
      // Keep the UI usable even if storage is blocked.
    }

    setSavedBackgroundId(selectedBackgroundId);
    setBackgroundSavedNotice(true);
    window.setTimeout(
      () => setBackgroundSavedNotice(false),
      1800,
    );
  }

  const isKhmerUi = savedLanguageId === "km";

  const tabs: Array<{
    id: DisplayTab;
    label: string;
  }> = [
    { id: "theme", label: isKhmerUi ? "រូបរាង" : "Theme" },
    { id: "font", label: isKhmerUi ? "ពុម្ពអក្សរ" : "Font" },
    { id: "language", label: isKhmerUi ? "ភាសា" : "Language" },
    { id: "colors", label: isKhmerUi ? "ពណ៌" : "Colors" },
    { id: "background", label: isKhmerUi ? "ផ្ទៃខាងក្រោយ" : "Background" },
  ];

  return (
    <>
      <main className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pb-10 pt-[clamp(18px,4vh,56px)]">
        <div>
          <h1 className="text-[30px] font-bold tracking-[-0.03em] text-slate-950">
            {isKhmerUi ? "ការបង្ហាញ" : "Display"}
          </h1>
          <p className="mt-1 text-[14px] text-slate-500">
            {isKhmerUi
              ? "កែសម្រួលរូបរាង និងបែបបទនៃកន្លែងធ្វើការរបស់អ្នក។"
              : "Customize the look and feel of your workspace."}
          </p>
        </div>

        <nav className="flex items-center gap-7 border-b border-slate-200">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative inline-flex h-11 items-center gap-2 text-[13px] font-medium transition ${
                  active
                    ? "text-blue-600"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <TabIcon tab={tab.id} />
                {tab.label}
                {active ? (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-blue-600" />
                ) : null}
              </button>
            );
          })}
        </nav>

        {activeTab === "font" ? (
          <section className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_8px_26px_rgba(15,23,42,0.045)]">
            <div className="px-6 py-6 sm:px-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-[19px] font-bold tracking-[-0.02em] text-slate-950">
                    {isKhmerUi ? "ជ្រើសរើសរចនាប័ទ្មពុម្ពអក្សររបស់អ្នក" : "Choose your font style"}
                  </h2>
                  <p className="mt-1 text-[13px] text-slate-500">
                    {isKhmerUi
                      ? "ជ្រើសរើសពុម្ពអក្សរដែលសមស្របនឹងម៉ាករបស់អ្នក និងជួយឲ្យងាយស្រួលអាននៅទូទាំងកន្លែងធ្វើការរបស់អ្នក។"
                      : "Select fonts that match your brand and improve readability across your workspace."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setFontPreviewOpen(true)}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-[13px] font-semibold text-blue-600 transition hover:border-blue-300 hover:bg-blue-100"
                >
                  <EyeIcon />
                  {isKhmerUi ? "មើលជាមុន" : "Preview"}
                </button>
              </div>

              <div className="mt-6 border-t border-slate-200 pt-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                      <GlobeIcon />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-semibold text-slate-900">
                        {isKhmerUi ? "ពុម្ពអក្សរអង់គ្លេស" : "English fonts"}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {isKhmerUi
                          ? "ជ្រើសរើសពុម្ពអក្សរអង់គ្លេសលំនាំដើមសម្រាប់កន្លែងធ្វើការ TENH របស់អ្នក។"
                          : "Choose the default English font for your TENH workspace."}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-slate-500">
                    {isKhmerUi ? "៦ ជម្រើស" : "6 options"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  {workspaceEnglishFonts.map((font) => {
                    const selected = selectedFontId === font.id;
                    return (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() => {
                          setSelectedFontId(font.id);
                          setFontPreviewLanguageId("en");
                        }}
                        className={`relative min-h-[158px] rounded-[12px] border bg-white px-3 py-4 text-center transition ${
                          selected
                            ? "border-blue-500 bg-blue-50/25 shadow-[0_0_0_1px_rgba(37,99,235,0.12)]"
                            : "border-slate-200 hover:border-blue-200 hover:bg-slate-50/40"
                        }`}
                        aria-pressed={selected}
                      >
                        {selected ? (
                          <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                            <CheckIcon />
                          </span>
                        ) : null}

                        <div
                          className="text-[30px] leading-none text-slate-950"
                          style={{ fontFamily: font.family }}
                        >
                          Aa
                        </div>
                        <div
                          className={`mt-3 text-[12px] font-semibold ${
                            selected
                              ? "text-blue-700"
                              : "text-slate-900"
                          }`}
                          style={{ fontFamily: font.family }}
                        >
                          {font.name}
                        </div>
                        <p className="mx-auto mt-2 max-w-[125px] text-[10px] leading-[15px] text-slate-500">
                          {font.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 border-t border-slate-200 pt-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-600">
                      ក
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-semibold text-slate-900">
                        {isKhmerUi ? "ពុម្ពអក្សរខ្មែរ" : "Khmer fonts"}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {isKhmerUi
                          ? "ជ្រើសរើសពុម្ពអក្សរខ្មែរលំនាំដើមសម្រាប់កន្លែងធ្វើការ TENH របស់អ្នក។"
                          : "Choose the default Khmer font for your TENH workspace."}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-slate-500">
                    {isKhmerUi ? "៦ ជម្រើស" : "6 options"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  {workspaceKhmerFonts.map((font) => {
                    const selected = selectedKhmerFontId === font.id;

                    return (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() => {
                          setSelectedKhmerFontId(font.id);
                          setFontPreviewLanguageId("km");
                        }}
                        className={`relative min-h-[170px] rounded-[12px] border bg-white px-3 py-4 text-center transition ${
                          selected
                            ? "border-emerald-500 bg-emerald-50/25 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]"
                            : "border-slate-200 hover:border-emerald-200 hover:bg-slate-50/40"
                        }`}
                        aria-pressed={selected}
                      >
                        {selected ? (
                          <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                            <CheckIcon />
                          </span>
                        ) : null}

                        <div
                          className="text-[26px] leading-none text-slate-950"
                          style={{ fontFamily: font.family }}
                        >
                          {font.sample}
                        </div>
                        <div
                          className={`mt-3 text-[11px] font-semibold ${
                            selected
                              ? "text-emerald-700"
                              : "text-slate-900"
                          }`}
                          style={{ fontFamily: font.family }}
                        >
                          {font.name}
                        </div>
                        <p
                          className="mt-1 text-[10px] text-slate-500"
                          style={{ fontFamily: font.family }}
                        >
                          {font.khmerName}
                        </p>
                        <p className="mx-auto mt-2 max-w-[125px] text-[10px] leading-[15px] text-slate-500">
                          {font.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 flex items-start gap-3 rounded-xl bg-blue-50/70 px-4 py-3 text-[11px] leading-5 text-blue-700">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-blue-600">
                  <InfoIcon />
                </span>
                <p>
                  {isKhmerUi
                    ? "TENH រក្សាទុកពុម្ពអក្សរអង់គ្លេសមួយ និងពុម្ពអក្សរខ្មែរមួយ។ ភាសាដែលកំពុងប្រើនៅក្នុងកន្លែងធ្វើការ នឹងប្រើពុម្ពអក្សរដែលបានរក្សាទុកសម្រាប់ភាសានោះដោយស្វ័យប្រវត្តិ។ អ្នកអាចមើលពុម្ពអក្សរណាមួយជាមុន មុនពេលរក្សាទុក។"
                    : "TENH stores one English font and one Khmer font. The active workspace language automatically uses its matching saved font. Preview either font before saving."}
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
              {fontSavedNotice ? (
                <span className="mr-auto text-[12px] font-medium text-emerald-600">
                  {isKhmerUi ? "បានរក្សាទុកពុម្ពអក្សរ ✓" : "Font saved ✓"}
                </span>
              ) : fontHasChanges ? (
                <span className="mr-auto text-[12px] text-amber-600">
                  {isKhmerUi
                    ? "អ្នកមានការផ្លាស់ប្តូរពុម្ពអក្សរដែលមិនទាន់បានរក្សាទុក។"
                    : "You have unsaved font changes."}
                </span>
              ) : null}

              <button
                type="button"
                onClick={resetFontToDefault}
                disabled={
                  selectedFontId ===
                    DEFAULT_WORKSPACE_ENGLISH_FONT_ID &&
                  selectedKhmerFontId ===
                    DEFAULT_WORKSPACE_KHMER_FONT_ID
                }
                className="h-10 rounded-xl border border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isKhmerUi ? "កំណត់ពុម្ពអក្សរឡើងវិញ" : "Reset fonts"}
              </button>

              <button
                type="button"
                onClick={cancelFontChanges}
                disabled={!fontHasChanges}
                className="h-10 rounded-xl border border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isKhmerUi ? "បោះបង់" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={saveFont}
                disabled={!fontHasChanges}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-[13px] font-semibold text-white shadow-[0_7px_18px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
              >
                <CheckIcon />
                {isKhmerUi ? "រក្សាទុកការផ្លាស់ប្តូរ" : "Save changes"}
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === "language" ? (
          <section className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_8px_26px_rgba(15,23,42,0.045)]">
            <div className="px-6 py-6 sm:px-7">
              <div>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <GlobeIcon />
                  </span>
                  <div>
                    <h2 className="text-[19px] font-bold tracking-[-0.02em] text-slate-950">
                      {isKhmerUi ? "ភាសាកន្លែងធ្វើការ" : "Workspace language"}
                    </h2>
                    <p className="mt-1 text-[13px] text-slate-500">
                      {isKhmerUi
                        ? "ជ្រើសរើសភាសាដែលអ្នកចង់ប្រើក្នុង TENH Chat។"
                        : "Choose the language you want to use in TENH Chat."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {workspaceLanguages.map((language) => {
                  const selected =
                    selectedLanguageId === language.id;
                  const activeFontName =
                    language.id === "km"
                      ? getWorkspaceKhmerFont(selectedKhmerFontId).name
                      : getWorkspaceEnglishFont(selectedFontId).name;

                  return (
                    <button
                      key={language.id}
                      type="button"
                      onClick={() =>
                        setSelectedLanguageId(language.id)
                      }
                      className={`relative flex min-h-[150px] items-center gap-4 rounded-[16px] border p-5 text-left transition ${
                        selected
                          ? "border-blue-500 bg-blue-50/35 shadow-[0_0_0_1px_rgba(37,99,235,0.12)]"
                          : "border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50/40"
                      }`}
                      aria-pressed={selected}
                    >
                      {selected ? (
                        <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">
                          <CheckIcon />
                        </span>
                      ) : null}

                      <span
                        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-xl font-bold ${
                          selected
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-700"
                        }`}
                        style={{
                          fontFamily:
                            language.id === "km"
                              ? getWorkspaceKhmerFont(selectedKhmerFontId)
                                  .family
                              : getWorkspaceEnglishFont(selectedFontId)
                                  .family,
                        }}
                      >
                        {language.id === "km" ? "ក" : "A"}
                      </span>

                      <span className="min-w-0 pr-8">
                        <span className="block text-[16px] font-semibold text-slate-950">
                          {isKhmerUi
                            ? language.id === "km"
                              ? "ខ្មែរ"
                              : "អង់គ្លេស"
                            : language.name}
                        </span>
                        <span
                          className="mt-1 block text-[13px] font-medium text-slate-600"
                          style={{
                            fontFamily:
                              language.id === "km"
                                ? getWorkspaceKhmerFont(selectedKhmerFontId)
                                    .family
                                : undefined,
                          }}
                        >
                          {isKhmerUi
                            ? language.id === "km"
                              ? "ភាសាខ្មែរ"
                              : "អង់គ្លេស"
                            : language.nativeName}
                        </span>
                        <span className="mt-2 block text-[11px] leading-5 text-slate-500">
                          {isKhmerUi
                            ? language.id === "km"
                              ? "ប្រើភាសាខ្មែរជាភាសាកន្លែងធ្វើការ TENH របស់អ្នក។"
                              : "ប្រើភាសាអង់គ្លេសនៅទូទាំងកន្លែងធ្វើការ TENH របស់អ្នក។"
                            : language.description}
                        </span>
                        <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                          {isKhmerUi ? "ពុម្ពអក្សរ៖" : "Font:"} {activeFontName}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex items-start gap-3 rounded-xl bg-blue-50/70 px-4 py-3 text-[11px] leading-5 text-blue-700">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-blue-600">
                  <InfoIcon />
                </span>
                <p>
                  {isKhmerUi
                    ? "ការរក្សាទុកភាសា នឹងរក្សាទុកចំណូលចិត្តភាសាមួយសម្រាប់កន្លែងធ្វើការ៖ អង់គ្លេស ឬ ខ្មែរ។ វាក៏នឹងប្តូរ TENH ទៅប្រើពុម្ពអក្សរអង់គ្លេស ឬពុម្ពអក្សរខ្មែរដែលអ្នកបានរក្សាទុកដោយស្វ័យប្រវត្តិផងដែរ។"
                    : "Saving language stores one workspace preference: English or Khmer. It also switches TENH to your saved English or Khmer font automatically."}
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
              {languageSavedNotice ? (
                <span className="mr-auto text-[12px] font-medium text-emerald-600">
                  {isKhmerUi ? "បានរក្សាទុកភាសា ✓" : "Language saved ✓"}
                </span>
              ) : languageHasChanges ? (
                <span className="mr-auto text-[12px] text-amber-600">
                  {isKhmerUi
                    ? "អ្នកមានការផ្លាស់ប្តូរភាសាដែលមិនទាន់បានរក្សាទុក។"
                    : "You have unsaved language changes."}
                </span>
              ) : (
                <span className="mr-auto text-[12px] text-slate-500">
                  {isKhmerUi ? "បច្ចុប្បន្ន៖" : "Current:"}{" "}
                  {isKhmerUi
                    ? savedLanguageId === "km"
                      ? "ខ្មែរ"
                      : "អង់គ្លេស"
                    : getWorkspaceLanguage(savedLanguageId).name}
                </span>
              )}

              <button
                type="button"
                onClick={cancelLanguageChanges}
                disabled={!languageHasChanges}
                className="h-10 rounded-xl border border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isKhmerUi ? "បោះបង់" : "Cancel"}
              </button>

              <button
                type="button"
                onClick={saveLanguage}
                disabled={!languageHasChanges}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-[13px] font-semibold text-white shadow-[0_7px_18px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"
              >
                <CheckIcon />
                {isKhmerUi ? "រក្សាទុកការផ្លាស់ប្តូរ" : "Save changes"}
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === "background" ? (
          <section className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_8px_26px_rgba(15,23,42,0.045)]">
            <div className="px-6 py-6 sm:px-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[18px] font-bold text-slate-950">
                    {isKhmerUi ? "ផ្ទៃខាងក្រោយការជជែក" : "Chat background"}
                  </h2>
                  <p className="mt-1 text-[13px] text-slate-500">
                    {isKhmerUi
                      ? "ជ្រើសរើសផ្ទៃខាងក្រោយសម្រាប់តំបន់ជជែករបស់អ្នក។ ការកំណត់នេះនឹងអនុវត្តលើការសន្ទនាទាំងអស់។"
                      : "Choose the background for your chat area. This applies to all conversations."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBackgroundPreviewOpen(true)}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-[13px] font-semibold text-blue-600"
                >
                  <EyeIcon />
                  {isKhmerUi ? "មើលជាមុន" : "Preview"}
                </button>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
                {themePresets.map((theme) => {
                  const selected = selectedBackgroundId === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => setSelectedBackgroundId(theme.id)}
                      className="text-left"
                    >
                      <div
                        className={`relative aspect-[1.72/1] overflow-hidden rounded-xl border-2 bg-slate-50 ${
                          selected
                            ? "border-blue-600"
                            : "border-slate-200"
                        }`}
                      >
                        <img
                          src={theme.src}
                          alt={theme.name}
                          className="h-full w-full object-cover"
                        />
                        {selected ? (
                          <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">
                            <CheckIcon />
                          </span>
                        ) : null}
                      </div>
                      <p className={`mt-2 text-[12px] font-semibold ${selected ? "text-blue-700" : "text-slate-700"}`}>
                        {theme.name}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 sm:px-7">
              {backgroundSavedNotice ? (
                <span className="mr-auto text-[12px] font-medium text-emerald-600">
                  {isKhmerUi ? "បានរក្សាទុកផ្ទៃខាងក្រោយ ✓" : "Background saved ✓"}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setSelectedBackgroundId(themePresets[0].id)}
                className="h-10 rounded-xl border border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700"
              >
                {isKhmerUi ? "កំណត់ទៅលំនាំដើមវិញ" : "Reset to default"}
              </button>
              <button
                type="button"
                onClick={saveBackground}
                disabled={!backgroundHasChanges}
                className="h-10 rounded-xl bg-blue-600 px-5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {isKhmerUi ? "រក្សាទុកការផ្លាស់ប្តូរ" : "Save changes"}
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === "theme" ? (
          <section className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_8px_26px_rgba(15,23,42,0.045)]">
            <div className="px-6 py-6 sm:px-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-[18px] font-bold tracking-[-0.02em] text-slate-950">
                    {isKhmerUi ? "ជ្រើសរើសរូបរាង" : "Choose theme"}
                  </h2>
                  <p className="mt-1 text-[13px] text-slate-500">
                    {isKhmerUi
                      ? "ជ្រើសរើសរូបរាងដែលសមនឹងស្ទីលរបស់អ្នក និងជួយកាត់បន្ថយភាពនឿយហត់ភ្នែក។"
                      : "Select a theme that fits your style and reduces eye strain."}
                  </p>
                </div>
                <button type="button" onClick={() => setThemePreviewOpen(true)} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50">
                  <EyeIcon />
                  {isKhmerUi ? "មើលជាមុនក្នុងការជជែក" : "Preview in chat"}
                </button>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                {workspaceThemes.map((theme) => {
                  const available = theme.available;
                  const selected =
                    available && selectedThemeId === theme.id;
                  const displayThemeName = isKhmerUi
                    ? theme.id === "light"
                      ? "ភ្លឺ"
                      : theme.id === "dark"
                        ? "ងងឹត"
                        : "ស្រអាប់"
                    : theme.name;
                  const displayThemeDescription = isKhmerUi
                    ? theme.id === "light"
                      ? "ស្អាត និងភ្លឺ សម្រាប់ការប្រើប្រាស់ប្រចាំថ្ងៃ"
                      : theme.id === "dark"
                        ? "ងាយស្រួលមើលក្នុងទីកន្លែងមានពន្លឺតិច"
                        : "រូបរាងងងឹតស្រាល សម្រាប់ការប្រើប្រាស់រយៈពេលយូរ"
                    : theme.description;

                  return (
                    <button
                      key={theme.id}
                      type="button"
                      disabled={!available}
                      onClick={() => {
                        if (!available) return;
                        setSelectedThemeId(theme.id);
                      }}
                      className={`relative rounded-[14px] border p-3 text-left transition ${
                        selected
                          ? "border-blue-500 bg-blue-50/20 shadow-[0_0_0_1px_rgba(37,99,235,0.12)]"
                          : available
                            ? "border-slate-200 hover:border-blue-200 hover:bg-slate-50/40"
                            : "cursor-not-allowed border-slate-200 bg-slate-50/70 opacity-65"
                      }`}
                      aria-pressed={selected}
                      aria-disabled={!available}
                      title={
                        available
                          ? displayThemeName
                          : isKhmerUi
                            ? `${displayThemeName} · មកដល់ឆាប់ៗនេះ`
                            : `${displayThemeName} is coming soon`
                      }
                    >
                      {selected ? (
                        <span className="absolute right-4 top-4 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
                          <CheckIcon />
                        </span>
                      ) : !available ? (
                        <span className="absolute right-4 top-4 z-10 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500 shadow-sm">
                          {isKhmerUi ? "មកដល់ឆាប់ៗនេះ" : "Coming soon"}
                        </span>
                      ) : null}

                      <div className={!available ? "grayscale-[0.25]" : ""}>
                        <ThemeMiniPreview themeId={theme.id} />
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <span
                          className={
                            selected
                              ? "text-blue-600"
                              : "text-slate-500"
                          }
                        >
                          {theme.id === "light" ? (
                            <SunIcon />
                          ) : theme.id === "dark" ? (
                            <MoonIcon />
                          ) : (
                            <DimIcon />
                          )}
                        </span>

                        <p
                          className={`text-[13px] font-semibold ${
                            selected
                              ? "text-blue-700"
                              : available
                                ? "text-slate-900"
                                : "text-slate-500"
                          }`}
                        >
                          {displayThemeName}
                        </p>
                      </div>

                      <p className="mt-1 text-[11px] leading-5 text-slate-500">
                        {available
                          ? displayThemeDescription
                          : isKhmerUi
                            ? `${displayThemeDescription} · មកដល់ឆាប់ៗនេះ`
                            : `${displayThemeDescription} · Coming soon`}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
              {themeSavedNotice ? <span className="mr-auto text-[12px] font-medium text-emerald-600">{isKhmerUi ? "បានរក្សាទុករូបរាង ✓" : "Theme saved ✓"}</span> : themeHasChanges ? <span className="mr-auto text-[12px] text-amber-600">{isKhmerUi ? "អ្នកមានការផ្លាស់ប្តូររូបរាងដែលមិនទាន់បានរក្សាទុក។" : "You have unsaved theme changes."}</span> : null}
              <button type="button" onClick={resetThemeToDefault} disabled={selectedThemeId === DEFAULT_WORKSPACE_THEME_ID} className="h-10 rounded-xl border border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45">{isKhmerUi ? "កំណត់ទៅភ្លឺវិញ" : "Reset to Light"}</button>
              <button type="button" onClick={cancelThemeChanges} disabled={!themeHasChanges} className="h-10 rounded-xl border border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45">{isKhmerUi ? "បោះបង់" : "Cancel"}</button>
              <button type="button" onClick={saveTheme} disabled={!themeHasChanges || !isAvailableWorkspaceThemeId(selectedThemeId)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-[13px] font-semibold text-white shadow-[0_7px_18px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 disabled:shadow-none"><CheckIcon />{isKhmerUi ? "រក្សាទុកការផ្លាស់ប្តូរ" : "Save changes"}</button>
            </div>
          </section>
        ) : null}

        {activeTab === "colors" ? (
          <section className="overflow-hidden rounded-[18px] border border-slate-200 bg-white shadow-[0_8px_26px_rgba(15,23,42,0.045)]">
            <div className="px-6 py-6 sm:px-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-[18px] font-bold tracking-[-0.02em] text-slate-950">
                    {isKhmerUi ? "កំណត់ពណ៌តាមចំណូលចិត្ត" : "Customize colors"}
                  </h2>
                  <p className="mt-1 text-[13px] text-slate-500">
                    {isKhmerUi
                      ? "ជ្រើសរើសពណ៌ដែលតំណាងឲ្យម៉ាករបស់អ្នក និងបង្កើតបរិយាកាសសមស្របសម្រាប់កន្លែងធ្វើការរបស់អ្នក។"
                      : "Choose colors that reflect your brand and create the right mood for your workspace."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setColorPreviewOpen(true)}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                >
                  <EyeIcon />
                  {isKhmerUi ? "មើលជាមុនក្នុងការជជែក" : "Preview in chat"}
                </button>
              </div>

              <div className="mt-6 border-t border-slate-200 pt-5 lg:grid lg:grid-cols-[1.08fr_0.92fr] lg:gap-7">
                <div className="lg:border-r lg:border-slate-200 lg:pr-7">
                  <div>
                    <h3 className="text-[13px] font-semibold text-slate-900">
                      {isKhmerUi ? "ពណ៌កំណត់ជាមុន" : "Color presets"}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {isKhmerUi
                        ? "ជ្រើសរើសពណ៌ដែលបានកំណត់ជាមុន ដើម្បីចាប់ផ្តើមបានយ៉ាងឆាប់រហ័ស។"
                        : "Choose a preset to get started quickly."}
                    </p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {workspaceColorPresets.map((preset) => {
                      const selected = selectedColorPresetId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => selectColorPreset(preset.id)}
                          className={`relative min-h-[104px] rounded-[12px] border px-3 py-3 text-center transition ${
                            selected
                              ? "border-blue-500 bg-blue-50/20 shadow-[0_0_0_1px_rgba(37,99,235,0.10)]"
                              : "border-slate-200 hover:border-blue-200 hover:bg-slate-50/50"
                          }`}
                          aria-pressed={selected}
                        >
                          {selected ? (
                            <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                              <CheckIcon />
                            </span>
                          ) : null}
                          <div className="mt-1">
                            <ColorSwatches colors={preset.colors} />
                          </div>
                          <p className={`mt-3 text-[10px] font-semibold ${selected ? "text-blue-700" : "text-slate-700"}`}>
                            {preset.name}
                          </p>
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => selectColorPreset("custom")}
                      className={`relative min-h-[104px] rounded-[12px] border px-3 py-3 text-center transition ${
                        selectedColorPresetId === "custom"
                          ? "border-blue-500 bg-blue-50/20 shadow-[0_0_0_1px_rgba(37,99,235,0.10)]"
                          : "border-slate-200 hover:border-blue-200 hover:bg-slate-50/50"
                      }`}
                    >
                      {selectedColorPresetId === "custom" ? (
                        <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white">
                          <CheckIcon />
                        </span>
                      ) : null}
                      <span className="mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500">
                        <PlusIcon />
                      </span>
                      <p className="mt-3 text-[10px] font-semibold text-slate-700">
                        {isKhmerUi ? "ផ្ទាល់ខ្លួន" : "Custom"}
                      </p>
                    </button>
                  </div>

                  <div className="mt-6">
                    <h3 className="text-[13px] font-semibold text-slate-900">
                      {isKhmerUi ? "មើលជាមុនភ្លាមៗ" : "Live preview"}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {isKhmerUi
                        ? "មើលថាពណ៌ទាំងនេះបង្ហាញយ៉ាងដូចម្តេចនៅក្នុងផ្ទាំងជជែករបស់អ្នក។"
                        : "See how these colors look in your chat interface."}
                    </p>
                    <div className="mt-3">
                      <ColorLivePreview colors={selectedColors} compact />
                    </div>
                  </div>
                </div>

                <div className="mt-7 lg:mt-0">
                  <div>
                    <h3 className="text-[13px] font-semibold text-slate-900">
                      {isKhmerUi ? "ការកំណត់ពណ៌ផ្ទាល់ខ្លួន" : "Custom color settings"}
                    </h3>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {isKhmerUi
                        ? "កែតម្រូវពណ៌នីមួយៗឲ្យសមនឹងម៉ាករបស់អ្នក។"
                        : "Fine-tune each color to match your brand."}
                    </p>
                  </div>

                  <div className="mt-4 space-y-3.5">
                    {colorFieldMeta.map((field) => {
                      const value = selectedColors[field.key];
                      const valid = isValidHexColor(value);
                      const localizedField = isKhmerUi
                        ? colorFieldKhmerMeta[field.key]
                        : field;

                      return (
                        <div
                          key={field.key}
                          className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <label
                              className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-slate-200 shadow-sm"
                              style={{ backgroundColor: valid ? value : "#FFFFFF" }}
                              title={`Choose ${localizedField.label}`}
                            >
                              <input
                                type="color"
                                value={valid ? value : "#FFFFFF"}
                                onChange={(event) => updateColorValue(field.key, event.target.value)}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                aria-label={`Choose ${localizedField.label}`}
                              />
                            </label>

                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-semibold text-slate-800">
                                {localizedField.label}
                              </p>
                              <p className="mt-0.5 truncate text-[9px] text-slate-500">
                                {localizedField.description}
                              </p>
                            </div>
                          </div>

                          <div className={`flex h-9 items-center overflow-hidden rounded-lg border bg-white ${valid ? "border-slate-200" : "border-red-300"}`}>
                            <input
                              type="text"
                              value={value}
                              maxLength={7}
                              onChange={(event) => updateColorValue(field.key, event.target.value)}
                              className="min-w-0 flex-1 bg-transparent px-3 text-[10px] font-medium uppercase text-slate-700 outline-none"
                              aria-label={`${localizedField.label} hex color`}
                            />
                            <label className="flex h-full w-9 shrink-0 cursor-pointer items-center justify-center border-l border-slate-200 text-slate-400 hover:bg-slate-50">
                              <PaletteGridIcon />
                              <input
                                type="color"
                                value={valid ? value : "#FFFFFF"}
                                onChange={(event) => updateColorValue(field.key, event.target.value)}
                                className="sr-only"
                                aria-label={`Open ${localizedField.label} color picker`}
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-start gap-3 rounded-xl bg-blue-50/70 px-4 py-3 text-[11px] leading-5 text-blue-700">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-blue-600">
                  <InfoIcon />
                </span>
                <p>
                  {isKhmerUi
                    ? "ពណ៌ដែលបានរក្សាទុក នឹងត្រូវអនុវត្តនៅទូទាំង TENH រួមមាន ប៊ូតុងចម្បង ស្ថានភាពដែលកំពុងប្រើ តំណ សារជោគជ័យ ការព្រមាន កំហុស ស៊ុម និងធាតុ UI រួមផ្សេងៗទៀតនៅក្នុងកន្លែងធ្វើការ។"
                    : "Saved colors are applied across TENH, including primary buttons, active states, links, success messages, warnings, errors, borders, and other shared workspace UI."}
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
              {colorSavedNotice ? (
                <span className="mr-auto text-[12px] font-medium text-emerald-600">
                  {isKhmerUi ? "បានរក្សាទុកពណ៌ ✓" : "Colors saved ✓"}
                </span>
              ) : colorsHaveChanges ? (
                <span className="mr-auto text-[12px] text-amber-600">
                  {isKhmerUi
                    ? "អ្នកមានការផ្លាស់ប្តូរពណ៌ដែលមិនទាន់បានរក្សាទុក។"
                    : "You have unsaved color changes."}
                </span>
              ) : null}

              <button
                type="button"
                onClick={resetColorsToDefault}
                disabled={
                  selectedColorPresetId === DEFAULT_WORKSPACE_COLOR_PRESET_ID &&
                  JSON.stringify(selectedColors) === JSON.stringify(DEFAULT_WORKSPACE_COLORS)
                }
                className="h-10 rounded-xl border border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isKhmerUi ? "កំណត់ទៅ TENH Blue វិញ" : "Reset to TENH Blue"}
              </button>

              <button
                type="button"
                onClick={cancelColorChanges}
                disabled={!colorsHaveChanges}
                className="h-10 rounded-xl border border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isKhmerUi ? "បោះបង់" : "Cancel"}
              </button>

              <button
                type="button"
                onClick={saveColors}
                disabled={
                  !colorsHaveChanges ||
                  !Object.values(selectedColors).every((value) => isValidHexColor(value))
                }
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-semibold text-white shadow-[0_7px_18px_rgba(37,99,235,0.18)] transition disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
                style={{ backgroundColor: selectedColors.primary }}
              >
                <CheckIcon />
                {isKhmerUi ? "រក្សាទុកការផ្លាស់ប្តូរ" : "Save changes"}
              </button>
            </div>
          </section>
        ) : null}
      </main>

      <ThemePreviewModal
        open={themePreviewOpen}
        onClose={() => setThemePreviewOpen(false)}
        themeId={selectedThemeId}
      />

      <PreviewModal
        open={fontPreviewOpen}
        onClose={() => setFontPreviewOpen(false)}
        previewLanguageId={fontPreviewLanguageId}
        englishFontId={selectedFontId}
        khmerFontId={selectedKhmerFontId}
      />

      <BackgroundPreviewModal
        open={backgroundPreviewOpen}
        onClose={() => setBackgroundPreviewOpen(false)}
        src={selectedBackground.src}
        isKhmer={isKhmerUi}
      />

      <ColorPreviewModal
        open={colorPreviewOpen}
        onClose={() => setColorPreviewOpen(false)}
        colors={selectedColors}
      />
    </>
  );
}
