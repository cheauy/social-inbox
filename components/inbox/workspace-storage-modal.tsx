"use client";

/* Signed, short-lived Storage URLs intentionally bypass the Next image proxy. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Eye, FileText, Folder, FolderPlus, Heart, Images, MoreHorizontal, Pencil, Play, Send, Trash2, Upload, X } from "lucide-react";

import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { WorkspaceStorageThumbnail } from "./workspace-storage-thumbnail";
import { createClient } from "@/lib/supabase/client";
import { StorageApiError, runStorageUpload, workspaceStorageRequest, type PendingStorageUpload, type StorageUploadAttempt } from "@/lib/storage/workspace-storage-client";
import { WORKSPACE_FILE_ACCEPT, WORKSPACE_FILE_BUCKET, WORKSPACE_FILE_MAX_BYTES, workspaceFileKind, workspaceFilesForView, type WorkspaceStorageView } from "@/lib/storage/workspace-files";
import {
  beginWorkspaceStorageMutation,
  clearWorkspaceStorageCache,
  commitWorkspaceStorageMutation,
  dropWorkspaceStorageCache,
  mergeWorkspaceStorageFiles,
  readWorkspaceStorageCache,
  refreshWorkspaceStorageCache,
  workspaceStorageCacheKey,
  type WorkspaceStorageCategory,
  type WorkspaceStorageFile,
} from "@/lib/storage/workspace-storage-cache";

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function Preview({ file, onClose, renew }: { file: WorkspaceStorageFile; onClose: () => void; renew: (file: WorkspaceStorageFile, failed?: boolean) => Promise<void> }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    void renew(file);
    const interval = window.setInterval(() => void renew(file), 30_000);
    return () => window.clearInterval(interval);
  }, [file, renew]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); onClose(); }
      if (event.key === "Tab") {
        const controls = Array.from(closeButton.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('button, video[controls]') ?? []);
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); previous?.focus(); };
  }, [onClose]);
  return <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/90 p-4" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`} onMouseDown={onClose}>
    {file.kind === "video"
      ? <video src={file.previewUrl!} controls autoPlay onError={() => void renew(file, true)} className="max-h-[85dvh] max-w-full" onMouseDown={(event) => event.stopPropagation()} />
      : <img src={file.previewUrl!} alt={file.name} onError={() => void renew(file, true)} className="max-h-[85dvh] max-w-full object-contain" onMouseDown={(event) => event.stopPropagation()} />}
    <button ref={closeButton} type="button" onClick={onClose} aria-label="Close preview" className="absolute right-4 top-4 rounded-full bg-white/15 p-3 text-white hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><X size={22} /></button>
  </div>;
}

type StorageProps = {
  businessId: string; memberId: string; onClose: () => void;
  onSend: (files: File[]) => Promise<boolean>; onDraft: (files: File[]) => Promise<boolean>;
};
export function WorkspaceStorageModal(props: StorageProps) {
  return <WorkspaceStorageContent key={`${props.businessId}:${props.memberId}`} {...props} />;
}

function WorkspaceStorageContent({ businessId, memberId, onClose, onSend, onDraft }: StorageProps) {
  const supabase = useMemo(() => createClient(), []);
  const uploadInput = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const lifecycle = useRef(new AbortController());
  const close = useRef(onClose);
  const actionRef = useRef<"send" | "draft" | null>(null);
  const cacheKey = workspaceStorageCacheKey(businessId, memberId);
  const [view, setView] = useState<WorkspaceStorageView>("recent");
  const [fileFilter, setFileFilter] = useState<"media" | "files">("media");
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const queryKey = JSON.stringify([view, fileFilter, querySearch]);
  const [initialSnapshot] = useState(() => {
    const snapshot = readWorkspaceStorageCache(cacheKey);
    return snapshot?.queryKey === queryKey ? snapshot : null;
  });
  const [files, setFiles] = useState<WorkspaceStorageFile[]>(initialSnapshot?.files ?? []);
  const [categories, setCategories] = useState<WorkspaceStorageCategory[]>(initialSnapshot?.categories ?? []);
  const [canManage, setCanManage] = useState(initialSnapshot?.canManage ?? false);
  const [organizationAvailable, setOrganizationAvailable] = useState(initialSnapshot?.organizationAvailable ?? false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = files.find(file => file.id === previewId) ?? null;
  const [categoryForm, setCategoryForm] = useState<{ id: string | null; name: string } | null>(null);
  const [categoryMenuId, setCategoryMenuId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "files" } | { kind: "category"; category: WorkspaceStorageCategory } | null>(null);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<StorageUploadAttempt[]>([]);
  const [action, setAction] = useState<"send" | "draft" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialSnapshot?.hasMore ?? false);
  const [cursor, setCursor] = useState<string | null>(initialSnapshot?.nextCursor ?? null);
  const [pendingDeletions, setPendingDeletions] = useState<Array<{ id: string; name: string }>>(initialSnapshot?.pendingDeletions ?? []);
  const [pendingUploads, setPendingUploads] = useState<PendingStorageUpload[]>(initialSnapshot?.pendingUploads ?? []);
  const queryOwner = useRef(queryKey);
  useLayoutEffect(() => { queryOwner.current = queryKey; }, [queryKey]);
  const listRequest = useRef<AbortController | null>(null);
  const listSequence = useRef(0);
  const filesRef = useRef(files);
  useLayoutEffect(() => { filesRef.current = files; }, [files]);
  const uploadsRunning = useRef(false);
  const main = useRef<HTMLElement>(null);

  const invalidate = useCallback(() => {
    clearWorkspaceStorageCache();
    listRequest.current?.abort();
    lifecycle.current?.abort();
    active.current = false;
    setFiles([]); setSelected(new Set()); setPreviewId(null); setCategories([]);
    setCanManage(false); setOrganizationAvailable(false); setPendingDeletions([]); setPendingUploads([]); setUploads([]);
  }, []);
  const request = useCallback(async (body?: object, signal?: AbortSignal, query?: URLSearchParams, category = false) => {
    if (!active.current) throw new DOMException("Storage request cancelled.", "AbortError");
    try {
      return await workspaceStorageRequest({ businessId, memberId }, body,
        signal ? AbortSignal.any([signal, lifecycle.current!.signal]) : lifecycle.current!.signal, query, category);
    } catch (cause) {
      if (active.current && cause instanceof StorageApiError &&
          ([401, 403].includes(cause.status) || (cause.status === 409 && !cause.code && !category))) invalidate();
      throw cause;
    }
  }, [businessId, memberId, invalidate]);

  const load = useCallback(async (appendCursor?: string) => {
    if (!active.current || (appendCursor && !appendCursor.trim())) return;
    listRequest.current?.abort();
    const controller = new AbortController(); listRequest.current = controller;
    const sequence = ++listSequence.current;
    const owner = queryKey;
    setRefreshing(true); setListError(null);
    try {
      const result = await refreshWorkspaceStorageCache(cacheKey, async signal => {
        const windowPages = appendCursor ? 1 : Math.max(1, Math.ceil(filesRef.current.length / 30));
        const incoming: WorkspaceStorageFile[] = [];
        let next = appendCursor;
        let response;
        for (let page = 0; page < windowPages; page++) {
          response = await request(undefined, AbortSignal.any([signal, controller.signal]), new URLSearchParams({
            limit: "30", view, kind: fileFilter, q: querySearch, ...(next ? { cursor: next } : {}),
          }));
          if (typeof response.hasMore !== "boolean" || (response.hasMore && !response.nextCursor)) throw new Error("Storage pagination was incomplete. Retry loading files.");
          incoming.push(...(response.files ?? []));
          if (!response.hasMore) break;
          if (response.nextCursor === next) throw new Error("Storage cursor did not advance. Retry loading files.");
          next = response.nextCursor ?? undefined;
        }
        if (!response) throw new Error("Storage response was missing.");
        return {
          files: mergeWorkspaceStorageFiles(filesRef.current, incoming, Boolean(appendCursor)),
          categories: response.categories ?? [], canManage: response.canManage === true,
          organizationAvailable: response.organizationAvailable === true, queryKey: owner,
          hasMore: response.hasMore, nextCursor: response.nextCursor ?? null,
          pendingDeletions: response.pendingDeletions ?? [],
          pendingUploads: response.pendingUploads ?? [],
        };
      });
      if (active.current && result.current && sequence === listSequence.current && queryOwner.current === owner) {
        const snapshot = result.snapshot;
        setFiles(snapshot.files); setCategories(snapshot.categories); setCanManage(snapshot.canManage);
        setOrganizationAvailable(snapshot.organizationAvailable); setHasMore(snapshot.hasMore ?? false);
        setCursor(snapshot.nextCursor ?? null); setPendingDeletions(snapshot.pendingDeletions ?? []);
        setPendingUploads(snapshot.pendingUploads ?? []);
        const ids = new Set(snapshot.files.map(file => file.id));
        setSelected(current => new Set([...current].filter(id => ids.has(id))));
        if (!snapshot.organizationAvailable && view !== "recent") setView("recent");
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (sequence === listSequence.current && queryOwner.current === owner) setListError(cause instanceof Error ? cause.message : "Unable to load Storage.");
    } finally {
      if (sequence === listSequence.current && queryOwner.current === owner) { setLoading(false); setRefreshing(false); }
    }
  }, [cacheKey, fileFilter, queryKey, querySearch, request, view]);
  const latestLoad = useRef(load);
  useLayoutEffect(() => { latestLoad.current = load; }, [load]);
  function reconcileChangedQuery(ownerQuery: string) {
    if (active.current && queryOwner.current !== ownerQuery) {
      dropWorkspaceStorageCache(cacheKey);
      void latestLoad.current();
    }
  }

  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    active.current = true;
    lifecycle.current = new AbortController();
    let sessionOwner: { userId: string; token: string } | null = null;
    const subscription = supabase.auth.onAuthStateChange((event, session) => {
      const changed = sessionOwner && session && (sessionOwner.userId !== session.user.id || sessionOwner.token !== session.access_token);
      if (event === "SIGNED_OUT" || (event === "SIGNED_IN" && changed)) {
        invalidate(); setError("Your sign-in session changed. Reopen Storage from Inbox.");
      }
      sessionOwner = session ? { userId: session.user.id, token: session.access_token } : null;
    });
    return () => { active.current = false; lifecycle.current?.abort(); listRequest.current?.abort(); subscription.data.subscription.unsubscribe(); };
  }, [invalidate, supabase]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuerySearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const previousQuery = useRef(queryKey);
  useEffect(() => {
    if (previousQuery.current !== queryKey) {
      dropWorkspaceStorageCache(cacheKey); setFiles([]); filesRef.current = [];
      setSelected(new Set()); setPreviewId(null); setCursor(null); setHasMore(false); setLoading(true);
      if (main.current) main.current.scrollTop = 0;
      previousQuery.current = queryKey;
    }
    const frame = window.requestAnimationFrame(() => void load());
    return () => { window.cancelAnimationFrame(frame); listRequest.current?.abort(); };
  }, [cacheKey, load, queryKey]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (categoryMenuId) { setCategoryMenuId(null); return; }
      if (!preview && !confirm) close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [categoryMenuId, confirm, preview]);

  const shown = useMemo(() => workspaceFilesForView(files, view), [files, view]);
  const media = shown.filter(file => file.kind === "image" || file.kind === "video");
  const documents = shown.filter(file => file.kind !== "image" && file.kind !== "video");
  const activeCategoryId = view.startsWith("category:") ? view.slice(9) : null;
  function toggleSelected(id: string) {
    if (!selected.has(id) && selected.size >= 200) { setError("Select up to 200 files per action. Finish this selection before choosing more."); return; }
    setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function updateFiles(owner: ReturnType<typeof beginWorkspaceStorageMutation>, update: (items: WorkspaceStorageFile[]) => WorkspaceStorageFile[]) {
    if (!active.current) return;
    setFiles(update);
    commitWorkspaceStorageMutation(cacheKey, owner, snapshot => ({ ...snapshot, files: update(snapshot.files) }));
  }
  async function runUploads(attempts: StorageUploadAttempt[]) {
    if (uploadsRunning.current || !active.current) return;
    uploadsRunning.current = true; setUploading(true);
    const ownerQuery = queryOwner.current;
    for (const attempt of attempts) {
      if (!active.current) break;
      attempt.state = "uploading"; attempt.error = undefined; setUploads(current => [...current]);
      const type = attempt.file.type.trim().toLowerCase() || "application/octet-stream";
      if (!workspaceFileKind(attempt.file.name, type) || attempt.file.size <= 0 || attempt.file.size > WORKSPACE_FILE_MAX_BYTES) {
        attempt.state = "failed"; attempt.error = "Unsupported type or size outside 1 byte?20 MB."; continue;
      }
      const mutation = queryOwner.current === ownerQuery ? beginWorkspaceStorageMutation(cacheKey) : null;
      try {
        const result = await runStorageUpload(attempt, body => request(body), async (upload, file) => {
          const result = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, { contentType: type });
          if (result.error) throw result.error;
        });
        if (!result.clientFile) throw new Error("Upload finalization response was incomplete. Retry to reconcile it.");
        attempt.state = "complete";
        setPendingUploads(current => current.filter(upload => upload.uploadId !== attempt.upload?.uploadId));
        const file = result.clientFile;
        if (mutation && queryOwner.current === ownerQuery &&
            (view === "recent" || (view.startsWith("category:") && file.categoryId === activeCategoryId)) &&
            (fileFilter === "media" ? ["image", "video"].includes(file.kind) : !["image", "video"].includes(file.kind)) &&
            file.name.toLowerCase().includes(querySearch.toLowerCase())) {
          updateFiles(mutation, items => {
            const current = items.find(item => item.id === file.id);
            return mergeWorkspaceStorageFiles(items, [current ? { ...file, favorite: current.favorite, categoryId: current.categoryId } : file], true);
          });
        }
      } catch (cause) {
        attempt.state = "failed"; attempt.error = cause instanceof Error ? cause.message : "Upload failed. Retry to check its outcome.";
      }
      if (active.current) setUploads(current => [...current]);
    }
    uploadsRunning.current = false;
    if (active.current) {
      setUploading(false); setUploads(current => current.filter(attempt => attempt.state !== "complete"));
      reconcileChangedQuery(ownerQuery);
    }
  }
  function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []); event.target.value = "";
    const used = new Set<string>();
    const attempts: StorageUploadAttempt[] = chosen.map(file => {
      const pending = pendingUploads.find(upload => !used.has(upload.uploadId) && upload.fileName === file.name.trim().slice(0, 255) && upload.mimeType === (file.type.trim().toLowerCase() || "application/octet-stream") && upload.sizeBytes === file.size && upload.categoryId === activeCategoryId);
      if (pending) used.add(pending.uploadId);
      return { id: crypto.randomUUID(), file, categoryId: activeCategoryId, state: "waiting", ...(pending ? { upload: { uploadId: pending.uploadId, path: pending.storagePath, bucket: WORKSPACE_FILE_BUCKET, token: "" } } : {}) };
    });
    setUploads(current => [...current.filter(attempt => attempt.state !== "complete"), ...attempts]);
    void runUploads(attempts);
  }

  async function reconcileUploads() {
    if (busy || uploading) return;
    setBusy(true); setError(null);
    const failures: string[] = [];
    for (const upload of pendingUploads) {
      try {
        await request({ action: "finalize-upload", ...upload });
      } catch (cause) {
        if (cause instanceof StorageApiError && cause.code === "UPLOAD_INCOMPLETE") failures.push(`${upload.fileName}: select the original file to resume the upload.`);
        else failures.push(`${upload.fileName}: ${cause instanceof Error ? cause.message : "Unable to confirm upload."}`);
      }
      if (!active.current) break;
    }
    if (active.current) {
      dropWorkspaceStorageCache(cacheKey); await load(); setBusy(false);
      if (failures.length) setError(failures.join("\n"));
    }
  }

  const favoriteQueues = useRef(new Map<string, { desired: boolean; confirmed: boolean; sequence: number; tail: Promise<void> }>());
  function toggleFavorite(file: WorkspaceStorageFile) {
    const ownerQuery = queryOwner.current;
    let queue = favoriteQueues.current.get(file.id);
    if (!queue) { queue = { desired: file.favorite, confirmed: file.favorite, sequence: 0, tail: Promise.resolve() }; favoriteQueues.current.set(file.id, queue); }
    const favorite = !queue.desired; queue.desired = favorite;
    const sequence = ++queue.sequence;
    const mutation = beginWorkspaceStorageMutation(cacheKey);
    setFiles(items => items.map(item => item.id === file.id ? { ...item, favorite } : item));
    const entity = queue;
    entity.tail = entity.tail.then(async () => {
      if (!active.current) return;
      try {
        const result = await request({ action: "toggle-favorite", fileId: file.id, favorite });
        if (result.success) entity.confirmed = favorite;
        commitWorkspaceStorageMutation(cacheKey, mutation, snapshot => ({ ...snapshot, files: snapshot.files.map(item => item.id === file.id ? { ...item, favorite } : item) }));
      } catch (cause) {
        if (active.current) {
          // A lost response is uncertain; discard this cache rather than recording a false rollback.
          if (queryOwner.current === ownerQuery) dropWorkspaceStorageCache(cacheKey);
          setError(cause instanceof Error ? cause.message : "Unable to update that favorite.");
        }
      }
      if (active.current && entity.sequence === sequence) {
        entity.desired = entity.confirmed;
        setFiles(items => items.map(item => item.id === file.id ? { ...item, favorite: entity.confirmed } : item));
        favoriteQueues.current.delete(file.id);
      }
      reconcileChangedQuery(ownerQuery);
    });
  }
  async function saveCategory() {
    const name = categoryForm?.name.trim() ?? ""; if (!name || busy) return;
    const ownerQuery = queryOwner.current;
    setBusy(true); setError(null);
    const mutation = beginWorkspaceStorageMutation(cacheKey);
    try {
      const result = await request(categoryForm?.id ? { action: "edit", categoryId: categoryForm.id, name } : { action: "add", name }, undefined, undefined, true);
      const category = result.category;
      if (active.current && category) {
        const update = (items: WorkspaceStorageCategory[]) => [...items.filter(item => item.id !== category.id), category].sort((a, b) => a.name.localeCompare(b.name));
        setCategories(update); commitWorkspaceStorageMutation(cacheKey, mutation, snapshot => ({ ...snapshot, categories: update(snapshot.categories) }));
        setCategoryForm(null);
      }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Unable to save that category."); }
    finally { if (active.current) { setBusy(false); reconcileChangedQuery(ownerQuery); } }
  }
  async function deleteFiles(ids: string[]) {
    const ownerQuery = queryOwner.current;
    const mutation = beginWorkspaceStorageMutation(cacheKey);
    const originals = filesRef.current.filter(file => ids.includes(file.id));
    setFiles(items => items.filter(file => !ids.includes(file.id)));
    setPendingDeletions(current => [...current, ...originals.filter(file => !current.some(item => item.id === file.id)).map(file => ({ id: file.id, name: file.name }))]);
    if (queryOwner.current === ownerQuery) dropWorkspaceStorageCache(cacheKey);
    const result = await request({ action: "delete-files", fileIds: ids });
    if (!active.current) return;
    const removed = new Set([...(result.deletedIds ?? []), ...(result.pendingIds ?? [])]);
    updateFiles(mutation, items => items.filter(file => !removed.has(file.id)));
    const failed = new Set(result.failedIds ?? []);
    setFiles(items => mergeWorkspaceStorageFiles(items, originals.filter(file => failed.has(file.id)), true));
    setSelected(new Set(result.failedIds ?? []));
    setPendingDeletions(current => [...current.filter(item => !(result.deletedIds ?? []).includes(item.id) && !failed.has(item.id)), ...(result.pendingIds ?? []).filter(id => !current.some(item => item.id === id)).map(id => ({ id, name: originals.find(file => file.id === id)?.name ?? id }))]);
    // Tombstones survive close/reload on the server; never retain a downloadable cached row.
    if (queryOwner.current === ownerQuery) dropWorkspaceStorageCache(cacheKey);
    reconcileChangedQuery(ownerQuery);
    if (!result.success) setError(result.error || "Some files are pending cleanup. Retry cleanup below.");
  }
  async function retryCleanup() {
    if (busy) return; setBusy(true);
    try { await deleteFiles(pendingDeletions.map(file => file.id)); await load(); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Cleanup failed. Retry later."); }
    finally { if (active.current) setBusy(false); }
  }
  async function deleteConfirmed() {
    if (!confirm || busy) return;
    const ownerQuery = queryOwner.current;
    setBusy(true); setError(null);
    try {
      if (confirm.kind === "category") {
        const id = confirm.category.id;
        const mutation = beginWorkspaceStorageMutation(cacheKey);
        await request({ action: "delete", categoryId: id }, undefined, undefined, true);
        if (!active.current) return;
        setCategories(items => items.filter(item => item.id !== id));
        updateFiles(mutation, items => items.map(item => item.categoryId === id ? { ...item, categoryId: null } : item));
        if (queryOwner.current === ownerQuery) dropWorkspaceStorageCache(cacheKey);
        setView(current => current === `category:${id}` ? "recent" : current);
      } else await deleteFiles([...selected]);
      if (active.current) setConfirm(null);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Unable to delete the selected item."); }
    finally { if (active.current) { setBusy(false); reconcileChangedQuery(ownerQuery); } }
  }
  async function moveSelected(categoryId: string | null) {
    if (!selected.size || busy) return;
    const ownerQuery = queryOwner.current;
    const moving = new Set(selected); const mutation = beginWorkspaceStorageMutation(cacheKey);
    setBusy(true); setError(null);
    try {
      await request({ action: "set-category", fileIds: [...moving], categoryId });
      updateFiles(mutation, items => items.map(file => moving.has(file.id) ? { ...file, categoryId } : file));
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Unable to move the selected files."); }
    finally { if (active.current) { setBusy(false); reconcileChangedQuery(ownerQuery); } }
  }
  function changeView(next: WorkspaceStorageView) { setView(next); }

  const renewals = useRef(new Map<string, { attempts: number; window: number; next: number; promise?: Promise<void> }>());
  const renewPreview = useCallback(async (file: WorkspaceStorageFile, failed = false) => {
    if (!active.current || !navigator.onLine) return;
    if (!failed && file.previewUrl && (file.previewExpiresAt ?? 0) > Date.now() + 60_000) return;
    const key = `${file.id}:${file.contentVersion}`;
    let state = renewals.current.get(key);
    if (!state || Date.now() - state.window >= 10 * 60_000) { state = { attempts: 0, window: Date.now(), next: 0 }; renewals.current.set(key, state); }
    if (state.promise) return state.promise;
    if (state.attempts >= 3 || Date.now() < state.next) return;
    state.attempts++; state.next = Date.now() + 2 ** state.attempts * 1000;
    const current = state;
    current.promise = (async () => {
      const ownerQuery = queryOwner.current;
      try {
        const result = await request({ action: "refresh-previews", fileIds: [file.id] });
        if (!active.current || queryOwner.current !== ownerQuery) return;
        const renewed = result.previews?.find(item => item.id === file.id);
        const mutation = beginWorkspaceStorageMutation(cacheKey);
        updateFiles(mutation, items => renewed
          ? items.map(item => item.id === file.id && item.contentVersion === file.contentVersion ? { ...item, ...renewed } : item)
          : items.filter(item => item.id !== file.id));
      } catch (cause) {
        if (active.current && !(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Preview unavailable. Check your connection.");
      } finally { current.promise = undefined; }
    })();
    return current.promise;
  // updateFiles reads only stable cache identity and functional state setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, request]);

  async function applySelectedFiles(mode: "send" | "draft") {
    if (actionRef.current) return;
    const chosen = files.filter(file => selected.has(file.id)); if (!chosen.length) return;
    actionRef.current = mode; setAction(mode); setError(null);
    try {
      const downloaded = await Promise.all(chosen.map(async file => {
        const result = await request({ action: "get-file-url", fileId: file.id });
        if (!result.signedUrl) throw new Error(`Unable to open ${file.name}.`);
        const response = await fetch(result.signedUrl, { signal: lifecycle.current!.signal });
        if (!response.ok) throw new Error(`Unable to download ${file.name}.`);
        return new File([await response.blob()], file.name, { type: file.mimeType });
      }));
      const apply = mode === "send" ? onSend : onDraft;
      if (active.current && await apply(downloaded)) close.current();
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Unable to use the selected files."); }
    finally { actionRef.current = null; if (active.current) setAction(null); }
  }

  const viewButton = (candidate: WorkspaceStorageView) => `shrink-0 rounded-full px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC] ${view === candidate ? "bg-[#0089CC] text-white" : "bg-[#F1F5F9] text-[#526579] hover:bg-[#E3EAF2]"}`;

  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Workspace Storage">
    <div className="flex h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <header className="flex flex-wrap items-center gap-2 border-b border-[#E3EAF2] px-4 py-3 sm:px-5">
        <div className="min-w-48 flex-1"><h2 className="font-bold text-[#102238]">Storage</h2><p className="text-xs text-[#6D7E91]">Shared with everyone in this workspace</p></div>
        {selected.size && canManage ? <>
          {organizationAvailable ? <><label className="sr-only" htmlFor="storage-move-category">Move selected files to category</label>
          <select id="storage-move-category" defaultValue="" disabled={busy} onChange={(event) => { if (!event.target.value) return; void moveSelected(event.target.value === "uncategorized" ? null : event.target.value); event.target.value = ""; }} className="h-10 max-w-48 rounded-xl border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700">
            <option value="">Move {selected.size} selected...</option><option value="uncategorized">Uncategorised</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></> : null}
          <button type="button" disabled={busy} onClick={() => setConfirm({ kind: "files" })} className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={17} /> Delete</button>
        </> : null}
        <input ref={uploadInput} type="file" multiple accept={WORKSPACE_FILE_ACCEPT} onChange={uploadFiles} className="hidden" />
        <button type="button" disabled={!canManage || uploading || Boolean(action)} onClick={() => uploadInput.current?.click()} className="flex h-10 items-center gap-2 rounded-xl bg-[#EAF7FF] px-3 text-sm font-bold text-[#0089CC] disabled:opacity-50"><Upload size={17} />{uploading ? "Uploading..." : "Upload"}</button>
        <button type="button" onClick={onClose} aria-label="Close Storage" className="rounded-full p-2 text-[#6D7E91] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC]"><X size={20} /></button>
      </header>
      {error ? <p className="whitespace-pre-line border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700" role="alert">{error}</p> : null}
      {listError ? <div role="alert" className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">{listError} <button type="button" disabled={refreshing} onClick={() => void load(cursor ?? undefined)}>Retry loading</button></div> : null}
      {uploads.some(attempt => attempt.state !== "complete") ? <div className="max-h-28 overflow-y-auto border-b px-5 py-2 text-xs" aria-live="polite">
        {uploads.filter(attempt => attempt.state !== "complete").map(attempt => <p key={attempt.id} role={attempt.error ? "alert" : "status"}>{attempt.file.name}: {attempt.error ?? (attempt.state === "uploading" ? "Uploading / confirming…" : "Waiting…")}</p>)}
        {uploads.some(attempt => attempt.state === "failed") ? <button type="button" disabled={uploading || !canManage} onClick={() => void runUploads(uploads.filter(attempt => attempt.state === "failed"))} className="font-bold text-[#0089CC] disabled:opacity-50">Retry failed uploads</button> : null}
      </div> : null}
      {pendingDeletions.length && canManage ? <div className="border-b bg-amber-50 px-5 py-2 text-xs" role="status">{pendingDeletions.length} file(s) pending deletion cleanup. <button type="button" disabled={busy} onClick={() => void retryCleanup()} className="font-bold text-[#0089CC] disabled:opacity-50">Retry cleanup</button></div> : null}
      {pendingUploads.length && canManage ? <div className="border-b bg-amber-50 px-5 py-2 text-xs" role="status">{pendingUploads.length} interrupted upload(s) awaiting confirmation. <button type="button" disabled={busy || uploading} onClick={() => void reconcileUploads()} className="font-bold text-[#0089CC] disabled:opacity-50">Reconcile uploads</button></div> : null}

      <div className="border-b border-[#E3EAF2] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1" aria-label="Storage categories">
            <button type="button" aria-pressed={view === "recent"} onClick={() => changeView("recent")} className={viewButton("recent")}>Recent</button>
            {organizationAvailable ? <button type="button" aria-pressed={view === "favorites"} onClick={() => changeView("favorites")} className={viewButton("favorites")}><span className="inline-flex items-center gap-1"><Heart size={15} /> Favorites</span></button> : null}
            {organizationAvailable ? categories.map((category) => <div key={category.id} className="group/category relative flex shrink-0 items-center rounded-full bg-[#F1F5F9]">
              <button type="button" aria-pressed={view === `category:${category.id}`} onClick={() => changeView(`category:${category.id}`)} className={viewButton(`category:${category.id}`)}>{category.name}</button>
              {canManage ? <>
                <span className="mr-1 hidden items-center opacity-0 transition focus-within:opacity-100 group-hover/category:opacity-100 sm:flex">
                  <button type="button" aria-label={`Rename ${category.name}`} onClick={() => setCategoryForm({ id: category.id, name: category.name })} className="rounded-full p-2 text-slate-500 hover:bg-white focus-visible:outline-2 focus-visible:outline-[#0089CC]"><Pencil size={14} /></button>
                  <button type="button" aria-label={`Delete ${category.name}`} onClick={() => setConfirm({ kind: "category", category })} className="rounded-full p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-500"><Trash2 size={14} /></button>
                </span>
                <button type="button" aria-label={`Manage ${category.name}`} aria-expanded={categoryMenuId === category.id} onClick={() => setCategoryMenuId((current) => current === category.id ? null : category.id)} className="mr-1 rounded-full p-2 text-slate-500 hover:bg-white focus-visible:outline-2 focus-visible:outline-[#0089CC] sm:hidden"><MoreHorizontal size={16} /></button>
                {categoryMenuId === category.id ? <div role="menu" aria-label={`Manage ${category.name}`} className="absolute right-0 top-full z-20 mt-1 min-w-32 rounded-xl border border-slate-200 bg-white p-1 shadow-xl sm:hidden">
                  <button type="button" role="menuitem" onClick={() => { setCategoryMenuId(null); setCategoryForm({ id: category.id, name: category.name }); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Pencil size={15} /> Edit</button>
                  <button type="button" role="menuitem" onClick={() => { setCategoryMenuId(null); setConfirm({ kind: "category", category }); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 size={15} /> Delete</button>
                </div> : null}
              </> : null}
            </div>) : null}
          </div>
          {canManage && organizationAvailable ? <button type="button" onClick={() => setCategoryForm({ id: null, name: "" })} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-bold text-[#0089CC] hover:bg-[#EAF7FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC]"><FolderPlus size={16} /> Add category</button> : null}
        </div>
        {organizationAvailable && categoryForm ? <form onSubmit={(event) => { event.preventDefault(); void saveCategory(); }} className="mt-3 flex max-w-md gap-2">
          <label className="sr-only" htmlFor="storage-category-name">Category name</label>
          <input id="storage-category-name" autoFocus maxLength={80} value={categoryForm.name} disabled={busy} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setCategoryForm(null); } }} placeholder="Category name" className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-[#0089CC] focus:ring-2 focus:ring-[#EAF7FF]" />
          <button type="submit" disabled={busy || !categoryForm.name.trim()} className="rounded-xl bg-[#0089CC] px-4 text-sm font-bold text-white disabled:opacity-50">{categoryForm.id ? "Save" : "Add"}</button>
          <button type="button" disabled={busy} onClick={() => setCategoryForm(null)} className="rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        </form> : null}
      </div>

      <main ref={main} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-busy={loading}>
        <div className="mb-3 flex items-center gap-2">
          <label className="sr-only" htmlFor="storage-search">Search Storage</label>
          <input id="storage-search" type="search" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search Storage" className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm" />
          <button type="button" disabled={refreshing || uploading} onClick={() => void load()} className="text-xs font-bold text-[#0089CC] disabled:opacity-50">{refreshing ? "Refreshing…" : "Refresh"}</button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2" aria-label="Storage file types">
          <button type="button" aria-pressed={fileFilter === "media"} onClick={() => setFileFilter("media")} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC] ${fileFilter === "media" ? "bg-[#EAF7FF] text-[#0089CC]" : "bg-[#F6F8FC] text-[#6D7E91] hover:bg-slate-100"}`}><Images size={18} /> Photos & videos <span className="text-xs">{media.length}</span></button>
          <button type="button" aria-pressed={fileFilter === "files"} onClick={() => setFileFilter("files")} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC] ${fileFilter === "files" ? "bg-[#EAF7FF] text-[#0089CC]" : "bg-[#F6F8FC] text-[#6D7E91] hover:bg-slate-100"}`}><FileText size={18} /> Files <span className="text-xs">{documents.length}</span></button>
        </div>
        {loading ? <div className="grid grid-cols-2 gap-2 min-[390px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5" role="status" aria-label="Loading workspace files">{Array.from({ length: 10 }, (_, index) => <div key={index} className="aspect-square animate-pulse rounded-xl bg-[#E3EAF2]" />)}</div> : null}
        {!loading && !refreshing && !hasMore && !error && !listError && (fileFilter === "media" ? media : documents).length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-[#6D7E91]"><Folder size={34} /><p className="text-sm">{view === "favorites" ? `No favorite ${fileFilter === "media" ? "photos or videos" : "files"} yet.` : `No ${fileFilter === "media" ? "photos or videos" : "files"} in this category yet.`}</p></div> : null}
        {!loading && fileFilter === "media" && media.length ? <section>
          <div className="grid grid-cols-2 gap-2 min-[390px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5">
            {media.map((file) => {
              const isSelected = selected.has(file.id);
              return <article key={file.id} className={`group relative overflow-hidden rounded-xl border bg-white ${isSelected ? "border-[#0089CC] ring-2 ring-[#BEE7FA]" : "border-[#E3EAF2]"}`}>
                <button type="button" aria-pressed={isSelected} aria-label={`${isSelected ? "Deselect" : "Select"} ${file.name}`} onClick={() => toggleSelected(file.id)} className="relative block aspect-square w-full overflow-hidden bg-[#F6F8FC] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#0089CC]">
                  <WorkspaceStorageThumbnail file={file} renew={renewPreview} />
                  {file.kind === "video" ? <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/50 p-2 text-white"><Play size={18} fill="currentColor" /></span></span> : null}
                  <span className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-black ${isSelected ? "border-[#0089CC] bg-[#0089CC] text-white" : "border-white bg-black/35 text-transparent"}`}>✓</span>
                </button>
                <div className="absolute inset-x-1 bottom-1 flex justify-end gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  {organizationAvailable ? <button type="button" aria-pressed={file.favorite} aria-label={`${file.favorite ? "Remove from" : "Add to"} favorites: ${file.name}`} onClick={() => void toggleFavorite(file)} className="rounded-lg bg-black/65 p-2 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"><Heart size={16} fill={file.favorite ? "currentColor" : "none"} /></button> : null}
                  <button type="button" disabled={!file.previewUrl} aria-label={`Preview ${file.name}`} onClick={() => { setPreviewId(file.id); void renewPreview(file); }} className="rounded-lg bg-black/65 p-2 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"><Eye size={16} /></button>
                </div>
              </article>;
            })}
          </div>
        </section> : null}
        {!loading && fileFilter === "files" && documents.length ? <section>
          <div className="divide-y divide-[#E3EAF2] overflow-hidden rounded-2xl border border-[#E3EAF2]">
            {documents.map((file) => <article key={file.id} className={`flex items-center gap-2 p-2 sm:p-3 ${selected.has(file.id) ? "bg-[#EAF7FF]" : "bg-white"}`}>
              <button type="button" aria-pressed={selected.has(file.id)} onClick={() => toggleSelected(file.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left focus-visible:outline-2 focus-visible:outline-[#0089CC]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#0089CC]"><FileText size={21} /></span>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#102238]">{file.name}</span><span className="block text-xs text-[#6D7E91]">{fileSize(file.sizeBytes)}</span></span>
              </button>
              {organizationAvailable ? <button type="button" aria-pressed={file.favorite} aria-label={`${file.favorite ? "Remove from" : "Add to"} favorites: ${file.name}`} onClick={() => void toggleFavorite(file)} className="rounded-xl p-3 text-[#0089CC] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#0089CC]"><Heart size={18} fill={file.favorite ? "currentColor" : "none"} /></button> : null}
            </article>)}
          </div>
        </section> : null}
        {!loading && hasMore ? <button type="button" disabled={refreshing} onClick={() => void load(cursor ?? undefined)} className="mt-4 w-full rounded-xl border px-3 py-2 text-sm font-bold text-[#0089CC] disabled:opacity-50">{refreshing ? "Loading more…" : "Load more"}</button> : !loading && files.length ? <p className="mt-3 text-center text-xs text-[#6D7E91]">All matching files loaded.</p> : null}
      </main>

      <footer className="flex flex-wrap items-center gap-2 border-t border-[#E3EAF2] px-4 py-3 sm:px-5 sm:py-4">
        <span className="text-sm text-[#6D7E91]" aria-live="polite">{selected.size} selected</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled={!selected.size || Boolean(action) || uploading || busy} onClick={() => void applySelectedFiles("draft")} className="min-h-11 rounded-xl border border-[#0089CC] bg-white px-5 py-2.5 text-sm font-bold text-[#0089CC] disabled:opacity-50">{action === "draft" ? "Staging..." : "Draft"}</button>
          <button type="button" disabled={!selected.size || Boolean(action) || uploading || busy} onClick={() => void applySelectedFiles("send")} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#0089CC] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Send size={17} />{action === "send" ? "Sending..." : "Send Now"}</button>
        </div>
      </footer>
    </div>
    {preview ? <Preview file={preview} renew={renewPreview} onClose={() => setPreviewId(null)} /> : null}
    <ConfirmActionDialog open={Boolean(confirm)} title={confirm?.kind === "category" ? `Delete "${confirm.category.name}"?` : `Permanently delete ${selected.size} selected file${selected.size === 1 ? "" : "s"}?`} description={confirm?.kind === "category" ? "The category will be removed from shared Storage." : "The selected files and their private Storage objects will be permanently deleted."} note={confirm?.kind === "category" ? "Files in this category are kept and become uncategorised." : "This cannot be undone. Already-sent customer messages keep their separate channel copies."} confirmLabel={confirm?.kind === "category" ? "Delete category" : "Delete permanently"} loadingLabel="Deleting..." loading={busy} icon="trash" error={error} onCancel={() => { if (!busy) setConfirm(null); }} onConfirm={() => void deleteConfirmed()} />
  </div>;
}
