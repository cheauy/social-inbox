import { TenhAdminWorkspace } from "@/components/admin/tenh-admin-workspace";
import {
  isTenhAdminMfaRequired,
  requireTenhAdminPage,
} from "@/lib/admin/tenh-admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AdminPageProps = {
  searchParams: Promise<{
    tab?: string | string[];
  }>;
};

export type AdminTab =
  | "overview"
  | "billing"
  | "manual-payments"
  | "customer-reports"
  | "announcements"
  | "channel-health"
  | "connections"
  | "workspace-inspector"
  | "security";

function resolveTab(
  value: string | string[] | undefined,
): AdminTab {
  const tab = Array.isArray(value) ? value[0] : value;

  if (
    tab === "billing" ||
    tab === "manual-payments" ||
    tab === "customer-reports" ||
    tab === "announcements" ||
    tab === "channel-health" ||
    tab === "connections" ||
    tab === "workspace-inspector" ||
    tab === "security"
  ) {
    return tab;
  }

  return "overview";
}

export default async function TenhAdminPage({
  searchParams,
}: AdminPageProps) {
  const admin = await requireTenhAdminPage();
  const params = await searchParams;

  return (
    <div className="h-full overflow-y-auto">
      <TenhAdminWorkspace
        adminEmail={admin.email ?? "TENH admin"}
        initialTab={resolveTab(params.tab)}
        adminMfaRequired={isTenhAdminMfaRequired()}
      />
    </div>
  );
}
