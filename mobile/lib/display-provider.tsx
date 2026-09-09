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
 */

export type ChatBackgroundId = "default" | "plain" | "warm" | "dim";

export const CHAT_BACKGROUNDS: {
  id: ChatBackgroundId;
  label: string;
  detail: string;
  color: string;
}[] = [
  {
    id: "default",
    label: "TENH",
    detail: "The usual pale blue-grey.",
    color: "#F6F8FC",
  },
  {
    id: "plain",
    label: "Plain",
    detail: "White, for reading in bright sun.",
    color: "#FFFFFF",
  },
  {
    id: "warm",
    label: "Warm",
    detail: "Softer on the eyes over a long shift.",
    color: "#FAF6F0",
  },
  {
    id: "dim",
    label: "Dim",
    detail: "Darker, for working at night.",
    color: "#E4E8EF",
  },
];

const STORAGE_KEY = "display.chat-background";

const DEFAULT: ChatBackgroundId = "default";

export const chatBackgroundColor = (id: ChatBackgroundId) =>
  CHAT_BACKGROUNDS.find((option) => option.id === id)?.color ??
  CHAT_BACKGROUNDS[0].color;

type DisplayState = {
  background: ChatBackgroundId;
  backgroundColor: string;
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
   * a frame or two -- not worth holding the app for, and it is the same
   * colour most people will have chosen anyway.
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
        backgroundColor: chatBackgroundColor(background),
        setBackground,
      }}
    >
      {children}
    </Context.Provider>
  );
}
