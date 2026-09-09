import { createAudioPlayer } from "expo-audio";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { sessionStorage } from "./auth/secure-storage";

/*
 * The sound a new customer message makes while you have the app open.
 *
 * The web ships fourteen numbered files; the phone offers six of them. A list
 * that long is a scrolling grid on a laptop and an unusable one on a phone,
 * and nobody auditions fourteen alert tones -- they pick the third one they
 * like. The six are the web's own files by the web's own numbers, so "Sound
 * 3" means the same thing in both places.
 *
 * The files live on the web app, which this phone is already talking to, so
 * there is nothing to bundle and nothing to keep in step with the folder.
 *
 * Per-device, like the web's: it is a property of the phone in your hand, not
 * of the workspace.
 */

const WEB = process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com";

export type SoundId = "default" | "sound-1" | "sound-2" | "sound-3" | "sound-4" | "sound-5";

export const SOUNDS: {
  id: SoundId;
  label: string;
  km: string;
  uri: string;
}[] = [
  {
    id: "default",
    label: "Default",
    km: "លំនាំដើម",
    uri: `${WEB}/alert-sound/notification-default.wav`,
  },
  ...([1, 2, 3, 4, 5] as const).map((number) => ({
    id: `sound-${number}` as SoundId,
    label: `Sound ${number}`,
    km: `សំឡេង ${number}`,
    uri: `${WEB}/alert-sound/notification-${number}.wav`,
  })),
];

const SOUND_KEY = "notifications.sound";
const ENABLED_KEY = "notifications.sound-enabled";

type SoundState = {
  sound: SoundId;
  enabled: boolean;
  setSound: (id: SoundId) => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  /** Play one now: the preview on the settings screen, and the alert itself. */
  play: (id?: SoundId) => void;
};

const Context = createContext<SoundState | null>(null);

export const useNotificationSound = () => {
  const value = useContext(Context);

  if (!value) {
    throw new Error("Notification sound provider missing");
  }

  return value;
};

export function NotificationSoundProvider({ children }: React.PropsWithChildren) {
  const [sound, setStored] = useState<SoundId>("default");
  const [enabled, setStoredEnabled] = useState(true);

  useEffect(() => {
    let alive = true;

    void Promise.all([
      sessionStorage.getItem(SOUND_KEY),
      sessionStorage.getItem(ENABLED_KEY),
    ]).then(([savedSound, savedEnabled]) => {
      if (!alive) return;

      if (savedSound && SOUNDS.some((option) => option.id === savedSound)) {
        setStored(savedSound as SoundId);
      }

      // Only an explicit "off" turns it off; anything else means on.
      if (savedEnabled === "off") {
        setStoredEnabled(false);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  /*
   * One player, replaced rather than recreated. Making a player per alert
   * leaks them on a busy inbox -- each one holds a native decoder until it is
   * collected -- and the sound is short enough that overlapping two of them
   * is noise rather than information.
   */
  const player = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const playing = useRef<SoundId | null>(null);

  useEffect(
    () => () => {
      player.current?.remove();
      player.current = null;
    },
    [],
  );

  const play = useCallback(
    (id?: SoundId) => {
      const wanted = id ?? sound;
      const source = SOUNDS.find((option) => option.id === wanted);

      if (!source) return;

      try {
        if (!player.current) {
          player.current = createAudioPlayer(source.uri);
          playing.current = wanted;
        } else if (playing.current !== wanted) {
          player.current.replace(source.uri);
          playing.current = wanted;
        }

        player.current.seekTo(0);
        player.current.play();
      } catch {
        /*
         * A missing file, a decoder busy elsewhere, no audio focus. None of
         * that is worth an error in front of somebody who was reading their
         * inbox -- the alert is the sound, and its absence is the failure
         * message.
         */
      }
    },
    [sound],
  );

  const setSound = useCallback(async (id: SoundId) => {
    setStored(id);
    await sessionStorage.setItem(SOUND_KEY, id);
  }, []);

  const setEnabled = useCallback(async (on: boolean) => {
    setStoredEnabled(on);
    await sessionStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  }, []);

  return (
    <Context.Provider value={{ sound, enabled, setSound, setEnabled, play }}>
      {children}
    </Context.Provider>
  );
}
