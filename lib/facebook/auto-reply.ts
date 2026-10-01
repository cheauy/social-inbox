import "server-only";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { resolveStoredFacebookPageAccessToken, refreshFacebookPageAccessToken, isFacebookAccessTokenError } from "@/lib/facebook/get-facebook-page-access-token";
import { getFacebookMessengerReplyPolicy } from "@/lib/facebook/messenger-reply-policy";
import { confirmCommentReply } from "@/lib/facebook/confirm-comment-reply";

export type AutoReplyRule = {
  id: string; business_id: string; social_account_id: string; name: string;
  post_id: string | null; post_url: string | null; public_template: string | null;
  private_template: string | null; enabled: boolean; starts_at: string | null;
  activated_at: string | null; created_at: string;
};
export type AutoReplyJob = {
  id: string; business_id: string; social_account_id: string; rule_id: string;
  message_id: string | null; comment_id: string; recipient_id: string; action: "public" | "private";
  activation: string; status: string; attempts: number; claim_token: string;
  send_started_at: string | null; platform_reply_id: string | null; reason: string | null;
  send_template?: string | null;
};
type GraphError = { code?: number; error_subcode?: number; is_transient?: boolean };
type GraphResult = {
  id?: string; message_id?: string; from?: { id?: string }; object?: { id?: string };
  created_time?: string; can_reply_privately?: boolean; error?: GraphError;
  data?: { id?: string }[]; paging?: { next?: string }; summary?: { total_count?: number };
};
const version = () => process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0";

export async function autoReplyGraph(path: string, token: string, body?: object) {
  const response = await fetch(`https://graph.facebook.com/${version()}/${path}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  let result: GraphResult;
  try { result = await response.json(); }
  catch { throw new Error("meta_response_unknown"); }
  return { response, result };
}

export function autoReplyCutoff(rule: AutoReplyRule, timestamp: string | null) {
  return rule.enabled && !!rule.activated_at && !!rule.starts_at && !!timestamp &&
    Date.parse(timestamp) >= Math.max(Date.parse(rule.activated_at), Date.parse(rule.starts_at));
}
export function autoReplyFailure(status: number, error?: GraphError) {
  if (status >= 500 || error?.code === 1) return "needs_review";
  if (status === 429 || [4, 17, 32, 190, 613].includes(error?.code ?? 0)) return "retry";
  // Other transient failures may have posted the message. Reconcile, never retry on a guess.
  if (error?.is_transient) return "needs_review";
  return "failed";
}

async function finish(job: AutoReplyJob, status: string, reason: string, replyId?: string) {
  const { error } = await db.from("facebook_auto_reply_jobs").update({
    status, reason, ...(replyId ? { platform_reply_id: replyId, send_template: null } : {}),
    available_at: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts)).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", job.id).eq("claim_token", job.claim_token).in("status", ["claimed", "sending", "needs_review"]);
  if (error) throw new Error("auto_reply_result_not_persisted");
  if (["sent", "failed", "retry", "needs_review"].includes(status)) {
    const result = await db.rpc("facebook_auto_reply_note_result", { p_business: job.business_id, p_failed: status !== "sent" });
    if (result.error) throw new Error("auto_reply_circuit_not_persisted");
  }
  if (status === "failed" && job.action === "private") {
    // Only a definitive rejection releases the customer reservation.
    await db.from("facebook_auto_reply_recipients").delete().eq("job_id", job.id);
  }
}

async function context(job: AutoReplyJob) {
  if (!job.message_id) return null;
  const [{ data: rule, error: re }, { data: message, error: me }, { data: page, error: pe }] = await Promise.all([
    db.from("facebook_auto_reply_rules").select("*").eq("id", job.rule_id).eq("business_id", job.business_id).maybeSingle(),
    db.from("messages").select("id,conversation_id,platform_message_id,sender_platform_id,platform_created_at,comment_is_deleted,raw_payload")
      .eq("id", job.message_id).eq("business_id", job.business_id).maybeSingle(),
    db.from("social_accounts").select("id,business_id,platform,platform_account_id,is_active,facebook_token_status,facebook_page_access_token_encrypted")
      .eq("id", job.social_account_id).eq("business_id", job.business_id).maybeSingle(),
  ]);
  if (re || me || pe) throw new Error("context_read_failed");
  if (!rule || !message || !page || !page.is_active || page.platform !== "facebook" ||
    !page.platform_account_id || rule.social_account_id !== page.id) return null;
  const { data: conversation, error } = await db.from("conversations").select("id")
    .eq("id", message.conversation_id).eq("business_id", job.business_id).eq("social_account_id", page.id).maybeSingle();
  if (error) throw new Error("conversation_read_failed");
  if (!conversation || message.platform_message_id !== job.comment_id ||
    message.sender_platform_id !== job.recipient_id) return null;
  return { rule: rule as AutoReplyRule, message, page, conversation };
}

export async function inspectAutoReply(job: AutoReplyJob, dryRun = false) {
  const ctx = await context(job);
  if (!ctx) return { reason: "page_or_comment_unavailable" };
  if (!dryRun && (!autoReplyCutoff(ctx.rule, ctx.message.platform_created_at) ||
    ctx.rule.activated_at !== job.activation)) return { reason: "paused_or_before_start" };
  if (ctx.rule.post_id && ctx.rule.post_id !== ctx.message.raw_payload?.post_id) return { reason: "post_not_matched" };
  if (!ctx.rule.post_id) {
    const { data: specific, error } = await db.from("facebook_auto_reply_rules").select("id")
      .eq("business_id", job.business_id).eq("social_account_id", job.social_account_id).eq("enabled", true)
      .eq("post_id", ctx.message.raw_payload?.post_id).maybeSingle();
    if (error) throw new Error("rule_precedence_read_failed");
    if (specific && specific.id !== ctx.rule.id) return { reason: "specific_post_rule_takes_priority" };
  }
  if (ctx.message.comment_is_deleted) return { reason: "comment_deleted" };
  if (job.recipient_id === ctx.page.platform_account_id) return { reason: "page_own_comment" };
  const template = job.action === "public" ? ctx.rule.public_template : ctx.rule.private_template;
  if (!template) return { reason: "action_disabled" };
  let token = resolveStoredFacebookPageAccessToken(ctx.page);
  const commentPath = `${encodeURIComponent(job.comment_id)}?fields=id,from{id},object{id},created_time,can_reply_privately`;
  let fresh = await autoReplyGraph(commentPath, token);
  if (isFacebookAccessTokenError(fresh.result.error)) {
    token = await refreshFacebookPageAccessToken(ctx.page.platform_account_id, ctx.page.id);
    fresh = await autoReplyGraph(commentPath, token);
  }
  if (!fresh.response.ok || fresh.result.error) throw new Error("fresh_comment_read_failed");
  const postId = ctx.message.raw_payload?.post_id;
  if (!fresh.result.from?.id || fresh.result.from.id !== job.recipient_id ||
    !fresh.result.object?.id || fresh.result.object.id !== postId ||
    (ctx.rule.post_id && ctx.rule.post_id !== fresh.result.object.id)) return { reason: "comment_identity_unverified" };
  if (!dryRun && !autoReplyCutoff(ctx.rule, fresh.result.created_time ?? null)) return { reason: "before_start" };
  const replies = await autoReplyGraph(`${encodeURIComponent(job.comment_id)}/comments?fields=id&limit=100&summary=true`, token);
  if (!replies.response.ok || replies.result.error || !Array.isArray(replies.result.data)) throw new Error("fresh_replies_read_failed");
  const { data: sibling, error } = await db.from("facebook_auto_reply_jobs").select("platform_reply_id,status")
    .eq("social_account_id", job.social_account_id).eq("comment_id", job.comment_id).eq("action", "public").maybeSingle();
  if (error) throw new Error("reply_history_read_failed");
  if (job.action === "private" && sibling?.status === "needs_review") return { reason: "public_outcome_unknown" };
  const allowedId = job.action === "private" && sibling?.status === "sent" ? sibling.platform_reply_id : null;
  if (replies.result.paging?.next || (replies.result.summary?.total_count ?? 0) > replies.result.data.length ||
    replies.result.data.some(reply => !reply.id || reply.id !== allowedId)) return { reason: "already_replied" };
  const policy = await getFacebookMessengerReplyPolicy(ctx.conversation.id);
  // Any private outgoing after this comment counts as an existing response unless the customer replied later.
  const outgoingAt = Date.parse(policy.latestDirectOutgoingAt ?? "");
  const incomingAt = Date.parse(policy.latestDirectIncomingAt ?? "");
  if (outgoingAt >= Date.parse(fresh.result.created_time ?? "") &&
    !(incomingAt > outgoingAt)) return { reason: "already_replied_privately" };
  if (job.action === "private") {
    const age = Date.now() - Date.parse(fresh.result.created_time ?? "");
    if (fresh.result.can_reply_privately !== true || age < 0 || age >= 7 * 86400000 ||
      policy.waitingForCustomerReply) return { reason: "private_reply_ineligible_or_waiting" };
  }
  return { ctx, token, template, reason: null };
}

async function saveSent(job: AutoReplyJob, replyId: string, template: string) {
  const ctx = await context(job);
  if (!ctx) return;
  const now = new Date().toISOString();
  const { error } = await db.from("messages").insert({
    business_id: job.business_id, conversation_id: ctx.conversation.id,
    platform_message_id: replyId, sender_platform_id: ctx.page.platform_account_id,
    recipient_platform_id: job.action === "public" ? job.comment_id : job.recipient_id,
    direction: "outgoing", message_type: "text", message_text: template, is_echo: true,
    platform_created_at: now, raw_payload: job.action === "public"
      ? { source: "facebook_comment_reply", parent_comment_id: job.comment_id, auto_reply_job_id: job.id }
      : { source: "facebook_auto_private_reply", message_id: replyId, auto_reply_job_id: job.id },
  });
  if (error && error.code !== "23505") {
    // The sent ledger is already durable: this warning never causes a resend.
    console.warn("Auto reply sent; local message save failed", { jobId: job.id, code: error.code });
  }
  await db.from("conversations").update({ last_message_text: template, last_message_at: now, updated_at: now })
    .eq("id", ctx.conversation.id).eq("business_id", job.business_id);
}

export async function processAutoReplyJob(job: AutoReplyJob) {
  let crossedSendBoundary = false;
  let knownReplyId: string | null = null;
  let token = ""; let template = ""; let pageId = ""; let startedAt = Date.now();
  try {
    const check = await inspectAutoReply(job);
    if (!check.ctx || !check.token || !check.template) {
      await finish(job, "skipped", check.reason ?? "unavailable"); return;
    }
    token = check.token; template = check.template; pageId = check.ctx.page.platform_account_id;
    // The DB rechecks pause/generation and reserves the customer atomically immediately before POST.
    const { data: permitted, error } = await db.rpc("facebook_auto_reply_begin_send", { p_job: job.id, p_claim: job.claim_token });
    if (error) throw new Error("send_boundary_not_confirmed");
    if (!permitted) return;
    crossedSendBoundary = true; startedAt = Date.now();
    const attempt = await autoReplyGraph(job.action === "public" ? `${encodeURIComponent(job.comment_id)}/comments` : "me/messages",
      token, job.action === "public" ? { message: template } : { recipient: { comment_id: job.comment_id }, message: { text: template } });
    const replyId = job.action === "public" ? attempt.result.id : attempt.result.message_id;
    if (attempt.response.ok && !attempt.result.error && replyId) {
      knownReplyId = replyId;
      await finish(job, "sent", "confirmed", replyId);
      try { await saveSent(job, replyId, template); }
      catch { console.warn("Auto reply sent; inbox copy needs recovery", { jobId: job.id }); }
      return;
    }
    const status = autoReplyFailure(attempt.response.status, attempt.result.error);
    if (status === "needs_review" || (attempt.response.ok && !replyId)) throw new Error("send_outcome_unknown");
    await finish(job, status === "retry" && job.attempts >= 4 ? "failed" : status,
      status === "retry" && job.attempts >= 4 ? "retry_limit_reached" : `meta_rejected_${attempt.result.error?.code ?? attempt.response.status}`);
  } catch {
    if (crossedSendBoundary) {
      const confirmed = knownReplyId ?? (job.action === "public" && token && template
        ? await confirmCommentReply({ commentId: job.comment_id, pageId, message: template, startedAt,
          pageAccessToken: token, graphVersion: version() }) : null);
      await finish(job, confirmed ? "sent" : "needs_review", confirmed ? "reconciled" : "send_outcome_unknown", confirmed ?? undefined);
      if (confirmed) await saveSent(job, confirmed, template);
    } else {
      await finish(job, job.attempts >= 4 ? "failed" : "retry", job.attempts >= 4 ? "retry_limit_reached" : "preflight_read_failed");
    }
  }
}

export async function runAutoReplyBatch() {
  // Incoming comments are already durable. Enqueue recovery is outside core inbox INSERT/reads.
  const repair = await db.rpc("facebook_auto_reply_repair", { p_limit: 100 });
  if (repair.error) throw new Error("auto_reply_repair_failed");
  const { data, error } = await db.rpc("facebook_auto_reply_claim", { p_limit: 5 });
  if (error) throw new Error("auto_reply_claim_failed");
  const jobs = (data ?? []) as AutoReplyJob[];
  // Bounded concurrency; every outbound call has an eight-second timeout.
  const results = await Promise.allSettled(jobs.map(processAutoReplyJob));
  // Recover a crash after POST with one bounded read-back attempt. Never POST again.
  const { data: reviews, error: reviewError } = await db.from("facebook_auto_reply_jobs").select("*")
    .eq("status", "needs_review").eq("action", "public").is("reconciliation_attempted_at", null)
    .order("created_at", { ascending: true }).limit(2);
  if (!reviewError) for (const job of (reviews ?? []) as AutoReplyJob[]) {
    try { await reconcileAutoReplyJob(job); }
    catch { console.warn("Auto reply reconciliation unavailable", { jobId: job.id }); }
  }
  return { repaired: repair.data, claimed: jobs.length, errors: results.filter(result => result.status === "rejected").length };
}

export async function reconcileAutoReplyJob(job: AutoReplyJob) {
  if (job.action !== "public" || !job.send_started_at || !job.send_template) return false;
  const { data: claimed, error } = await db.from("facebook_auto_reply_jobs")
    .update({ reconciliation_attempted_at: new Date().toISOString() }).eq("id", job.id)
    .eq("status", "needs_review").is("reconciliation_attempted_at", null).select("id").maybeSingle();
  if (error || !claimed) return false;
  const ctx = await context(job);
  if (!ctx) return false;
  const token = resolveStoredFacebookPageAccessToken(ctx.page);
  const confirmed = await confirmCommentReply({ commentId: job.comment_id, pageId: ctx.page.platform_account_id,
    message: job.send_template, startedAt: Date.parse(job.send_started_at), pageAccessToken: token, graphVersion: version() });
  if (!confirmed) return false;
  await finish(job, "sent", "reconciled_after_worker_recovery", confirmed);
  await saveSent(job, confirmed, job.send_template);
  return true;
}
