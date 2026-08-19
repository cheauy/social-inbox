import Link from "next/link";

import { CustomSubscriptionBuilder } from "@/components/subscription/custom-subscription-builder";

export const dynamic = "force-dynamic";

export default function BuyCustomSubscriptionPage() {
  return (
    <div className="h-full min-h-0 w-full overflow-y-auto overscroll-y-contain">
      <div className="mx-auto w-full max-w-6xl px-5 py-7 pb-12 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
            Buy subscription
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
            Custom Subscription
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Set the connection capacity, team size, and prepaid duration you
            need.
          </p>
        </div>

        <Link
          href="/dashboard/subscription/buy"
          className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Back to plans
        </Link>
      </div>

      <CustomSubscriptionBuilder />
      </div>
    </div>
  );
}
