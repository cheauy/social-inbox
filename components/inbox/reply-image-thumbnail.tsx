"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { inboxImageEndpoint, type ReplyImageReference } from "@/lib/inbox/message-actions";

export function ReplyImageThumbnail({ reference }: { reference: ReplyImageReference }) {
  const [failedDirect, setFailedDirect] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const fallback = inboxImageEndpoint(reference, true);
  // A URL already used by the loaded original normally comes from browser
  // cache. Missing/expired media is fetched through an authorized thumbnail.
  const src = !failedDirect && reference.url ? reference.url : fallback;
  return <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200/60 bg-slate-100" title={unavailable ? "Photo unavailable" : "Replied photo"}>
    {unavailable ? <ImageIcon className="h-5 w-5 text-slate-400" aria-label="Photo unavailable" /> :
      <img src={src} alt="Replied photo" loading="lazy" decoding="async" className="h-full w-full object-cover"
        onError={() => { if (src !== fallback) setFailedDirect(true); else setUnavailable(true); }} />}
  </span>;
}
