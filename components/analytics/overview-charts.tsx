"use client";
import { useId, useState } from "react";
import type { OverviewMetrics } from "@/lib/analytics/overview-metrics";

const number=(value:number)=>value.toLocaleString();
const shortDate=(value:string)=>new Intl.DateTimeFormat("en",{month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(value+"T00:00:00Z"));
const hour=(value:number)=>`${String(value).padStart(2,"0")}:00`;
export const CHANNEL_LABELS={messenger:"Facebook Messenger",comment:"Facebook Comments",telegram:"Telegram"};

/** Native SVG is the existing analytics chart implementation; no chart dependency. */
export function ActivityLineChart({rows}:{rows:OverviewMetrics["daily"]}) {
  const [active,setActive]=useState<number|null>(null),id=useId();
  const width=720,height=246,left=44,right=704,top=16,bottom=208;
  const max=Math.max(1,...rows.flatMap(row=>[row.received,row.resolved]));
  const ceiling=Math.max(4,Math.ceil(max/4)*4),x=(i:number)=>left+(right-left)*(rows.length===1?.5:i/(rows.length-1));
  const y=(value:number)=>bottom-value/ceiling*(bottom-top),point=active===null?null:rows[active];
  return <div className="relative mt-5">
    <p className="mb-2 text-xs text-slate-500">Messaging conversations · count</p>
    <div className="overflow-x-auto rounded-lg" tabIndex={0} role="region" aria-label="Conversation activity chart; scroll horizontally on small screens"><svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[640px] w-full" role="img" aria-label="Received and resolved messaging conversation counts by date">
      {[0,1,2,3,4].map(tick=><g key={tick}><line x1={left} x2={right} y1={y(ceiling*tick/4)} y2={y(ceiling*tick/4)} stroke="#e2e8f0" strokeDasharray="4 5"/><text x={left-10} y={y(ceiling*tick/4)+4} textAnchor="end" fontSize="12" fill="#64748b">{ceiling*tick/4}</text></g>)}
      {(["received","resolved"] as const).map(key=><g key={key}>
        <polyline points={rows.map((row,i)=>`${x(i)},${y(row[key])}`).join(" ")} fill="none" stroke={key==="received"?"#3b82f6":"#14b8a6"} strokeWidth="3" strokeLinejoin="round"/>
        {rows.map((row,i)=><circle key={row.date} cx={x(i)} cy={y(row[key])} r={active===i?5:3} fill={key==="received"?"#3b82f6":"#14b8a6"}/>)}
      </g>)}
      {rows.map((row,i)=>i%Math.max(1,Math.ceil(rows.length/6))===0||i===rows.length-1?<text key={row.date} x={x(i)} y={236} textAnchor="middle" fontSize="12" fill="#64748b">{shortDate(row.date)}</text>:null)}
    </svg></div>
    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600"><span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-blue-500"/>Received</span><span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-teal-500"/>Resolved received conversations</span></div>
    <details className="mt-4 text-xs text-slate-500"><summary className="w-fit cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-blue-500">Explore daily values</summary>
      <div className="mt-2 flex flex-wrap gap-2">{rows.map((row,i)=><button key={row.date} type="button" onFocus={()=>setActive(i)} onMouseEnter={()=>setActive(i)} onClick={()=>setActive(i)} aria-describedby={id} className="rounded-lg border border-slate-200 px-2.5 py-2 text-slate-600 hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-blue-500">{shortDate(row.date)}</button>)}</div>
    </details>
    <p id={id} role="status" className="mt-2 min-h-5 text-xs text-slate-600">{point?`${shortDate(point.date)}: ${number(point.received)} received; ${number(point.resolved)} resolved.`:"Focus or select a date to read exact counts."}</p>
  </div>;
}

export function MessageDoughnut({incoming,outgoing}:{incoming:number;outgoing:number}) {
  const [active,setActive]=useState<"incoming"|"outgoing"|null>(null),id=useId(),total=incoming+outgoing;
  const circumference=2*Math.PI*72,share=total?incoming/total:0;
  return <div className="mt-4">
    <svg viewBox="0 0 220 220" className="mx-auto h-52 w-52 max-w-full" role="img" aria-label={`${number(total)} messages: ${number(incoming)} incoming, ${number(outgoing)} outgoing`}>
      <circle cx="110" cy="110" r="72" fill="none" stroke="#eef2f7" strokeWidth="22"/>
      {total>0?<g transform="rotate(-90 110 110)"><circle cx="110" cy="110" r="72" fill="none" stroke="#8b5cf6" strokeWidth="22"/><circle cx="110" cy="110" r="72" fill="none" stroke="#38bdf8" strokeWidth="22" strokeDasharray={`${share*circumference} ${circumference}`}/></g>:null}
      <text x="110" y="108" textAnchor="middle" fill="#0f172a" fontSize={total>999999?"22":"32"} fontWeight="700">{number(total)}</text>
      <text x="110" y="133" textAnchor="middle" fill="#64748b" fontSize="12">Total messages</text>
    </svg>
    <div className="space-y-2">{(["incoming","outgoing"] as const).map(key=><button key={key} type="button" onFocus={()=>setActive(key)} onMouseEnter={()=>setActive(key)} onClick={()=>setActive(key)} aria-describedby={id} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-500"><span><span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${key==="incoming"?"bg-sky-400":"bg-violet-500"}`}/>{key==="incoming"?"Incoming":"Outgoing"}</span><strong className="tabular-nums text-slate-900">{number(key==="incoming"?incoming:outgoing)}</strong></button>)}</div>
    <p id={id} role="status" className="mt-2 min-h-10 text-xs leading-5 text-slate-500">{total===0?"No messages in this period.":active?`${active==="incoming"?"Incoming":"Outgoing"}: ${number(active==="incoming"?incoming:outgoing)} of ${number(total)} messages (${((active==="incoming"?incoming:outgoing)/total*100).toFixed(1)}%).`:"Select a legend item for its share of total messages."}</p>
  </div>;
}

export function ChannelBars({rows}:{rows:OverviewMetrics["channels"]}) {
  const total=rows.reduce((sum,row)=>sum+row.value,0),[active,setActive]=useState<string|null>(null),id=useId();
  const sorted=(["messenger","comment","telegram"] as const).map(channel=>rows.find(row=>row.channel===channel)!);
  return <div className="mt-6 space-y-4">
    {sorted.map(row=><button key={row.channel} type="button" onFocus={()=>setActive(row.channel)} onMouseEnter={()=>setActive(row.channel)} onClick={()=>setActive(row.channel)} aria-describedby={id} className="block w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-500">
      <span className="flex items-center justify-between gap-2 text-sm"><span className="font-medium text-slate-700">{CHANNEL_LABELS[row.channel]}</span><span className="tabular-nums text-slate-600">{number(row.value)} <span className="text-xs text-slate-500">({total?(row.value/total*100).toFixed(1)+"%":"—"})</span></span></span>
      <span className="mt-2 block h-2.5 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${row.channel==="telegram"?"bg-sky-400":row.channel==="comment"?"bg-violet-500":"bg-blue-500"}`} style={{width:`${total?row.value/total*100:0}%`}}/></span>
      <span className="mt-1 block text-xs text-slate-500">{row.channel==="comment"?"Comment threads, not individual comments":"Messaging conversations"}</span>
    </button>)}
    <p id={id} role="status" className="min-h-10 text-xs leading-5 text-slate-500">{total===0?"No incoming conversation or comment-thread activity.":`${number(total)} received Inbox threads is the denominator for every share.${active?` ${CHANNEL_LABELS[active as keyof typeof CHANNEL_LABELS]} counts unique conversation IDs with incoming activity.`:""}`}</p>
  </div>;
}

export function BusyHourBars({rows,timezone}:{rows:OverviewMetrics["hours"];timezone:string}) {
  const [active,setActive]=useState<number|null>(null),id=useId(),max=Math.max(1,...rows.map(row=>row.value));
  return <div className="mt-4">
    <p className="text-xs text-slate-500">Incoming messages / comments · {timezone}</p>
    <div className="mt-3 overflow-x-auto rounded-lg pb-2" tabIndex={0} role="region" aria-label="Hourly activity chart; scroll horizontally on small screens">
      <div className="flex h-48 min-w-[624px] items-end gap-0.5 border-b border-slate-200">
        {rows.map(row=><button key={row.hour} type="button" aria-label={`${hour(row.hour)}: ${number(row.value)} incoming messages or comments`} aria-describedby={id} onFocus={()=>setActive(row.hour)} onMouseEnter={()=>setActive(row.hour)} onClick={()=>setActive(row.hour)} className="relative flex h-full min-w-6 flex-1 items-end justify-center rounded-t focus-visible:outline-2 focus-visible:outline-blue-500"><span className={`block w-3/4 rounded-t ${active===row.hour?"bg-violet-700":"bg-violet-400"}`} style={{height:`${row.value/max*160}px`}}/></button>)}
      </div>
      <div className="mt-2 flex min-w-[624px] text-center text-xs text-slate-500">{rows.map(row=><span key={row.hour} className="min-w-6 flex-1">{row.hour%4===0?hour(row.hour):""}</span>)}</div>
    </div>
    <p id={id} role="status" className="mt-3 min-h-5 text-xs text-slate-600">{rows.every(row=>row.value===0)?"No incoming customer activity in this period.":active===null?"Focus or select an hour for its exact count.":`${hour(active)}: ${number(rows.find(row=>row.hour===active)!.value)} incoming messages or comments.`}</p>
  </div>;
}
