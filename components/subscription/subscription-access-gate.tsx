"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowRight, Clock3, LockKeyhole, Plug, ShieldCheck } from "lucide-react";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";

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
  isKhmer: boolean,
): LockedCopy {
  if (isKhmer) {
    const trial = planCode === "trial";
    if (reason === "suspended") return {
      eyebrow: "ការចូលប្រើត្រូវបានផ្អាក", title: "កន្លែងធ្វើការនេះត្រូវបានផ្អាក",
      message: "ទាក់ទងផ្នែកជំនួយ TENH មុនពេលចាប់ផ្ដើមការទូទាត់ថ្មី។", statusLabel: "បានផ្អាក",
      noticeTitle: "ទិន្នន័យរបស់អ្នកនៅតែរក្សាទុក", noticeText: "ការផ្អាកការចូលប្រើមិនលុបទិន្នន័យអតិថិជន ឬការសន្ទនារបស់អ្នកទេ។",
      steps: ["ទាក់ទងផ្នែកជំនួយ TENH ដើម្បីពិនិត្យកន្លែងធ្វើការនេះ", "ផ្នែកជំនួយនឹងបញ្ជាក់ជំហានដើម្បីបើកការចូលប្រើឡើងវិញ", "កុំចាប់ផ្ដើមការទូទាត់ថ្មី មុនទទួលការឆ្លើយតបពីផ្នែកជំនួយ"],
    };
    if (reason === "past_due") return {
      eyebrow: "ត្រូវពិនិត្យការទូទាត់", title: "ត្រូវទូទាត់ ដើម្បីចូលប្រើឡើងវិញ",
      message: "ជ្រើសរើសគម្រោង TENH Chat និងរយៈពេលជាវ រួចបំពេញការទូទាត់។", statusLabel: "ហួសកំណត់ទូទាត់",
      noticeTitle: "កន្លែងធ្វើការរបស់អ្នកត្រូវបានការពារ", noticeText: "ការសន្ទនា ទំនាក់ទំនង កំណត់ចំណាំ ស្លាក និងទិន្នន័យក្រុមនៅតែរក្សាទុក ខណៈអ្នកដោះស្រាយការទូទាត់។",
      steps: ["បើកការជាវ ហើយជ្រើសរើសគម្រោង និងរយៈពេលជាវ", "បំពេញការទូទាត់", "ការចូលប្រើនឹងត្រឡប់មកវិញ នៅពេលការទូទាត់ត្រូវបានអនុម័ត"],
    };
    return {
      eyebrow: trial ? "ការសាកល្បងបានបញ្ចប់" : "ការជាវបានផុតកំណត់",
      title: trial ? "ការសាកល្បង ៧ ថ្ងៃរបស់អ្នកបានបញ្ចប់" : "ការជាវនេះបានផុតកំណត់",
      message: "ជ្រើសរើសគម្រោងដើម្បីបន្ត ឬប្ដូរទៅកន្លែងធ្វើការដែលសកម្ម។", statusLabel: "ផុតកំណត់",
      noticeTitle: "កន្លែងធ្វើការរបស់អ្នកមានសុវត្ថិភាព",
      noticeText: trial ? "TENH មិនបានគិតប្រាក់សម្រាប់ការសាកល្បង ហើយក៏មិនគិតប្រាក់ឥឡូវនេះដែរ។ ការសន្ទនា ទំនាក់ទំនង និងការកំណត់នៅតែរក្សាទុកសម្រាប់ពេលអ្នកជាវ។" : "TENH មិនបន្តការជាវ ឬគិតប្រាក់ដោយស្វ័យប្រវត្តិទេ។ ទិន្នន័យរបស់អ្នកនៅតែរក្សាទុក ខណៈអ្នកជ្រើសរើសរយៈពេលជាវបន្ទាប់។",
      steps: trial ? ["ជ្រើសរើសគម្រោង ហើយបំពេញការទូទាត់ដើម្បីចាប់ផ្ដើមការជាវ", "អ្នកអាចភ្ជាប់ Facebook Page ឬ Telegram Bot ទៅការជាវថ្មីភ្លាមៗ", "ការសន្ទនា ទំនាក់ទំនង និងការកំណត់ពីការសាកល្បងនៅតែមាន"] : ["បន្តការជាវ ដើម្បីរក្សាកន្លែងធ្វើការ ឆានែល និងប្រវត្តិ", "ឬប្ដូរទៅកន្លែងធ្វើការផ្សេងតាមប៊ូតុងនៅផ្នែកខាងលើ", "អ្នកអាចភ្ជាប់ Page ឬ Bot ទៅការជាវថ្មីបានភ្លាមៗ"],
    };
  }
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
  const isKhmer = useWorkspaceLanguageId() === "km";
  const text = (en: string, km: string) => isKhmer ? km : en;

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

  const copy = getLockedCopy(access.reason, access.planCode, isKhmer);
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
    <div data-subscription-lock className="h-full overflow-y-auto bg-slate-50 p-3 text-slate-950 [padding-bottom:max(1rem,env(safe-area-inset-bottom))] [padding-left:max(.75rem,env(safe-area-inset-left))] [padding-right:max(.75rem,env(safe-area-inset-right))] sm:p-6 lg:p-10 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto w-full max-w-6xl rounded-3xl border border-blue-100 bg-white px-4 py-6 shadow-[0_12px_48px_rgba(30,64,175,0.06)] sm:px-8 sm:py-8 lg:px-12 dark:border-slate-800 dark:bg-slate-900">
        <section aria-labelledby="subscription-lock-title" className="mx-auto max-w-3xl text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-blue-50 text-blue-600 sm:size-20 dark:bg-blue-950 dark:text-blue-400">
            <span className="relative"><ShieldCheck className="size-9" aria-hidden="true" /><Clock3 className="absolute -bottom-1 -right-1 size-4 rounded-full bg-blue-50 dark:bg-blue-950" aria-hidden="true" /></span>
          </div>
          <p className="mt-4 inline-flex rounded-full bg-amber-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {access.reason === "expired" && wasTrial ? text("Trial ended", "ការសាកល្បងបានបញ្ចប់") : copy.eyebrow}
          </p>
          <h1 id="subscription-lock-title" className="mt-3 break-words text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            {copy.title}
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-slate-500 sm:text-lg dark:text-slate-400">
            {access.reason === "expired" && wasTrial ? text("Choose a plan to continue with TENH CHAT.", "ជ្រើសរើសគម្រោង ដើម្បីបន្តប្រើ TENH CHAT។") : copy.message}
          </p>
          <dl className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-x-8 gap-y-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left sm:mt-8 sm:gap-x-12 dark:border-slate-700 dark:bg-slate-800/50">
            <div className="min-w-0 flex-1 basis-24">
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{text("Plan", "គម្រោង")}</dt>
              <dd className="mt-1 break-words font-semibold">{wasTrial ? text(planLabel, "សាកល្បងឥតគិតថ្លៃ") : planLabel}</dd>
            </div>
            <div className="min-w-0 flex-1 basis-24">
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{text("Status", "ស្ថានភាព")}</dt>
              <dd className="mt-1 flex items-center gap-2 font-semibold"><span className="size-2 shrink-0 rounded-full bg-amber-500" />{copy.statusLabel}</dd>
            </div>
            {endedAt ? <div className="min-w-0 flex-1 basis-28">
              <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{text("Ended", "បានបញ្ចប់")}</dt>
              <dd className="mt-1 font-semibold">{endedAt}</dd>
            </div> : null}
          </dl>
        </section>

        <div className="mt-6 grid gap-5 min-[900px]:grid-cols-2">
          <section aria-labelledby="subscription-actions-title" className="min-w-0 rounded-2xl border border-blue-100 p-5 sm:p-7 min-[900px]:order-2 dark:border-slate-700">
            <h2 id="subscription-actions-title" className="text-xl font-bold">{text("Continue where you left off", "បន្តពីកន្លែងដែលអ្នកបានឈប់")}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{access.reason === "suspended" ? copy.message : text("Choose a subscription to restore access.", "ជ្រើសរើសការជាវ ដើម្បីចូលប្រើឡើងវិញ។")}</p>
            <Link href="/dashboard/subscription" className="mt-5 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-blue-700 px-4 py-3 text-center font-semibold text-white shadow-sm transition hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600">
              {access.reason === "suspended" ? text("View subscription", "មើលការជាវ") : text("Choose a plan", "ជ្រើសរើសគម្រោង")}<ArrowRight className="size-5 shrink-0" aria-hidden="true" />
            </Link>
            <button type="button" onClick={() => {
              const trigger = document.querySelector<HTMLButtonElement>("[data-dashboard-header] [data-dashboard-workspace-switcher] > button");
              if (trigger) {
                trigger.focus();
                if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
              }
            }} className="mt-3 min-h-12 w-full rounded-xl border border-slate-300 px-4 py-3 text-center font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              {text("Switch workspace", "ប្ដូរកន្លែងធ្វើការ")}
            </button>
            {access.reason === "expired" ? <div className="mt-3 flex flex-wrap justify-center gap-x-5">
              <Link href="/dashboard/settings/security" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400"><LockKeyhole className="size-4 shrink-0" aria-hidden="true" />{text("Login & security", "ការចូល និងសុវត្ថិភាព")}</Link>
              {!wasTrial ? <Link href="/dashboard/integrations" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400"><Plug className="size-4" aria-hidden="true" />{text("Channels", "ឆានែល")}</Link> : null}
            </div> : null}
          </section>

          <section aria-labelledby="subscription-data-title" className="min-w-0 rounded-2xl border border-blue-100 p-5 sm:p-7 dark:border-slate-700">
            <div className="flex items-start gap-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"><ShieldCheck className="size-6" aria-hidden="true" /></span>
              <div className="min-w-0"><h2 id="subscription-data-title" className="text-xl font-bold">{copy.noticeTitle}</h2><p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{copy.noticeText}</p></div>
            </div>
            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{text("What happens next", "ជំហានបន្ទាប់")}</h3>
            <ol className="mt-3 space-y-3">
              {copy.steps.map((item, index) => <li key={item} className="flex gap-3 text-sm leading-6 text-slate-600 dark:text-slate-300"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{index + 1}</span><span className="min-w-0 break-words">{item}</span></li>)}
            </ol>
          </section>
        </div>
        <footer className="mt-6 border-t border-slate-200 pt-4 text-center text-xs leading-6 text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <p>{access.reason === "expired" ? text(wasTrial ? "No automatic charge after your trial." : "No automatic renewal or charge.", "មិនមានការគិតប្រាក់ដោយស្វ័យប្រវត្តិទេ។") : text("Your existing workspace data stays preserved while access is paused.", "ទិន្នន័យកន្លែងធ្វើការរបស់អ្នកនៅតែរក្សាទុក ខណៈការចូលប្រើត្រូវបានផ្អាក។")}</p>
          {access.reason === "expired" && !wasTrial ? <p>{text("Cannot reach the workspace holding your Page or Bot?", "មិនអាចចូលកន្លែងធ្វើការដែលភ្ជាប់ Page ឬ Bot របស់អ្នកបាន?")} <a href="https://t.me/tenhchat_support_bot" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded px-1 font-semibold text-blue-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-blue-400">{text("Contact TENH support", "ទាក់ទងផ្នែកជំនួយ TENH")}</a></p> : null}
        </footer>
      </div>
    </div>
  );
}
