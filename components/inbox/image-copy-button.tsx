"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check, Loader2, AlertCircle } from "lucide-react";
import { copyInboxImage } from "@/lib/inbox/image-clipboard";
import type { ReplyImageReference } from "@/lib/inbox/message-actions";

type Props = { src: string; reference?: ReplyImageReference; shortcut?: boolean; className?: string; iconOnly?: boolean; label?: string };

/** No prefetch/polling: image bytes are requested only after an explicit Copy. */
export function ImageCopyButton({ src, reference, shortcut = false, className = "", iconOnly = false, label = "Copy image" }: Props) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied">("idle");
  const [error, setError] = useState("");
  const pending = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const conversationId = reference?.conversationId, messageId = reference?.messageId;
  const platformMessageId = reference?.platformMessageId, photoIndex = reference?.photoIndex;
  const copy = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; setStatus("copying"); setError("");
    try {
      await copyInboxImage(src, conversationId ? { conversationId, messageId, platformMessageId, photoIndex } : undefined);
      if (alive.current) setStatus("copied");
    } catch (cause) {
      if (alive.current) { setStatus("idle"); setError(cause instanceof Error ? cause.message : "Unable to copy this image."); }
    } finally { pending.current = false; }
  }, [src, conversationId, messageId, platformMessageId, photoIndex]);
  useEffect(() => {
    if (!shortcut) return;
    const handle = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c" || event.altKey || event.shiftKey) return;
      if (window.getSelection()?.toString()) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;
      event.preventDefault(); void copy();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [shortcut, copy]);
  return <div className={className}>
    <button type="button" disabled={status === "copying"} aria-label={label} title={iconOnly && error ? error : iconOnly && status === "copied" ? "Copied" : shortcut ? "Copy image (Ctrl/Cmd+C)" : label}
      onClick={event => { event.stopPropagation(); void copy(); }}
      className={`touch-manipulation inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white/95 text-xs font-medium text-slate-700 shadow-sm hover:bg-white focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-wait ${iconOnly ? "h-8 w-8 justify-center" : "gap-1.5 px-2.5 py-1.5"}`}>
      {status === "copying" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status === "copied" ? <Check className="h-3.5 w-3.5" /> : iconOnly && error ? <AlertCircle className="h-3.5 w-3.5 text-amber-700" /> : <Copy className="h-3.5 w-3.5" />}
      <span aria-live="polite" className={iconOnly ? "sr-only" : undefined}>{status === "copied" ? "Copied" : status === "copying" ? "Copying…" : "Copy"}</span>
    </button>
    {error ? <p role="alert" className={iconOnly ? "sr-only" : "mt-1 max-w-56 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900 shadow"}>{error}</p> : null}
  </div>;
}
