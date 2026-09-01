"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  DEFAULT_NOTIFICATION_SOUND_KEY,
  DEFAULT_NOTIFICATION_VOLUME,
  NOTIFICATION_ENABLED_STORAGE_KEY,
  NOTIFICATION_PREFERENCES_EVENT,
  NOTIFICATION_SOUND_STORAGE_KEY,
  NOTIFICATION_VOLUME_STORAGE_KEY,
  clampNotificationVolume,
  getNotificationSound,
  getStoredNotificationSound,
  getStoredNotificationVolume,
  type NotificationSoundKey,
} from "@/lib/inbox/notification-sounds";

export type BrowserNotificationState =
  | "loading"
  | "unsupported"
  | "default"
  | "denied"
  | "disabled"
  | "enabled";

type NotifyIncomingMessageInput = {
  messageId: string;
  conversationId: string;
  customerName: string;
  body: string;
};

type PlaySoundResult = {
  success: boolean;
  silent?: boolean;
};

export function useBrowserNotifications() {
  const [state, setState] =
    useState<BrowserNotificationState>(
      "loading",
    );

  const [soundKey, setSoundKeyState] =
    useState<NotificationSoundKey>(
      DEFAULT_NOTIFICATION_SOUND_KEY,
    );

  const [volume, setVolumeState] =
    useState(
      DEFAULT_NOTIFICATION_VOLUME,
    );

  const enabledRef = useRef(false);

  const soundKeyRef =
    useRef<NotificationSoundKey>(
      DEFAULT_NOTIFICATION_SOUND_KEY,
    );

  const volumeRef = useRef(
    DEFAULT_NOTIFICATION_VOLUME,
  );

  const activeAudioRef =
    useRef<HTMLAudioElement | null>(null);

  const syncSoundPreferences =
    useCallback(() => {
      const nextSound =
        getStoredNotificationSound();
      const nextVolume =
        getStoredNotificationVolume();

      soundKeyRef.current = nextSound;
      volumeRef.current = nextVolume;

      setSoundKeyState(nextSound);
      setVolumeState(nextVolume);
    }, []);

  useEffect(() => {
    syncSoundPreferences();

    if (
      typeof window === "undefined" ||
      !("Notification" in window)
    ) {
      enabledRef.current = false;
      setState("unsupported");
      return;
    }

    const savedEnabled =
      window.localStorage.getItem(
        NOTIFICATION_ENABLED_STORAGE_KEY,
      ) === "true";

    if (
      Notification.permission ===
      "denied"
    ) {
      enabledRef.current = false;
      setState("denied");
      return;
    }

    if (
      Notification.permission ===
      "granted"
    ) {
      enabledRef.current =
        savedEnabled;

      setState(
        savedEnabled
          ? "enabled"
          : "disabled",
      );

      return;
    }

    enabledRef.current = false;
    setState("default");
  }, [syncSoundPreferences]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    function handlePreferenceChange() {
      syncSoundPreferences();
    }

    window.addEventListener(
      "storage",
      handlePreferenceChange,
    );

    window.addEventListener(
      NOTIFICATION_PREFERENCES_EVENT,
      handlePreferenceChange,
    );

    return () => {
      window.removeEventListener(
        "storage",
        handlePreferenceChange,
      );

      window.removeEventListener(
        NOTIFICATION_PREFERENCES_EVENT,
        handlePreferenceChange,
      );
    };
  }, [syncSoundPreferences]);

  useEffect(() => {
    return () => {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }
    };
  }, []);

  const disableNotifications =
    useCallback(() => {
      enabledRef.current = false;

      if (
        typeof window !==
        "undefined"
      ) {
        window.localStorage.setItem(
          NOTIFICATION_ENABLED_STORAGE_KEY,
          "false",
        );
      }

      if (
        typeof Notification !==
          "undefined" &&
        Notification.permission ===
          "denied"
      ) {
        setState("denied");
        return;
      }

      setState("disabled");
    }, []);

  const enableNotifications =
    useCallback(async () => {
      if (
        typeof window ===
          "undefined" ||
        !("Notification" in window)
      ) {
        enabledRef.current = false;
        setState("unsupported");
        return false;
      }

      let permission =
        Notification.permission;

      if (permission === "default") {
        permission =
          await Notification.requestPermission();
      }

      if (permission !== "granted") {
        enabledRef.current = false;

        window.localStorage.setItem(
          NOTIFICATION_ENABLED_STORAGE_KEY,
          "false",
        );

        setState(
          permission === "denied"
            ? "denied"
            : "default",
        );

        return false;
      }

      enabledRef.current = true;

      window.localStorage.setItem(
        NOTIFICATION_ENABLED_STORAGE_KEY,
        "true",
      );

      setState("enabled");
      return true;
    }, []);

  const toggleNotifications =
    useCallback(async () => {
      if (enabledRef.current) {
        disableNotifications();
        return;
      }

      await enableNotifications();
    }, [
      disableNotifications,
      enableNotifications,
    ]);

  const setNotificationSound =
    useCallback(
      (nextSound: NotificationSoundKey) => {
        soundKeyRef.current = nextSound;
        setSoundKeyState(nextSound);

        if (
          typeof window !==
          "undefined"
        ) {
          window.localStorage.setItem(
            NOTIFICATION_SOUND_STORAGE_KEY,
            nextSound,
          );

          window.dispatchEvent(
            new Event(
              NOTIFICATION_PREFERENCES_EVENT,
            ),
          );
        }
      },
      [],
    );

  const setNotificationVolume =
    useCallback(
      (nextVolume: number) => {
        const safeVolume =
          clampNotificationVolume(
            nextVolume,
          );

        volumeRef.current = safeVolume;
        setVolumeState(safeVolume);

        if (
          typeof window !==
          "undefined"
        ) {
          window.localStorage.setItem(
            NOTIFICATION_VOLUME_STORAGE_KEY,
            String(safeVolume),
          );

          window.dispatchEvent(
            new Event(
              NOTIFICATION_PREFERENCES_EVENT,
            ),
          );
        }
      },
      [],
    );

  const previewSound =
    useCallback(
      async (
        requestedSound:
          NotificationSoundKey =
          soundKeyRef.current,
        requestedVolume: number =
          volumeRef.current,
      ): Promise<PlaySoundResult> => {
        if (
          typeof window ===
          "undefined"
        ) {
          return {
            success: false,
          };
        }

        const sound =
          getNotificationSound(
            requestedSound,
          );

        if (!sound.src) {
          return {
            success: true,
            silent: true,
          };
        }

        try {
          if (activeAudioRef.current) {
            activeAudioRef.current.pause();
          }

          const audio = new Audio(
            sound.src,
          );

          audio.preload = "auto";
          audio.volume =
            clampNotificationVolume(
              requestedVolume,
            );

          activeAudioRef.current =
            audio;

          await audio.play();

          return {
            success: true,
          };
        } catch (error) {
          console.warn(
            "[Tenh Notification] Unable to play alert sound.",
            error,
          );

          return {
            success: false,
          };
        }
      },
      [],
    );

  const notifyIncomingMessage =
    useCallback(
      ({
        messageId,
        conversationId,
        customerName,
        body,
      }: NotifyIncomingMessageInput) => {
        if (
          typeof window ===
            "undefined"
        ) {
          return;
        }

        /*
         * The notification sound is an Inbox alert, not a desktop-only
         * notification. Play it for every newly received customer message
         * even while TENH is focused. Selecting "No sound" still keeps this
         * silent through previewSound().
         */
        void previewSound(
          soundKeyRef.current,
          volumeRef.current,
        );

        /*
         * Native browser notifications stay opt-in and background-only.
         * They require the browser Notification permission, but the Inbox
         * sound above does not.
         */
        if (
          !("Notification" in window) ||
          !enabledRef.current ||
          Notification.permission !==
            "granted"
        ) {
          return;
        }

        const isForeground =
          document.visibilityState ===
            "visible" &&
          document.hasFocus();

        if (isForeground) {
          return;
        }

        const notification =
          new Notification(
            customerName.trim() ||
              "Facebook customer",
            {
              body:
                body.trim() ||
                "New message",
              tag: `tenh-chat-message-${messageId}`,
            },
          );

        notification.onclick = () => {
          notification.close();
          window.focus();

          const query =
            new URLSearchParams();

          query.set(
            "conversation",
            conversationId,
          );

          window.location.assign(
            `/dashboard/inbox?${query.toString()}`,
          );
        };
      },
      [previewSound],
    );

  return {
    state,
    enabled: state === "enabled",
    soundKey,
    volume,
    enableNotifications,
    disableNotifications,
    toggleNotifications,
    setNotificationSound,
    setNotificationVolume,
    previewSound,
    notifyIncomingMessage,
  };
}
