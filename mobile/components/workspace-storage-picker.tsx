import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Pending } from "./composer";
import { AuthImage } from "./auth-image";
import { Sheet, colors } from "./ui";
import { ApiError } from "../lib/api/client";
import { favoriteStorageFile, loadStorage, prepareStorageDraft, type StorageScope } from "../lib/workspace-storage-api";
import { STORAGE_WINDOW_LIMIT, type WorkspaceStorageFile, type WorkspaceStorageSnapshot, type WorkspaceStorageView } from "../lib/workspace-storage";

const empty: WorkspaceStorageSnapshot = { files: [], categories: [], canManage: false, organizationAvailable: false };

export function WorkspaceStoragePicker({ scope, room, onDraft, onClose }: {
  scope: StorageScope; room: number; onDraft: (files: Pending[]) => boolean; onClose: () => void;
}) {
  const scopeKey = JSON.stringify(scope);
  const controller = useRef<AbortController | null>(null);
  const flight = useRef(false);
  const [snapshot, setSnapshot] = useState(empty);
  const [canDraft, setCanDraft] = useState(false);
  const [view, setView] = useState<WorkspaceStorageView>("recent");
  const [kind, setKind] = useState<"media" | "files">("media");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<WorkspaceStorageFile[]>([]);
  const selectedRef = useRef<WorkspaceStorageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [trimmed, setTrimmed] = useState(false);
  const filterKey = JSON.stringify([scopeKey, view, kind, query.trim(), reload]);
  const owner = useRef({ key: filterKey, active: true, sequence: 0 });
  if (owner.current.key !== filterKey) owner.current = { key: filterKey, active: true, sequence: owner.current.sequence + 1 };
  const priorScope = useRef(scopeKey);
  function choose(files: WorkspaceStorageFile[]) { selectedRef.current = files; setSelected(files); }

  function begin() {
    if (!owner.current.active || owner.current.key !== filterKey) {
      const aborted = new AbortController(); aborted.abort();
      return { signal: aborted.signal, owns: () => false };
    }
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const sequence = ++owner.current.sequence;
    return { signal: abort.signal, owns: () => owner.current.active && owner.current.key === filterKey && owner.current.sequence === sequence && !abort.signal.aborted };
  }
  function close() {
    if (!owner.current.active || owner.current.key !== filterKey) return;
    owner.current.active = false; owner.current.sequence++;
    controller.current?.abort(); onClose();
  }
  function failure(cause: unknown) {
    if (cause instanceof ApiError && [401, 403, 409].includes(cause.status)) {
      setSnapshot(empty); choose([]); setCanDraft(false); setHasMore(false); setCursor(null);
    }
    setError(cause instanceof Error ? cause.message : "Unable to open Storage.");
  }
  useEffect(() => {
    owner.current.active = true;
    const request = begin();
    if (priorScope.current !== scopeKey) { choose([]); priorScope.current = scopeKey; }
    setLoading(true); setBusy(false); flight.current = false; setError(""); setSnapshot(current => ({ ...current, files: [] })); setCanDraft(false); setHasMore(false); setCursor(null); setTrimmed(false);
    const timer = setTimeout(() => { void loadStorage(scope, request.signal, { view, kind, query }).then(result => {
      if (!request.owns()) return;
      setSnapshot(result.snapshot); setCanDraft(result.canDraft);
      setHasMore(result.hasMore); setCursor(result.nextCursor);
      if (!result.snapshot.organizationAvailable) setView("recent");
    }).catch(cause => { if (request.owns()) failure(cause); })
      .finally(() => { if (request.owns()) setLoading(false); }); }, query.trim() ? 300 : 0);
    return () => { clearTimeout(timer); owner.current.active = false; owner.current.sequence++; controller.current?.abort(); };
  }, [filterKey]);

  function toggle(file: WorkspaceStorageFile) {
    if (flight.current || !canDraft || owner.current.key !== filterKey || !owner.current.active) return;
    const current = selectedRef.current;
    if (!current.some(item => item.id === file.id) && current.length >= Math.min(30, room)) { setError("The draft has no room for more attachments. Remove an item first."); return; }
    choose(current.some(item => item.id === file.id) ? current.filter(item => item.id !== file.id) : [...current, file]);
  }
  async function loadMore() {
    if (flight.current || loading || !hasMore || !cursor || owner.current.key !== filterKey || !owner.current.active) return;
    flight.current = true; setBusy(true); setError("");
    const request = begin();
    try {
      const result = await loadStorage(scope, request.signal, { view, kind, query, cursor });
      if (!request.owns()) return;
      const combined = [...new Map([...snapshot.files, ...result.snapshot.files].map(file => [file.id, file])).values()];
      if (combined.length > STORAGE_WINDOW_LIMIT) setTrimmed(true);
      setSnapshot({ ...result.snapshot, files: combined.slice(-STORAGE_WINDOW_LIMIT) });
      setCanDraft(result.canDraft); setHasMore(result.hasMore); setCursor(result.nextCursor);
    } catch (cause) { if (request.owns()) failure(cause); }
    finally { if (request.owns()) { flight.current = false; setBusy(false); } }
  }
  async function favorite(file: WorkspaceStorageFile) {
    if (flight.current || loading || !owner.current.active || owner.current.key !== filterKey) return;
    flight.current = true; setBusy(true); setError("");
    const request = begin();
    try {
      await favoriteStorageFile(scope, file, request.signal);
      if (request.owns()) {
        setSnapshot(current => ({ ...current, files: current.files.map(item => item.id === file.id ? { ...item, favorite: !file.favorite } : item).filter(item => view !== "favorites" || item.favorite) }));
        choose(selectedRef.current.map(item => item.id === file.id ? { ...item, favorite: !file.favorite } : item));
      }
    } catch (cause) { if (request.owns()) failure(cause); }
    finally { if (request.owns()) { flight.current = false; setBusy(false); } }
  }
  async function stage() {
    if (flight.current || !canDraft || !selectedRef.current.length || !owner.current.active || owner.current.key !== filterKey) return;
    flight.current = true; setBusy(true); setError("");
    const request = begin();
    let staged: Awaited<ReturnType<typeof prepareStorageDraft>> | undefined;
    let accepted = false;
    try {
      staged = await prepareStorageDraft(scope, selectedRef.current, room, request.signal, request.owns);
      if (request.owns()) accepted = onDraft(staged.pending);
      if (accepted) close();
      else if (request.owns()) throw new Error("The draft changed. Reopen Storage and choose fewer files.");
    } catch (cause) { if (request.owns()) failure(cause); }
    finally {
      if (staged && !accepted) staged.discard();
      if (request.owns()) { flight.current = false; setBusy(false); }
    }
  }
  const tabs: { id: WorkspaceStorageView; name: string }[] = [{ id: "recent", name: "Recent" }, ...(snapshot.organizationAvailable ? [
    { id: "favorites" as const, name: "Favorites" }, ...snapshot.categories.map(category => ({ id: `category:${category.id}` as const, name: category.name })),
  ] : [])];
  return <Sheet open title="Storage" detail="Shared with everyone in this workspace" heightPercent={88} onClose={close}>
    <View style={{ flex: 1, paddingHorizontal: 14, gap: 10 }}>
      <TextInput accessibilityLabel="Search Storage" placeholder="Search file names" value={query} onChangeText={setQuery} maxLength={120} editable={!busy}
        style={{ backgroundColor: colors.pale, padding: 12, borderRadius: 12, color: colors.ink }} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
        {tabs.map(tab => <Pressable key={tab.id} accessibilityRole="button" accessibilityState={{ selected: view === tab.id }} disabled={busy} onPress={() => setView(tab.id)} style={{ padding: 12, borderRadius: 12, marginRight: 6, backgroundColor: view === tab.id ? colors.pale : "white" }}>
          <Text style={{ color: view === tab.id ? colors.blue : colors.ink }}>{tab.name}</Text>
        </Pressable>)}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["media", "files"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: kind === value }} disabled={busy} onPress={() => setKind(value)} style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: kind === value ? colors.pale : "white" }}>
          <Text style={{ color: kind === value ? colors.blue : colors.ink, textAlign: "center" }}>{value === "media" ? "Photos & videos" : "Files"}</Text>
        </Pressable>)}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: "#b42318" }}>{error}</Text> : null}
      {!loading && !canDraft && !error ? <Text style={{ color: colors.muted }}>You can browse Storage. Reply permission is required to add files to a draft.</Text> : null}
      <FlatList data={snapshot.files} keyExtractor={file => file.id} style={{ flex: 1 }} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={3}
        renderItem={({ item }) => <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Select ${item.name}`} accessibilityState={{ selected: selected.some(file => file.id === item.id), disabled: busy || !canDraft }} disabled={busy || !canDraft} onPress={() => toggle(item)} style={{ flex: 1, flexDirection: "row", alignItems: "center", padding: 10, gap: 10, backgroundColor: selected.some(file => file.id === item.id) ? colors.pale : "white" }}>
            {item.kind === "image" && item.previewUrl ? <AuthImage uri={item.previewUrl} resizeMode="cover" style={{ width: 56, height: 56, borderRadius: 8 }} /> : <Ionicons name={item.kind === "video" ? "videocam-outline" : item.kind === "audio" ? "musical-notes-outline" : "document-outline"} size={28} color={colors.blue} style={{ width: 56, textAlign: "center" }} />}
            <View style={{ flex: 1 }}><Text numberOfLines={2} style={{ color: colors.ink }}>{item.name}</Text><Text style={{ color: colors.muted, fontSize: 12 }}>{(item.sizeBytes / 1024 / 1024).toFixed(1)} MB{selected.some(file => file.id === item.id) ? " · Selected" : ""}</Text></View>
          </Pressable>
          {snapshot.organizationAvailable ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.favorite ? "Remove from" : "Add to"} favorites: ${item.name}`} accessibilityState={{ selected: item.favorite }} disabled={busy} onPress={() => void favorite(item)} style={{ padding: 14 }}>
            <Ionicons name={item.favorite ? "heart" : "heart-outline"} color={colors.blue} size={23} />
          </Pressable> : null}
        </View>}
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.blue} style={{ padding: 24 }} /> : <Text style={{ color: colors.muted, padding: 20 }}>{error ? "Storage could not be loaded." : query.trim() ? "No matching files." : view === "favorites" ? "No favorite files yet." : "No files in this view."}</Text>}
        ListFooterComponent={hasMore ? <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => void loadMore()} style={{ padding: 16 }}><Text style={{ color: colors.blue, textAlign: "center" }}>{busy ? "Loading…" : "Load more files"}</Text></Pressable> : null} />
      {trimmed ? <Text style={{ color: colors.muted, fontSize: 12 }}>Earlier loaded files are available after Reload. Selected files are kept.</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable accessibilityRole="button" disabled={busy || loading} onPress={() => setReload(current => current + 1)} style={{ padding: 12 }}><Text style={{ color: colors.blue }}>Reload</Text></Pressable>
        <Text style={{ flex: 1, color: colors.muted }}>{selected.length} selected</Text>
        <Pressable accessibilityRole="button" disabled={busy || loading || !canDraft || !selected.length || selected.length > room} onPress={() => void stage()} style={{ padding: 14, borderRadius: 12, backgroundColor: colors.blue, opacity: busy || !canDraft || !selected.length || selected.length > room ? 0.4 : 1 }}>
          <Text style={{ color: "white", fontWeight: "700" }}>{busy ? "Preparing…" : "Add to draft"}</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={close} style={{ padding: 10 }}><Text style={{ color: colors.muted, textAlign: "center" }}>{busy ? "Cancel" : "Close"}</Text></Pressable>
    </View>
  </Sheet>;
}
