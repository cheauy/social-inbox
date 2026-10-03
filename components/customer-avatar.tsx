"use client";

import { useState } from "react";

// Rows can unmount on view changes. Remember the working candidate so a
// missing stored photo is not retried before the same already-loaded photo.
const loadedCandidates = new Map<string, string>();

/** Failures belong to a URL, so a newly synced photo automatically gets a try. */
export function CustomerAvatar({ src, name, contactId, platform, className = "h-10 w-10", eager = false }: {
  src?: string | null;
  name?: string | null;
  contactId?: string;
  platform?: string | null;
  className?: string;
  eager?: boolean;
}) {
  const original = src?.trim() || null;
  const stored = contactId && (platform === "facebook" || platform === "messenger" || platform === "telegram")
    ? `/api/contacts/${encodeURIComponent(contactId)}/${platform === "telegram" ? "telegram" : "facebook"}-avatar`
    : null;
  const candidates = (platform === "facebook" || platform === "messenger") ? [stored, original] : [original, stored];
  const identity = JSON.stringify([original, stored]);
  return <CustomerAvatarImage key={identity} candidates={candidates} identity={identity}
    name={name} className={className} eager={eager} />;
}

function CustomerAvatarImage({ candidates, identity, name, className, eager }: {
  candidates: (string | null)[];
  identity: string;
  name?: string | null;
  className: string;
  eager: boolean;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const [preferred] = useState(() => loadedCandidates.get(identity));
  const url = [preferred, ...candidates].find((value) => value && !failed.includes(value));
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-700 ${className}`}>
      <span aria-hidden="true">{Array.from(name?.trim() || "?")[0].toUpperCase()}</span>
      {url ? <img key={url} src={url} alt={name || "Customer"} loading={eager ? "eager" : "lazy"}
        decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover"
        onLoad={() => {
          loadedCandidates.delete(identity);
          loadedCandidates.set(identity, url);
          while (loadedCandidates.size > 500) loadedCandidates.delete(loadedCandidates.keys().next().value!);
        }}
        onError={() => {
          if (loadedCandidates.get(identity) === url) loadedCandidates.delete(identity);
          setFailed((values) => values.includes(url) ? values : [...values, url]);
        }} /> : null}
    </span>
  );
}
