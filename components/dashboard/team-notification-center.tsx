"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type TeamNotification = {
  id: string;
  notification_type: string;
  title: string;
  body: string | null;
  link: string | null;
  room_id: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

type TeamNotificationsResponse = {
  success?: boolean;
  error?: string;
  memberId?: string;
  businessId?: string;
  notifications?: TeamNotification[];
};

type AnnouncementTone =
  | "info"
  | "update"
  | "maintenance"
  | "important";

type SystemAnnouncement = {
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

type AnnouncementResponse = {
  success?: boolean;
  error?: string;
  announcement?: SystemAnnouncement | null;
};

const announcementLabels: Record<AnnouncementTone, string> = {
  info: "Notice",
  update: "New update",
  maintenance: "Maintenance",
  important: "Important",
};

const announcementClasses: Record<
  AnnouncementTone,
  {
    card: string;
    badge: string;
    dot: string;
  }
> = {
  info: {
    card: "border-blue-200 bg-blue-50/80",
    badge: "bg-blue-100 text-blue-700",
    dot: "bg-blue-500",
  },
  update: {
    card: "border-violet-200 bg-violet-50/80",
    badge: "bg-violet-100 text-violet-700",
    dot: "bg-violet-500",
  },
  maintenance: {
    card: "border-amber-200 bg-amber-50/80",
    badge: "bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
  },
  important: {
    card: "border-red-200 bg-red-50/80",
    badge: "bg-red-100 text-red-700",
    dot: "bg-red-500",
  },
};

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
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

function UpdateIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M12 3v12"
        strokeLinecap="round"
      />
      <path
        d="m7.5 10.5 4.5 4.5 4.5-4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 21h14"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NotificationIcon() {
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
        d="M4 6h16v12H4z"
        strokeLinejoin="round"
      />
      <path
        d="m4 7 8 6 8-6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PaymentApprovedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.2 2.2 4.8-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaymentRejectedIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" strokeLinecap="round" />
      <path d="M12 16.5h.01" strokeLinecap="round" />
    </svg>
  );
}

function notificationVisual(type: string, isRead: boolean) {
  if (type === "manual_payment_approved") {
    return {
      wrapper: isRead
        ? "bg-emerald-50 text-emerald-700"
        : "bg-emerald-600 text-white",
      row: isRead
        ? "hover:bg-slate-50"
        : "bg-emerald-50/80 hover:bg-emerald-50",
      dot: "bg-emerald-600",
      icon: <PaymentApprovedIcon />,
    };
  }

  if (type === "manual_payment_rejected") {
    return {
      wrapper: isRead
        ? "bg-red-50 text-red-700"
        : "bg-red-600 text-white",
      row: isRead
        ? "hover:bg-slate-50"
        : "bg-red-50/80 hover:bg-red-50",
      dot: "bg-red-600",
      icon: <PaymentRejectedIcon />,
    };
  }

  return {
    wrapper: isRead
      ? "bg-slate-100 text-slate-500"
      : "bg-blue-600 text-white",
    row: isRead
      ? "hover:bg-slate-50"
      : "bg-blue-50/70 hover:bg-blue-50",
    dot: "bg-blue-600",
    icon: <NotificationIcon />,
  };
}

function formatWhen(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const now = Date.now();
  const difference = Math.max(0, now - date.getTime());
  const minutes = Math.floor(difference / 60_000);

  if (minutes < 1) {
    return "Now";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function normalizeLink(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://")
  ) {
    return trimmed;
  }

  return null;
}

export function TeamNotificationCenter() {
  const router = useRouter();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<TeamNotification[]>([]);
  const [announcement, setAnnouncement] = useState<SystemAnnouncement | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const loadNotifications = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
    }

    setError(null);

    try {
      const [teamResponse, announcementResponse] = await Promise.all([
        fetch("/api/team-notifications", {
          cache: "no-store",
        }),
        fetch("/api/system-announcements/current", {
          cache: "no-store",
        }),
      ]);

      const [teamResult, announcementResult] = await Promise.all([
        teamResponse.json() as Promise<TeamNotificationsResponse>,
        announcementResponse.json() as Promise<AnnouncementResponse>,
      ]);

      if (!teamResponse.ok || !teamResult.success) {
        throw new Error(
          teamResult.error ?? "Unable to load notifications.",
        );
      }

      setNotifications(teamResult.notifications ?? []);
      setMemberId(teamResult.memberId ?? null);
      setBusinessId(teamResult.businessId ?? null);

      if (announcementResponse.ok && announcementResult.success) {
        setAnnouncement(announcementResult.announcement ?? null);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load notifications.",
      );
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadNotifications();

    const timer = window.setInterval(() => {
      void loadNotifications(true);
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadNotifications]);

  useEffect(() => {
    if (!memberId || !businessId) {
      return;
    }

    const supabase = createClient();
    const channel = supabase
      .channel(`tenh-header-notifications:${memberId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "team_notifications",
          filter: `recipient_member_id=eq.${memberId}`,
        },
        () => {
          void loadNotifications(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [businessId, loadNotifications, memberId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;

      if (
        target &&
        wrapperRef.current &&
        !wrapperRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const unreadTeamCount = useMemo(
    () => notifications.filter((item) => !item.is_read).length,
    [notifications],
  );

  const totalUnread = unreadTeamCount + (announcement ? 1 : 0);
  const badgeLabel = totalUnread > 99 ? "99+" : String(totalUnread);

  async function markRead(notification: TeamNotification) {
    if (notification.is_read) {
      return true;
    }

    setWorkingId(notification.id);

    try {
      const response = await fetch("/api/team-notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "mark_read",
          notificationId: notification.id,
        }),
      });

      if (!response.ok) {
        return false;
      }

      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id
            ? {
                ...item,
                is_read: true,
                read_at: new Date().toISOString(),
              }
            : item,
        ),
      );

      return true;
    } finally {
      setWorkingId(null);
    }
  }

  async function markAllRead() {
    if (unreadTeamCount === 0) {
      return;
    }

    setWorkingId("all");

    try {
      const response = await fetch("/api/team-notifications", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "mark_all_read",
        }),
      });

      if (!response.ok) {
        return;
      }

      const readAt = new Date().toISOString();

      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          is_read: true,
          read_at: item.read_at ?? readAt,
        })),
      );
    } finally {
      setWorkingId(null);
    }
  }

  async function dismissAnnouncement() {
    if (!announcement || workingId) {
      return;
    }

    setWorkingId(`announcement:${announcement.id}`);

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
      setWorkingId(null);
    }
  }

  function navigateTo(href: string | null) {
    const safeHref = normalizeLink(href);

    if (!safeHref) {
      return;
    }

    setOpen(false);

    if (safeHref.startsWith("/")) {
      router.push(safeHref);
      return;
    }

    window.open(safeHref, "_blank", "noopener,noreferrer");
  }

  async function openTeamNotification(notification: TeamNotification) {
    await markRead(notification);
    navigateTo(notification.link);
  }

  const announcementTone = announcement?.tone ?? "update";
  const announcementStyle = announcementClasses[announcementTone];

  return (
    <div
      ref={wrapperRef}
      className="relative"
    >
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);

          if (!open) {
            void loadNotifications(true);
          }
        }}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        aria-label={
          totalUnread > 0
            ? `Notifications, ${totalUnread} unread`
            : "Notifications"
        }
        aria-expanded={open}
      >
        <BellIcon />

        {totalUnread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black leading-none text-white ring-2 ring-white">
            {badgeLabel}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-[calc(100%+10px)] z-[140] w-[390px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_22px_60px_rgba(15,23,42,0.18)]"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5">
            <div>
              <p className="text-sm font-bold text-slate-950">
                Notifications
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                TENH updates and team activity
              </p>
            </div>

            {unreadTeamCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  void markAllRead();
                }}
                disabled={workingId === "all"}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[520px] overflow-y-auto p-2">
            {announcement ? (
              <div
                className={`mb-2 rounded-xl border p-3.5 ${announcementStyle.card}`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-black/5">
                    <UpdateIcon />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${announcementStyle.badge}`}
                      >
                        {announcementLabels[announcementTone]}
                      </span>
                      <span className="text-[10px] font-medium text-slate-400">
                        {formatWhen(announcement.created_at)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        navigateTo(announcement.link_url);
                      }}
                      className="mt-2 block w-full text-left"
                    >
                      <span className="block text-sm font-bold text-slate-950">
                        {announcement.title}
                      </span>
                      <span className="mt-1 block whitespace-pre-wrap text-xs leading-5 text-slate-600">
                        {announcement.message}
                      </span>
                    </button>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      {normalizeLink(announcement.link_url) ? (
                        <button
                          type="button"
                          onClick={() => {
                            navigateTo(announcement.link_url);
                          }}
                          className="text-xs font-bold text-blue-600 hover:text-blue-700"
                        >
                          {announcement.link_label ?? "View update"}
                        </button>
                      ) : (
                        <span />
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          void dismissAnnouncement();
                        }}
                        disabled={
                          workingId ===
                          `announcement:${announcement.id}`
                        }
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {loading && notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-500">
                Loading notifications...
              </div>
            ) : error && notifications.length === 0 && !announcement ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-semibold text-slate-700">
                  Unable to load notifications
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void loadNotifications();
                  }}
                  className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-700"
                >
                  Try again
                </button>
              </div>
            ) : notifications.length === 0 && !announcement ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <BellIcon />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  You&apos;re all caught up
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  New TENH updates and team alerts will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {notifications.map((notification) => {
                  const visual = notificationVisual(
                    notification.notification_type,
                    notification.is_read,
                  );

                  return (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => {
                        void openTeamNotification(notification);
                      }}
                      disabled={workingId === notification.id}
                      className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition disabled:opacity-60 ${visual.row}`}
                    >
                      <span
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${visual.wrapper}`}
                      >
                        {visual.icon}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span
                            className={`min-w-0 flex-1 text-sm ${
                              notification.is_read
                                ? "font-medium text-slate-700"
                                : "font-bold text-slate-950"
                            }`}
                          >
                            {notification.title}
                          </span>

                          <span className="shrink-0 text-[10px] text-slate-400">
                            {formatWhen(notification.created_at)}
                          </span>
                        </span>

                        {notification.body ? (
                          <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-500">
                            {notification.body}
                          </span>
                        ) : null}
                      </span>

                      {!notification.is_read ? (
                        <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${visual.dot}`} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-center text-[10px] text-slate-400">
            Click outside this panel or press Esc to close.
          </div>
        </div>
      ) : null}
    </div>
  );
}
