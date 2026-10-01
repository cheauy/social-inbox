"use client";
import { useEffect, useState } from "react";
import { MessageSquare, Hand, KeyRound, Users, Bell, ListTree, Megaphone, History, Activity, ShieldAlert, Filter, QrCode, Timer } from "lucide-react";
import { AutoReplySettings } from "@/components/settings/auto-reply-settings";
import { BotDraftSettings } from "@/components/settings/bot-draft-settings";
import { DRAFT_KINDS, type DraftKind } from "@/lib/bot/draft-rules";
import { useForegroundLoading } from "@/lib/display/foreground-loading";

const items = [
  { id: "facebook_comment_auto_reply", label: "Facebook Comment Auto Reply", Icon: MessageSquare },
  { id: "welcome_away", label: "Welcome / Away", Icon: Hand },
  { id: "keyword_faq", label: "Keyword FAQ", Icon: KeyRound },
  { id: "human_takeover", label: "Autoassign / Human takeover", Icon: Users },
  { id: "unanswered_alert", label: "Unanswered staff alert", Icon: Bell },
  { id: "conversation_menu", label: "Conversation menu", Icon: ListTree },
  { id: "ads_specific_reply", label: "Ads-specific reply", Icon: Megaphone },
  { id: "returning_context", label: "Returning customer context", Icon: History },
  { id: "connection_health", label: "Recorded connection health", Icon: Activity },
  { id: "comment_phone_spam_hide", label: "Comment phone / spam hide", Icon: ShieldAlert },
  { id: "comment_filters", label: "Comment filters", Icon: Filter },
  { id: "qr_ref_flow", label: "QR / reference URL flow", Icon: QrCode },
  { id: "conditional_followups", label: "Conditional follow-ups", Icon: Timer },
] as const;
type Selection = DraftKind | "facebook_comment_auto_reply";
const fromLocation = (): Selection => {
  const value = new URL(window.location.href).searchParams.get("bot");
  return value && items.some(item => item.id === value) ? value as Selection : "facebook_comment_auto_reply";
};
export function TenhBotWorkspace() {
  const [selected,setSelected] = useState<Selection>("facebook_comment_auto_reply");
  const [ready,setReady] = useState(false);
  const [legacyVisited,setLegacyVisited] = useState(false);
  useForegroundLoading(!ready);
  useEffect(() => {
    const update = () => { const next = fromLocation(); setSelected(next); if (next === "facebook_comment_auto_reply") setLegacyVisited(true); setReady(true); };
    update(); window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update);
  }, []);
  function select(next: Selection) {
    setSelected(next); if (next === "facebook_comment_auto_reply") setLegacyVisited(true);
    const url = new URL(window.location.href); url.searchParams.set("bot", next); window.history.replaceState(window.history.state,"",url);
  }
  return <main data-tenh-bot-workspace className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-slate-50 md:grid-cols-[248px_minmax(0,1fr)] md:grid-rows-1">
    <aside aria-label="Tenh Bot sections" className="max-h-[35vh] min-h-0 overflow-y-auto border-b border-slate-200 bg-white md:max-h-none md:border-b-0 md:border-r">
      <div className="border-b border-slate-200 px-5 py-5"><p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Tenh Bot</p><h1 className="mt-1 text-lg font-bold text-slate-950">Automation tools</h1></div>
      <nav aria-label="Bots" className="space-y-1 p-3">{items.map(({ id,label,Icon }) => <button key={id} type="button" aria-current={selected===id?"page":undefined}
        onClick={()=>select(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${selected===id?"bg-blue-50 font-semibold text-blue-700":"text-slate-700 hover:bg-slate-50"}`}>
        <Icon aria-hidden="true" className="h-5 w-5 shrink-0"/><span>{label}</span></button>)}</nav>
    </aside>
    <section aria-label="Selected Bot configuration" className="min-h-0 min-w-0 overflow-y-auto">
      {!ready ? <p role="status" className="p-6 text-sm text-slate-500">Loading Bot configuration…</p> : <>
        {legacyVisited ? <div hidden={selected!=="facebook_comment_auto_reply"}><AutoReplySettings includeDrafts={false}/></div> : null}
        <div hidden={selected==="facebook_comment_auto_reply"} className="p-4 sm:p-6"><BotDraftSettings selectedKind={DRAFT_KINDS.includes(selected as DraftKind)?selected as DraftKind:"welcome_away"}/></div>
      </>}
    </section>
  </main>;
}
