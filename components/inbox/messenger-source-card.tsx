"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, ImageOff, Megaphone, MessageSquare } from "lucide-react";
import type { MessengerSource } from "@/lib/facebook/messenger-source";
import { messengerSourceImageUrl } from "@/lib/facebook/messenger-source";

export function MessengerSourceCard({ source, conversationId, messageId, onOpenImage }: {
  source: MessengerSource;
  conversationId?: string;
  messageId?: string;
  onOpenImage: (image: { src: string; alt: string }) => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const attempted = useRef(false);
  const imageUrl = freshUrl ?? source.image_url;
  useEffect(() => {
    if ((!imageUrl || failedUrl === imageUrl) && source.post_id && conversationId && messageId && !attempted.current) {
      attempted.current = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      void (async () => {
        try {
          const params = new URLSearchParams({ conversationId, messageId, source: "1", refresh: "1" });
          const response = await fetch(`/api/facebook/post-preview?${params}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) return;
          const result = await response.json();
          if (!controller.signal.aborted && result.success) setFreshUrl(messengerSourceImageUrl(result.preview?.full_picture));
        } catch { /* Preserve the source IDs and text if Meta cannot recover the photo. */ }
        finally { clearTimeout(timeout); }
      })();
      return () => { clearTimeout(timeout); controller.abort(); };
    }
  }, [imageUrl, failedUrl, source.post_id, conversationId, messageId]);
  if (!source.message_id) return null;
  const label = source.kind === "ad" ? "Message from an ad" : "Message from a post";
  const Icon = source.kind === "ad" ? Megaphone : MessageSquare;
  return (
    <article aria-label={label} className="w-full max-w-[520px] rounded-2xl border border-blue-200 bg-white/95 p-3 shadow-sm">
      <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-blue-700">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{label}</span>
      </div>
      <div className="flex items-start gap-3">
        {imageUrl && failedUrl !== imageUrl ? (
          <button type="button" aria-label="Open source photo"
            className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500 sm:h-28 sm:w-28"
            onClick={() => onOpenImage({ src: imageUrl, alt: source.title ?? "Facebook source photo" })}>
            <img key={imageUrl} src={imageUrl} alt={source.title ?? "Facebook source photo"}
              loading="lazy" decoding="async" referrerPolicy="no-referrer"
              className="h-full w-full object-cover" onError={() => setFailedUrl(imageUrl)} />
          </button>
        ) : (
          <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-slate-50 px-2 text-center text-[11px] text-slate-400 sm:h-28 sm:w-28">
            <ImageOff className="h-5 w-5" aria-hidden="true" />
            <span>Photo unavailable</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          {source.title ? <p className="mb-2 line-clamp-3 whitespace-pre-wrap text-sm font-medium text-slate-800">{source.title}</p> : null}
          <dl className="space-y-1 text-xs">
            {source.post_id ? <div><dt className="text-slate-500">Post ID</dt><dd className="select-text break-all font-mono text-slate-700">{source.post_id}</dd></div> : null}
            {source.ad_id ? <div><dt className="text-slate-500">Ad ID</dt><dd className="select-text break-all font-mono text-slate-700">{source.ad_id}</dd></div> : null}
          </dl>
          {source.post_url ? (
            <a href={source.post_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline">
              View post <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
      {source.occurred_at ? <time dateTime={source.occurred_at} suppressHydrationWarning className="mt-2 block text-right text-[10px] text-slate-400">{new Date(source.occurred_at).toLocaleString()}</time> : null}
    </article>
  );
}
