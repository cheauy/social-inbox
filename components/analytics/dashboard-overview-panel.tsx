"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, Inbox, MessageCircle, RefreshCw, Users, Flag, Waves } from "lucide-react";
import { useAnalyticsRequest, useAnalyticsResume } from "@/lib/analytics/use-analytics-request";
import { useAnalyticsFilters } from "@/lib/analytics/use-analytics-filters";
import { ANALYTICS_PERIOD_LABELS, verifiedOverview, type AnalyticsPeriod, type OverviewMetrics } from "@/lib/analytics/overview-metrics";
import { useForegroundLoading } from "@/lib/display/foreground-loading";
import { ActivityLineChart, MessageDoughnut, ChannelBars, BusyHourBars } from "./overview-charts";

type Result = { success: boolean; error?: string; businessId: string; start: string; end: string; snapshotAt: string; analytics: OverviewMetrics };
const format=(value:number|null|undefined)=>value===null||value===undefined?"—":value.toLocaleString();
const labels=ANALYTICS_PERIOD_LABELS;
const card="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.025)] sm:p-6";
const duration=(seconds:number|null|undefined)=>seconds===null||seconds===undefined?"—":seconds<60?seconds+"s":Math.floor(seconds/60)+"m "+seconds%60+"s";

function Metric({label,value,helper,icon:Icon,tone="blue"}:{label:string;value:string;helper:string;icon:typeof Inbox;tone?:string}) {
  const colors=tone==="violet"?"bg-violet-50 text-violet-600":tone==="rose"?"bg-rose-50 text-rose-600":tone==="teal"?"bg-teal-50 text-teal-600":"bg-blue-50 text-blue-600";
  return <div className={card}><span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${colors}`}><Icon className="h-4 w-4" aria-hidden="true"/></span>
    <p className="mt-4 text-[28px] font-bold leading-none tracking-tight text-slate-950 tabular-nums" data-metric={label}>{value}</p>
    <h3 className="mt-2 text-sm font-semibold text-slate-700">{label}</h3><p className="mt-2 text-xs leading-5 text-slate-500">{helper}</p></div>;
}
function Unavailable({loading,zero=false}:{loading:boolean;zero?:boolean}) {
  return <div className="flex min-h-56 items-center justify-center rounded-xl bg-slate-50/70 p-5 text-center text-sm leading-6 text-slate-500">{loading?"Loading verified activity…":zero?"No activity in this period.":"Data unavailable. Missing values are not zero."}</div>;
}

export function DashboardOverviewPanel({onOpenChannelPerformance}:{onOpenChannelPerformance?:()=>void}) {
  const filters=useAnalyticsFilters(),requests=useAnalyticsRequest();
  const [result,setResult]=useState<{key:string;value:Result}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
  const query=filters.query;
  const data=result?.key===query?result.value:null,metrics=data?.analytics;
  useForegroundLoading(loading);
  const loadOverview=useCallback(async function loadOverview(silent=false):Promise<void> {
    const request=requests.start(query,silent);if(!request)return;
    if(!silent)setLoading(true);setError(null);
    try {
      const response=await fetch("/api/analytics/overview?"+query,{cache:"no-store",signal:request.signal});
      const payload=await response.json() as Result;
      if(!request.current())return;
      if(!response.ok||!payload.success||!verifiedOverview(payload.analytics))throw new Error(payload.error??"Verified overview data is unavailable.");
      const expected=new URLSearchParams(query).get("businessId");
      if(expected&&payload.businessId!==expected)throw new Error("Workspace changed. Reload this view.");
      setResult({key:query,value:payload});
    } catch(failure) {
      if(request.current()) {setResult(null);setError(failure instanceof Error?failure.message:"Unable to load the overview.");}
    } finally {if(request.current())setLoading(false);request.finish();}
  },[query,requests]);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)void loadOverview();});return()=>{active=false;requests.cancel();};},[loadOverview,requests]);
  useAnalyticsResume(loadOverview);

  const detailHref=(view:string)=>{
    const params=new URLSearchParams(query);params.set("view",view);
    if(data){params.set("start",data.start);params.set("end",data.end);}
    return "/dashboard/analytics?"+params.toString();
  };
  const details=(view:string,label="View details")=><a href={detailHref(view)} onClick={event=>{
    if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();window.history.pushState(null,"",detailHref(view));
    if(view==="channel-performance")onOpenChannelPerformance?.();
  }} className="inline-flex shrink-0 items-center gap-1.5 rounded py-1 text-xs font-semibold text-blue-600 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500">{label}<ArrowRight className="h-3.5 w-3.5" aria-hidden="true"/></a>;

  const current=metrics?.current,period=metrics?.period,customers=metrics?.customers,messages=metrics?.messages;
  const activity=metrics?.daily??[];
  const dayRows=activity.length?Array.from({length:Math.round((Date.parse(activity[activity.length-1].date)-Date.parse(activity[0].date))/86400000)+1},(_,i)=>{
    const date=new Date(Date.parse(activity[0].date)+i*86400000).toISOString().slice(0,10);
    return activity.find(row=>row.date===date)??{date,received:0,resolved:0};
  }):[];
  return <div className="space-y-5 pb-8" data-analytics-overview aria-busy={loading}>
    <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
      <div><p className="text-xs font-semibold text-blue-600">Analytics</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Dashboard</h1>
        <p className="mt-2 text-sm text-slate-500" title={data?.businessId??filters.businessId}>Selected workspace{data?" · "+data.businessId.slice(0,8):""} · customer conversations</p></div>
      <div className="flex max-w-full flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1" aria-label="Analytics period">
          {(["today","yesterday","7d","30d"] as const).map(value=><button key={value} type="button" aria-pressed={filters.period===value} onClick={()=>filters.setPeriod(value)} className={`rounded-lg px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-blue-500 ${filters.period===value?"bg-blue-50 text-blue-700":"text-slate-600 hover:bg-slate-50"}`}>{value==="7d"?"7 days":value==="30d"?"30 days":labels[value]}</button>)}
        </div>
        <label className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-600"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true"/><span className="sr-only">Longer period</span><select aria-label="Longer period" value={(["3m","6m","1y"] as string[]).includes(filters.period)?filters.period:""} onChange={event=>filters.setPeriod(event.target.value as AnalyticsPeriod)} className="max-w-40 bg-transparent py-0.5 font-medium focus-visible:outline-2 focus-visible:outline-blue-500">
          <option value="" disabled>Longer period</option><option value="3m">3 months</option><option value="6m">6 months</option><option value="1y">1 year</option></select></label>
        <label className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-600">SLA<select aria-label="SLA target" value={filters.slaMinutes} onChange={event=>filters.setSlaMinutes(Number(event.target.value))} className="bg-transparent py-0.5 font-semibold focus-visible:outline-2 focus-visible:outline-blue-500">{[...new Set([5,10,15,30,60,filters.slaMinutes])].sort((a,b)=>a-b).map(minutes=><option key={minutes} value={minutes}>{minutes} min</option>)}</select></label>
        <button type="button" aria-label="Refresh dashboard" onClick={()=>void loadOverview()} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-500"><RefreshCw className={`h-4 w-4 ${loading?"animate-spin":""}`} aria-hidden="true"/></button>
      </div>
    </header>
    <div className="relative overflow-hidden rounded-2xl border border-blue-100/60 bg-gradient-to-r from-blue-50/80 via-slate-50 to-violet-50/80 px-5 py-5 sm:px-6">
      <Waves className="pointer-events-none absolute -right-6 -top-8 h-40 w-72 text-violet-200/50" strokeWidth={.6} aria-hidden="true"/>
      <p className="relative text-base font-semibold text-slate-800">Your workspace, at a glance</p><p className="relative mt-1 text-xs leading-5 text-slate-500">Facebook Messenger · Facebook Comments · Telegram. Human responses are measured separately from automated replies.</p>
    </div>
    {error?<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{error}</div>:null}
    <section aria-labelledby="current-queue-title"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 id="current-queue-title" className="text-base font-bold text-slate-900">Current queue <span className="ml-2 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Current</span></h2><p className="mt-1 text-xs text-slate-500">Live Inbox threads, including comment threads. Independent of the selected date period.</p></div>{details("team-workload")}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Unassigned" value={format(current?.unassigned)} helper="Open or pending Inbox threads without an owner." icon={Users}/>
        <Metric label="Waiting beyond SLA" value={format(current?.waitingOverSla)} helper={current?`Human reply overdue · ${current.unknownWaiting} threads have unknown reply attribution and are excluded.`:"Human reply overdue. Unverified threads are excluded."} icon={Clock3} tone="rose"/>
        <Metric label="Unread conversations" value={format(current?.unread)} helper="Unique open or pending Inbox threads, including comment threads; not unread messages." icon={Inbox} tone="violet"/>
        <Metric label="Overdue" value={format(current?.overdue)} helper="Unfinished follow-up reminders due before the current snapshot; reminder count." icon={Flag} tone="rose"/>
      </div>
      {data?<p className="mt-2 text-xs text-slate-500">Snapshot: {new Intl.DateTimeFormat("en",{dateStyle:"medium",timeStyle:"short",timeZone:filters.timezone}).format(new Date(data.snapshotAt))} · {filters.timezone}</p>:null}
    </section>
    <section aria-labelledby="period-overview-title"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 id="period-overview-title" className="text-base font-bold text-slate-900">Period overview</h2><p className="mt-1 text-xs text-slate-500">{labels[filters.period]} · first incoming activity within the selected period</p></div>{details("team-performance")}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Conversations" value={format(period?.conversations)} helper={period?`${format(period.resolved)} resolved received conversations · ${format(period.commentThreads)} comment threads counted separately.`:"Unique Messenger / Telegram conversations with incoming activity; excludes comment threads and spam."} icon={MessageCircle}/>
        <Metric label="First responses" value={format(period?.firstResponses)} helper={period?`${duration(period.avgFirstResponseSeconds)} average · verified first human replies. Unknown earlier replies excluded.`:"Verified first human replies; bots and unknown attribution excluded."} icon={Inbox} tone="teal"/>
        <Metric label="SLA met" value={period?.slaRate===null||period?.slaRate===undefined?"—":period.slaRate+"%"} helper={period?`${format(period.slaMet)} met / ${format(period.slaDenominator)} eligible: human replies plus overdue unanswered conversations. ${format(period.slaMissed)} missed.`:"Human-reply SLA; no eligible denominator means unavailable, not 100%."} icon={CheckCircle2} tone="violet"/>
        <Metric label="New / returning customers" value={customers?`${format(customers.new)} / ${format(customers.returning)}`:"—"} helper="New contacts created in the period / existing contacts with incoming activity. These are not a partition of active customers." icon={Users}/>
      </div>
      {period?<p className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs leading-5 text-blue-800">Human timing coverage: {format(period.humanEvaluableConversations)} of {format(period.conversations)} messaging conversations; {format(period.unknownHumanConversations)} excluded because an earlier outgoing reply has unknown authorship. {messages? `Outgoing attribution: ${format(messages.humanOutgoing)} human, ${format(messages.botOutgoing)} known automated, ${format(messages.unknownOutgoing)} unknown.`:""}</p>:null}
    </section>
    <section className="grid gap-4 xl:grid-cols-3">
      <div className={card+" xl:col-span-2"}><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-bold text-slate-900">Conversation activity</h2><p className="mt-1 text-xs text-slate-500">Received conversations and their first resolution in this period. Counts only; no time axis.</p></div>{details("conversation-reports")}</div>{metrics&&dayRows.length?<ActivityLineChart rows={dayRows}/>:<Unavailable loading={loading} zero={Boolean(metrics)}/>}</div>
      <div className={card}><div className="flex items-center justify-between gap-2"><h2 className="text-base font-bold text-slate-900">Message volume</h2>{details("conversation-reports")}</div><p className="mt-1 text-xs leading-5 text-slate-500">Incoming + outgoing messages and individual comments in the period. System events excluded.</p>{messages?<MessageDoughnut incoming={messages.incoming} outgoing={messages.outgoing}/>:<Unavailable loading={loading}/>}</div>
    </section>
    <section className="grid gap-4 xl:grid-cols-2">
      <div className={card}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-bold text-slate-900">Channels</h2>{details("channel-performance","View channel performance")}</div><p className="mt-1 text-xs leading-5 text-slate-500">Unique Inbox threads receiving customer activity in the period.</p>{metrics?<ChannelBars rows={metrics.channels}/>:<Unavailable loading={loading}/>}</div>
      <div className={card}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-bold text-slate-900">Busiest hours</h2>{details("conversation-reports")}</div>{metrics?<BusyHourBars rows={metrics.hours} timezone={filters.timezone}/>:<Unavailable loading={loading}/>}</div>
    </section>
    <section className={card}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-bold text-slate-900">Customers · {labels[filters.period]}</h2></div><div className="mt-5 grid gap-5 sm:grid-cols-3">
      {[{label:"Unique active customers",value:customers?.active,helper:"Distinct saved contact IDs with any message activity, including system events."},{label:"New contacts",value:customers?.new,helper:"Contacts created in this period; may not have activity."},{label:"Returning customers",value:customers?.returning,helper:"Contacts created before the period, with incoming activity."}].map(item=><div key={item.label}><p className="text-[28px] font-bold tabular-nums text-slate-950">{format(item.value)}</p><h3 className="mt-1 text-sm font-semibold text-slate-700">{item.label}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{item.helper}</p></div>)}
      </div><p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">Contacts are not merged across channels. New and returning definitions overlap different activity populations and must not be summed to reconstruct the active total.</p></section>
  </div>;
}
