import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentMember,
} from "@/lib/auth/get-current-member";
import {
  supabaseAdmin,
} from "@/lib/supabase/admin";
import {
  canActivateAnotherChannel,
} from "@/lib/subscription/get-business-entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TeamMemberRow = {
  id: string;
  user_id: string;
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
  telegram_token_status: string | null;
};

type SubscriptionRow = {
  id: string;
  business_id: string;
  plan_code: string;
  status: string;
  member_limit: number;
  channel_limit: number;
};

type MutationContext = {
  businessId?: string;
  subscriptionId?: string | null;
};

type UpdateBody =
  | (MutationContext & {
      kind: "member";
      id?: string;
      active?: boolean;
    })
  | (MutationContext & {
      kind: "member-role";
      id?: string;
      role?: "owner" | "admin";
    })
  | (MutationContext & {
      kind: "connection";
      id?: string;
      active?: boolean;
    });

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

async function verifyMutationContext({
  body,
  currentBusinessId,
}: {
  body: MutationContext;
  currentBusinessId: string;
}) {
  const requestedBusinessId = body.businessId?.trim() ?? "";

  if (!requestedBusinessId) {
    return {
      ok: false as const,
      response: jsonError(
        "Subscription context is missing. Reload this page before changing users or channels.",
        409,
      ),
    };
  }

  if (requestedBusinessId !== currentBusinessId) {
    return {
      ok: false as const,
      response: jsonError(
        "The active subscription changed in another tab. TENH blocked this update so it cannot be applied to the wrong subscription. Reload and try again.",
        409,
      ),
    };
  }

  const { data: subscription, error } = await supabaseAdmin
    .from("business_subscriptions")
    .select("id,business_id")
    .eq("business_id", currentBusinessId)
    .maybeSingle<{ id: string; business_id: string }>();

  if (error) {
    return {
      ok: false as const,
      response: jsonError(
        "Unable to verify the subscription before making this change.",
        500,
        error.message,
      ),
    };
  }

  if (!subscription) {
    return {
      ok: false as const,
      response: jsonError(
        "This workspace does not have a managed subscription. TENH did not change anything.",
        409,
      ),
    };
  }

  const requestedSubscriptionId = body.subscriptionId?.trim() ?? "";

  if (!requestedSubscriptionId || requestedSubscriptionId !== subscription.id) {
    return {
      ok: false as const,
      response: jsonError(
        "The subscription shown on this page is no longer the active subscription. TENH blocked the update to protect the wrong workspace. Reload and confirm the subscription ID before trying again.",
        409,
      ),
    };
  }

  return {
    ok: true as const,
    subscriptionId: subscription.id,
  };
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
        user_id,
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
        facebook_page_access_token_encrypted,
        telegram_token_status
      `)
      .eq("business_id", businessId)
      .order("created_at", {
        ascending: true,
      }),

    supabaseAdmin
      .from("business_subscriptions")
      .select(`
        id,
        business_id,
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

  /*
   * Keep temporarily disabled channels in Capacity so an Owner can enable
   * them again without reconnecting credentials. Fully disconnected
   * Facebook/Telegram accounts are intentionally omitted.
   */
  const visibleConnections =
    connections.filter((connection) => {
      if (connection.is_active) {
        return true;
      }

      if (connection.platform === "facebook") {
        return connection.facebook_token_status !== "disconnected";
      }

      if (connection.platform === "telegram") {
        return connection.telegram_token_status === "verified";
      }

      return false;
    });

  const subscription =
    subscriptionResult.data ?? null;

  return {
    businessId,
    currentMemberId,
    currentMemberRole,
    canManage:
      canManageUsage(currentMemberRole),
    subscription,
    usage: {
      members: members.filter(
        (member) => member.is_active,
      ).length,
      channels: visibleConnections.filter(
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
    connections: visibleConnections.map(
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
      "Only the workspace owner can manage subscription seats and connected channels.",
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

  const contextCheck = await verifyMutationContext({
    body,
    currentBusinessId: currentMember.business_id,
  });

  if (!contextCheck.ok) {
    return contextCheck.response;
  }

  const targetId = body.id?.trim();

  if (!targetId) {
    return jsonError(
      "A target ID is required.",
      400,
    );
  }

  if (body.kind === "member-role") {
    if (
      body.role !== "owner" &&
      body.role !== "admin"
    ) {
      return jsonError(
        "Only Owner sharing or Owner-share removal is supported here.",
        400,
      );
    }

    const {
      data: targetMember,
      error: memberError,
    } = await supabaseAdmin
      .from("team_members")
      .select(`
        id,
        user_id,
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

    if (!targetMember.is_active) {
      return jsonError(
        "Reactivate this user before changing Owner access.",
        409,
      );
    }

    if (targetMember.id === currentMember.id && body.role === "admin") {
      return jsonError(
        "You cannot disable your own Owner access from this screen.",
        409,
      );
    }

    if (targetMember.role === body.role) {
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
          role: body.role,
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
        body.role === "owner"
          ? "Unable to share Owner access with this team member."
          : "Unable to disable Owner share for this team member.",
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
      message:
        body.role === "owner"
          ? `Owner access is now shared with ${targetMember.full_name}.`
          : `Owner share was disabled for ${targetMember.full_name}. They are now an Admin.`,
      ...data,
    });
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
        user_id,
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

    if (
      targetMember.id === currentMember.id &&
      body.active === false
    ) {
      return jsonError(
        "You cannot remove your own access from the subscription you are currently using. Another Owner can remove your access.",
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
        ? `${targetMember.full_name} can access this subscription again.`
        : `${targetMember.full_name} no longer has access to this subscription. Their other TENH subscriptions are unchanged.`,
      ...data,
    });
  }

  if (body.kind === "connection") {
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
        facebook_page_access_token_encrypted,
        telegram_token_status
      `)
      .eq("id", targetId)
      .eq(
        "business_id",
        currentMember.business_id,
      )
      .maybeSingle<SocialAccountRow>();

    if (connectionError) {
      return jsonError(
        "Unable to verify this channel.",
        500,
        connectionError.message,
      );
    }

    if (!connection) {
      return jsonError(
        "Channel not found.",
        404,
      );
    }

    if (
      connection.is_active ===
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

    if (body.active) {
      if (
        connection.platform === "facebook" &&
        connection.facebook_token_status === "disconnected"
      ) {
        return jsonError(
          "This Facebook Page was disconnected. Reconnect it from Integrations before enabling it.",
          409,
        );
      }

      if (
        connection.platform === "telegram" &&
        connection.telegram_token_status !== "verified"
      ) {
        return jsonError(
          "This Telegram Bot is not connected. Reconnect it from Integrations before enabling it.",
          409,
        );
      }

      const entitlement =
        await canActivateAnotherChannel(
          currentMember.business_id,
        );

      if (!entitlement.allowed) {
        const limit =
          entitlement.entitlements?.channelLimit;

        return jsonError(
          entitlement.code === "CHANNEL_LIMIT_REACHED"
            ? limit === 1
              ? "Channel limit reached. Your current plan includes 1 active connection. Disable another channel or upgrade your plan."
              : `Channel limit reached. Your current plan includes ${limit ?? "the maximum number of"} active connections. Disable another channel or upgrade your plan.`
            : entitlement.message ??
              "Your TENH plan does not allow another active channel.",
          409,
        );
      }
    }

    /*
     * This is a capacity/access toggle, not a disconnect. Keep the saved
     * Facebook/Telegram credentials and webhook configuration untouched so
     * the Owner can enable the same channel again later. Incoming webhook
     * handlers already ignore social_accounts where is_active is false.
     */
    const { error: updateError } =
      await supabaseAdmin
        .from("social_accounts")
        .update({
          is_active: body.active,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", connection.id)
        .eq(
          "business_id",
          currentMember.business_id,
        );

    if (updateError) {
      return jsonError(
        body.active
          ? "Unable to enable this channel."
          : "Unable to disable this channel.",
        409,
        updateError.message,
      );
    }

    const data = await loadUsage(
      currentMember.business_id,
      currentMember.id,
      currentMember.role,
    );

    const name =
      connection.account_name ??
      (connection.platform === "telegram"
        ? "Telegram Bot"
        : "Customer channel");

    return NextResponse.json({
      success: true,
      changed: true,
      message: body.active
        ? `${name} is enabled and now uses one channel slot.`
        : `${name} is disabled and no longer uses a channel slot. Existing customer and message history is kept.`,
      ...data,
    });
  }

  return jsonError(
    "Unsupported usage-management action.",
    400,
  );
}
