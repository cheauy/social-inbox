"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergePostPreview, type PostPreviewData } from "@/lib/facebook/post-preview-data";

type Props = {
  conversationId: string;
  messageId: string;
  postId: string | null;
  savedPreview: unknown;
  accountName: string;
  isKhmer: boolean;
  onOpenImage: (image: { src: string; alt: string }) => void;
};

/** Missing metadata and expired images are repaired on demand, not by the
 * message-page polling loop. Failures leave the comment and saved text visible. */
export function FacebookPostCard({ conversationId, messageId, postId, savedPreview, accountName, isKhmer, onOpenImage }: Props) {
  const [fresh, setFresh] = useState<PostPreviewData | null>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const recoveryAttempted = useRef(false);
  const preview = mergePostPreview(savedPreview, fresh, postId ?? "");
  const src = preview.full_picture === failedImage ? null : preview.full_picture;
  const needsMetadata = !preview.message || !preview.full_picture;

  const load = useCallback(async (refresh: boolean) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setLoading(true);
    try {
      const params = new URLSearchParams({ conversationId, messageId });
      if (refresh) params.set("refresh", "1");
      const response = await fetch(`/api/facebook/post-preview?${params}`, {
        cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const result = await response.json() as { success?: boolean; preview?: PostPreviewData | null };
      if (!controller.signal.aborted && result.success && result.preview) setFresh(result.preview);
    } catch { /* A failed preview must never hide the comment or interrupt inbox. */ }
    finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
        setAttempted(true);
      }
    }
  }, [conversationId, messageId]);

  useEffect(() => {
    if (needsMetadata) void load(false);
    // Do not make an empty/text-only post re-fetch on every message render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messageId]);

  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
  }, []);

  function imageFailed() {
    setFailedImage(preview.full_picture);
  }

  // An image can fail while the initial metadata request is still in flight.
  // Queue the single recovery instead of dropping it behind the in-flight guard.
  useEffect(() => {
    if (failedImage && !loading && !recoveryAttempted.current) {
      recoveryAttempted.current = true;
      void load(true);
    }
  }, [failedImage, loading, load]);

  return (
    <div className="max-w-[860px] p-1 sm:p-2">
      <div className="flex min-w-0 items-stretch gap-3 rounded-[18px] border border-slate-200 bg-white p-3 shadow-[0_3px_14px_rgba(15,23,42,0.04)] sm:gap-4" aria-busy={loading}>
        {src ? (
          <button type="button" onClick={() => onOpenImage({ src, alt: "Facebook post" })}
            className="h-[112px] w-[112px] shrink-0 overflow-hidden rounded-[15px] bg-slate-50 text-left sm:h-[132px] sm:w-[132px]"
            aria-label="Open Facebook post image">
            <img key={src} src={src} alt="Facebook post" loading="lazy" decoding="async" referrerPolicy="no-referrer"
              onError={imageFailed} className="h-full w-full object-cover transition duration-200 hover:scale-[1.02]" />
          </button>
        ) : (
          <div className="flex h-[112px] w-[112px] shrink-0 flex-col items-center justify-center gap-2 rounded-[15px] bg-blue-50 p-2 text-center text-blue-600 sm:h-[132px] sm:w-[132px]">
            <span className="text-4xl font-bold" aria-hidden="true">f</span>
            <span className="text-[11px]">{loading ? (isKhmer ? "កំពុងផ្ទុក…" : "Loading preview…") : failedImage ? (isKhmer ? "មិនអាចបង្ហាញរូបភាព" : "Image unavailable") : "Facebook Post"}</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold text-white" aria-hidden="true">f</span>
            <span>{isKhmer ? "មតិយោបល់លើការបង្ហោះ" : "Comment on post"}{preview.id ? ` #${preview.id.replace(/[^A-Za-z0-9]/g, "").slice(-8)}` : ""}</span>
          </div>
          <div className="mt-2 text-[22px] font-bold tracking-[-0.02em] text-slate-950 sm:text-[25px]">{accountName}</div>
          {preview.message ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-500 sm:text-base">{preview.message}</p> :
            attempted && !src && !loading ? <p className="mt-2 text-xs text-slate-500">{isKhmer ? "មិនអាចផ្ទុកការបង្ហោះបាននៅពេលនេះ។" : "Post preview is unavailable right now."}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {preview.permalink_url ? <a href={preview.permalink_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">{isKhmer ? "មើលការបង្ហោះ" : "View Post"}<span aria-hidden="true">↗</span></a> : null}
            {attempted && (failedImage || (!src && !preview.message)) ? <button type="button" disabled={loading} onClick={() => { recoveryAttempted.current = false; setFailedImage(null); void load(true); }} className="text-xs font-medium text-slate-500 hover:text-blue-600 disabled:opacity-50">{loading ? (isKhmer ? "កំពុងផ្ទុក…" : "Loading…") : (isKhmer ? "ព្យាយាមម្ដងទៀត" : "Retry preview")}</button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
