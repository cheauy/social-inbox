// Draft-only planning. No database, provider, timer or worker imports are allowed.
export const DRAFT_KINDS = ["welcome_away", "keyword_faq", "human_takeover", "unanswered_alert", "conversation_menu"] as const;
export type DraftKind = typeof DRAFT_KINDS[number];
export type DraftRule = {
  id: string; kind: DraftKind; businessId: string; channelId: string; name: string;
  mode: "draft"; priority: number; cooldownMinutes: number; keywords: string[];
  template: string; awayTemplate: string; timezone: string;
  hours: { day: number; start: number; end: number }[];
  memberIds: string[]; assignOnIncoming: boolean; alertMinutes: number; menu: { label: string; reply: string }[];
};
export type DraftEvent = { id: string; conversationId: string; recipientId: string; at: string;
  kind: "customer" | "staff" | "bot" | "resume"; text: string; firstContact?: boolean };
export type DraftAction = { key: string; ruleId: string; conversationId: string; recipientId: string;
  kind: "reply" | "assign" | "alert" | "handoff"; text?: string; memberId?: string; dueAt?: string; status: "proposed" | "cancelled" };
export type DraftContext = { businessId: string; channelId: string; now: string;
  staff: { id: string; load: number }[]; assignments?: {conversationId:string;memberId:string}[] };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown, max = 2000) => typeof v === "string" && v.length <= max ? v.trim() : "";
const integer = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 30 && v.every(x => !!string(x, 100));
export function parseDraftRules(input: unknown, scope: Pick<DraftContext, "businessId" | "channelId">): DraftRule[] {
  if (!Array.isArray(input) || !input.length || input.length > 20) throw Error("Use 1–20 draft rules.");
  const used = new Set<string>();
  return input.map(v => {
    if (!record(v) || !string(v.id, 100) || used.has(v.id as string) || v.mode !== "draft" ||
        v.businessId !== scope.businessId || v.channelId !== scope.channelId ||
        !DRAFT_KINDS.includes(v.kind as DraftKind) || !string(v.name, 120) ||
        !integer(v.priority, 0, 100) || !integer(v.cooldownMinutes, 0, 10080) ||
        !integer(v.alertMinutes, 1, 10080) || typeof v.assignOnIncoming !== "boolean" || !ids(v.keywords) || !ids(v.memberIds) ||
        typeof v.template !== "string" || v.template.length > 2000 || typeof v.awayTemplate !== "string" || v.awayTemplate.length > 2000 ||
        !Array.isArray(v.hours) || v.hours.length > 21 || !Array.isArray(v.menu) || v.menu.length > 10) throw Error("Invalid draft rule or scope.");
    try { new Intl.DateTimeFormat("en", {timeZone: string(v.timezone,100)}).format(); } catch { throw Error("Choose a valid IANA timezone."); }
    if (!v.hours.every(h => record(h) && integer(h.day,0,6) && integer(h.start,0,1439) && integer(h.end,1,1440) && h.start !== h.end) ||
        !v.menu.every(m => record(m) && !!string(m.label,80) && !!string(m.reply))) throw Error("Invalid hours or menu.");
    if (v.kind === "keyword_faq" && (!(v.keywords as string[]).length || !string(v.template))) throw Error("FAQ needs keywords and a reply.");
    if (v.kind === "welcome_away" && (!string(v.template) || !string(v.awayTemplate) || !v.hours.length)) throw Error("Welcome/Away needs both replies and hours.");
    if (v.kind === "human_takeover" && !(v.keywords as string[]).length) throw Error("Takeover needs keywords.");
    if (v.kind === "conversation_menu" && (!(v.keywords as string[]).length || !v.menu.length)) throw Error("Menu needs a command and choices.");
    if (["human_takeover","unanswered_alert"].includes(v.kind as string) && !(v.memberIds as string[]).length) throw Error("Choose existing staff.");
    used.add(v.id as string); return v as unknown as DraftRule;
  });
}
export function parseDraftEvents(input: unknown): DraftEvent[] {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw Error("Use 1–100 synthetic events.");
  return input.map(v => {
    if (!record(v) || !string(v.id,100) || !string(v.conversationId,100) || !string(v.recipientId,100) ||
        !["customer","staff","bot","resume"].includes(v.kind as string) || typeof v.text !== "string" || v.text.length > 2000 ||
        typeof v.at !== "string" || !Number.isFinite(Date.parse(v.at)) || !/(Z|[+-]\d\d:\d\d)$/i.test(v.at) ||
        (v.firstContact !== undefined && typeof v.firstContact !== "boolean")) throw Error("Invalid synthetic event.");
    return v as unknown as DraftEvent;
  });
}
export function withinDraftHours(rule: DraftRule, timestamp: string) {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:rule.timezone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(timestamp));
  const value = (type: string) => parts.find(p=>p.type===type)?.value ?? "";
  const day = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(value("weekday"));
  const minute = Number(value("hour"))*60+Number(value("minute"));
  return rule.hours.some(h => h.start < h.end ? h.day===day && minute>=h.start && minute<h.end :
    (h.day===day && minute>=h.start) || ((h.day+1)%7===day && minute<h.end));
}
const matches = (keywords: string[], text: string) => keywords.some(k => text.normalize("NFKC").toLocaleLowerCase("en").includes(k.normalize("NFKC").toLocaleLowerCase("en")));
export function previewDraftRules(rules: DraftRule[], events: DraftEvent[], ctx: DraftContext) {
  if (typeof ctx.now!=="string" || !Number.isFinite(Date.parse(ctx.now)) || !/(Z|[+-]\d\d:\d\d)$/i.test(ctx.now)) throw Error("Invalid preview clock.");
  rules = parseDraftRules(rules,ctx); events = parseDraftEvents(events);
  if (rules.some(r=>r.memberIds.some(id=>!ctx.staff.some(m=>m.id===id)))) throw Error("Draft references unavailable staff.");
  if(ctx.assignments && (ctx.assignments.length>100 || ctx.assignments.some(a=>!a.conversationId || !ctx.staff.some(m=>m.id===a.memberId)))) throw Error("Invalid sample assignment.");
  const actions: DraftAction[] = [], seen = new Set<string>(), cooldown = new Map<string,number>();
  const conversations = new Map<string,{human:boolean; assigned:string|null; latest:number; alertKeys:string[]}>();
  const sortedRules=[...rules].sort((a,b)=>b.priority-a.priority || a.id.localeCompare(b.id));
  for(const event of [...events].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id))) {
    const stamp=Date.parse(event.at), identity=JSON.stringify([ctx.businessId,ctx.channelId,event.id]);
    if(stamp>Date.parse(ctx.now) || seen.has(identity)) continue; seen.add(identity);
    const state=conversations.get(event.conversationId)??{human:false,assigned:ctx.assignments?.find(a=>a.conversationId===event.conversationId)?.memberId??null,latest:0,alertKeys:[]}; conversations.set(event.conversationId,state);
    const key=(r:DraftRule,kind:string)=>JSON.stringify([ctx.businessId,ctx.channelId,event.recipientId,event.id,r.id,kind]);
    const add=(r:DraftRule,kind:DraftAction["kind"],extra:Partial<DraftAction>={})=>{const a:DraftAction={key:key(r,kind),ruleId:r.id,conversationId:event.conversationId,recipientId:event.recipientId,kind,status:"proposed",...extra};actions.push(a);return a};
    const cancel=()=>{for(const action of actions)if(state.alertKeys.includes(action.key))action.status="cancelled";state.alertKeys=[];};
    if(event.kind==="staff"){state.human=true;cancel();continue;}
    if(event.kind==="resume"){state.human=false;continue;}
    if(event.kind!=="customer")continue;
    state.latest=stamp;cancel();
    const assignment=sortedRules.find(r=>r.kind==="human_takeover"&&r.assignOnIncoming);
    if(assignment&&!state.assigned){const staff=ctx.staff.filter(m=>assignment.memberIds.includes(m.id)).sort((a,b)=>a.id.localeCompare(b.id))[0];if(staff){state.assigned=staff.id;add(assignment,"assign",{memberId:staff.id});}}
    const takeover=sortedRules.find(r=>r.kind==="human_takeover"&&matches(r.keywords,event.text));
    if(takeover){state.human=true;add(takeover,"handoff");if(!state.assigned){const staff=ctx.staff.filter(m=>takeover.memberIds.includes(m.id)).sort((a,b)=>a.load-b.load||a.id.localeCompare(b.id))[0];if(staff){state.assigned=staff.id;add(takeover,"assign",{memberId:staff.id});}}}
    for(const rule of sortedRules.filter(r=>r.kind==="unanswered_alert")){const due=stamp+rule.alertMinutes*60000;
      const action=add(rule,"alert",{memberId:rule.memberIds[0],dueAt:new Date(due).toISOString()});state.alertKeys.push(action.key);}
    // Automated responses never use the HUMAN_AGENT extension or comment window.
    if(state.human || Date.parse(ctx.now)-stamp>=24*60*60000)continue;
    for(const rule of sortedRules){const bucket=JSON.stringify([event.recipientId,rule.id]);const previous=cooldown.get(bucket);
      if(previous!==undefined && stamp-previous<rule.cooldownMinutes*60000)continue;
      let text="";
      if(rule.kind==="keyword_faq"&&matches(rule.keywords,event.text))text=rule.template;
      if(rule.kind==="welcome_away")text=!withinDraftHours(rule,event.at)?rule.awayTemplate:event.firstContact?rule.template:"";
      if(rule.kind==="conversation_menu"){const choice=rule.menu.find(m=>m.label.normalize("NFKC").toLowerCase()===event.text.normalize("NFKC").trim().toLowerCase());text=choice?.reply??(matches(rule.keywords,event.text)?rule.menu.map(m=>m.label).join("\n"):"");}
      if(text){add(rule,"reply",{text});cooldown.set(bucket,stamp);break;}
    }
  }
  return {dryRun:true as const,executionAvailable:false as const,actions,note:"Synthetic draft plan only. No sends, assignments, alerts or jobs executed. Durable atomic claims/reservations and channel verification are required before live wiring."};
}
