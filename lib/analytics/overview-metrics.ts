export const OVERVIEW_DEFINITION = "human-overview-v1";
export type AnalyticsPeriod = "today" | "yesterday" | "7d" | "30d" | "90d" | "3m" | "6m" | "1y";
export const ANALYTICS_PERIODS: AnalyticsPeriod[] = ["today", "yesterday", "7d", "30d", "90d", "3m", "6m", "1y"];
export const ANALYTICS_PERIOD_LABELS: Record<AnalyticsPeriod,string> = {today:"Today",yesterday:"Yesterday","7d":"Last 7 days","30d":"Last 30 days","90d":"Last 90 days","3m":"Last 3 months","6m":"Last 6 months","1y":"Last year"};
export function effectiveAnalyticsPeriod(params:URLSearchParams,fallback:AnalyticsPeriod):AnalyticsPeriod {
  const period=params.get("period") as AnalyticsPeriod;
  return ANALYTICS_PERIODS.includes(period)?period:fallback;
}
export type OverviewMetrics = {
  definitionVersion: typeof OVERVIEW_DEFINITION;
  scope: string[];
  current: { unassigned: number; unread: number; waitingOverSla: number; unknownWaiting: number; overdue: number };
  period: { conversations: number; commentThreads: number; resolved: number; firstResponses: number;
    avgFirstResponseSeconds: number | null; slaMet: number; slaMissed: number; slaDenominator: number;
    slaRate: number | null; humanEvaluableConversations: number; unknownHumanConversations: number };
  messages: { incoming: number; outgoing: number; humanOutgoing: number; botOutgoing: number; unknownOutgoing: number };
  customers: { active: number; new: number; returning: number };
  daily: { date: string; received: number; resolved: number }[];
  channels: { channel: "messenger" | "comment" | "telegram"; value: number }[];
  hours: { hour: number; value: number }[];
};

const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Missing/partial aggregates are unavailable, never zero. Reconcile units before rendering. */
export function verifiedOverview(value: unknown): value is OverviewMetrics {
  if (!record(value) || value.definitionVersion !== OVERVIEW_DEFINITION || !Array.isArray(value.scope)
    || [...value.scope].sort().join(",") !== "comment,messenger,telegram") return false;
  for (const [group, fields] of Object.entries({
    current: ["unassigned", "unread", "waitingOverSla", "unknownWaiting", "overdue"],
    period: ["conversations", "commentThreads", "resolved", "firstResponses", "slaMet", "slaMissed", "slaDenominator", "humanEvaluableConversations", "unknownHumanConversations"],
    messages: ["incoming", "outgoing", "humanOutgoing", "botOutgoing", "unknownOutgoing"],
    customers: ["active", "new", "returning"],
  })) { const data=value[group]; if (!record(data) || fields.some(key => !count(data[key]))) return false; }
  const p=value.period as OverviewMetrics["period"], m=value.messages as OverviewMetrics["messages"];
  if (p.slaDenominator !== p.slaMet+p.slaMissed || p.slaDenominator>p.humanEvaluableConversations
    || p.humanEvaluableConversations+p.unknownHumanConversations!==p.conversations || p.firstResponses>p.humanEvaluableConversations
    || m.humanOutgoing+m.botOutgoing+m.unknownOutgoing!==m.outgoing) return false;
  if (p.slaDenominator===0 ? p.slaRate!==null : p.slaRate!==Math.round(p.slaMet/p.slaDenominator*100)) return false;
  if (p.firstResponses===0 ? p.avgFirstResponseSeconds!==null : !count(p.avgFirstResponseSeconds)) return false;
  if (!Array.isArray(value.daily) || value.daily.length>368 || value.daily.some(row=>!record(row)
    || typeof row.date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !count(row.received) || !count(row.resolved))) return false;
  if (new Set(value.daily.map(row=>row.date)).size!==value.daily.length
    || value.daily.reduce((sum,row)=>sum+row.received,0)!==p.conversations
    || value.daily.reduce((sum,row)=>sum+row.resolved,0)!==p.resolved) return false;
  if (!Array.isArray(value.channels) || value.channels.length!==3 || value.channels.some(row=>!record(row) || !count(row.value))
    || value.channels.map(row=>row.channel).sort().join(",")!=="comment,messenger,telegram"
    || value.channels.reduce((sum,row)=>sum+row.value,0)!==p.conversations+p.commentThreads) return false;
  if (!Array.isArray(value.hours) || value.hours.length!==24 || value.hours.some(row=>!record(row)
    || !count(row.hour) || row.hour>23 || !count(row.value)) || new Set(value.hours.map(row=>row.hour)).size!==24
    || value.hours.reduce((sum,row)=>sum+row.value,0)!==m.incoming) return false;
  return true;
}

function calendar(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23" }).formatToParts(date);
  const number=(type:string)=>Number(parts.find(part=>part.type===type)?.value);
  return {year:number("year"),month:number("month")-1,day:number("day"),hour:number("hour"),minute:number("minute"),second:number("second")};
}
function midnight(wall: number, timezone: string) {
  let utc=wall;
  for (let i=0;i<4;i++) { const c=calendar(new Date(utc),timezone);
    const observed=Date.UTC(c.year,c.month,c.day,c.hour,c.minute,c.second); const next=utc+wall-observed;
    if (next===utc) return new Date(utc); utc=next; }
  return new Date(utc);
}
export function analyticsTimezoneOffset(timezone: string, now = new Date()) {
  const c=calendar(now,timezone);
  return Math.round((Math.floor(now.getTime()/1000)*1000-Date.UTC(c.year,c.month,c.day,c.hour,c.minute,c.second))/60_000);
}
export function overviewRange(period: AnalyticsPeriod, now: Date, timezone: string) {
  const c=calendar(now,timezone), wall=Date.UTC(c.year,c.month,c.day);
  if (period==="today") return {start:midnight(wall,timezone),end:now};
  if (period==="yesterday") return {start:midnight(wall-86_400_000,timezone),end:midnight(wall,timezone)};
  if (period==="3m" || period==="6m" || period==="1y") {
    const months=period==="3m"?3:period==="6m"?6:12;
    const first=new Date(Date.UTC(c.year,c.month-months,1));
    const lastDay=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
    return {start:midnight(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(c.day,lastDay)),timezone),end:now};
  }
  return {start:new Date(now.getTime()-Number(period.slice(0,-1))*86_400_000),end:now};
}

/** Exact overview drilldown bounds override legacy rolling/calendar defaults. */
export function explicitAnalyticsRange<T extends {start:Date;end:Date}>(params: URLSearchParams, now: Date, fallback: T): T | null {
  if (!params.has("start") && !params.has("end")) {
    const period=params.get("period");
    if(period!=="3m"&&period!=="6m"&&period!=="1y")return fallback;
    try {const range=overviewRange(period,now,params.get("timezone")??"UTC");return {...fallback,...range,...("label" in fallback?{label:ANALYTICS_PERIOD_LABELS[period]}:{}),...("periodDays" in fallback?{periodDays:Math.ceil((range.end.getTime()-range.start.getTime())/86_400_000)}:{})};}
    catch {return null;}
  }
  const start=new Date(params.get("start")??""),end=new Date(params.get("end")??"");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start>=end
    || end.getTime()-start.getTime()>367*86_400_000 || end.getTime()>now.getTime()+5000) return null;
  const period=params.get("period") as AnalyticsPeriod;
  return {...fallback,start,end,...("label" in fallback&&ANALYTICS_PERIOD_LABELS[period]?{label:ANALYTICS_PERIOD_LABELS[period]}:{}),...("periodDays" in fallback?{periodDays:Math.ceil((end.getTime()-start.getTime())/86_400_000)}:{})};
}
