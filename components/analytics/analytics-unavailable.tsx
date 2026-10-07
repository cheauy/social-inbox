import type { AnalyticsPeriod } from "@/lib/analytics/overview-metrics";
export function AnalyticsUnavailable({message,onRetry,period,onPeriod}:{message:string;onRetry:()=>void;period:AnalyticsPeriod;onPeriod:(value:AnalyticsPeriod)=>void}) {
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap gap-2">{(["today","yesterday","7d","30d","90d"] as const).map(value=><button key={value} type="button" aria-pressed={period===value} onClick={()=>onPeriod(value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium">{value==="today"?"Today":value==="yesterday"?"Yesterday":value.slice(0,-1)+" days"}</button>)}</div>
    <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{message}</p>
    <p className="text-sm text-slate-500">Metrics are unavailable. Missing results are not zero.</p>
    <button type="button" onClick={onRetry} className="rounded-lg bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">Retry</button>
  </section>;
}
