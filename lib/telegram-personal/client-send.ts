/*
 * Browser side of Telegram Personal replies, used by the main TENH reply box.
 *
 * One request id per message: the server queues each id once, so this never
 * sends twice. A send whose outcome Telegram did not confirm is reported as
 * "uncertain" and is never retried here; the holder checks Telegram first.
 */

export type PersonalSendOutcome =
  | { state: "sent" }
  | { state: "failed"; error: string }
  | { state: "uncertain"; error: string }
  | { state: "refused"; error: string; code?: string };

const POLL_MS = 2_000;
const POLL_LIMIT_MS = 120_000;

export const PERSONAL_REPLY_REASONS: Record<string, string> = {
  HOLDER_ONLY: "Read only. Only the person who connected this Telegram account can reply from TENH.",
  NOT_CONNECTED: "This Telegram account is not connected right now, so replies are paused.",
  CHAT_NOT_SHARED: "Sharing was stopped for this chat, so new messages are not coming in and replies are off. To use it again: Integrations → Telegram → Choose chats to share → tick this chat.",
  NO_PERMISSION: "You do not have permission to reply in this workspace.",
  SEND_DISABLED: "Read only for now. Replying from TENH is not switched on yet; reply in Telegram.",
};

/** The request id stored with the message, from the optimistic bubble id. */
export function personalRequestId(tempId: string) {
  return tempId.replace(/^optimistic:/, "");
}

function describe(state: string, code: string | undefined): PersonalSendOutcome | null {
  if (state === "sent") return { state: "sent" };
  if (state === "failed") {
    return { state: "failed", error: `Telegram did not accept this message. It was not sent.${code ? ` (${code})` : ""}` };
  }
  if (state === "uncertain") {
    return { state: "uncertain", error: "Telegram did not confirm this message. Check the chat in Telegram before sending it again." };
  }
  return null;
}

async function poll(conversationId: string, requestId: string, signalAlive: () => boolean): Promise<PersonalSendOutcome> {
  const started = Date.now();
  while (signalAlive() && Date.now() - started < POLL_LIMIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    try {
      const response = await fetch(
        `/api/telegram-personal/send?conversationId=${encodeURIComponent(conversationId)}&clientRequestId=${requestId}`,
        { cache: "no-store" },
      );
      const result = (await response.json().catch(() => ({}))) as { state?: string; code?: string };
      const outcome = response.ok ? describe(result.state ?? "", result.code) : null;
      if (outcome) return outcome;
    } catch {
      // Keep asking: the outcome is recorded server-side either way.
    }
  }
  return { state: "uncertain", error: "Still waiting for Telegram. Check the chat in Telegram before sending it again." };
}

/** Sends one text or one file (with caption). Never resends. */
export async function sendPersonalMessage(input: {
  conversationId: string;
  requestId: string;
  text: string;
  file?: File | null;
  /** Inbox message id of the quoted message, if replying. */
  replyToMessageId?: string | null;
  isAlive?: () => boolean;
}): Promise<PersonalSendOutcome> {
  const quote = input.replyToMessageId && !input.replyToMessageId.includes(":") ? input.replyToMessageId : null;
  let response: Response;
  try {
    if (input.file) {
      const form = new FormData();
      form.set("conversationId", input.conversationId);
      form.set("clientRequestId", input.requestId);
      form.set("text", input.text);
      if (quote) form.set("replyToMessageId", quote);
      form.set("file", input.file, input.file.name);
      response = await fetch("/api/telegram-personal/send", { method: "POST", body: form });
    } else {
      response = await fetch("/api/telegram-personal/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: input.conversationId, clientRequestId: input.requestId, text: input.text, ...(quote ? { replyToMessageId: quote } : {}) }),
      });
    }
  } catch {
    // The request may or may not have reached TENH: never resend, ask the queue.
    return poll(input.conversationId, input.requestId, input.isAlive ?? (() => true));
  }
  const result = (await response.json().catch(() => ({}))) as { state?: string; error?: string; code?: string };
  if (!response.ok && response.status !== 202) {
    return { state: "refused", error: `${result.error ?? "Unable to send."} Nothing was sent.`, code: result.code };
  }
  return describe(result.state ?? "", result.code) ?? poll(input.conversationId, input.requestId, input.isAlive ?? (() => true));
}

/** Whether this member may reply in a Personal chat, and why not. */
export async function loadPersonalReplyStatus(conversationId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/telegram-personal/send?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store", signal });
  const result = (await response.json().catch(() => ({}))) as { success?: boolean; canReply?: boolean; reason?: string | null };
  if (!response.ok || !result.success) throw new Error("Unable to check reply access.");
  return { canReply: Boolean(result.canReply), reason: result.reason ?? null };
}
