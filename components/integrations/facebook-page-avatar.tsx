"use client";

import { useMemo, useState } from "react";

type FacebookPageAvatarProps = {
  pageId: string | null;
  pageName: string;
  className?: string;
};

function initials(name: string) {
  const value = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  return value || "FB";
}

export function FacebookPageAvatar({
  pageId,
  pageName,
  className = "h-11 w-11",
}: FacebookPageAvatarProps) {
  const [failed, setFailed] = useState(false);

  const imageUrl = useMemo(() => {
    const normalizedPageId = pageId?.trim();
    if (!normalizedPageId) return null;

    return `https://graph.facebook.com/${encodeURIComponent(
      normalizedPageId,
    )}/picture?type=large&width=96&height=96`;
  }, [pageId]);

  if (!imageUrl || failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600 ${className}`}
        aria-label={`${pageName} profile picture unavailable`}
      >
        {initials(pageName)}
      </div>
    );
  }

  return (
    <div
      className={`shrink-0 overflow-hidden rounded-full bg-slate-100 ${className}`}
    >
      <img
        src={imageUrl}
        alt={`${pageName} Facebook Page profile`}
        className="h-full w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        draggable={false}
      />
    </div>
  );
}
