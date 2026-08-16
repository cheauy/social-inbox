import Link from "next/link";

import { CustomerReportForm } from "@/components/support/customer-report-form";

export default function CustomerReportPage() {
  return (
    <div className="h-full overflow-y-auto bg-slate-100 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-blue-600"
        >
          <span aria-hidden="true">←</span>
          Back to dashboard
        </Link>

        <div className="mb-6 mt-4">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
            TENH Support
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">
            Customer report
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Send a problem report to TENH and review replies from the admin team.
          </p>
        </div>

        <CustomerReportForm />
      </div>
    </div>
  );
}
