export const NOTIFICATION_ENABLED_STORAGE_KEY =
  "tenh-chat-browser-notifications-enabled";

export const NOTIFICATION_SOUND_STORAGE_KEY =
  "tenh-chat-notification-sound";

export const NOTIFICATION_VOLUME_STORAGE_KEY =
  "tenh-chat-notification-volume";

export const NOTIFICATION_PREFERENCES_EVENT =
  "tenh-chat-notification-preferences-changed";

export const DEFAULT_NOTIFICATION_VOLUME = 0.7;

/*
 * The sounds that exist in public/alert-sound, and nothing else.
 *
 * This list named six files -- droplet-ping.wav, crystal-bell-chime.wav and
 * the rest -- that are no longer in the folder. Every entry in the picker
 * pointed at a 404, so the whole feature was silent: no preview played and no
 * message ever made a sound, while the settings page still showed six choices
 * as though they worked.
 *
 * The files are numbered, so the labels are too. Inventing names for audio is
 * how the list drifted in the first place -- "Crystal Bell" said nothing about
 * which file it was and survived long after that file was gone. A number
 * cannot go stale, and the play button is what tells you what it sounds like.
 *
 * Adding a sound is one file and one bump of NUMBERED_SOUND_COUNT.
 */
const NUMBERED_SOUND_COUNT = 14;

export const DEFAULT_NOTIFICATION_SOUND_KEY = "default";

export type NotificationSoundKey =
  | "default"
  | "none"
  | `sound-${number}`;

export type NotificationSound = {
  key: NotificationSoundKey;
  label: string;
  src: string | null;
};

export const notificationSounds: NotificationSound[] = [
  {
    key: DEFAULT_NOTIFICATION_SOUND_KEY,
    label: "Default",
    src: "/alert-sound/notification-default.wav",
  },

  ...Array.from(
    { length: NUMBERED_SOUND_COUNT },
    (_, index): NotificationSound => {
      const number = index + 1;

      return {
        key: `sound-${number}`,
        label: `Sound ${number}`,
        src: `/alert-sound/notification-${number}.wav`,
      };
    },
  ),

  {
    key: "none",
    label: "No sound",
    src: null,
  },
];

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
  /*
   * Anything unrecognised falls back to the default rather than to silence.
   * Everyone who chose one of the old names is holding a key that no longer
   * exists, and their inbox should keep making a sound.
   */
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
