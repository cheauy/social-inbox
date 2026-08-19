import { UserPermissionsManager } from "@/components/settings/user-permissions-manager";

type UsersSettingsPageProps = {
  searchParams?: Promise<{
    tab?: string | string[];
  }>;
};

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function UsersSettingsPage({
  searchParams,
}: UsersSettingsPageProps) {
  const params = searchParams ? await searchParams : {};
  const requestedTab = singleParam(params.tab);

  return (
    <UserPermissionsManager
      initialTab={requestedTab === "channels" ? "channels" : "users"}
    />
  );
}
