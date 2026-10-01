"use client";
import { useEffect, useState } from "react";
import { MessageSquare, Hand, KeyRound, Users, Bell, ListTree, Megaphone, History, Activity, ShieldAlert, Filter, QrCode, Timer } from "lucide-react";
import { DashboardPanelFrame, dashboardPanelSurfaceClassName } from "@/components/dashboard/dashboard-panel-frame";
import { BotPreviewWorkspace } from "./bot-messenger-preview";
import { BotSaveWorkspace } from "./bot-save-toolbar";
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
const groups=[
 {label:"Comment",ids:["facebook_comment_auto_reply","comment_phone_spam_hide","comment_filters"]},
 {label:"General",ids:["welcome_away","keyword_faq","conversation_menu","ads_specific_reply","returning_context","qr_ref_flow","conditional_followups"]},
 {label:"Bot Settings",ids:["human_takeover","unanswered_alert","connection_health"]},
];
const descriptions:Record<string,string>={facebook_comment_auto_reply:"Configure public and private comment replies in the separate legacy editor.",welcome_away:"Welcome new customers and respond outside business hours.",keyword_faq:"Answer common questions with your approved keywords and replies.",human_takeover:"Route conversations to staff and pause automation during takeover.",unanswered_alert:"Notify staff when a customer is waiting for a reply.",conversation_menu:"Offer customers a simple menu of text choices.",ads_specific_reply:"Match replies to verified incoming Ad references.",returning_context:"Tailor replies for customers with earlier conversations.",connection_health:"Review the connection status recorded for your Page.",comment_phone_spam_hide:"Configure comment filters and proposed hiding conditions.",comment_filters:"Match comment keywords and first-level comment conditions.",qr_ref_flow:"Prepare a public reference link for your campaign flow.",conditional_followups:"Configure follow-ups with timing and cancellation conditions."};
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
  const current=items.find(item=>item.id===selected)??items[0],SelectedIcon=current.Icon;
  return <DashboardPanelFrame><main data-tenh-bot-workspace className={`${dashboardPanelSurfaceClassName} grid grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[248px_minmax(0,1fr)] md:grid-rows-1`}>
    <aside aria-label="Tenh Bot sections" className="max-h-[35vh] min-h-0 overflow-y-auto border-b border-slate-200 bg-white md:max-h-none md:border-b-0 md:border-r">
      <div className="border-b border-slate-200 px-5 py-5"><p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Tenh Bot</p><h2 className="mt-1 text-lg font-bold text-slate-950">Automation tools</h2></div>
      <nav aria-label="Bots" className="space-y-4 p-3">{groups.map(group=><div key={group.label}><h3 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</h3><div role="group" aria-label={group.label} className="space-y-1">{items.filter(item=>group.ids.includes(item.id)).map(({ id,label,Icon }) => <button key={id} type="button" aria-current={selected===id?"page":undefined}
        onClick={()=>select(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${selected===id?"bg-blue-50 font-semibold text-blue-700":"text-slate-700 hover:bg-slate-50"}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${selected===id?"bg-white text-blue-600":"bg-slate-100 text-slate-500"}`}><Icon aria-hidden="true" className="h-4 w-4"/></span><span>{label}</span></button>)}</div></div>)}</nav>
    </aside>
    <section aria-label="Selected Bot configuration" className="min-h-0 min-w-0 overflow-y-auto">
      {!ready ? <p role="status" className="p-6 text-sm text-slate-500">Loading Bot configuration…</p> : <BotSaveWorkspace heading={<div className="mb-2 flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><SelectedIcon aria-hidden="true" className="h-5 w-5"/></span><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold text-slate-950">{current.label}</h1><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{selected==="facebook_comment_auto_reply"?"Separate setup":"Off"}</span></div><p className="mt-0.5 text-xs text-slate-500">{descriptions[selected]}</p></div></div>}>
        <BotPreviewWorkspace selected={selected==="facebook_comment_auto_reply"?"comments":"modern"}>
        {legacyVisited ? <div hidden={selected!=="facebook_comment_auto_reply"}><div className="p-4 sm:p-6"><AutoReplySettings includeDrafts={false}/></div></div> : null}
        <div hidden={selected==="facebook_comment_auto_reply"} className="p-4 sm:p-6"><BotDraftSettings selectedKind={DRAFT_KINDS.includes(selected as DraftKind)?selected as DraftKind:"welcome_away"}/></div>
        </BotPreviewWorkspace>
      </BotSaveWorkspace>}
    </section>
  </main></DashboardPanelFrame>;
}
