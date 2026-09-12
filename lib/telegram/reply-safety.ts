import { TelegramApiError } from "@/lib/telegram/telegram-api";
import type { TelegramMessage } from "@/lib/telegram/types";

export const TELEGRAM_REPLY_FALLBACK_NOTICE =
  "The original message is no longer available for a Telegram reply. Your message was sent normally, without a quote.";

/** Retry ONLY an explicit provider rejection that proves this send failed.
 * A timeout, network failure, rate limit or other error must never cause a
 * second send here: Telegram may already have delivered the first request.
 */
export function isMissingTelegramReply(error: unknown): boolean {
  return error instanceof TelegramApiError && error.errorCode === 400 &&
    /(?:message to (?:be )?replied(?: to)? (?:is )?not found|reply(?: message)?(?:_| )not(?:_| )found|replied message not found)/i.test(error.message.replace(/_/g, " "));
}

export async function sendWithTelegramReplySafety({ replyToMessageId, knownUnavailable = false, send }: {
  replyToMessageId: number | null;
  knownUnavailable?: boolean;
  send: (replyToMessageId: number | null) => Promise<TelegramMessage>;
}) {
  let fallback = knownUnavailable;
  let requested = knownUnavailable ? null : replyToMessageId;
  let message: TelegramMessage;
  try { message = await send(requested); }
  catch (error) {
    if (!requested || !isMissingTelegramReply(error)) throw error;
    // Telegram explicitly rejected the quote; no message was sent. Retry once.
    fallback = true; requested = null;
    message = await send(null);
  }
  const confirmedReply = Boolean(requested && message.reply_to_message?.message_id === requested);
  // With allow_sending_without_reply, Telegram can accept one ordinary message
  // if the parent disappeared. Do not display a native quote which was not sent.
  if (replyToMessageId && !confirmedReply) fallback = true;
  return { message, replyApplied: confirmedReply, replyFallback: fallback,
    notice: fallback ? TELEGRAM_REPLY_FALLBACK_NOTICE : null };
}
