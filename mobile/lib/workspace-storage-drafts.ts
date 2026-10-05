import { Directory, File, Paths } from "expo-file-system";
import { supabase } from "./supabase/client";
import type { Pending } from "../components/composer";
import type { StorageScope } from "./workspace-storage-api";

type Entry = { owner: string; userId: string; directory: Directory; attached: boolean; files: Map<string, { pending: Pending; state: "draft" | "sending" | "uncertain" }> };
const entries = new Set<Entry>();
let watched = false;
let activeUser: string | null = null;
export const storageDraftRoot = () => new Directory(Paths.cache, "tenh-storage-drafts");
export const storageDraftOwner = (scope: StorageScope) => JSON.stringify([scope.userId, scope.workspaceId, scope.memberId, scope.conversationId]);

function remove(entry: Entry, key: string) {
  const file = entry.files.get(key);
  if (!file) return;
  try { const owned = new File(file.pending.uri); if (owned.exists) owned.delete(); } catch { /* Already evicted by the OS. */ }
  entry.files.delete(key);
  if (!entry.files.size) {
    try { if (entry.directory.exists) entry.directory.delete(); } catch { /* Already evicted. */ }
    entries.delete(entry);
  }
}
export function clearOwnedStorageDrafts() {
  // This fixed namespace contains only copies created by Storage, never
  // document-picker originals or the shared message-media cache.
  const root = storageDraftRoot();
  try { if (root.exists) root.delete(); } catch { /* OS cache eviction. */ }
  entries.clear();
}
function watchAuth(userId: string) {
  if (activeUser && activeUser !== userId) clearOwnedStorageDrafts();
  activeUser = userId;
  if (watched) return;
  watched = true;
  supabase.auth.onAuthStateChange((event, session) => {
    const next = session?.user.id ?? null;
    if (event === "SIGNED_OUT" || (activeUser && next !== activeUser)) clearOwnedStorageDrafts();
    activeUser = next;
  });
}
export function registerStorageDraft(scope: StorageScope, pending: Pending[], directory: Directory) {
  const root = storageDraftRoot().uri.replace(/\/$/, "") + "/";
  if (!directory.uri.startsWith(root) || pending.some(file => !file.uri.startsWith(directory.uri.replace(/\/$/, "") + "/"))) throw new Error("Invalid Storage draft ownership.");
  if (watched && activeUser !== scope.userId) throw new Error("Storage draft account changed before staging completed.");
  watchAuth(scope.userId);
  const entry: Entry = { owner: storageDraftOwner(scope), userId: scope.userId, directory, attached: true, files: new Map(pending.map(file => [file.key, { pending: file, state: "draft" }])) };
  entries.add(entry);
  return () => { for (const key of [...entry.files.keys()]) remove(entry, key); };
}
export function attachStorageDrafts(scope: StorageScope) {
  watchAuth(scope.userId);
  const owner = storageDraftOwner(scope), recovered: Pending[] = [];
  for (const entry of entries) if (entry.owner === owner) {
    entry.attached = true;
    for (const file of entry.files.values()) if (file.state === "uncertain") recovered.push({ ...file.pending, deliveryUnknown: true, error: "Delivery is unknown. Verify the thread before removing this item." });
  }
  return recovered;
}
export function reconcileStorageDrafts(owner: string, pending: Pending[]) {
  const kept = new Map(pending.map(file => [file.key, file]));
  for (const entry of [...entries]) if (entry.owner === owner) for (const [key, file] of [...entry.files]) {
    const held = kept.get(key);
    if (held) { file.pending = held; if (held.deliveryUnknown) file.state = "uncertain"; }
    else if (file.state === "draft") remove(entry, key);
  }
}
export function removeStorageDraftFile(owner: string, key: string) {
  for (const entry of [...entries]) if (entry.owner === owner) remove(entry, key);
}
export function clearStorageDraftOwner(owner: string) {
  for (const entry of [...entries]) if (entry.owner === owner) for (const key of [...entry.files.keys()]) remove(entry, key);
}
export function detachStorageDrafts(owner: string) {
  for (const entry of [...entries]) if (entry.owner === owner) {
    entry.attached = false;
    for (const [key, file] of [...entry.files]) if (file.state === "draft") remove(entry, key);
  }
}
export function beginStorageDraftSend(owner: string, pending: Pending[]) {
  const keys = new Set(pending.map(file => file.key));
  for (const entry of entries) if (entry.owner === owner) for (const [key, file] of entry.files) if (keys.has(key)) file.state = "sending";
}
export function finishStorageDraftSend(owner: string, confirmed: Set<string>, uncertain: Set<string>, pending: Pending[]) {
  const kept = new Map(pending.map(file => [file.key, file]));
  for (const entry of [...entries]) if (entry.owner === owner) for (const [key, file] of [...entry.files]) {
    if (confirmed.has(key)) remove(entry, key);
    else if (uncertain.has(key) || kept.get(key)?.deliveryUnknown) { file.state = "uncertain"; file.pending = { ...file.pending, deliveryUnknown: true }; }
    else if (file.state === "sending") {
      if (entry.attached && kept.has(key)) { file.state = "draft"; file.pending = kept.get(key)!; }
      else remove(entry, key);
    }
  }
}
