import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canManageTeamChat,
  ensureGeneralRoom,
  loadActiveBusinessMembers,
  safeDetails,
  slugifyRoomName,
} from "@/lib/team/team-chat-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readAuthProfilePicture(
  metadata: Record<string, unknown> | undefined,
): { hasExplicitAvatar: boolean; url: string | null } {
  if (!metadata) {
    return { hasExplicitAvatar: false, url: null };
  }

  if (Object.prototype.hasOwnProperty.call(metadata, "avatar_url")) {
    const avatar = metadata.avatar_url;

    return {
      hasExplicitAvatar: true,
      url:
        typeof avatar === "string" && avatar.trim()
          ? avatar.trim()
          : null,
    };
  }

  const picture = metadata.picture;

  return {
    hasExplicitAvatar: false,
    url:
      typeof picture === "string" && picture.trim()
        ? picture.trim()
        : null,
  };
}

export async function GET() {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;

  try {
    // Profile settings store the real user photo in Supabase Auth metadata.
    // Keep the current team_members row in sync so Group Chat headers and
    // message avatars use the same real profile photo as the main TENH header.
    const authAvatar = readAuthProfilePicture(
      authResult.user.user_metadata as Record<string, unknown> | undefined,
    );
    const shouldSyncAvatar =
      authAvatar.hasExplicitAvatar
        ? authAvatar.url !== currentMember.profile_picture_url
        : Boolean(
            authAvatar.url &&
              !currentMember.profile_picture_url,
          );

    if (shouldSyncAvatar) {
      const { error: profileSyncError } = await supabaseAdmin
        .from("team_members")
        .update({ profile_picture_url: authAvatar.url })
        .eq("id", currentMember.id)
        .eq("user_id", authResult.user.id)
        .eq("business_id", currentMember.business_id);

      if (profileSyncError) {
        console.warn(
          "[TENH Team Chat] Unable to sync profile picture.",
          profileSyncError.message,
        );
      } else {
        currentMember.profile_picture_url = authAvatar.url;
      }
    }

    await ensureGeneralRoom(currentMember.business_id);

    const [roomsResult, membershipsResult, members] =
      await Promise.all([
        supabaseAdmin
          .from("team_chat_rooms")
          .select("*")
          .eq("business_id", currentMember.business_id)
          .eq("is_active", true)
          .order("is_general", { ascending: false })
          .order("name", { ascending: true }),
        supabaseAdmin
          .from("team_chat_room_members")
          .select("room_id,member_id,last_read_at,muted_at")
          .eq("business_id", currentMember.business_id),
        loadActiveBusinessMembers(currentMember.business_id),
      ]);

    if (roomsResult.error) {
      throw new Error(roomsResult.error.message);
    }

    if (membershipsResult.error) {
      throw new Error(membershipsResult.error.message);
    }

    const memberships = membershipsResult.data ?? [];
    const myMemberships = new Map(
      memberships
        .filter(
          (membership) =>
            membership.member_id === currentMember.id,
        )
        .map((membership) => [
          membership.room_id,
          membership,
        ]),
    );

    const admin = canManageTeamChat(currentMember.role);
    const accessibleRooms = (roomsResult.data ?? []).filter(
      (room) =>
        room.is_general ||
        admin ||
        myMemberships.has(room.id),
    );

    const rooms = await Promise.all(
      accessibleRooms.map(async (room) => {
        const roomMemberIds = room.is_general
          ? members.map((member) => member.id)
          : memberships
              .filter(
                (membership) =>
                  membership.room_id === room.id,
              )
              .map((membership) => membership.member_id);

        const myMembership = myMemberships.get(room.id);
        let unreadCount = 0;

        // A member who has never opened the room has no last_read_at.
        // Previously that produced a permanent 0, so new members — and
        // General, which has no membership row until you post or read —
        // never showed an unread badge at all.
        let unreadQuery = supabaseAdmin
          .from("team_chat_messages")
          .select("id", { head: true, count: "exact" })
          .eq("business_id", currentMember.business_id)
          .eq("room_id", room.id)
          .neq("sender_member_id", currentMember.id);

        if (myMembership?.last_read_at) {
          unreadQuery = unreadQuery.gt(
            "created_at",
            myMembership.last_read_at,
          );
        }

        const { count, error: countError } = await unreadQuery;

        if (!countError) {
          unreadCount = count ?? 0;
        }

        const isMuted = Boolean(myMembership?.muted_at);

        // Mentions are counted separately and deliberately IGNORE mute:
        // muting a busy group must not mean missing a direct @you.
        const { count: mentionCount } = await supabaseAdmin
          .from("team_notifications")
          .select("id", { head: true, count: "exact" })
          .eq("business_id", currentMember.business_id)
          .eq("recipient_member_id", currentMember.id)
          .eq("room_id", room.id)
          .eq("is_read", false);

        return {
          ...room,
          member_ids: roomMemberIds,
          member_count: roomMemberIds.length,
          unread_count: unreadCount,
          // What the badge shows. A muted room contributes nothing
          // unless an unread mention is waiting in it.
          badge_count: isMuted ? mentionCount ?? 0 : unreadCount,
          mention_count: mentionCount ?? 0,
          is_muted: isMuted,
        };
      }),
    );

    const totalBadgeCount = rooms.reduce(
      (sum, room) => sum + (room.badge_count ?? 0),
      0,
    );

    return NextResponse.json({
      success: true,
      rooms,
      totalBadgeCount,
      members,
      currentMember: {
        id: currentMember.id,
        full_name: currentMember.full_name,
        role: currentMember.role,
        profile_picture_url:
          currentMember.profile_picture_url ?? null,
      },
      businessId: currentMember.business_id,
      canManage: admin,
    });
  } catch (error) {
    console.error("[TENH Team Chat] Unable to load rooms.", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load team chat rooms.",
        ...safeDetails(
          error instanceof Error ? error.message : undefined,
        ),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: authResult.status },
    );
  }

  const currentMember = authResult.member;

  if (!canManageTeamChat(currentMember.role)) {
    return NextResponse.json(
      {
        success: false,
        error: "Only an owner or admin can create team groups.",
      },
      { status: 403 },
    );
  }

  let body: {
    name?: string;
    description?: string | null;
    memberIds?: unknown;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  }

  const name = body.name?.trim();

  if (!name) {
    return NextResponse.json(
      { success: false, error: "Group name is required." },
      { status: 400 },
    );
  }

  if (name.length > 80) {
    return NextResponse.json(
      {
        success: false,
        error: "Group name cannot contain more than 80 characters.",
      },
      { status: 400 },
    );
  }

  const submittedMemberIds = Array.isArray(body.memberIds)
    ? body.memberIds.filter(
        (memberId): memberId is string =>
          typeof memberId === "string",
      )
    : [];

  const requestedMemberIds = Array.from(
    new Set([currentMember.id, ...submittedMemberIds]),
  );

  const { data: validMembers, error: membersError } =
    await supabaseAdmin
      .from("team_members")
      .select("id")
      .eq("business_id", currentMember.business_id)
      .eq("is_active", true)
      .in("id", requestedMemberIds);

  if (membersError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to validate team members.",
        ...safeDetails(membersError.message),
      },
      { status: 500 },
    );
  }

  const slug = `${slugifyRoomName(name)}-${Date.now().toString(36)}`;

  const { data: room, error: roomError } =
    await supabaseAdmin
      .from("team_chat_rooms")
      .insert({
        business_id: currentMember.business_id,
        name,
        slug,
        description: body.description?.trim() || null,
        is_general: false,
        is_active: true,
        created_by: currentMember.id,
      })
      .select("*")
      .single();

  if (roomError || !room) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to create team group.",
        ...safeDetails(roomError?.message),
      },
      { status: 500 },
    );
  }

  const membershipRows = (validMembers ?? []).map(
    (member) => ({
      room_id: room.id,
      business_id: currentMember.business_id,
      member_id: member.id,
      last_read_at:
        member.id === currentMember.id
          ? new Date().toISOString()
          : null,
    }),
  );

  if (membershipRows.length > 0) {
    const { error: membershipError } =
      await supabaseAdmin
        .from("team_chat_room_members")
        .insert(membershipRows);

    if (membershipError) {
      await supabaseAdmin
        .from("team_chat_rooms")
        .delete()
        .eq("id", room.id);

      return NextResponse.json(
        {
          success: false,
          error: "Unable to add members to the group.",
          ...safeDetails(membershipError.message),
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    success: true,
    room: {
      ...room,
      member_ids: (validMembers ?? []).map(
        (member) => member.id,
      ),
      member_count: validMembers?.length ?? 0,
      unread_count: 0,
    },
  });
}
