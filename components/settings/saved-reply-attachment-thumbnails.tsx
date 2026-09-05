"use client";

import { useEffect, useState } from "react";

import type { SavedReplyAttachment } from "@/types/inbox";

/*
 * At most two thumbnails, then a count.
 *
 * One attachment shows one, two show two, and anything beyond that shows two
 * and "+N". The row is a list entry, not a gallery -- its job is to say at a
 * glance that this reply carries media and roughly how much, and three small
 * squares say that no better than two do while costing another signed-URL
 * request per row.
 */
const MAX_THUMBNAILS = 2;

function VideoBadge() {
  return (
    <span className="flex h-full w-full items-center justify-center bg-slate-900/80 text-white">
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
    </span>
  );
}

function FallbackBadge() {
  return (
    <span className="flex h-full w-full items-center justify-center bg-slate-100 text-slate-400">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <rect
          x="3"
          y="5"
          width="18"
          height="14"
          rx="2"
        />
        <path d="m4 16 4.5-4.5 3 3L15 11l5 5" />
      </svg>
    </span>
  );
}

/*
 * The media bucket is private, so a path has to be exchanged for a signed link
 * before it can be shown. That is one request per thumbnail, which is why only
 * the rows on screen ask for one and why a failure quietly falls back to the
 * placeholder rather than retrying.
 */
function Thumbnail({
  attachment,
}: {
  attachment: SavedReplyAttachment;
}) {
  /*
   * The list API signs these in one batch, so most of the time the link is
   * already here and no request is made at all. The fetch below stays for the
   * places that read attachments straight from a row -- the edit form -- where
   * there is nothing to have batched.
   */
  const [url, setUrl] = useState<
    string | null
  >(attachment.url ?? null);
  const [failed, setFailed] =
    useState(false);

  useEffect(() => {
    if (
      attachment.kind !== "image" ||
      attachment.url
    ) {
      return;
    }

    let cancelled = false;

    void fetch(
      `/api/saved-replies/media?path=${encodeURIComponent(
        attachment.path,
      )}`,
      { cache: "no-store" },
    )
      .then((response) => response.json())
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (
          result?.success &&
          typeof result.url === "string"
        ) {
          setUrl(result.url);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    attachment.kind,
    attachment.path,
    attachment.url,
  ]);

  return (
    <span
      className="h-7 w-7 shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200"
      title={attachment.name}
    >
      {attachment.kind === "video" ? (
        <VideoBadge />
      ) : url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={attachment.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <FallbackBadge />
      )}
    </span>
  );
}

export function AttachmentThumbnails({
  attachments,
  className = "mt-1.5",
}: {
  attachments: SavedReplyAttachment[];

  /* The settings list stacks these under the text; the inbox sets them beside it. */
  className?: string;
}) {
  if (attachments.length === 0) {
    return null;
  }

  const shown = attachments.slice(
    0,
    MAX_THUMBNAILS,
  );
  const remaining =
    attachments.length - shown.length;

  return (
    <span
      className={`flex items-center gap-1 ${className}`}
    >
      {shown.map((attachment) => (
        <Thumbnail
          key={attachment.path}
          attachment={attachment}
        />
      ))}

      {remaining > 0 ? (
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
          +{remaining}
        </span>
      ) : null}
    </span>
  );
}
