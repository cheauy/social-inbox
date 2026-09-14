/** Read back an uncertain send. Never POST or guess when multiple replies match. */
export async function confirmCommentReply({ commentId, pageId, message, startedAt, pageAccessToken, graphVersion }: {
  commentId: string; pageId: string; message: string; startedAt: number;
  pageAccessToken: string; graphVersion: string;
}): Promise<string | null> {
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(commentId)}/comments`);
    url.searchParams.set("fields", "id,message,from{id},created_time,parent{id}");
    url.searchParams.set("limit", "25");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${pageAccessToken}` },
      cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload.error || !Array.isArray(payload.data)) return null;
    const earliest = Math.floor(startedAt / 1000) * 1000;
    const latest = Date.now() + 1000;
    const matches = payload.data.filter((reply: {
      id?: string; message?: string; from?: { id?: string }; parent?: { id?: string }; created_time?: string;
    }) => {
      const time = Date.parse(reply.created_time ?? "");
      return typeof reply.id === "string" && reply.id.length > 0 && reply.from?.id === pageId &&
        reply.parent?.id === commentId && reply.message === message && time >= earliest && time <= latest;
    });
    return matches.length === 1 ? matches[0].id : null;
  } catch {
    // A failed read is still uncertain, never an invitation to send again.
    return null;
  }
}
