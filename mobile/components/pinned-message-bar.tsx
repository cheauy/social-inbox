import { useEffect, useMemo, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { InboxMessage } from "../lib/types";
import { getMessagePin, getMessageSummary, isMessagePinned } from "../../lib/inbox/message-actions";
import { api } from "../lib/api/client";
import { colors } from "./ui";

export function PinnedMessageBar({ conversationId, workspaceId, messages, updated, busy, onJump, onUnpin }: {
  conversationId: string; workspaceId?: string | null; messages: InboxMessage[];
  updated: InboxMessage[]; busy: boolean; onJump: (message: InboxMessage) => void; onUnpin: (message: InboxMessage) => void;
}) {
  const [stored, setStored] = useState<InboxMessage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    let request = 0;
    const refresh = async () => {
      const sequence = ++request;
      try {
        const result = await api<{ pins: InboxMessage[]; truncated?: boolean }>(`/api/conversations/${encodeURIComponent(conversationId)}/message-pins`, workspaceId);
        if (!alive || sequence !== request) return;
        setStored((result.pins ?? []).filter(row => row.conversation_id === conversationId).slice(0, 100));
        setError(result.truncated ? "Showing the first 100 pins." : "");
      } catch {
        if (alive && sequence === request) setError("Unable to load pins. Tap to retry.");
      }
    };
    void refresh();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void refresh(); });
    return () => { alive = false; subscription.remove(); };
  }, [conversationId, workspaceId, retry]);
  const pins = useMemo(() => {
    const merged = new Map<string, InboxMessage>();
    for (const row of [...stored, ...messages, ...updated]) {
      if (row.conversation_id !== conversationId) continue;
      const prior = merged.get(row.id);
      if (!prior || String(getMessagePin(row).updated_at ?? "") >= String(getMessagePin(prior).updated_at ?? "")) merged.set(row.id, row);
    }
    return [...merged.values()].filter(isMessagePinned).sort((a, b) =>
      String(getMessagePin(b).updated_at ?? "").localeCompare(String(getMessagePin(a).updated_at ?? ""))).slice(0, 100);
  }, [stored, messages, updated, conversationId]);
  const index = Math.max(0, pins.findIndex(row => row.id === selected));
  const pin = pins[index];
  return <>
    {pin ? <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.pale, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 14, paddingVertical: 9 }}>
      <Ionicons name="bookmark" size={19} color={colors.blue} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Jump to pinned message: ${getMessageSummary(pin)}`} onPress={() => onJump(pin)} style={{ flex: 1, borderLeftWidth: 2, borderLeftColor: colors.blue, paddingLeft: 9 }}>
        <Text style={{ color: colors.blue, fontSize: 12, fontWeight: "600" }}>Pinned message{pins.length > 1 ? ` · ${index + 1}/${pins.length}` : ""}</Text>
        <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13 }}>{getMessageSummary(pin)}</Text>
      </Pressable>
      {pins.length > 1 ? <Pressable accessibilityRole="button" accessibilityLabel="Next pinned message" hitSlop={10} onPress={() => setSelected(pins[(index + 1) % pins.length].id)}><Ionicons name="chevron-down" size={20} color={colors.blue} /></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Unpin message" disabled={busy} onPress={() => onUnpin(pin)} hitSlop={8}><Text style={{ color: colors.muted, fontSize: 12 }}>{busy ? "Saving…" : "Unpin"}</Text></Pressable>
    </View> : null}
    {error ? <Pressable onPress={() => setRetry(value => value + 1)}><Text style={{ color: colors.muted, padding: 8, fontSize: 12 }}>{error}</Text></Pressable> : null}
  </>;
}
