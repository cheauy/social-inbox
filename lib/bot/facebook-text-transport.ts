import "server-only";
import { supabaseAdmin as db } from "@/lib/supabase/admin";
import { autoReplyGraph } from "@/lib/facebook/auto-reply";
import { getFacebookMessengerReplyPolicy } from "@/lib/facebook/messenger-reply-policy";
import { readFacebookBlock, isBlockPending } from "@/lib/facebook/customer-block";
import { resolveStoredFacebookPageAccessToken } from "@/lib/facebook/get-facebook-page-access-token";
import { businessSubscriptionIsOperational } from "@/lib/subscription/is-operational-subscription";
import type { ExecutionJob } from "./execution-safety";

/** Prepared standard-window text adapter. Not attached to a route, webhook or cron. */
export const facebookBotTextTransport = {
  supported: (job: ExecutionJob) => ["reply", "followup"].includes(job.kind),
  async execute(job: ExecutionJob) {
    const reject = () => ({ confirmed: false, definitiveRejection: true });
    if (process.env.TENH_BOT_EXECUTION_ENABLED !== "true" || !facebookBotTextTransport.supported(job) ||
        !job.text?.trim() || job.text.length > 2000 || !/^\d{1,30}$/.test(job.recipientId)) return reject();
    if (!await businessSubscriptionIsOperational(job.businessId)) return reject();
    const conversation = await db.from("conversations").select("id,contact_id,social_account_id,source_type")
      .eq("id", job.conversationId).eq("business_id", job.businessId).eq("social_account_id", job.channelId).maybeSingle();
    if (conversation.error || !conversation.data || conversation.data.source_type === "comment") return reject();
    const [contact, page] = await Promise.all([
      db.from("contacts").select("id,platform_user_id").eq("id", conversation.data.contact_id).eq("business_id", job.businessId).maybeSingle(),
      db.from("social_accounts").select("id,platform_account_id,is_active,facebook_token_status,facebook_page_access_token_encrypted")
        .eq("id", job.channelId).eq("business_id", job.businessId).eq("platform", "facebook").eq("is_active", true).maybeSingle(),
    ]);
    if (contact.error || page.error || contact.data?.platform_user_id !== job.recipientId || !page.data || page.data.platform_account_id === job.recipientId) return reject();
    const blocked = await readFacebookBlock({ businessId: job.businessId, socialAccountId: job.channelId, contactId: contact.data.id });
    if (!blocked.available || blocked.state?.is_blocked || isBlockPending(blocked.state)) return reject();
    const policy = await getFacebookMessengerReplyPolicy(job.conversationId);
    if (policy.windowState !== "standard" || !policy.hasRecentDirectCustomerMessage) return reject();
    const token = resolveStoredFacebookPageAccessToken(page.data);
    // No HUMAN_AGENT extension, private comment reply, token-refresh resend or retry.
    const result = await autoReplyGraph(`${encodeURIComponent(page.data.platform_account_id)}/messages`, token,
      { recipient: { id: job.recipientId }, messaging_type: "RESPONSE", message: { text: job.text } });
    if (result.response.ok && result.result.message_id && !result.result.error) return { confirmed: true, providerId: result.result.message_id };
    const status = result.response.status;
    return { confirmed: false, definitiveRejection: status >= 400 && status < 500 && ![408, 429].includes(status) && !result.result.error?.is_transient };
  },
};
