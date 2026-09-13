"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InboxConversation } from "@/types/inbox";
export const FACEBOOK_BLOCK_CHANGED = "tenh:facebook-block-changed";
type State = { is_blocked: boolean; block_mode?: "messages" | "page"; updated_by_name?: string | null; operation_id?: string | null };
export function useFacebookBlock(conversation: InboxConversation | null) {
  const id = conversation?.id ?? ""; const businessId = conversation?.business_id ?? "";
  const page = conversation?.social_account?.id; const contact = conversation?.contact?.id;
  const enabled = conversation?.social_account?.platform === "facebook" && Boolean(contact);
  const [value, setValue] = useState<{ id: string; state: State | null; available: boolean }>({ id: "", state: null, available: true });
  const sequence = useRef(0); const liveId = useRef(id); liveId.current = id;
  const refresh = useCallback(async () => {
    if (!enabled || !id) return;
    const seq = ++sequence.current;
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}/facebook-block`, { cache: "no-store" }); const data = await response.json();
      if (sequence.current === seq && liveId.current === id) {
        if (response.ok && data.success) setValue({ id, state: data.state, available: data.available && data.modesAvailable !== false });
        else setValue(previous => ({ id, state: previous.id === id ? previous.state : null, available: false }));
      }
    } catch {
      if (sequence.current === seq && liveId.current === id) {
        setValue(previous => ({ id, state: previous.id === id ? previous.state : null, available: false }));
      }
    }
  }, [id, enabled]);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener(FACEBOOK_BLOCK_CHANGED, changed); window.addEventListener("focus", changed);
    const db = createClient();
    const channel = db.channel(`facebook-block:${id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "facebook_customer_blocks", filter: `business_id=eq.${businessId}` }, payload => {
        const row = payload.new as Record<string, unknown>;
        if (row.contact_id === contact && row.social_account_id === page) void refresh();
      }).subscribe();
    return () => { sequence.current++; window.removeEventListener(FACEBOOK_BLOCK_CHANGED, changed); window.removeEventListener("focus", changed); void db.removeChannel(channel); };
  }, [enabled, id, businessId, page, contact, refresh]);
  const state = value.id === id ? value.state : null;
  return { blocked: Boolean(enabled && state?.is_blocked), mode: state?.block_mode ?? "messages", loaded: value.id === id,
    available: value.id === id && value.available, actorName: state?.updated_by_name ?? null, refresh };
}
