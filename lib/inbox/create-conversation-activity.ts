import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import type {
  ConversationActivity,
  ConversationActivityType,
} from "@/types/inbox";

type CreateConversationActivityInput = {
  businessId: string;
  conversationId: string;

  contactId?: string | null;
  actorMemberId?: string | null;

  activityType:
    ConversationActivityType;

  title: string;
  description?: string | null;

  customerName?: string | null;
  actorName?: string | null;

  actorProfilePictureUrl?:
    string | null;

  metadata?: Record<string, unknown>;
};

export async function createConversationActivity({
  businessId,
  conversationId,
  contactId = null,
  actorMemberId = null,
  activityType,
  title,
  description = null,
  customerName = null,
  actorName = null,
  actorProfilePictureUrl = null,
  metadata = {},
}: CreateConversationActivityInput): Promise<
  ConversationActivity
> {
  const { data, error } = await supabaseAdmin
    .from("conversation_activity")
    .insert({
      business_id: businessId,
      conversation_id: conversationId,
      contact_id: contactId,
      actor_member_id: actorMemberId,
      activity_type: activityType,
      title,
      description,
      customer_name: customerName,
      actor_name: actorName,
      actor_profile_picture_url:
        actorProfilePictureUrl,
      metadata,
    })
    .select(`
      id,
      business_id,
      conversation_id,
      contact_id,
      actor_member_id,
      activity_type,
      title,
      description,
      customer_name,
      actor_name,
      actor_profile_picture_url,
      metadata,
      created_at
    `)
    .single();

  if (error) {
    console.error(
      "Unable to create conversation activity:",
      error,
    );

    throw new Error(
      "Unable to record conversation activity.",
    );
  }

  return data as ConversationActivity;
}