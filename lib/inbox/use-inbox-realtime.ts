"use client";

import {
  useEffect,
  useRef,
} from "react";

import {
  createClient,
} from "@/lib/supabase/client";

export type InboxRealtimeTable =
  | "messages"
  | "conversations"
  | "conversation_activity";

export type InboxRealtimeEventType =
  | "INSERT"
  | "UPDATE"
  | "DELETE";

export type InboxRealtimeEvent = {
  table: InboxRealtimeTable;
  eventType: InboxRealtimeEventType;
  newRow: Record<string, unknown>;
  oldRow: Record<string, unknown>;
};

type UseInboxRealtimeInput = {
  businessIds: string[];

  onRealtimeEvent:
    (
      event: InboxRealtimeEvent,
    ) => void;

  /*
   * Used only when we need a full server refresh,
   * such as a brand-new conversation whose contact/social
   * relations are not contained in the raw realtime row.
   */
  onFallbackRefresh?: () => void;
};

export function useInboxRealtime({
  businessIds,
  onRealtimeEvent,
  onFallbackRefresh,
}: UseInboxRealtimeInput) {
  const eventCallbackRef =
    useRef(onRealtimeEvent);

  const fallbackRefreshRef =
    useRef(onFallbackRefresh);

  useEffect(() => {
    eventCallbackRef.current =
      onRealtimeEvent;
  }, [onRealtimeEvent]);

  useEffect(() => {
    fallbackRefreshRef.current =
      onFallbackRefresh;
  }, [onFallbackRefresh]);

  /*
   * Keep the effect stable when the caller recreates the array while
   * preserving the exact set of accessible subscriptions.
   */
  const businessIdsKey =
    Array.from(
      new Set(
        businessIds
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    )
      .sort()
      .join("|");

  useEffect(() => {
    const scopedBusinessIds =
      businessIdsKey
        ? businessIdsKey.split("|")
        : [];

    if (
      scopedBusinessIds.length ===
      0
    ) {
      console.warn(
        "[Tenh Realtime V3.11.31.39] No accessible business ids.",
      );

      return;
    }

    const supabase =
      createClient();

    let cancelled =
      false;

    const channels: Array<
      ReturnType<
        typeof supabase.channel
      >
    > = [];

    async function startRealtime() {
      const {
        data: sessionData,
        error: sessionError,
      } =
        await supabase.auth
          .getSession();

      if (cancelled) {
        return;
      }

      if (
        sessionError ||
        !sessionData.session
      ) {
        console.error(
          "[Tenh Realtime V3.11.31.39] No authenticated session.",
          sessionError?.message ??
            "",
        );

        return;
      }

      const session =
        sessionData.session;

      await supabase.realtime.setAuth(
        session.access_token,
      );

      if (cancelled) {
        return;
      }

      console.log(
        "[Tenh Realtime V3.11.31.39] JWT applied.",
      );

      for (
        const businessId of
          scopedBusinessIds
      ) {
        if (cancelled) {
          break;
        }

        const channel =
          supabase
            .channel(
              `tenh-inbox-v3-${businessId}`,
            )

            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "messages",
                filter:
                  `business_id=eq.${businessId}`,
              },
              (payload) => {
                const eventType =
                  payload.eventType as
                    InboxRealtimeEventType;

                console.log(
                  "[Tenh Realtime V3.11.31.39] messages",
                  businessId,
                  eventType,
                );

                eventCallbackRef.current({
                  table: "messages",
                  eventType,
                  newRow:
                    (payload.new ??
                      {}) as Record<
                      string,
                      unknown
                    >,
                  oldRow:
                    (payload.old ??
                      {}) as Record<
                      string,
                      unknown
                    >,
                });
              },
            )

            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table:
                  "conversations",
                filter:
                  `business_id=eq.${businessId}`,
              },
              (payload) => {
                const eventType =
                  payload.eventType as
                    InboxRealtimeEventType;

                console.log(
                  "[Tenh Realtime V3.11.31.39] conversations",
                  businessId,
                  eventType,
                );

                eventCallbackRef.current({
                  table:
                    "conversations",
                  eventType,
                  newRow:
                    (payload.new ??
                      {}) as Record<
                      string,
                      unknown
                    >,
                  oldRow:
                    (payload.old ??
                      {}) as Record<
                      string,
                      unknown
                    >,
                });

                /*
                 * A new raw conversation row has no joined contact,
                 * team-member or social-account objects. Ask the server for
                 * enriched data only in this uncommon case.
                 */
                if (
                  eventType ===
                    "INSERT"
                ) {
                  fallbackRefreshRef
                    .current?.();
                }
              },
            )

            .on(
              "postgres_changes",
              {
                event: "INSERT",
                schema: "public",
                table:
                  "conversation_activity",
                filter:
                  `business_id=eq.${businessId}`,
              },
              (payload) => {
                console.log(
                  "[Tenh Realtime V3.11.31.39] conversation_activity INSERT",
                  businessId,
                );

                eventCallbackRef.current({
                  table:
                    "conversation_activity",
                  eventType:
                    "INSERT",
                  newRow:
                    (payload.new ??
                      {}) as Record<
                      string,
                      unknown
                    >,
                  oldRow: {},
                });
              },
            )

            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "business_subscriptions",
                filter: `business_id=eq.${businessId}`,
              },
              () => {
                // Subscription expiry/reactivation changes Inbox scope. Ask the
                // server to recalculate accessible businesses and channels.
                fallbackRefreshRef.current?.();
              },
            )

            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "team_members",
                filter: `business_id=eq.${businessId}`,
              },
              () => {
                // Access removal/reactivation must disappear from Inbox without
                // waiting for a logout or hard browser refresh.
                fallbackRefreshRef.current?.();
              },
            )

            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "social_accounts",
                filter: `business_id=eq.${businessId}`,
              },
              () => {
                // Channel enable/disable or disconnect changes the operational
                // All Channels set immediately.
                fallbackRefreshRef.current?.();
              },
            )

            .subscribe(
              (
                status,
                error,
              ) => {
                console.log(
                  "[Tenh Realtime V3.11.31.39] Channel status:",
                  businessId,
                  status,
                );

                if (error) {
                  console.error(
                    "[Tenh Realtime V3.11.31.39] Channel error:",
                    businessId,
                    error,
                  );
                }

                if (
                  status ===
                    "SUBSCRIBED"
                ) {
                  console.log(
                    "[Tenh Realtime V3.11.31.39] ✅ SUBSCRIPTION REALTIME READY",
                    businessId,
                  );
                }
              },
            );

        channels.push(
          channel,
        );
      }
    }

    void startRealtime();

    const {
      data:
        authSubscriptionData,
    } =
      supabase.auth
        .onAuthStateChange(
          (
            event,
            session,
          ) => {
            if (
              !session
                ?.access_token
            ) {
              return;
            }

            if (
              event ===
                "TOKEN_REFRESHED" ||
              event ===
                "SIGNED_IN"
            ) {
              void supabase
                .realtime
                .setAuth(
                  session
                    .access_token,
                );
            }
          },
        );

    return () => {
      cancelled =
        true;

      authSubscriptionData
        .subscription
        .unsubscribe();

      for (
        const channel of
          channels
      ) {
        void supabase
          .removeChannel(
            channel,
          );
      }
    };
  }, [businessIdsKey]);
}
