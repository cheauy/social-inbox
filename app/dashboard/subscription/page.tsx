import { SubscriptionView } from "@/components/subscription/subscription-view";
import Link from "next/link";
import { WorkspaceLanguageText } from "@/components/display/workspace-language-text";

export default async function SubscriptionPage({ searchParams }: {
  searchParams: Promise<{ bakong_closed?: string | string[]; purchase_business?: string | string[] }>;
}) {
  const params = await searchParams;
  const attemptId = typeof params.bakong_closed === "string" ? params.bakong_closed.trim() : "";
  const businessId = typeof params.purchase_business === "string" ? params.purchase_business.trim() : "";
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <SubscriptionView />
      {uuid.test(attemptId) && uuid.test(businessId) ? <p className="mx-auto max-w-7xl px-4 pb-6 text-sm sm:px-6">
        <Link className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 font-semibold text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600"
          href={`/dashboard/subscription/payment?bakong_attempt=${encodeURIComponent(attemptId)}&purchase_business=${encodeURIComponent(businessId)}&bakong_status=closed`}>
          <WorkspaceLanguageText en="View saved payment" km="មើលការបង់ប្រាក់ដែលបានរក្សាទុក" />
        </Link>
      </p> : null}
    </div>
  );
}
