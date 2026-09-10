import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { useAccount } from "./account";
import { sessionStorage } from "./auth/secure-storage";
import { useAuth } from "./auth/provider";
import { useInbox } from "./inbox-provider";
import { supabase } from "./supabase/client";

/*
 * Who else is looking at this conversation.
 *
 * Two people answering the same customer at once is the oldest failure in a
 * shared inbox: the customer gets two different prices, or two apologies, or
 * one reply that contradicts the other. The website has said who is viewing a
 * thread for a while; the phone has not, so somebody at a desk could see that
 * a colleague was on their phone in the thread, and the colleague could not
 * see them back.
 *
 * This is the same channel the website uses -- tenh-presence:<businessId>,
 * with the same payload -- so the two see each other rather than each keeping
 * a private list. It is a private channel: the database authorises the topic
 * against an active membership of exactly that workspace, so nobody can watch
 * another shop's team.
 *
 * Nothing is written to any table. Presence lives in the socket and vanishes
 * when the app does, which is what makes it honest: a phone that loses signal
 * stops being "here" on its own.
 */

export type Viewer = {
  user_id: string;
  member_id: string | null;
  name: string;
  email: string | null;
  profile_picture_url: string | null;
  conversation_id: string | null;
  is_typing: boolean;
  availability?: "online" | "away";
  revision?: number;
  online_at: string;
  updated_at: string;
};

type PresenceState = {
  /* Everybody in the workspace who is present, this device excluded. */
  others: Viewer[];
  /* Called by a thread when it opens. */
  setViewing: (conversationId: string | null) => void;

  /*
   * Called by a thread when it closes, naming itself.
   *
   * A stack mounts the next screen before it unmounts the last, so a plain
   * "stop viewing" from the old thread would arrive after the new one had
   * already said where it is -- and wipe it.
   */
  leaveViewing: (conversationId: string) => void;

  /*
   * Whether this device has an unsent reply in the open thread.
   *
   * The same rule the website publishes: a draft in the box means typing, an
   * empty box does not, and sending or leaving stops it at once. It is not
   * keypress-based -- only the change is published, so a fast typist does not
   * flood the channel.
   */
  setTyping: (typing: boolean) => void;
};

const Context = createContext<PresenceState>({
  others: [],
  setViewing: () => {},
  leaveViewing: () => {},
  setTyping: () => {},
});

export const usePresence = () => useContext(Context);

/* The same heartbeat the website keeps, so both age out at the same rate. */
const HEARTBEAT_MS = 15_000;

/*
 * Which of two payloads for the same person is the truth.
 *
 * The revision counts this device's own updates, so it settles the ordinary
 * case; the timestamp settles two devices. Equal on both means the later one
 * seen wins, which is why this returns true on a tie -- an exact draw used to
 * keep whichever key the socket listed first, and that could be the one the
 * person had already left.
 */
function atLeastAsNew(candidate: Viewer, current: Viewer) {
  const candidateRevision = candidate.revision ?? 0;
  const currentRevision = current.revision ?? 0;

  if (candidateRevision !== currentRevision) {
    return candidateRevision > currentRevision;
  }

  return (candidate.updated_at ?? "") >= (current.updated_at ?? "");
}

export function PresenceProvider({ children }: React.PropsWithChildren) {
  const { session } = useAuth();
  const { workspace, member } = useInbox();
  const account = useAccount();

  const [others, setOthers] = useState<Viewer[]>([]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const viewingRef = useRef<string | null>(null);
  const typingRef = useRef(false);
  const revisionRef = useRef(0);
  const keyRef = useRef<string | null>(null);

  const businessId = workspace?.businessId ?? null;
  const userId = session?.user.id ?? null;

  /*
   * What this device publishes. Rebuilt on every track so the timestamp and
   * the revision move -- the website orders by both when two payloads for the
   * same person arrive out of order.
   */
  const self = useCallback((): Viewer | null => {
    if (!userId) return null;

    revisionRef.current += 1;

    return {
      user_id: userId,
      member_id: member?.id ?? null,
      name: account.name ?? member?.full_name ?? "Teammate",
      email: account.email ?? member?.email ?? null,
      profile_picture_url: account.avatar ?? member?.profile_picture_url ?? null,
      conversation_id: viewingRef.current,
      is_typing: typingRef.current,
      availability: "online",
      revision: revisionRef.current,
      online_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }, [userId, member?.id, member?.full_name, member?.email, account.name, account.email, account.avatar]);

  /*
   * One track at a time, and each one reads the state as it is when its turn
   * comes rather than when it was asked for.
   *
   * Leaving one conversation and opening another fires two of these a
   * millisecond apart. Sent in parallel they can land out of order, and the
   * loser is whichever the server writes last -- so a teammate would sit on
   * the thread you had just left, invisible on the one you were actually in,
   * until the next heartbeat fifteen seconds later. That is the "sometimes it
   * does not update" and the "second conversation shows nobody".
   */
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const publishRef = useRef<() => Promise<void>>(async () => {});

  const publish = useCallback(() => {
    queueRef.current = queueRef.current.then(async () => {
      const payload = self();

      if (!channelRef.current || !payload) return;

      try {
        await channelRef.current.track(payload);
      } catch {
        /* A failed heartbeat is not worth a message on screen: the next one
           is fifteen seconds away, and presence going quiet is itself the
           truth. */
      }
    });

    return queueRef.current;
  }, [self]);

  publishRef.current = publish;

  const setViewing = useCallback(
    (conversationId: string | null) => {
      if (viewingRef.current === conversationId) return;

      viewingRef.current = conversationId;
      /* A draft belongs to the thread it was typed in, so leaving one stops
         typing on it rather than carrying the flag to the next. */
      typingRef.current = false;
      void publish();
    },
    [publish],
  );

  const leaveViewing = useCallback(
    (conversationId: string) => {
      if (viewingRef.current !== conversationId) return;

      viewingRef.current = null;
      typingRef.current = false;
      void publish();
    },
    [publish],
  );

  const setTyping = useCallback(
    (typing: boolean) => {
      if (typingRef.current === typing) return;

      typingRef.current = typing;
      void publish();
    },
    [publish],
  );

  useEffect(() => {
    if (!businessId || !userId) {
      setOthers([]);
      return;
    }

    let alive = true;
    let channel: RealtimeChannel | null = null;
    let beat: ReturnType<typeof setInterval> | undefined;

    /*
     * A presence key that outlives the app.
     *
     * It used to be minted on every mount, so every restart -- and every
     * reload in development -- arrived as a second device. Realtime keeps the
     * old key until it notices that socket has gone, which on a phone that
     * was backgrounded or lost signal takes a long minute, and for that whole
     * time the person existed twice: once where they are, and once where they
     * were. That ghost is what makes a teammate look stuck on the conversation
     * they opened first.
     *
     * Remembered, so the server replaces this device rather than adding one.
     */
    void (async () => {
      if (!keyRef.current) {
        const remembered = await sessionStorage.getItem(`presence.${userId}`);

        if (!alive) return;

        if (remembered) {
          keyRef.current = remembered;
        } else {
          const minted = `${userId}:${Math.random().toString(36).slice(2)}`;
          keyRef.current = minted;
          await sessionStorage.setItem(`presence.${userId}`, minted);
        }
      }

      if (!alive) return;

      const joined = supabase.channel(`tenh-presence:${businessId}`, {
        config: { private: true, presence: { key: keyRef.current } },
      });

      channel = joined;
      channelRef.current = joined;

      joined.on("presence", { event: "sync" }, () => {
        if (!alive) return;

        const state = joined.presenceState<Viewer>();
        const seen = new Map<string, Viewer>();

        for (const [key, entries] of Object.entries(state)) {
          if (key === keyRef.current) continue;

          for (const entry of entries) {
            if (!entry?.user_id || entry.user_id === userId) continue;

            const previous = seen.get(entry.user_id);

            /*
             * One row per person, newest wins -- and a tie goes to whichever
             * arrived later rather than to whichever the socket happened to
             * list first. Somebody with the website open and the app in their
             * hand is two presence keys and one teammate, and the thread they
             * are in is whichever they touched last.
             */
            if (!previous || atLeastAsNew(entry, previous)) {
              seen.set(entry.user_id, entry);
            }
          }
        }

        setOthers([...seen.values()]);
      });

      void joined.subscribe((status) => {
        if (status === "SUBSCRIBED") void publishRef.current();
      });

      beat = setInterval(() => void publishRef.current(), HEARTBEAT_MS);
    })();

    /*
     * A backgrounded app is not viewing anything. Android keeps the socket up
     * for a while, which would otherwise leave somebody's face on a thread
     * they put in their pocket ten minutes ago.
     */
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void publishRef.current();
        return;
      }

      viewingRef.current = null;
      typingRef.current = false;
      void publishRef.current();
    });

    return () => {
      alive = false;
      if (beat) clearInterval(beat);
      appState.remove();
      channelRef.current = null;

      if (channel) {
        void channel.untrack();
        void supabase.removeChannel(channel);
      }

      setOthers([]);
    };
    /*
     * Only the workspace and the person rebuild this socket. It used to
     * depend on the publisher as well, so anything that changed a name or a
     * photo tore the channel down and joined it again -- and for the second
     * or two that took, everybody on it saw nobody.
     */
  }, [businessId, userId]);

  return (
    <Context.Provider value={{ others, setViewing, leaveViewing, setTyping }}>
      {children}
    </Context.Provider>
  );
}

/* The teammates on one conversation, ready to draw. */
export function useViewers(conversationId: string | null | undefined) {
  const { others } = usePresence();

  if (!conversationId) return [];

  return others.filter(
    (viewer) => viewer.conversation_id === conversationId,
  );
}
