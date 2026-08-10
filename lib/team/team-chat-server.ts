import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

type CurrentMemberLike = {
  id: string;
  business_id: string;
  full_name: string;
  role: string;
  profile_picture_url?: string | null;
};

export type TeamChatRoomRow = {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_general: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function canManageTeamChat(
  role: string,
): boolean {
  return role === "owner" || role === "admin";
}

export async function ensureGeneralRoom(
  businessId: string,
): Promise<TeamChatRoomRow> {
  const { data: existing, error: loadError } =
    await supabaseAdmin
      .from("team_chat_rooms")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_general", true)
      .maybeSingle();

  if (loadError) {
    throw new Error(
      `Unable to load General room: ${loadError.message}`,
    );
  }

  if (existing) {
    return existing as TeamChatRoomRow;
  }

  const { data: created, error: createError } =
    await supabaseAdmin
      .from("team_chat_rooms")
      .insert({
        business_id: businessId,
        name: "General",
        slug: "general",
        description: "Company-wide internal team chat.",
        is_general: true,
        is_active: true,
      })
      .select("*")
      .single();

  if (createError || !created) {
    throw new Error(
      `Unable to create General room: ${createError?.message ?? "Unknown error"}`,
    );
  }

  return created as TeamChatRoomRow;
}

export async function loadActiveBusinessMembers(
  businessId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("team_members")
    .select(`
      id,
      full_name,
      email,
      role,
      profile_picture_url
    `)
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(
      `Unable to load team members: ${error.message}`,
    );
  }

  return data ?? [];
}

export async function getAccessibleRoom(
  currentMember: CurrentMemberLike,
  roomId: string,
): Promise<TeamChatRoomRow | null> {
  const { data: room, error } = await supabaseAdmin
    .from("team_chat_rooms")
    .select("*")
    .eq("id", roomId)
    .eq("business_id", currentMember.business_id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to load team chat room: ${error.message}`,
    );
  }

  if (!room) {
    return null;
  }

  const typedRoom = room as TeamChatRoomRow;

  if (
    typedRoom.is_general ||
    canManageTeamChat(currentMember.role)
  ) {
    return typedRoom;
  }

  const { data: membership, error: memberError } =
    await supabaseAdmin
      .from("team_chat_room_members")
      .select("room_id")
      .eq("room_id", roomId)
      .eq("member_id", currentMember.id)
      .maybeSingle();

  if (memberError) {
    throw new Error(
      `Unable to verify room access: ${memberError.message}`,
    );
  }

  return membership ? typedRoom : null;
}

export function slugifyRoomName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug || `group-${Date.now()}`;
}
