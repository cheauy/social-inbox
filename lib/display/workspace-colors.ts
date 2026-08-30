import { readWorkspaceStorage } from "@/lib/display/workspace-storage";

export const WORKSPACE_COLOR_STORAGE_KEY =
  "tenh-display-workspace-colors-v1";
export const WORKSPACE_COLOR_CHANGE_EVENT =
  "tenh:display-colors-change";

export type WorkspaceColorValues = {
  primary: string;
  primaryLight: string;
  accent: string;
  success: string;
  warning: string;
  error: string;
  neutral: string;
};

export type WorkspaceColorPresetId =
  | "tenh-blue"
  | "ocean-blue"
  | "forest-green"
  | "sunset-orange"
  | "rose-pink"
  | "slate-gray"
  | "royal-indigo"
  | "custom";

export type WorkspaceColorPreset = {
  id: WorkspaceColorPresetId;
  name: string;
  colors: WorkspaceColorValues;
};

export type WorkspaceColorSettings = {
  presetId: WorkspaceColorPresetId;
  colors: WorkspaceColorValues;
};

export const workspaceColorPresets: WorkspaceColorPreset[] = [
  {
    id: "tenh-blue",
    name: "TENH Blue",
    colors: {
      primary: "#2563EB",
      primaryLight: "#DBEAFE",
      accent: "#0EA5E9",
      success: "#16A34A",
      warning: "#F97316",
      error: "#EF4444",
      neutral: "#CBD5E1",
    },
  },
  {
    id: "ocean-blue",
    name: "Ocean Blue",
    colors: {
      primary: "#0284C7",
      primaryLight: "#E0F2FE",
      accent: "#06B6D4",
      success: "#10B981",
      warning: "#F59E0B",
      error: "#EF4444",
      neutral: "#CBD5E1",
    },
  },
  {
    id: "forest-green",
    name: "Forest Green",
    colors: {
      primary: "#16A34A",
      primaryLight: "#DCFCE7",
      accent: "#059669",
      success: "#22C55E",
      warning: "#F59E0B",
      error: "#DC2626",
      neutral: "#CBD5E1",
    },
  },
  {
    id: "sunset-orange",
    name: "Sunset Orange",
    colors: {
      primary: "#F97316",
      primaryLight: "#FFEDD5",
      accent: "#EA580C",
      success: "#16A34A",
      warning: "#F59E0B",
      error: "#DC2626",
      neutral: "#D6D3D1",
    },
  },
  {
    id: "rose-pink",
    name: "Rose Pink",
    colors: {
      primary: "#E11D48",
      primaryLight: "#FFE4E6",
      accent: "#DB2777",
      success: "#16A34A",
      warning: "#F97316",
      error: "#DC2626",
      neutral: "#D6D3D1",
    },
  },
  {
    id: "slate-gray",
    name: "Slate Gray",
    colors: {
      primary: "#475569",
      primaryLight: "#E2E8F0",
      accent: "#64748B",
      success: "#16A34A",
      warning: "#F59E0B",
      error: "#EF4444",
      neutral: "#CBD5E1",
    },
  },
  {
    id: "royal-indigo",
    name: "Royal Indigo",
    colors: {
      primary: "#4F46E5",
      primaryLight: "#E0E7FF",
      accent: "#7C3AED",
      success: "#16A34A",
      warning: "#F97316",
      error: "#EF4444",
      neutral: "#CBD5E1",
    },
  },
];

export const DEFAULT_WORKSPACE_COLOR_PRESET_ID: WorkspaceColorPresetId =
  "tenh-blue";

export const DEFAULT_WORKSPACE_COLORS: WorkspaceColorValues =
  workspaceColorPresets[0].colors;

export function isValidHexColor(value: string): boolean {
  return /^#[0-9A-F]{6}$/i.test(value.trim());
}

export function normalizeHexColor(
  value: string,
  fallback: string,
): string {
  const normalized = value.trim().toUpperCase();
  return isValidHexColor(normalized) ? normalized : fallback;
}

export function isWorkspaceColorPresetId(
  value: string | null,
): value is WorkspaceColorPresetId {
  return (
    value === "custom" ||
    workspaceColorPresets.some((preset) => preset.id === value)
  );
}

export function getWorkspaceColorPreset(
  id: WorkspaceColorPresetId,
): WorkspaceColorPreset | null {
  if (id === "custom") return null;
  return workspaceColorPresets.find((preset) => preset.id === id) ?? null;
}

function sanitizeColorValues(
  value: Partial<WorkspaceColorValues> | null | undefined,
): WorkspaceColorValues {
  return {
    primary: normalizeHexColor(
      value?.primary ?? "",
      DEFAULT_WORKSPACE_COLORS.primary,
    ),
    primaryLight: normalizeHexColor(
      value?.primaryLight ?? "",
      DEFAULT_WORKSPACE_COLORS.primaryLight,
    ),
    accent: normalizeHexColor(
      value?.accent ?? "",
      DEFAULT_WORKSPACE_COLORS.accent,
    ),
    success: normalizeHexColor(
      value?.success ?? "",
      DEFAULT_WORKSPACE_COLORS.success,
    ),
    warning: normalizeHexColor(
      value?.warning ?? "",
      DEFAULT_WORKSPACE_COLORS.warning,
    ),
    error: normalizeHexColor(
      value?.error ?? "",
      DEFAULT_WORKSPACE_COLORS.error,
    ),
    neutral: normalizeHexColor(
      value?.neutral ?? "",
      DEFAULT_WORKSPACE_COLORS.neutral,
    ),
  };
}

export function getStoredWorkspaceColorSettings(): WorkspaceColorSettings {
  if (typeof window === "undefined") {
    return {
      presetId: DEFAULT_WORKSPACE_COLOR_PRESET_ID,
      colors: { ...DEFAULT_WORKSPACE_COLORS },
    };
  }

  try {
    const raw = readWorkspaceStorage(WORKSPACE_COLOR_STORAGE_KEY);
    if (!raw) {
      return {
        presetId: DEFAULT_WORKSPACE_COLOR_PRESET_ID,
        colors: { ...DEFAULT_WORKSPACE_COLORS },
      };
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceColorSettings>;
    const presetId = isWorkspaceColorPresetId(parsed.presetId ?? null)
      ? parsed.presetId!
      : DEFAULT_WORKSPACE_COLOR_PRESET_ID;

    return {
      presetId,
      colors: sanitizeColorValues(parsed.colors),
    };
  } catch {
    return {
      presetId: DEFAULT_WORKSPACE_COLOR_PRESET_ID,
      colors: { ...DEFAULT_WORKSPACE_COLORS },
    };
  }
}

export function serializeWorkspaceColorSettings(
  settings: WorkspaceColorSettings,
): string {
  return JSON.stringify({
    presetId: settings.presetId,
    colors: sanitizeColorValues(settings.colors),
  });
}

function darkenHex(hex: string, amount = 0.12): string {
  const normalized = normalizeHexColor(hex, "#2563EB").slice(1);
  const channels = [0, 2, 4].map((index) =>
    Number.parseInt(normalized.slice(index, index + 2), 16),
  );
  const next = channels.map((channel) =>
    Math.max(0, Math.round(channel * (1 - amount))),
  );
  return `#${next
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

const WORKSPACE_COLOR_STYLE_ID = "tenh-workspace-color-overrides";

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex, "#2563EB").slice(1);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

function mixHex(
  foreground: string,
  background: string,
  foregroundWeight: number,
): string {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  const weight = Math.max(0, Math.min(1, foregroundWeight));

  return rgbToHex([
    fg[0] * weight + bg[0] * (1 - weight),
    fg[1] * weight + bg[1] * (1 - weight),
    fg[2] * weight + bg[2] * (1 - weight),
  ]);
}

function buildWorkspaceColorCss(colors: WorkspaceColorValues): string {
  const primary = colors.primary;
  const primaryHover = darkenHex(primary);
  const primaryLight = colors.primaryLight;
  const primarySoft = mixHex(primary, primaryLight, 0.18);
  const primaryBorder = mixHex(primary, "#FFFFFF", 0.38);
  const primaryRing = mixHex(primary, "#FFFFFF", 0.28);

  const accent = colors.accent;
  const accentLight = mixHex(accent, "#FFFFFF", 0.12);

  const success = colors.success;
  const successLight = mixHex(success, "#FFFFFF", 0.10);
  const successBorder = mixHex(success, "#FFFFFF", 0.34);

  const warning = colors.warning;
  const warningLight = mixHex(warning, "#FFFFFF", 0.10);
  const warningBorder = mixHex(warning, "#FFFFFF", 0.34);

  const error = colors.error;
  const errorLight = mixHex(error, "#FFFFFF", 0.09);
  const errorBorder = mixHex(error, "#FFFFFF", 0.34);

  const scope = 'html[data-tenh-color-preset]';

  return `
/* TENH workspace colors — generated at runtime.
   This style is appended to <head> after Tailwind so saved colors win safely. */

${scope} [class~="bg-blue-400"],
${scope} [class~="bg-blue-500"],
${scope} [class~="bg-blue-600"],
${scope} [class~="bg-blue-700"],
${scope} [class~="bg-[#0866FF]"],
${scope} [class~="bg-[#1463FF]"],
${scope} [class~="bg-[#2563EB]"],
${scope} [class~="bg-[#0A4DFF]"],
${scope} [class~="bg-[#2EA8FF]"] {
  background-color: ${primary} !important;
}

${scope} [class~="bg-blue-300"] {
  background-color: ${primarySoft} !important;
}

${scope} [class~="bg-blue-50"],
${scope} [class~="bg-blue-50/25"],
${scope} [class~="bg-blue-50/40"],
${scope} [class~="bg-blue-50/50"],
${scope} [class~="bg-blue-50/60"],
${scope} [class~="bg-blue-50/70"],
${scope} [class~="bg-blue-50/80"],
${scope} [class~="bg-blue-50/90"],
${scope} [class~="bg-blue-100"],
${scope} [class~="bg-blue-100/50"],
${scope} [class~="bg-blue-100/70"],
${scope} [class~="bg-blue-100/80"] {
  background-color: ${primaryLight} !important;
}

${scope} [class~="bg-blue-200"],
${scope} [class~="bg-blue-200/50"],
${scope} [class~="bg-blue-200/70"],
${scope} [class~="bg-blue-300/70"] {
  background-color: ${primarySoft} !important;
}

${scope} [class~="hover:bg-blue-50"]:hover,
${scope} [class~="hover:bg-blue-100"]:hover,
${scope} [class~="hover:bg-blue-200"]:hover,
${scope} [class~="hover:bg-slate-50"]:hover,
${scope} [class~="hover:bg-slate-50/30"]:hover,
${scope} [class~="hover:bg-slate-50/40"]:hover,
${scope} [class~="hover:bg-slate-50/50"]:hover,
${scope} [class~="hover:bg-slate-50/60"]:hover,
${scope} [class~="hover:bg-slate-50/70"]:hover,
${scope} [class~="hover:bg-slate-100"]:hover,
${scope} [class~="hover:bg-slate-100/50"]:hover {
  background-color: ${primaryLight} !important;
}

${scope} [class~="hover:bg-blue-500"]:hover,
${scope} [class~="hover:bg-blue-600"]:hover,
${scope} [class~="hover:bg-blue-700"]:hover,
${scope} [class~="active:bg-blue-600"]:active,
${scope} [class~="active:bg-blue-700"]:active {
  background-color: ${primaryHover} !important;
}

${scope} [class~="text-blue-400"],
${scope} [class~="text-blue-500"],
${scope} [class~="text-blue-600"],
${scope} [class~="text-blue-700"],
${scope} [class~="text-blue-800"],
${scope} [class~="text-blue-900"],
${scope} [class~="text-[#0866FF]"],
${scope} [class~="text-[#1463FF]"],
${scope} [class~="text-[#2563EB]"],
${scope} [class~="text-[#0A4DFF]"],
${scope} [class~="text-[#2EA8FF]"] {
  color: ${primary} !important;
}

${scope} [class~="hover:text-blue-500"]:hover,
${scope} [class~="hover:text-blue-600"]:hover,
${scope} [class~="hover:text-blue-700"]:hover,
${scope} [class~="hover:text-blue-800"]:hover,
${scope} [class~="focus:text-blue-600"]:focus,
${scope} [class~="focus:text-blue-700"]:focus {
  color: ${primary} !important;
}

${scope} [class~="border-blue-50"],
${scope} [class~="border-blue-100"],
${scope} [class~="border-blue-200"],
${scope} [class~="border-blue-300"],
${scope} [class~="border-blue-400"],
${scope} [class~="border-blue-500"],
${scope} [class~="border-blue-600"],
${scope} [class~="border-blue-700"],
${scope} [class~="border-[#0866FF]"],
${scope} [class~="border-[#1463FF]"],
${scope} [class~="border-[#2563EB]"] {
  border-color: ${primaryBorder} !important;
}

${scope} [class~="hover:border-blue-200"]:hover,
${scope} [class~="hover:border-blue-300"]:hover,
${scope} [class~="hover:border-blue-400"]:hover,
${scope} [class~="hover:border-blue-500"]:hover,
${scope} [class~="focus:border-blue-300"]:focus,
${scope} [class~="focus:border-blue-400"]:focus,
${scope} [class~="focus:border-blue-500"]:focus,
${scope} [class~="focus:border-blue-600"]:focus {
  border-color: ${primary} !important;
}

${scope} [class~="ring-blue-100"],
${scope} [class~="ring-blue-200"],
${scope} [class~="ring-blue-300"],
${scope} [class~="ring-blue-400"],
${scope} [class~="ring-blue-500"],
${scope} [class~="focus:ring-blue-100"]:focus,
${scope} [class~="focus:ring-blue-200"]:focus,
${scope} [class~="focus:ring-blue-300"]:focus,
${scope} [class~="focus:ring-blue-400"]:focus,
${scope} [class~="focus:ring-blue-500"]:focus {
  --tw-ring-color: ${primaryRing} !important;
}

${scope} [class~="outline-blue-400"],
${scope} [class~="outline-blue-500"],
${scope} [class~="focus:outline-blue-400"]:focus,
${scope} [class~="focus:outline-blue-500"]:focus {
  outline-color: ${primary} !important;
}

/* Accent: violet / indigo / sky / cyan UI accents also follow the saved palette. */
${scope} [class~="text-violet-500"],
${scope} [class~="text-violet-600"],
${scope} [class~="text-violet-700"],
${scope} [class~="text-violet-800"],
${scope} [class~="text-indigo-500"],
${scope} [class~="text-indigo-600"],
${scope} [class~="text-indigo-700"],
${scope} [class~="text-sky-500"],
${scope} [class~="text-sky-600"],
${scope} [class~="text-cyan-500"],
${scope} [class~="text-cyan-600"] {
  color: ${accent} !important;
}

${scope} [class~="bg-violet-500"],
${scope} [class~="bg-violet-600"],
${scope} [class~="bg-indigo-500"],
${scope} [class~="bg-indigo-600"],
${scope} [class~="bg-sky-500"],
${scope} [class~="bg-sky-600"],
${scope} [class~="bg-cyan-500"],
${scope} [class~="bg-cyan-600"] {
  background-color: ${accent} !important;
}

${scope} [class~="bg-violet-50"],
${scope} [class~="bg-violet-100"],
${scope} [class~="bg-indigo-50"],
${scope} [class~="bg-indigo-100"],
${scope} [class~="bg-sky-50"],
${scope} [class~="bg-cyan-50"] {
  background-color: ${accentLight} !important;
}

${scope} [class~="border-violet-100"],
${scope} [class~="border-violet-200"],
${scope} [class~="border-indigo-100"],
${scope} [class~="border-indigo-200"] {
  border-color: ${mixHex(accent, "#FFFFFF", 0.34)} !important;
}

/* Success */
${scope} [class~="text-emerald-500"],
${scope} [class~="text-emerald-600"],
${scope} [class~="text-emerald-700"],
${scope} [class~="text-green-500"],
${scope} [class~="text-green-600"],
${scope} [class~="text-green-700"] { color: ${success} !important; }
${scope} [class~="bg-emerald-500"],
${scope} [class~="bg-emerald-600"],
${scope} [class~="bg-green-500"],
${scope} [class~="bg-green-600"] { background-color: ${success} !important; }
${scope} [class~="bg-emerald-50"],
${scope} [class~="bg-emerald-100"],
${scope} [class~="bg-green-50"],
${scope} [class~="bg-green-100"] { background-color: ${successLight} !important; }
${scope} [class~="border-emerald-100"],
${scope} [class~="border-emerald-200"],
${scope} [class~="border-green-100"],
${scope} [class~="border-green-200"] { border-color: ${successBorder} !important; }

/* Warning */
${scope} [class~="text-amber-500"],
${scope} [class~="text-amber-600"],
${scope} [class~="text-amber-700"],
${scope} [class~="text-orange-500"],
${scope} [class~="text-orange-600"],
${scope} [class~="text-orange-700"] { color: ${warning} !important; }
${scope} [class~="bg-amber-500"],
${scope} [class~="bg-amber-600"],
${scope} [class~="bg-orange-500"],
${scope} [class~="bg-orange-600"] { background-color: ${warning} !important; }
${scope} [class~="bg-amber-50"],
${scope} [class~="bg-amber-100"],
${scope} [class~="bg-orange-50"],
${scope} [class~="bg-orange-100"] { background-color: ${warningLight} !important; }
${scope} [class~="border-amber-100"],
${scope} [class~="border-amber-200"],
${scope} [class~="border-orange-100"],
${scope} [class~="border-orange-200"] { border-color: ${warningBorder} !important; }

/* Error */
${scope} [class~="text-red-500"],
${scope} [class~="text-red-600"],
${scope} [class~="text-red-700"] { color: ${error} !important; }
${scope} [class~="bg-red-500"],
${scope} [class~="bg-red-600"],
${scope} [class~="bg-red-700"] { background-color: ${error} !important; }
${scope} [class~="bg-red-50"],
${scope} [class~="bg-red-100"] { background-color: ${errorLight} !important; }
${scope} [class~="border-red-100"],
${scope} [class~="border-red-200"],
${scope} [class~="border-red-300"] { border-color: ${errorBorder} !important; }

/* Saved neutral role for common light borders. */
${scope}[data-tenh-workspace-theme="light"] [class~="border-slate-100"],
${scope}[data-tenh-workspace-theme="light"] [class~="border-slate-200"],
${scope}[data-tenh-workspace-theme="light"] [class~="border-slate-200/90"],
${scope}[data-tenh-workspace-theme="light"] [class~="border-slate-300"] {
  border-color: ${colors.neutral} !important;
}

${scope} ::selection {
  background: ${primaryLight};
  color: #0F172A;
}
`;
}

function installWorkspaceColorOverrides(colors: WorkspaceColorValues) {
  if (typeof document === "undefined") return;

  let style = document.getElementById(
    WORKSPACE_COLOR_STYLE_ID,
  ) as HTMLStyleElement | null;

  if (!style) {
    style = document.createElement("style");
    style.id = WORKSPACE_COLOR_STYLE_ID;
    style.dataset.tenhWorkspaceColors = "true";
    document.head.appendChild(style);
  }

  style.textContent = buildWorkspaceColorCss(colors);
}

export function applyWorkspaceColors(
  colors: WorkspaceColorValues,
  presetId: WorkspaceColorPresetId = "custom",
) {
  if (typeof document === "undefined") return;

  const safe = sanitizeColorValues(colors);
  const root = document.documentElement;

  root.dataset.tenhColorPreset = presetId;
  root.style.setProperty("--tenh-primary", safe.primary);
  root.style.setProperty(
    "--tenh-primary-hover",
    darkenHex(safe.primary),
  );
  root.style.setProperty("--tenh-primary-light", safe.primaryLight);
  root.style.setProperty("--tenh-accent", safe.accent);
  root.style.setProperty("--tenh-success", safe.success);
  root.style.setProperty("--tenh-warning", safe.warning);
  root.style.setProperty("--tenh-error", safe.error);
  root.style.setProperty("--tenh-neutral", safe.neutral);

  /* Important: inject resolved CSS after Tailwind/stylesheets.
   * This makes Save changes take effect immediately even if a component
   * uses hard-coded Tailwind blue/violet/green/orange/red utilities.
   */
  installWorkspaceColorOverrides(safe);
}
