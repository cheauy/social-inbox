"use client";

/* Signed, short-lived Storage URLs intentionally bypass the Next image proxy. */
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Eye, FileText, Folder, FolderPlus, Heart, Images, Pencil, Play, RotateCcw, Send, Trash2, Upload, X } from "lucide-react";

import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { createClient } from "@/lib/supabase/client";
import { WORKSPACE_FILE_ACCEPT, WORKSPACE_FILE_MAX_BYTES, workspaceFileKind, workspaceFilesForView, type WorkspaceStorageView } from "@/lib/storage/workspace-files";

type WorkspaceFile = {
  id: string; name: string; mimeType: string; sizeBytes: number;
  kind: "image" | "video" | "audio" | "file";
  createdAt: string; previewUrl: string | null; categoryId: string | null; favorite: boolean; deletedAt: string | null;
};
type StorageCategory = { id: string; name: string; created_at: string; updated_at: string };
type ApiResponse = {
  success?: boolean; error?: string; files?: WorkspaceFile[]; categories?: StorageCategory[];
  category?: StorageCategory; signedUrl?: string; upload?: { bucket: string; path: string; token: string };
  canManage?: boolean; organizationAvailable?: boolean;
};

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function mimeType(file: File) { return file.type.trim().toLowerCase() || "application/octet-stream"; }

async function storageApi(body?: object): Promise<ApiResponse> {
  const response = await fetch("/api/workspace-storage/files", body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const result = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok || !result.success) throw new Error(result.error || "Workspace Storage request failed.");
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

function Preview({ file, onClose }: { file: WorkspaceFile; onClose: () => void }) {
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

export function WorkspaceStorageModal({ onClose, onSend }: { onClose: () => void; onSend: (files: File[]) => Promise<boolean> }) {
  const supabase = useMemo(() => createClient(), []);
  const uploadInput = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const close = useRef(onClose);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [categories, setCategories] = useState<StorageCategory[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [organizationAvailable, setOrganizationAvailable] = useState(false);
  const [view, setView] = useState<WorkspaceStorageView>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<WorkspaceFile | null>(null);
  const [categoryForm, setCategoryForm] = useState<{ id: string | null; name: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "files" } | { kind: "category"; category: StorageCategory } | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await storageApi();
      if (active.current) {
        const organization = result.organizationAvailable === true;
        setFiles(result.files ?? []); setCategories(result.categories ?? []); setCanManage(result.canManage === true);
        setOrganizationAvailable(organization);
        if (!organization) setView((current) => current === "favorites" || current.startsWith("category:") ? "recent" : current);
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Unable to load Workspace Storage.");
    } finally { if (active.current) setLoading(false); }
  }, []);

  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    active.current = true;
    const initialLoad = window.requestAnimationFrame(() => void load());
    return () => { active.current = false; window.cancelAnimationFrame(initialLoad); };
  }, [load]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !preview && !confirm) close.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, preview]);

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
    await load();
  }

  async function toggleFavorite(file: WorkspaceFile) {
    const favorite = !file.favorite;
    setFiles((current) => current.map((item) => item.id === file.id ? { ...item, favorite } : item));
    try { await storageApi({ action: "toggle-favorite", fileId: file.id, favorite }); }
    catch (cause) {
      setFiles((current) => current.map((item) => item.id === file.id ? { ...item, favorite: !favorite } : item));
      setError(cause instanceof Error ? cause.message : "Unable to update that favorite.");
    }
  }

  async function saveCategory() {
    const name = categoryForm?.name.trim() ?? ""; if (!name || busy) return;
    setBusy(true); setError(null);
    try {
      await categoryApi(categoryForm?.id ? { action: "edit", categoryId: categoryForm.id, name } : { action: "add", name });
      setCategoryForm(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save that category."); }
    finally { if (active.current) setBusy(false); }
  }

  async function deleteConfirmed() {
    if (!confirm || busy) return;
    setBusy(true); setError(null);
    try {
      if (confirm.kind === "category") {
        await categoryApi({ action: "delete", categoryId: confirm.category.id });
        if (view === `category:${confirm.category.id}`) setView("recent");
      } else {
        await storageApi({ action: "delete-files", fileIds: [...selected] }); setSelected(new Set());
      }
      setConfirm(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete the selected item."); }
    finally { if (active.current) setBusy(false); }
  }

  async function moveSelected(categoryId: string | null) {
    if (!selected.size || busy) return;
    setBusy(true); setError(null);
    try {
      await storageApi({ action: "set-category", fileIds: [...selected], categoryId });
      setFiles((current) => current.map((file) => selected.has(file.id) ? { ...file, categoryId } : file));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to move the selected files."); }
    finally { if (active.current) setBusy(false); }
  }

  async function restoreSelected() {
    if (!selected.size || busy) return;
    setBusy(true); setError(null);
    try {
      await storageApi({ action: "restore-files", fileIds: [...selected] });
      setSelected(new Set()); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to restore the selected files."); }
    finally { if (active.current) setBusy(false); }
  }

  function changeView(next: WorkspaceStorageView) {
    if (view === "trash" || next === "trash") setSelected(new Set());
    setView(next);
  }

  async function sendSelected() {
    const chosen = files.filter((file) => selected.has(file.id)); if (!chosen.length) return;
    setSending(true); setError(null);
    try {
      const downloaded = await Promise.all(chosen.map(async (file) => {
        const result = await storageApi({ action: "get-file-url", fileId: file.id });
        if (!result.signedUrl) throw new Error(`Unable to open ${file.name}.`);
        const response = await fetch(result.signedUrl);
        if (!response.ok) throw new Error(`Unable to download ${file.name}.`);
        return new File([await response.blob()], file.name, { type: file.mimeType });
      }));
      if (active.current && await onSend(downloaded)) close.current();
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "Unable to send the selected files."); }
    finally { if (active.current) setSending(false); }
  }

  const viewButton = (candidate: WorkspaceStorageView) => `shrink-0 rounded-full px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC] ${view === candidate ? "bg-[#0089CC] text-white" : "bg-[#F1F5F9] text-[#526579] hover:bg-[#E3EAF2]"}`;

  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Workspace Storage">
    <div className="flex h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <header className="flex flex-wrap items-center gap-2 border-b border-[#E3EAF2] px-4 py-3 sm:px-5">
        <div className="min-w-48 flex-1"><h2 className="font-bold text-[#102238]">Storage</h2><p className="text-xs text-[#6D7E91]">Shared with everyone in this workspace</p></div>
        {selected.size && canManage && view === "trash" ? <button type="button" disabled={busy} onClick={() => void restoreSelected()} className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-[#0089CC] hover:bg-[#EAF7FF] disabled:opacity-50"><RotateCcw size={17} /> Restore</button> : null}
        {selected.size && canManage && view !== "trash" ? <>
          {organizationAvailable ? <><label className="sr-only" htmlFor="storage-move-category">Move selected files to category</label>
          <select id="storage-move-category" defaultValue="" disabled={busy} onChange={(event) => { if (!event.target.value) return; void moveSelected(event.target.value === "uncategorized" ? null : event.target.value); event.target.value = ""; }} className="h-10 max-w-48 rounded-xl border border-slate-300 bg-white px-2 text-sm font-semibold text-slate-700">
            <option value="">Move {selected.size} selected...</option><option value="uncategorized">Uncategorised</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></> : null}
          <button type="button" disabled={busy} onClick={() => setConfirm({ kind: "files" })} className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={17} /> Delete</button>
        </> : null}
        <input ref={uploadInput} type="file" multiple accept={WORKSPACE_FILE_ACCEPT} onChange={uploadFiles} className="hidden" />
        <button type="button" disabled={uploading || sending} onClick={() => uploadInput.current?.click()} className="flex h-10 items-center gap-2 rounded-xl bg-[#EAF7FF] px-3 text-sm font-bold text-[#0089CC] disabled:opacity-50"><Upload size={17} />{uploading ? "Uploading..." : "Upload"}</button>
        <button type="button" onClick={onClose} aria-label="Close Storage" className="rounded-full p-2 text-[#6D7E91] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC]"><X size={20} /></button>
      </header>
      {error ? <p className="whitespace-pre-line border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700" role="alert">{error}</p> : null}

      <div className="border-b border-[#E3EAF2] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Storage categories">
          <button type="button" aria-pressed={view === "recent"} onClick={() => changeView("recent")} className={viewButton("recent")}>Recent</button>
          {organizationAvailable ? <button type="button" aria-pressed={view === "favorites"} onClick={() => changeView("favorites")} className={viewButton("favorites")}><span className="inline-flex items-center gap-1"><Heart size={15} /> Favorites</span></button> : null}
          {organizationAvailable ? categories.map((category) => <div key={category.id} className="flex shrink-0 items-center rounded-full bg-[#F1F5F9]">
            <button type="button" aria-pressed={view === `category:${category.id}`} onClick={() => changeView(`category:${category.id}`)} className={viewButton(`category:${category.id}`)}>{category.name}</button>
            {canManage ? <><button type="button" aria-label={`Rename ${category.name}`} onClick={() => setCategoryForm({ id: category.id, name: category.name })} className="rounded-full p-2 text-slate-500 hover:bg-white focus-visible:outline-2 focus-visible:outline-[#0089CC]"><Pencil size={14} /></button>
            <button type="button" aria-label={`Delete ${category.name}`} onClick={() => setConfirm({ kind: "category", category })} className="mr-1 rounded-full p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-500"><Trash2 size={14} /></button></> : null}
          </div>) : null}
          {canManage && organizationAvailable ? <button type="button" onClick={() => setCategoryForm({ id: null, name: "" })} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-bold text-[#0089CC] hover:bg-[#EAF7FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0089CC]"><FolderPlus size={16} /> Add category</button> : null}
          {canManage ? <button type="button" aria-pressed={view === "trash"} onClick={() => changeView("trash")} className={viewButton("trash")}><span className="inline-flex items-center gap-1"><Trash2 size={15} /> Trash</span></button> : null}
        </div>
        {organizationAvailable && categoryForm ? <form onSubmit={(event) => { event.preventDefault(); void saveCategory(); }} className="mt-3 flex max-w-md gap-2">
          <label className="sr-only" htmlFor="storage-category-name">Category name</label>
          <input id="storage-category-name" autoFocus maxLength={80} value={categoryForm.name} disabled={busy} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setCategoryForm(null); } }} placeholder="Category name" className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-[#0089CC] focus:ring-2 focus:ring-[#EAF7FF]" />
          <button type="submit" disabled={busy || !categoryForm.name.trim()} className="rounded-xl bg-[#0089CC] px-4 text-sm font-bold text-white disabled:opacity-50">{categoryForm.id ? "Save" : "Add"}</button>
          <button type="button" disabled={busy} onClick={() => setCategoryForm(null)} className="rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
        </form> : null}
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5" aria-busy={loading}>
        {loading ? <div className="grid grid-cols-2 gap-2 min-[390px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5" role="status" aria-label="Loading workspace files">{Array.from({ length: 10 }, (_, index) => <div key={index} className="aspect-square animate-pulse rounded-xl bg-[#E3EAF2]" />)}</div> : null}
        {!loading && shown.length === 0 ? <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-[#6D7E91]"><Folder size={34} /><p className="text-sm">{view === "favorites" ? "No favorite files yet." : view === "trash" ? "Trash is empty." : "No files in this category yet."}</p></div> : null}
        {!loading && media.length ? <section>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#6D7E91]"><Images size={16} /> Photos & videos</h3>
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
                  {organizationAvailable && view !== "trash" ? <button type="button" aria-pressed={file.favorite} aria-label={`${file.favorite ? "Remove from" : "Add to"} favorites: ${file.name}`} onClick={() => void toggleFavorite(file)} className="rounded-lg bg-black/65 p-2 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white"><Heart size={16} fill={file.favorite ? "currentColor" : "none"} /></button> : null}
                  <button type="button" disabled={!file.previewUrl} aria-label={`Preview ${file.name}`} onClick={() => setPreview(file)} className="rounded-lg bg-black/65 p-2 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"><Eye size={16} /></button>
                </div>
              </article>;
            })}
          </div>
        </section> : null}
        {!loading && documents.length ? <section className={media.length ? "mt-6" : ""}>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#6D7E91]"><FileText size={16} /> Files</h3>
          <div className="divide-y divide-[#E3EAF2] overflow-hidden rounded-2xl border border-[#E3EAF2]">
            {documents.map((file) => <article key={file.id} className={`flex items-center gap-2 p-2 sm:p-3 ${selected.has(file.id) ? "bg-[#EAF7FF]" : "bg-white"}`}>
              <button type="button" aria-pressed={selected.has(file.id)} onClick={() => toggleSelected(file.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left focus-visible:outline-2 focus-visible:outline-[#0089CC]">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#0089CC]"><FileText size={21} /></span>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold text-[#102238]">{file.name}</span><span className="block text-xs text-[#6D7E91]">{fileSize(file.sizeBytes)}</span></span>
              </button>
              {organizationAvailable && view !== "trash" ? <button type="button" aria-pressed={file.favorite} aria-label={`${file.favorite ? "Remove from" : "Add to"} favorites: ${file.name}`} onClick={() => void toggleFavorite(file)} className="rounded-xl p-3 text-[#0089CC] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#0089CC]"><Heart size={18} fill={file.favorite ? "currentColor" : "none"} /></button> : null}
            </article>)}
          </div>
        </section> : null}
      </main>

      <footer className="flex items-center justify-between border-t border-[#E3EAF2] px-4 py-3 sm:px-5 sm:py-4">
        <span className="text-sm text-[#6D7E91]" aria-live="polite">{selected.size} selected</span>
        {view !== "trash" ? <button type="button" disabled={!selected.size || sending || uploading || busy} onClick={() => void sendSelected()} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#0089CC] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Send size={17} />{sending ? "Sending..." : "Send"}</button> : null}
      </footer>
    </div>
    {preview ? <Preview file={preview} onClose={() => setPreview(null)} /> : null}
    <ConfirmActionDialog open={Boolean(confirm)} title={confirm?.kind === "category" ? `Delete “${confirm.category.name}”?` : `Delete ${selected.size} selected file${selected.size === 1 ? "" : "s"}?`} description={confirm?.kind === "category" ? "The category will be removed from shared Storage." : "The selected files will move to Storage Trash."} note={confirm?.kind === "category" ? "Files in this category are kept and become uncategorised." : "A workspace content manager can restore them later from Trash."} confirmLabel="Delete" loadingLabel="Deleting..." loading={busy} icon="trash" error={error} onCancel={() => { if (!busy) setConfirm(null); }} onConfirm={() => void deleteConfirmed()} />
  </div>;
}
