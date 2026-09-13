"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, X } from "lucide-react";
import { FACEBOOK_BLOCK_CHANGED, useFacebookBlock } from "@/lib/inbox/use-facebook-block";
import type { FacebookBlockMode } from "@/lib/facebook/customer-block";
import type { InboxConversation } from "@/types/inbox";

type Choice = { blocked: boolean; mode: FacebookBlockMode | null; confirm: boolean };
export function CustomerMessageBlock({ conversation }: { conversation: InboxConversation }) {
  const { blocked, mode, loaded, actorName, available, refresh } = useFacebookBlock(conversation);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [details, setDetails] = useState(""), [copied, setCopied] = useState(false);
  const lock = useRef(false), mounted = useRef(true), dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const open = Boolean(choice);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open]);
  function show() {
    setError(""); setDetails(""); setCopied(false);
    setChoice({ blocked: !blocked, mode: blocked ? mode : null, confirm: blocked });
  }
  async function change() {
    if (lock.current || !choice?.mode || !choice.confirm) return;
    const requested = choice;
    lock.current = true; setBusy(true); setError(""); setDetails(""); setCopied(false);
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}/facebook-block`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked: requested.blocked, mode: requested.mode }),
      });
      let result;
      try { result = await response.json(); }
      catch { throw new Error("TENH could not read the block response. Check this customer's status in Business Suite before retrying."); }
      if (!response.ok || !result.success) {
        if (mounted.current) setDetails([result.providerCode != null ? `Meta code: ${result.providerCode}` : null,
          result.providerSubcode != null ? `Subcode: ${result.providerSubcode}` : null,
          result.providerMessage || null, result.providerTraceId ? `Trace: ${result.providerTraceId}` : null].filter(Boolean).join(" | "));
        throw new Error(result.error || "Unable to change this customer's block.");
      }
      // Let other views refresh even if the agent changed conversations during the request.
      window.dispatchEvent(new CustomEvent(FACEBOOK_BLOCK_CHANGED));
      if (mounted.current) { await refresh(); if (mounted.current) setChoice(null); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Unable to change this customer's block."); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  if (conversation.social_account?.platform !== "facebook") return null;
  const pageName = conversation.social_account.account_name || "this Facebook Page";
  const customerName = conversation.contact?.full_name || "this customer";
  const actionLabel = choice?.blocked ? choice.mode === "page" ? "Ban user" : "Block user" : choice?.mode === "page" ? "Remove ban and unblock" : "Unblock user";
  return <div className="rounded-lg">
    {blocked ? <p role="status" className="mb-2 text-xs font-semibold text-red-700">{mode === "page" ? "Banned from this Page and Messenger" : "Messages blocked on this Page"}{actorName ? ` by ${actorName}` : ""}</p> : null}
    <button type="button" disabled={busy || !available} onClick={show}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
      <Ban className="h-4 w-4" aria-hidden="true" />{busy ? "Updating Facebook…" : blocked ? mode === "page" ? "Remove user ban" : "Unblock user" : "Block user"}
    </button>
    {loaded && !available ? <p className="mt-2 text-xs text-amber-700">Block controls are unavailable. Check access and apply the database update.</p> : null}
    {choice ? createPortal(<div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/40 p-4"
      onMouseDown={event => { if (event.target === event.currentTarget && !busy) setChoice(null); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}
        className="max-h-[90vh] w-full max-w-[750px] overflow-y-auto rounded-lg bg-white p-5 text-slate-800 shadow-2xl outline-none"
        onKeyDown={event => {
          if (event.key === "Escape") { event.stopPropagation(); if (!busy) setChoice(null); }
          if (event.key === "Tab") {
            const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? []);
            const first = items[0], last = items[items.length - 1], active = document.activeElement;
            if (!first) { event.preventDefault(); return; }
            if (event.shiftKey && (active === first || active === dialog.current)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (active === last || active === dialog.current)) { event.preventDefault(); first.focus(); }
          }
        }}>
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-xl font-semibold">{choice.blocked ? "Stop communication" : "Restore communication"}</h2>
          <button type="button" disabled={busy} aria-label="Close block dialog" onClick={() => setChoice(null)} className="rounded p-1 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        {!choice.confirm ? <fieldset className="mt-6 space-y-6">
          <legend className="sr-only">Choose how to stop communication</legend>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="radio" name={titleId} value="messages" checked={choice.mode === "messages"} onChange={() => setChoice({ ...choice, mode: "messages" })} className="mt-1 h-5 w-5 shrink-0 accent-sky-600" />
            <span><span className="block text-lg">Block messages and calls</span><span className="mt-1 block text-sm leading-6">You won't receive messages or calls from this person on {pageName}. Unblocking won't deliver messages sent during the block. This doesn't ban the person from your Facebook Page.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="radio" name={titleId} value="page" checked={choice.mode === "page"} onChange={() => setChoice({ ...choice, mode: "page" })} className="mt-1 h-5 w-5 shrink-0 accent-sky-600" />
            <span><span className="block text-lg">Ban on Messenger and Facebook</span><span className="mt-1 block text-sm leading-6">This person won't be able to publish to {pageName}, interact with its posts or comments, or like the Page. They will also be blocked on Messenger. They can still share the Page's content elsewhere on Facebook.</span></span>
          </label>
        </fieldset> : <p className="mt-6 text-sm leading-6">
          {choice.blocked ? choice.mode === "page" ? `Ban ${customerName} from ${pageName} and block their Messenger communication?` : `Block messages and calls from ${customerName} on ${pageName}?`
            : choice.mode === "page" ? `Remove the Page ban and message block for ${customerName} on ${pageName}?` : `Allow ${customerName} to message ${pageName} again?`}
        </p>}
        {error ? <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"><p>{error}</p>
          {details ? <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold">Meta error details</summary><p className="mt-2 break-words">{details}</p><button type="button" className="mt-2 underline" onClick={() => { void navigator.clipboard?.writeText(details).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Copied" : "Copy details"}</button></details> : null}
        </div> : null}
        <div className="mt-7 flex justify-end gap-2">
          {choice.confirm && choice.blocked && !busy ? <button type="button" onClick={() => { setChoice({ ...choice, confirm: false }); setError(""); }} className="mr-auto rounded border border-slate-300 px-4 py-2">Back</button> : null}
          <button type="button" disabled={busy} onClick={() => setChoice(null)} className="rounded border border-slate-300 px-4 py-2 disabled:opacity-50">Cancel</button>
          <button type="button" disabled={busy || !choice.mode} onClick={() => choice.confirm ? void change() : setChoice({ ...choice, confirm: true })}
            className="rounded bg-sky-600 px-5 py-2 font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{busy ? "Updating Facebook…" : choice.confirm ? actionLabel : "Next"}</button>
        </div>
      </div>
    </div>, document.body) : null}
  </div>;
}
