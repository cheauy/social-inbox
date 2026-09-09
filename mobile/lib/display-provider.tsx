import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { sessionStorage } from "./auth/secure-storage";

/*
 * Per-device display preferences.
 *
 * The web keeps these in the browser's own storage rather than on the
 * workspace, so one person's dark chat does not darken everybody's. The phone
 * does the same, in the store it already uses for the session.
 *
 * The backgrounds are the web's own five, by the same ids, served from the
 * same files. They were four invented colours before, which meant the two
 * apps could not agree on what "the warm one" was -- somebody who set a
 * background on their laptop opened the phone and found something else.
 */

export type ChatBackgroundId =
  | "theme-1"
  | "theme-2"
  | "theme-3"
  | "theme-4"
  | "theme-5";

const WEB = process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com";

export const CHAT_BACKGROUNDS: {
  id: ChatBackgroundId;
  label: string;
  km: string;
  uri: string;
}[] = [1, 2, 3, 4, 5].map((number) => ({
  id: `theme-${number}` as ChatBackgroundId,
  label: `Theme ${number}`,
  km: `ផ្ទៃខាងក្រោយ ${number}`,
  uri: `${WEB}/images/bg-theme${number}.png`,
}));

/*
 * Behind whatever the wallpaper is, and what shows while it loads. The
 * bubbles have to stay readable on the first frame of a cold thread, so this
 * is the pale ground the app used before wallpapers existed.
 */
export const CHAT_BASE_COLOR = "#F6F8FC";

const STORAGE_KEY = "display.chat-background";

const DEFAULT: ChatBackgroundId = "theme-1";

export const chatBackground = (id: ChatBackgroundId) =>
  CHAT_BACKGROUNDS.find((option) => option.id === id) ?? CHAT_BACKGROUNDS[0];

type DisplayState = {
  background: ChatBackgroundId;
  backgroundUri: string;
  setBackground: (id: ChatBackgroundId) => Promise<void>;
};

const Context = createContext<DisplayState | null>(null);

export const useDisplay = () => {
  const value = useContext(Context);

  if (!value) {
    throw new Error("Display provider missing");
  }

  return value;
};

export function DisplayProvider({ children }: React.PropsWithChildren) {
  const [background, setStored] = useState<ChatBackgroundId>(DEFAULT);

  /*
   * Read once at start. The default is what shows until it arrives, which is
   * a frame or two -- not worth holding the app for.
   */
  useEffect(() => {
    let alive = true;

    void sessionStorage.getItem(STORAGE_KEY).then((saved) => {
      if (
        alive &&
        saved &&
        CHAT_BACKGROUNDS.some((option) => option.id === saved)
      ) {
        setStored(saved as ChatBackgroundId);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  const setBackground = useCallback(async (id: ChatBackgroundId) => {
    // Applied first: the point of tapping a swatch is seeing it.
    setStored(id);
    await sessionStorage.setItem(STORAGE_KEY, id);
  }, []);

  return (
    <Context.Provider
      value={{
        background,
        backgroundUri: chatBackground(background).uri,
        setBackground,
      }}
    >
      {children}
    </Context.Provider>
  );
}
