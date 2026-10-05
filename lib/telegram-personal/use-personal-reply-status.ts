"use client";

import { useEffect, useState } from "react";

import { loadPersonalReplyStatus, PERSONAL_REPLY_REASONS } from "@/lib/telegram-personal/client-send";

/**
 * For a Telegram Personal conversation: null while loading or when replying is
 * allowed, otherwise the reason shown in the reply box. Other channels: null.
 */
export function usePersonalReplyBlock(conversationId: string | null | undefined, isPersonal: boolean) {
  const [result, setResult] = useState<{ id: string; reason: string | null } | null>(null);
  useEffect(() => {
    if (!isPersonal || !conversationId) return;
    const controller = new AbortController();
    loadPersonalReplyStatus(conversationId, controller.signal)
      .then((status) => setResult({ id: conversationId, reason: status.canReply ? null : PERSONAL_REPLY_REASONS[status.reason ?? ""] ?? "Replies are not available for this chat." }))
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== "AbortError") setResult({ id: conversationId, reason: "Unable to check reply access. Reload to try again." });
      });
    return () => controller.abort();
  }, [conversationId, isPersonal]);
  if (!isPersonal || !conversationId) return { loading: false, reason: null };
  if (result?.id !== conversationId) return { loading: true, reason: null };
  return { loading: false, reason: result.reason };
}
