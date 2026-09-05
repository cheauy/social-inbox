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
  /*
   * Numbered, not ticked. The old list used green checkmarks for steps nobody
   * had taken yet, which reads as progress already made -- the opposite of the
   * truth on a screen whose whole job is to say what is still outstanding.
   */
  steps: string[];
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
        steps: [
          "Open Subscription and pick a plan and billing period",
          "Complete payment",
          "Access restores as soon as the payment is approved",
        ],
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
        steps: [
          "Contact TENH support to review this workspace",
          "Support confirms what is needed to lift the suspension",
          "Do not start a new payment until support has replied",
        ],
      };

    case "expired":
    default: {
      const wasTrial = planCode === "trial";

      return {
        eyebrow: wasTrial ? "Free trial completed" : "Subscription expired",
        title: wasTrial
          ? "Your 7-day trial has ended"
          : "This subscription is expired",
        message: wasTrial
          ? "Buy a subscription to continue, or switch to an active workspace from the workspace switcher in the header."
          : "Please switch to an active workspace from the workspace switcher in the header, or buy a new subscription to continue.",
        statusLabel: "Expired",
        noticeTitle: "Your workspace is safe",
        noticeText: wasTrial
          ? "TENH never charged you for the trial and will not charge you now. Your conversations, contacts and settings stay stored, and buying a subscription picks them all up."
          : "TENH does not automatically renew or charge this workspace. Your data remains stored while you choose the next prepaid period.",
        /*
         * A finished trial is not renewed, it is replaced -- there is no price
         * to repeat, so every word here is about buying rather than restoring.
         */
        steps: wasTrial
          ? [
              "Choose a plan and complete payment to start your subscription",
              "Your Facebook Page or Telegram Bot is free to connect to it straight away",
              "Everything from the trial — conversations, contacts, settings — is still here",
            ]
          : [
              "Renew here to keep this workspace, its channels and its history",
              "Or switch to another workspace from the header switcher",
              "Your Page or Bot is free to connect to a new subscription right away",
            ],
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

function PlugIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M7 3v4m6-4v4M5 7h10v3a5 5 0 0 1-10 0V7Zm5 8v3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/*
 * The end date, formatted identically on the server and in the browser.
 *
 * This is a Client Component that also renders on the server, so anything that
 * differs between the two shows up as a hydration mismatch. Two things did:
 * toLocaleDateString with no locale follows each runtime's own default -- the
 * server said "Aug 19, 2026" while the browser said "19 Aug 2026" -- and a
 * relative "16 days ago" read Date.now() twice, once per environment, so it
 * could disagree across a midnight boundary.
 *
 * Pinning the locale fixes the first. The relative suffix is gone rather than
 * patched: the absolute date already answers when this ended, and no wording
 * is worth a render that can differ between the two passes.
 */
function formatEndedAt(value: string | null) {
  if (!value) {
    return null;
  }

  const ended = new Date(value);

  if (!Number.isFinite(ended.getTime())) {
    return null;
  }

  return ended.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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

  const profilePage =
    pathname === "/dashboard/profile" ||
    pathname.startsWith("/dashboard/profile/");

  const integrationsPage =
    pathname === "/dashboard/integrations" ||
    pathname.startsWith(
      "/dashboard/integrations/",
    );

  const securityPage =
    pathname === "/dashboard/settings/security" ||
    pathname.startsWith(
      "/dashboard/settings/security/",
    );

  /*
   * Profile stays reachable so a lapsed customer can still manage or delete
   * their TENH account, and Login & security joins it because that is what the
   * lock screen now offers. Only these two settings paths open -- the rest of
   * Settings belongs to a working subscription.
   */
  const profileAllowedWhileExpired =
    access.reason === "expired" &&
    (profilePage || securityPage);

  /*
   * An expired workspace can still reach Integrations, because disconnecting a
   * channel is the one thing it may legitimately need to do.
   *
   * A Facebook Page or Telegram Bot stays claimed by this workspace until it is
   * deliberately disconnected -- expiry does not release it. Locking this page
   * meant a customer who had let a trial lapse could not free their own channel
   * to use it in a new subscription, and had to ask support to do it for them.
   *
   * Nothing is given away by opening it: connecting refuses on the server while
   * the subscription is locked, so what remains reachable here is disconnecting,
   * which is exactly the intent.
   */
  const integrationsAllowedWhileExpired =
    access.reason === "expired" &&
    integrationsPage;

  if (
    !access.locked ||
    subscriptionPage ||
    profileAllowedWhileExpired ||
    integrationsAllowedWhileExpired
  ) {
    return children;
  }

  const copy = getLockedCopy(access.reason, access.planCode);
  const planLabel = getPlanLabel(access.planCode);
  const wasTrial = access.planCode === "trial";
  const endedAt = formatEndedAt(
    access.planCode === "trial"
      ? (access.trialEndsAt ??
          access.currentPeriodEnd)
      : (access.currentPeriodEnd ??
          access.trialEndsAt),
  );

  return (
    <div className="relative h-full overflow-y-auto bg-[#f5f7fb]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-36 -top-40 h-[420px] w-[420px] rounded-full bg-blue-100/80 blur-3xl" />
        <div className="absolute -bottom-48 -right-32 h-[460px] w-[460px] rounded-full bg-indigo-100/70 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-full w-full max-w-5xl items-center justify-center px-5 py-10 sm:px-8 lg:py-14">
        <div className="w-full overflow-hidden rounded-[30px] border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
          <div className="grid lg:grid-cols-[1fr_1fr]">
            <section className="relative flex flex-col overflow-hidden bg-[linear-gradient(135deg,#06143A_0%,#0C2C87_46%,#3D1370_100%)] px-7 py-9 text-white sm:px-10 sm:py-11 lg:px-11 lg:py-12">
              {/*
                The logo runs blue into orange into magenta, so the panel picks
                up all three: the brand gradient carries blue to violet, and
                these warm the middle. A flat navy matched none of them.
              */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -right-24 -top-24 h-64 w-64 rounded-full border border-[#22C3F3]/25 bg-[#22C3F3]/10" />
                <div className="absolute -bottom-28 -left-10 h-64 w-64 rounded-full bg-[#FF7A00]/20 blur-3xl" />
                <div className="absolute bottom-16 right-0 h-48 w-48 rounded-full bg-[#C42BB4]/20 blur-3xl" />
                <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_48%)]" />
              </div>

              <div className="relative flex h-full flex-col">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-[#7FD4FF] shadow-inner shadow-white/5">
                  <LockIcon />
                </div>

                <p className="mt-7 text-xs font-bold uppercase tracking-[0.22em] text-[#7FD4FF]">
                  {copy.eyebrow}
                </p>

                <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-white sm:text-[34px] sm:leading-[1.12]">
                  {copy.title}
                </h1>

                <p className="mt-4 max-w-md text-[15px] leading-7 text-white/75">
                  {copy.message}
                </p>

                {/*
                  Plan, status and end date as one row of facts. This panel used
                  to hold a headline and a status pill that repeated the badge
                  opposite it, leaving most of the height empty and none of the
                  questions answered.
                */}
                <dl className="mt-auto grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-7 sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
                      Plan
                    </dt>
                    <dd className="mt-1.5 text-sm font-semibold text-white">
                      {planLabel}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
                      Status
                    </dt>
                    <dd className="mt-1.5 flex items-center gap-2 text-sm font-semibold text-white">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      {copy.statusLabel}
                    </dd>
                  </div>

                  {endedAt ? (
                    <div className="col-span-2 sm:col-span-1">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/50">
                        Ended
                      </dt>
                      <dd className="mt-1.5 text-sm font-semibold text-white">
                        {endedAt}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </div>
            </section>

            <section className="px-7 py-9 sm:px-10 sm:py-11 lg:px-11 lg:py-12">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                <p className="font-bold text-slate-950">
                  {copy.noticeTitle}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {copy.noticeText}
                </p>
              </div>

              <p className="mt-8 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
                What happens next
              </p>

              <ol className="mt-4 space-y-4">
                {copy.steps.map((item, index) => (
                  <li
                    key={item}
                    className="flex gap-3 text-sm leading-6 text-slate-700"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                      {index + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>

              <Link
                href="/dashboard/subscription"
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0C2C87] px-6 py-4 text-sm font-bold text-white shadow-lg shadow-[#0C2C87]/25 transition hover:bg-[#06143A] focus:outline-none focus:ring-4 focus:ring-blue-100"
              >
                {access.reason === "suspended"
                  ? "View subscription"
                  : wasTrial
                    ? "Buy subscription"
                    : "Renew subscription"}
                <ArrowIcon />
              </Link>

              {access.reason === "expired" ? (
                <div
                  className={`mt-3 grid gap-3 ${
                    wasTrial ? "" : "sm:grid-cols-2"
                  }`}
                >
                  {/*
                    Channels is for the paid customer only. They have to
                    disconnect a Page or Bot themselves before it can move to
                    another subscription, and this screen is the only place they
                    can still reach it from. A finished trial releases its
                    channel on its own, so sending that customer to Channels
                    would be a detour to do nothing.
                  */}
                  {wasTrial ? null : (
                    <Link
                      href="/dashboard/integrations"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100"
                    >
                      <PlugIcon />
                      Channels
                    </Link>
                  )}

                  <Link
                    href="/dashboard/settings/security"
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100"
                  >
                    Login &amp; security
                  </Link>
                </div>
              ) : null}

              <p className="mt-5 text-center text-xs leading-5 text-slate-400">
                {access.reason !== "expired"
                  ? "Your existing workspace data stays preserved while access is paused."
                  : wasTrial
                    ? "Nothing is lost while you decide. Your Page or Bot is already free for the new subscription, and Login & security covers your password, signed-in devices and account."
                    : "Your workspace stays preserved. Channels stays open if you want to review or disconnect one, and Login & security lets you change your password, sign other devices out, or delete your account."}
              </p>

              {access.reason === "expired" && !wasTrial ? (
                /*
                 * The last resort, and only for a paid subscription. Its Owner
                 * has to free a channel by hand, so when they cannot open the
                 * workspace at all, support is the only way through -- and this
                 * screen is all they can see. A finished trial has no such dead
                 * end, so the line would only add noise there.
                 */
                <p className="mt-3 text-center text-xs leading-5 text-slate-400">
                  Cannot reach the workspace holding your Page or Bot?{" "}
                  <a
                    href="https://t.me/tenhchat_support_bot"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue-600 underline underline-offset-2 hover:text-blue-700"
                  >
                    Contact TENH support
                  </a>
                </p>
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
