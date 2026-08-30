import {
  getFacebookPageAccessToken,
} from "@/lib/facebook/get-facebook-page-access-token";
import { authorizeInboxBusinessAccess, type InboxAuthorizedMember } from "@/lib/inbox/get-inbox-resource-access";
import { supabaseAdmin } from "@/lib/supabase/admin";

export class FacebookCommentContextError extends Error {
  status: number;

  constructor(
    message: string,
    status = 400,
  ) {
    super(message);
    this.name =
      "FacebookCommentContextError";
    this.status = status;
  }
}

type CommentMessageRow = {
  id: string;
  business_id: string;
  conversation_id: string | null;
  platform_message_id: string | null;
};

type CommentConversationRow = {
  id: string;
  business_id: string;
  social_account_id: string | null;
};

type FacebookSocialAccountRow = {
  id: string;
  business_id: string;
  platform: string;
  platform_account_id: string | null;
  is_active: boolean | null;
};

export type LocalFacebookCommentContext = {
  message: CommentMessageRow;
  conversation: CommentConversationRow;
};

export type FacebookCommentActionContext =
  LocalFacebookCommentContext & {
    socialAccount: FacebookSocialAccountRow;
    pageId: string;
    pageAccessToken: string;
  };

export async function loadLocalFacebookCommentContext({
  businessId,
  commentId,
  conversationId,
}: {
  businessId: string;
  commentId: string;
  conversationId?: string | null;
}): Promise<LocalFacebookCommentContext> {
  let messageQuery = supabaseAdmin
    .from("messages")
    .select(`
      id,
      business_id,
      conversation_id,
      platform_message_id
    `)
    .eq(
      "business_id",
      businessId,
    )
    .eq(
      "platform_message_id",
      commentId,
    );

  if (conversationId) {
    messageQuery = messageQuery.eq(
      "conversation_id",
      conversationId,
    );
  }

  const {
    data: messageData,
    error: messageError,
  } = await messageQuery.maybeSingle();

  if (messageError) {
    throw new FacebookCommentContextError(
      "Unable to verify the Facebook comment.",
      500,
    );
  }

  const message =
    messageData as
      | CommentMessageRow
      | null;

  if (!message) {
    throw new FacebookCommentContextError(
      "Facebook comment was not found in this TENH workspace.",
      404,
    );
  }

  if (!message.conversation_id) {
    throw new FacebookCommentContextError(
      "Facebook comment conversation routing is missing.",
      400,
    );
  }

  const {
    data: conversationData,
    error: conversationError,
  } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      business_id,
      social_account_id
    `)
    .eq(
      "id",
      message.conversation_id,
    )
    .eq(
      "business_id",
      businessId,
    )
    .maybeSingle();

  if (conversationError) {
    throw new FacebookCommentContextError(
      "Unable to verify the Facebook comment conversation.",
      500,
    );
  }

  const conversation =
    conversationData as
      | CommentConversationRow
      | null;

  if (!conversation) {
    throw new FacebookCommentContextError(
      "Facebook comment conversation was not found in this TENH workspace.",
      404,
    );
  }

  return {
    message,
    conversation,
  };
}

export async function loadFacebookCommentActionContext({
  businessId,
  commentId,
  conversationId,
}: {
  businessId: string;
  commentId: string;
  conversationId?: string | null;
}): Promise<FacebookCommentActionContext> {
  const localContext =
    await loadLocalFacebookCommentContext({
      businessId,
      commentId,
      conversationId,
    });

  const socialAccountId =
    localContext.conversation
      .social_account_id;

  if (!socialAccountId) {
    throw new FacebookCommentContextError(
      "Facebook Page routing information is missing for this conversation.",
      400,
    );
  }

  const {
    data: socialAccountData,
    error: socialAccountError,
  } = await supabaseAdmin
    .from("social_accounts")
    .select(`
      id,
      business_id,
      platform,
      platform_account_id,
      is_active
    `)
    .eq(
      "id",
      socialAccountId,
    )
    .eq(
      "business_id",
      businessId,
    )
    .maybeSingle();

  if (socialAccountError) {
    throw new FacebookCommentContextError(
      "Unable to load the connected Facebook Page.",
      500,
    );
  }

  const socialAccount =
    socialAccountData as
      | FacebookSocialAccountRow
      | null;

  if (
    !socialAccount ||
    socialAccount.platform !==
      "facebook"
  ) {
    throw new FacebookCommentContextError(
      "Connected Facebook Page was not found for this conversation.",
      404,
    );
  }

  const pageId =
    socialAccount.platform_account_id?.trim();

  if (
    !socialAccount.is_active ||
    !pageId
  ) {
    throw new FacebookCommentContextError(
      "The Facebook Page connection for this conversation is not active.",
      400,
    );
  }

  let pageAccessToken: string;

  try {
    pageAccessToken =
      await getFacebookPageAccessToken(
        pageId,
      );
  } catch (error) {
    throw new FacebookCommentContextError(
      error instanceof Error
        ? error.message
        : "Unable to load the Facebook Page access token.",
      500,
    );
  }

  return {
    ...localContext,
    socialAccount,
    pageId,
    pageAccessToken,
  };
}


export type AuthorizedFacebookCommentActionContext =
  FacebookCommentActionContext & {
    member: InboxAuthorizedMember;
  };

export async function loadAuthorizedFacebookCommentActionContext({
  commentId,
  conversationId,
}: {
  commentId: string;
  conversationId?: string | null;
}): Promise<AuthorizedFacebookCommentActionContext> {
  let messageQuery = supabaseAdmin
    .from("messages")
    .select("id,business_id,conversation_id,platform_message_id")
    .eq("platform_message_id", commentId);

  if (conversationId) {
    messageQuery = messageQuery.eq("conversation_id", conversationId);
  }

  const { data: messageData, error: messageError } =
    await messageQuery.maybeSingle();

  if (messageError) {
    throw new FacebookCommentContextError(
      "Unable to verify the Facebook comment.",
      500,
    );
  }

  const message = messageData as CommentMessageRow | null;

  if (!message) {
    throw new FacebookCommentContextError(
      "Facebook comment was not found.",
      404,
    );
  }

  const access = await authorizeInboxBusinessAccess(message.business_id);

  if (!access.success) {
    throw new FacebookCommentContextError(access.error, access.status);
  }

  const context = await loadFacebookCommentActionContext({
    businessId: message.business_id,
    commentId,
    conversationId,
  });

  return {
    ...context,
    member: access.member,
  };
}


export async function loadAuthorizedLocalFacebookCommentContext({
  commentId,
  conversationId,
}: {
  commentId: string;
  conversationId?: string | null;
}): Promise<LocalFacebookCommentContext & { member: InboxAuthorizedMember }> {
  let messageQuery = supabaseAdmin
    .from("messages")
    .select("id,business_id,conversation_id,platform_message_id")
    .eq("platform_message_id", commentId);

  if (conversationId) {
    messageQuery = messageQuery.eq("conversation_id", conversationId);
  }

  const { data: messageData, error: messageError } =
    await messageQuery.maybeSingle();

  if (messageError) {
    throw new FacebookCommentContextError(
      "Unable to verify the Facebook comment.",
      500,
    );
  }

  const message = messageData as CommentMessageRow | null;

  if (!message) {
    throw new FacebookCommentContextError(
      "Facebook comment was not found.",
      404,
    );
  }

  const access = await authorizeInboxBusinessAccess(message.business_id);
  if (!access.success) {
    throw new FacebookCommentContextError(access.error, access.status);
  }

  const context = await loadLocalFacebookCommentContext({
    businessId: message.business_id,
    commentId,
    conversationId,
  });

  return { ...context, member: access.member };
}
