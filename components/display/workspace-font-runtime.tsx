"use client";

import { useEffect, useState } from "react";

import {
  DEFAULT_WORKSPACE_ENGLISH_FONT_ID,
  DEFAULT_WORKSPACE_KHMER_FONT_ID,
  WORKSPACE_ENGLISH_FONT_STORAGE_KEY,
  WORKSPACE_KHMER_FONT_STORAGE_KEY,
  WORKSPACE_FONT_CHANGE_EVENT,
  applyWorkspaceEnglishFont,
  applyWorkspaceKhmerFont,
  getStoredWorkspaceEnglishFontId,
  getStoredWorkspaceKhmerFontId,
  getWorkspaceEnglishFont,
  getWorkspaceKhmerFont,
  isWorkspaceEnglishFontId,
  isWorkspaceKhmerFontId,
  type WorkspaceEnglishFontId,
  type WorkspaceKhmerFontId,
} from "@/lib/display/workspace-fonts";
import {
  DEFAULT_WORKSPACE_LANGUAGE_ID,
  WORKSPACE_LANGUAGE_CHANGE_EVENT,
  WORKSPACE_LANGUAGE_STORAGE_KEY,
  applyWorkspaceLanguage,
  getStoredWorkspaceLanguageId,
  isWorkspaceLanguageId,
  type WorkspaceLanguageId,
} from "@/lib/display/workspace-language";
import {
  DEFAULT_WORKSPACE_THEME_ID,
  WORKSPACE_THEME_CHANGE_EVENT,
  WORKSPACE_THEME_STORAGE_KEY,
  applyWorkspaceTheme,
  getStoredWorkspaceThemeId,
  isWorkspaceThemeId,
  type WorkspaceThemeId,
} from "@/lib/display/workspace-themes";
import {
  WORKSPACE_COLOR_CHANGE_EVENT,
  WORKSPACE_COLOR_STORAGE_KEY,
  applyWorkspaceColors,
  getStoredWorkspaceColorSettings,
  type WorkspaceColorSettings,
} from "@/lib/display/workspace-colors";
import {
  TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
} from "@/lib/display/workspace-storage";

export function WorkspaceFontRuntime() {
  const [englishFontId, setEnglishFontId] =
    useState<WorkspaceEnglishFontId>(
      DEFAULT_WORKSPACE_ENGLISH_FONT_ID,
    );
  const [khmerFontId, setKhmerFontId] =
    useState<WorkspaceKhmerFontId>(
      DEFAULT_WORKSPACE_KHMER_FONT_ID,
    );
  const [languageId, setLanguageId] =
    useState<WorkspaceLanguageId>(
      DEFAULT_WORKSPACE_LANGUAGE_ID,
    );
  const [themeId, setThemeId] =
    useState<WorkspaceThemeId>(DEFAULT_WORKSPACE_THEME_ID);

  function applyActiveFont(
    language: WorkspaceLanguageId,
    englishId: WorkspaceEnglishFontId,
    khmerId: WorkspaceKhmerFontId,
  ) {
    if (language === "km") {
      applyWorkspaceKhmerFont(khmerId);
    } else {
      applyWorkspaceEnglishFont(englishId);
    }
  }

  useEffect(() => {
    const storedEnglishFont = getStoredWorkspaceEnglishFontId();
    const storedKhmerFont = getStoredWorkspaceKhmerFontId();
    const storedLanguage = getStoredWorkspaceLanguageId();
    const storedTheme = getStoredWorkspaceThemeId();
    const storedColors = getStoredWorkspaceColorSettings();

    setEnglishFontId(storedEnglishFont);
    setKhmerFontId(storedKhmerFont);
    setLanguageId(storedLanguage);
    setThemeId(storedTheme);

    applyWorkspaceLanguage(storedLanguage);
    applyActiveFont(
      storedLanguage,
      storedEnglishFont,
      storedKhmerFont,
    );
    applyWorkspaceTheme(storedTheme);
    applyWorkspaceColors(storedColors.colors, storedColors.presetId);

    function syncWorkspaceDisplay() {
      const nextEnglish = getStoredWorkspaceEnglishFontId();
      const nextKhmer = getStoredWorkspaceKhmerFontId();
      const nextLanguage = getStoredWorkspaceLanguageId();
      const nextTheme = getStoredWorkspaceThemeId();
      const nextColors = getStoredWorkspaceColorSettings();

      setEnglishFontId(nextEnglish);
      setKhmerFontId(nextKhmer);
      setLanguageId(nextLanguage);
      setThemeId(nextTheme);

      applyWorkspaceLanguage(nextLanguage);
      applyActiveFont(nextLanguage, nextEnglish, nextKhmer);
      applyWorkspaceTheme(nextTheme);
      applyWorkspaceColors(nextColors.colors, nextColors.presetId);
    }

    function handleFontChange(event: Event) {
      const customEvent = event as CustomEvent<{
        id?: string;
        englishId?: string;
        khmerId?: string;
        language?: string;
      }>;
      const detail = customEvent.detail ?? {};

      let nextEnglish = getStoredWorkspaceEnglishFontId();
      let nextKhmer = getStoredWorkspaceKhmerFontId();

      const requestedEnglish = detail.englishId ?? null;
      const requestedFont = detail.id ?? null;
      const requestedKhmer = detail.khmerId ?? null;

      if (isWorkspaceEnglishFontId(requestedEnglish)) {
        nextEnglish = requestedEnglish;
        setEnglishFontId(requestedEnglish);
      } else if (
        (!detail.language || detail.language === "en") &&
        isWorkspaceEnglishFontId(requestedFont)
      ) {
        nextEnglish = requestedFont;
        setEnglishFontId(requestedFont);
      }

      if (isWorkspaceKhmerFontId(requestedKhmer)) {
        nextKhmer = requestedKhmer;
        setKhmerFontId(requestedKhmer);
      } else if (
        detail.language === "km" &&
        isWorkspaceKhmerFontId(requestedFont)
      ) {
        nextKhmer = requestedFont;
        setKhmerFontId(requestedFont);
      }

      const currentLanguage = getStoredWorkspaceLanguageId();
      applyActiveFont(currentLanguage, nextEnglish, nextKhmer);
    }

    function handleLanguageChange(event: Event) {
      const customEvent = event as CustomEvent<{ id?: string }>;
      const nextLanguage = customEvent.detail?.id ?? null;

      if (!isWorkspaceLanguageId(nextLanguage)) return;

      setLanguageId(nextLanguage);
      applyWorkspaceLanguage(nextLanguage);
      applyActiveFont(
        nextLanguage,
        getStoredWorkspaceEnglishFontId(),
        getStoredWorkspaceKhmerFontId(),
      );
    }

    function handleThemeChange(event: Event) {
      const customEvent = event as CustomEvent<{ id?: string }>;
      const nextId = customEvent.detail?.id ?? null;

      if (!isWorkspaceThemeId(nextId)) return;

      setThemeId(nextId);
      applyWorkspaceTheme(nextId);
    }

    function handleColorChange(event: Event) {
      const customEvent = event as CustomEvent<WorkspaceColorSettings>;
      const detail = customEvent.detail;
      if (!detail?.colors || !detail?.presetId) return;
      applyWorkspaceColors(detail.colors, detail.presetId);
    }

    function handleStorage(event: StorageEvent) {
      const key = event.key ?? "";
      if (
        key === WORKSPACE_ENGLISH_FONT_STORAGE_KEY ||
        key.startsWith(`${WORKSPACE_ENGLISH_FONT_STORAGE_KEY}:`) ||
        key === WORKSPACE_KHMER_FONT_STORAGE_KEY ||
        key.startsWith(`${WORKSPACE_KHMER_FONT_STORAGE_KEY}:`) ||
        key === WORKSPACE_LANGUAGE_STORAGE_KEY ||
        key.startsWith(`${WORKSPACE_LANGUAGE_STORAGE_KEY}:`) ||
        key === WORKSPACE_THEME_STORAGE_KEY ||
        key.startsWith(`${WORKSPACE_THEME_STORAGE_KEY}:`) ||
        key === WORKSPACE_COLOR_STORAGE_KEY ||
        key.startsWith(`${WORKSPACE_COLOR_STORAGE_KEY}:`)
      ) {
        syncWorkspaceDisplay();
      }
    }

    function handleWorkspaceUiChange() {
      syncWorkspaceDisplay();
    }

    window.addEventListener(
      WORKSPACE_FONT_CHANGE_EVENT,
      handleFontChange,
    );
    window.addEventListener(
      WORKSPACE_LANGUAGE_CHANGE_EVENT,
      handleLanguageChange,
    );
    window.addEventListener(
      WORKSPACE_THEME_CHANGE_EVENT,
      handleThemeChange,
    );
    window.addEventListener(
      WORKSPACE_COLOR_CHANGE_EVENT,
      handleColorChange,
    );
    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
      handleWorkspaceUiChange,
    );

    return () => {
      window.removeEventListener(
        WORKSPACE_FONT_CHANGE_EVENT,
        handleFontChange,
      );
      window.removeEventListener(
        WORKSPACE_LANGUAGE_CHANGE_EVENT,
        handleLanguageChange,
      );
      window.removeEventListener(
        WORKSPACE_THEME_CHANGE_EVENT,
        handleThemeChange,
      );
      window.removeEventListener(
        WORKSPACE_COLOR_CHANGE_EVENT,
        handleColorChange,
      );
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        TENH_ACTIVE_WORKSPACE_UI_CHANGE_EVENT,
        handleWorkspaceUiChange,
      );
    };
  }, []);

  const font =
    languageId === "km"
      ? getWorkspaceKhmerFont(khmerFontId)
      : getWorkspaceEnglishFont(englishFontId);

  return (
    <style jsx global>{`
      :root {
        --tenh-workspace-font: ${font.family};
        --font-sans: ${font.family};
        --default-font-family: ${font.family};
      }

      body,
      button,
      input,
      textarea,
      select {
        font-family: var(--tenh-workspace-font);
      }

      html[data-tenh-workspace-theme="dark"] body {
        background: #0b1120 !important;
        color: #e5e7eb;
      }

      html[data-tenh-workspace-theme="dark"] .bg-white {
        background-color: #111827 !important;
      }
      html[data-tenh-workspace-theme="dark"] .bg-slate-50,
      html[data-tenh-workspace-theme="dark"] .bg-slate-50\/70,
      html[data-tenh-workspace-theme="dark"] .bg-slate-50\/40 {
        background-color: #0f172a !important;
      }
      html[data-tenh-workspace-theme="dark"] .bg-slate-100 {
        background-color: #172033 !important;
      }
      html[data-tenh-workspace-theme="dark"] .bg-slate-200 {
        background-color: #243044 !important;
      }
      html[data-tenh-workspace-theme="dark"] .border-slate-100,
      html[data-tenh-workspace-theme="dark"] .border-slate-200,
      html[data-tenh-workspace-theme="dark"] .border-slate-200\/90,
      html[data-tenh-workspace-theme="dark"] .border-slate-300 {
        border-color: #334155 !important;
      }
      html[data-tenh-workspace-theme="dark"] .text-slate-950,
      html[data-tenh-workspace-theme="dark"] .text-slate-900,
      html[data-tenh-workspace-theme="dark"] .text-slate-800 {
        color: #f8fafc !important;
      }
      html[data-tenh-workspace-theme="dark"] .text-slate-700,
      html[data-tenh-workspace-theme="dark"] .text-slate-600 {
        color: #cbd5e1 !important;
      }
      html[data-tenh-workspace-theme="dark"] .text-slate-500 {
        color: #94a3b8 !important;
      }
      html[data-tenh-workspace-theme="dark"] .text-slate-400 {
        color: #64748b !important;
      }
      html[data-tenh-workspace-theme="dark"] input,
      html[data-tenh-workspace-theme="dark"] textarea,
      html[data-tenh-workspace-theme="dark"] select {
        background-color: #111827 !important;
        color: #f8fafc !important;
        border-color: #334155 !important;
      }

      html[data-tenh-workspace-theme="dim"] body {
        background: #1b2230 !important;
        color: #e2e8f0;
      }
      html[data-tenh-workspace-theme="dim"] .bg-white {
        background-color: #273140 !important;
      }
      html[data-tenh-workspace-theme="dim"] .bg-slate-50,
      html[data-tenh-workspace-theme="dim"] .bg-slate-50\/70,
      html[data-tenh-workspace-theme="dim"] .bg-slate-50\/40 {
        background-color: #202936 !important;
      }
      html[data-tenh-workspace-theme="dim"] .bg-slate-100 {
        background-color: #303a49 !important;
      }
      html[data-tenh-workspace-theme="dim"] .bg-slate-200 {
        background-color: #3a4657 !important;
      }
      html[data-tenh-workspace-theme="dim"] .border-slate-100,
      html[data-tenh-workspace-theme="dim"] .border-slate-200,
      html[data-tenh-workspace-theme="dim"] .border-slate-200\/90,
      html[data-tenh-workspace-theme="dim"] .border-slate-300 {
        border-color: #465466 !important;
      }
      html[data-tenh-workspace-theme="dim"] .text-slate-950,
      html[data-tenh-workspace-theme="dim"] .text-slate-900,
      html[data-tenh-workspace-theme="dim"] .text-slate-800 {
        color: #f1f5f9 !important;
      }
      html[data-tenh-workspace-theme="dim"] .text-slate-700,
      html[data-tenh-workspace-theme="dim"] .text-slate-600 {
        color: #d5dde8 !important;
      }
      html[data-tenh-workspace-theme="dim"] .text-slate-500 {
        color: #a8b4c4 !important;
      }
      html[data-tenh-workspace-theme="dim"] .text-slate-400 {
        color: #7f8da1 !important;
      }
      html[data-tenh-workspace-theme="dim"] input,
      html[data-tenh-workspace-theme="dim"] textarea,
      html[data-tenh-workspace-theme="dim"] select {
        background-color: #273140 !important;
        color: #f1f5f9 !important;
        border-color: #465466 !important;
      }


      /* TENH workspace color system ----------------------------------
       * UI-only palette bridge.
       * This maps existing Tailwind blue utilities used throughout TENH
       * to the saved workspace palette without changing any component logic.
       */

      /* Primary solid backgrounds: buttons, badges, active icons. */
      .bg-blue-400,
      .bg-blue-500,
      .bg-blue-600,
      .bg-blue-700 {
        background-color: var(--tenh-primary, #2563eb) !important;
      }

      /* Primary tinted backgrounds: selected rows, active menu items, reply states. */
      .bg-blue-50,
      .bg-blue-50\/25,
      .bg-blue-50\/40,
      .bg-blue-50\/50,
      .bg-blue-50\/60,
      .bg-blue-50\/70,
      .bg-blue-50\/80,
      .bg-blue-50\/90,
      .bg-blue-100,
      .bg-blue-100\/50,
      .bg-blue-100\/70,
      .bg-blue-100\/80,
      .bg-blue-200,
      .bg-blue-200\/50,
      .bg-blue-200\/70 {
        background-color: var(--tenh-primary-light, #dbeafe) !important;
      }

      /* Hover / active primary backgrounds. */
      .hover\:bg-blue-50:hover,
      .hover\:bg-blue-100:hover,
      .hover\:bg-blue-200:hover {
        background-color: var(--tenh-primary-light, #dbeafe) !important;
      }
      .hover\:bg-blue-500:hover,
      .hover\:bg-blue-600:hover,
      .hover\:bg-blue-700:hover,
      .active\:bg-blue-600:active,
      .active\:bg-blue-700:active {
        background-color: var(--tenh-primary-hover, #1d4ed8) !important;
      }

      /* Primary text: links, active labels, seen status, selected actions. */
      .text-blue-400,
      .text-blue-500,
      .text-blue-600,
      .text-blue-700,
      .text-blue-800,
      .text-blue-900,
      .hover\:text-blue-500:hover,
      .hover\:text-blue-600:hover,
      .hover\:text-blue-700:hover,
      .hover\:text-blue-800:hover,
      .focus\:text-blue-600:focus,
      .focus\:text-blue-700:focus {
        color: var(--tenh-primary, #2563eb) !important;
      }

      /* Primary borders: selected cards, input focus, reply bars. */
      .border-blue-50,
      .border-blue-100,
      .border-blue-200,
      .border-blue-300,
      .border-blue-400,
      .border-blue-500,
      .border-blue-600,
      .border-blue-700,
      .hover\:border-blue-200:hover,
      .hover\:border-blue-300:hover,
      .hover\:border-blue-400:hover,
      .hover\:border-blue-500:hover,
      .focus\:border-blue-300:focus,
      .focus\:border-blue-400:focus,
      .focus\:border-blue-500:focus,
      .focus\:border-blue-600:focus {
        border-color: color-mix(
          in srgb,
          var(--tenh-primary, #2563eb) 48%,
          var(--tenh-primary-light, #dbeafe)
        ) !important;
      }

      /* Ring / outline states used by selected Inbox items and focused controls. */
      .ring-blue-100,
      .ring-blue-200,
      .ring-blue-300,
      .ring-blue-400,
      .ring-blue-500,
      .focus\:ring-blue-100:focus,
      .focus\:ring-blue-200:focus,
      .focus\:ring-blue-300:focus,
      .focus\:ring-blue-400:focus,
      .focus\:ring-blue-500:focus {
        --tw-ring-color: color-mix(
          in srgb,
          var(--tenh-primary, #2563eb) 34%,
          transparent
        ) !important;
      }
      .outline-blue-400,
      .outline-blue-500,
      .focus\:outline-blue-400:focus,
      .focus\:outline-blue-500:focus {
        outline-color: var(--tenh-primary, #2563eb) !important;
      }

      /* Blue divider bars such as message-day separators. */
      .bg-blue-200\/70,
      .bg-blue-300\/70 {
        background-color: color-mix(
          in srgb,
          var(--tenh-primary, #2563eb) 28%,
          transparent
        ) !important;
      }

      /* Common TENH hard-coded blue utilities from newer UI patches.
       * Attribute selectors are intentionally limited to TENH blue shades;
       * platform-brand colors such as Messenger/Facebook #1877F2 are NOT changed.
       */
      [class*="bg-[#1463FF]" i],
      [class*="bg-[#2563EB]" i],
      [class*="bg-[#0A4DFF]" i],
      [class*="bg-[#2EA8FF]" i] {
        background-color: var(--tenh-primary, #2563eb) !important;
      }
      [class*="text-[#1463FF]" i],
      [class*="text-[#2563EB]" i],
      [class*="text-[#0A4DFF]" i],
      [class*="text-[#2EA8FF]" i] {
        color: var(--tenh-primary, #2563eb) !important;
      }
      [class*="border-[#1463FF]" i],
      [class*="border-[#2563EB]" i],
      [class*="border-[#0A4DFF]" i],
      [class*="border-[#2EA8FF]" i] {
        border-color: var(--tenh-primary, #2563eb) !important;
      }

      /* Primary gradients. */
      .from-blue-500,
      .from-blue-600,
      .from-blue-700,
      [class*="from-[#1463FF]" i],
      [class*="from-[#2563EB]" i] {
        --tw-gradient-from: var(--tenh-primary, #2563eb) var(--tw-gradient-from-position) !important;
        --tw-gradient-to: color-mix(in srgb, var(--tenh-primary, #2563eb) 0%, transparent) var(--tw-gradient-to-position) !important;
      }
      .to-blue-500,
      .to-blue-600,
      .to-blue-700,
      [class*="to-[#1463FF]" i],
      [class*="to-[#2563EB]" i] {
        --tw-gradient-to: var(--tenh-primary-hover, #1d4ed8) var(--tw-gradient-to-position) !important;
      }

      /* Accent color. */
      .text-cyan-400,
      .text-cyan-500,
      .text-cyan-600,
      .text-sky-400,
      .text-sky-500,
      .text-sky-600,
      .text-indigo-500,
      .text-indigo-600 {
        color: var(--tenh-accent, #0ea5e9) !important;
      }
      .bg-cyan-400,
      .bg-cyan-500,
      .bg-cyan-600,
      .bg-sky-400,
      .bg-sky-500,
      .bg-sky-600,
      .bg-indigo-500,
      .bg-indigo-600 {
        background-color: var(--tenh-accent, #0ea5e9) !important;
      }

      /* Success color. */
      .text-emerald-500,
      .text-emerald-600,
      .text-emerald-700,
      .text-green-500,
      .text-green-600,
      .text-green-700 {
        color: var(--tenh-success, #16a34a) !important;
      }
      .bg-emerald-500,
      .bg-emerald-600,
      .bg-green-500,
      .bg-green-600 {
        background-color: var(--tenh-success, #16a34a) !important;
      }
      .bg-emerald-50,
      .bg-emerald-100,
      .bg-green-50,
      .bg-green-100 {
        background-color: color-mix(in srgb, var(--tenh-success, #16a34a) 12%, white) !important;
      }
      .border-emerald-100,
      .border-emerald-200,
      .border-green-100,
      .border-green-200 {
        border-color: color-mix(in srgb, var(--tenh-success, #16a34a) 34%, white) !important;
      }

      /* Warning color. */
      .text-amber-500,
      .text-amber-600,
      .text-amber-700,
      .text-orange-500,
      .text-orange-600,
      .text-orange-700 {
        color: var(--tenh-warning, #f97316) !important;
      }
      .bg-amber-500,
      .bg-amber-600,
      .bg-orange-500,
      .bg-orange-600 {
        background-color: var(--tenh-warning, #f97316) !important;
      }
      .bg-amber-50,
      .bg-amber-100,
      .bg-orange-50,
      .bg-orange-100 {
        background-color: color-mix(in srgb, var(--tenh-warning, #f97316) 12%, white) !important;
      }
      .border-amber-100,
      .border-amber-200,
      .border-orange-100,
      .border-orange-200 {
        border-color: color-mix(in srgb, var(--tenh-warning, #f97316) 34%, white) !important;
      }

      /* Error/destructive color. */
      .text-red-500,
      .text-red-600,
      .text-red-700 {
        color: var(--tenh-error, #ef4444) !important;
      }
      .bg-red-500,
      .bg-red-600,
      .bg-red-700 {
        background-color: var(--tenh-error, #ef4444) !important;
      }
      .bg-red-50,
      .bg-red-100 {
        background-color: color-mix(in srgb, var(--tenh-error, #ef4444) 10%, white) !important;
      }
      .border-red-100,
      .border-red-200,
      .border-red-300 {
        border-color: color-mix(in srgb, var(--tenh-error, #ef4444) 34%, white) !important;
      }

      /* Neutral borders in light mode. */
      html[data-tenh-workspace-theme="light"] .border-slate-100,
      html[data-tenh-workspace-theme="light"] .border-slate-200,
      html[data-tenh-workspace-theme="light"] .border-slate-200\/90,
      html[data-tenh-workspace-theme="light"] .border-slate-300 {
        border-color: var(--tenh-neutral, #cbd5e1) !important;
      }

      ::selection {
        background: var(--tenh-primary-light, #dbeafe);
        color: #0f172a;
      }
    `}</style>
  );
}

export default WorkspaceFontRuntime;
