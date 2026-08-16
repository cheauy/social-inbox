"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import Link from "next/link";

type AnnouncementTone =
  | "info"
  | "update"
  | "maintenance"
  | "important";

type Announcement = {
  id: string;
  title: string;
  message: string;
  tone: AnnouncementTone;
  link_label: string | null;
  link_url: string | null;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
};

type CurrentAnnouncementResponse = {
  success?: boolean;
  error?: string;
  announcement?: Announcement | null;
};

const toneClasses: Record<
  AnnouncementTone,
  {
    wrapper: string;
    badge: string;
    icon: string;
    link: string;
  }
> = {
  info: {
    wrapper:
      "border-blue-200 bg-blue-50 text-blue-950",
    badge:
      "bg-blue-100 text-blue-700",
    icon:
      "bg-blue-600 text-white",
    link:
      "border-blue-200 bg-white text-blue-700 hover:bg-blue-100",
  },
  update: {
    wrapper:
      "border-violet-200 bg-violet-50 text-violet-950",
    badge:
      "bg-violet-100 text-violet-700",
    icon:
      "bg-violet-600 text-white",
    link:
      "border-violet-200 bg-white text-violet-700 hover:bg-violet-100",
  },
  maintenance: {
    wrapper:
      "border-amber-200 bg-amber-50 text-amber-950",
    badge:
      "bg-amber-100 text-amber-700",
    icon:
      "bg-amber-500 text-white",
    link:
      "border-amber-200 bg-white text-amber-800 hover:bg-amber-100",
  },
  important: {
    wrapper:
      "border-red-200 bg-red-50 text-red-950",
    badge:
      "bg-red-100 text-red-700",
    icon:
      "bg-red-600 text-white",
    link:
      "border-red-200 bg-white text-red-700 hover:bg-red-100",
  },
};

const toneLabels: Record<AnnouncementTone, string> = {
  info: "Notice",
  update: "New update",
  maintenance: "Maintenance",
  important: "Important",
};

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 21h4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function isInternalLink(value: string) {
  return value.startsWith("/");
}

export function SystemAnnouncementBanner() {
  const [announcement, setAnnouncement] =
    useState<Announcement | null>(null);
  const [dismissing, setDismissing] =
    useState(false);

  const loadAnnouncement = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/system-announcements/current",
        {
          cache: "no-store",
        },
      );

      const result =
        (await response.json()) as CurrentAnnouncementResponse;

      if (!response.ok || !result.success) {
        return;
      }

      setAnnouncement(result.announcement ?? null);
    } catch {
      // Update alerts are non-blocking. Never break the dashboard if the alert API is unavailable.
    }
  }, []);

  useEffect(() => {
    void loadAnnouncement();

    const timer = window.setInterval(() => {
      void loadAnnouncement();
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadAnnouncement]);

  useEffect(() => {
    if (!announcement || typeof window === "undefined") {
      return;
    }

    const notifiedKey =
      `tenh-system-announcement-notified:${announcement.id}`;

    if (window.localStorage.getItem(notifiedKey) === "true") {
      return;
    }

    window.localStorage.setItem(notifiedKey, "true");

    const browserNotificationsEnabled =
      window.localStorage.getItem(
        "tenh-chat-browser-notifications-enabled",
      ) === "true";

    if (
      browserNotificationsEnabled &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      try {
        const notification = new Notification(
          announcement.title,
          {
            body: announcement.message,
            tag: `tenh-system-announcement-${announcement.id}`,
          },
        );

        notification.onclick = () => {
          notification.close();
          window.focus();

          if (announcement.link_url) {
            window.location.assign(announcement.link_url);
          }
        };
      } catch {
        // The visible dashboard banner remains the fallback.
      }
    }
  }, [announcement]);

  const tone = announcement?.tone ?? "update";
  const classes = toneClasses[tone];

  const createdLabel = useMemo(() => {
    if (!announcement) {
      return null;
    }

    const date = new Date(announcement.created_at);

    if (!Number.isFinite(date.getTime())) {
      return null;
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(date);
  }, [announcement]);

  async function dismiss() {
    if (!announcement || dismissing) {
      return;
    }

    setDismissing(true);

    try {
      const response = await fetch(
        "/api/system-announcements/current",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "dismiss",
            announcementId: announcement.id,
          }),
        },
      );

      if (response.ok) {
        setAnnouncement(null);
      }
    } finally {
      setDismissing(false);
    }
  }

  if (!announcement) {
    return null;
  }

  return (
    <div
      className={`shrink-0 border-b ${classes.wrapper}`}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex w-full max-w-[1600px] items-start gap-3 px-4 py-3 sm:items-center sm:px-6">
        <div
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:mt-0 ${classes.icon}`}
        >
          <BellIcon />
        </div>

        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${classes.badge}`}
            >
              {toneLabels[tone]}
            </span>

            <p className="text-sm font-bold">
              {announcement.title}
            </p>

            {createdLabel ? (
              <span className="text-xs opacity-50">
                {createdLabel}
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-sm leading-5 opacity-75 sm:mt-0 sm:truncate">
            {announcement.message}
          </p>
        </div>

        {announcement.link_url ? (
          isInternalLink(announcement.link_url) ? (
            <Link
              href={announcement.link_url}
              className={`hidden shrink-0 rounded-xl border px-3 py-2 text-xs font-bold transition sm:inline-flex ${classes.link}`}
            >
              {announcement.link_label ?? "Learn more"}
            </Link>
          ) : (
            <a
              href={announcement.link_url}
              target="_blank"
              rel="noreferrer"
              className={`hidden shrink-0 rounded-xl border px-3 py-2 text-xs font-bold transition sm:inline-flex ${classes.link}`}
            >
              {announcement.link_label ?? "Learn more"}
            </a>
          )
        ) : null}

        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={dismissing}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg leading-none opacity-50 transition hover:bg-black/5 hover:opacity-90 disabled:opacity-30"
          aria-label="Dismiss update alert"
          title="Dismiss"
        >
          ×
        </button>
      </div>

      {announcement.link_url ? (
        <div className="px-4 pb-3 sm:hidden">
          {isInternalLink(announcement.link_url) ? (
            <Link
              href={announcement.link_url}
              className={`inline-flex rounded-xl border px-3 py-2 text-xs font-bold ${classes.link}`}
            >
              {announcement.link_label ?? "Learn more"}
            </Link>
          ) : (
            <a
              href={announcement.link_url}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex rounded-xl border px-3 py-2 text-xs font-bold ${classes.link}`}
            >
              {announcement.link_label ?? "Learn more"}
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
