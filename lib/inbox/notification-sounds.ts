export const NOTIFICATION_ENABLED_STORAGE_KEY =
  "tenh-chat-browser-notifications-enabled";

export const NOTIFICATION_SOUND_STORAGE_KEY =
  "tenh-chat-notification-sound";

export const NOTIFICATION_VOLUME_STORAGE_KEY =
  "tenh-chat-notification-volume";

export const NOTIFICATION_PREFERENCES_EVENT =
  "tenh-chat-notification-preferences-changed";

export const notificationSounds = [
  {
    key: "droplet-ping",
    label: "Droplet Ping(Default)",
    src: "/alert-sound/droplet-ping.wav",
  },
  {
    key: "crystal-bell",
    label: "Crystal Bell",
    src: "/alert-sound/crystal-bell-chime.wav",
  },
  {
    key: "bubble-pop",
    label: "Bubble Pop",
    src: "/alert-sound/bubble-pop.wav",
  },
  {
    key: "felted-piano",
    label: "Felted Piano",
    src: "/alert-sound/felted-piano.wav",
  },
  {
    key: "rising-square-wave",
    label: "Rising Square Wave",
    src: "/alert-sound/rising-square-wave.wav",
  },
   {
    key: "soft-glass-droplet",
    label: "Glass Droplet",
    src: "/alert-sound/soft-glass-droplet.wav",
  },
  {
    key: "none",
    label: "No sound",
    description: "Keep desktop notifications silent.",
    src: null,
  },
] as const;

export type NotificationSoundKey =
  (typeof notificationSounds)[number]["key"];

export const DEFAULT_NOTIFICATION_SOUND_KEY:
  NotificationSoundKey = "droplet-ping";

export const DEFAULT_NOTIFICATION_VOLUME = 0.7;

export function isNotificationSoundKey(
  value: string | null,
): value is NotificationSoundKey {
  return notificationSounds.some(
    (sound) => sound.key === value,
  );
}

export function getNotificationSound(
  key: NotificationSoundKey,
) {
  return (
    notificationSounds.find(
      (sound) => sound.key === key,
    ) ?? notificationSounds[0]
  );
}

export function clampNotificationVolume(
  value: number,
) {
  if (!Number.isFinite(value)) {
    return DEFAULT_NOTIFICATION_VOLUME;
  }

  return Math.min(1, Math.max(0, value));
}

export function getStoredNotificationSound():
  NotificationSoundKey {
  if (typeof window === "undefined") {
    return DEFAULT_NOTIFICATION_SOUND_KEY;
  }

  const stored =
    window.localStorage.getItem(
      NOTIFICATION_SOUND_STORAGE_KEY,
    );

  return isNotificationSoundKey(stored)
    ? stored
    : DEFAULT_NOTIFICATION_SOUND_KEY;
}

export function getStoredNotificationVolume() {
  if (typeof window === "undefined") {
    return DEFAULT_NOTIFICATION_VOLUME;
  }

  const stored =
    window.localStorage.getItem(
      NOTIFICATION_VOLUME_STORAGE_KEY,
    );

  if (!stored) {
    return DEFAULT_NOTIFICATION_VOLUME;
  }

  return clampNotificationVolume(
    Number(stored),
  );
}
