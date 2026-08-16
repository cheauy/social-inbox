import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { SubscriptionAccessGate } from "@/components/subscription/subscription-access-gate";
import { getCurrentMember } from "@/lib/auth/get-current-member";
import {
  getBusinessSubscriptionAccess,
  type BusinessSubscriptionAccess,
} from "@/lib/subscription/get-business-subscription-access";

type DashboardLayoutProps = {
  children: ReactNode;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to load workspace subscription access.";
}

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps) {
  const authResult = await getCurrentMember();

  if (!authResult.success) {
    if (authResult.status === 401) {
      redirect("/login");
    }

    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-6">
        <div className="w-full max-w-xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold text-slate-950">
            Unable to open TENH Chat
          </h1>

          <p className="mt-3 text-sm leading-6 text-red-700">
            {authResult.error}
          </p>

          <p className="mt-3 text-sm text-slate-500">
            If this account was disabled by your workspace owner, contact your workspace administrator.
          </p>
        </div>
      </div>
    );
  }

  let subscriptionAccess: BusinessSubscriptionAccess;

  try {
    /*
     * V3.10.3.1 getBusinessSubscriptionAccess() returns the access object
     * directly. It does NOT return { success, access, error }.
     */
    subscriptionAccess = await getBusinessSubscriptionAccess(
      authResult.member.business_id,
    );
  } catch (error) {
    const message = getErrorMessage(error);

    console.error("[TENH] Dashboard subscription access failed", {
      businessId: authResult.member.business_id,
      message,
    });

    return (
      <div className="flex min-h-dvh flex-col overflow-hidden bg-slate-100">
        <DashboardHeader />

        <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="w-full max-w-xl rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
            <h1 className="text-lg font-bold text-slate-950">
              Unable to check subscription
            </h1>

            <p className="mt-3 text-sm leading-6 text-red-700">
              {message}
            </p>

            <p className="mt-3 text-sm text-slate-500">
              Refresh the page. If this continues, check the TENH server log before changing the subscription manually.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-100">
      <DashboardHeader />

      <main className="min-h-0 flex-1 overflow-hidden">
        <SubscriptionAccessGate access={subscriptionAccess}>
          {children}
        </SubscriptionAccessGate>
      </main>
    </div>
  );
}