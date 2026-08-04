import { ProfileMenu } from "@/components/dashboard/profile-menu";
import { createClient } from "@/lib/supabase/server";

export async function CurrentUserProfileMenu() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : "";

  const avatarUrl =
    typeof user.user_metadata?.avatar_url === "string"
      ? user.user_metadata.avatar_url
      : null;

  return (
    <ProfileMenu
      name={fullName || "Tenh Chat User"}
      email={user.email ?? "No email"}
      avatarUrl={avatarUrl}
    />
  );
}