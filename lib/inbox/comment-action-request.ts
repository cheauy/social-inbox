"use client";

/*
 * One request path for Like, Hide/Unhide and Delete.
 *
 * Outcomes are told apart on evidence, not on wording. Deleted means the
 * server returned COMMENT_DELETED, which it only does on Meta's structured
 * "object does not exist" answer confirmed by a second read -- not on any
 * error text that happens to contain "(#100)". A network failure or a gateway
 * timeout is uncertain rather than failed: the request may have reached Meta,
 * so the screen is left as the agent set it and nothing is resent.
 */
export async function requestCommentAction(
  endpoint: string,
  body: Record<string, unknown>,
  failText: string,
  send: typeof fetch = fetch,
): Promise<{ kind: "ok" | "partial" | "deleted" | "failed" | "uncertain"; error?: string; warning?: string }> {
  let response: Response;

  try {
    response = await send(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      kind: "uncertain",
      error: "Not confirmed. Facebook may have applied it — check before trying again.",
    };
  }

  let result: { success?: boolean; error?: string; code?: string; partial?: boolean; warning?: string } | null = null;
  try {
    const text = await response.text();
    result = text.trim() ? JSON.parse(text) : null;
  } catch {
    result = null;
  }

  if (!result) {
    // No readable answer: a 5xx/timeout after the call may have succeeded.
    return response.status >= 500 || response.status === 0
      ? { kind: "uncertain", error: "Not confirmed. Facebook may have applied it — check before trying again." }
      : { kind: "failed", error: failText };
  }

  if (result.code === "COMMENT_DELETED") return { kind: "deleted" };

  if (!response.ok || !result.success) {
    return { kind: "failed", error: result.error ?? failText };
  }

  return result.partial
    ? { kind: "partial", warning: result.warning ?? "Facebook applied it, but TENH could not save it locally." }
    : { kind: "ok" };
}

