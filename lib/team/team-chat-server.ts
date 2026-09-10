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

export const TEAM_CHAT_ROOM_ICONS = [
  "people",
  "megaphone",
  "briefcase",
  "headset",
  "cart",
  "rocket",
  "heart",
  "star",
] as const;

export type TeamChatRoomIcon = (typeof TEAM_CHAT_ROOM_ICONS)[number];

const ROOM_ICON_PREFIX = "icon-";

export function normalizeRoomIcon(value: unknown): TeamChatRoomIcon {
  return typeof value === "string" &&
    TEAM_CHAT_ROOM_ICONS.includes(value as TeamChatRoomIcon)
    ? (value as TeamChatRoomIcon)
    : "people";
}

export function roomIconFromSlug(slug: string | null | undefined): TeamChatRoomIcon {
  const candidate = slug?.split("--", 1)[0]?.replace(ROOM_ICON_PREFIX, "");
  return normalizeRoomIcon(candidate);
}

export function slugWithRoomIcon(name: string, icon: unknown): string {
  return `${ROOM_ICON_PREFIX}${normalizeRoomIcon(icon)}--${slugifyRoomName(name)}-${Date.now().toString(36)}`;
}

export function canManageTeamChat(
  role: string,
): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Never send raw Postgres messages to a browser in production — they leak
 * table, column and constraint names.
 */
export function safeDetails(message: string | undefined) {
  return process.env.NODE_ENV !== "production" && message
    ? { details: message }
    : {};
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

/**
 * Who is allowed to receive notifications about this room.
 *
 * General implicitly contains every active member. A private room
 * contains only its membership rows. This is the list that mention
 * targets MUST be filtered against — a mention notification carries the
 * message text, so notifying a non-member leaks the private room's
 * contents to someone who cannot open it.
 */
export async function getRoomAudienceMemberIds(
  room: TeamChatRoomRow,
): Promise<string[]> {
  if (room.is_general) {
    const members = await loadActiveBusinessMembers(
      room.business_id,
    );

    return members.map((member) => member.id);
  }

  const { data, error } = await supabaseAdmin
    .from("team_chat_room_members")
    .select("member_id")
    .eq("room_id", room.id)
    .eq("business_id", room.business_id);

  if (error) {
    throw new Error(
      `Unable to load room audience: ${error.message}`,
    );
  }

  return (data ?? []).map((row) => row.member_id as string);
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


/* ------------------------------------------------------------------ *
 * Attachments
 * ------------------------------------------------------------------ */

export const TEAM_CHAT_BUCKET = "team-chat";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB for images/audio/files
export const MAX_VIDEO_ATTACHMENT_BYTES = 100 * 1024 * 1024; // 100 MB for video

/**
 * Allow-list, not a block-list. Anything not named here is rejected,
 * so a new dangerous type can never slip through by default.
 */
const ALLOWED_MIME: Record<string, "image" | "video" | "audio" | "file"> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/heic": "image",
  "image/heif": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
  "video/3gpp": "video",
  "video/x-m4v": "video",
  "video/mpeg": "video",
  "application/mp4": "video",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/m4a": "audio",
  "audio/x-m4a": "audio",
  "audio/aac": "audio",
  "audio/webm": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "application/pdf": "file",
  "text/plain": "file",
  "text/csv": "file",
  "application/zip": "file",
  "application/msword": "file",
  "application/vnd.ms-excel": "file",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "file",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "file",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "file",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  '3gp': "video/3gpp",
  mp3: "audio/mpeg",
  m4a: "audio/x-m4a",
  aac: "audio/aac",
  ogg: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function normalizeAttachmentMimeType(
  mimeType: string | null | undefined,
  fileName?: string | null,
) {
  const normalized = (mimeType || "").trim().toLowerCase();
  if (ALLOWED_MIME[normalized]) return normalized;

  // Android pickers commonly report videos, voice notes and documents as
  // application/octet-stream. In that case the extension is the safer
  // signal than rejecting a perfectly valid local file.
  const extension = fileName?.split(".").pop()?.trim().toLowerCase() ?? "";
  const extensionMime = MIME_BY_EXTENSION[extension];

  if (
    extensionMime &&
    (!normalized ||
      normalized === "application/octet-stream" ||
      normalized === "application/mp4" ||
      normalized === "video/*" ||
      normalized.startsWith("video/"))
  ) return extensionMime;

  if (!normalized || normalized === "application/octet-stream") {
    return "application/octet-stream";
  }

  return normalized;
}

export function classifyAttachment(
  mimeType: string,
  fileName?: string | null,
) {
  return ALLOWED_MIME[normalizeAttachmentMimeType(mimeType, fileName)] ?? null;
}

export function maxAttachmentBytes(kind: "image" | "video" | "audio" | "file") {
  return kind === "video" ? MAX_VIDEO_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;
}

/**
 * Strip anything that could escape the storage prefix or confuse a
 * Content-Disposition header.
 */
export function safeFileName(name: string) {
  const cleaned = name
    .replace(/[\\/]/g, "-")
    .replace(/[\u0000-\u001f\u007f"']/g, "")
    .trim()
    .slice(0, 120);

  return cleaned || "file";
}

export type AttachmentRow = {
  id: string;
  message_id: string | null;
  room_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  kind: "image" | "video" | "audio" | "file";
  width: number | null;
  height: number | null;
  created_at: string;
};

/**
 * Attach short-lived signed URLs. The bucket is private, so this is the
 * only way a browser can read a file — and the caller has already been
 * checked against room membership before we get here.
 */
export async function withSignedUrls(
  rows: AttachmentRow[],
  expiresInSeconds = 60 * 30,
) {
  if (rows.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin.storage
    .from(TEAM_CHAT_BUCKET)
    .createSignedUrls(
      rows.map((row) => row.storage_path),
      expiresInSeconds,
    );

  if (error) {
    // A missing URL degrades to "no preview", never to a broken page.
    return rows.map((row) => ({ ...row, url: null as string | null }));
  }

  const urlByPath = new Map(
    (data ?? []).map((entry) => [entry.path, entry.signedUrl]),
  );

  return rows.map((row) => ({
    ...row,
    url: urlByPath.get(row.storage_path) ?? null,
  }));
}

export async function loadAttachmentsForMessages(
  messageIds: string[],
) {
  if (messageIds.length === 0) {
    return new Map<string, Awaited<ReturnType<typeof withSignedUrls>>>();
  }

  const { data, error } = await supabaseAdmin
    .from("team_chat_attachments")
    .select("*")
    .in("message_id", messageIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Unable to load attachments: ${error.message}`,
    );
  }

  const signed = await withSignedUrls((data ?? []) as AttachmentRow[]);

  const byMessage = new Map<string, typeof signed>();

  for (const row of signed) {
    if (!row.message_id) {
      continue;
    }

    const list = byMessage.get(row.message_id) ?? [];
    list.push(row);
    byMessage.set(row.message_id, list);
  }

  return byMessage;
}
