"use client";

import { useCallback, useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type RoomBadge = {
  badge_count?: number;
  unread_count?: number;
};

type RoomsResponse = {
  success?: boolean;
  rooms?: RoomBadge[];
  totalBadgeCount?: number;
  businessId?: string;
};

const POLL_INTERVAL_MS = 30_000;
const BADGE_REFRESH_EVENT = "tenh:group-chat-badge-refresh";

/**
 * Red count on the Group Chat nav item.
 *
 * Realtime is the primary update path. The 30-second poll is kept only as a
 * safety fallback for browsers that temporarily lose their Realtime socket.
 * The number comes from the server's badge_count, which already accounts for
 * mute: a muted room contributes only its unread mentions, never ordinary
 * chatter.
 */
export function GroupChatNavBadge() {
  const [count, setCount] = useState(0);
  const [businessId, setBusinessId] = useState<string | null>(null);

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

      setCount(
        result.totalBadgeCount ??
          rooms.reduce(
            (sum, room) =>
              sum + (room.badge_count ?? room.unread_count ?? 0),
            0,
          ),
      );

      if (result.businessId) {
        setBusinessId((current) =>
          current === result.businessId ? current : result.businessId ?? null,
        );
      }
    } catch {
      /* A failed refresh must never break the header. */
    }
  }, []);

  useEffect(() => {
    void refresh();

    const timer = window.setInterval(refresh, POLL_INTERVAL_MS);
    const onFocus = () => void refresh();
    const onLocalReadOrChange = () => void refresh();

    window.addEventListener("focus", onFocus);
    window.addEventListener(BADGE_REFRESH_EVENT, onLocalReadOrChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(BADGE_REFRESH_EVENT, onLocalReadOrChange);
    };
  }, [refresh]);

  useEffect(() => {
    if (!businessId) {
      return;
    }

    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function startRealtime() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session || cancelled) {
        return;
      }

      await supabase.realtime.setAuth(session.access_token);

      if (cancelled) {
        return;
      }

      const filter = `business_id=eq.${businessId}`;
      const refreshBadge = () => void refresh();

      channel = supabase
        .channel(`tenh-group-chat-nav-badge-${businessId}`)
        // New/edit/delete message events change unread totals.
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "team_chat_events",
            filter,
          },
          refreshBadge,
        )
        // Reading or muting a room updates this table.
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_chat_room_members",
            filter,
          },
          refreshBadge,
        )
        // Mention badges can change independently of ordinary unread count.
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_notifications",
            filter,
          },
          refreshBadge,
        )
        // Room membership / room lifecycle changes can also affect totals.
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_chat_rooms",
            filter,
          },
          refreshBadge,
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
  }, [businessId, refresh]);

  if (count <= 0) {
    return null;
  }

  return (
    <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-none text-white shadow-sm">
      {count > 99 ? "99+" : count}
    </span>
  );
}
