import { AdminMfaChallenge } from "@/components/admin/admin-mfa-challenge";
import { requireTenhAdminIdentityPage } from "@/lib/admin/tenh-admin-auth";

export default async function TenhAdminMfaPage() {
  // UUID + email + confirmed-email guard remains required here.
  // MFA is intentionally not required yet because this page performs the challenge.
  await requireTenhAdminIdentityPage();

  return (
    <div className="h-full overflow-y-auto">
      <AdminMfaChallenge />
    </div>
  );
}
