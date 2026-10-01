import { TENH_BOT_AVAILABLE } from "./availability";
import "server-only";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { trustedStoredBotEvent, trustedStoredCommentEvent, runBoundedBotExecution, type ExecutionJob, type StoredBotEvent } from "./execution-safety";
import { parseDraftRules, previewDraftRules, safeDraftRefToken, draftRecordedHealth } from "./draft-rules";
import { messengerSourceFromEvent } from "@/lib/facebook/messenger-source";

const enabled = () => TENH_BOT_AVAILABLE && process.env.TENH_BOT_EXECUTION_ENABLED === "true";
export async function holdBotForManualReply(businessId: string, conversationId: string) {
  if (!enabled()) return;
  const result = await db.rpc("tenh_bot_set_human_hold", { p_business: businessId, p_conversation: conversationId, p_hold: true });
  if (result.error || result.data !== true) throw Error("bot_human_hold_unavailable");
}
export async function noteStoredFacebookBotEvent(scope: { businessId: string; conversationId: string; platformMessageId: string }) {
  if (!enabled()) return { paused: true };
  const row = await db.from("messages").select("id").eq("business_id", scope.businessId)
    .eq("conversation_id", scope.conversationId).eq("platform_message_id", scope.platformMessageId).maybeSingle();
  if (row.error || !row.data) throw Error("bot_stored_identity_unavailable");
  return recordStoredBotMessage(row.data.id);
}
/** Called only with a persisted message ID. No browser-supplied event metadata. */
export async function recordStoredBotMessage(messageId: string, now = new Date().toISOString()) {
  if (!enabled()) return { paused: true };
  const message = await db.from("messages").select("id,business_id,conversation_id,direction,is_echo,platform_message_id,platform_created_at,message_type,message_text,sender_platform_id,raw_payload,comment_is_deleted").eq("id", messageId).maybeSingle();
  if (message.error || !message.data) throw Error("bot_message_unavailable");
  const m = message.data;
  const conversation = await db.from("conversations").select("id,business_id,social_account_id,contact_id,source_type").eq("id", m.conversation_id).eq("business_id", m.business_id).maybeSingle();
  if (conversation.error || !conversation.data) throw Error("bot_conversation_unavailable");
  const c = conversation.data;
  const [contact, channel, saved, members] = await Promise.all([
    db.from("contacts").select("id,business_id,platform_user_id").eq("id", c.contact_id).eq("business_id", m.business_id).maybeSingle(),
    db.from("social_accounts").select("id,business_id,platform,platform_account_id,is_active,facebook_token_status").eq("id", c.social_account_id).eq("business_id", m.business_id).maybeSingle(),
    db.from("tenh_bot_rule_sets").select("rules,revision,enabled").eq("business_id", m.business_id).eq("social_account_id", c.social_account_id).maybeSingle(),
    db.from("team_members").select("id").eq("business_id", m.business_id).eq("is_active", true).limit(100),
  ]);
  if ([contact, channel, saved, members].some(result => result.error) || !contact.data || !channel.data) throw Error("bot_context_unavailable");
  const stored = { message: m, conversation: c, contact: contact.data, channel: channel.data } as StoredBotEvent;
  const event = c.source_type === "comment" ? trustedStoredCommentEvent({ ...stored, rawPayload: m.raw_payload, deleted: Boolean(m.comment_is_deleted) }, now) : trustedStoredBotEvent(stored, now);
  if (event.kind === "echo") return { ignored: true };
  const rules = saved.data?.rules?.length ? parseDraftRules(saved.data.rules, { businessId: event.businessId, channelId: event.channelId }) : [];
  let actions: unknown[] = [];
  if (saved.data?.enabled && ["customer", "comment"].includes(event.kind) && rules.length) {
    const earlier = await db.from("messages").select("id").eq("business_id", event.businessId).eq("conversation_id", event.conversationId)
      .eq("direction", "incoming").eq("is_echo", false).order("platform_created_at", { ascending: true }).limit(2);
    if (earlier.error) throw Error("bot_history_unavailable");
    const raw = m.raw_payload as { sender?: { id?: string }; recipient?: { id?: string }; message?: { mid?: string; referral?: { ref?: unknown } }; referral?: { ref?: unknown } } | null;
    const verifiedPayload = raw?.sender?.id === event.recipientId && raw?.recipient?.id === channel.data.platform_account_id && raw?.message?.mid === m.platform_message_id;
    const source = verifiedPayload ? messengerSourceFromEvent(raw) : null;
    const ref = verifiedPayload ? raw?.message?.referral?.ref ?? raw?.referral?.ref : undefined;
    let returning: { previousConversations: number; lastSeenAt: string } | undefined;
    if (rules.some(rule => rule.kind === "returning_context")) {
      const previous = await db.from("conversations").select("last_message_at", { count: "exact" }).eq("business_id", event.businessId)
        .eq("contact_id", c.contact_id).neq("id", event.conversationId).order("last_message_at", { ascending: false }).limit(1);
      if (previous.error) throw Error("bot_returning_history_unavailable");
      const lastSeenAt = previous.data?.[0]?.last_message_at;
      if (previous.count && lastSeenAt && Number.isFinite(Date.parse(lastSeenAt))) returning = { previousConversations: previous.count, lastSeenAt };
    }
    const plan = previewDraftRules(rules, [{ ...event, kind: event.kind === "comment" ? "comment" : "customer", firstContact: earlier.data?.length === 1 && earlier.data[0].id === event.id,
      ...(source?.ad_id ? { source: { kind: "simulated_ad_referral" as const, adId: source.ad_id } } : {}),
      ...(safeDraftRefToken(ref) ? { refToken: ref } : {}), ...(returning ? { returning } : {}) }, ...(rules.some(rule => rule.kind === "connection_health") ? [{ ...event, id: event.id + ":health", kind: "health" as const, text: "" }] : []), ...(safeDraftRefToken(ref) && event.kind === "customer" ? [{ ...event, id: event.id + ":referral", kind: "referral" as const, refToken: ref, text: "" }] : [])],
      { businessId: event.businessId, channelId: event.channelId, now, publicPageId: channel.data.platform_account_id, recordedConnectionStatus: draftRecordedHealth(channel.data.facebook_token_status),
        staff: (members.data ?? []).map(member => ({ id: member.id, load: 0 })) });
    // The evaluator's historical name/type describes its test interface. Metadata
    // above is reread from scoped storage; never accept browser sample provenance.
    actions = plan.actions.filter(action => action.status === "proposed").map(action => ({...action,ruleKind:rules.find(rule=>rule.id===action.ruleId)?.kind})).map(action => action.kind === "context" ? {
      ...action, text: `Previous conversations: ${returning?.previousConversations ?? 0}; last seen: ${returning?.lastSeenAt ?? "unknown"}.`,
    } : action);
  }
  const result = await db.rpc("tenh_bot_record_event", { p_message: messageId, p_revision: saved.data?.revision ?? 0, p_actions: actions });
  if (result.error) throw Error("bot_event_not_recorded");
  return result.data;
}

type StoredJob = { id: string; business_id: string; social_account_id: string; conversation_id: string; recipient_id: string;
  message_id: string;
  claim_token: string; generation: number; due_at: string; expires_at: string; action: { kind: ExecutionJob["kind"]; text?: string; memberId?: string } };
/** Transport is explicitly injected. No default provider send exists here. */
export async function runStoredBotJobs(transport: {
  supported(job: ExecutionJob): boolean;
  execute(job: ExecutionJob): Promise<{ confirmed: boolean; providerId?: string; definitiveRejection?: boolean }>;
}, now = new Date().toISOString()) {
  return runBoundedBotExecution({ enabled: enabled(),
    claim: async limit => {
      const result = await db.rpc("tenh_bot_claim_jobs", { p_limit: limit });
      if (result.error || !Array.isArray(result.data)) throw Error("bot_claim_unavailable");
      return result.data.map((row: StoredJob) => ({ id: row.id, businessId: row.business_id, channelId: row.social_account_id,
        conversationId: row.conversation_id, recipientId: row.recipient_id, messageId: row.message_id, claimToken: row.claim_token, generation: row.generation,
        dueAt: row.due_at, expiresAt: row.expires_at, kind: row.action.kind, text: row.action.text, memberId: row.action.memberId }));
    },
    reserve: async job => {
      const result = await db.rpc("tenh_bot_reserve_job", { p_job: job.id, p_claim: job.claimToken });
      if (result.error || !result.data) throw Error("bot_reservation_unavailable");
      return result.data;
    }, supported: transport.supported, execute: transport.execute,
    finish: async (job, status, reason, providerId) => {
      const result = await db.rpc("tenh_bot_finish_job", { p_job: job.id, p_claim: job.claimToken, p_status: status, p_reason: reason, p_provider: providerId ?? null });
      if (result.error || result.data !== true) throw Error("bot_result_not_persisted");
    },
  }, now, 3);
}
