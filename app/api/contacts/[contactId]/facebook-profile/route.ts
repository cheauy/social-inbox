import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  getFacebookCustomerProfile,
} from "@/lib/facebook/get-facebook-customer-profile";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime =
  "nodejs";
export const dynamic =
  "force-dynamic";

type RouteContext = {
  params: Promise<{
    contactId: string;
  }>;
};

type ProfileCandidate = {
  fullName:
    | string
    | null;
  profilePictureUrl:
    | string
    | null;
};

function cleanString(
  value: unknown,
) {
  return typeof value ===
    "string" &&
    value.trim()
    ? value.trim()
    : null;
}

function isRecord(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    Boolean(value) &&
    typeof value ===
      "object" &&
    !Array.isArray(value)
  );
}

function isLikelyAttachmentFilename(
  value:
    | string
    | null,
) {
  if (!value) {
    return false;
  }

  return /\.(?:jpe?g|png|gif|webp|heic|mp4|mov|m4v|webm|mp3|m4a|aac|wav|ogg|opus|pdf|zip|docx?|xlsx?|pptx?)$/i.test(
    value.trim(),
  );
}

function profileFromMatchingParty(
  value: unknown,
  platformUserId: string,
): ProfileCandidate {
  if (!isRecord(value)) {
    return {
      fullName: null,
      profilePictureUrl:
        null,
    };
  }

  if (
    cleanString(value.id) !==
    platformUserId
  ) {
    return {
      fullName: null,
      profilePictureUrl:
        null,
    };
  }

  const joinedName = [
    cleanString(
      value.first_name,
    ),
    cleanString(
      value.last_name,
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const candidateName =
    cleanString(
      value.name,
    ) ??
    cleanString(
      value.full_name,
    ) ??
    (joinedName || null);

  let picture:
    | string
    | null =
    cleanString(
      value.profile_pic,
    ) ??
    cleanString(
      value.profile_picture_url,
    );

  if (
    !picture &&
    isRecord(value.picture) &&
    isRecord(
      value.picture.data,
    )
  ) {
    picture =
      cleanString(
        value.picture.data.url,
      );
  }

  return {
    fullName:
      candidateName &&
      !isLikelyAttachmentFilename(
        candidateName,
      )
        ? candidateName
        : null,
    profilePictureUrl:
      picture,
  };
}

function extractPayloadProfile(
  value: unknown,
  platformUserId: string,
  depth = 0,
): ProfileCandidate {
  if (
    !value ||
    depth > 7
  ) {
    return {
      fullName: null,
      profilePictureUrl:
        null,
    };
  }

  const direct =
    profileFromMatchingParty(
      value,
      platformUserId,
    );

  if (
    direct.fullName ||
    direct
      .profilePictureUrl
  ) {
    return direct;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item of
      value
    ) {
      const found =
        extractPayloadProfile(
          item,
          platformUserId,
          depth + 1,
        );

      if (
        found.fullName ||
        found
          .profilePictureUrl
      ) {
        return found;
      }
    }

    return {
      fullName: null,
      profilePictureUrl:
        null,
    };
  }

  if (!isRecord(value)) {
    return {
      fullName: null,
      profilePictureUrl:
        null,
    };
  }

  for (
    const nested of
    Object.values(value)
  ) {
    if (
      !nested ||
      typeof nested !==
        "object"
    ) {
      continue;
    }

    const found =
      extractPayloadProfile(
        nested,
        platformUserId,
        depth + 1,
      );

    if (
      found.fullName ||
      found
        .profilePictureUrl
    ) {
      return found;
    }
  }

  return {
    fullName: null,
    profilePictureUrl:
      null,
  };
}

function mergeProfile(
  first:
    ProfileCandidate,
  second:
    ProfileCandidate,
) {
  return {
    fullName:
      first.fullName ??
      second.fullName,
    profilePictureUrl:
      first
        .profilePictureUrl ??
      second
        .profilePictureUrl,
  };
}

export async function POST(
  _request: NextRequest,
  context: RouteContext,
) {
  const authResult =
    await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          authResult.error,
      },
      {
        status:
          authResult.status,
      },
    );
  }

  const currentMember =
    authResult.member;

  const {
    contactId,
  } =
    await context.params;

  const normalizedContactId =
    contactId?.trim();

  if (
    !normalizedContactId
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Contact ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: contact,
    error: contactError,
  } =
    await supabaseAdmin
      .from("contacts")
      .select(`
        id,
        business_id,
        platform_user_id,
        full_name,
        profile_picture_url
      `)
      .eq(
        "id",
        normalizedContactId,
      )
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .maybeSingle();

  if (contactError) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load customer.",
        details:
          contactError.message,
      },
      {
        status: 500,
      },
    );
  }

  if (!contact) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Customer was not found.",
      },
      {
        status: 404,
      },
    );
  }

  const platformUserId =
    contact
      .platform_user_id
      ?.trim();

  if (!platformUserId) {
    return NextResponse.json({
      success: true,
      updated: false,
      profile: {
        fullName:
          contact.full_name,
        profilePictureUrl:
          contact
            .profile_picture_url,
      },
      source: null,
      graphErrors: [],
      permissionHint:
        null,
    });
  }

  const {
    data: conversations,
    error:
      conversationError,
  } =
    await supabaseAdmin
      .from(
        "conversations",
      )
      .select(`
        id,
        social_account_id
      `)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .eq(
        "contact_id",
        contact.id,
      )
      .order(
        "updated_at",
        {
          ascending: false,
        },
      )
      .limit(10);

  if (
    conversationError
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to find the customer's Facebook conversation.",
        details:
          conversationError.message,
      },
      {
        status: 500,
      },
    );
  }

  const conversationIds =
    (
      conversations ?? []
    ).map(
      (conversation) =>
        conversation.id,
    );

  let payloadProfile:
    ProfileCandidate = {
    fullName: null,
    profilePictureUrl:
      null,
  };

  let latestIncomingMessageId:
    | string
    | null =
    null;

  if (
    conversationIds.length >
    0
  ) {
    const {
      data: messageRows,
    } =
      await supabaseAdmin
        .from("messages")
        .select(`
          platform_message_id,
          direction,
          raw_payload,
          created_at
        `)
        .in(
          "conversation_id",
          conversationIds,
        )
        .order(
          "created_at",
          {
            ascending: false,
          },
        )
        .limit(40);

    for (
      const row of
      messageRows ?? []
    ) {
      if (
        !latestIncomingMessageId &&
        row.direction ===
          "incoming" &&
        row
          .platform_message_id
      ) {
        latestIncomingMessageId =
          row.platform_message_id;
      }

      if (
        !payloadProfile
          .fullName ||
        !payloadProfile
          .profilePictureUrl
      ) {
        payloadProfile =
          mergeProfile(
            payloadProfile,
            extractPayloadProfile(
              row.raw_payload,
              platformUserId,
            ),
          );
      }
    }
  }

  const socialAccountId =
    (
      conversations ?? []
    ).find(
      (
        conversation,
      ) =>
        Boolean(
          conversation
            .social_account_id,
        ),
    )
      ?.social_account_id ??
    null;

  let pageId =
    process.env
      .FACEBOOK_PAGE_ID ??
    null;

  if (socialAccountId) {
    const {
      data:
        socialAccount,
    } =
      await supabaseAdmin
        .from(
          "social_accounts",
        )
        .select(`
          platform_account_id,
          platform
        `)
        .eq(
          "id",
          socialAccountId,
        )
        .eq(
          "business_id",
          currentMember
            .business_id,
        )
        .maybeSingle();

    if (
      socialAccount
        ?.platform ===
        "facebook" &&
      socialAccount
        .platform_account_id
    ) {
      pageId =
        socialAccount
          .platform_account_id;
    }
  }

  const existingFullName =
    isLikelyAttachmentFilename(
      contact.full_name,
    )
      ? null
      : contact.full_name;

  let graphProfile:
    ProfileCandidate = {
    fullName: null,
    profilePictureUrl:
      null,
  };

  let source:
    | string
    | null =
    payloadProfile
      .fullName ||
    payloadProfile
      .profilePictureUrl
      ? "saved-webhook"
      : null;

  let sources: string[] =
    source
      ? [source]
      : [];

  const graphErrors:
    string[] = [];

  let permissionHint:
    | string
    | null =
    null;

  /*
   * V3.1.13 PERFORMANCE:
   * If TENH already has a usable customer name (from the database or
   * saved webhook payload), do not call Facebook again only to chase
   * a profile photo. V3.1.12 confirmed direct PSID photo access is
   * rejected for this Page/customer. A future accessible webhook
   * payload can still populate profile_picture_url automatically.
   */
  if (
    pageId &&
    !payloadProfile
      .fullName &&
    !existingFullName
  ) {
    const graphResult =
      await getFacebookCustomerProfile(
        {
          pageId,
          customerId:
            platformUserId,
          latestMessageId:
            latestIncomingMessageId,
        },
      );

    graphProfile = {
      fullName:
        graphResult.fullName,
      profilePictureUrl:
        graphResult
          .profilePictureUrl,
    };

    const graphSources =
      graphResult.sources.length > 0
        ? graphResult.sources
        : graphResult.source
          ? [graphResult.source]
          : [];

    sources = Array.from(
      new Set([
        ...sources,
        ...graphSources,
      ]),
    );

    source =
      sources.length > 0
        ? sources.join(" + ")
        : null;

    graphErrors.push(
      ...graphResult.errors,
    );

    permissionHint =
      graphResult
        .permissionHint;
  }

  if (
    !permissionHint &&
    !payloadProfile
      .profilePictureUrl &&
    !contact
      .profile_picture_url
  ) {
    permissionHint =
      "Meta did not expose a customer photo through TENH's Page-accessible payloads. TENH is using the initial-avatar fallback and will save a photo later if Meta includes one in an accessible webhook/message payload.";
  }

  const discovered =
    mergeProfile(
      payloadProfile,
      graphProfile,
    );

  const nextFullName =
    discovered.fullName ??
    existingFullName ??
    null;

  const nextPicture =
    discovered
      .profilePictureUrl ??
    contact
      .profile_picture_url ??
    null;

  const updatePayload:
    Record<
      string,
      unknown
    > = {};

  if (
    isLikelyAttachmentFilename(
      contact.full_name,
    ) &&
    !discovered.fullName
  ) {
    updatePayload.full_name =
      null;
  }

  if (
    discovered.fullName &&
    discovered.fullName !==
      contact.full_name
  ) {
    updatePayload.full_name =
      discovered.fullName;
  }

  if (
    discovered
      .profilePictureUrl &&
    discovered
      .profilePictureUrl !==
      contact
        .profile_picture_url
  ) {
    updatePayload
      .profile_picture_url =
      discovered
        .profilePictureUrl;
  }

  const shouldUpdate =
    Object.keys(
      updatePayload,
    ).length > 0;

  if (shouldUpdate) {
    updatePayload.updated_at =
      new Date().toISOString();

    const {
      error: updateError,
    } =
      await supabaseAdmin
        .from("contacts")
        .update(
          updatePayload,
        )
        .eq(
          "id",
          contact.id,
        )
        .eq(
          "business_id",
          currentMember
            .business_id,
        );

    if (updateError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Facebook profile was found but could not be saved.",
          details:
            updateError.message,
        },
        {
          status: 500,
        },
      );
    }
  }

  if (
    !nextFullName &&
    !nextPicture
  ) {
    console.warn(
      "[Tenh Facebook Profile Sync] No profile data returned.",
      {
        contactId:
          contact.id,
        platformUserId,
        pageId,
        latestIncomingMessageId,
        graphErrors,
        permissionHint,
      },
    );
  } else if (
    nextFullName &&
    nextPicture
  ) {
    console.log(
      "[Tenh Facebook Profile Sync] ✅ PROFILE COMPLETE",
      {
        contactId:
          contact.id,
        source,
        sources,
        hasName: true,
        hasPicture: true,
      },
    );
  } else if (
    nextFullName &&
    !nextPicture
  ) {
    console.log(
      "[Tenh Facebook Profile Sync] ✅ PROFILE READY (initial avatar fallback)",
      {
        contactId:
          contact.id,
        source,
        sources,
        hasName: true,
        hasPicture: false,
        pictureStatus:
          "initial-fallback",
        avatarDiscoveryUrl:
          `/api/facebook/avatar-discovery?contactId=${contact.id}`,
        graphErrors,
        permissionHint,
      },
    );
  } else {
    console.warn(
      "[Tenh Facebook Profile Sync] ⚠️ PROFILE PARTIAL",
      {
        contactId:
          contact.id,
        source,
        sources,
        hasName:
          Boolean(
            nextFullName,
          ),
        hasPicture:
          Boolean(
            nextPicture,
          ),
        missing: [
          !nextFullName
            ? "name"
            : null,
          !nextPicture
            ? "picture"
            : null,
        ].filter(Boolean),
        graphErrors,
        permissionHint,
      },
    );
  }

  return NextResponse.json({
    success: true,
    updated: shouldUpdate,
    profile: {
      fullName:
        nextFullName,
      profilePictureUrl:
        nextPicture,
    },
    source,
    sources,
    pictureStatus:
      nextPicture
        ? "available"
        : "initial-fallback",
    avatarDiscoveryUrl:
      nextPicture
        ? null
        : `/api/facebook/avatar-discovery?contactId=${contact.id}`,
    graphErrors,
    permissionHint,
  });
}
