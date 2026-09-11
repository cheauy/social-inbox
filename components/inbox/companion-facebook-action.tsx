"use client";

import { ExternalLink } from "lucide-react";

type Props = {
  pageId: string | null;
};

export function CompanionFacebookAction({ pageId }: Props) {
  const url = new URL("https://business.facebook.com/latest/inbox/all/");
  if (pageId && /^\d+$/.test(pageId)) {
    url.searchParams.set("asset_id", pageId);
    url.searchParams.set("mailbox_id", pageId);
  }

  return <div className="mt-2">
    <a href={url.href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-900 transition hover:bg-amber-100">
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      Open in Meta Business Suite
    </a>
  </div>;
}
