import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

type TeamProfileRow = {
  id: string;
  user_id?: string | null;
  profile_picture_url?: string | null;
};

function authAvatar(
  metadata: Record<string, unknown> | null | undefined,
  fallback: string | null,
) {
  if (!metadata) return fallback;

  if (Object.prototype.hasOwnProperty.call(metadata, "avatar_url")) {
    const value = metadata.avatar_url;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  const picture = metadata.picture;
  if (typeof picture === "string" && picture.trim()) {
    return picture.trim();
  }

  return fallback;
}

/**
 * Resolve the current Supabase Auth avatar for team members.
 * Profile settings save the real photo in Auth metadata, so settings pages
 * should prefer that live value over an older team_members snapshot.
 */
export async function resolveTeamProfilePictures<T extends TeamProfileRow>(
  rows: T[],
): Promise<Map<string, string | null>> {
  const resolved = await Promise.all(
    rows.map(async (row) => {
      const fallback = row.profile_picture_url?.trim() || null;
      const userId = row.user_id?.trim();

      if (!userId) {
        return [row.id, fallback] as const;
      }

      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (error || !data.user) {
          return [row.id, fallback] as const;
        }

        return [
          row.id,
          authAvatar(
            data.user.user_metadata as Record<string, unknown> | undefined,
            fallback,
          ),
        ] as const;
      } catch {
        return [row.id, fallback] as const;
      }
    }),
  );

  return new Map(resolved);
}
