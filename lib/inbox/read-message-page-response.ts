import type { InboxMessage } from "@/types/inbox";

type MessagePageResponse = {
  success: true;
  messages: InboxMessage[];
  hasMore?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class MessagePageResponseError extends Error {
  readonly status: number;
  readonly contentType: string;
  readonly redirected: boolean;

  constructor(response: Response, reason: string) {
    const contentType = response.headers.get("content-type")?.split(";")[0].trim() || "unknown content type";
    super(`${reason} (HTTP ${response.status}; ${contentType}${response.redirected ? "; redirected" : ""}).`);
    this.name = "MessagePageResponseError";
    this.status = response.status;
    this.contentType = contentType;
    this.redirected = response.redirected;
  }
}

/** Never turn an error page or an invalid response into a successful empty page. */
export async function readMessagePageResponse(response: Response): Promise<MessagePageResponse> {
  const text = (await response.text()).trim();
  const contentType = response.headers.get("content-type") ?? "";

  // A login, proxy, deployment or Next error page can arrive with a 200 status.
  // Keep the response body out of logs; status/type/redirect are enough to trace it.
  if (/^</.test(text) || /(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
    throw new MessagePageResponseError(response, "Messages request returned an HTML page instead of JSON");
  }
  if (!text) {
    throw new MessagePageResponseError(response, "Messages request returned an empty response");
  }

  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new MessagePageResponseError(response, "Messages request returned invalid JSON");
  }

  if (!response.ok || !isRecord(result) || result.success !== true) {
    const reason = isRecord(result) && typeof result.error === "string" && result.error.trim()
      ? result.error.trim()
      : "Unable to load conversation messages";
    throw new MessagePageResponseError(response, reason);
  }

  if (!Array.isArray(result.messages) || !result.messages.every((message) =>
    isRecord(message) && typeof message.id === "string" &&
    typeof message.conversation_id === "string" && typeof message.created_at === "string",
  )) {
    throw new MessagePageResponseError(response, "Messages request returned an invalid message page");
  }

  return {
    success: true,
    messages: result.messages as InboxMessage[],
    ...(typeof result.hasMore === "boolean" ? { hasMore: result.hasMore } : {}),
  };
}
