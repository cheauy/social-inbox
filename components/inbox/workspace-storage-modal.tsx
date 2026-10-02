"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Send, Upload, X } from "lucide-react";

import { CustomerFileLibrary, type LibraryItem, type LibraryTab } from "./customer-file-library";
import { createClient } from "@/lib/supabase/client";
import { WORKSPACE_FILE_ACCEPT, WORKSPACE_FILE_MAX_BYTES, workspaceFileKind } from "@/lib/storage/workspace-files";

type WorkspaceFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video" | "audio" | "file";
  createdAt: string;
  previewUrl: string | null;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  files?: WorkspaceFile[];
  signedUrl?: string;
  upload?: { bucket: string; path: string; token: string };
};

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeType(file: File) {
  return file.type.trim().toLowerCase() || "application/octet-stream";
}

async function api(body?: object): Promise<ApiResponse> {
  const response = await fetch("/api/workspace-storage/files", body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : { cache: "no-store" });
  const result = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok || !result.success) throw new Error(result.error || "Workspace Storage request failed.");
  return result;
}

export function WorkspaceStorageModal({ onClose, onSend }: {
  onClose: () => void;
  onSend: (files: File[]) => Promise<boolean>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const uploadInput = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const close = useRef(onClose);
  const [tab, setTab] = useState<LibraryTab>("media");
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api();
      if (active.current) setFiles(result.files ?? []);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Unable to load Workspace Storage.");
    } finally {
      if (active.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    active.current = true;
    const initialLoad = window.requestAnimationFrame(() => void load());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      active.current = false;
      window.cancelAnimationFrame(initialLoad);
      window.removeEventListener("keydown", onKey);
    };
  }, [load]);

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!chosen.length) return;

    setUploading(true);
    setError(null);
    const failures: string[] = [];
    for (const file of chosen) {
      const type = mimeType(file);
      if (!workspaceFileKind(file.name, type) || file.size <= 0 || file.size > WORKSPACE_FILE_MAX_BYTES) {
        failures.push(`${file.name}: unsupported type or larger than 20 MB`);
        continue;
      }
      try {
        const prepared = await api({ action: "prepare-upload", fileName: file.name, mimeType: type, sizeBytes: file.size });
        if (!prepared.upload) throw new Error("Upload details were missing.");
        const upload = prepared.upload;
        const { error: uploadError } = await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path, upload.token, file, { contentType: type });
        if (uploadError) throw uploadError;
        await api({ action: "finalize-upload", fileName: file.name, mimeType: type, sizeBytes: file.size, storagePath: upload.path });
      } catch (cause) {
        failures.push(`${file.name}: ${cause instanceof Error ? cause.message : "upload failed"}`);
      }
    }
    if (!active.current) return;
    setUploading(false);
    if (failures.length) setError(`Some files were not uploaded:\n${failures.join("\n")}`);
    await load();
  }

  async function sendSelected() {
    const chosen = files.filter((file) => selected.has(file.id));
    if (!chosen.length) return;
    setSending(true);
    setError(null);
    try {
      const downloaded = await Promise.all(chosen.map(async (file) => {
        const result = await api({ action: "get-file-url", fileId: file.id });
        if (!result.signedUrl) throw new Error(`Unable to open ${file.name}.`);
        const response = await fetch(result.signedUrl);
        if (!response.ok) throw new Error(`Unable to download ${file.name}.`);
        return new File([await response.blob()], file.name, { type: file.mimeType });
      }));
      if (!active.current) return;
      if (await onSend(downloaded)) close.current();
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : "Unable to send the selected files.");
    } finally {
      if (active.current) setSending(false);
    }
  }

  const items: LibraryItem[] = files.map((file) => ({
    id: file.id,
    selectableId: file.id,
    kind: file.kind,
    name: file.name,
    url: file.previewUrl,
    createdAt: file.createdAt,
    detail: `${fileSize(file.sizeBytes)} - Shared workspace file`,
  }));

  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label="Workspace Storage">
    <div className="flex h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <header className="flex items-center gap-3 border-b border-[#E3EAF2] px-5 py-4">
        <div className="min-w-0 flex-1"><h2 className="font-bold text-[#102238]">Storage</h2><p className="text-xs text-[#6D7E91]">Shared with everyone in this workspace</p></div>
        <input ref={uploadInput} type="file" multiple accept={WORKSPACE_FILE_ACCEPT} onChange={uploadFiles} className="hidden" />
        <button type="button" disabled={uploading || sending} onClick={() => uploadInput.current?.click()} className="flex items-center gap-2 rounded-xl bg-[#EAF7FF] px-3 py-2 text-sm font-bold text-[#0089CC] disabled:opacity-50"><Upload size={17} />{uploading ? "Uploading..." : "Upload"}</button>
        <button type="button" onClick={onClose} aria-label="Close Storage" className="rounded-full p-2 text-[#6D7E91] hover:bg-slate-100"><X size={20} /></button>
      </header>
      {error ? <p className="whitespace-pre-line border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700" role="alert">{error}</p> : null}
      <CustomerFileLibrary items={items} tab={tab} onTab={setTab} loading={loading} deletingId={null} onDelete={() => {}} onDownload={() => {}} selectedIds={selected} onToggleSelect={(id) => setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      })} visibleTabs={["media", "files"]} emptyMessages={{ media: "No shared photos or videos yet.", files: "No shared files yet." }} loadingLabel="Loading workspace files" />
      <footer className="flex items-center justify-between border-t border-[#E3EAF2] px-5 py-4">
        <span className="text-sm text-[#6D7E91]">{selected.size} selected</span>
        <button type="button" disabled={!selected.size || sending || uploading} onClick={() => void sendSelected()} className="flex items-center gap-2 rounded-xl bg-[#0089CC] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"><Send size={17} />{sending ? "Sending..." : "Send"}</button>
      </footer>
    </div>
  </div>;
}
