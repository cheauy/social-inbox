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
  | "conversations";

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
  businessId:
    | string
    | null;

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
  businessId,
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

  useEffect(() => {
    if (!businessId) {
      console.warn(
        "[Tenh Realtime V2] No businessId.",
      );

      return;
    }

    const supabase =
      createClient();

    let cancelled =
      false;

    let channel:
      ReturnType<
        typeof supabase.channel
      >
      | null = null;

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
          "[Tenh Realtime V2] No authenticated session.",
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
        "[Tenh Realtime V2] JWT applied.",
      );

      channel =
        supabase
          .channel(
            `tenh-inbox-v2-${businessId}`,
          )

          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "messages",
            },
            (payload) => {
              const eventType =
                payload.eventType as
                  InboxRealtimeEventType;

              console.log(
                "[Tenh Realtime V2] messages",
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
            },
            (payload) => {
              const eventType =
                payload.eventType as
                  InboxRealtimeEventType;

              console.log(
                "[Tenh Realtime V2] conversations",
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
               * team-member or social-account objects. Ask the
               * server for enriched data only in this uncommon case.
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

          .subscribe(
            (
              status,
              error,
            ) => {
              console.log(
                "[Tenh Realtime V2] Channel status:",
                status,
              );

              if (error) {
                console.error(
                  "[Tenh Realtime V2] Channel error:",
                  error,
                );
              }

              if (
                status ===
                "SUBSCRIBED"
              ) {
                console.log(
                  "[Tenh Realtime V2] ✅ LIVE STATE READY",
                );
              }
            },
          );
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

      if (channel) {
        void supabase
          .removeChannel(
            channel,
          );
      }
    };
  }, [businessId]);
}