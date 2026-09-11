import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createConversationActivity } from "@/lib/inbox/create-conversation-activity";
import { detectCustomerPhone } from "@/lib/inbox/detect-customer-phone";

export async function saveDetectedCustomerPhone({ businessId, contactId, conversationId, messageId, text, incoming }: {
  businessId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  text: string | null | undefined;
  incoming: boolean;
}): Promise<void> {
  if (!incoming) return;
  const phone = detectCustomerPhone(text);
  if (!phone) return;
  try {
    const { data: contact, error } = await supabaseAdmin.from("contacts")
      .select("id,phone,full_name").eq("business_id", businessId).eq("id", contactId).maybeSingle();
    if (error || !contact || contact.phone?.trim()) return;

    let query = supabaseAdmin.from("contacts").update({ phone, updated_at: new Date().toISOString() })
      .eq("business_id", businessId).eq("id", contactId);
    // Compare-and-set prevents a concurrent message or agent edit being overwritten.
    query = contact.phone == null ? query.is("phone", null) : query.eq("phone", contact.phone);
    const { data: updated, error: updateError } = await query.select("id").maybeSingle();
    if (updateError || !updated) return;

    // Existing Inbox activity subscriptions refresh customer details on every browser.
    await createConversationActivity({
      businessId, conversationId, contactId, activityType: "customer_updated",
      title: "Customer phone detected", description: "Phone saved automatically from an incoming customer message.",
      customerName: contact.full_name, actorName: "System",
      metadata: { source: "incoming_message", messageId,
        changedFields: [{ field: "phone", label: "phone number", oldValue: contact.phone, newValue: phone }] },
    });
  } catch {
    // Optional enrichment must not cause a saved message to fail or be redelivered.
    console.warn("[TENH Inbox] Automatic phone enrichment could not complete.");
  }
}
