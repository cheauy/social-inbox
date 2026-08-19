import { InviteAcceptView } from "@/components/auth/invite-accept-view";

type InviteAcceptPageProps = {
  searchParams: Promise<{
    token?: string | string[];
  }>;
};

function single(
  value: string | string[] | undefined,
) {
  return Array.isArray(value)
    ? value[0]?.trim() ?? ""
    : value?.trim() ?? "";
}

export default async function InviteAcceptPage({
  searchParams,
}: InviteAcceptPageProps) {
  const params = await searchParams;
  const token = single(params.token);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-xl">
        <InviteAcceptView token={token} />
      </div>
    </main>
  );
}
