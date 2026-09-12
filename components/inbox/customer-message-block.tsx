"use client";
import { useRef, useState } from "react";
import { Ban } from "lucide-react";
import { FACEBOOK_BLOCK_CHANGED, useFacebookBlock } from "@/lib/inbox/use-facebook-block";
import type { InboxConversation } from "@/types/inbox";
export function CustomerMessageBlock({ conversation }: { conversation: InboxConversation }) {
  const { blocked, actorName, available, refresh } = useFacebookBlock(conversation);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const lock = useRef(false);
  const [details, setDetails] = useState(""); const [copied, setCopied] = useState(false);
  async function change() {
    if (lock.current) return;
    const target = !blocked;
    if (!window.confirm(`${target ? "Block" : "Unblock"} this customer's messages on ${conversation.social_account?.account_name || "this Facebook Page"}? This changes the customer's messaging access on Meta too. It does not remove message history or block public comments.`)) return;
    lock.current = true; setBusy(true); setError(""); setDetails(""); setCopied(false);
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}/facebook-block`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocked: target }) });
      const result = await response.json();
      if (!response.ok || !result.success) {
        setDetails([result.providerCode != null ? `Meta code: ${result.providerCode}` : null,
          result.providerSubcode != null ? `Subcode: ${result.providerSubcode}` : null,
          result.providerMessage || null, result.providerTraceId ? `Trace: ${result.providerTraceId}` : null].filter(Boolean).join(" | "));
        throw new Error(result.error || "Unable to change this customer's block.");
      }
      await refresh(); window.dispatchEvent(new CustomEvent(FACEBOOK_BLOCK_CHANGED));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to change this customer's block."); }
    finally { lock.current = false; setBusy(false); }
  }
  if (conversation.social_account?.platform !== "facebook") return null;
  return <div className="rounded-lg">
    {blocked ? <p role="status" className="mb-2 text-xs font-semibold text-red-700">Blocked on this Facebook Page{actorName ? ` by ${actorName}` : ""}</p> : null}
    <button type="button" disabled={busy || !available} onClick={() => void change()} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm disabled:opacity-50 ${blocked ? "border-slate-300 text-slate-600" : "border-red-200 text-red-600 hover:bg-red-50"}`}><Ban className="h-4 w-4" />{busy ? "Updating Facebook…" : blocked ? "Unblock user" : "Block user"}</button>
    {!available ? <p className="mt-2 text-xs text-amber-700">Block feature requires the database update.</p> : null}
    {error ? <div role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-xs text-red-700"><p>{error}</p>
      {details ? <details className="mt-2"><summary className="cursor-pointer font-semibold">Meta error details</summary><p className="mt-2 break-words">{details}</p><button type="button" className="mt-2 underline" onClick={() => { void navigator.clipboard?.writeText(details).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Copied" : "Copy details"}</button></details> : null}
    </div> : null}
  </div>;
}
