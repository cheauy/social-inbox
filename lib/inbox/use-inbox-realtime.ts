"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export type InboxRealtimeTable = "messages" | "conversations" | "conversation_activity";
export type InboxRealtimeEventType = "INSERT" | "UPDATE" | "DELETE";
export type InboxRealtimeEvent = {
  table: InboxRealtimeTable;
  eventType: InboxRealtimeEventType;
  newRow: Record<string, unknown>;
  oldRow: Record<string, unknown>;
};
type Input = {
  businessIds: string[];
  onRealtimeEvent: (event: InboxRealtimeEvent) => void;
  onFallbackRefresh?: () => void;
  onScopeChanged?: () => void;
  onConnectionState?: (healthy: boolean) => void;
};

export function useInboxRealtime(input: Input) {
  const callbacks = useRef(input);
  useEffect(() => { callbacks.current = input; }, [input]);
  const businessIdsKey = [...new Set(input.businessIds.map(id => id.trim()).filter(Boolean))].sort().join("|");

  useEffect(() => {
    const businessIds = businessIdsKey ? businessIdsKey.split("|") : [];
    callbacks.current.onConnectionState?.(false);
    if (!businessIds.length) return;
    const supabase = createClient();
    const channels: ReturnType<typeof supabase.channel>[] = [];
    const ready = new Set<string>();
    let cancelled = false;
    let starting = false;
    let generation = 0;
    let authUserId: string | null = null;
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;

    function resync() {
      if (cancelled || recoveryTimer) return;
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        if (!cancelled) callbacks.current.onFallbackRefresh?.();
      }, 300);
    }
    function emit(table: InboxRealtimeTable, payload: { eventType: string; new: unknown; old: unknown }) {
      if (cancelled) return;
      callbacks.current.onRealtimeEvent({ table, eventType: payload.eventType as InboxRealtimeEventType,
        newRow: (payload.new ?? {}) as Record<string, unknown>, oldRow: (payload.old ?? {}) as Record<string, unknown> });
      if (table === "conversations" && payload.eventType === "INSERT") resync();
    }
    async function start() {
      if (cancelled || starting || channels.length) return;
      starting = true;
      const epoch = generation;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (cancelled || epoch !== generation || error || !data.session?.access_token) { resync(); return; }
        await supabase.realtime.setAuth(data.session.access_token);
        if (cancelled || epoch !== generation) return;
        authUserId = data.session.user?.id ?? null;
        for (const businessId of businessIds) {
          const filter = `business_id=eq.${businessId}`;
          // Optional subscription/activity tables must not prevent the core
          // message stream from joining when their publication is missing.
          const core = supabase.channel(`tenh-inbox-v3-${businessId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter }, payload => { if (epoch === generation) emit("messages", payload); })
            .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter }, payload => { if (epoch === generation) emit("conversations", payload); })
            .subscribe((status) => {
              if (cancelled || epoch !== generation) return;
              if (status === "SUBSCRIBED") ready.add(businessId); else ready.delete(businessId);
              callbacks.current.onConnectionState?.(ready.size === businessIds.length);
              // A reconnect does not replay messages sent while disconnected.
              // Also reconcile the initial subscription gap after server render.
              resync();
            });
          channels.push(core);
          const context = supabase.channel(`tenh-inbox-context-${businessId}`)
            .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_activity", filter }, payload => { if (epoch === generation) emit("conversation_activity", payload); })
            .on("postgres_changes", { event: "*", schema: "public", table: "business_subscriptions", filter }, () => { if (!cancelled && epoch === generation) (callbacks.current.onScopeChanged ?? callbacks.current.onFallbackRefresh)?.(); })
            .on("postgres_changes", { event: "*", schema: "public", table: "team_members", filter }, () => { if (!cancelled && epoch === generation) (callbacks.current.onScopeChanged ?? callbacks.current.onFallbackRefresh)?.(); })
            .on("postgres_changes", { event: "*", schema: "public", table: "social_accounts", filter }, () => { if (!cancelled && epoch === generation) (callbacks.current.onScopeChanged ?? callbacks.current.onFallbackRefresh)?.(); })
            .subscribe();
          channels.push(context);
        }
      } catch {
        if (!cancelled) { callbacks.current.onConnectionState?.(false); resync(); }
      } finally { if (epoch === generation) starting = false; }
    }
    void start();
    const { data: auth } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (!session?.access_token || (authUserId && session.user?.id && session.user.id !== authUserId)) {
        generation += 1;
        starting = false;
        authUserId = null;
        for (const channel of channels.splice(0)) void supabase.removeChannel(channel);
        ready.clear();
        callbacks.current.onConnectionState?.(false);
        resync();
        if (!session?.access_token) return;
      }
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "INITIAL_SESSION") {
        // Do not await an auth operation inside Supabase's auth callback.
        const epoch = generation;
        void Promise.resolve().then(async () => {
          if (cancelled || epoch !== generation) return;
          await supabase.realtime.setAuth(session.access_token);
          if (cancelled || epoch !== generation) return;
          await start(); // covers a session that was not ready on first mount
          resync();
        }).catch(() => { if (!cancelled) { callbacks.current.onConnectionState?.(false); resync(); } });
      }
    });
    const resume = () => { void start(); resync(); };
    const visible = () => { if (document.visibilityState === "visible") resume(); };
    if (typeof window !== "undefined") {
      window.addEventListener("online", resume);
      window.addEventListener("focus", resume);
    }
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      generation += 1;
      callbacks.current.onConnectionState?.(false);
      if (recoveryTimer) clearTimeout(recoveryTimer);
      auth.subscription.unsubscribe();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visible);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", resume);
        window.removeEventListener("focus", resume);
      }
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [businessIdsKey]);
}
