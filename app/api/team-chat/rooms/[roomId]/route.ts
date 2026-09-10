import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentMember } from "@/lib/auth/get-current-member";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canManageTeamChat,
  roomIconFromSlug,
  safeDetails,
  slugWithRoomIcon,
} from "@/lib/team/team-chat-server";

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 240;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

/*
 * Renaming a group, or changing what it is for.
 *
 * A group is created in one breath -- somebody types a name, picks an icon
 * and adds people, all before the room exists -- and every one of those three
 * is a first guess. "TEST" becomes the sales room; the cart icon turns out to
 * suit it better than the default. Until now the only way to correct any of
 * it was to delete the group and lose everything said in it.
 *
 * The icon rides in the slug, which is where this codebase keeps it, so
 * changing an icon writes a new slug. Nothing else reads the slug -- rooms are
 * addressed by id everywhere -- so an old link cannot break.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
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
        error: "Only an owner or admin can change team groups.",
      },
      { status: 403 },
    );
  }

  const { roomId } = await context.params;

  if (!roomId?.trim()) {
    return NextResponse.json(
      { success: false, error: "Group ID is required." },
      { status: 400 },
    );
  }

  let body: { name?: unknown; description?: unknown; icon?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request." },
      { status: 400 },
    );
  }

  const { data: room, error: roomError } = await supabaseAdmin
    .from("team_chat_rooms")
    .select("id,business_id,name,description,slug,is_general")
    .eq("id", roomId)
    .eq("business_id", currentMember.business_id)
    .maybeSingle();

  if (roomError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load team group.",
        ...safeDetails(roomError.message),
      },
      { status: 500 },
    );
  }

  if (!room) {
    return NextResponse.json(
      {
        success: false,
        error: "Team group was not found or you do not have access.",
      },
      { status: 404 },
    );
  }

  if (room.is_general) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The General group cannot be renamed. It is the room every workspace has.",
      },
      { status: 400 },
    );
  }

  const name =
    typeof body.name === "string" ? body.name.trim() : room.name ?? "";

  if (!name) {
    return NextResponse.json(
      { success: false, error: "A group name is required." },
      { status: 400 },
    );
  }

  if (name.length > MAX_NAME_LENGTH) {
    return NextResponse.json(
      {
        success: false,
        error: `Keep the group name under ${MAX_NAME_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }

  const description =
    typeof body.description === "string"
      ? body.description.trim().slice(0, MAX_DESCRIPTION_LENGTH)
      : (room.description ?? "");

  /*
   * The icon defaults to the one the room already wears rather than to
   * "people": a request that only renames a group must not quietly reset an
   * icon somebody chose.
   */
  const icon =
    body.icon === undefined ? roomIconFromSlug(room.slug) : body.icon;

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("team_chat_rooms")
    .update({
      name,
      description: description || null,
      slug: slugWithRoomIcon(name, icon),
      updated_at: new Date().toISOString(),
    })
    .eq("id", room.id)
    .eq("business_id", currentMember.business_id)
    .select("id,name,description,slug")
    .maybeSingle();

  if (updateError || !updated) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to save those changes.",
        ...safeDetails(updateError?.message),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    room: {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      icon: roomIconFromSlug(updated.slug),
    },
  });
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
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

  if (!canManageTeamChat(currentMember.role)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Only an owner or admin can delete team groups.",
      },
      {
        status: 403,
      },
    );
  }

  const { roomId } = await context.params;

  if (!roomId?.trim()) {
    return NextResponse.json(
      {
        success: false,
        error: "Group ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data: room,
    error: roomError,
  } = await supabaseAdmin
    .from("team_chat_rooms")
    .select("id,business_id,name,is_general")
    .eq("id", roomId)
    .eq(
      "business_id",
      currentMember.business_id,
    )
    .maybeSingle();

  if (roomError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load team group.",
        ...safeDetails(roomError.message),
      },
      {
        status: 500,
      },
    );
  }

  if (!room) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Team group was not found or you do not have access.",
      },
      {
        status: 404,
      },
    );
  }

  if (room.is_general) {
    return NextResponse.json(
      {
        success: false,
        error:
          "The General group cannot be deleted.",
      },
      {
        status: 400,
      },
    );
  }

  const { error: deleteError } =
    await supabaseAdmin
      .from("team_chat_rooms")
      .delete()
      .eq("id", room.id)
      .eq(
        "business_id",
        currentMember.business_id,
      );

  if (deleteError) {
    return NextResponse.json(
      {
        success: false,
        error: "Unable to delete team group.",
        ...safeDetails(deleteError.message),
      },
      {
        status: 500,
      },
    );
  }

  return NextResponse.json({
    success: true,
    deletedRoomId: room.id,
    deletedRoomName: room.name,
  });
}
