"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

/*
 * Composer for Telegram Personal chats: text, or one photo/file with a caption,
 * optionally quoting a message. Only the person who connected the Telegram
 * account may reply. Everyone else sees why not.
 *
 * Each send has its own request id, so the server never sends it twice. A send
 * whose outcome Telegram did not confirm is shown as "uncertain" and is never
 * sent again automatically: the holder checks Telegram first.
 * The sent message itself appears in the thread when the worker records it.
 */

type ReplyStatus = { canReply: boolean; reason: string | null; maxFileBytes?: number };
type SendView = {
  requestId: string;
  text: string;
  state: "sending" | "pending" | "sent" | "failed" | "uncertain";
  error?: string;
};

const MAX_TEXT = 4096;
const MAX_CAPTION = 1024;
const POLL_MS = 2_000;
const POLL_LIMIT_MS = 120_000;

const REASONS: Record<string, string> = {
  HOLDER_ONLY: "Read only. Only the person who connected this Telegram account can reply from TENH.",
  NOT_CONNECTED: "This Telegram account is not connected right now, so replies are paused.",
  CHAT_NOT_SHARED: "Sharing was stopped for this chat, so new messages are not coming in and replies are off. To use it again: Integrations → Telegram → Choose chats to share → tick this chat.",
  NO_PERMISSION: "You do not have permission to reply in this workspace.",
  SEND_DISABLED: "Read only for now. Replying from TENH is not switched on yet; reply in Telegram.",
};

function newRequestId() {
  return crypto.randomUUID();
}

export function TelegramPersonalComposer({ conversationId, replyToMessageId = null, onReplyUsed }: {
  conversationId: string;
  /** The message picked with Reply in the thread, if any. */
  replyToMessageId?: string | null;
  onReplyUsed?: () => void;
}) {
  const [status, setStatus] = useState<ReplyStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [sends, setSends] = useState<SendView[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    fetch(`/api/telegram-personal/send?conversationId=${encodeURIComponent(conversationId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => ({}))) as Partial<ReplyStatus> & { success?: boolean };
        if (!response.ok || !result.success) throw new Error();
        setStatus({ canReply: Boolean(result.canReply), reason: result.reason ?? null, maxFileBytes: result.maxFileBytes });
      })
      .catch((error: unknown) => {
        if ((error as { name?: string })?.name !== "AbortError") setStatusError(true);
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [conversationId]);

  function update(requestId: string, patch: Partial<SendView>) {
    if (!mounted.current) return;
    setSends((current) => current.map((item) => (item.requestId === requestId ? { ...item, ...patch } : item)));
  }

  function settle(requestId: string, result: { state?: string; code?: string; error?: string }) {
    if (result.state === "sent") {
      update(requestId, { state: "sent" });
      setTimeout(() => {
        if (mounted.current) setSends((current) => current.filter((item) => item.requestId !== requestId));
      }, 2_500);
      return true;
    }
    if (result.state === "failed") {
      update(requestId, { state: "failed", error: "Telegram did not accept this message. It was not sent." });
      return true;
    }
    if (result.state === "uncertain") {
      update(requestId, {
        state: "uncertain",
        error: "Telegram did not confirm this message. Check the chat in Telegram before sending it again.",
      });
      return true;
    }
    return false;
  }

  async function poll(requestId: string) {
    const started = Date.now();
    while (mounted.current && Date.now() - started < POLL_LIMIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      try {
        const response = await fetch(
          `/api/telegram-personal/send?conversationId=${encodeURIComponent(conversationId)}&clientRequestId=${requestId}`,
          { cache: "no-store" },
        );
        const result = (await response.json().catch(() => ({}))) as { state?: string };
        if (response.ok && settle(requestId, result)) return;
      } catch {
        // Keep waiting; the outcome is recorded server-side either way.
      }
    }
    update(requestId, {
      state: "uncertain",
      error: "Still waiting for Telegram. Check the chat in Telegram before sending it again.",
    });
  }

  function pickFile(picked: File | null) {
    setFileError(null);
    if (!picked) return;
    const max = status?.maxFileBytes ?? 4 * 1024 * 1024;
    if (picked.size > max) {
      setFileError(`Files can be up to ${Math.floor(max / (1024 * 1024))} MB.`);
      return;
    }
    setFile(picked);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const message = text;
    const attachment = file;
    const quote = replyToMessageId && !replyToMessageId.includes(":") ? replyToMessageId : null;
    if (!status?.canReply) return;
    if (attachment ? message.length > MAX_CAPTION : !message.trim() || message.length > MAX_TEXT) return;
    const requestId = newRequestId();
    setText("");
    setFile(null);
    onReplyUsed?.();
    const label = attachment ? `📎 ${attachment.name}${message.trim() ? ` · ${message}` : ""}` : message;
    setSends((current) => [...current, { requestId, text: label, state: "sending" }]);
    try {
      let response: Response;
      if (attachment) {
        const form = new FormData();
        form.set("conversationId", conversationId);
        form.set("clientRequestId", requestId);
        form.set("text", message);
        if (quote) form.set("replyToMessageId", quote);
        form.set("file", attachment, attachment.name);
        response = await fetch("/api/telegram-personal/send", { method: "POST", body: form });
      } else {
        response = await fetch("/api/telegram-personal/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, clientRequestId: requestId, text: message, ...(quote ? { replyToMessageId: quote } : {}) }),
        });
      }
      const result = (await response.json().catch(() => ({}))) as { state?: string; error?: string; code?: string };
      if (!response.ok && response.status !== 202) {
        // Refused before queueing: nothing was sent, so the text and file come back.
        if (mounted.current) {
          setText((current) => current || message);
          setFile((current) => current ?? attachment);
        }
        update(requestId, { state: "failed", error: `${result.error ?? "Unable to send."} Nothing was sent.` });
        return;
      }
      if (!settle(requestId, result)) {
        update(requestId, { state: "pending" });
        void poll(requestId);
      }
    } catch {
      // The request may or may not have reached TENH: never resend, ask the queue.
      update(requestId, { state: "pending" });
      void poll(requestId);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  function dismiss(requestId: string) {
    setSends((current) => current.filter((item) => item.requestId !== requestId));
  }

  const notice = statusError
    ? "Unable to check reply access. Reload to try again."
    : status && !status.canReply
      ? REASONS[status.reason ?? ""] ?? "Replies are not available for this chat."
      : null;

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-2.5">
      {sends.length ? (
        <ul className="mb-2 space-y-1.5" aria-live="polite">
          {sends.map((item) => (
            <li
              key={item.requestId}
              className={`flex items-start justify-between gap-2 rounded-lg px-3 py-1.5 text-[13px] ${
                item.state === "uncertain"
                  ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200"
                  : item.state === "failed"
                    ? "bg-rose-50 text-rose-900 ring-1 ring-rose-200"
                    : "bg-slate-50 text-slate-700"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.text}</span>
                <span className="block text-[12px] opacity-80">
                  {item.state === "sending" || item.state === "pending"
                    ? "Sending through Telegram…"
                    : item.state === "sent"
                      ? "Sent"
                      : item.error}
                </span>
              </span>
              {item.state === "failed" || item.state === "uncertain" ? (
                <button
                  type="button"
                  onClick={() => dismiss(item.requestId)}
                  className="shrink-0 rounded px-1.5 text-[12px] font-semibold hover:bg-black/5"
                >
                  Dismiss
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {notice ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600 ring-1 ring-slate-200">{notice}</p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="space-y-2">
          {file || fileError ? (
            <div className="flex items-center gap-2 text-[13px]">
              {file ? (
                <span className="inline-flex min-w-0 items-center gap-2 rounded-lg bg-sky-50 px-2.5 py-1 text-sky-900 ring-1 ring-sky-200">
                  <span className="truncate">📎 {file.name}</span>
                  <span className="shrink-0 text-[11px] text-sky-700">{Math.max(1, Math.round(file.size / 1024))} KB</span>
                  <button type="button" onClick={() => setFile(null)} aria-label="Remove file" className="shrink-0 rounded px-1 font-semibold hover:bg-black/5">×</button>
                </span>
              ) : null}
              {fileError ? <span className="text-rose-700">{fileError}</span> : null}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            onChange={(event) => {
              pickFile(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={!status?.canReply}
            aria-label="Attach a photo or file"
            title="Attach a photo or file (up to 4 MB)"
            className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 text-[18px] text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            📎
          </button>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={!status}
            maxLength={file ? MAX_CAPTION : MAX_TEXT}
            rows={2}
            placeholder={!status ? "Checking reply access…" : file ? "Add a caption (optional)…" : "Reply from your Telegram account…"}
            aria-label="Reply from your Telegram account"
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-[14px] text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={!status?.canReply || (!text.trim() && !file)}
            className="h-11 shrink-0 rounded-xl bg-sky-600 px-4 text-[14px] font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Send
          </button>
          </div>
        </form>
      )}
      <p className="mt-1.5 text-[11px] text-slate-400">Telegram Personal · text, photos and files up to 4 MB · sent from the connected Telegram account</p>
    </div>
  );
}
