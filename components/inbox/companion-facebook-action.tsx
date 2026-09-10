"use client";

import { useEffect, useState } from "react";

import { useCompanion } from "@/lib/extension/use-companion";

/*
 * The one thing TENH can honestly offer when Meta has closed the window.
 *
 * Meta allows a private reply only while the customer's own last message is
 * recent. When that window closes TENH stops, and it should: sending anyway is
 * a policy violation dressed up as a feature. What is still true is that the
 * Page administrator can look at the conversation in Facebook, and that
 * Facebook itself decides what it lets them do there.
 *
 * So this offers to open it, and -- only when TENH Companion is installed --
 * reports what the browser can see: whether Facebook is showing a reply box
 * and whether Facebook has enabled it. That is a description of somebody
 * else's interface, not a permission and not a promise. Nothing here types,
 * sends, or works around a box Facebook has disabled.
 *
 * With no companion installed this is still a link to Facebook, which is what
 * an agent would have done by hand anyway.
 */

type Props = {
  conversationId: string;
  pageId: string | null;
};

const FACEBOOK_INBOX = "https://business.facebook.com/latest/inbox/all";

export function CompanionFacebookAction({ conversationId, pageId }: Props) {
  const { installed, openInFacebook, checkReplyAvailability } = useCompanion();

  /* Null while the question is still out. "Checking" is that, rendered --
     not a separate state to keep in step with this one. */
  const [answer, setAnswer] = useState<
    "available" | "unavailable" | "no-tab" | null
  >(null);

  /*
   * Asked once, when a companion is present and the notice appears. Not
   * polled: what a Facebook tab shows can change while somebody reads this,
   * and a status that quietly refreshes itself would be a status somebody
   * trusts more than it deserves.
   */
  useEffect(() => {
    if (!installed || !conversationId) return;

    let alive = true;

    void checkReplyAvailability(conversationId).then((result) => {
      if (!alive) return;

      setAnswer(
        !result || result.reason === "no_facebook_tab"
          ? "no-tab"
          : result.composerEnabled
            ? "available"
            : "unavailable",
      );
    });

    return () => {
      alive = false;
    };
  }, [installed, conversationId, checkReplyAvailability]);

  async function open() {
    /* The companion focuses a tab that is already open rather than stacking
       another one. Without it, an ordinary new tab is the honest fallback. */
    if (installed && (await openInFacebook({ pageId, conversationId }))) {
      return;
    }

    window.open(
      pageId
        ? `${FACEBOOK_INBOX}?asset_id=${encodeURIComponent(pageId)}`
        : FACEBOOK_INBOX,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void open()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-900 transition hover:bg-amber-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M14 4h6v6M20 4l-8 8" strokeLinecap="round" />
          <path
            d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
            strokeLinecap="round"
          />
        </svg>
        Open in Facebook
      </button>

      {installed ? (
        <span className="text-[11px] leading-4 text-amber-800">
          {answer === null
            ? "TENH Companion is checking your Facebook tab…"
            : answer === "available"
              ? "TENH Companion sees an enabled reply box in Facebook. Whether a message sends is Facebook's decision."
              : answer === "unavailable"
                ? "TENH Companion sees a reply box that Facebook has disabled."
                : "TENH Companion has no Facebook tab open to look at."}
        </span>
      ) : null}
    </div>
  );
}
