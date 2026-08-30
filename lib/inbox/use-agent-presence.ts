"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import type { TeamMember } from "@/types/inbox";

export type AgentPresenceStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error";

export type AgentAvailabilityStatus =
  | "online"
  | "away"
  | "offline";

export type AgentPresence = {
  user_id: string;
  member_id: string | null;
  name: string;
  email: string | null;
  profile_picture_url: string | null;
  conversation_id: string | null;
  is_typing: boolean;
  /* Older clients may not publish this field yet; missing means online. */
  availability?: "online" | "away";
  /*
   * Monotonic per-tab revision prevents an older Presence sync payload from
   * moving a teammate back to a conversation they already left. Older clients
   * can omit it; updated_at remains the fallback ordering signal.
   */
  revision?: number;
  online_at: string;
  updated_at: string;
};

export type TeamAgentPresence = {
  member_id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  profile_picture_url: string | null;
  status: AgentAvailabilityStatus;
  conversation_id: string | null;
  is_typing: boolean;
  updated_at: string | null;
};

type UseAgentPresenceInput = {
  businessId: string | null;
  conversationId: string | null;
  teamMembers: TeamMember[];
  typingText: string;
};

const PRESENCE_HEARTBEAT_MS = 15_000;
const PRESENCE_TRANSIENT_GAP_MS = 1_200;
const PRESENCE_DEPARTED_BARRIER_MS = 10_000;
const PRESENCE_BROADCAST_EVENT = "tenh_agent_presence_state";
const PRESENCE_AWAY_AFTER_MS = 5 * 60_000;
const PRESENCE_AWAY_CHECK_MS = 15_000;

type CachedRemotePresence = {
  agent: AgentPresence;
  lastSeenAt: number;
};

type DepartedPresenceBarrier = {
  agent: AgentPresence;
  expiresAt: number;
};

type PresenceBroadcastPayload = {
  presence_key?: string;
  agent?: AgentPresence;
};

function getPresenceUpdatedAt(presence: AgentPresence) {
  const value = new Date(
    presence.updated_at || presence.online_at,
  ).getTime();

  return Number.isFinite(value) ? value : 0;
}

function isPresenceAtLeastAsNew(
  candidate: AgentPresence,
  current: AgentPresence,
) {
  const candidateRevision =
    typeof candidate.revision === "number"
      ? candidate.revision
      : 0;
  const currentRevision =
    typeof current.revision === "number"
      ? current.revision
      : 0;

  if (candidateRevision !== currentRevision) {
    return candidateRevision > currentRevision;
  }

  return (
    getPresenceUpdatedAt(candidate) >=
    getPresenceUpdatedAt(current)
  );
}

function isPresenceStrictlyNewer(
  candidate: AgentPresence,
  current: AgentPresence,
) {
  const candidateRevision =
    typeof candidate.revision === "number"
      ? candidate.revision
      : 0;
  const currentRevision =
    typeof current.revision === "number"
      ? current.revision
      : 0;

  if (candidateRevision !== currentRevision) {
    return candidateRevision > currentRevision;
  }

  return (
    getPresenceUpdatedAt(candidate) >
    getPresenceUpdatedAt(current)
  );
}

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

export function useAgentPresence({
  businessId,
  conversationId,
  teamMembers,
  typingText,
}: UseAgentPresenceInput) {
  const [status, setStatus] =
    useState<AgentPresenceStatus>("idle");
  const [remoteAgents, setRemoteAgents] =
    useState<AgentPresence[]>([]);
  const [selfAgent, setSelfAgent] =
    useState<AgentPresence | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const selfPresenceRef = useRef<AgentPresence | null>(null);
  const conversationIdRef = useRef<string | null>(conversationId);
  const isTypingRef = useRef(false);
  const availabilityRef = useRef<"online" | "away">("online");
  const lastActivityAtRef = useRef(Date.now());
  const teamMembersRef = useRef(teamMembers);
  const remotePresenceCacheRef = useRef(
    new Map<string, CachedRemotePresence>(),
  );
  /*
   * Explicit leave events can race with a newer track() for the same tab.
   * Keep a short per-tab tombstone so a delayed Presence sync cannot bring
   * the old conversation/avatar back after the agent already switched.
   */
  const departedPresenceBarrierRef = useRef(
    new Map<string, DepartedPresenceBarrier>(),
  );
  const reconcilePresenceTimerRef = useRef<number | null>(null);
  const typingTextRef = useRef(typingText);
  const typingSwitchGuardRef = useRef<{
    conversationId: string | null;
    staleText: string;
  } | null>(null);

  typingTextRef.current = typingText;

  /*
   * A Presence key must be unique per browser tab. If the same user opens
   * two TENH tabs, each tab can therefore publish its own viewing state.
   */
  const presenceClientKeyRef = useRef<string | null>(null);
  const presenceRevisionRef = useRef(0);
  const lastPublishedConversationIdRef =
    useRef<string | null | undefined>(undefined);

  /*
   * Presence updates can happen very close together (for example when an
   * agent switches conversation while a draft is still being cleared).
   * Serialize track() calls so an older async request cannot overwrite the
   * newest conversation / typing state on another teammate's screen.
   */
  const publishInFlightRef = useRef(false);
  const publishQueuedRef = useRef(false);

  const publishPresence = useCallback(async () => {
    if (publishInFlightRef.current) {
      publishQueuedRef.current = true;
      return;
    }

    publishInFlightRef.current = true;

    try {
      do {
        publishQueuedRef.current = false;

        const channel = channelRef.current;
        const selfPresence = selfPresenceRef.current;

        if (!channel || !selfPresence) {
          break;
        }

        presenceRevisionRef.current += 1;

        const nextPresence: AgentPresence = {
          ...selfPresence,
          conversation_id: conversationIdRef.current,
          is_typing: isTypingRef.current,
          availability: availabilityRef.current,
          revision: presenceRevisionRef.current,
          updated_at: new Date().toISOString(),
        };

        selfPresenceRef.current = nextPresence;
        setSelfAgent(nextPresence);

        try {
          const previousConversationId =
            lastPublishedConversationIdRef.current;
          const conversationChanged =
            previousConversationId !== undefined &&
            previousConversationId !== nextPresence.conversation_id;

          /*
           * Keep one Presence key tracked for the lifetime of this browser tab.
           * Do NOT untrack + retrack on conversation switches: that creates a
           * leave/join race where another browser can briefly resurrect the old
           * conversation state. The monotonic revision makes an in-place track
           * replacement safe, while the broadcast below is the fast path.
           */
          const trackStatus = await channel.track(nextPresence);

          try {
            await channel.send({
              type: "broadcast",
              event: PRESENCE_BROADCAST_EVENT,
              payload: {
                presence_key: presenceClientKeyRef.current,
                agent: nextPresence,
              } satisfies PresenceBroadcastPayload,
            });
          } catch (broadcastError) {
            /* Presence remains authoritative if broadcast delivery fails. */
            console.warn(
              "[Tenh Presence] Fast presence broadcast failed.",
              broadcastError,
            );
          }

          lastPublishedConversationIdRef.current =
            nextPresence.conversation_id;

          console.info("[Tenh Presence] track", {
            status: trackStatus,
            userId: nextPresence.user_id,
            memberId: nextPresence.member_id,
            conversationId: nextPresence.conversation_id,
            isTyping: nextPresence.is_typing,
            revision: nextPresence.revision,
            conversationChanged,
          });
        } catch (presenceError) {
          console.warn(
            "[Tenh Presence] Unable to update presence.",
            presenceError,
          );
        }
      } while (publishQueuedRef.current);
    } finally {
      publishInFlightRef.current = false;
    }
  }, []);

  /*
   * Keep the latest team-member list available to the long-lived Presence
   * connection without reconnecting the websocket every time that array is
   * refreshed elsewhere in the Inbox.
   */
  useEffect(() => {
    teamMembersRef.current = teamMembers;

    const selfPresence = selfPresenceRef.current;
    if (!selfPresence) {
      return;
    }

    const selfEmail = normalizeEmail(selfPresence.email);
    if (!selfEmail) {
      return;
    }

    const currentMember =
      teamMembers.find(
        (member) => normalizeEmail(member.email) === selfEmail,
      ) ?? null;

    if (!currentMember) {
      return;
    }

    const nextName =
      currentMember.full_name?.trim() || selfPresence.name;
    const nextMemberId = currentMember.id ?? selfPresence.member_id;
    const nextPicture =
      currentMember.profile_picture_url ??
      selfPresence.profile_picture_url;

    if (
      nextName === selfPresence.name &&
      nextMemberId === selfPresence.member_id &&
      nextPicture === selfPresence.profile_picture_url
    ) {
      return;
    }

    selfPresenceRef.current = {
      ...selfPresence,
      member_id: nextMemberId,
      name: nextName,
      profile_picture_url: nextPicture,
    };

    void publishPresence();
  }, [publishPresence, teamMembers]);

  /*
   * Connect one Presence channel per business. Each signed-in agent publishes
   * the single conversation they are currently viewing.
   */
  useEffect(() => {
    if (!businessId) {
      setStatus("idle");
      setRemoteAgents([]);
      channelRef.current = null;
      selfPresenceRef.current = null;
      setSelfAgent(null);
      isTypingRef.current = false;
      availabilityRef.current = "online";
      lastActivityAtRef.current = Date.now();
      lastPublishedConversationIdRef.current = undefined;
      remotePresenceCacheRef.current.clear();
      departedPresenceBarrierRef.current.clear();
      typingSwitchGuardRef.current = null;

      if (reconcilePresenceTimerRef.current !== null) {
        window.clearTimeout(reconcilePresenceTimerRef.current);
        reconcilePresenceTimerRef.current = null;
      }

      return;
    }

    const supabase = createClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let unsubscribeAuth: (() => void) | null = null;

    setStatus("connecting");

    async function startPresence() {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (cancelled) {
        return;
      }

      if (userError || !userData.user) {
        console.error(
          "[Tenh Presence] Unable to verify authenticated user.",
          userError?.message ?? "",
        );
        setStatus("error");
        return;
      }

      const user = userData.user;

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (cancelled) {
        return;
      }

      if (sessionError || !sessionData.session) {
        console.error(
          "[Tenh Presence] No authenticated session.",
          sessionError?.message ?? "",
        );
        setStatus("error");
        return;
      }

      await supabase.realtime.setAuth(
        sessionData.session.access_token,
      );

      if (cancelled) {
        return;
      }

      const userEmail = normalizeEmail(user.email);
      const currentMember =
        teamMembersRef.current.find(
          (member) => normalizeEmail(member.email) === userEmail,
        ) ?? null;

      const fallbackName = user.user_metadata?.full_name;
      const displayName =
        currentMember?.full_name?.trim() ||
        (typeof fallbackName === "string"
          ? fallbackName.trim()
          : "") ||
        user.email?.split("@")[0]?.trim() ||
        "Team member";

      const now = new Date().toISOString();

      selfPresenceRef.current = {
        user_id: user.id,
        member_id: currentMember?.id ?? null,
        name: displayName,
        email: user.email ?? currentMember?.email ?? null,
        profile_picture_url:
          currentMember?.profile_picture_url ?? null,
        conversation_id: conversationIdRef.current,
        is_typing: isTypingRef.current,
        availability: availabilityRef.current,
        online_at: now,
        updated_at: now,
      };

      setSelfAgent(selfPresenceRef.current);

      const presenceTopic = `tenh-presence:${businessId}`;

      if (!presenceClientKeyRef.current) {
        presenceClientKeyRef.current =
          `${user.id}:${crypto.randomUUID()}`;
      }

      console.info("[Tenh Presence] joining", {
        topic: presenceTopic,
        presenceKey: presenceClientKeyRef.current,
      });

      channel = supabase.channel(presenceTopic, {
        config: {
          private: true,
          presence: {
            key: presenceClientKeyRef.current,
          },
        },
      });

      channelRef.current = channel;

      const emitRemoteAgents = () => {
        /*
         * Aggregate tabs only after the per-tab cache is stable. Keep one
         * visible avatar per teammate per conversation and mark the teammate
         * typing when ANY of their tabs on this conversation is typing.
         */
        const byUserConversation = new Map<string, AgentPresence>();

        for (const { agent } of remotePresenceCacheRef.current.values()) {
          const aggregateKey = `${agent.user_id}::${
            agent.conversation_id ?? "__none__"
          }`;
          const current = byUserConversation.get(aggregateKey);

          if (!current) {
            byUserConversation.set(aggregateKey, agent);
            continue;
          }

          const newest =
            isPresenceAtLeastAsNew(agent, current)
              ? agent
              : current;

          byUserConversation.set(aggregateKey, {
            ...newest,
            is_typing:
              Boolean(current.is_typing) || Boolean(agent.is_typing),
            availability:
              current.availability !== "away" ||
              agent.availability !== "away"
                ? "online"
                : "away",
          });
        }

        const nextRemoteAgents = Array.from(
          byUserConversation.values(),
        );

        console.info("[Tenh Presence] sync", {
          remoteAgentCount: nextRemoteAgents.length,
          remoteAgents: nextRemoteAgents.map((agent) => ({
            userId: agent.user_id,
            name: agent.name,
            conversationId: agent.conversation_id,
            isTyping: agent.is_typing,
            revision: agent.revision ?? 0,
          })),
        });

        setRemoteAgents(nextRemoteAgents);
      };

      const syncPresence = (options?: {
        forceRemoveMissingKeys?: boolean;
      }) => {
        if (!channel || cancelled) {
          return;
        }

        const rawState = channel.presenceState() as unknown as Record<
          string,
          AgentPresence[]
        >;
        const now = Date.now();
        const observedPresenceKeys = new Set<string>();

        /* Expire old leave barriers before reconciling the authoritative map. */
        for (const [presenceKey, barrier] of
          departedPresenceBarrierRef.current.entries()) {
          if (barrier.expiresAt <= now) {
            departedPresenceBarrierRef.current.delete(presenceKey);
          }
        }

        /*
         * Cache Presence by Supabase presence key (one key per browser tab),
         * not only by user_id. Repeated track() calls may briefly expose more
         * than one meta for the same key. Always choose by monotonic revision,
         * then timestamp, so the old conversation can never win the race.
         */
        for (const [presenceKey, presences] of Object.entries(rawState)) {
          let newestPresence: AgentPresence | null = null;

          for (const presence of presences) {
            if (!presence || typeof presence.user_id !== "string") {
              continue;
            }

            /* Do not render this user's own browser tabs as teammates. */
            if (presence.user_id === user.id) {
              continue;
            }

            if (
              !newestPresence ||
              isPresenceAtLeastAsNew(presence, newestPresence)
            ) {
              newestPresence = presence;
            }
          }

          if (!newestPresence) {
            continue;
          }

          const barrier =
            departedPresenceBarrierRef.current.get(presenceKey);

          if (barrier) {
            if (!isPresenceStrictlyNewer(newestPresence, barrier.agent)) {
              /* Delayed old state after a real/partial leave: never resurrect. */
              continue;
            }

            departedPresenceBarrierRef.current.delete(presenceKey);
          }

          observedPresenceKeys.add(presenceKey);

          const cached =
            remotePresenceCacheRef.current.get(presenceKey);

          if (
            !cached ||
            isPresenceAtLeastAsNew(newestPresence, cached.agent)
          ) {
            remotePresenceCacheRef.current.set(presenceKey, {
              agent: newestPresence,
              lastSeenAt: now,
            });
          } else {
            /* Keep the newer cached state; only refresh its liveness. */
            remotePresenceCacheRef.current.set(presenceKey, {
              ...cached,
              lastSeenAt: now,
            });
          }
        }

        let nextExpiryAt: number | null = null;

        for (const [presenceKey, cached] of
          remotePresenceCacheRef.current.entries()) {
          if (observedPresenceKeys.has(presenceKey)) {
            continue;
          }

          if (options?.forceRemoveMissingKeys) {
            const departureBarrier =
              departedPresenceBarrierRef.current.get(presenceKey);

            /*
             * If the leave belongs to an older meta but Broadcast/Presence
             * already gave us a newer revision, do not delete that newer
             * conversation. Give the authoritative state a short window to
             * catch up; a later leave for the newer revision removes it.
             */
            if (
              !departureBarrier ||
              !isPresenceStrictlyNewer(
                cached.agent,
                departureBarrier.agent,
              )
            ) {
              remotePresenceCacheRef.current.delete(presenceKey);
              continue;
            }
          }

          const expiresAt =
            cached.lastSeenAt + PRESENCE_TRANSIENT_GAP_MS;

          if (expiresAt <= now) {
            remotePresenceCacheRef.current.delete(presenceKey);
            continue;
          }

          if (nextExpiryAt === null || expiresAt < nextExpiryAt) {
            nextExpiryAt = expiresAt;
          }
        }

        emitRemoteAgents();

        if (reconcilePresenceTimerRef.current !== null) {
          window.clearTimeout(reconcilePresenceTimerRef.current);
          reconcilePresenceTimerRef.current = null;
        }

        if (nextExpiryAt !== null) {
          reconcilePresenceTimerRef.current = window.setTimeout(
            () => syncPresence(),
            Math.max(50, nextExpiryAt - Date.now() + 25),
          );
        }
      };

      const handleBroadcastPresence = (message: {
        payload?: PresenceBroadcastPayload;
      }) => {
        if (cancelled) {
          return;
        }

        const presenceKey = message.payload?.presence_key;
        const agent = message.payload?.agent;

        if (
          typeof presenceKey !== "string" ||
          !presenceKey ||
          !agent ||
          typeof agent.user_id !== "string" ||
          agent.user_id === user.id
        ) {
          return;
        }

        const barrier =
          departedPresenceBarrierRef.current.get(presenceKey);

        if (barrier) {
          if (!isPresenceStrictlyNewer(agent, barrier.agent)) {
            return;
          }
          departedPresenceBarrierRef.current.delete(presenceKey);
        }

        const cached =
          remotePresenceCacheRef.current.get(presenceKey);

        if (
          cached &&
          !isPresenceAtLeastAsNew(agent, cached.agent)
        ) {
          return;
        }

        remotePresenceCacheRef.current.set(presenceKey, {
          agent,
          lastSeenAt: Date.now(),
        });
        emitRemoteAgents();
      };

      const handlePresenceLeave = (payload: {
        key?: string;
        leftPresences?: AgentPresence[];
      } | null) => {
        const presenceKey =
          typeof payload?.key === "string"
            ? payload.key
            : null;

        if (!presenceKey) {
          syncPresence({ forceRemoveMissingKeys: true });
          return;
        }

        let newestLeft: AgentPresence | null = null;
        for (const presence of payload?.leftPresences ?? []) {
          if (
            presence &&
            typeof presence.user_id === "string" &&
            (!newestLeft ||
              isPresenceAtLeastAsNew(presence, newestLeft))
          ) {
            newestLeft = presence;
          }
        }

        const cached =
          remotePresenceCacheRef.current.get(presenceKey);

        if (newestLeft) {
          departedPresenceBarrierRef.current.set(presenceKey, {
            agent: newestLeft,
            expiresAt: Date.now() + PRESENCE_DEPARTED_BARRIER_MS,
          });
        }

        /*
         * A leave may belong to an older meta from an in-place track update.
         * Keep a newer cached revision if one already exists; otherwise remove
         * the departed tab immediately. The authoritative sync then verifies it.
         */
        if (
          !cached ||
          !newestLeft ||
          !isPresenceStrictlyNewer(cached.agent, newestLeft)
        ) {
          remotePresenceCacheRef.current.delete(presenceKey);
        }

        emitRemoteAgents();
        syncPresence({ forceRemoveMissingKeys: true });

        window.setTimeout(() => {
          syncPresence({ forceRemoveMissingKeys: true });
        }, 75);
      };

      channel
        .on("presence", { event: "sync" }, () => syncPresence())
        .on("presence", { event: "join" }, () => syncPresence())
        .on("presence", { event: "leave" }, handlePresenceLeave)
        .on(
          "broadcast",
          { event: PRESENCE_BROADCAST_EVENT },
          handleBroadcastPresence,
        )
        .subscribe(
          async (channelStatus, channelError) => {
            if (cancelled) {
              return;
            }

            if (channelStatus === "SUBSCRIBED") {
              setStatus("connected");

              console.info("[Tenh Presence] ✅ SUBSCRIBED", {
                businessId,
                topic: presenceTopic,
              });

              /* Always republish the latest draft/conversation after reconnect. */
              await publishPresence();
              return;
            }

            if (
              channelStatus === "CHANNEL_ERROR" ||
              channelStatus === "TIMED_OUT"
            ) {
              console.warn("[Tenh Presence] Channel problem.", {
                status: channelStatus,
                error: channelError ?? null,
                businessId,
                topic: presenceTopic,
              });

              setStatus("error");
              return;
            }

            if (channelStatus === "CLOSED") {
              setStatus("connecting");
            }
          },
          30_000,
        );

      const { data: authSubscriptionData } =
        supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (!nextSession?.access_token) {
            return;
          }

          void (async () => {
            try {
              await supabase.realtime.setAuth(nextSession.access_token);
              if (!cancelled) {
                await publishPresence();
              }
            } catch (authError) {
              console.warn(
                "[Tenh Presence] Unable to refresh Realtime auth.",
                authError,
              );
            }
          })();
        });

      unsubscribeAuth = () => {
        authSubscriptionData.subscription.unsubscribe();
      };
    }

    void startPresence();

    return () => {
      cancelled = true;
      unsubscribeAuth?.();

      channelRef.current = null;
      selfPresenceRef.current = null;
      setSelfAgent(null);
      publishQueuedRef.current = false;
      lastPublishedConversationIdRef.current = undefined;
      remotePresenceCacheRef.current.clear();
      departedPresenceBarrierRef.current.clear();
      typingSwitchGuardRef.current = null;

      if (reconcilePresenceTimerRef.current !== null) {
        window.clearTimeout(reconcilePresenceTimerRef.current);
        reconcilePresenceTimerRef.current = null;
      }

      setRemoteAgents([]);

      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [businessId, publishPresence]);

  /*
   * A conversation switch must immediately remove the old typing indicator.
   * We publish the new conversation as "not typing" first. If the new reply
   * box already contains a draft, the typing effect below will then publish
   * the newest state in order.
   */
  useEffect(() => {
    const previousConversationId = conversationIdRef.current;

    if (previousConversationId === conversationId) {
      return;
    }

    /*
     * The parent clears the reply after a conversation switch. During that
     * one render, typingText can still contain Conversation A's draft while
     * conversationId already points at B. Remember that stale text and never
     * publish it as typing on B.
     */
    const staleText = typingTextRef.current;
    typingSwitchGuardRef.current = staleText.trim()
      ? { conversationId, staleText }
      : null;

    conversationIdRef.current = conversationId;
    isTypingRef.current = false;
    void publishPresence();
  }, [conversationId, publishPresence]);

  /*
   * TENH's typing indicator represents an unsent draft, not recent keypresses:
   * - any non-empty reply => Typing a reply
   * - clearing/sending the reply => stop immediately
   * - switching conversations => stop on the old conversation immediately
   *
   * Only the boolean transition is published, so this stays realtime without
   * sending a Presence update for every keypress.
   */
  useEffect(() => {
    const switchGuard = typingSwitchGuardRef.current;
    let textBelongsToConversation = true;

    if (
      switchGuard &&
      switchGuard.conversationId === conversationId
    ) {
      if (typingText === switchGuard.staleText) {
        textBelongsToConversation = false;
      } else {
        /* Parent cleared the previous draft or the user typed on the new one. */
        typingSwitchGuardRef.current = null;
      }
    }

    const shouldBeTyping = Boolean(
      conversationId &&
        textBelongsToConversation &&
        typingText.trim().length > 0,
    );

    let needsPublish = false;

    if (textBelongsToConversation && typingText.length > 0) {
      lastActivityAtRef.current = Date.now();

      if (availabilityRef.current !== "online") {
        availabilityRef.current = "online";
        needsPublish = true;
      }
    }

    if (isTypingRef.current !== shouldBeTyping) {
      isTypingRef.current = shouldBeTyping;
      needsPublish = true;
    }

    if (needsPublish) {
      void publishPresence();
    }
  }, [conversationId, publishPresence, typingText]);

  /*
   * Online / Away is activity based. A member becomes Away after five minutes
   * without browser interaction and returns Online immediately on activity.
   * Closing the tab/browser removes Supabase Presence, which becomes Offline
   * for teammates automatically.
   */
  useEffect(() => {
    if (!businessId) {
      return;
    }

    const markActive = () => {
      lastActivityAtRef.current = Date.now();

      if (availabilityRef.current !== "online") {
        availabilityRef.current = "online";
        void publishPresence();
      }
    };

    const checkAway = () => {
      if (
        availabilityRef.current === "online" &&
        Date.now() - lastActivityAtRef.current >= PRESENCE_AWAY_AFTER_MS
      ) {
        availabilityRef.current = "away";
        void publishPresence();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        markActive();
      } else {
        checkAway();
      }
    };

    window.addEventListener("pointerdown", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    window.addEventListener("touchstart", markActive, { passive: true });
    window.addEventListener("focus", markActive);
    document.addEventListener("visibilitychange", handleVisibility);

    const awayTimer = window.setInterval(
      checkAway,
      PRESENCE_AWAY_CHECK_MS,
    );

    return () => {
      window.clearInterval(awayTimer);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("touchstart", markActive);
      window.removeEventListener("focus", markActive);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [businessId, publishPresence]);

  /*
   * Heartbeat + resume publishing keeps Presence fresh after short network
   * interruptions, laptop sleep, tab backgrounding, or websocket reconnects.
   * It republishes state only every 15s; normal typing changes remain instant.
   */
  useEffect(() => {
    if (!businessId || status !== "connected") {
      return;
    }

    const heartbeat = window.setInterval(() => {
      void publishPresence();
    }, PRESENCE_HEARTBEAT_MS);

    const republish = () => {
      void publishPresence();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        republish();
      }
    };

    window.addEventListener("online", republish);
    window.addEventListener("focus", republish);
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("online", republish);
      window.removeEventListener("focus", republish);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [businessId, publishPresence, status]);

  const viewingAgents = useMemo(
    () =>
      remoteAgents.filter((agent) =>
        Boolean(
          conversationId &&
            agent.conversation_id === conversationId,
        ),
      ),
    [conversationId, remoteAgents],
  );

  const typingAgents = useMemo(
    () => viewingAgents.filter((agent) => agent.is_typing),
    [viewingAgents],
  );

  const teamPresence = useMemo<TeamAgentPresence[]>(() => {
    const candidates = [
      ...remoteAgents,
      ...(selfAgent ? [selfAgent] : []),
    ];

    return teamMembers
      .filter(
        (member) =>
          (!businessId ||
            !member.business_id ||
            member.business_id === businessId) &&
          Boolean(member.id),
      )
      .map((member) => {
        const memberEmail = normalizeEmail(member.email);
        const matches = candidates.filter(
          (agent) =>
            agent.member_id === member.id ||
            Boolean(
              memberEmail &&
                normalizeEmail(agent.email) === memberEmail,
            ),
        );

        const newest = matches.reduce<AgentPresence | null>(
          (current, agent) =>
            !current ||
            getPresenceUpdatedAt(agent) >=
              getPresenceUpdatedAt(current)
              ? agent
              : current,
          null,
        );

        const hasOnline = matches.some(
          (agent) => agent.availability !== "away",
        );
        const hasAway = matches.some(
          (agent) => agent.availability === "away",
        );

        return {
          member_id: member.id,
          user_id: newest?.user_id ?? null,
          name: member.full_name?.trim() || newest?.name || "Team member",
          email: member.email || newest?.email || null,
          profile_picture_url:
            member.profile_picture_url ??
            newest?.profile_picture_url ??
            null,
          status: hasOnline
            ? "online"
            : hasAway
              ? "away"
              : "offline",
          conversation_id: newest?.conversation_id ?? null,
          is_typing: matches.some((agent) => agent.is_typing),
          updated_at: newest?.updated_at ?? null,
        } satisfies TeamAgentPresence;
      });
  }, [businessId, remoteAgents, selfAgent, teamMembers]);

  return {
    status,
    viewingAgents,
    typingAgents,
    teamPresence,
  };
}
