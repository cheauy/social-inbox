"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Rows can unmount on view changes. Remember the working candidate so a
// missing stored photo is not retried before the same already-loaded photo.
const loadedCandidates = new Map<string, string>();
type AvatarCache = {
  loaded: Map<string, string>;
  failed: Map<string, { urls: string[]; until: number }>;
};
const AvatarCacheContext = createContext<AvatarCache | null>(null);

// Owned by one authenticated Inbox page, above the selected-thread key.
export function CustomerAvatarCacheProvider({ children }: { children: ReactNode }) {
  const [cache] = useState<AvatarCache>(() => ({ loaded: new Map(), failed: new Map() }));
  return <AvatarCacheContext.Provider value={cache}>{children}</AvatarCacheContext.Provider>;
}

/** Failures belong to a URL, so a newly synced photo automatically gets a try. */
export function CustomerAvatar({ src, name, contactId, businessId, platform, className = "h-10 w-10", eager = false }: {
  src?: string | null;
  name?: string | null;
  contactId?: string;
  businessId?: string;
  platform?: string | null;
  className?: string;
  eager?: boolean;
}) {
  const cache = useContext(AvatarCacheContext);
  const original = src?.trim() || null;
  const stored = contactId && (platform === "facebook" || platform === "messenger" || platform === "telegram")
    ? `/api/contacts/${encodeURIComponent(contactId)}/${platform === "telegram" ? "telegram" : "facebook"}-avatar`
    : null;
  const candidates = (platform === "facebook" || platform === "messenger") ? [stored, original] : [original, stored];
  const identity = JSON.stringify([businessId, contactId, original, stored]);
  return <CustomerAvatarImage key={identity} candidates={candidates} identity={identity} cache={cache}
    name={name} className={className} eager={eager} />;
}

function CustomerAvatarImage({ candidates, identity, cache, name, className, eager }: {
  candidates: (string | null)[];
  identity: string;
  cache: AvatarCache | null;
  name?: string | null;
  className: string;
  eager: boolean;
}) {
  const loaded = cache?.loaded ?? loadedCandidates;
  const [failed, setFailed] = useState<string[]>(() => {
    const previous = cache?.failed.get(identity);
    if (previous && previous.until > Date.now()) return previous.urls;
    return [];
  });
  const [preferred] = useState(() => loaded.get(identity));
  const url = [preferred, ...candidates].find((value) => value && !failed.includes(value));
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-700 ${className}`}>
      <span aria-hidden="true">{Array.from(name?.trim() || "?")[0].toUpperCase()}</span>
      {url ? <img key={url} src={url} alt={name || "Customer"} loading={eager ? "eager" : "lazy"}
        decoding="async" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover"
        onLoad={() => {
          cache?.failed.delete(identity);
          loaded.delete(identity);
          loaded.set(identity, url);
          while (loaded.size > 500) loaded.delete(loaded.keys().next().value!);
        }}
        onError={() => {
          if (loaded.get(identity) === url) loaded.delete(identity);
          const previous = cache?.failed.get(identity);
          const urls = [...new Set([...failed, ...(previous && previous.until > Date.now() ? previous.urls : []), url])];
          if (cache) {
            // Retry transient failures on a later mount; a changed source retries immediately.
            cache.failed.delete(identity);
            cache.failed.set(identity, { urls, until: Date.now() + 30_000 });
            while (cache.failed.size > 500) cache.failed.delete(cache.failed.keys().next().value!);
          }
          setFailed(urls);
        }} /> : null}
    </span>
  );
}
