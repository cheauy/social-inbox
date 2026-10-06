import "server-only";

/*
 * When is a Facebook comment really gone?
 *
 * The Inbox used to decide from error text: any message containing "(#100)"
 * or "error during posting" marked the comment deleted. (#100) is Graph's
 * generic invalid-parameter error, so a permissions problem or a malformed
 * request could quietly mark a living comment deleted.
 *
 * Evidence here is structured and confirmed twice: the action must fail with
 * code 100 / subcode 33 ("object does not exist"), and a direct read of the
 * same comment with the same Page token must say the same. Anything else is
 * an ordinary failure.
 */

type GraphError = { code?: number; error_subcode?: number; message?: string } | undefined;

export function isGraphObjectMissing(error: GraphError) {
  return Number(error?.code) === 100 && Number(error?.error_subcode) === 33;
}

export async function confirmCommentMissing(
  commentId: string,
  pageAccessToken: string,
  graphVersion: string,
): Promise<boolean> {
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${commentId}`);
    url.searchParams.set("fields", "id");
    url.searchParams.set("access_token", pageAccessToken);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (response.ok) return false;
    const body = (await response.json().catch(() => ({}))) as { error?: GraphError };
    return isGraphObjectMissing(body.error);
  } catch {
    // Could not confirm: not evidence.
    return false;
  }
}

export { phaseTimer } from "@/lib/server/phase-timer";
