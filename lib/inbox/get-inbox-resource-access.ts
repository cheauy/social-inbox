import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type InboxAuthorizedMember = {
  id: string;
  user_id: string;
  business_id: string;
  full_name: string;
  email: string;
  role: string;
  profile_picture_url: string | null;
  is_active: boolean;
};

type SubscriptionStateRow = {
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  created_at: string | null;
};

type ConversationAccessRow = {
  id: string;
  business_id: string;
  contact_id: string | null;
  social_account_id: string | null;
};

type ContactAccessRow = {
  id: string;
  business_id: string;
};

export type InboxAccessFailure = {
  success: false;
  status: 401 | 403 | 404 | 409 | 500;
  error: string;
};

export type InboxBusinessAccessSuccess = {
  success: true;
  user: User;
  member: InboxAuthorizedMember;
  businessId: string;
};

export type InboxConversationAccessSuccess = InboxBusinessAccessSuccess & {
  conversation: ConversationAccessRow;
};

export type InboxContactAccessSuccess = InboxBusinessAccessSuccess & {
  contact: ContactAccessRow;
};

const OPERATIONAL_STATUSES = new Set(["active", "trialing"]);

function isPeriodEnded(value: string | null | undefined) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function isOperationalSubscription(subscription: SubscriptionStateRow | null) {
  // Preserve legacy/unmanaged workspaces until they are migrated.
  if (!subscription) return true;

  if (!OPERATIONAL_STATUSES.has(subscription.status)) return false;

  const end =
    subscription.status === "trialing"
      ? subscription.trial_ends_at ?? subscription.current_period_end
      : subscription.current_period_end;

  return !isPeriodEnded(end);
}

async function getAuthenticatedUser(): Promise<
  | { success: true; user: User }
  | InboxAccessFailure
> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      success: false,
      status: 401,
      error: "Unauthorized.",
    };
  }

  return { success: true, user };
}

export async function authorizeInboxBusinessAccess(
  businessId: string,
): Promise<InboxBusinessAccessSuccess | InboxAccessFailure> {
  const normalizedBusinessId = businessId.trim();

  if (!normalizedBusinessId) {
    return {
      success: false,
      status: 404,
      error: "TENH workspace was not found.",
    };
  }

  const auth = await getAuthenticatedUser();
  if (!auth.success) return auth;

  const { data: member, error: memberError } = await supabaseAdmin
    .from("team_members")
    .select(
      "id,user_id,business_id,full_name,email,role,profile_picture_url,is_active",
    )
    .eq("user_id", auth.user.id)
    .eq("business_id", normalizedBusinessId)
    .eq("is_active", true)
    .maybeSingle();

  if (memberError) {
    return {
      success: false,
      status: 500,
      error: "Unable to verify workspace access.",
    };
  }

  if (!member) {
    return {
      success: false,
      status: 403,
      error: "You no longer have access to this subscription.",
    };
  }

  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from("business_subscriptions")
    .select("status,current_period_end,trial_ends_at,created_at")
    .eq("business_id", normalizedBusinessId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subscriptionError) {
    return {
      success: false,
      status: 500,
      error: "Unable to verify subscription status.",
    };
  }

  if (
    !isOperationalSubscription(
      (subscription as SubscriptionStateRow | null) ?? null,
    )
  ) {
    return {
      success: false,
      status: 409,
      error:
        "This subscription has expired. Switch to an active workspace or buy a new subscription.",
    };
  }

  return {
    success: true,
    user: auth.user,
    member: member as InboxAuthorizedMember,
    businessId: normalizedBusinessId,
  };
}

export async function getInboxConversationAccess(
  conversationId: string,
): Promise<InboxConversationAccessSuccess | InboxAccessFailure> {
  const normalizedConversationId = conversationId.trim();

  if (!normalizedConversationId) {
    return {
      success: false,
      status: 404,
      error: "Conversation was not found.",
    };
  }

  const { data: conversation, error } = await supabaseAdmin
    .from("conversations")
    .select("id,business_id,contact_id,social_account_id")
    .eq("id", normalizedConversationId)
    .maybeSingle();

  if (error) {
    return {
      success: false,
      status: 500,
      error: "Unable to verify the conversation.",
    };
  }

  if (!conversation) {
    return {
      success: false,
      status: 404,
      error: "Conversation was not found.",
    };
  }

  const access = await authorizeInboxBusinessAccess(conversation.business_id);
  if (!access.success) return access;

  return {
    ...access,
    conversation: conversation as ConversationAccessRow,
  };
}

export async function getInboxContactAccess(
  contactId: string,
): Promise<InboxContactAccessSuccess | InboxAccessFailure> {
  const normalizedContactId = contactId.trim();

  if (!normalizedContactId) {
    return {
      success: false,
      status: 404,
      error: "Customer was not found.",
    };
  }

  const { data: contact, error } = await supabaseAdmin
    .from("contacts")
    .select("id,business_id")
    .eq("id", normalizedContactId)
    .maybeSingle();

  if (error) {
    return {
      success: false,
      status: 500,
      error: "Unable to verify the customer.",
    };
  }

  if (!contact) {
    return {
      success: false,
      status: 404,
      error: "Customer was not found.",
    };
  }

  const access = await authorizeInboxBusinessAccess(contact.business_id);
  if (!access.success) return access;

  return {
    ...access,
    contact: contact as ContactAccessRow,
  };
}
