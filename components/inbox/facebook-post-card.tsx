"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergePostPreview, safePostLink, type PostPreviewData, type FacebookCommentParent } from "@/lib/facebook/post-preview-data";

type Props = {
  conversationId: string;
  messageId: string;
  postId: string | null;
  savedPreview: unknown;
  accountName: string;
  isKhmer: boolean;
  onOpenImage: (image: { src: string; alt: string }) => void;
  parentId?: string | null;
  savedParent?: FacebookCommentParent | null;
  showPost?: boolean;
  showParentContext?: boolean;
};

/** Missing metadata and expired images are repaired on demand, not by the
 * message-page polling loop. Failures leave the comment and saved text visible. */
export function FacebookPostCard({ conversationId, messageId, postId, savedPreview, accountName, isKhmer, onOpenImage, parentId, savedParent, showPost = true, showParentContext = true }: Props) {
  const [fresh, setFresh] = useState<PostPreviewData | null>(null);
  const [freshParent, setFreshParent] = useState<FacebookCommentParent | null>(null);
  const [resolvedParentId, setResolvedParentId] = useState<string | null | undefined>(undefined);
  const [failedParentImage, setFailedParentImage] = useState<string | null>(null);
  const [commentLink, setCommentLink] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const recoveryAttempted = useRef(false);
  const preview = mergePostPreview(savedPreview, fresh, postId ?? "");
  const effectiveParentId = resolvedParentId === undefined ? parentId : resolvedParentId;
  const currentSavedParent = savedParent?.id === effectiveParentId ? savedParent : null;
  const parent = currentSavedParent && currentSavedParent.status !== "unavailable" ? currentSavedParent :
    freshParent?.id === effectiveParentId ? freshParent : currentSavedParent;
  const photos = preview.photos?.length ? preview.photos : preview.full_picture ? [{ id: null, src: preview.full_picture, permalink_url: null }] : [];
  const associatedPhoto = preview.photo_id ? photos.find(photo => photo.id === preview.photo_id) : null;
  const visiblePhotos = (preview.photo_id ? associatedPhoto ? [associatedPhoto] : [] : photos.slice(0, 4)).filter(photo => !failedImages.includes(photo.src));
  const src = visiblePhotos[0]?.src;
  const isAlbum = photos.length > 1;
  const needsMetadata = (showPost && (!preview.message || !photos.length || preview.attachments_complete === undefined)) ||
    preview.comment_object_id === undefined || (!!parentId && (!parent || parent.status === "unavailable")) || (!showPost && !!postId && !preview.permalink_url);

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
      const result = await response.json() as { success?: boolean; preview?: PostPreviewData | null; parent?: FacebookCommentParent | null; parent_id?: string | null; comment_permalink_url?: string | null };
      if (!controller.signal.aborted && result.success) {
        if (result.preview) setFresh(result.preview);
        if (Object.prototype.hasOwnProperty.call(result, "parent_id")) setResolvedParentId(result.parent_id ?? null);
        setFreshParent(result.parent ?? null);
        setCommentLink(safePostLink(result.comment_permalink_url));
      }
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

  function imageFailed(source: string) {
    setFailedImages(current => current.includes(source) ? current : [...current, source]);
  }

  // An image can fail while the initial metadata request is still in flight.
  // Queue the single recovery instead of dropping it behind the in-flight guard.
  useEffect(() => {
    if (failedImages.length && !loading && !recoveryAttempted.current) {
      recoveryAttempted.current = true;
      void load(true);
    }
  }, [failedImages, loading, load]);

  if (!showPost && !showParentContext) return null;

  return (
    <div className={showPost ? "max-w-[860px] p-1 sm:p-2" : "my-2 max-w-[620px]"}>
      {showPost ? <div className="flex min-w-0 items-stretch gap-3 rounded-[18px] border border-slate-200 bg-white p-3 shadow-[0_3px_14px_rgba(15,23,42,0.04)] sm:gap-4" aria-busy={loading}>
        {src ? (
          <div className={`h-[112px] w-[112px] shrink-0 overflow-hidden rounded-[15px] bg-slate-50 sm:h-[132px] sm:w-[132px] ${visiblePhotos.length > 1 ? "grid grid-cols-2 gap-0.5" : ""}`}>
            {visiblePhotos.map(photo => <button key={photo.id ?? photo.src} type="button" onClick={() => onOpenImage({ src: photo.src, alt: associatedPhoto ? "Associated Facebook photo" : "Facebook post" })}
              className="h-full w-full overflow-hidden text-left" aria-label={associatedPhoto ? "Open associated Facebook photo" : "Open Facebook post image"}>
              <img src={photo.src} alt={associatedPhoto ? "Associated Facebook photo" : "Facebook post"} loading="lazy" decoding="async" referrerPolicy="no-referrer"
                onError={() => imageFailed(photo.src)} className="h-full w-full object-cover transition duration-200 hover:scale-[1.02]" />
            </button>)}
          </div>
        ) : (
          <div className="flex h-[112px] w-[112px] shrink-0 flex-col items-center justify-center gap-2 rounded-[15px] bg-blue-50 p-2 text-center text-blue-600 sm:h-[132px] sm:w-[132px]">
            <span className="text-4xl font-bold" aria-hidden="true">f</span>
            <span className="text-[11px]">{loading ? (isKhmer ? "កំពុងផ្ទុក…" : "Loading preview…") : failedImages.length ? (isKhmer ? "មិនអាចបង្ហាញរូបភាព" : "Image unavailable") : "Facebook Post"}</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 font-bold text-white" aria-hidden="true">f</span>
            <span>{associatedPhoto ? "Comment on photo" : isAlbum ? "Album context" : isKhmer ? "មតិយោបល់លើការបង្ហោះ" : "Comment on post"}{preview.id ? ` #${preview.id.replace(/[^A-Za-z0-9]/g, "").slice(-8)}` : ""}</span>
          </div>
          {isAlbum && !associatedPhoto ? <p className="mt-1 text-xs text-slate-500">{photos.length}{preview.attachments_complete === false ? "+" : ""} photos · {preview.comment_object_id === preview.id ? "Comment on the whole post" : "Specific photo not identified"}</p> : null}
          <div className="mt-2 text-[22px] font-bold tracking-[-0.02em] text-slate-950 sm:text-[25px]">{accountName}</div>
          {preview.message ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-500 sm:text-base">{preview.message}</p> :
            attempted && !src && !loading ? <p className="mt-2 text-xs text-slate-500">{isKhmer ? "មិនអាចផ្ទុកការបង្ហោះបាននៅពេលនេះ។" : "Post preview is unavailable right now."}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {associatedPhoto?.permalink_url ? <a href={associatedPhoto.permalink_url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-blue-600">View Photo ↗</a> : null}
            {commentLink ? <a href={commentLink} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600">View Comment ↗</a> : null}
            {preview.permalink_url ? <a href={preview.permalink_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">{isKhmer ? "មើលការបង្ហោះ" : "View Post"}<span aria-hidden="true">↗</span></a> : null}
            {attempted && (failedImages.length > 0 || (!src && !preview.message)) ? <button type="button" disabled={loading} onClick={() => { recoveryAttempted.current = false; setFailedImages([]); void load(true); }} className="text-xs font-medium text-slate-500 hover:text-blue-600 disabled:opacity-50">{loading ? (isKhmer ? "កំពុងផ្ទុក…" : "Loading…") : (isKhmer ? "ព្យាយាមម្ដងទៀត" : "Retry preview")}</button> : null}
          </div>
        </div>
      </div> : null}
      {showParentContext && (effectiveParentId || parent) ? <div className="mt-2 rounded-xl border-l-[3px] border-blue-400 bg-slate-50 px-3 py-2 text-xs text-slate-600" aria-busy={loading}>
        <div className="font-semibold">{parent?.status === "deleted" ? "Reply to deleted comment" : parent?.author ? `Reply to ${parent.author}` : parent?.status === "available" || parent?.status === "media" ? "Reply to comment · author unavailable" : "Reply to unavailable comment"}</div>
        <div className="mt-1 whitespace-pre-wrap">{parent?.status === "deleted" ? "Parent comment was deleted" : parent?.text ?? (parent?.image && parent.image !== failedParentImage ? "Photo reply · no text" : parent?.status === "media" ? "Media reply · preview unavailable" : loading ? "Loading parent context…" : "Parent comment is unavailable")}</div>
        {parent?.image && parent.image !== failedParentImage && parent.status !== "deleted" ? <button type="button" className="mt-2" aria-label="Open parent reply image" onClick={() => onOpenImage({ src: parent.image!, alt: "Parent reply" })}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Provider comment media uses short-lived URLs. */}
          <img src={parent.image} alt="Parent reply" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedParentImage(parent.image)} className="h-16 w-16 rounded-lg object-cover" />
        </button> : null}
        {parent?.permalink_url ? <a href={parent.permalink_url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-blue-600">View Reply ↗</a> : null}
        {!showPost && preview.permalink_url ? <a href={preview.permalink_url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-blue-600">View Post ↗</a> : null}
      </div> : null}
    </div>
  );
}
