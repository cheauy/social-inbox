import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decryptChannelCredential } from "@/lib/channels/channel-token-crypto";
import { deleteTelegramWebhook } from "@/lib/telegram/telegram-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRMATION_TEXT = "DELETE MY ACCOUNT";
const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

type MembershipRow = {
  id: string;
  business_id: string;
  full_name: string;
  email: string | null;
  role: string;
  profile_picture_url: string | null;
  is_active: boolean;
};

type SubscriptionRow = {
  business_id: string;
  status: string;
};

type BusinessRow = {
  id: string;
  name: string | null;
};

type ActiveMemberRow = {
  id: string;
  business_id: string;
  full_name: string;
  email: string | null;
  role: string;
};

type OwnerCandidate = {
  memberId: string;
  name: string;
  email: string | null;
  role: string;
};

type BlockingSubscription = {
  businessId: string;
  businessName: string;
  status: string;
  candidates: OwnerCandidate[];
};

type AccountDeletionImpact = {
  canDelete: boolean;
  membershipCount: number;
  activeOwnedSubscriptionCount: number;
  blockingSubscriptions: BlockingSubscription[];
};

type OwnerDecision = "transfer" | "delete_subscriptions";

type OwnerTransferRequest = {
  businessId: string;
  memberId: string;
};

type MemberRoleSnapshot = {
  id: string;
  role: string;
};

type SubscriptionClosureRow = {
  id: string;
  business_id: string;
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
};

type ActiveStateSnapshot = {
  id: string;
  is_active: boolean;
};

type WorkspaceClosureSnapshot = {
  businessId: string;
  subscriptions: SubscriptionClosureRow[];
  members: ActiveStateSnapshot[];
  socialAccounts: ActiveStateSnapshot[];
};

function displayMemberName(member: ActiveMemberRow) {
  return (
    member.full_name?.trim() ||
    member.email?.trim() ||
    "Active team member"
  );
}

async function loadAccountDeletionImpact(
  userId: string,
): Promise<AccountDeletionImpact> {
  const { data: memberships, error: membershipError } =
    await supabaseAdmin
      .from("team_members")
      .select(
        "id,business_id,full_name,email,role,profile_picture_url,is_active",
      )
      .eq("user_id", userId);

  if (membershipError) {
    throw new Error(
      `Unable to verify account memberships: ${membershipError.message}`,
    );
  }

  const membershipRows = (memberships ?? []) as MembershipRow[];
  const ownerBusinessIds = Array.from(
    new Set(
      membershipRows
        .filter(
          (membership) =>
            membership.is_active && membership.role === "owner",
        )
        .map((membership) => membership.business_id),
    ),
  );

  if (ownerBusinessIds.length === 0) {
    return {
      canDelete: true,
      membershipCount: membershipRows.length,
      activeOwnedSubscriptionCount: 0,
      blockingSubscriptions: [],
    };
  }

  const [subscriptionsResult, businessesResult] = await Promise.all([
    supabaseAdmin
      .from("business_subscriptions")
      .select("business_id,status")
      .in("business_id", ownerBusinessIds)
      .in("status", [...ACTIVE_SUBSCRIPTION_STATUSES]),
    supabaseAdmin
      .from("businesses")
      .select("id,name")
      .in("id", ownerBusinessIds),
  ]);

  if (subscriptionsResult.error) {
    throw new Error(
      `Unable to verify owned subscriptions: ${subscriptionsResult.error.message}`,
    );
  }

  if (businessesResult.error) {
    throw new Error(
      `Unable to verify owned workspaces: ${businessesResult.error.message}`,
    );
  }

  const activeSubscriptions =
    (subscriptionsResult.data ?? []) as SubscriptionRow[];
  const activeBusinessIds = Array.from(
    new Set(
      activeSubscriptions.map(
        (subscription) => subscription.business_id,
      ),
    ),
  );

  if (activeBusinessIds.length === 0) {
    return {
      canDelete: true,
      membershipCount: membershipRows.length,
      activeOwnedSubscriptionCount: 0,
      blockingSubscriptions: [],
    };
  }

  const { data: otherActiveMembers, error: membersError } =
    await supabaseAdmin
      .from("team_members")
      .select("id,business_id,full_name,email,role")
      .in("business_id", activeBusinessIds)
      .eq("is_active", true)
      .neq("user_id", userId);

  if (membersError) {
    throw new Error(
      `Unable to verify other workspace owners: ${membersError.message}`,
    );
  }

  const businessNames = new Map(
    ((businessesResult.data ?? []) as BusinessRow[]).map(
      (business) => [
        business.id,
        business.name?.trim() || "TENH Workspace",
      ],
    ),
  );

  const activeMembers =
    (otherActiveMembers ?? []) as ActiveMemberRow[];
  const subscriptionByBusiness = new Map(
    activeSubscriptions.map((subscription) => [
      subscription.business_id,
      subscription,
    ]),
  );

  const blockingSubscriptions = activeBusinessIds
    .filter((businessId) => {
      return !activeMembers.some(
        (member) =>
          member.business_id === businessId && member.role === "owner",
      );
    })
    .map((businessId) => {
      const candidates = activeMembers
        .filter(
          (member) =>
            member.business_id === businessId && member.role !== "owner",
        )
        .map((member) => ({
          memberId: member.id,
          name: displayMemberName(member),
          email: member.email,
          role: member.role,
        }));

      return {
        businessId,
        businessName:
          businessNames.get(businessId) ?? "TENH Workspace",
        status:
          subscriptionByBusiness.get(businessId)?.status ?? "active",
        candidates,
      };
    });

  return {
    canDelete: blockingSubscriptions.length === 0,
    membershipCount: membershipRows.length,
    activeOwnedSubscriptionCount: activeBusinessIds.length,
    blockingSubscriptions,
  };
}

async function getAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

async function restoreMembershipSnapshots(
  snapshots: MembershipRow[],
) {
  const restoreErrors: string[] = [];

  for (const membership of snapshots) {
    const { error } = await supabaseAdmin
      .from("team_members")
      .update({
        full_name: membership.full_name,
        email: membership.email,
        role: membership.role,
        profile_picture_url: membership.profile_picture_url,
        is_active: membership.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", membership.id);

    if (error) {
      restoreErrors.push(`${membership.id}: ${error.message}`);
    }
  }

  if (restoreErrors.length > 0) {
    console.error(
      "[TENH Account Delete] CRITICAL: unable to restore staged memberships:",
      restoreErrors,
    );
  }

  return restoreErrors;
}

async function stageMembershipDeletion(
  memberships: MembershipRow[],
) {
  const staged: MembershipRow[] = [];

  for (const membership of memberships) {
    const { error } = await supabaseAdmin
      .from("team_members")
      .update({
        full_name: "Deleted user",
        email: `deleted+${membership.id}@deleted.invalid`,
        profile_picture_url: null,
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", membership.id);

    if (error) {
      await restoreMembershipSnapshots(staged);
      throw new Error(
        `Unable to safely revoke workspace access before account deletion: ${error.message}`,
      );
    }

    staged.push(membership);
  }
}

async function restoreOwnerTransfers(
  snapshots: MemberRoleSnapshot[],
) {
  const errors: string[] = [];

  for (const snapshot of snapshots) {
    const { error } = await supabaseAdmin
      .from("team_members")
      .update({
        role: snapshot.role,
        updated_at: new Date().toISOString(),
      })
      .eq("id", snapshot.id);

    if (error) {
      errors.push(`${snapshot.id}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    console.error(
      "[TENH Account Delete] CRITICAL: unable to restore Owner transfers:",
      errors,
    );
  }

  return errors;
}

async function transferOwnedSubscriptions(
  userId: string,
  blockingSubscriptions: BlockingSubscription[],
  transfers: OwnerTransferRequest[],
) {
  const requestedByBusiness = new Map(
    transfers.map((transfer) => [
      transfer.businessId.trim(),
      transfer.memberId.trim(),
    ]),
  );
  const snapshots: MemberRoleSnapshot[] = [];

  try {
    for (const subscription of blockingSubscriptions) {
      const memberId = requestedByBusiness.get(subscription.businessId);

      if (!memberId) {
        throw new Error(
          `Choose a new Owner for ${subscription.businessName} before deleting your account.`,
        );
      }

      const { data: member, error: memberError } = await supabaseAdmin
        .from("team_members")
        .select("id,user_id,business_id,role,is_active,full_name,email")
        .eq("id", memberId)
        .eq("business_id", subscription.businessId)
        .maybeSingle<{
          id: string;
          user_id: string | null;
          business_id: string;
          role: string;
          is_active: boolean;
          full_name: string | null;
          email: string | null;
        }>();

      if (memberError) {
        throw new Error(
          `Unable to verify the replacement Owner for ${subscription.businessName}: ${memberError.message}`,
        );
      }

      if (!member || !member.is_active || member.user_id === userId) {
        throw new Error(
          `The selected replacement Owner for ${subscription.businessName} is no longer an active eligible user. Refresh and choose another user.`,
        );
      }

      snapshots.push({ id: member.id, role: member.role });

      if (member.role === "owner") {
        continue;
      }

      const { data: promoted, error: promoteError } = await supabaseAdmin
        .from("team_members")
        .update({
          role: "owner",
          updated_at: new Date().toISOString(),
        })
        .eq("id", member.id)
        .eq("business_id", subscription.businessId)
        .eq("is_active", true)
        .select("id")
        .maybeSingle();

      if (promoteError || !promoted) {
        throw new Error(
          `Unable to transfer ${subscription.businessName} to the selected Owner.${promoteError ? ` ${promoteError.message}` : ""}`,
        );
      }
    }

    const recheck = await loadAccountDeletionImpact(userId);

    if (!recheck.canDelete) {
      throw new Error(
        "TENH could not verify that every active subscription now has another active Owner. No account data was deleted.",
      );
    }

    return snapshots;
  } catch (error) {
    await restoreOwnerTransfers(snapshots);
    throw error;
  }
}

async function restoreWorkspaceClosures(
  snapshots: WorkspaceClosureSnapshot[],
) {
  const errors: string[] = [];

  for (const workspace of snapshots) {
    for (const subscription of workspace.subscriptions) {
      const { error } = await supabaseAdmin
        .from("business_subscriptions")
        .update({
          status: subscription.status,
          current_period_end: subscription.current_period_end,
          trial_ends_at: subscription.trial_ends_at,
        })
        .eq("id", subscription.id);

      if (error) {
        errors.push(`subscription ${subscription.id}: ${error.message}`);
      }
    }

    for (const member of workspace.members) {
      const { error } = await supabaseAdmin
        .from("team_members")
        .update({
          is_active: member.is_active,
          updated_at: new Date().toISOString(),
        })
        .eq("id", member.id);

      if (error) {
        errors.push(`member ${member.id}: ${error.message}`);
      }
    }

    for (const account of workspace.socialAccounts) {
      const { error } = await supabaseAdmin
        .from("social_accounts")
        .update({ is_active: account.is_active })
        .eq("id", account.id);

      if (error) {
        errors.push(`social account ${account.id}: ${error.message}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(
      "[TENH Account Delete] CRITICAL: unable to restore staged workspace closure:",
      errors,
    );
  }

  return errors;
}

async function closeOwnedSubscriptions(
  userId: string,
  blockingSubscriptions: BlockingSubscription[],
) {
  const snapshots: WorkspaceClosureSnapshot[] = [];
  const now = new Date().toISOString();

  try {
    for (const blocking of blockingSubscriptions) {
      const [subscriptionResult, memberResult, socialResult, otherOwnerResult] =
        await Promise.all([
          supabaseAdmin
            .from("business_subscriptions")
            .select("id,business_id,status,current_period_end,trial_ends_at")
            .eq("business_id", blocking.businessId)
            .in("status", [...ACTIVE_SUBSCRIPTION_STATUSES]),
          supabaseAdmin
            .from("team_members")
            .select("id,is_active")
            .eq("business_id", blocking.businessId),
          supabaseAdmin
            .from("social_accounts")
            .select("id,is_active")
            .eq("business_id", blocking.businessId),
          supabaseAdmin
            .from("team_members")
            .select("id")
            .eq("business_id", blocking.businessId)
            .eq("role", "owner")
            .eq("is_active", true)
            .neq("user_id", userId)
            .limit(1),
        ]);

      if (subscriptionResult.error) {
        throw new Error(
          `Unable to prepare ${blocking.businessName} subscription for deletion: ${subscriptionResult.error.message}`,
        );
      }

      if (memberResult.error) {
        throw new Error(
          `Unable to prepare ${blocking.businessName} users for deletion: ${memberResult.error.message}`,
        );
      }

      if (socialResult.error) {
        throw new Error(
          `Unable to prepare ${blocking.businessName} channels for deletion: ${socialResult.error.message}`,
        );
      }

      if (otherOwnerResult.error) {
        throw new Error(
          `Unable to recheck ${blocking.businessName} Owner access: ${otherOwnerResult.error.message}`,
        );
      }

      // If another Owner appeared after the modal loaded, preserve the
      // subscription instead of terminating a workspace now controlled by
      // somebody else. The current account can still be removed safely.
      if ((otherOwnerResult.data?.length ?? 0) > 0) {
        continue;
      }

      const activeSubscriptions =
        (subscriptionResult.data ?? []) as SubscriptionClosureRow[];

      // Subscription state may also have changed between preflight and this
      // write. Never deactivate an entire workspace when there is no longer an
      // active/trial subscription to close.
      if (activeSubscriptions.length === 0) {
        continue;
      }

      const snapshot: WorkspaceClosureSnapshot = {
        businessId: blocking.businessId,
        subscriptions: activeSubscriptions,
        members:
          (memberResult.data ?? []) as ActiveStateSnapshot[],
        socialAccounts:
          (socialResult.data ?? []) as ActiveStateSnapshot[],
      };

      snapshots.push(snapshot);

      for (const subscription of snapshot.subscriptions) {
        const { error } = await supabaseAdmin
          .from("business_subscriptions")
          .update({
            // Account deletion is an exceptional immediate close, not the
            // retired scheduled-cancellation flow. "expired" is the prepaid
            // lifecycle's locked state and prevents further workspace access.
            status: "expired",
            current_period_end: now,
            trial_ends_at:
              subscription.status === "trialing"
                ? now
                : subscription.trial_ends_at,
          })
          .eq("id", subscription.id)
          .in("status", [...ACTIVE_SUBSCRIPTION_STATUSES]);

        if (error) {
          throw new Error(
            `Unable to end ${blocking.businessName} subscription: ${error.message}`,
          );
        }
      }

      const { error: memberDeactivateError } = await supabaseAdmin
        .from("team_members")
        .update({
          is_active: false,
          updated_at: now,
        })
        .eq("business_id", blocking.businessId)
        .eq("is_active", true);

      if (memberDeactivateError) {
        throw new Error(
          `Unable to revoke ${blocking.businessName} workspace access: ${memberDeactivateError.message}`,
        );
      }

      const { error: channelDeactivateError } = await supabaseAdmin
        .from("social_accounts")
        .update({ is_active: false })
        .eq("business_id", blocking.businessId)
        .eq("is_active", true);

      if (channelDeactivateError) {
        throw new Error(
          `Unable to disable ${blocking.businessName} channels: ${channelDeactivateError.message}`,
        );
      }
    }

    return snapshots;
  } catch (error) {
    await restoreWorkspaceClosures(snapshots);
    throw error;
  }
}

async function releaseClosedWorkspaceTelegramBots(
  snapshots: WorkspaceClosureSnapshot[],
) {
  const businessIds = Array.from(
    new Set(snapshots.map((snapshot) => snapshot.businessId)),
  );

  if (businessIds.length === 0) {
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select(
      "id,business_id,telegram_bot_token_encrypted,telegram_token_status",
    )
    .in("business_id", businessIds)
    .eq("platform", "telegram")
    .eq("telegram_token_status", "verified");

  if (error) {
    console.error(
      "[TENH Account Delete] Unable to load Telegram Bots for closed workspaces:",
      error.message,
    );
    return;
  }

  for (const row of data ?? []) {
    const encryptedToken =
      typeof row.telegram_bot_token_encrypted === "string"
        ? row.telegram_bot_token_encrypted
        : "";

    if (encryptedToken) {
      try {
        const token = decryptChannelCredential(encryptedToken);
        await deleteTelegramWebhook({
          token,
          dropPendingUpdates: true,
        });
      } catch (telegramError) {
        // The TENH row is still disconnected below. If Telegram cannot be
        // reached, any stale delivery reaches a disabled/disconnected TENH
        // connection and cannot create new customer history.
        console.warn(
          "[TENH Account Delete] Telegram webhook cleanup warning:",
          telegramError instanceof Error
            ? telegramError.message
            : telegramError,
        );
      }
    }

    const { error: disconnectError } = await supabaseAdmin
      .from("social_accounts")
      .update({
        is_active: false,
        telegram_bot_token_encrypted: null,
        telegram_token_status: "disconnected",
        telegram_connected_at: null,
        telegram_token_last_error: null,
        telegram_webhook_secret_encrypted: null,
        telegram_webhook_status: "disabled",
        telegram_webhook_url: null,
        telegram_webhook_registered_at: null,
        telegram_webhook_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("business_id", row.business_id);

    if (disconnectError) {
      console.error(
        "[TENH Account Delete] CRITICAL: closed workspace Telegram Bot could not be released:",
        {
          connectionId: row.id,
          businessId: row.business_id,
          message: disconnectError.message,
        },
      );
    }
  }
}

async function listAvatarPaths(userId: string) {
  const paths: string[] = [];
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await supabaseAdmin.storage
      .from("avatars")
      .list(userId, {
        limit: pageSize,
        offset,
      });

    if (error) {
      throw error;
    }

    const files = data ?? [];

    paths.push(
      ...files
        .filter((file) => file.name)
        .map((file) => `${userId}/${file.name}`),
    );

    if (files.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  return paths;
}

async function cleanupPersonalAccountData(
  userId: string,
  avatarPaths: string[],
) {
  const cleanupWarnings: string[] = [];

  const { error: dismissalDeleteError } = await supabaseAdmin
    .from("tenh_system_announcement_dismissals")
    .delete()
    .eq("user_id", userId);

  if (dismissalDeleteError) {
    cleanupWarnings.push(
      `announcement dismissals: ${dismissalDeleteError.message}`,
    );
  }

  if (avatarPaths.length > 0) {
    const { error: avatarDeleteError } = await supabaseAdmin.storage
      .from("avatars")
      .remove(avatarPaths);

    if (avatarDeleteError) {
      cleanupWarnings.push(`avatar files: ${avatarDeleteError.message}`);
    }
  }

  if (cleanupWarnings.length > 0) {
    console.warn(
      "[TENH Account Delete] Post-delete cleanup warnings:",
      cleanupWarnings,
    );
  }
}

export async function GET() {
  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Your session has expired. Please sign in again.",
        },
        {
          status: 401,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    const impact = await loadAccountDeletionImpact(user.id);

    return NextResponse.json(
      {
        success: true,
        impact,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("[TENH Account Delete] Preflight failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to verify whether this account can be deleted safely.",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    let body: {
      confirmation?: unknown;
      understood?: unknown;
      ownerDecision?: unknown;
      ownerTransfers?: unknown;
      deleteSubscriptionsConfirmed?: unknown;
    };

    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid delete-account request.",
        },
        { status: 400 },
      );
    }

    const confirmation =
      typeof body.confirmation === "string"
        ? body.confirmation.trim()
        : "";

    if (
      confirmation !== CONFIRMATION_TEXT ||
      body.understood !== true
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Confirm the permanent deletion warning and type ${CONFIRMATION_TEXT} exactly.`,
        },
        { status: 400 },
      );
    }

    const user = await getAuthenticatedUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Your session has expired. Please sign in again.",
        },
        { status: 401 },
      );
    }

    // Server-authoritative recheck immediately before any destructive change.
    const impact = await loadAccountDeletionImpact(user.id);

    const ownerDecision: OwnerDecision | null =
      body.ownerDecision === "transfer" ||
      body.ownerDecision === "delete_subscriptions"
        ? body.ownerDecision
        : null;

    const ownerTransfers = Array.isArray(body.ownerTransfers)
      ? body.ownerTransfers
          .filter(
            (item): item is OwnerTransferRequest =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as OwnerTransferRequest).businessId === "string" &&
              typeof (item as OwnerTransferRequest).memberId === "string",
          )
          .map((item) => ({
            businessId: item.businessId.trim(),
            memberId: item.memberId.trim(),
          }))
      : [];

    if (!impact.canDelete && !ownerDecision) {
      return NextResponse.json(
        {
          success: false,
          code: "OWNER_DECISION_REQUIRED",
          error:
            "Choose what should happen to the active TENH subscription before deleting your account: transfer Owner access to another active user, or delete anyway and end the subscription/workspace access too.",
          impact,
        },
        { status: 409 },
      );
    }

    if (
      !impact.canDelete &&
      ownerDecision === "delete_subscriptions" &&
      body.deleteSubscriptionsConfirmed !== true
    ) {
      return NextResponse.json(
        {
          success: false,
          code: "SUBSCRIPTION_DELETE_CONFIRMATION_REQUIRED",
          error:
            "Confirm that the listed subscription(s) will end immediately and all workspace members will lose access.",
          impact,
        },
        { status: 400 },
      );
    }

    let ownerTransferSnapshots: MemberRoleSnapshot[] = [];
    let workspaceClosureSnapshots: WorkspaceClosureSnapshot[] = [];

    if (!impact.canDelete && ownerDecision === "transfer") {
      ownerTransferSnapshots = await transferOwnedSubscriptions(
        user.id,
        impact.blockingSubscriptions,
        ownerTransfers,
      );
    }

    if (!impact.canDelete && ownerDecision === "delete_subscriptions") {
      workspaceClosureSnapshots = await closeOwnedSubscriptions(
        user.id,
        impact.blockingSubscriptions,
      );
    }

    const { data: memberships, error: membershipError } =
      await supabaseAdmin
        .from("team_members")
        .select(
          "id,business_id,full_name,email,role,profile_picture_url,is_active",
        )
        .eq("user_id", user.id);

    if (membershipError) {
      await restoreOwnerTransfers(ownerTransferSnapshots);
      await restoreWorkspaceClosures(workspaceClosureSnapshots);
      throw new Error(
        `Unable to prepare account memberships for deletion: ${membershipError.message}`,
      );
    }

    const membershipSnapshots = (memberships ?? []) as MembershipRow[];

    let avatarPaths: string[] = [];

    try {
      avatarPaths = await listAvatarPaths(user.id);
    } catch (avatarListError) {
      console.warn(
        "[TENH Account Delete] Avatar listing warning:",
        avatarListError,
      );
    }

    try {
      await stageMembershipDeletion(membershipSnapshots);
    } catch (stageError) {
      await restoreOwnerTransfers(ownerTransferSnapshots);
      await restoreWorkspaceClosures(workspaceClosureSnapshots);
      throw stageError;
    }

    const { error: deleteUserError } =
      await supabaseAdmin.auth.admin.deleteUser(user.id);

    if (deleteUserError) {
      const membershipRestoreErrors =
        await restoreMembershipSnapshots(membershipSnapshots);
      const ownerRestoreErrors =
        await restoreOwnerTransfers(ownerTransferSnapshots);
      const closureRestoreErrors =
        await restoreWorkspaceClosures(workspaceClosureSnapshots);

      if (
        membershipRestoreErrors.length > 0 ||
        ownerRestoreErrors.length > 0 ||
        closureRestoreErrors.length > 0
      ) {
        throw new Error(
          `TENH could not delete the login account and could not fully restore the staged workspace changes. Contact TENH support before retrying. ${deleteUserError.message}`,
        );
      }

      throw new Error(
        `TENH could not delete the login account, so workspace access, subscription state, and profile data were restored. ${deleteUserError.message}`,
      );
    }

    // Auth is now gone and cannot access TENH. If this deletion also closed
    // sole-owned subscriptions, release their live Telegram Bot credentials so
    // the Bot is not trapped forever inside an ownerless expired workspace.
    // Historical social-account rows and TENH conversations remain preserved.
    await releaseClosedWorkspaceTelegramBots(workspaceClosureSnapshots);

    // Personal-only artifacts are removed best-effort. Shared business history
    // and records TENH must retain for billing, security, fraud prevention, or
    // legal obligations remain.
    await cleanupPersonalAccountData(user.id, avatarPaths);

    const response = NextResponse.json({
      success: true,
      endedSubscriptions:
        ownerDecision === "delete_subscriptions"
          ? impact.blockingSubscriptions.map((item) => item.businessId)
          : [],
    });

    response.cookies.set("tenh_active_business_id", "", {
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("[TENH Account Delete] Failed:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to delete your account.",
      },
      { status: 500 },
    );
  }
}
