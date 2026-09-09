import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { sessionStorage } from "./auth/secure-storage";

/*
 * English or Khmer, for this phone.
 *
 * The web pairs the two strings at the point of use -- <WorkspaceLanguageText
 * en="General" km="ទូទៅ" /> -- rather than keying into a catalogue of ids, and
 * this follows it. A key file drifts: the English changes, the Khmer beside it
 * in another file does not, and nobody notices because both still resolve. Two
 * strings on one line cannot fall out of step, and a missing translation is
 * visible in the diff instead of at runtime.
 *
 * Per-device, like the web's own copy: it lives in that browser's storage, not
 * on the workspace, so one person reading Khmer does not switch everybody.
 */

export type LanguageId = "en" | "km";

export const LANGUAGES: {
  id: LanguageId;
  label: string;
  native: string;
  detail: string;
}[] = [
  {
    id: "en",
    label: "English",
    native: "English",
    detail: "Use English across TENH on this phone.",
  },
  {
    id: "km",
    label: "Khmer",
    native: "ភាសាខ្មែរ",
    detail: "ប្រើភាសាខ្មែរនៅលើទូរស័ព្ទនេះ។",
  },
];

const STORAGE_KEY = "display.language";

export const DEFAULT_LANGUAGE: LanguageId = "en";

type LanguageState = {
  language: LanguageId;
  isKhmer: boolean;
  setLanguage: (id: LanguageId) => Promise<void>;
  /** The English and the Khmer, side by side. */
  t: (en: string, km: string) => string;
};

const Context = createContext<LanguageState | null>(null);

export const useLanguage = () => {
  const value = useContext(Context);

  if (!value) {
    throw new Error("Language provider missing");
  }

  return value;
};

/** The translator alone, for the many places that want nothing else. */
export const useT = () => useLanguage().t;

export function LanguageProvider({ children }: React.PropsWithChildren) {
  const [language, setStored] = useState<LanguageId>(DEFAULT_LANGUAGE);

  useEffect(() => {
    let alive = true;

    void sessionStorage.getItem(STORAGE_KEY).then((saved) => {
      if (alive && (saved === "en" || saved === "km")) {
        setStored(saved);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  const setLanguage = useCallback(async (id: LanguageId) => {
    // Applied first: the point of tapping a language is seeing the screen turn.
    setStored(id);
    await sessionStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo<LanguageState>(
    () => ({
      language,
      isKhmer: language === "km",
      setLanguage,
      t: (en, km) => (language === "km" ? km : en),
    }),
    [language, setLanguage],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
