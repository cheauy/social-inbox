import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  decryptFacebookToken,
} from "@/lib/facebook/facebook-token-crypto";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TeamMemberRow = {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  is_active: boolean;
  profile_picture_url: string | null;
};

type SocialAccountRow = {
  id: string;
  platform: string;
  platform_account_id: string | null;
  account_name: string | null;
  is_active: boolean;
  facebook_token_status: string | null;
  facebook_page_access_token_encrypted: string | null;
};

type SubscriptionRow = {
  plan_code: string;
  status: string;
  member_limit: number;
  channel_limit: number;
};

type UpdateBody =
  | {
      kind: "member";
      id?: string;
      active?: boolean;
    }
  | {
      kind: "connection";
      id?: string;
      active?: boolean;
    };

function jsonError(
  error: string,
  status: number,
  details?: string,
) {
  return NextResponse.json(
    {
      success: false,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

function canManageUsage(role: string) {
  return role === "owner";
}

async function loadUsage(
  businessId: string,
  currentMemberId: string,
  currentMemberRole: string,
) {
  const [
    membersResult,
    connectionsResult,
    subscriptionResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("team_members")
      .select(`
        id,
        full_name,
        email,
        role,
        is_active,
        profile_picture_url
      `)
      .eq("business_id", businessId)
      .order("created_at", {
        ascending: true,
      }),

    supabaseAdmin
      .from("social_accounts")
      .select(`
        id,
        platform,
        platform_account_id,
        account_name,
        is_active,
        facebook_token_status,
        facebook_page_access_token_encrypted
      `)
      .eq("business_id", businessId)
      .eq("platform", "facebook")
      .order("created_at", {
        ascending: true,
      }),

    supabaseAdmin
      .from("business_subscriptions")
      .select(`
        plan_code,
        status,
        member_limit,
        channel_limit
      `)
      .eq("business_id", businessId)
      .maybeSingle<SubscriptionRow>(),
  ]);

  if (membersResult.error) {
    throw new Error(
      membersResult.error.message,
    );
  }

  if (connectionsResult.error) {
    throw new Error(
      connectionsResult.error.message,
    );
  }

  if (subscriptionResult.error) {
    throw new Error(
      subscriptionResult.error.message,
    );
  }

  const members =
    (membersResult.data ?? []) as TeamMemberRow[];
  const connections =
    (connectionsResult.data ?? []) as SocialAccountRow[];
  const subscription =
    subscriptionResult.data ?? null;

  return {
    currentMemberId,
    currentMemberRole,
    canManage:
      canManageUsage(currentMemberRole),
    subscription,
    usage: {
      members: members.filter(
        (member) => member.is_active,
      ).length,
      channels: connections.filter(
        (connection) => connection.is_active,
      ).length,
    },
    members: members.map((member) => ({
      id: member.id,
      full_name: member.full_name,
      email: member.email,
      role: member.role,
      is_active: member.is_active,
      profile_picture_url:
        member.profile_picture_url,
    })),
    connections: connections.map(
      (connection) => ({
        id: connection.id,
        platform: connection.platform,
        platform_account_id:
          connection.platform_account_id,
        account_name:
          connection.account_name,
        is_active: connection.is_active,
        facebook_token_status:
          connection.facebook_token_status,
      }),
    ),
  };
}

async function bestEffortUnsubscribeFacebookPage(
  connection: SocialAccountRow,
) {
  const pageId =
    connection.platform_account_id?.trim();
  const encryptedToken =
    connection.facebook_page_access_token_encrypted;

  if (!pageId || !encryptedToken) {
    return;
  }

  let pageAccessToken: string;

  try {
    pageAccessToken = decryptFacebookToken(
      encryptedToken,
    );
  } catch (error) {
    console.warn(
      "[TENH V3.8.2.1] Could not decrypt Page token while disconnecting. Continuing with local disconnect.",
      error,
    );
    return;
  }

  const graphVersion =
    process.env.FACEBOOK_GRAPH_API_VERSION?.trim() ||
    "v26.0";

  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${pageId}/subscribed_apps`,
  );

  try {
    const response = await fetch(url, {
      method: "DELETE",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
      },
    });

    if (!response.ok) {
      console.warn(
        "[TENH V3.8.2.1] Meta webhook unsubscribe did not succeed. TENH will still disconnect the Page locally.",
        {
          pageId,
          status: response.status,
        },
      );
    }
  } catch (error) {
    console.warn(
      "[TENH V3.8.2.1] Meta webhook unsubscribe request failed. TENH will still disconnect the Page locally.",
      error,
    );
  }
}

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const currentMember = authResult.member;

  try {
    const data = await loadUsage(
      currentMember.business_id,
      currentMember.id,
      currentMember.role,
    );

    return NextResponse.json({
      success: true,
      ...data,
    });
  } catch (error) {
    console.error(
      "[TENH V3.8.2.1] Unable to load subscription usage management:",
      error,
    );

    return jsonError(
      "Unable to load workspace usage.",
      500,
      error instanceof Error
        ? error.message
        : undefined,
    );
  }
}

export async function PATCH(
  request: NextRequest,
) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return jsonError(
      authResult.error,
      authResult.status,
    );
  }

  const currentMember = authResult.member;

  if (!canManageUsage(currentMember.role)) {
    return jsonError(
      "Only the workspace owner can manage subscription seats and connected Pages.",
      403,
    );
  }

  let body: UpdateBody;

  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return jsonError(
      "Invalid JSON request.",
      400,
    );
  }

  const targetId = body.id?.trim();

  if (!targetId) {
    return jsonError(
      "A target ID is required.",
      400,
    );
  }

  if (typeof body.active !== "boolean") {
    return jsonError(
      "Active status is required.",
      400,
    );
  }

  if (body.kind === "member") {
    const {
      data: targetMember,
      error: memberError,
    } = await supabaseAdmin
      .from("team_members")
      .select(`
        id,
        full_name,
        email,
        role,
        is_active,
        profile_picture_url
      `)
      .eq("id", targetId)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .maybeSingle<TeamMemberRow>();

    if (memberError) {
      return jsonError(
        "Unable to verify the team member.",
        500,
        memberError.message,
      );
    }

    if (!targetMember) {
      return jsonError(
        "Team member not found.",
        404,
      );
    }

    if (targetMember.role === "owner") {
      return jsonError(
        "The workspace owner always occupies one seat. Transfer ownership before deactivating an owner.",
        409,
      );
    }

    if (
      targetMember.id === currentMember.id &&
      body.active === false
    ) {
      return jsonError(
        "You cannot deactivate your own account from Subscription usage.",
        409,
      );
    }

    if (
      targetMember.is_active ===
      body.active
    ) {
      const data = await loadUsage(
        currentMember.business_id,
        currentMember.id,
        currentMember.role,
      );

      return NextResponse.json({
        success: true,
        changed: false,
        ...data,
      });
    }

    const { error: updateError } =
      await supabaseAdmin
        .from("team_members")
        .update({
          is_active: body.active,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", targetMember.id)
        .eq(
          "business_id",
          currentMember.business_id,
        );

    if (updateError) {
      return jsonError(
        updateError.message.includes(
          "Team member limit reached",
        )
          ? updateError.message
          : "Unable to update the team member.",
        409,
        updateError.message,
      );
    }

    const data = await loadUsage(
      currentMember.business_id,
      currentMember.id,
      currentMember.role,
    );

    return NextResponse.json({
      success: true,
      changed: true,
      message: body.active
        ? `${targetMember.full_name} is active again.`
        : `${targetMember.full_name} was deactivated and no longer uses a seat.`,
      ...data,
    });
  }

  if (body.kind === "connection") {
    if (body.active) {
      return jsonError(
        "Reconnect Facebook Pages through Facebook Login so TENH can refresh the Page token and webhook subscription.",
        409,
      );
    }

    const {
      data: connection,
      error: connectionError,
    } = await supabaseAdmin
      .from("social_accounts")
      .select(`
        id,
        platform,
        platform_account_id,
        account_name,
        is_active,
        facebook_token_status,
        facebook_page_access_token_encrypted
      `)
      .eq("id", targetId)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .eq("platform", "facebook")
      .maybeSingle<SocialAccountRow>();

    if (connectionError) {
      return jsonError(
        "Unable to verify the Facebook Page connection.",
        500,
        connectionError.message,
      );
    }

    if (!connection) {
      return jsonError(
        "Facebook Page connection not found.",
        404,
      );
    }

    if (!connection.is_active) {
      const data = await loadUsage(
        currentMember.business_id,
        currentMember.id,
        currentMember.role,
      );

      return NextResponse.json({
        success: true,
        changed: false,
        ...data,
      });
    }

    await bestEffortUnsubscribeFacebookPage(
      connection,
    );

    const { error: updateError } =
      await supabaseAdmin
        .from("social_accounts")
        .update({
          is_active: false,
          facebook_token_status:
            "disconnected",
          facebook_token_last_error: null,
        })
        .eq("id", connection.id)
        .eq(
          "business_id",
          currentMember.business_id,
        );

    if (updateError) {
      return jsonError(
        "Unable to disconnect the Facebook Page.",
        500,
        updateError.message,
      );
    }

    const data = await loadUsage(
      currentMember.business_id,
      currentMember.id,
      currentMember.role,
    );

    return NextResponse.json({
      success: true,
      changed: true,
      message: `${connection.account_name ?? "Facebook Page"} was disconnected and no longer uses a connection slot.`,
      ...data,
    });
  }

  return jsonError(
    "Unsupported usage-management action.",
    400,
  );
}
