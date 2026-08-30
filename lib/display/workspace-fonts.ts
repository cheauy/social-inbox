import {
  Battambang,
  DM_Sans,
  Hanuman,
  Inter,
  Kantumruy_Pro,
  Koulen,
  Lato,
  Nokora,
  Noto_Sans_Khmer,
  Plus_Jakarta_Sans,
  Poppins,
  Roboto,
} from "next/font/google";

import { readWorkspaceStorage } from "@/lib/display/workspace-storage";

export const WORKSPACE_ENGLISH_FONT_STORAGE_KEY =
  "tenh-display-font-en";
export const WORKSPACE_KHMER_FONT_STORAGE_KEY =
  "tenh-display-font-km";
export const WORKSPACE_FONT_CHANGE_EVENT =
  "tenh:display-font-change";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
});

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  display: "swap",
});

/* Khmer fonts -------------------------------------------------------
 * Load one safe, widely available weight for every family. Browser
 * synthetic bold remains available for headings/buttons while keeping
 * the package small and avoiding unsupported-weight build errors.
 */
const kantumruyPro = Kantumruy_Pro({
  subsets: ["khmer"],
  weight: "400",
  display: "swap",
  preload: false,
});

const notoSansKhmer = Noto_Sans_Khmer({
  subsets: ["khmer"],
  weight: "400",
  display: "swap",
  preload: false,
});

const battambang = Battambang({
  subsets: ["khmer"],
  weight: "400",
  display: "swap",
  preload: false,
});

const hanuman = Hanuman({
  subsets: ["khmer"],
  weight: "400",
  display: "swap",
  preload: false,
});

const nokora = Nokora({
  subsets: ["khmer"],
  weight: "400",
  display: "swap",
  preload: false,
});

const koulen = Koulen({
  subsets: ["khmer"],
  weight: "400",
  display: "swap",
  preload: false,
});

export type WorkspaceEnglishFontId =
  | "inter"
  | "poppins"
  | "plus-jakarta-sans"
  | "dm-sans"
  | "roboto"
  | "lato";

export type WorkspaceKhmerFontId =
  | "kantumruy-pro"
  | "noto-sans-khmer"
  | "battambang"
  | "hanuman"
  | "nokora"
  | "koulen";

export type WorkspaceEnglishFontOption = {
  id: WorkspaceEnglishFontId;
  name: string;
  description: string;
  family: string;
};

export type WorkspaceKhmerFontOption = {
  id: WorkspaceKhmerFontId;
  name: string;
  khmerName: string;
  sample: string;
  description: string;
  family: string;
};

export const workspaceEnglishFonts: WorkspaceEnglishFontOption[] = [
  {
    id: "inter",
    name: "Inter",
    description: "Clean, modern and readable",
    family: inter.style.fontFamily,
  },
  {
    id: "poppins",
    name: "Poppins",
    description: "Friendly, modern and geometric",
    family: poppins.style.fontFamily,
  },
  {
    id: "plus-jakarta-sans",
    name: "Plus Jakarta Sans",
    description: "Neutral, professional and balanced",
    family: plusJakartaSans.style.fontFamily,
  },
  {
    id: "dm-sans",
    name: "DM Sans",
    description: "Simple, readable and versatile",
    family: dmSans.style.fontFamily,
  },
  {
    id: "roboto",
    name: "Roboto",
    description: "Humanist, clean and familiar",
    family: roboto.style.fontFamily,
  },
  {
    id: "lato",
    name: "Lato",
    description: "Warm, approachable and clear",
    family: lato.style.fontFamily,
  },
];

export const workspaceKhmerFonts: WorkspaceKhmerFontOption[] = [
  {
    id: "kantumruy-pro",
    name: "Kantumruy Pro",
    khmerName: "កន្តុមរុយ Pro",
    sample: "សួស្តី",
    description: "Modern, clean and highly readable",
    family: kantumruyPro.style.fontFamily,
  },
  {
    id: "noto-sans-khmer",
    name: "Noto Sans Khmer",
    khmerName: "Noto Sans Khmer",
    sample: "សួស្តី",
    description: "Neutral, clear and versatile",
    family: notoSansKhmer.style.fontFamily,
  },
  {
    id: "battambang",
    name: "Battambang",
    khmerName: "បាត់ដំបង",
    sample: "សួស្តី",
    description: "Friendly body text for everyday use",
    family: battambang.style.fontFamily,
  },
  {
    id: "hanuman",
    name: "Hanuman",
    khmerName: "ហនុមាន",
    sample: "សួស្តី",
    description: "Strong, formal and readable",
    family: hanuman.style.fontFamily,
  },
  {
    id: "nokora",
    name: "Nokora",
    khmerName: "នគរ",
    sample: "សួស្តី",
    description: "Compact, balanced and professional",
    family: nokora.style.fontFamily,
  },
  {
    id: "koulen",
    name: "Koulen",
    khmerName: "គូលែន",
    sample: "សួស្តី",
    description: "Bold display style for strong headings",
    family: koulen.style.fontFamily,
  },
];

export const DEFAULT_WORKSPACE_ENGLISH_FONT_ID: WorkspaceEnglishFontId =
  "inter";
export const DEFAULT_WORKSPACE_KHMER_FONT_ID: WorkspaceKhmerFontId =
  "kantumruy-pro";

export function isWorkspaceEnglishFontId(
  value: string | null,
): value is WorkspaceEnglishFontId {
  return workspaceEnglishFonts.some((font) => font.id === value);
}

export function isWorkspaceKhmerFontId(
  value: string | null,
): value is WorkspaceKhmerFontId {
  return workspaceKhmerFonts.some((font) => font.id === value);
}

export function getWorkspaceEnglishFont(
  id: WorkspaceEnglishFontId,
) {
  return (
    workspaceEnglishFonts.find((font) => font.id === id) ??
    workspaceEnglishFonts[0]
  );
}

export function getWorkspaceKhmerFont(
  id: WorkspaceKhmerFontId,
) {
  return (
    workspaceKhmerFonts.find((font) => font.id === id) ??
    workspaceKhmerFonts[0]
  );
}

export function getStoredWorkspaceEnglishFontId(): WorkspaceEnglishFontId {
  if (typeof window === "undefined") {
    return DEFAULT_WORKSPACE_ENGLISH_FONT_ID;
  }

  const stored = readWorkspaceStorage(
    WORKSPACE_ENGLISH_FONT_STORAGE_KEY,
  );

  return isWorkspaceEnglishFontId(stored)
    ? stored
    : DEFAULT_WORKSPACE_ENGLISH_FONT_ID;
}

export function getStoredWorkspaceKhmerFontId(): WorkspaceKhmerFontId {
  if (typeof window === "undefined") {
    return DEFAULT_WORKSPACE_KHMER_FONT_ID;
  }

  const stored = readWorkspaceStorage(
    WORKSPACE_KHMER_FONT_STORAGE_KEY,
  );

  return isWorkspaceKhmerFontId(stored)
    ? stored
    : DEFAULT_WORKSPACE_KHMER_FONT_ID;
}

function applyWorkspaceFontFamily(
  family: string,
  language: "en" | "km",
) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  root.dataset.tenhActiveFontLanguage = language;
  root.style.setProperty("--tenh-workspace-font", family);
  root.style.setProperty("--font-sans", family);
  root.style.setProperty("--default-font-family", family);

  if (document.body) {
    document.body.style.fontFamily = family;
  }
}

export function applyWorkspaceEnglishFont(
  id: WorkspaceEnglishFontId,
) {
  if (typeof document === "undefined") return;

  const font = getWorkspaceEnglishFont(id);
  document.documentElement.dataset.tenhEnglishFont = id;
  applyWorkspaceFontFamily(font.family, "en");
}

export function applyWorkspaceKhmerFont(
  id: WorkspaceKhmerFontId,
) {
  if (typeof document === "undefined") return;

  const font = getWorkspaceKhmerFont(id);
  document.documentElement.dataset.tenhKhmerFont = id;
  applyWorkspaceFontFamily(font.family, "km");
}
