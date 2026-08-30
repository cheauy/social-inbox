"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live mention alerts + the global group-chat badge count.
 *
 * Mute is handled server-side: /api/team-chat/rooms returns badge_count
 * already adjusted, and mentions are counted separately so a muted room
 * still raises a badge and still plays a sound for a direct @you.
 */

export const MENTION_SOUND_SRC = "/alert-sound/mentions-notification.mp3";

/** Shipped with the app, used if the mp3 above is missing. */
const FALLBACK_SOUND_SRC = "/alert-sound/crystal-bell-chime.wav";

export const GROUP_CHAT_BADGE_EVENT = "tenh:group-chat-badge";

const POLL_INTERVAL_MS = 30_000;

type RoomBadge = {
  id: string;
  name: string;
  badge_count?: number;
  mention_count?: number;
  is_muted?: boolean;
};

type RoomsResponse = {
  success?: boolean;
  rooms?: RoomBadge[];
  totalBadgeCount?: number;
};

function useAlertSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const usedFallbackRef = useRef(false);

  useEffect(() => {
    const audio = new Audio(MENTION_SOUND_SRC);
    audio.preload = "auto";

    // If mentions-notification.mp3 has not been added yet, fall back to a
    // bundled sound instead of failing silently.
    audio.addEventListener("error", () => {
      if (usedFallbackRef.current) {
        return;
      }

      usedFallbackRef.current = true;
      audio.src = FALLBACK_SOUND_SRC;
    });

    audioRef.current = audio;

    return () => {
      audioRef.current = null;
    };
  }, []);

  return useCallback((volume = 0.7) => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.volume = Math.min(Math.max(volume, 0), 1);
    audio.currentTime = 0;

    // Browsers block audio until the user has interacted with the page.
    // A rejected promise here is expected, not an error worth surfacing.
    void audio.play().catch(() => undefined);
  }, []);
}

function showBrowserNotification(title: string, body: string) {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    document.visibilityState === "visible"
  ) {
    return;
  }

  try {
    new Notification(title, { body, tag: "tenh-group-chat" });
  } catch {
    /* Notification constructor is unavailable on some mobile browsers. */
  }
}

export function requestMentionNotificationPermission() {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "default"
  ) {
    return;
  }

  void Notification.requestPermission();
}

/**
 * Polls the rooms endpoint for the badge total and fires an alert when a
 * new mention arrives. Mount once, high in the tree.
 */
export function useGroupChatAlerts() {
  const playSound = useAlertSound();
  const [totalBadgeCount, setTotalBadgeCount] = useState(0);
  const lastMentionTotalRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/team-chat/rooms", {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const result = (await response.json()) as RoomsResponse;

      if (!result.success) {
        return;
      }

      const rooms = result.rooms ?? [];

      const total =
        result.totalBadgeCount ??
        rooms.reduce((sum, room) => sum + (room.badge_count ?? 0), 0);

      setTotalBadgeCount(total);

      window.dispatchEvent(
        new CustomEvent(GROUP_CHAT_BADGE_EVENT, { detail: total }),
      );

      const mentionTotal = rooms.reduce(
        (sum, room) => sum + (room.mention_count ?? 0),
        0,
      );

      const previous = lastMentionTotalRef.current;
      lastMentionTotalRef.current = mentionTotal;

      // Only alert on an increase, and never on the first load — otherwise
      // every page refresh would replay old mentions.
      if (previous !== null && mentionTotal > previous) {
        const room = rooms.find(
          (candidate) => (candidate.mention_count ?? 0) > 0,
        );

        playSound();

        showBrowserNotification(
          "You were mentioned in TENH",
          room ? `New mention in ${room.name}` : "You have a new mention",
        );
      }
    } catch {
      /* Never let a polling failure break the page. */
    }
  }, [playSound]);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  return { totalBadgeCount, refresh, playSound };
}

/** Badge for the Group chat item in the sidebar. */
export function GroupChatBadge() {
  const { totalBadgeCount } = useGroupChatAlerts();

  if (totalBadgeCount <= 0) {
    return null;
  }

  return (
    <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">
      {totalBadgeCount > 99 ? "99+" : totalBadgeCount}
    </span>
  );
}
