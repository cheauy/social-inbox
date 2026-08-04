import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/profile/profile-form";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : "";

  const phone =
    user.phone ??
    (typeof user.user_metadata?.phone === "string"
      ? user.user_metadata.phone
      : "");

  const avatarUrl =
    typeof user.user_metadata?.avatar_url === "string"
      ? user.user_metadata.avatar_url
      : null;

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-950">
          Profile information
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Manage your personal information and profile image.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <ProfileForm
          initialFullName={fullName}
          initialPhone={phone}
          email={user.email ?? ""}
          initialAvatarUrl={avatarUrl}
        />
      </div>
    </div>
  );
}