/** Trusted storage boundary; never normalize browser sample events into live jobs. */
export type StoredBotEvent = {
  message: { id: string; business_id: string; conversation_id: string; direction: string;
    is_echo?: boolean; platform_message_id: string | null; platform_created_at: string | null;
    message_type: string; message_text: string | null; sender_platform_id?: string | null };
  conversation: { id: string; business_id: string; social_account_id: string; contact_id: string; source_type?: string | null };
  contact: { id: string; business_id: string; platform_user_id: string | null };
  channel: { id: string; business_id: string; platform: string; platform_account_id: string; is_active: boolean };
};
export type TrustedBotEvent = { id: string; businessId: string; channelId: string; conversationId: string;
  recipientId: string; at: string; kind: "customer" | "staff" | "echo"; text: string };
export function trustedStoredBotEvent(row: StoredBotEvent, now: string): TrustedBotEvent {
  const { message: m, conversation: c, contact: ct, channel: ch } = row;
  if (!m.id || !m.platform_message_id || m.business_id !== c.business_id || ct.business_id !== c.business_id ||
      ch.business_id !== c.business_id || c.id !== m.conversation_id || c.contact_id !== ct.id || c.social_account_id !== ch.id ||
      !ch.is_active || ch.platform !== "facebook" || !/^\d{1,30}$/.test(ch.platform_account_id) ||
      !ct.platform_user_id || !/^\d{1,30}$/.test(ct.platform_user_id) ||
      !["incoming", "outgoing"].includes(m.direction)) throw Error("untrusted_event_scope");
  const timestamp = Date.parse(m.platform_created_at ?? ""), clock = Date.parse(now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(clock) || timestamp > clock + 60000) throw Error("untrusted_event_time");
  if (c.source_type === "comment") throw Error("comment_requires_verified_comment_adapter");
  if (m.direction === "incoming" && m.sender_platform_id !== ct.platform_user_id) throw Error("untrusted_customer_identity");
  return { id: m.id, businessId: c.business_id, channelId: ch.id, conversationId: c.id,
    recipientId: ct.platform_user_id, at: new Date(timestamp).toISOString(),
    kind: m.is_echo ? "echo" : m.direction === "incoming" ? "customer" : "staff", text: (m.message_text ?? "").slice(0, 2000) };
}

export function trustedStoredCommentEvent(row: StoredBotEvent & { rawPayload: unknown; deleted: boolean }, now: string) {
  if (row.conversation.source_type !== "comment" || row.deleted || row.message.is_echo || row.message.direction !== "incoming") throw Error("untrusted_comment_event");
  // Reuse identity validation only. The resulting event is explicitly comment,
  // never a customer DM and never eligible to reopen its messaging window.
  const identity = trustedStoredBotEvent({ ...row, conversation: { ...row.conversation, source_type: "messenger" } }, now);
  const raw = row.rawPayload as { item?: unknown; verb?: unknown; post_id?: unknown; comment_id?: unknown; parent_id?: unknown } | null;
  if (raw?.item !== "comment" || raw.verb !== "add" || raw.comment_id !== row.message.platform_message_id ||
      typeof raw.post_id !== "string" || !new RegExp(`^${row.channel.platform_account_id}_\\d{1,30}$`).test(raw.post_id)) throw Error("untrusted_comment_provenance");
  return { ...identity, kind: "comment" as const, comment: { commentId: raw.comment_id as string, postId: raw.post_id,
    parentId: typeof raw.parent_id === "string" ? raw.parent_id : null, deleted: false } };
}

export type ExecutionJob = { id: string; businessId: string; channelId: string; conversationId: string; recipientId: string;
  messageId?: string;
  kind: "reply" | "followup" | "assign" | "alert" | "handoff" | "context" | "health" | "hide_comment" | "filter" | "flow";
  dueAt: string; expiresAt: string; claimToken: string; generation: number; text?: string; memberId?: string };
export type JobOutcome = "sent" | "completed" | "cancelled" | "unsupported" | "rejected" | "needs_review";
export type Eligibility = { allowed: boolean; reason: string; standardWindowOpen: boolean };
export type ExecutionDependencies = {
  enabled: boolean;
  claim(limit: number): Promise<ExecutionJob[]>;
  // Must atomically validate claim, enabled rule, tenant/channel/recipient, generation,
  // human hold, due/expiry, cooldown and rate budget before any effect.
  reserve(job: ExecutionJob, now: string): Promise<Eligibility>;
  supported(job: ExecutionJob): boolean;
  execute(job: ExecutionJob): Promise<{ confirmed: boolean; providerId?: string; definitiveRejection?: boolean }>;
  finish(job: ExecutionJob, outcome: JobOutcome, reason: string, providerId?: string): Promise<void>;
};
/** No automatic replay of an effect whose delivery/persistence is uncertain. */
export async function runBoundedBotExecution(deps: ExecutionDependencies, now: string, limit = 10) {
  if (!deps.enabled) return { paused: true, processed: 0 };
  if (!Number.isFinite(Date.parse(now))) throw Error("invalid_worker_clock");
  const jobs = await deps.claim(Math.max(1, Math.min(10, Math.trunc(limit) || 1)));
  if (jobs.length > 10) throw Error("unbounded_claim_result");
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw Error("duplicate_claim_result");
  let processed = 0;
  for (const job of jobs) {
    if (!Number.isFinite(Date.parse(job.dueAt)) || !Number.isFinite(Date.parse(job.expiresAt)) ||
        Date.parse(job.dueAt) > Date.parse(now) || Date.parse(job.expiresAt) <= Date.parse(now)) {
      await deps.finish(job, "cancelled", "Outside job schedule."); processed++; continue;
    }
    if (!deps.supported(job)) { await deps.finish(job, "unsupported", "Provider/action adapter unavailable."); processed++; continue; }
    const eligible = await deps.reserve(job, now);
    if (!eligible.allowed || Date.parse(job.dueAt) > Date.parse(now) || Date.parse(job.expiresAt) <= Date.parse(now)) {
      await deps.finish(job, "cancelled", eligible.reason || "Outside job schedule."); processed++; continue;
    }
    if (["reply", "followup"].includes(job.kind) && !eligible.standardWindowOpen) {
      await deps.finish(job, "cancelled", "Outside standard customer messaging window."); processed++; continue;
    }
    let result;
    try { result = await deps.execute(job); }
    catch { await deps.finish(job, "needs_review", "Effect outcome uncertain; automatic replay prohibited."); processed++; continue; }
    const outcome = result.definitiveRejection ? "rejected" : !result.confirmed ? "needs_review" :
      ["reply", "followup", "hide_comment"].includes(job.kind) ? "sent" : "completed";
    // Persistence failure must escape, never be interpreted as a provider failure.
    await deps.finish(job, outcome, outcome === "needs_review" ? "Unconfirmed effect; do not replay." : "Effect result recorded.", result.providerId);
    processed++;
  }
  return { paused: false, processed };
}
