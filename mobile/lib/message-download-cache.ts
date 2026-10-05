import { Directory, File, Paths } from "expo-file-system";

export const MESSAGE_DOWNLOAD_POLICY = {
  maxFiles: 32,
  maxBytes: 100 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  shareGraceMs: 48 * 60 * 60 * 1000,
} as const;
type Phase = "download" | "ready" | "shared";
export type MessageDownloadLease = { file: File; meta: File; operationId: string; phase: Phase; generation: number; until: number; released?: boolean };
type Entry = { file: File | null; meta: File | null; phase: Phase | "legacy"; until: number; bytes: number; uri: string };
const active = new Map<string, MessageDownloadLease>();
let generation = 0;
const folder = () => new Directory(Paths.cache, "tenh-downloads");
const metadataFolder = () => new Directory(folder(), ".leases");
const expires = (file: File) => (file.modificationTime ?? Date.now()) + MESSAGE_DOWNLOAD_POLICY.shareGraceMs;
const metadataId = (meta: File) => /^([a-z0-9-]{1,80})(?:\.(?:download|ready|shared)\.\d+)?\.json$/i.exec(meta.name)?.[1] ?? null;
const rank = (phase: Entry["phase"]) => ({ legacy: 0, download: 1, ready: 2, shared: 3 })[phase];

function entries(): Entry[] {
  const root = folder(), byUri = new Map<string, Entry>();
  if (root.exists) for (const file of root.list()) {
    if (file instanceof File) byUri.set(file.uri, { file, meta: null, phase: "legacy", until: expires(file), bytes: Math.max(0, file.size ?? 0), uri: file.uri });
  }
  const metadata = metadataFolder();
  const merge = (file: File, meta: File, phase: Entry["phase"], until: number) => {
    const prior = byUri.get(file.uri);
    const nextPhase = prior && rank(prior.phase) > rank(phase) ? prior.phase : phase;
    byUri.set(file.uri, { file, meta, phase: nextPhase, until: Math.max(prior?.until ?? 0, until),
      bytes: nextPhase === "download" ? Math.max(MESSAGE_DOWNLOAD_POLICY.maxFileBytes, file.size ?? 0) : Math.max(0, file.size ?? 0), uri: file.uri });
  };
  if (metadata.exists) for (const meta of metadata.list()) {
    if (!(meta instanceof File)) continue;
    try {
      const data = JSON.parse(meta.textSync()) as { fileName?: unknown; phase?: unknown; until?: unknown };
      if (typeof data.fileName !== "string" || !data.fileName || data.fileName.length > 250 || /[\/\\]/.test(data.fileName) ||
        !["download", "ready", "shared"].includes(String(data.phase)) || typeof data.until !== "number" || !Number.isFinite(data.until)) throw new Error("Invalid download metadata");
      const operationId = metadataId(meta);
      if (!operationId || !data.fileName.startsWith(operationId + "-")) throw new Error("Mismatched download metadata");
      const file = new File(root, data.fileName), phase = data.phase as Phase;
      const until = Math.min(data.until, expires(meta));
      merge(file, meta, phase, until);
    } catch {
      // A partial immutable record never replaces the previous valid record.
      // Its filename still identifies the operation: protect the CONTENT, not
      // just the broken JSON, for a conservative grace from the failed write.
      const operationId = metadataId(meta);
      const files = [...byUri.values()].flatMap(entry => entry.file && (!operationId || entry.file.name.startsWith(operationId + "-")) ? [entry.file] : []);
      for (const file of files) merge(file, meta, "shared", expires(meta));
      if (!files.length) byUri.set(meta.uri, { file: null, meta, phase: "legacy", until: expires(meta), bytes: 0, uri: meta.uri });
    }
  }
  for (const lease of active.values()) byUri.set(lease.file.uri, { file: lease.file, meta: lease.meta, phase: lease.phase, until: lease.until,
    bytes: lease.phase === "download" ? Math.max(MESSAGE_DOWNLOAD_POLICY.maxFileBytes, lease.file.size ?? 0) : Math.max(0, lease.file.size ?? 0), uri: lease.file.uri });
  return [...byUri.values()];
}

function erase(entry: Pick<Entry, "file" | "meta">) {
  try { if (entry.file?.exists) entry.file.delete(); } catch { /* Retry a failed removal on the next sweep. */ }
  // Keep the manifest if the content could not be removed.
  if (entry.file?.exists) return;
  const operationId = entry.meta ? metadataId(entry.meta) : null;
  const metadata = metadataFolder();
  if (operationId && metadata.exists) for (const meta of metadata.list()) {
    if (meta instanceof File && metadataId(meta) === operationId) try { meta.delete(); } catch { /* Retry later. */ }
  }
  else try { if (entry.meta?.exists) entry.meta.delete(); } catch { /* Retry later. */ }
}
function write(lease: MessageDownloadLease) {
  // Expo 57 string writes truncate in place on Android/iOS. Never overwrite
  // a durable record: write a new phase/deadline filename and verify it first.
  const next = new File(metadataFolder(), `${lease.operationId}.${lease.phase}.${lease.until}.json`);
  const text = JSON.stringify({ fileName: lease.file.name, phase: lease.phase, until: lease.until });
  if (!next.exists) next.write(text);
  if (next.textSync() !== text) throw new Error("Unable to persist download protection.");
  lease.meta = next;
}

/** Called on startup, foreground, periodic foreground sweep, and logout.
 * Active native work is never evicted. Recent shared/legacy files retain their
 * full grace; a full protected cache refuses admission instead of deleting one.
 */
export function pruneMessageDownloads() {
  const now = Date.now();
  for (const lease of active.values()) {
    if (!lease.released || lease.until > now) continue;
    erase(lease);
    if (!lease.file.exists) active.delete(lease.file.uri);
  }
  for (const entry of entries()) {
    if (active.has(entry.uri)) continue;
    if (entry.until <= now || entry.phase === "ready") erase(entry);
  }
}
export function clearMessageDownloads() {
  generation++;
  // In-flight work and native share consumers keep their leases. A retired
  // unshared download is removed when its native promise settles.
  pruneMessageDownloads();
}

export function reserveMessageDownload(file: File, operationId: string): MessageDownloadLease {
  pruneMessageDownloads();
  const root = folder(), prefix = root.uri.replace(/\/$/, "") + "/";
  if (!file.uri.startsWith(prefix) || /[\/\\]/.test(file.name) || !/^[a-z0-9-]{1,80}$/i.test(operationId)) throw new Error("Invalid download destination.");
  const retained = entries();
  if (file.exists || retained.some(entry => entry.uri === file.uri)) throw new Error("This download destination is already reserved.");
  const bytes = retained.reduce((total, entry) => total + entry.bytes, 0);
  if (retained.length >= MESSAGE_DOWNLOAD_POLICY.maxFiles || bytes + MESSAGE_DOWNLOAD_POLICY.maxFileBytes > MESSAGE_DOWNLOAD_POLICY.maxBytes) {
    throw new Error("Recent files are still reserved for sharing. Try again later.");
  }
  const metadata = metadataFolder();
  if (metadata.exists && metadata.list().some(meta => meta instanceof File && metadataId(meta) === operationId)) throw new Error("This download operation is already reserved.");
  if (!metadata.exists) metadata.create({ intermediates: true });
  const lease: MessageDownloadLease = { file, meta: new File(metadata, operationId + ".json"), operationId, phase: "download", generation, until: Date.now() + MESSAGE_DOWNLOAD_POLICY.shareGraceMs };
  write(lease); active.set(file.uri, lease); return lease;
}
export function completeMessageDownload(lease: MessageDownloadLease) {
  if (active.get(lease.file.uri) !== lease || lease.generation !== generation) throw new Error("This download was cancelled when the account signed out.");
  const bytes = lease.file.size;
  if (!bytes || bytes > MESSAGE_DOWNLOAD_POLICY.maxFileBytes) throw new Error("Download a file up to 25 MB. This file could not be retained safely.");
  lease.phase = "ready"; write(lease);
}
export function protectMessageDownloadShare(lease: MessageDownloadLease) {
  if (active.get(lease.file.uri) !== lease || lease.generation !== generation) throw new Error("This download is no longer available for sharing.");
  const protectedLease = { ...lease, phase: "shared" as const, until: Date.now() + MESSAGE_DOWNLOAD_POLICY.shareGraceMs };
  write(protectedLease); // Persist protection BEFORE a native consumer opens it.
  lease.meta = protectedLease.meta; lease.phase = protectedLease.phase; lease.until = protectedLease.until;
}
export function releaseMessageDownload(lease: MessageDownloadLease) {
  if (active.get(lease.file.uri) !== lease) return;
  if (lease.phase === "shared") {
    // shareAsync can resolve before a recipient consumes the URI. Protection
    // lasts throughout its promise and for 48 hours AFTER it settles.
    lease.until = Date.now() + MESSAGE_DOWNLOAD_POLICY.shareGraceMs;
    try { write(lease); } catch {
      // Keep in-memory protection through the fresh grace if persistence fails.
      // Admission still counts it; sweeps retire it only after that grace ends.
      lease.released = true; return;
    }
  } else erase(lease);
  active.delete(lease.file.uri);
  pruneMessageDownloads();
}
