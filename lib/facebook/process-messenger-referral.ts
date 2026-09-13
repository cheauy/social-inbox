import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readFacebookBlock } from "@/lib/facebook/customer-block";
import { messengerSourceFromEvent, mergeMessengerSources, readMessengerSources } from "@/lib/facebook/messenger-source";
import type { FacebookMessagingEvent } from "@/types/facebook";

/** A referral is context, not a new message or an extension of the reply window. */
export async function processFacebookMessengerReferral(event: FacebookMessagingEvent, entryPageId?: string) {
  const source = messengerSourceFromEvent(event);
  if (!source) return;
  const pageId = event.recipient?.id;
  const customerId = event.sender?.id;
  if (!entryPageId || pageId !== entryPageId || !customerId || !/^\d+$/.test(customerId)
    || !/^\d+$/.test(pageId) || pageId === customerId || event.message?.is_echo) return;

  const { data: account, error: accountError } = await supabaseAdmin.from("social_accounts")
    .select("id,business_id").eq("platform", "facebook").eq("platform_account_id", pageId)
    .eq("is_active", true).maybeSingle();
  if (accountError) throw new Error(accountError.message);
  if (!account) return;

  // ignoreDuplicates keeps existing profile fields intact, including during races.
  const { error: contactWriteError } = await supabaseAdmin.from("contacts").upsert({
    business_id: account.business_id, platform: "facebook", platform_user_id: customerId,
  }, { onConflict: "business_id,platform,platform_user_id", ignoreDuplicates: true });
  if (contactWriteError) throw new Error(contactWriteError.message);
  const { data: contact, error: contactError } = await supabaseAdmin.from("contacts").select("id")
    .eq("business_id", account.business_id).eq("platform", "facebook").eq("platform_user_id", customerId).single();
  if (contactError || !contact) throw new Error(contactError?.message ?? "Unable to resolve referral contact.");
  const block = await readFacebookBlock({ businessId: account.business_id, socialAccountId: account.id, contactId: contact.id });
  if (block.state?.is_blocked) return;

  const { error: conversationWriteError } = await supabaseAdmin.from("conversations").upsert({
    business_id: account.business_id, social_account_id: account.id, contact_id: contact.id,
    platform: "facebook", source_type: "messenger", status: "open", unread_count: 0,
  }, { onConflict: "social_account_id,contact_id", ignoreDuplicates: true });
  if (conversationWriteError) throw new Error(conversationWriteError.message);

  // Compare-and-swap retains simultaneous referrals and makes Meta retries idempotent.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data: conversation, error } = await supabaseAdmin.from("conversations")
      .select("id,facebook_messenger_sources").eq("business_id", account.business_id)
      .eq("social_account_id", account.id).eq("contact_id", contact.id).single();
    if (error || !conversation) throw new Error(error?.message ?? "Unable to resolve referral conversation.");
    const previous = conversation.facebook_messenger_sources;
    const sources = mergeMessengerSources(previous, [source]);
    // jsonb may return object keys in a different order; compare canonical values.
    if (JSON.stringify(readMessengerSources(previous)) === JSON.stringify(readMessengerSources(sources))) return;
    let update = supabaseAdmin.from("conversations").update({ facebook_messenger_sources: sources })
      .eq("id", conversation.id).eq("business_id", account.business_id).eq("social_account_id", account.id);
    update = previous == null ? update.is("facebook_messenger_sources", null)
      : update.eq("facebook_messenger_sources", JSON.stringify(previous));
    const { data: updated, error: updateError } = await update.select("id").maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (updated) return;
  }
  throw new Error("Messenger referral changed concurrently; source remains in the webhook event log.");
}
