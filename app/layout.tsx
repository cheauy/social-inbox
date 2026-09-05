import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import Script from "next/script";

import { WorkspaceFontRuntime } from "@/components/display/workspace-font-runtime";
import {
  DEFAULT_WORKSPACE_ENGLISH_FONT_ID,
  DEFAULT_WORKSPACE_KHMER_FONT_ID,
  WORKSPACE_ENGLISH_FONT_STORAGE_KEY,
  WORKSPACE_KHMER_FONT_STORAGE_KEY,
  workspaceEnglishFonts,
  workspaceKhmerFonts,
} from "@/lib/display/workspace-fonts";
import {
  DEFAULT_WORKSPACE_LANGUAGE_ID,
  WORKSPACE_LANGUAGE_STORAGE_KEY,
} from "@/lib/display/workspace-language";

import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const workspaceFontBootstrap = `
(function () {
  try {
    var languageKey = ${JSON.stringify(WORKSPACE_LANGUAGE_STORAGE_KEY)};
    var englishKey = ${JSON.stringify(WORKSPACE_ENGLISH_FONT_STORAGE_KEY)};
    var khmerKey = ${JSON.stringify(WORKSPACE_KHMER_FONT_STORAGE_KEY)};
    var defaultLanguage = ${JSON.stringify(DEFAULT_WORKSPACE_LANGUAGE_ID)};
    var defaultEnglish = ${JSON.stringify(DEFAULT_WORKSPACE_ENGLISH_FONT_ID)};
    var defaultKhmer = ${JSON.stringify(DEFAULT_WORKSPACE_KHMER_FONT_ID)};
    var englishFonts = ${JSON.stringify(
      Object.fromEntries(
        workspaceEnglishFonts.map((font) => [font.id, font.family]),
      ),
    )};
    var khmerFonts = ${JSON.stringify(
      Object.fromEntries(
        workspaceKhmerFonts.map((font) => [font.id, font.family]),
      ),
    )};

    var storedLanguage = window.localStorage.getItem(languageKey);
    var language = storedLanguage === "km" || storedLanguage === "en"
      ? storedLanguage
      : defaultLanguage;

    var storedEnglishId = window.localStorage.getItem(englishKey);
    var storedKhmerId = window.localStorage.getItem(khmerKey);

    var englishId = storedEnglishId && englishFonts[storedEnglishId]
      ? storedEnglishId
      : defaultEnglish;
    var khmerId = storedKhmerId && khmerFonts[storedKhmerId]
      ? storedKhmerId
      : defaultKhmer;

    var fontId = language === "km" ? khmerId : englishId;

    /*
     * Both faces, in one stack, so mixed Khmer/Latin text renders each
     * script in its own font from the very first paint. The Khmer face goes
     * directly after the real English face and ahead of its metric fallback,
     * which is Arial-based and would otherwise claim the Khmer glyphs. Keep
     * in step with buildWorkspaceFontStack in lib/display/workspace-fonts.ts.
     */
    var englishParts = String(englishFonts[englishId] || "")
      .split(",")
      .map(function (part) { return part.trim(); })
      .filter(Boolean);

    var family = [englishParts[0]]
      .concat([khmerFonts[khmerId]])
      .concat(englishParts.slice(1))
      .concat(["sans-serif"])
      .filter(Boolean)
      .join(", ");
    var root = document.documentElement;

    root.lang = language === "km" ? "km" : "en";
    root.dir = "ltr";
    root.dataset.tenhLanguage = language;
    root.dataset.tenhActiveFontLanguage = language;
    root.style.setProperty("--tenh-workspace-font", family);
    root.style.setProperty("--font-sans", family);
    root.style.setProperty("--default-font-family", family);

    if (language === "km") {
      root.dataset.tenhKhmerFont = fontId;
    } else {
      root.dataset.tenhEnglishFont = fontId;
    }
  } catch (_) {
    // Storage can be unavailable in restricted/private contexts.
  }
})();
`;

export const metadata: Metadata = {
  title: "Tenh Chat",
  description:
    "Receive and reply to Facebook customer messages.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistMono.variable} antialiased`}>
        {/*
          The font bootstrap has to run before first paint, or the workspace
          font arrives after the page has already been drawn in the fallback.
          A raw <script> did that on the server but React never executes one it
          renders on the client, which is what it was warning about. next/script
          with beforeInteractive is the supported way to say the same thing: it
          goes into the initial HTML and runs ahead of any Next.js module.
        */}
        <Script
          id="tenh-workspace-font-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: workspaceFontBootstrap }}
        />
        <WorkspaceFontRuntime />
        {children}
      </body>
    </html>
  );
}
