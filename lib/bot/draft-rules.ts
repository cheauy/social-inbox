// Draft-only planning. No database, provider, timer or worker imports are allowed.
export const DRAFT_KINDS = ["welcome_away", "keyword_faq", "human_takeover", "unanswered_alert", "conversation_menu", "ads_specific_reply", "returning_context", "connection_health", "comment_phone_spam_hide", "comment_filters", "qr_ref_flow", "conditional_followups"] as const;
export type DraftKind = typeof DRAFT_KINDS[number];
export type DraftOptions = {
  adIds?: string[]; excludeKeywords?: string[]; firstLevelOnly?: boolean; phoneOnly?: boolean;
  minPrevious?: number; refToken?: string; respectHours?: boolean; cancelKeywords?: string[];
  steps?: { delayMinutes: number; template: string }[];
};
export type DraftRule = {
  options?: DraftOptions;
  id: string; kind: DraftKind; businessId: string; channelId: string; name: string;
  mode: "draft"; priority: number; cooldownMinutes: number; keywords: string[];
  template: string; awayTemplate: string; timezone: string;
  hours: { day: number; start: number; end: number }[];
  memberIds: string[]; assignOnIncoming: boolean; alertMinutes: number; menu: { label: string; reply: string }[];
};
export type DraftEvent = { id: string; conversationId: string; recipientId: string; at: string;
  kind: "customer" | "staff" | "bot" | "resume" | "comment" | "health" | "referral" | "cancel"; text: string; firstContact?: boolean;
  businessId?: string; channelId?: string;
  source?: { kind: "simulated_ad_referral"; adId: string };
  returning?: { previousConversations: number; lastSeenAt: string };
  comment?: { commentId: string; postId: string; parentId: string | null; deleted: boolean };
  refToken?: string;
};
export type DraftAction = { key: string; ruleId: string; conversationId: string; recipientId: string;
  kind: "reply" | "assign" | "alert" | "handoff" | "context" | "health" | "hide_comment" | "filter" | "flow" | "followup"; text?: string; memberId?: string; dueAt?: string; url?: string; reason?: string; status: "proposed" | "cancelled" | "skipped" };
export type DraftContext = { businessId: string; channelId: string; now: string;
  publicPageId?: string | null; recordedConnectionStatus?: string | null;
  staff: { id: string; load: number }[]; assignments?: {conversationId:string;memberId:string}[] };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown, max = 2000) => typeof v === "string" && v.length <= max ? v.trim() : "";
const integer = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 30 && v.every(x => !!string(x, 100));
const stage2 = (kind: DraftKind) => DRAFT_KINDS.indexOf(kind) >= 5;
const timestamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) && /(Z|[+-]\d\d:\d\d)$/i.test(v);
const publicId = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}$/.test(v);
const commentId = (v: unknown): v is string => typeof v === "string" && /^\d{1,30}(?:_\d{1,30})?$/.test(v);
// Static public campaign labels only: no appended tenant/customer identifiers or arbitrary redirect URLs.
export const safeDraftRefToken = (v: unknown): v is string => typeof v === "string" && /^campaign_[a-z]{3,24}(?:_[a-z]{2,16})?$/.test(v) && !/(secret|token|password|customer|tenant|email|phone|user|account|business)/.test(v);
export function draftFlowUrl(pageId: unknown, ref: unknown) {
  if (!publicId(pageId) || !safeDraftRefToken(ref)) throw Error("Use a connected public Page ID and a public campaign label.");
  return `https://m.me/${pageId}?ref=${ref}`;
}
export function draftRecordedHealth(value: unknown) {
  return typeof value === "string" && ["valid","active","expired","invalid","revoked","missing","reauthorization_required"].includes(value) ? value : "unknown";
}
function draftOptions(value: unknown): DraftOptions {
  if (value === undefined) return {};
  if (!record(value) || Object.keys(value).some(k => !["adIds","excludeKeywords","firstLevelOnly","phoneOnly","minPrevious","refToken","respectHours","cancelKeywords","steps"].includes(k))) throw Error("Invalid draft options.");
  for (const key of ["adIds","excludeKeywords","cancelKeywords"] as const) if (value[key] !== undefined && !ids(value[key])) throw Error("Invalid draft option list.");
  if (value.adIds && !(value.adIds as string[]).every(publicId)) throw Error("Use explicit numeric Ad IDs, never customer IDs or guessed references.");
  for (const key of ["firstLevelOnly","phoneOnly","respectHours"] as const) if (value[key] !== undefined && typeof value[key] !== "boolean") throw Error("Invalid draft option switch.");
  if (value.minPrevious !== undefined && !integer(value.minPrevious,1,10000)) throw Error("Returning context needs 1-10000 previous conversations.");
  if (value.refToken !== undefined && !safeDraftRefToken(value.refToken)) throw Error("Use a static public campaign_word label; no private data.");
  if (value.steps !== undefined && (!Array.isArray(value.steps) || !value.steps.length || value.steps.length > 5 || !value.steps.every(step => record(step) && integer(step.delayMinutes,1,1440) && !!string(step.template)))) throw Error("Use 1-5 follow-up steps with 1-1440 minute delays and templates.");
  return value as DraftOptions;
}
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
    const options = draftOptions(v.options);
    if (v.kind === "ads_specific_reply" && (!options.adIds?.length || !string(v.template))) throw Error("Ads draft needs explicit Ad IDs and a reply.");
    if (v.kind === "comment_phone_spam_hide" && !(v.keywords as string[]).length && !options.phoneOnly) throw Error("Choose spam keywords or explicitly allow phone-only hide proposals.");
    if (v.kind === "comment_filters" && !(v.keywords as string[]).length && !options.excludeKeywords?.length && !options.firstLevelOnly) throw Error("Choose include/exclude keywords or first-level filtering.");
    if (v.kind === "qr_ref_flow" && !safeDraftRefToken(options.refToken)) throw Error("Choose a public campaign label.");
    if (v.kind === "conditional_followups" && (!(v.keywords as string[]).length || !options.steps?.length || !options.cancelKeywords?.length || (options.respectHours && !v.hours.length))) throw Error("Follow-ups need trigger/cancel keywords, steps and configured hours when enabled.");
    used.add(v.id as string); return {...v, timezone: string(v.timezone,100), options} as unknown as DraftRule;
  });
}
export function parseDraftEvents(input: unknown, scope?: Pick<DraftContext,"businessId"|"channelId">, requireScope = false): DraftEvent[] {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw Error("Use 1-100 synthetic events.");
  return input.map(v => {
    if (!record(v) || !string(v.id,100) || !string(v.conversationId,100) || !string(v.recipientId,100) ||
        !["customer","staff","bot","resume","comment","health","referral","cancel"].includes(v.kind as string) || typeof v.text !== "string" || v.text.length > 2000 ||
        !timestamp(v.at) || (v.firstContact !== undefined && typeof v.firstContact !== "boolean")) throw Error("Invalid synthetic event.");
    const extended = requireScope || v.source !== undefined || v.returning !== undefined || v.comment !== undefined || v.refToken !== undefined || ["comment","health","referral","cancel"].includes(v.kind as string);
    if (scope && ((extended && (v.businessId !== scope.businessId || v.channelId !== scope.channelId)) || (v.businessId !== undefined && v.businessId !== scope.businessId) || (v.channelId !== undefined && v.channelId !== scope.channelId))) throw Error("Synthetic event business/channel scope mismatch.");
    if (v.source !== undefined && (v.kind !== "customer" || !record(v.source) || v.source.kind !== "simulated_ad_referral" || !publicId(v.source.adId))) throw Error("Use a scoped synthetic customer Ad-referral ID.");
    if (v.returning !== undefined && (v.kind !== "customer" || !record(v.returning) || !integer(v.returning.previousConversations,1,10000) || !timestamp(v.returning.lastSeenAt) || Date.parse(v.returning.lastSeenAt) >= Date.parse(v.at))) throw Error("Invalid prior synthetic customer context.");
    if (v.kind === "comment" && (!record(v.comment) || !commentId(v.comment.commentId) || typeof v.comment.postId !== "string" || !/^\d{1,30}_\d{1,30}$/.test(v.comment.postId) || (v.comment.parentId !== null && !commentId(v.comment.parentId)) || typeof v.comment.deleted !== "boolean")) throw Error("Comments need explicit post/comment/parent/deleted metadata.");
    if (v.kind !== "comment" && v.comment !== undefined) throw Error("Comment metadata cannot open a direct messaging window.");
    if (v.refToken !== undefined && (!["customer","referral"].includes(v.kind as string) || !safeDraftRefToken(v.refToken))) throw Error("Invalid public campaign reference.");
    if (v.kind === "referral" && !safeDraftRefToken(v.refToken)) throw Error("Referral entry needs a public campaign label.");
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
  if (!timestamp(ctx.now)) throw Error("Invalid preview clock.");
  rules = parseDraftRules(rules,ctx); events = parseDraftEvents(events,ctx,rules.some(r=>stage2(r.kind)));
  if (rules.some(r=>r.memberIds.some(id=>!ctx.staff.some(m=>m.id===id)))) throw Error("Draft references unavailable staff.");
  if(ctx.assignments && (ctx.assignments.length>100 || ctx.assignments.some(a=>!a.conversationId || !ctx.staff.some(m=>m.id===a.memberId)))) throw Error("Invalid sample assignment.");
  const now=Date.parse(ctx.now), windowMs=24*60*60000;
  const actions: DraftAction[] = [], seen = new Map<string,string>(), cooldown = new Map<string,number>(), cancelAt = new Map<string,number>();
  const commentClaims = new Set<string>();
  const conversations = new Map<string,{human:boolean; assigned:string|null; alertKeys:string[]}>();
  const sortedRules=[...rules].sort((a,b)=>b.priority-a.priority || a.id.localeCompare(b.id));
  const rank=(kind:DraftEvent["kind"])=>({staff:0,cancel:1,customer:2,comment:3,referral:3,health:4,resume:5,bot:6})[kind];
  const cancelFollowups=(recipient:string,stamp:number,reason:string)=>{for(const action of actions)if(action.recipientId===recipient&&action.kind==="followup"&&action.status==="proposed"&&Date.parse(action.dueAt!)>=stamp){action.status="cancelled";action.reason=reason;}};
  for(const event of [...events].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||rank(a.kind)-rank(b.kind)||a.id.localeCompare(b.id))) {
    const stamp=Date.parse(event.at), identity=JSON.stringify([ctx.businessId,ctx.channelId,event.id]);
    if(stamp>now)continue;
    const signature=JSON.stringify(event,(_key,value)=>record(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);if(seen.has(identity)){if(seen.get(identity)!==signature)throw Error("Conflicting duplicate synthetic event ID.");continue;}seen.set(identity,signature);
    const stateId=JSON.stringify([event.conversationId,event.recipientId]);
    const state=conversations.get(stateId)??{human:false,assigned:ctx.assignments?.find(a=>a.conversationId===event.conversationId)?.memberId??null,alertKeys:[]};conversations.set(stateId,state);
    const key=(r:DraftRule,kind:string)=>JSON.stringify([ctx.businessId,ctx.channelId,event.recipientId,event.id,r.id,kind]);
    const add=(r:DraftRule,kind:DraftAction["kind"],extra:Partial<DraftAction>={})=>{if(actions.length>=500)throw Error("Draft plan exceeds 500 items; reduce rules/events.");const a:DraftAction={key:key(r,kind),ruleId:r.id,conversationId:event.conversationId,recipientId:event.recipientId,kind,status:"proposed",...extra};actions.push(a);return a;};
    const cancelAlerts=()=>{for(const action of actions)if(state.alertKeys.includes(action.key))action.status="cancelled";state.alertKeys=[];};
    const permitted=(r:DraftRule)=>{const previous=cooldown.get(JSON.stringify([event.recipientId,r.id]));return previous===undefined||stamp-previous>=r.cooldownMinutes*60000;};
    const reserve=(r:DraftRule)=>cooldown.set(JSON.stringify([event.recipientId,r.id]),stamp);
    if(event.kind==="staff"){state.human=true;cancelAlerts();cancelFollowups(event.recipientId,stamp,"Synthetic staff reply/human takeover.");continue;}
    if(event.kind==="cancel"){cancelFollowups(event.recipientId,stamp,"Explicit synthetic operator cancellation.");cancelAt.set(event.recipientId,stamp);continue;}
    if(event.kind==="resume"){state.human=false;continue;}
    if(event.kind==="bot")continue;
    if(event.kind==="health"){
      for(const rule of sortedRules.filter(r=>r.kind==="connection_health"&&permitted(r))){add(rule,"health",{text:`Recorded channel status: ${draftRecordedHealth(ctx.recordedConnectionStatus)}. Not a live connectivity or permission probe.`});reserve(rule);}continue;
    }
    if(event.kind==="comment"){
      const comment=event.comment!;
      if(comment.deleted)continue;
      if(!publicId(ctx.publicPageId)||!comment.postId.startsWith(ctx.publicPageId+"_"))throw Error("Synthetic comment must belong to the selected public Page.");
      const filters=sortedRules.filter(r=>r.kind==="comment_filters");let allowed=true;
      for(const rule of filters.filter(permitted)){
        const excluded=matches(rule.options?.excludeKeywords??[],event.text),level=rule.options?.firstLevelOnly&&comment.parentId!==comment.postId;
        const included=!rule.keywords.length||matches(rule.keywords,event.text);const pass=!excluded&&!level&&included;
        if(!pass)allowed=false;add(rule,"filter",{text:pass?"Include in synthetic comment plan.":"Exclude from synthetic comment plan.",reason:excluded?"Excluded keyword.":level?"Parent is nested or unknown; not proven first-level.":!included?"No include keyword.":"Comment filters matched."});reserve(rule);
      }
      // Filters are safety constraints even when their explanation is cooled down.
      if(filters.some(rule=>matches(rule.options?.excludeKeywords??[],event.text)||(rule.options?.firstLevelOnly&&comment.parentId!==comment.postId)||(rule.keywords.length&&!matches(rule.keywords,event.text))))allowed=false;
      if(!allowed)continue;
      const hasPhone=(event.text.match(/\+?\d[\d ()-]{6,24}\d/g)??[]).some(value=>{const length=value.replace(/\D/g,"").length;return length>=8&&length<=15;});
      const rule=sortedRules.find(r=>r.kind==="comment_phone_spam_hide"&&permitted(r)&&hasPhone&&(r.options?.phoneOnly||matches(r.keywords,event.text))&&(!r.options?.firstLevelOnly||comment.parentId===comment.postId)&&!matches(r.options?.excludeKeywords??[],event.text));
      const claim=rule?JSON.stringify([ctx.businessId,ctx.channelId,comment.commentId,rule.id,"hide_comment"]):null;
      if(rule&&claim&&!commentClaims.has(claim)){commentClaims.add(claim);add(rule,"hide_comment",{text:"Propose hiding this synthetic comment; never delete.",reason:rule.options?.phoneOnly?"Phone-pattern proposal explicitly enabled; manual review required.":"Phone pattern and configured spam keyword; manual review required."});reserve(rule);}continue;
    }
    if(event.kind==="referral"){
      for(const rule of sortedRules.filter(r=>r.kind==="qr_ref_flow"&&r.options?.refToken===event.refToken&&permitted(r))){add(rule,"flow",{url:draftFlowUrl(ctx.publicPageId,rule.options?.refToken),text:"Public reference link / QR payload proposal. Referral-only events never authorize a reply."});reserve(rule);}continue;
    }
    cancelAlerts();cancelFollowups(event.recipientId,stamp,"New synthetic customer message cancels pending follow-ups.");
    const cancelled=sortedRules.some(r=>r.kind==="conditional_followups"&&matches(r.options?.cancelKeywords??[],event.text));
    if(cancelled)cancelAt.set(event.recipientId,stamp);
    const assignment=sortedRules.find(r=>r.kind==="human_takeover"&&r.assignOnIncoming);
    if(assignment&&!state.assigned){const staff=ctx.staff.filter(m=>assignment.memberIds.includes(m.id)).sort((a,b)=>a.id.localeCompare(b.id))[0];if(staff){state.assigned=staff.id;add(assignment,"assign",{memberId:staff.id});}}
    const takeover=sortedRules.find(r=>r.kind==="human_takeover"&&matches(r.keywords,event.text));
    if(takeover){state.human=true;add(takeover,"handoff");cancelFollowups(event.recipientId,stamp,"Synthetic human takeover.");if(!state.assigned){const staff=ctx.staff.filter(m=>takeover.memberIds.includes(m.id)).sort((a,b)=>a.load-b.load||a.id.localeCompare(b.id))[0];if(staff){state.assigned=staff.id;add(takeover,"assign",{memberId:staff.id});}}}
    for(const rule of sortedRules.filter(r=>r.kind==="unanswered_alert")){const action=add(rule,"alert",{memberId:rule.memberIds[0],dueAt:new Date(stamp+rule.alertMinutes*60000).toISOString()});state.alertKeys.push(action.key);}
    const returningReady = new Set<string>();
    for(const rule of sortedRules.filter(r=>r.kind==="returning_context"&&permitted(r)&&event.returning&&event.returning.previousConversations>=(r.options?.minPrevious??1))){add(rule,"context",{text:`Synthetic previous conversations: ${event.returning!.previousConversations}; last seen: ${event.returning!.lastSeenAt}. No real customer history was fetched.`});returningReady.add(rule.id);reserve(rule);}
    // No HUMAN_AGENT/comment extensions. Historical simulations are not provider eligibility proof.
    if(state.human || now-stamp>=windowMs)continue;
    const sequence=sortedRules.find(r=>r.kind==="conditional_followups"&&permitted(r)&&matches(r.keywords,event.text));
    if(sequence&&!cancelled&&(cancelAt.get(event.recipientId)??-1)<stamp){
      let due=stamp;
      for(const [index,step] of sequence.options!.steps!.entries()){
        due+=step.delayMinutes*60000;const dueAt=new Date(due).toISOString();
        const reason=due>=stamp+windowMs?"Outside the direct-customer 24-hour window.":due<=now?"Due time already passed; never backfill.":sequence.options?.respectHours&&!withinDraftHours(sequence,dueAt)?"Outside configured timezone/business hours.":"Unanswered direct conversation only; cancel on customer/staff/operator events.";
        add(sequence,"followup",{key:key(sequence,"followup:"+index),text:step.template,dueAt,status:reason.startsWith("Unanswered")?"proposed":"skipped",reason});
      }reserve(sequence);
    }
    for(const rule of sortedRules){if(!permitted(rule)&&!(rule.kind==="returning_context"&&returningReady.has(rule.id)))continue;
      let text="";
      if(rule.kind==="keyword_faq"&&matches(rule.keywords,event.text))text=rule.template;
      if(rule.kind==="welcome_away")text=!withinDraftHours(rule,event.at)?rule.awayTemplate:event.firstContact?rule.template:"";
      if(rule.kind==="ads_specific_reply"&&event.source?.kind==="simulated_ad_referral"&&rule.options?.adIds?.includes(event.source.adId)&&(!rule.keywords.length||matches(rule.keywords,event.text)))text=rule.template;
      if(rule.kind==="returning_context"&&event.returning&&event.returning.previousConversations>=(rule.options?.minPrevious??1))text=rule.template;
      if(rule.kind==="qr_ref_flow"&&event.refToken===rule.options?.refToken){draftFlowUrl(ctx.publicPageId,rule.options?.refToken);text=rule.template;}
      if(rule.kind==="conversation_menu"){const choice=rule.menu.find(m=>m.label.normalize("NFKC").toLowerCase()===event.text.normalize("NFKC").trim().toLowerCase());text=choice?.reply??(matches(rule.keywords,event.text)?rule.menu.map(m=>m.label).join("\n"):"");}
      if(text){add(rule,"reply",{text});reserve(rule);break;}
    }
  }
  return {dryRun:true as const,executionAvailable:false as const,actions,note:"Synthetic session draft plan only. No sends, hides, assignments, alerts or jobs executed. Ad/ref ownership, provider permissions, durable atomic reservations, rate limits and cancellable jobs require separate verified live wiring."};
}
