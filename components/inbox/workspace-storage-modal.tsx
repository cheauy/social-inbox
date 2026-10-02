"use client";

/* Signed, short-lived Storage URLs intentionally bypass the Next image proxy. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Eye, FileText, Folder, FolderPlus, Heart, Images, MoreHorizontal, Pencil, Play, Send, Trash2, Upload, X } from "lucide-react";

import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { createClient } from "@/lib/supabase/client";
import { WORKSPACE_FILE_ACCEPT, WORKSPACE_FILE_MAX_BYTES, workspaceFileKind, workspaceFilesForView, type WorkspaceStorageView } from "@/lib/storage/workspace-files";
import {
  beginWorkspaceStorageMutation,
  clearWorkspaceStorageCache,
  commitWorkspaceStorageMutation,
  dropWorkspaceStorageCache,
  readWorkspaceStorageCache,
  refreshWorkspaceStorageCache,
  workspaceStorageCacheKey,
  type WorkspaceStorageCategory,
  type WorkspaceStorageFile,
  type WorkspaceStorageSnapshot,
} from "@/lib/storage/workspace-storage-cache";

type ApiResponse = {
  success?: boolean; error?: string; files?: WorkspaceStorageFile[]; categories?: WorkspaceStorageCategory[];
  category?: WorkspaceStorageCategory; signedUrl?: string; upload?: { bucket: string; path: string; token: string };
  canManage?: boolean; organizationAvailable?: boolean;
  deletedIds?: string[]; failedIds?: string[];
};

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function mimeType(file: File) { return file.type.trim().toLowerCase() || "application/octet-stream"; }

class StorageApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function storageApi(body?: object, signal?: AbortSignal): Promise<ApiResponse> {
  const response = await fetch("/api/workspace-storage/files", body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  } : { cache: "no-store", signal });
  const result = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok || !result.success) throw new StorageApiError(result.error || "Workspace Storage request failed.", response.status);
  return result;
}
async function categoryApi(body: object): Promise<ApiResponse> {
  const response = await fetch("/api/workspace-storage/categories", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok || !result.success) throw new Error(result.error || "Storage category request failed.");
  return result;
}

async function deleteFilesApi(fileIds: string[]): Promise<ApiResponse> {
  const response = await fetch("/api/workspace-storage/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete-files", fileIds }),
  });
  const result = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok && response.status !== 207) throw new Error(result.error || "Unable to delete the selected files.");
  return result;
}

function Preview({ file, onClose }: { file: WorkspaceStorageFile; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
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
      ? <video src={file.previewUrl!} controls autoPlay className="max-h-[85dvh] max-w-full" onMouseDown={(event) => event.stopPropagation()} />
      : <img src={file.previewUrl!} alt={file.name} className="max-h-[85dvh] max-w-full object-contain" onMouseDown={(event) => event.stopPropagation()} />}
    <button ref={closeButton} type="button" onClick={onClose} aria-label="Close preview" className="absolute right-4 top-4 rounded-full bg-white/15 p-3 text-white hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><X size={22} /></button>
  </div>;
}

export function WorkspaceStorageModal({ businessId, memberId, onClose, onSend, onDraft }: {
  businessId: string;
  memberId: string;
  onClose: () => void;
  onSend: (files: File[]) => Promise<boolean>;
  onDraft: (files: File[]) => Promise<boolean>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const uploadInput = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const close = useRef(onClose);
  const actionRef = useRef<"send" | "draft" | null>(null);
  const cacheKey = workspaceStorageCacheKey(businessId, memberId);
  const initialSnapshot = readWorkspaceStorageCache(cacheKey);
  const [warmStart] = useState(Boolean(initialSnapshot));
  const [files, setFiles] = useState<WorkspaceStorageFile[]>(() => initialSnapshot?.files ?? []);
  const [categories, setCategories] = useState<WorkspaceStorageCategory[]>(() => initialSnapshot?.categories ?? []);
  const [canManage, setCanManage] = useState(() => initialSnapshot?.canManage ?? false);
  const [organizationAvailable, setOrganizationAvailable] = useState(() => initialSnapshot?.organizationAvailable ?? false);
  const [view, setView] = useState<WorkspaceStorageView>("recent");
  const [fileFilter, setFileFilter] = useState<"media" | "files">("media");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<WorkspaceStorageFile | null>(null);
  const [categoryForm, setCategoryForm] = useState<{ id: string | null; name: string } | null>(null);
  const [categoryMenuId, setCategoryMenuId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "files" } | { kind: "category"; category: WorkspaceStorageCategory } | null>(null);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [uploading, setUploading] = useState(false);
  const [action, setAction] = useState<"send" | "draft" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applySnapshot = useCallback((snapshot: WorkspaceStorageSnapshot) => {
    setFiles(snapshot.files);
    setCategories(snapshot.categories);
    setCanManage(snapshot.canManage);
    setOrganizationAvailable(snapshot.organizationAvailable);
    if (!snapshot.organizationAvailable) {
      setView((current) => current === "favorites" || current.startsWith("category:") ? "recent" : current);
    }
  }, []);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const result = await refreshWorkspaceStorageCache(cacheKey, async (signal) => {
        const response = await storageApi(undefined, signal);
        return {
          files: response.files ?? [],
          categories: response.categories ?? [],
          canManage: response.canManage === true,
          organizationAvailable: response.organizationAvailable === true,
        };
      });
      if (active.current && result.current) applySnapshot(result.snapshot);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (cause instanceof StorageApiError && (cause.status === 401 || cause.status === 403)) {
        if (cause.status === 401) clearWorkspaceStorageCache();
        else dropWorkspaceStorageCache(cacheKey);
        if (active.current) applySnapshot({ files: [], categories: [], canManage: false, organizationAvailable: false });
      }
      if (active.current) setError(cause instanceof Error ? cause.message : "Unable to load Workspace Storage.");
    } finally { if (active.current) setLoading(false); }
  }, [applySnapshot, cacheKey]);

  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    active.current = true;
    const initialLoad = window.requestAnimationFrame(() => void load(!warmStart));
    return () => { active.current = false; window.cancelAnimationFrame(initialLoad); };
  }, [load, warmStart]);
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
  const media = shown.filter((file) => file.kind === "image" || file.kind === "video");
  const documents = shown.filter((file) => file.kind !== "image" && file.kind !== "video");
  const activeCategoryId = view.startsWith("category:") ? view.slice("category:".length) : null;
  function toggleSelected(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []); event.target.value = "";
    if (!chosen.length) return;
    dropWorkspaceStorageCache(cacheKey);
    setUploading(true); setError(null);
    const failures: string[] = [];
    for (const file of chosen) {
      const type = mimeType(file);
      if (!workspaceFileKind(file.name, type) || file.size <= 0 || file.size > WORKSPACE_FILE_MAX_BYTES) {
        failures.push(`${file.name}: unsupported type or larger than 20 MB`); continue;
      }
      try {
        const prepared = await storageApi({ action: "prepare-upload", fileName: file.name, mimeType: type, sizeBytes: file.size });
        if (!prepared.upload) throw new Error("Upload details were missing.");
        const upload = prepared.upload;
        const { error: uploadError } = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, { contentType: type });
        if (uploadError) throw uploadError;
        await storageApi({ action: "finalize-upload", fileName: file.name, mimeType: type, sizeBytes: file.size, storagePath: upload.path, categoryId: activeCategoryId });
      } catch (cause) { failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "upload failed"}`); }
    }
    if (!active.current) return;
    setUploading(false);
    if (failures.length) setError(`Some files were not uploaded:\n${failures.join("\n")}`);
    dropWorkspaceStorageCache(cacheKey);
    await load();
  }

  async function toggleFavorite(file: WorkspaceStorageFile) {
    const favorite = !file.favorite;
    const owner = beginWorkspaceStorageMutation(cacheKey);
    setFiles((current) => current.map((item) => item.id === file.id ? { ...item, favorite } : item));
    try {
      await storageApi({ action: "toggle-favorite", fileId: file.id, favorite });
      commitWorkspaceStorageMutation(cacheKey, owner, (snapshot) => ({
        ...snapshot,
        files: snapshot.files.map((item) => item.id === file.id ? { ...item, favorite } : item),
      }));
    }
    catch (cause) {
      setFiles((current) => current.map((item) => item.id === file.id ? { ...item, favorite: !favorite } : item));
      setError(cause instanceof Error ? cause.message : "Unable to update that favorite.");
    }
  }

  async function saveCategory() {
    const name = categoryForm?.name.trim() ?? ""; if (!name || busy) return;
    dropWorkspaceStorageCache(cacheKey);
    setBusy(true); setError(null);
    try {
      await categoryApi(categoryForm?.id ? { action: "edit", categoryId: categoryForm.id, name } : { action: "add", name });
      dropWorkspaceStorageCache(cacheKey);
      setCategoryForm(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save that category."); }
    finally { if (active.current) setBusy(false); }
  }

  async function deleteConfirmed() {
    if (!confirm || busy) return;
    setBusy(true); setError(null);
    try {
      if (confirm.kind === "category") {
        dropWorkspaceStorageCache(cacheKey);
        await categoryApi({ action: "delete", categoryId: confirm.category.id });
        beginWorkspaceStorageMutation(cacheKey);
        if (view === `category:${confirm.category.id}`) setView("recent");
        setConfirm(null); await load();
      } else {
        const requested = [...selected];
        const owner = beginWorkspaceStorageMutation(cacheKey);
        const result = await deleteFilesApi(requested);
        const deleted = new Set(result.deletedIds ?? (result.success ? requested : []));
        const failed = new Set(result.failedIds ?? requested.filter((id) => !deleted.has(id)));
        setFiles((current) => current.filter((file) => !deleted.has(file.id)));
        setSelected(failed);
        commitWorkspaceStorageMutation(cacheKey, owner, (snapshot) => ({
          ...snapshot,
          files: snapshot.files.filter((file) => !deleted.has(file.id)),
        }));
        if (!result.success) {
          setError(result.error || "Some selected files could not be deleted.");
          return;
        }
        setConfirm(null);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete the selected item."); }
    finally { if (active.current) setBusy(false); }
  }

  async function moveSelected(categoryId: string | null) {
    if (!selected.size || busy) return;
    const moving = new Set(selected);
    const owner = beginWorkspaceStorageMutation(cacheKey);
    setBusy(true); setError(null);
    try {
      await storageApi({ action: "set-category", fileIds: [...moving], categoryId });
      setFiles((current) => current.map((file) => moving.has(file.id) ? { ...file, categoryId } : file));
      commitWorkspaceStorageMutation(cacheKey, owner, (snapshot) => ({
        ...snapshot,
        files: snapshot.files.map((file) => moving.has(file.id) ? { ...file, categoryId } : file),
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to move the selected files."); }
    finally { if (active.current) setBusy(false); }
  }

  function changeView(next: WorkspaceStorageView) {
    setView(next);
  }

  async function applySelectedFiles(mode: "send" | "draft") {
    if (actionRef.current) return;
    const chosen = [...selected]
      .map((id) => files.find((file) => file.id === id))
      .filter((file): file is WorkspaceStorageFile => Boolean(file));
    if (!chosen.length) return;
    actionRef.current = mode; setAction(mode); setError(null);
    try {
      const downloaded = await Promise.all(chosen.map(async (file) => {
        const result = await storageApi({ action: "get-file-url", fileId: file.id });
        if (!result.signedUrl) throw new Error(`Unable to open ${file.name}.`);
        const response = await fetch(result.signedUrl);
        if (!response.ok) throw new Error(`Unable to download ${file.name}.`);
        return new File([await response.blob()], file.name, { type: file.mimeType });
      }));
      const apply = mode === "send" ? onSend : onDraft;
      if (active.current && await apply(downloaded)) close.current();
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : `Unable to ${mode === "send" ? "send" : "stage"} the selected files.`); }
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
        <button type="button" disabled={uploading || Boolean(action)} onClick={() => uploadInput.current?.click()} className="flex h-10 items-center gap-2 rounded-xl bg-[#EAF7FF] px-3 text-sm font-bold text-[#0089CC] disabled:opacity-50"><Upload size={17} />{uploading ? "Uploading..." : "Upload"}</button>
        <button type="button" onClick={onClose} aria-label="Close Storage" className="rounded-full p-2 text-[#6D7E91] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC]"><X size={20} /></button>
      </header>
      {error ? <p className="whitespace-pre-line border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700" role="alert">{error}</p> : null}

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

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-busy={loading}>
        <div className="mb-4 grid grid-cols-2 gap-2" aria-label="Storage file types">
          <button type="button" aria-pressed={fileFilter === "media"} onClick={() => setFileFilter("media")} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC] ${fileFilter === "media" ? "bg-[#EAF7FF] text-[#0089CC]" : "bg-[#F6F8FC] text-[#6D7E91] hover:bg-slate-100"}`}><Images size={18} /> Photos & videos <span className="text-xs">{media.length}</span></button>
          <button type="button" aria-pressed={fileFilter === "files"} onClick={() => setFileFilter("files")} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC] ${fileFilter === "files" ? "bg-[#EAF7FF] text-[#0089CC]" : "bg-[#F6F8FC] text-[#6D7E91] hover:bg-slate-100"}`}><FileText size={18} /> Files <span className="text-xs">{documents.length}</span></button>
        </div>
        {loading ? <div className="grid grid-cols-2 gap-2 min-[390px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5" role="status" aria-label="Loading workspace files">{Array.from({ length: 10 }, (_, index) => <div key={index} className="aspect-square animate-pulse rounded-xl bg-[#E3EAF2]" />)}</div> : null}
        {!loading && !error && (fileFilter === "media" ? media : documents).length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-[#6D7E91]"><Folder size={34} /><p className="text-sm">{view === "favorites" ? `No favorite ${fileFilter === "media" ? "photos or videos" : "files"} yet.` : `No ${fileFilter === "media" ? "photos or videos" : "files"} in this category yet.`}</p></div> : null}
        {!loading && fileFilter === "media" && media.length ? <section>
          <div className="grid grid-cols-2 gap-2 min-[390px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5">
            {media.map((file) => {
              const isSelected = selected.has(file.id);
              return <article key={file.id} className={`group relative overflow-hidden rounded-xl border bg-white ${isSelected ? "border-[#0089CC] ring-2 ring-[#BEE7FA]" : "border-[#E3EAF2]"}`}>
                <button type="button" aria-pressed={isSelected} aria-label={`${isSelected ? "Deselect" : "Select"} ${file.name}`} onClick={() => toggleSelected(file.id)} className="relative block aspect-square w-full overflow-hidden bg-[#F6F8FC] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#0089CC]">
                  {file.kind === "image" && file.previewUrl ? <img src={file.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : file.previewUrl ? <video src={file.previewUrl} preload="metadata" muted playsInline className="h-full w-full object-cover" /> : <Images className="mx-auto text-[#6D7E91]" />}
                  {file.kind === "video" ? <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/50 p-2 text-white"><Play size={18} fill="currentColor" /></span></span> : null}
                  <span className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-black ${isSelected ? "border-[#0089CC] bg-[#0089CC] text-white" : "border-white bg-black/35 text-transparent"}`}>✓</span>
                </button>
                <div className="absolute inset-x-1 bottom-1 flex justify-end gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  {organizationAvailable ? <button type="button" aria-pressed={file.favorite} aria-label={`${file.favorite ? "Remove from" : "Add to"} favorites: ${file.name}`} onClick={() => void toggleFavorite(file)} className="rounded-lg bg-black/65 p-2 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"><Heart size={16} fill={file.favorite ? "currentColor" : "none"} /></button> : null}
                  <button type="button" disabled={!file.previewUrl} aria-label={`Preview ${file.name}`} onClick={() => setPreview(file)} className="rounded-lg bg-black/65 p-2 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"><Eye size={16} /></button>
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
      </main>

      <footer className="flex flex-wrap items-center gap-2 border-t border-[#E3EAF2] px-4 py-3 sm:px-5 sm:py-4">
        <span className="text-sm text-[#6D7E91]" aria-live="polite">{selected.size} selected</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" disabled={!selected.size || Boolean(action) || uploading || busy} onClick={() => void applySelectedFiles("draft")} className="min-h-11 rounded-xl border border-[#0089CC] bg-white px-5 py-2.5 text-sm font-bold text-[#0089CC] disabled:opacity-50">{action === "draft" ? "Staging..." : "Draft"}</button>
          <button type="button" disabled={!selected.size || Boolean(action) || uploading || busy} onClick={() => void applySelectedFiles("send")} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#0089CC] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Send size={17} />{action === "send" ? "Sending..." : "Send Now"}</button>
        </div>
      </footer>
    </div>
    {preview ? <Preview file={preview} onClose={() => setPreview(null)} /> : null}
    <ConfirmActionDialog open={Boolean(confirm)} title={confirm?.kind === "category" ? `Delete "${confirm.category.name}"?` : `Permanently delete ${selected.size} selected file${selected.size === 1 ? "" : "s"}?`} description={confirm?.kind === "category" ? "The category will be removed from shared Storage." : "The selected files and their private Storage objects will be permanently deleted."} note={confirm?.kind === "category" ? "Files in this category are kept and become uncategorised." : "This cannot be undone. Already-sent customer messages keep their separate channel copies."} confirmLabel={confirm?.kind === "category" ? "Delete category" : "Delete permanently"} loadingLabel="Deleting..." loading={busy} icon="trash" error={error} onCancel={() => { if (!busy) setConfirm(null); }} onConfirm={() => void deleteConfirmed()} />
  </div>;
}
