"use client";

import type { FormEvent } from "react";

type ReplyBoxProps = {
  reply: string;
  sending: boolean;
  error: string | null;
  onReplyChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function ReplyBox({
  reply,
  sending,
  error,
  onReplyChange,
  onSubmit,
}: ReplyBoxProps) {
  return (
    <div className="border-t border-slate-200 bg-white p-4">
      <form
        onSubmit={onSubmit}
        className="flex gap-3"
      >
        <input
          type="text"
          name="message"
          value={reply}
          onChange={(event) =>
            onReplyChange(event.target.value)
          }
          placeholder="Write a reply..."
          disabled={sending}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
        />

        <button
          type="submit"
          disabled={sending || !reply.trim()}
          className="rounded-xl bg-blue-600 px-5 py-3 font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {sending ? "Sending..." : "Send"}
        </button>
      </form>

      {error ? (
        <p className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-400">
          Replies are sent through the connected Facebook Page.
        </p>
      )}
    </div>
  );
}
