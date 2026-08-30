import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  memberHasPermission,
  permissionDenied,
} from "@/lib/auth/require-permission";
import {
  discoverFacebookAvatar,
} from "@/lib/facebook/discover-facebook-avatar";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MessageRow = {
  platform_message_id: string | null;
  direction: string | null;
  raw_payload: unknown;
  created_at: string;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function looksLikeCommentPayload(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }

  return (
    cleanString(value.item) === "comment" ||
    Boolean(cleanString(value.comment_id))
  );
}

export async function GET(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: authResult.error,
      },
      {
        status: authResult.status,
      },
    );
  }

  const currentMember = authResult.member;

  if (
    !(await memberHasPermission(currentMember, "channels", "view"))
  ) {
    return permissionDenied(
      "You do not have permission to view channels in this workspace.",
    );
  }
  const contactId = request.nextUrl.searchParams.get("contactId")?.trim() ?? "";
  const conversationIdInput =
    request.nextUrl.searchParams.get("conversationId")?.trim() ?? "";

  let resolvedContactId = contactId || null;

  if (!resolvedContactId && conversationIdInput) {
    const { data: conversation, error } = await supabaseAdmin
      .from("conversations")
      .select("contact_id")
      .eq("id", conversationIdInput)
      .eq("business_id", currentMember.business_id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to resolve the conversation customer.",
          details: error.message,
        },
        { status: 500 },
      );
    }

    resolvedContactId = conversation?.contact_id ?? null;
  }

  if (!resolvedContactId) {
    return NextResponse.json(
      {
        success: false,
        error: "contactId or conversationId is required.",
        example:
          "/api/facebook/avatar-discovery?contactId=YOUR_CONTACT_ID",
      },
      { status: 400 },
    );
  }

  const { data: contact, error: contactError } = await supabaseAdmin
    .from("contacts")
    .select(`
      id,
      business_id,
      platform,
      platform_user_id,
      full_name,
      profile_picture_url
    `)
    .eq("id", resolvedContactId)
    .eq("business_id", currentMember.business_id)
    .maybeSingle();

  if (contactError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load the customer.",
        details: contactError.message,
      },
      { status: 500 },
    );
  }

  if (!contact) {
    return NextResponse.json(
      {
        success: false,
        error: "Customer not found.",
      },
      { status: 404 },
    );
  }

  if (contact.platform !== "facebook" || !contact.platform_user_id) {
    return NextResponse.json(
      {
        success: false,
        error: "This diagnostic only supports Facebook customers.",
      },
      { status: 400 },
    );
  }

  const { data: conversations, error: conversationsError } = await supabaseAdmin
    .from("conversations")
    .select(`
      id,
      social_account_id,
      source_type,
      facebook_comment_id,
      updated_at
    `)
    .eq("business_id", currentMember.business_id)
    .eq("contact_id", contact.id)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (conversationsError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load Facebook conversations.",
        details: conversationsError.message,
      },
      { status: 500 },
    );
  }

  const conversationIds = (conversations ?? []).map((item) => item.id);
  const socialAccountId =
    (conversations ?? []).find((item) => Boolean(item.social_account_id))
      ?.social_account_id ?? null;

  if (!socialAccountId) {
    return NextResponse.json(
      {
        success: false,
        error: "The customer has no connected Facebook Page conversation.",
      },
      { status: 400 },
    );
  }

  const { data: socialAccount, error: socialAccountError } = await supabaseAdmin
    .from("social_accounts")
    .select("platform,platform_account_id,is_active")
    .eq("id", socialAccountId)
    .eq("business_id", currentMember.business_id)
    .maybeSingle();

  if (socialAccountError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load the connected Facebook Page.",
        details: socialAccountError.message,
      },
      { status: 500 },
    );
  }

  if (
    !socialAccount ||
    socialAccount.platform !== "facebook" ||
    !socialAccount.is_active ||
    !socialAccount.platform_account_id
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "The Facebook Page connection is not active.",
      },
      { status: 400 },
    );
  }

  let messageRows: MessageRow[] = [];

  if (conversationIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("messages")
      .select(`
        platform_message_id,
        direction,
        raw_payload,
        created_at
      `)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Unable to inspect saved Facebook messages.",
          details: error.message,
        },
        { status: 500 },
      );
    }

    messageRows = (data ?? []) as MessageRow[];
  }

  const latestIncomingMessageId =
    messageRows.find(
      (row) => row.direction === "incoming" && row.platform_message_id,
    )?.platform_message_id ?? null;

  const latestCommentId =
    messageRows.find(
      (row) =>
        Boolean(row.platform_message_id) && looksLikeCommentPayload(row.raw_payload),
    )?.platform_message_id ??
    (conversations ?? []).find((item) => Boolean(item.facebook_comment_id))
      ?.facebook_comment_id ??
    null;

  const result = await discoverFacebookAvatar({
    pageId: socialAccount.platform_account_id,
    customerId: contact.platform_user_id,
    latestMessageId: latestIncomingMessageId,
    latestCommentId,
  });

  let saved = false;
  let saveError: string | null = null;

  if (
    result.avatarUrl &&
    result.avatarUrl !== contact.profile_picture_url
  ) {
    const { error } = await supabaseAdmin
      .from("contacts")
      .update({
        profile_picture_url: result.avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contact.id)
      .eq("business_id", currentMember.business_id);

    if (error) {
      saveError = error.message;
    } else {
      saved = true;
    }
  }

  console.log(
    result.avatarUrl
      ? "[Tenh Facebook Avatar Discovery] ✅ REAL AVATAR FOUND"
      : "[Tenh Facebook Avatar Discovery] ⚠️ NO AVATAR FIELD EXPOSED",
    {
      contactId: contact.id,
      customerId: contact.platform_user_id,
      pageId: socialAccount.platform_account_id,
      source: result.source,
      saved,
      saveError,
      attempts: result.attempts.map((attempt) => ({
        label: attempt.label,
        ok: attempt.ok,
        status: attempt.status,
        matchedCustomer: attempt.matchedCustomer,
        matchedCustomerKeys: attempt.matchedCustomerKeys,
        discoveredAvatarUrl: Boolean(attempt.discoveredAvatarUrl),
        error: attempt.error,
      })),
    },
  );

  return NextResponse.json({
    success: true,
    contact: {
      id: contact.id,
      name: contact.full_name,
      platformUserId: contact.platform_user_id,
      previousProfilePictureUrl: contact.profile_picture_url,
    },
    pageId: socialAccount.platform_account_id,
    latestIncomingMessageId,
    latestCommentId,
    avatarFound: Boolean(result.avatarUrl),
    avatarUrl: result.avatarUrl,
    source: result.source,
    saved,
    saveError,
    conversationId: result.conversationId,
    attempts: result.attempts,
    notes: result.notes,
    nextStep: result.avatarUrl
      ? "Reload TENH Inbox. The real avatar was saved to contacts.profile_picture_url."
      : "Send this JSON response back. V3.1.14 shows exactly which customer fields Meta exposed on every Page-accessible surface tested.",
  });
}
