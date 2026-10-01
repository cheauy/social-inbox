import { TENH_BOT_AVAILABLE } from "./availability";
import "server-only";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { autoReplyGraph } from "@/lib/facebook/auto-reply";
import { resolveStoredFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { businessSubscriptionIsOperational } from "@/lib/subscription/is-operational-subscription";
import type { ExecutionJob } from "./execution-safety";

/** Optional hide-only adapter. No delete, no permission escalation, no retry. */
export const facebookBotCommentHideTransport = {
  supported: (job: ExecutionJob) => job.kind === "hide_comment" && process.env.TENH_BOT_COMMENT_HIDE_ENABLED === "true",
  async execute(job: ExecutionJob) {
    const reject = () => ({ confirmed: false, definitiveRejection: true });
    if (!TENH_BOT_AVAILABLE || process.env.TENH_BOT_EXECUTION_ENABLED !== "true" || !facebookBotCommentHideTransport.supported(job) ||
        !job.messageId || !await businessSubscriptionIsOperational(job.businessId)) return reject();
    const [message, conversation, page] = await Promise.all([
      db.from("messages").select("platform_message_id,sender_platform_id,raw_payload,comment_is_deleted")
        .eq("id", job.messageId).eq("conversation_id", job.conversationId).eq("business_id", job.businessId).eq("direction", "incoming").maybeSingle(),
      db.from("conversations").select("source_type,social_account_id").eq("id", job.conversationId).eq("business_id", job.businessId).maybeSingle(),
      db.from("social_accounts").select("platform_account_id,is_active,facebook_token_status,facebook_page_access_token_encrypted")
        .eq("id", job.channelId).eq("business_id", job.businessId).eq("platform", "facebook").eq("is_active", true).maybeSingle(),
    ]);
    if (message.error || conversation.error || page.error || !message.data || !page.data || message.data.comment_is_deleted ||
        conversation.data?.source_type !== "comment" || conversation.data.social_account_id !== job.channelId ||
        message.data.sender_platform_id !== job.recipientId) return reject();
    const commentId = message.data.platform_message_id;
    const raw = message.data.raw_payload as { post_id?: string; comment_id?: string; item?: string; verb?: string } | null;
    if (!raw || !commentId || !/^\d{1,30}(?:_\d{1,30})?$/.test(commentId) || raw.comment_id !== commentId || raw.item !== "comment" || raw.verb !== "add" ||
        !/^\d{1,30}$/.test(page.data.platform_account_id) || !new RegExp(`^${page.data.platform_account_id}_\\d{1,30}$`).test(raw.post_id ?? "")) return reject();
    const token = resolveStoredFacebookPageAccessToken(page.data);
    const path = encodeURIComponent(commentId);
    const fresh = await autoReplyGraph(`${path}?fields=id,from{id},object{id},is_hidden`, token);
    const current = fresh.result as typeof fresh.result & { is_hidden?: boolean };
    if (!fresh.response.ok || current.error || current.id !== commentId || current.from?.id !== job.recipientId || current.object?.id !== raw.post_id) return reject();
    if (current.is_hidden === true) return { confirmed: true, providerId: commentId };
    const response = await fetch(`https://graph.facebook.com/${process.env.FACEBOOK_GRAPH_API_VERSION?.trim() || "v26.0"}/${path}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ is_hidden: "true" }), cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    const result = await response.json() as { success?: boolean; error?: { is_transient?: boolean } };
    if (!response.ok || result.error || result.success !== true) return { confirmed: false,
      definitiveRejection: response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status) && !result.error?.is_transient };
    const verify = await autoReplyGraph(`${path}?fields=is_hidden`, token);
    return { confirmed: verify.response.ok && (verify.result as { is_hidden?: boolean }).is_hidden === true, providerId: commentId };
  },
};
