"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

type NotificationRecord = {
  id: string;
  notification_type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
  actor:
    | {
        id: string;
        full_name: string;
        profile_picture_url: string | null;
      }
    | Array<{
        id: string;
        full_name: string;
        profile_picture_url: string | null;
      }>
    | null;
};

type NotificationsResponse = {
  success?: boolean;
  notifications?: NotificationRecord[];
  unreadCount?: number;
  currentMemberId?: string;
  businessId?: string;
};

function formatRelativeTime(value: string) {
  const time = new Date(value).getTime();
  const seconds = Math.max(
    0,
    Math.round((Date.now() - time) / 1000),
  );

  if (seconds < 60) return "Now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

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
        d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
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

export function TeamNotificationCenter() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] =
    useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentMemberId, setCurrentMemberId] =
    useState<string | null>(null);
  const [businessId, setBusinessId] =
    useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadNotifications = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/team-notifications?limit=20",
        { cache: "no-store" },
      );

      const result =
        (await response.json()) as NotificationsResponse;

      if (!response.ok || !result.success) {
        return;
      }

      if (!mountedRef.current) {
        return;
      }

      setNotifications(result.notifications ?? []);
      setUnreadCount(result.unreadCount ?? 0);
      setCurrentMemberId(result.currentMemberId ?? null);
      setBusinessId(result.businessId ?? null);
    } catch {
      // Notification UI should never break the dashboard header.
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadNotifications();

    return () => {
      mountedRef.current = false;
    };
  }, [loadNotifications]);

  useEffect(() => {
    if (!currentMemberId || !businessId) {
      return;
    }

    const supabase = createClient();
    let cancelled = false;
    let channel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function startRealtime() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session || cancelled) {
        return;
      }

      await supabase.realtime.setAuth(
        session.access_token,
      );

      if (cancelled) {
        return;
      }

      channel = supabase
        .channel(
          `tenh-team-notifications-${currentMemberId}`,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_notifications",
            filter: `recipient_member_id=eq.${currentMemberId}`,
          },
          () => {
            void loadNotifications();
          },
        )
        .subscribe();
    }

    void startRealtime();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [businessId, currentMemberId, loadNotifications]);

  async function markRead(notificationId: string) {
    await fetch("/api/team-notifications", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notificationId }),
    });

    setNotifications((current) =>
      current.map((notification) =>
        notification.id === notificationId
          ? { ...notification, is_read: true }
          : notification,
      ),
    );
    setUnreadCount((current) =>
      Math.max(0, current - 1),
    );
  }

  async function markAllRead() {
    await fetch("/api/team-notifications", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ markAllRead: true }),
    });

    setNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        is_read: true,
      })),
    );
    setUnreadCount(0);
  }

  return (
    <div className="relative mr-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
        aria-label="Team notifications"
        title="Team notifications"
      >
        <BellIcon />

        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-[100] w-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <p className="font-semibold text-slate-900">
                Team notifications
              </p>
              <p className="text-xs text-slate-500">
                Mentions from notes and group chat
              </p>
            </div>

            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No team notifications yet.
              </div>
            ) : (
              notifications.map((notification) => {
                const actor = Array.isArray(notification.actor)
                  ? notification.actor[0] ?? null
                  : notification.actor;

                const content = (
                  <div
                    className={`flex gap-3 px-4 py-3 transition hover:bg-slate-50 ${
                      notification.is_read
                        ? "bg-white"
                        : "bg-blue-50/60"
                    }`}
                  >
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {actor?.profile_picture_url ? (
                        <img
                          src={actor.profile_picture_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        actor?.full_name
                          ?.trim()
                          .charAt(0)
                          .toUpperCase() || "@"
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {notification.title}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {formatRelativeTime(
                            notification.created_at,
                          )}
                        </span>
                      </div>

                      {notification.body ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                          {notification.body}
                        </p>
                      ) : null}
                    </div>

                    {!notification.is_read ? (
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                    ) : null}
                  </div>
                );

                return notification.link ? (
                  <Link
                    key={notification.id}
                    href={notification.link}
                    onClick={() => {
                      setOpen(false);
                      if (!notification.is_read) {
                        void markRead(notification.id);
                      }
                    }}
                    className="block border-b border-slate-100 last:border-b-0"
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => {
                      if (!notification.is_read) {
                        void markRead(notification.id);
                      }
                    }}
                    className="block w-full border-b border-slate-100 text-left last:border-b-0"
                  >
                    {content}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
