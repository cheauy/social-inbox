"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type SubscriptionLockReason =
  | "expired"
  | "past_due"
  | "suspended"
  | null;

type BusinessSubscriptionAccess = {
  hasSubscription: boolean;
  locked: boolean;
  reason: SubscriptionLockReason;
  status:
    | "trialing"
    | "active"
    | "past_due"
    | "expired"
    | "suspended"
      | null;
  planCode: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  subscription: unknown;
};

type SubscriptionAccessGateProps = {
  children: ReactNode;
  access: BusinessSubscriptionAccess;
};

type LockedCopy = {
  eyebrow: string;
  title: string;
  message: string;
  statusLabel: string;
  noticeTitle: string;
  noticeText: string;
};

function getLockedCopy(
  reason: SubscriptionLockReason,
  planCode: string | null,
): LockedCopy {
  switch (reason) {
    case "past_due":
      return {
        eyebrow: "Billing attention required",
        title: "Payment is required to restore access",
        message:
          "Choose a TENH Chat plan and billing period, then complete payment to restore this workspace.",
        statusLabel: "Past due",
        noticeTitle: "Your workspace is protected",
        noticeText:
          "Customer conversations, contacts, notes, tags, and team data remain stored while billing is resolved.",
      };

    case "suspended":
      return {
        eyebrow: "Workspace access paused",
        title: "This workspace is currently suspended",
        message:
          "Contact TENH support before starting another subscription payment.",
        statusLabel: "Suspended",
        noticeTitle: "Your data remains available",
        noticeText:
          "Suspension locks workspace access without deleting your customer or conversation data.",
      };

    case "expired":
    default: {
      const wasTrial = planCode === "trial";

      return {
        eyebrow: wasTrial ? "Free trial completed" : "Subscription expired",
        title: wasTrial
          ? "Your 14-day trial has ended"
          : "Your TENH Chat subscription has expired",
        message:
          "Choose Mini, Standard, or Pro and select Monthly, 3 Months, 6 Months, or 1 Year. Access restores only after the new payment is approved.",
        statusLabel: "Expired",
        noticeTitle: "Your workspace is safe",
        noticeText:
          "TENH does not automatically renew or charge this workspace. Your data remains stored while you choose the next prepaid period.",
      };
    }
  }
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-6 w-6"
      aria-hidden="true"
    >
      <rect x="5" y="10" width="14" height="10" rx="3" />
      <path
        d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14v2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="m4 10 3.5 3.5L16 5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M4 10h12m-4-4 4 4-4 4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getPlanLabel(planCode: string | null) {
  if (!planCode) {
    return "No active plan";
  }

  if (planCode === "trial") {
    return "Free Trial";
  }

  return planCode
    .split(/[-_]/g)
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

export function SubscriptionAccessGate({
  children,
  access,
}: SubscriptionAccessGateProps) {
  const pathname = usePathname();

  const subscriptionPage =
    pathname === "/dashboard/subscription" ||
    pathname.startsWith(
      "/dashboard/subscription/",
    );

  if (!access.locked || subscriptionPage) {
    return children;
  }

  const copy = getLockedCopy(access.reason, access.planCode);
  const planLabel = getPlanLabel(access.planCode);

  return (
    <div className="relative h-full overflow-y-auto bg-[#f5f7fb]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-36 -top-40 h-[420px] w-[420px] rounded-full bg-blue-100/80 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 h-[460px] w-[460px] rounded-full bg-indigo-100/70 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl items-center justify-center px-5 py-10 sm:px-8 lg:py-14">
        <div className="w-full overflow-hidden rounded-[30px] border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
          <div className="grid lg:grid-cols-[1.12fr_0.88fr]">
            <section className="relative overflow-hidden bg-[#08132f] px-7 py-9 text-white sm:px-10 sm:py-11 lg:px-12 lg:py-12">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full border border-blue-400/20 bg-blue-500/10" />
                <div className="absolute -bottom-24 left-8 h-56 w-56 rounded-full bg-indigo-500/10 blur-2xl" />
                <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_48%)]" />
              </div>

              <div className="relative">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-blue-200 shadow-inner shadow-white/5">
                  <LockIcon />
                </div>

                <p className="mt-8 text-xs font-bold uppercase tracking-[0.22em] text-blue-300">
                  {copy.eyebrow}
                </p>

                <h1 className="mt-3 max-w-2xl text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl lg:text-[42px] lg:leading-[1.08]">
                  {copy.title}
                </h1>

                <p className="mt-5 max-w-xl text-[15px] leading-7 text-slate-300 sm:text-base">
                  {copy.message}
                </p>

                <div className="mt-8 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.07] px-4 py-2 text-sm font-semibold text-slate-200">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Workspace status: {copy.statusLabel}
                </div>
              </div>
            </section>

            <section className="px-7 py-9 sm:px-10 sm:py-11 lg:px-12 lg:py-12">
              <div className="flex items-start justify-between gap-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                    Current plan
                  </p>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
                    {planLabel}
                  </p>
                </div>

                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                  {copy.statusLabel}
                </span>
              </div>

              <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                <p className="font-bold text-slate-950">
                  {copy.noticeTitle}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {copy.noticeText}
                </p>
              </div>

              <div className="mt-7 space-y-3">
                {[
                  "Choose the plan that fits your team",
                  "Complete payment securely",
                  "Workspace access restores after approved payment",
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 text-sm font-medium text-slate-700"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <CheckIcon />
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              <Link
                href="/dashboard/subscription"
                className="mt-9 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 py-4 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100"
              >
                {access.reason === "suspended"
                  ? "View subscription"
                  : "Renew subscription"}
                <ArrowIcon />
              </Link>

              <p className="mt-4 text-center text-xs leading-5 text-slate-400">
                Your existing workspace data stays preserved while access is paused.
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
