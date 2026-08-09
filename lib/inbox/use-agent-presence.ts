"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  RealtimeChannel,
} from "@supabase/supabase-js";

import {
  createClient,
} from "@/lib/supabase/client";

import type {
  TeamMember,
} from "@/types/inbox";

export type AgentPresenceStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error";

export type AgentPresence = {
  user_id: string;
  member_id: string | null;
  name: string;
  email: string | null;
  profile_picture_url: string | null;
  conversation_id: string | null;
  is_typing: boolean;
  online_at: string;
  updated_at: string;
};

type UseAgentPresenceInput = {
  businessId: string | null;
  conversationId: string | null;
  teamMembers: TeamMember[];
  typingText: string;
};

function getPresenceUpdatedAt(
  presence: AgentPresence,
) {
  const value =
    new Date(
      presence.updated_at ||
        presence.online_at,
    ).getTime();

  return Number.isFinite(value)
    ? value
    : 0;
}

export function useAgentPresence({
  businessId,
  conversationId,
  teamMembers,
  typingText,
}: UseAgentPresenceInput) {
  const [
    status,
    setStatus,
  ] = useState<AgentPresenceStatus>(
    "idle",
  );

  const [
    remoteAgents,
    setRemoteAgents,
  ] = useState<AgentPresence[]>([]);

  const channelRef =
    useRef<RealtimeChannel | null>(
      null,
    );

  const selfPresenceRef =
    useRef<AgentPresence | null>(
      null,
    );

  const conversationIdRef =
    useRef<string | null>(
      conversationId,
    );

  const isTypingRef =
    useRef(false);

  const typingStartTimerRef =
    useRef<
      ReturnType<typeof setTimeout>
      | null
    >(null);

  const typingStopTimerRef =
    useRef<
      ReturnType<typeof setTimeout>
      | null
    >(null);

  /*
   * A Presence key should be unique per connected client/tab.
   * Using only the user id can cause multiple tabs for the same
   * agent to share one Presence key.
   */
  const presenceClientKeyRef =
    useRef<string | null>(
      null,
    );

  const publishPresence =
    useCallback(async () => {
      const channel =
        channelRef.current;

      const selfPresence =
        selfPresenceRef.current;

      if (
        !channel ||
        !selfPresence
      ) {
        return;
      }

      const nextPresence: AgentPresence = {
        ...selfPresence,
        conversation_id:
          conversationIdRef.current,
        is_typing:
          isTypingRef.current,
        updated_at:
          new Date().toISOString(),
      };

      selfPresenceRef.current =
        nextPresence;

      try {
        const trackStatus =
          await channel.track(
            nextPresence,
          );

        console.info(
          "[Tenh Presence] track",
          {
            status:
              trackStatus,
            userId:
              nextPresence.user_id,
            memberId:
              nextPresence.member_id,
            conversationId:
              nextPresence.conversation_id,
            isTyping:
              nextPresence.is_typing,
          },
        );
      } catch (presenceError) {
        console.warn(
          "[Tenh Presence] Unable to update presence.",
          presenceError,
        );
      }
    }, []);

  /*
   * Connect one Presence channel per business.
   *
   * We intentionally keep the channel business-scoped rather
   * than opening one WebSocket channel per conversation. Each
   * agent publishes the conversation they are currently viewing.
   */
  useEffect(() => {
    if (!businessId) {
      setStatus("idle");
      setRemoteAgents([]);
      channelRef.current = null;
      selfPresenceRef.current =
        null;
      return;
    }

    const supabase =
      createClient();

    let cancelled = false;
    let channel:
      RealtimeChannel | null =
      null;

    let unsubscribeAuth:
      (() => void)
      | null =
      null;

    setStatus("connecting");

    async function startPresence() {
      const {
        data: sessionData,
        error: sessionError,
      } =
        await supabase.auth
          .getSession();

      if (
        cancelled
      ) {
        return;
      }

      if (
        sessionError ||
        !sessionData.session
      ) {
        console.error(
          "[Tenh Presence] No authenticated session.",
          sessionError?.message ??
            "",
        );

        setStatus("error");
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

      const currentMember =
        teamMembers.find(
          (member) =>
            member.email
              ?.trim()
              .toLowerCase() ===
            session.user.email
              ?.trim()
              .toLowerCase(),
        ) ?? null;

      const fallbackName =
        session.user.user_metadata
          ?.full_name;

      const displayName =
        currentMember
          ?.full_name
          ?.trim() ||
        (typeof fallbackName ===
          "string"
          ? fallbackName.trim()
          : "") ||
        session.user.email
          ?.split("@")[0]
          ?.trim() ||
        "Team member";

      console.info(
        "[Tenh Presence] session",
        {
          userId:
            session.user.id,
          email:
            session.user.email ??
            null,
          businessId,
          memberMatched:
            Boolean(
              currentMember,
            ),
          memberId:
            currentMember?.id ??
            null,
        },
      );

      const now =
        new Date().toISOString();

      selfPresenceRef.current = {
        user_id:
          session.user.id,
        member_id:
          currentMember?.id ??
          null,
        name:
          displayName,
        email:
          session.user.email ??
          currentMember?.email ??
          null,
        profile_picture_url:
          currentMember
            ?.profile_picture_url ??
          null,
        conversation_id:
          conversationIdRef.current,
        is_typing: false,
        online_at: now,
        updated_at: now,
      };

      const presenceTopic =
        `tenh-presence:${businessId}`;

      if (
        !presenceClientKeyRef.current
      ) {
        presenceClientKeyRef.current =
          `${session.user.id}:${crypto.randomUUID()}`;
      }

      console.info(
        "[Tenh Presence] joining",
        {
          topic:
            presenceTopic,
          presenceKey:
            presenceClientKeyRef.current,
        },
      );

      channel =
        supabase.channel(
          presenceTopic,
          {
            config: {
              private: true,
              presence: {
                key:
                  presenceClientKeyRef.current,
              },
            },
          },
        );

      channelRef.current =
        channel;

      const syncPresence =
        () => {
          if (
            !channel ||
            cancelled
          ) {
            return;
          }

          const rawState =
            channel.presenceState() as unknown as Record<
              string,
              AgentPresence[]
            >;

          const byUser =
            new Map<
              string,
              AgentPresence
            >();

          for (
            const presences of
            Object.values(rawState)
          ) {
            for (
              const presence of
              presences
            ) {
              if (
                !presence ||
                typeof presence.user_id !==
                  "string"
              ) {
                continue;
              }

              /*
               * Do not show this browser user's own tabs as
               * another teammate.
               */
              if (
                presence.user_id ===
                session.user.id
              ) {
                continue;
              }

              const current =
                byUser.get(
                  presence.user_id,
                );

              if (
                !current ||
                getPresenceUpdatedAt(
                  presence,
                ) >=
                  getPresenceUpdatedAt(
                    current,
                  )
              ) {
                byUser.set(
                  presence.user_id,
                  presence,
                );
              }
            }
          }

          const nextRemoteAgents =
            Array.from(
              byUser.values(),
            );

          console.info(
            "[Tenh Presence] sync",
            {
              rawState,
              remoteAgentCount:
                nextRemoteAgents.length,
              remoteAgents:
                nextRemoteAgents.map(
                  (agent) => ({
                    userId:
                      agent.user_id,
                    name:
                      agent.name,
                    conversationId:
                      agent.conversation_id,
                    isTyping:
                      agent.is_typing,
                  }),
                ),
            },
          );

          setRemoteAgents(
            nextRemoteAgents,
          );
        };

      channel
        .on(
          "presence",
          {
            event: "sync",
          },
          syncPresence,
        )
        .on(
          "presence",
          {
            event: "join",
          },
          syncPresence,
        )
        .on(
          "presence",
          {
            event: "leave",
          },
          syncPresence,
        )
        .subscribe(
          async (
            channelStatus,
            channelError,
          ) => {
            if (cancelled) {
              return;
            }

            if (
              channelStatus ===
              "SUBSCRIBED"
            ) {
              setStatus(
                "connected",
              );

              console.info(
                "[Tenh Presence] ✅ SUBSCRIBED",
                {
                  businessId,
                  topic:
                    `tenh-presence:${businessId}`,
                },
              );

              await publishPresence();
              return;
            }

            if (
              channelStatus ===
                "CHANNEL_ERROR" ||
              channelStatus ===
                "TIMED_OUT"
            ) {
              /*
               * This is an operational Realtime connection state,
               * not a React render exception. Use warn so Next.js
               * development mode does not turn it into a full-screen
               * Console Error overlay.
               */
              console.warn(
                "[Tenh Presence] Channel problem.",
                {
                  status:
                    channelStatus,
                  error:
                    channelError ??
                    null,
                  businessId,
                  topic:
                    `tenh-presence:${businessId}`,
                },
              );

              setStatus("error");
            }
          },
          /*
           * Private-channel authorization can take a little longer
           * than a normal public Presence join because Supabase must
           * evaluate realtime.messages RLS before joining.
           */
          30000,
        );

      const {
        data:
          authSubscriptionData,
      } =
        supabase.auth
          .onAuthStateChange(
            (
              _event,
              nextSession,
            ) => {
              if (
                nextSession
                  ?.access_token
              ) {
                void supabase
                  .realtime
                  .setAuth(
                    nextSession
                      .access_token,
                  );
              }
            },
          );

      unsubscribeAuth =
        () => {
          authSubscriptionData
            .subscription
            .unsubscribe();
        };
    }

    void startPresence();

    return () => {
      cancelled = true;

      if (
        typingStartTimerRef
          .current
      ) {
        clearTimeout(
          typingStartTimerRef
            .current,
        );

        typingStartTimerRef.current =
          null;
      }

      if (
        typingStopTimerRef
          .current
      ) {
        clearTimeout(
          typingStopTimerRef
            .current,
        );

        typingStopTimerRef.current =
          null;
      }

      unsubscribeAuth?.();

      channelRef.current =
        null;

      selfPresenceRef.current =
        null;

      setRemoteAgents([]);

      if (channel) {
        void supabase
          .removeChannel(
            channel,
          );
      }
    };
  }, [
    businessId,
    publishPresence,
    teamMembers,
  ]);

  /*
   * Changing conversations updates Presence immediately and
   * clears the typing state from the conversation being left.
   */
  useEffect(() => {
    conversationIdRef.current =
      conversationId;

    isTypingRef.current =
      false;

    if (
      typingStartTimerRef.current
    ) {
      clearTimeout(
        typingStartTimerRef.current,
      );

      typingStartTimerRef.current =
        null;
    }

    if (
      typingStopTimerRef.current
    ) {
      clearTimeout(
        typingStopTimerRef.current,
      );

      typingStopTimerRef.current =
        null;
    }

    void publishPresence();
  }, [
    conversationId,
    publishPresence,
  ]);

  /*
   * Typing is intentionally low-frequency:
   * - publish "typing" once when a typing burst begins
   * - publish "not typing" after 1.8 seconds without input
   *
   * Supabase Presence is designed for small state changes, not
   * a Presence update on every individual keypress.
   */
  useEffect(() => {
    const hasText =
      Boolean(
        conversationId &&
          typingText.length > 0,
      );

    if (!hasText) {
      if (
        typingStartTimerRef
          .current
      ) {
        clearTimeout(
          typingStartTimerRef
            .current,
        );

        typingStartTimerRef.current =
          null;
      }

      if (
        typingStopTimerRef
          .current
      ) {
        clearTimeout(
          typingStopTimerRef
            .current,
        );

        typingStopTimerRef.current =
          null;
      }

      if (
        isTypingRef.current
      ) {
        isTypingRef.current =
          false;

        void publishPresence();
      }

      return;
    }

    if (
      !isTypingRef.current &&
      !typingStartTimerRef
        .current
    ) {
      typingStartTimerRef.current =
        setTimeout(
          () => {
            typingStartTimerRef.current =
              null;

            isTypingRef.current =
              true;

            void publishPresence();
          },
          250,
        );
    }

    if (
      typingStopTimerRef.current
    ) {
      clearTimeout(
        typingStopTimerRef.current,
      );
    }

    typingStopTimerRef.current =
      setTimeout(
        () => {
          typingStopTimerRef.current =
            null;

          if (
            !isTypingRef.current
          ) {
            return;
          }

          isTypingRef.current =
            false;

          void publishPresence();
        },
        1800,
      );
  }, [
    conversationId,
    publishPresence,
    typingText,
  ]);

  const viewingAgents =
    useMemo(
      () =>
        remoteAgents.filter(
          (agent) =>
            Boolean(
              conversationId &&
                agent.conversation_id ===
                  conversationId,
            ),
        ),
      [
        conversationId,
        remoteAgents,
      ],
    );

  const typingAgents =
    useMemo(
      () =>
        viewingAgents.filter(
          (agent) =>
            agent.is_typing,
        ),
      [viewingAgents],
    );

  return {
    status,
    viewingAgents,
    typingAgents,
  };
}