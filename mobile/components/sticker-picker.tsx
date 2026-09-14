import { useAuth } from "../lib/auth/provider";
import { readStickerRecents, rememberSticker, stickerRecentGeneration } from "../lib/sticker-recents";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { MetaStickerChoice, MetaStickerPack } from "../../lib/stickers/catalog";
import { TELEGRAM_STICKER_PACKS, type TelegramStickerChoice } from "../../lib/telegram/sticker-catalog";
import { cachedApi } from "../lib/api/client";
import { AuthImage } from "./auth-image";
import { Sheet, colors } from "./ui";

export type StickerChoice = MetaStickerChoice | TelegramStickerChoice;
const PAGE_SIZE = 30;
const MAX_ITEMS = 120;

// Catalog reads share the existing account/workspace cache: 4 MB, 100 entries,
// five minutes. Thumbnails use AuthImage's bounded disk cache, not prefetching.
export function StickerPicker({ conversationId, workspaceId, platform, onClose, onSend }: {
  conversationId: string; workspaceId: string; platform: string;
  onClose: () => void; onSend: (sticker: StickerChoice) => Promise<void>;
}) {
  const telegram = platform === "telegram";
  const { session } = useAuth();
  const userId = session?.user.id;
  const [recent, setRecent] = useState<StickerChoice[]>([]);
  const [packs, setPacks] = useState<MetaStickerPack[]>([]);
  const [pack, setPack] = useState("recent");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<StickerChoice[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const params = { conversationId };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let current = true;
    if (userId) void readStickerRecents(userId, workspaceId, platform, conversationId).then(items => { if (current) setRecent(items); });
    return () => { current = false; };
  }, [userId, workspaceId, platform, conversationId]);

  useEffect(() => {
    if (telegram) return;
    let current = true;
    setBusy(true); setError("");
    const accept = (data: { packs: MetaStickerPack[] }) => {
      if (!current) return;
      const next = (data.packs ?? []).slice(0, 100);
      setPacks(next); setPack(value => value || next[0]?.packId || "");
    };
    void cachedApi<{ packs: MetaStickerPack[] }>(`/api/facebook/stickers/packs?${new URLSearchParams(params)}`, workspaceId,
      { freshMs: 5 * 60_000, onCached: accept }).then(accept).catch(e => {
        if (current) setError(e instanceof Error ? e.message : "Unable to load sticker packs.");
      }).finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [conversationId, workspaceId, telegram, reload]);

  useEffect(() => {
    const q = query.trim().slice(0, 80);
    if ((!pack || pack === "recent") && q.length < 2) { setItems([]); setBusy(false); setError(""); setVisible(PAGE_SIZE); return; }
    let current = true;
    setVisible(PAGE_SIZE); setItems([]); setError(""); setBusy(true);
    const accept = (data: { stickers: StickerChoice[] }) => {
      if (current) { setItems((data.stickers ?? []).slice(0, MAX_ITEMS)); setBusy(false); }
    };
    const timer = setTimeout(() => {
      const path = telegram ? `/api/telegram/stickers?${new URLSearchParams({ ...params, set: pack })}`
        : `/api/facebook/stickers/${q.length >= 2 ? "search" : "pack"}?${new URLSearchParams({ ...params, ...(q.length >= 2 ? { q } : { packId: pack }) })}`;
      void cachedApi<{ stickers: StickerChoice[] }>(path, workspaceId, { freshMs: q.length >= 2 ? 60_000 : 5 * 60_000, onCached: accept })
        .then(accept).catch(e => { if (current) setError(e instanceof Error ? e.message : "Unable to load stickers."); })
        .finally(() => { if (current) setBusy(false); });
    }, q.length >= 2 ? 400 : 0);
    return () => { current = false; clearTimeout(timer); };
  }, [conversationId, workspaceId, pack, query, telegram, reload]);

  async function send(item: StickerChoice) {
    if (inFlight.current) return;
    inFlight.current = true; setSending(item.stickerId); setError("");
    const generation = stickerRecentGeneration();
    try {
      await onSend(item);
      if (userId) await rememberSticker(userId, workspaceId, platform, item, generation);
    }
    catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Unable to send sticker."); }
    finally { inFlight.current = false; if (alive.current) setSending(null); }
  }
  const recentSelected = pack === "recent" && query.trim().length < 2;
  const displayed = recentSelected ? recent : items;
  const packTabs = telegram ? TELEGRAM_STICKER_PACKS.map(item => ({ id: item.name, name: `${item.icon} ${item.title}` }))
    : packs.map(item => ({ id: item.packId, name: item.name }));
  const tabs = [{ id: "recent", name: "Recently Used" }, ...packTabs];
  return <Sheet open title="Stickers" detail="Tap a sticker to send" onClose={() => { if (!inFlight.current) onClose(); }}>
    <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
      {!telegram ? <TextInput accessibilityLabel="Search stickers" placeholder="Search stickers…" value={query} onChangeText={setQuery} maxLength={80}
        style={{ backgroundColor: colors.pale, padding: 12, borderRadius: 12, color: colors.ink }} /> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 10 }}>
        {tabs.map(tab => <Pressable key={tab.id} onPress={() => { setQuery(""); setPack(tab.id); }} style={{ padding: 10, borderRadius: 12, marginRight: 6, backgroundColor: pack === tab.id ? colors.pale : "white" }}>
          <Text style={{ color: pack === tab.id ? colors.blue : colors.ink }}>{tab.name}</Text>
        </Pressable>)}
      </ScrollView>
      {error ? <View><Text style={{ color: "#b42318" }}>{error}</Text><Pressable onPress={() => setReload(value => value + 1)} style={{ paddingVertical: 8 }}><Text style={{ color: colors.blue }}>Reload stickers</Text></Pressable></View> : null}
      <FlatList style={{ height: 280 }} data={displayed.slice(0, visible)} numColumns={3} keyExtractor={item => `${"setName" in item ? item.setName : "meta"}:${item.stickerId}`}
        initialNumToRender={12} maxToRenderPerBatch={12} windowSize={3}
        renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Send ${item.label}`} disabled={sending !== null} onPress={() => void send(item)} style={{ width: "33.333%", height: 94, padding: 8, alignItems: "center", justifyContent: "center" }}>
          {sending === item.stickerId ? <ActivityIndicator color={colors.blue} /> : item.previewUrl ? <AuthImage uri={item.previewUrl} resizeMode="contain" style={{ width: "100%", height: 78 }} /> : <Text>{item.label}</Text>}
        </Pressable>}
        ListEmptyComponent={!recentSelected && busy ? <ActivityIndicator color={colors.blue} /> : <Text style={{ color: colors.muted, padding: 16 }}>{recentSelected ? "Your sent stickers will appear here." : "No stickers found."}</Text>}
        ListFooterComponent={visible < displayed.length ? <Pressable onPress={() => setVisible(value => Math.min(value + PAGE_SIZE, MAX_ITEMS))} style={{ padding: 14 }}><Text style={{ textAlign: "center", color: colors.blue }}>Load 30 more</Text></Pressable> : null}
      />
    </View>
  </Sheet>;
}
