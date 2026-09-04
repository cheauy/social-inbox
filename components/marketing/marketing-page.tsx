"use client";

import Image from "next/image";
import { Hanuman, Roboto } from "next/font/google";
import { useState } from "react";

/*
 * The public marketing page.
 *
 * Rendered in two places from this one deployment:
 * - at "/" when the request host is a marketing host (see app/page.tsx),
 *   which is how market.tenhchat.com serves it;
 * - at /dashboard/market, so the team can review it while signed in.
 *
 * It carries its own language switch rather than following the workspace
 * language: a visitor to the public site has no workspace, so the page has
 * to stand on its own.
 *
 * Every person, shop and order shown here is invented sample data, and
 * every feature named has a real route behind it — the placeholder
 * settings pages are deliberately not advertised.
 */

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

const hanuman = Hanuman({
  subsets: ["khmer"],
  weight: ["400", "700"],
  display: "swap",
});

type Lang = "en" | "km";

const TRIAL_DAYS = 7;

const PLAN_MONTHLY_CENTS = {
  standard: 1300,
  team: 2500,
  pro: 5900,
} as const;

/* Mirrors TENH_CUSTOM_PRICING in lib/subscription/plan-catalog.ts. */
const CUSTOM_PRICING = {
  baseMonthlyCents: 1300,
  minChannels: 3,
  maxChannels: 30,
  minUsers: 1,
  maxUsers: 100,
} as const;

const CYCLES = [
  { months: 1, discount: 0 },
  { months: 3, discount: 0.05 },
  { months: 6, discount: 0.1 },
  { months: 12, discount: 0.2 },
];

const BRAND_GRADIENT =
  "bg-[linear-gradient(135deg,#06143A_0%,#0C2C87_46%,#3D1370_100%)]";

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

/* ---------------------------------------------------------------- icons */

type IconName =
  | "plug"
  | "inbox"
  | "team"
  | "bell"
  | "bolt"
  | "chart"
  | "clock"
  | "shield"
  | "users"
  | "lock"
  | "link"
  | "cart"
  | "hanger"
  | "bottle"
  | "food"
  | "box"
  | "headset";

function Icon({
  name,
  className = "h-5 w-5",
}: {
  name: IconName;
  className?: string;
}) {
  const paths: Record<IconName, React.ReactNode> = {
    plug: (
      <>
        <path d="M9 3v6M15 3v6" />
        <path d="M6 9h12v3a6 6 0 0 1-12 0z" />
        <path d="M12 18v3" />
      </>
    ),
    inbox: (
      <>
        <path d="M3 13h5l1.5 2.5h5L16 13h5" />
        <path d="M4.5 6h15l1.5 7v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
        <path d="M16.5 7.5a2.5 2.5 0 0 1 0 5" />
        <path d="M17.5 15a4.5 4.5 0 0 1 3 4" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 6-2.5 6-2.5 8h17C20.5 14 18 14 18 8" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </>
    ),
    bolt: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" />,
    chart: (
      <>
        <path d="M12 3a9 9 0 1 0 9 9h-9z" />
        <path d="M14 3.5A9 9 0 0 1 20.5 10H14z" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5.5l3.5 2" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3 19 6v5.5c0 4.6-2.8 8-7 9.5-4.2-1.5-7-4.9-7-9.5V6z" />
        <path d="m9.5 12 1.8 1.8 3.4-3.8" />
      </>
    ),
    users: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      </>
    ),
    link: (
      <>
        <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 1 0-5.7-5.7l-1.2 1.2" />
        <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 1 0 5.7 5.7l1.2-1.2" />
      </>
    ),
    cart: (
      <>
        <circle cx="9.5" cy="19.5" r="1.4" />
        <circle cx="17" cy="19.5" r="1.4" />
        <path d="M3 4h2.2l2.3 11h11l2-8H6" />
      </>
    ),
    hanger: (
      <>
        <path d="M12 8a2.4 2.4 0 1 1 2.4-2.4" />
        <path d="M12 8v2.6L3.8 16.4A1.5 1.5 0 0 0 4.7 19h14.6a1.5 1.5 0 0 0 .9-2.6L12 10.6" />
      </>
    ),
    bottle: (
      <>
        <path d="M10 3h4v3l1.6 2.2A4 4 0 0 1 16.4 11v8a2 2 0 0 1-2 2H9.6a2 2 0 0 1-2-2v-8a4 4 0 0 1 .8-2.8L10 6z" />
        <path d="M7.6 13h8.8" />
      </>
    ),
    food: (
      <>
        <path d="M6 3v8a2.5 2.5 0 0 0 5 0V3" />
        <path d="M8.5 11v10" />
        <path d="M17.5 3c-1.4 1.4-2 3-2 5.5s.7 3.5 2 3.5V3z" />
        <path d="M17.5 12v9" />
      </>
    ),
    box: (
      <>
        <path d="m12 3 8 4v10l-8 4-8-4V7z" />
        <path d="m4 7 8 4 8-4M12 11v10" />
      </>
    ),
    headset: (
      <>
        <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
        <rect x="2.5" y="13.5" width="4" height="6" rx="1.6" />
        <rect x="17.5" y="13.5" width="4" height="6" rx="1.6" />
        <path d="M20 19.5v.5a3 3 0 0 1-3 3h-2" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function FacebookGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#1877F2" />
      <path
        d="M13.2 19v-6h2l.3-2.3h-2.3V9.2c0-.66.2-1.1 1.1-1.1h1.2V6.1a15 15 0 0 0-1.8-.1c-1.8 0-3 1.1-3 3v1.7H8.7V13h2v6z"
        fill="#fff"
      />
    </svg>
  );
}

function UkFlag() {
  return (
    <svg viewBox="0 0 20 14" className="h-3.5 w-5 rounded-[2px]" aria-hidden="true">
      <rect width="20" height="14" fill="#012169" />
      <path d="M0 0l20 14M20 0L0 14" stroke="#fff" strokeWidth="2.8" />
      <path d="M0 0l20 14M20 0L0 14" stroke="#C8102E" strokeWidth="1.4" />
      <path d="M10 0v14M0 7h20" stroke="#fff" strokeWidth="4.5" />
      <path d="M10 0v14M0 7h20" stroke="#C8102E" strokeWidth="2.6" />
    </svg>
  );
}

function KhFlag() {
  return (
    <svg viewBox="0 0 20 14" className="h-3.5 w-5 rounded-[2px]" aria-hidden="true">
      <rect width="20" height="14" fill="#032EA1" />
      <rect y="3.5" width="20" height="7" fill="#E00025" />
      <g fill="#fff">
        <rect x="7.4" y="8.4" width="5.2" height="1.5" />
        <rect x="9.5" y="4.1" width="1" height="4.3" />
        <rect x="7.7" y="5.6" width="1" height="2.8" />
        <rect x="11.3" y="5.6" width="1" height="2.8" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ copy */

const COPY = {
  en: {
    nav: {
      product: "Product",
      features: "Features",
      pricing: "Pricing",
      help: "Help",
      getStarted: "Get started",
    },
    dir: "Messenger · Comment Facebook · Telegram",
    headline: "Every platform, one inbox.",
    lede:
      "Your customers write from Messenger, Facebook comments and Telegram. TENH puts all of it in one screen, so your team answers everyone from one place and nobody is forgotten.",
    ctaPrimary: `Start ${TRIAL_DAYS}-day free trial`,
    ctaShort: "Start free trial",
    ctaSecondary: "See how it works",
    note: `Free for ${TRIAL_DAYS} days · No card needed to start`,
    sampleBadge: "Sample data",
    channelsLead: "Connect the channels your customers already use",
    availableNow: "Available now",
    comingSoon: "Coming soon",

    stepsTitle: "How TENH works",
    steps: [
      {
        icon: "plug" as IconName,
        title: "Connect your channels",
        body: "Add Messenger, comments and Telegram in a few clicks.",
      },
      {
        icon: "inbox" as IconName,
        title: "Receive everything in TENH",
        body: "All messages and comments appear in one unified inbox.",
      },
      {
        icon: "team" as IconName,
        title: "Reply with your team",
        body: "Collaborate, assign and respond faster from one place.",
      },
    ],

    featuresEyebrow: "Features",
    featuresTitle: "Everything your team needs to answer well.",
    features: [
      {
        icon: "inbox" as IconName,
        title: "Unified inbox",
        body: "All conversations from every channel in one place.",
      },
      {
        icon: "bell" as IconName,
        title: "Never miss a customer",
        body: "Live notifications so no message is left waiting.",
      },
      {
        icon: "team" as IconName,
        title: "Team collaboration",
        body: "Assign, note internally, and resolve together.",
      },
      {
        icon: "bolt" as IconName,
        title: "Fast replies",
        body: "Use saved replies and tags to respond faster.",
      },
      {
        icon: "chart" as IconName,
        title: "Channel visibility",
        body: "See performance and volume across all your channels.",
      },
      {
        icon: "clock" as IconName,
        title: "Customer history",
        body: "Full conversation history and customer profiles.",
      },
    ],

    showcase: [
      {
        tone: "blue" as const,
        title: "Manage messages and comments in one place",
        body: "Stop switching between apps. TENH brings your messages, comments and Telegram chats into a single, clean workspace.",
      },
      {
        tone: "violet" as const,
        title: "Work together with your team",
        body: "Assign conversations, leave internal notes, and keep everyone on the same page to deliver better support.",
      },
      {
        tone: "green" as const,
        title: "Reply faster with organized conversations",
        body: "Use saved replies, tags and saved filters to find what you need and respond in seconds.",
      },
    ],
    labels: {
      inbox: "Inbox",
      assignedTo: "Assigned to",
      teamNotes: "Team notes",
      note: "Customer asked for a delivery date.",
      noteBy: "Added by Maya · 10:24 AM",
      online: "Online",
      away: "Away",
      quickReplies: "Quick replies",
      chips: ["Delivery info", "Refund policy", "Order status"],
      reply: "Thanks! One moment please, I am checking that for you.",
      replyTime: "10:23 AM",
      views: [
        { label: "All conversations", count: "128" },
        { label: "Unread", count: "73" },
        { label: "Mentions", count: "15" },
        { label: "Assigned to me", count: "7" },
      ],
      msgs: [
        { who: "Alex Morgan", text: "Hi! I need help with my recent order.", time: "2m" },
        { who: "Jordan Lee", text: "Where can I view my invoice?", time: "10m" },
      ],
      more: [
        { who: "Sam Rivera", text: "Can I pay on delivery?", time: "1h" },
        { who: "Casey Kim", text: "Do you have a bigger size?", time: "3h" },
      ],
      threadSub: "Comment Facebook · Acme Store",
      open: "Open",
      send: "Send",
    },

    industriesTitle: "Built for modern businesses",
    industries: [
      { icon: "cart" as IconName, label: "Online shops" },
      { icon: "hanger" as IconName, label: "Fashion stores" },
      { icon: "bottle" as IconName, label: "Beauty & salons" },
      { icon: "food" as IconName, label: "Restaurants" },
      { icon: "box" as IconName, label: "Delivery businesses" },
      { icon: "headset" as IconName, label: "Customer support teams" },
    ],

    securityTitle: "Your workspace stays yours",
    security: [
      {
        icon: "shield" as IconName,
        title: "Secure authentication",
        body: "Sign-in is protected, with two-factor available for your account.",
      },
      {
        icon: "users" as IconName,
        title: "Role-based access",
        body: "Control who can view, reply and manage your conversations.",
      },
      {
        icon: "lock" as IconName,
        title: "Workspace permissions",
        body: "Detailed permissions to protect your team and your customers.",
      },
      {
        icon: "link" as IconName,
        title: "Channels you authorize",
        body: "You stay in control of which Pages and Bots are connected.",
      },
    ],

    pricingEyebrow: "Pricing",
    pricingTitle: "Pay for the channels and seats you use.",
    pricingLede:
      "Every plan includes the full inbox — no feature is locked behind a higher plan. Pay for a longer period and the monthly price goes down.",
    cycleLabels: ["1 month", "3 months", "6 months", "1 year"],
    billedOnce: "Paid once",
    billedOnceFor: (total: string, months: number) =>
      `${total} paid once for ${months} months`,
    perMonth: "/mo",
    popular: "Most popular",
    channelsUnit: "channels",
    usersUnit: "users",
    plans: {
      standard: {
        name: "Standard",
        points: [
          "For one seller or a small shop",
          "Full inbox, tags, saved replies",
          "Customer profiles and notes",
        ],
      },
      team: {
        name: "Team",
        points: [
          "For a small team with a few Pages and Bots",
          "Assign conversations between agents",
          "Reports and response times",
        ],
      },
      pro: {
        name: "Pro",
        points: [
          "For a growing support team",
          "Roles and detailed permissions",
          "Priority support",
        ],
      },
    },
    customName: "Custom",
    customTagline: "Build your own size",
    customFrom: "from",
    customPoints: (channels: string, users: string) => [
      `Choose ${channels} channels and ${users} users`,
      "+$4 per extra channel, +$3 per extra user",
      "Same features as Pro",
    ],
    customCta: "Build a plan",
    payNote: "Pay one time to use — no automatic renewal. Prices in USD.",

    faqEyebrow: "Help",
    faqTitle: "Before you start",
    faq: [
      {
        q: `Is the ${TRIAL_DAYS}-day trial really free?`,
        a: `Yes. You get the full TENH inbox free for ${TRIAL_DAYS} days. Nothing is charged during the trial, and it does not turn into a paid plan by itself — you choose a plan when you are ready.`,
      },
      {
        q: "Which channels can I connect?",
        a: "Facebook Messenger, comments on your Facebook Page posts, and Telegram bots. Instagram, WhatsApp and TikTok are coming soon. Each Page or Bot you connect counts as one channel in your plan.",
      },
      {
        q: "Do I pay every month automatically?",
        a: "No. You pay one time for the period you choose — 1 month, 3 months, 6 months or 1 year. There is no automatic renewal, so nothing is taken from you without you deciding.",
      },
      {
        q: "What happens when my plan ends?",
        a: "Your conversations and customer history stay safe. You simply cannot send new replies until you buy another period.",
      },
      {
        q: "Does TENH work in Khmer?",
        a: "Yes. The whole workspace switches between English and Khmer, and each teammate can choose their own language.",
      },
      {
        q: "Can my team work in the same inbox at the same time?",
        a: "Yes. Each conversation shows who is answering it, and everyone sees changes immediately, so two agents never reply to the same customer.",
      },
      {
        q: "Can I change my plan later?",
        a: "Yes. You can move to a bigger plan at any time, and you only pay the difference for the time that is left.",
      },
      {
        q: "What if I need more channels or agents than a plan gives?",
        a: "Use the Custom plan. You choose exactly how many channels and users you need, and the price is calculated from that.",
      },
      {
        q: "Can my customers tell I am using TENH?",
        a: "No. Your replies arrive in Messenger, Facebook or Telegram exactly like a normal message from your Page or Bot.",
      },
      {
        q: "Who can see my customer conversations?",
        a: "Only the people you invite to your workspace. You control what each role is allowed to open using roles and permissions.",
      },
    ],

    closerTitle: "Stop losing customers in three different apps.",
    closerBody: `Connect your first Page or Bot in a few minutes. Free for ${TRIAL_DAYS} days.`,
    footerTag: "One inbox. Every conversation.",
  },

  km: {
    nav: {
      product: "ផលិតផល",
      features: "មុខងារ",
      pricing: "តម្លៃ",
      help: "ជំនួយ",
      getStarted: "ចាប់ផ្តើម",
    },
    dir: "Messenger · Comment Facebook · Telegram",
    headline: "គ្រប់វេទិកា ក្នុងប្រអប់សារតែមួយ។",
    lede:
      "អតិថិជនរបស់អ្នកសរសេរមកពី Messenger, មតិលើ Facebook និង Telegram។ TENH ដាក់ទាំងអស់នៅលើអេក្រង់តែមួយ ដើម្បីឱ្យក្រុមរបស់អ្នកឆ្លើយគ្រប់គ្នាពីកន្លែងតែមួយ ហើយគ្មាននរណាត្រូវបានភ្លេច។",
    ctaPrimary: `សាកល្បងឥតគិតថ្លៃ ${TRIAL_DAYS} ថ្ងៃ`,
    ctaShort: "សាកល្បងឥតគិតថ្លៃ",
    ctaSecondary: "មើលរបៀបប្រើប្រាស់",
    note: `ឥតគិតថ្លៃ ${TRIAL_DAYS} ថ្ងៃ · មិនចាំបាច់ប្រើកាតដើម្បីចាប់ផ្តើម`,
    sampleBadge: "ទិន្នន័យគំរូ",
    channelsLead: "ភ្ជាប់ឆានែលដែលអតិថិជនរបស់អ្នកកំពុងប្រើ",
    availableNow: "មានឥឡូវនេះ",
    comingSoon: "នឹងមកដល់ឆាប់ៗ",

    stepsTitle: "របៀបដែល TENH ដំណើរការ",
    steps: [
      {
        icon: "plug" as IconName,
        title: "ភ្ជាប់ឆានែលរបស់អ្នក",
        body: "បន្ថែម Messenger មតិយោបល់ និង Telegram ក្នុងការចុចពីរបីដង។",
      },
      {
        icon: "inbox" as IconName,
        title: "ទទួលអ្វីៗទាំងអស់ក្នុង TENH",
        body: "សារ និងមតិទាំងអស់បង្ហាញក្នុងប្រអប់សាររួមតែមួយ។",
      },
      {
        icon: "team" as IconName,
        title: "ឆ្លើយតបជាមួយក្រុម",
        body: "សហការ ចាត់តាំង និងឆ្លើយបានលឿនជាងពីកន្លែងតែមួយ។",
      },
    ],

    featuresEyebrow: "មុខងារ",
    featuresTitle: "គ្រប់យ៉ាងដែលក្រុមរបស់អ្នកត្រូវការដើម្បីឆ្លើយបានល្អ។",
    features: [
      {
        icon: "inbox" as IconName,
        title: "ប្រអប់សាររួម",
        body: "ការសន្ទនាទាំងអស់ពីគ្រប់ឆានែល នៅកន្លែងតែមួយ។",
      },
      {
        icon: "bell" as IconName,
        title: "មិនខកខានអតិថិជន",
        body: "ការជូនដំណឹងផ្ទាល់ ដូច្នេះគ្មានសារណាត្រូវរង់ចាំ។",
      },
      {
        icon: "team" as IconName,
        title: "សហការជាក្រុម",
        body: "ចាត់តាំង ដាក់កំណត់ចំណាំផ្ទៃក្នុង និងដោះស្រាយរួមគ្នា។",
      },
      {
        icon: "bolt" as IconName,
        title: "ឆ្លើយតបរហ័ស",
        body: "ប្រើចម្លើយរក្សាទុក និងស្លាកដើម្បីឆ្លើយបានលឿន។",
      },
      {
        icon: "chart" as IconName,
        title: "មើលឃើញឆានែល",
        body: "មើលលទ្ធផល និងបរិមាណសារលើគ្រប់ឆានែលរបស់អ្នក។",
      },
      {
        icon: "clock" as IconName,
        title: "ប្រវត្តិអតិថិជន",
        body: "ប្រវត្តិការសន្ទនាពេញលេញ និងប្រវត្តិរូបអតិថិជន។",
      },
    ],

    showcase: [
      {
        tone: "blue" as const,
        title: "គ្រប់គ្រងសារ និងមតិនៅកន្លែងតែមួយ",
        body: "ឈប់ប្តូរកម្មវិធីទៅមក។ TENH នាំសារ មតិយោបល់ និងការជជែក Telegram មកក្នុងកន្លែងធ្វើការតែមួយ។",
      },
      {
        tone: "violet" as const,
        title: "ធ្វើការរួមគ្នាជាមួយក្រុមរបស់អ្នក",
        body: "ចាត់តាំងការសន្ទនា ទុកកំណត់ចំណាំផ្ទៃក្នុង និងឱ្យអ្នកគ្រប់គ្នាដឹងព័ត៌មានដូចគ្នា ដើម្បីបម្រើបានល្អជាង។",
      },
      {
        tone: "green" as const,
        title: "ឆ្លើយលឿនជាងមុនដោយការរៀបចំល្អ",
        body: "ប្រើចម្លើយរក្សាទុក ស្លាក និងតម្រង ដើម្បីរកអ្វីដែលត្រូវការ ហើយឆ្លើយក្នុងរយៈពេលប៉ុន្មានវិនាទី។",
      },
    ],
    labels: {
      inbox: "ប្រអប់សារ",
      assignedTo: "ចាត់តាំងឱ្យ",
      teamNotes: "កំណត់ចំណាំក្រុម",
      note: "អតិថិជនសួររកកាលបរិច្ឆេទដឹកជញ្ជូន។",
      noteBy: "ដាក់ដោយ Maya · ១០:២៤",
      online: "នៅលើបណ្តាញ",
      away: "មិននៅ",
      quickReplies: "ចម្លើយរហ័ស",
      chips: ["ព័ត៌មានដឹកជញ្ជូន", "គោលការណ៍សងប្រាក់", "ស្ថានភាពកម្ម៉ង់"],
      reply: "អរគុណ! សូមរង់ចាំមួយភ្លែត ខ្ញុំកំពុងពិនិត្យជូន។",
      replyTime: "១០:២៣",
      views: [
        { label: "ការសន្ទនាទាំងអស់", count: "128" },
        { label: "មិនទាន់អាន", count: "73" },
        { label: "ការនិយាយឈ្មោះ", count: "15" },
        { label: "ចាត់តាំងឱ្យខ្ញុំ", count: "7" },
      ],
      msgs: [
        { who: "Alex Morgan", text: "សួស្តី! ខ្ញុំត្រូវការជំនួយអំពីកម្ម៉ង់ថ្មី។", time: "2m" },
        { who: "Jordan Lee", text: "តើខ្ញុំមើលវិក្កយបត្រនៅឯណា?", time: "10m" },
      ],
      more: [
        { who: "Sam Rivera", text: "តើបង់ពេលដឹកជញ្ជូនបានទេ?", time: "1h" },
        { who: "Casey Kim", text: "តើមានទំហំធំជាងនេះទេ?", time: "3h" },
      ],
      threadSub: "Comment Facebook · Acme Store",
      open: "បើក",
      send: "ផ្ញើ",
    },

    industriesTitle: "សាងសម្រាប់អាជីវកម្មសម័យថ្មី",
    industries: [
      { icon: "cart" as IconName, label: "ហាងលក់អនឡាញ" },
      { icon: "hanger" as IconName, label: "ហាងសំលៀកបំពាក់" },
      { icon: "bottle" as IconName, label: "សម្រស់ និងហាងកាត់សក់" },
      { icon: "food" as IconName, label: "ភោជនីយដ្ឋាន" },
      { icon: "box" as IconName, label: "អាជីវកម្មដឹកជញ្ជូន" },
      { icon: "headset" as IconName, label: "ក្រុមគាំទ្រអតិថិជន" },
    ],

    securityTitle: "កន្លែងធ្វើការរបស់អ្នក នៅជារបស់អ្នក",
    security: [
      {
        icon: "shield" as IconName,
        title: "ការចូលគណនីមានសុវត្ថិភាព",
        body: "ការចូលគណនីត្រូវបានការពារ ហើយមានការផ្ទៀងផ្ទាត់ពីរជាន់សម្រាប់គណនីរបស់អ្នក។",
      },
      {
        icon: "users" as IconName,
        title: "សិទ្ធិតាមតួនាទី",
        body: "គ្រប់គ្រងថានរណាអាចមើល ឆ្លើយ និងគ្រប់គ្រងការសន្ទនារបស់អ្នក។",
      },
      {
        icon: "lock" as IconName,
        title: "សិទ្ធិកន្លែងធ្វើការ",
        body: "សិទ្ធិលម្អិត ដើម្បីការពារក្រុម និងអតិថិជនរបស់អ្នក។",
      },
      {
        icon: "link" as IconName,
        title: "ឆានែលដែលអ្នកអនុញ្ញាត",
        body: "អ្នកគ្រប់គ្រងថា Page និង Bot ណាខ្លះត្រូវបានភ្ជាប់។",
      },
    ],

    pricingEyebrow: "តម្លៃ",
    pricingTitle: "បង់ថ្លៃតាមឆានែល និងចំនួនអ្នកប្រើដែលអ្នកប្រើពិត។",
    pricingLede:
      "គ្រប់គម្រោងមានប្រអប់សារពេញលេញ — គ្មានមុខងារណាត្រូវចាក់សោសម្រាប់តែគម្រោងខ្ពស់ទេ។ បង់សម្រាប់រយៈពេលវែងជាង តម្លៃក្នុងមួយខែកាន់តែទាប។",
    cycleLabels: ["១ ខែ", "៣ ខែ", "៦ ខែ", "១ ឆ្នាំ"],
    billedOnce: "បង់ម្តង",
    billedOnceFor: (total: string, months: number) =>
      `${total} បង់ម្តងសម្រាប់ ${months} ខែ`,
    perMonth: "/ខែ",
    popular: "ពេញនិយមបំផុត",
    channelsUnit: "ឆានែល",
    usersUnit: "អ្នកប្រើ",
    plans: {
      standard: {
        name: "Standard",
        points: [
          "សម្រាប់អ្នកលក់ម្នាក់ ឬហាងតូច",
          "ប្រអប់សារពេញលេញ ស្លាក ចម្លើយរក្សាទុក",
          "ប្រវត្តិរូប និងកំណត់ចំណាំអតិថិជន",
        ],
      },
      team: {
        name: "Team",
        points: [
          "សម្រាប់ក្រុមតូចដែលមាន Page និង Bot ខ្លះ",
          "ចាត់តាំងការសន្ទនារវាងភ្នាក់ងារ",
          "របាយការណ៍ និងល្បឿនឆ្លើយតប",
        ],
      },
      pro: {
        name: "Pro",
        points: [
          "សម្រាប់ក្រុមគាំទ្រដែលកំពុងរីកចម្រើន",
          "តួនាទី និងសិទ្ធិលម្អិត",
          "ការគាំទ្រអាទិភាព",
        ],
      },
    },
    customName: "Custom",
    customTagline: "បង្កើតទំហំតាមតម្រូវការ",
    customFrom: "ចាប់ពី",
    customPoints: (channels: string, users: string) => [
      `ជ្រើសរើស ${channels} ឆានែល និង ${users} អ្នកប្រើ`,
      "+$4 ក្នុងមួយឆានែលបន្ថែម, +$3 ក្នុងមួយអ្នកប្រើបន្ថែម",
      "មុខងារដូច Pro",
    ],
    customCta: "បង្កើតគម្រោង",
    payNote: "បង់ម្តងដើម្បីប្រើ — គ្មានការបន្តដោយស្វ័យប្រវត្តិទេ។ តម្លៃជាដុល្លារ។",

    faqEyebrow: "ជំនួយ",
    faqTitle: "មុននឹងចាប់ផ្តើម",
    faq: [
      {
        q: `តើការសាកល្បង ${TRIAL_DAYS} ថ្ងៃ ឥតគិតថ្លៃមែនទេ?`,
        a: `មែន។ អ្នកទទួលបានប្រអប់សារ TENH ពេញលេញឥតគិតថ្លៃរយៈពេល ${TRIAL_DAYS} ថ្ងៃ។ គ្មានការគិតលុយក្នុងអំឡុងសាកល្បង ហើយវាមិនប្តូរទៅជាគម្រោងបង់ប្រាក់ដោយខ្លួនឯងទេ។`,
      },
      {
        q: "តើខ្ញុំអាចភ្ជាប់ឆានែលអ្វីខ្លះ?",
        a: "Facebook Messenger, មតិលើ Facebook Page របស់អ្នក និង Telegram Bot។ Instagram, WhatsApp និង TikTok នឹងមកដល់ឆាប់ៗ។ រាល់ Page ឬ Bot ដែលភ្ជាប់ រាប់ជាមួយឆានែលក្នុងគម្រោង។",
      },
      {
        q: "តើខ្ញុំត្រូវបង់ប្រាក់រៀងរាល់ខែដោយស្វ័យប្រវត្តិទេ?",
        a: "ទេ។ អ្នកបង់ម្តងសម្រាប់រយៈពេលដែលអ្នកជ្រើសរើស — ១ ខែ ៣ ខែ ៦ ខែ ឬ ១ ឆ្នាំ។ គ្មានការបន្តដោយស្វ័យប្រវត្តិទេ។",
      },
      {
        q: "តើមានអ្វីកើតឡើងពេលគម្រោងរបស់ខ្ញុំផុតកំណត់?",
        a: "ការសន្ទនា និងប្រវត្តិអតិថិជនរបស់អ្នកនៅដដែល។ គ្រាន់តែអ្នកមិនអាចផ្ញើសារឆ្លើយថ្មីទេ រហូតដល់អ្នកទិញរយៈពេលបន្ថែម។",
      },
      {
        q: "តើ TENH ប្រើជាភាសាខ្មែរបានទេ?",
        a: "បាទ/ចាស។ កន្លែងធ្វើការទាំងមូលប្តូររវាងភាសាអង់គ្លេស និងភាសាខ្មែរ ហើយសមាជិកម្នាក់ៗអាចជ្រើសរើសភាសាផ្ទាល់ខ្លួន។",
      },
      {
        q: "តើក្រុមរបស់ខ្ញុំធ្វើការក្នុងប្រអប់សារតែមួយព្រមគ្នាបានទេ?",
        a: "បាទ/ចាស។ រាល់ការសន្ទនាបង្ហាញថានរណាកំពុងឆ្លើយ ហើយអ្នកគ្រប់គ្នាឃើញការផ្លាស់ប្តូរភ្លាមៗ ដូច្នេះគ្មានភ្នាក់ងារពីរនាក់ឆ្លើយអតិថិជនតែម្នាក់ទេ។",
      },
      {
        q: "តើខ្ញុំអាចប្តូរគម្រោងពេលក្រោយបានទេ?",
        a: "បាទ/ចាស។ អ្នកអាចប្តូរទៅគម្រោងធំជាងបានគ្រប់ពេល ហើយបង់តែផ្នែកខុសគ្នាសម្រាប់រយៈពេលដែលនៅសល់។",
      },
      {
        q: "បើខ្ញុំត្រូវការឆានែល ឬភ្នាក់ងារច្រើនជាងគម្រោងផ្តល់ឱ្យ?",
        a: "ប្រើគម្រោង Custom។ អ្នកជ្រើសរើសចំនួនឆានែល និងអ្នកប្រើតាមតម្រូវការ ហើយតម្លៃគណនាតាមនោះ។",
      },
      {
        q: "តើអតិថិជនដឹងទេថាខ្ញុំកំពុងប្រើ TENH?",
        a: "ទេ។ សារឆ្លើយតបរបស់អ្នកទៅដល់ Messenger, Facebook ឬ Telegram ដូចសារធម្មតាពី Page ឬ Bot របស់អ្នក។",
      },
      {
        q: "តើនរណាអាចមើលការសន្ទនាអតិថិជនរបស់ខ្ញុំ?",
        a: "មានតែអ្នកដែលអ្នកអញ្ជើញចូលកន្លែងធ្វើការប៉ុណ្ណោះ។ អ្នកគ្រប់គ្រងបានថាតួនាទីនីមួយៗអាចបើកអ្វីខ្លះ។",
      },
    ],

    closerTitle: "ឈប់បាត់បង់អតិថិជននៅក្នុងកម្មវិធីបីផ្សេងគ្នា។",
    closerBody: `ភ្ជាប់ Page ឬ Bot ដំបូងក្នុងរយៈពេលពីរបីនាទី។ ឥតគិតថ្លៃ ${TRIAL_DAYS} ថ្ងៃ។`,
    footerTag: "ប្រអប់សារតែមួយ។ គ្រប់ការសន្ទនា។",
  },
} as const;

type Labels = (typeof COPY)["en"]["labels"] | (typeof COPY)["km"]["labels"];

const LIVE_CHANNELS = [
  { src: "/images/channels/messenger.png", label: "Messenger" },
  { src: null, label: "Comment Facebook" },
  { src: "/images/channels/telegram.png", label: "Telegram" },
];

const SOON_CHANNELS = [
  { src: "/images/channels/instagram.png", label: "Instagram" },
  { src: "/images/channels/whatsapp.png", label: "WhatsApp" },
  { src: "/images/channels/tiktok.png", label: "TikTok" },
];

const SHOWCASE_TONES = {
  blue: "bg-blue-50/70",
  violet: "bg-violet-50/70",
  green: "bg-emerald-50/60",
} as const;

/* ------------------------------------------------------------------ page */

export function MarketingPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [cycleIndex, setCycleIndex] = useState(0);

  const t = COPY[lang];
  const cycle = CYCLES[cycleIndex];
  const L: Labels = t.labels;

  function priceFor(monthlyCents: number) {
    const total = Math.round(
      monthlyCents * cycle.months * (1 - cycle.discount),
    );
    const perMonth = Math.round(total / cycle.months);

    return {
      perMonth: money(perMonth),
      billed:
        cycle.months === 1
          ? t.billedOnce
          : t.billedOnceFor(money(total), cycle.months),
    };
  }

  const plans = [
    {
      key: "standard" as const,
      copy: t.plans.standard,
      cents: PLAN_MONTHLY_CENTS.standard,
      channels: 3,
      users: 1,
      featured: false,
    },
    {
      key: "team" as const,
      copy: t.plans.team,
      cents: PLAN_MONTHLY_CENTS.team,
      channels: 5,
      users: 3,
      featured: true,
    },
    {
      key: "pro" as const,
      copy: t.plans.pro,
      cents: PLAN_MONTHLY_CENTS.pro,
      channels: 12,
      users: 8,
      featured: false,
    },
  ];

  const customPrice = priceFor(CUSTOM_PRICING.baseMonthlyCents);
  const customPoints = t.customPoints(
    `${CUSTOM_PRICING.minChannels}–${CUSTOM_PRICING.maxChannels}`,
    `${CUSTOM_PRICING.minUsers}–${CUSTOM_PRICING.maxUsers}`,
  );

  /*
   * Khmer sets in Hanuman, English in Roboto. Applied on the root so every
   * descendant follows the chosen language rather than the workspace font.
   */
  const fontClass = lang === "km" ? hanuman.className : roboto.className;

  return (
    <div className={`bg-white ${fontClass}`}>
      {/* ---------- top bar ---------- */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
          <a href="#top" className="flex shrink-0 items-center gap-2.5">
            <Image
              src="/images/tenh_logo.png"
              alt="Tenh Chat"
              width={44}
              height={44}
              className="h-9 w-9 object-contain"
            />
            <span className="hidden sm:block">
              <span className="block text-[15px] font-bold leading-tight text-slate-950">
                Tenh Chat
              </span>
              <span className="block text-[11px] text-slate-500">
                Customer messaging
              </span>
            </span>
          </a>

          <nav className="ml-6 hidden items-center gap-1 lg:flex">
            {[
              { label: t.nav.product, href: "#product" },
              { label: t.nav.features, href: "#features" },
              { label: t.nav.pricing, href: "#pricing" },
              { label: t.nav.help, href: "#help" },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setLang("en")}
                aria-pressed={lang === "en"}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                  lang === "en"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <UkFlag />
                <span className="hidden sm:inline">English</span>
              </button>
              <button
                type="button"
                onClick={() => setLang("km")}
                aria-pressed={lang === "km"}
                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                  lang === "km"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <KhFlag />
                <span className="hidden sm:inline">ខ្មែរ</span>
              </button>
            </div>

            <a
              href="/register"
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              {t.nav.getStarted}
            </a>
          </div>
        </div>
      </div>

      {/* ---------- hero ---------- */}
      <section
        id="top"
        className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-14 lg:grid-cols-[0.9fr_1.1fr]"
      >
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {t.dir}
          </p>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.12] tracking-tight text-slate-950 lg:text-5xl">
            {t.headline}
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-7 text-slate-600">
            {t.lede}
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href="/register"
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              {t.ctaPrimary}
            </a>
            <a
              href="#features"
              className="rounded-xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
            >
              {t.ctaSecondary}
            </a>
          </div>

          <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            {t.note}
          </p>
        </div>

        <div className="relative">
          <span className="absolute -top-2.5 right-3 z-10 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
            {t.sampleBadge}
          </span>
          <InboxMock labels={L} />
        </div>
      </section>

      {/* ---------- channels ---------- */}
      <section id="product" className="border-y border-slate-200 bg-slate-50/60">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-center text-sm text-slate-500">{t.channelsLead}</p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
              {t.availableNow}
            </span>

            {LIVE_CHANNELS.map((channel) => (
              <span
                key={channel.label}
                className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm"
              >
                {channel.src ? (
                  <Image
                    src={channel.src}
                    alt=""
                    width={22}
                    height={22}
                    className="h-5 w-5 object-contain"
                  />
                ) : (
                  <FacebookGlyph />
                )}
                {channel.label}
              </span>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700">
              {t.comingSoon}
            </span>

            {SOON_CHANNELS.map((channel) => (
              <span
                key={channel.label}
                className="flex items-center gap-2.5 rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-2.5 text-sm font-medium text-slate-400"
              >
                <Image
                  src={channel.src}
                  alt=""
                  width={22}
                  height={22}
                  className="h-5 w-5 object-contain opacity-55 grayscale"
                />
                {channel.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-center text-2xl font-bold tracking-tight text-slate-950">
          {t.stepsTitle}
        </h2>

        <ol className="mt-9 grid gap-x-8 gap-y-8 md:grid-cols-3">
          {t.steps.map((step, index) => (
            <li key={step.title} className="relative flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-extrabold text-blue-700">
                {index + 1}
              </span>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
                <Icon name={step.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold text-slate-900">
                  {step.title}
                </span>
                <span className="mt-1 block text-[13px] leading-6 text-slate-500">
                  {step.body}
                </span>
              </span>

              {/* Connector, wide screens only. */}
              {index < t.steps.length - 1 ? (
                <span
                  className="absolute -right-5 top-4.5 hidden w-7 border-t-2 border-dotted border-slate-300 md:block"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- feature cards ---------- */}
      <section id="features" className="mx-auto max-w-6xl px-6 pb-14">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {t.featuresEyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
            {t.featuresTitle}
          </h2>
        </div>

        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-6 text-center transition hover:border-slate-300 hover:shadow-sm"
            >
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Icon name={feature.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-[15px] font-bold text-slate-900">
                {feature.title}
              </h3>
              <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-6 text-slate-500">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- pricing ---------- */}
      <section id="pricing" className={`${BRAND_GRADIENT} py-16 text-white`}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/55">
              {t.pricingEyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              {t.pricingTitle}
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-white/70">
              {t.pricingLede}
            </p>
          </div>

          <div className="mt-7 inline-flex flex-wrap gap-1 rounded-xl border border-white/15 bg-white/10 p-1">
            {CYCLES.map((item, index) => (
              <button
                key={item.months}
                type="button"
                onClick={() => setCycleIndex(index)}
                aria-pressed={cycleIndex === index}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  cycleIndex === index
                    ? "bg-white text-slate-950"
                    : "text-white/70 hover:text-white"
                }`}
              >
                {t.cycleLabels[index]}
                {item.discount > 0 ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      cycleIndex === index
                        ? "bg-[#FFE7CC] text-[#B24A00]"
                        : "bg-[#FF7A00]/25 text-[#FFB877]"
                    }`}
                  >
                    -{Math.round(item.discount * 100)}%
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const price = priceFor(plan.cents);

              return (
                <div
                  key={plan.key}
                  className={`flex flex-col rounded-2xl border p-6 ${
                    plan.featured
                      ? "border-white bg-white text-slate-950 shadow-xl"
                      : "border-white/15 bg-white/10"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold">{plan.copy.name}</span>
                    {plan.featured ? (
                      <span className="rounded-full bg-[#FFE7CC] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#B24A00]">
                        {t.popular}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-3 text-4xl font-extrabold tabular-nums tracking-tight">
                    {price.perMonth}
                    <span
                      className={`ml-1 text-sm font-medium ${
                        plan.featured ? "text-slate-500" : "text-white/65"
                      }`}
                    >
                      {t.perMonth}
                    </span>
                  </p>

                  <p
                    className={`mt-1.5 min-h-5 text-xs ${
                      plan.featured ? "text-slate-500" : "text-white/65"
                    }`}
                  >
                    {price.billed}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums ${
                        plan.featured ? "bg-slate-100" : "bg-white/15"
                      }`}
                    >
                      {plan.channels} {t.channelsUnit}
                    </span>
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums ${
                        plan.featured ? "bg-slate-100" : "bg-white/15"
                      }`}
                    >
                      {plan.users} {t.usersUnit}
                    </span>
                  </div>

                  <ul
                    className={`mt-4 flex flex-1 flex-col gap-2 text-sm ${
                      plan.featured ? "text-slate-600" : "text-white/70"
                    }`}
                  >
                    {plan.copy.points.map((point) => (
                      <li key={point} className="flex gap-2.5">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
                        {point}
                      </li>
                    ))}
                  </ul>

                  <a
                    href="/register"
                    className={`mt-6 rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition ${
                      plan.featured
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "border border-white/25 text-white hover:border-white/50"
                    }`}
                  >
                    {t.ctaShort}
                  </a>
                </div>
              );
            })}

            <div className="flex flex-col rounded-2xl border border-dashed border-white/25 bg-white/10 p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold">{t.customName}</span>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {t.customTagline}
                </span>
              </div>

              <p className="mt-3 text-4xl font-extrabold tabular-nums tracking-tight">
                <span className="mr-1 align-middle text-sm font-medium text-white/65">
                  {t.customFrom}
                </span>
                {customPrice.perMonth}
                <span className="ml-1 text-sm font-medium text-white/65">
                  {t.perMonth}
                </span>
              </p>

              <p className="mt-1.5 min-h-5 text-xs text-white/65">
                {customPrice.billed}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold tabular-nums">
                  {CUSTOM_PRICING.minChannels}–{CUSTOM_PRICING.maxChannels}{" "}
                  {t.channelsUnit}
                </span>
                <span className="rounded-lg bg-white/15 px-2.5 py-1 text-xs font-semibold tabular-nums">
                  {CUSTOM_PRICING.minUsers}–{CUSTOM_PRICING.maxUsers}{" "}
                  {t.usersUnit}
                </span>
              </div>

              <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-white/70">
                {customPoints.map((point) => (
                  <li key={point} className="flex gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
                    {point}
                  </li>
                ))}
              </ul>

              <a
                href="/register"
                className="mt-6 rounded-xl border border-white/25 px-4 py-2.5 text-center text-sm font-semibold text-white transition hover:border-white/50"
              >
                {t.customCta}
              </a>
            </div>
          </div>

          <p className="mt-6 text-sm text-white/70">{t.payNote}</p>
        </div>
      </section>

      {/* ---------- help / faq ---------- */}
      <section id="help" className="mx-auto max-w-6xl px-6 py-16">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
          {t.faqEyebrow}
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
          {t.faqTitle}
        </h2>

        <div className="mt-7 max-w-3xl">
          {t.faq.map((item, index) => (
            <details
              key={item.q}
              open={index === 0}
              className="border-b border-slate-200 py-1"
            >
              <summary className="cursor-pointer list-none py-3.5 text-[15px] font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                {item.q}
              </summary>
              <p className="pb-4 text-sm leading-7 text-slate-600">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------- showcase bands ---------- */}
      <section className="mx-auto flex max-w-6xl flex-col gap-4 px-6 pb-16">
        <ShowcaseBand
          tone={t.showcase[0].tone}
          title={t.showcase[0].title}
          body={t.showcase[0].body}
          media={
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="border-b border-slate-100 pb-2 text-[11px] font-bold text-slate-500">
                {L.inbox}
              </p>
              {L.msgs.map((m) => (
                <div key={m.who} className="flex items-start gap-2.5 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                    {m.who.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-900">
                        {m.who}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-400">
                        {m.time}
                      </span>
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {m.text}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          }
          aside={
            <div className="flex flex-col items-center gap-2.5">
              <div className="flex gap-3">
                {LIVE_CHANNELS.map((channel) =>
                  channel.src ? (
                    <Image
                      key={channel.label}
                      src={channel.src}
                      alt=""
                      width={34}
                      height={34}
                      className="h-8 w-8 object-contain"
                    />
                  ) : (
                    <FacebookGlyph key={channel.label} className="h-8 w-8" />
                  ),
                )}
              </div>
              <span className="h-6 border-l-2 border-dotted border-blue-300" />
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-md">
                <Icon name="inbox" className="h-6 w-6" />
              </span>
            </div>
          }
        />

        <ShowcaseBand
          tone={t.showcase[1].tone}
          title={t.showcase[1].title}
          body={t.showcase[1].body}
          reverse
          media={
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <p className="text-[11px] font-bold text-slate-500">
                {L.assignedTo}
              </p>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
                  M
                </span>
                <span className="text-[12px] font-semibold text-slate-900">
                  Maya Chan
                </span>
              </div>

              <p className="mt-3 text-[11px] font-bold text-slate-500">
                {L.teamNotes}
              </p>
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
                <p className="text-[11px] leading-5 text-slate-700">{L.note}</p>
                <p className="mt-1 text-[10px] text-slate-500">{L.noteBy}</p>
              </div>
            </div>
          }
          aside={
            <div className="flex w-full max-w-[190px] flex-col gap-2">
              {[
                { name: "Maya Chan", state: L.online, tone: "bg-emerald-500" },
                { name: "Ben Sok", state: L.online, tone: "bg-emerald-500" },
                { name: "Dara Pen", state: L.away, tone: "bg-amber-500" },
              ].map((member) => (
                <div
                  key={member.name}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">
                    {member.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-semibold text-slate-900">
                      {member.name}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                      <span className={`h-1.5 w-1.5 rounded-full ${member.tone}`} />
                      {member.state}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          }
        />

        <ShowcaseBand
          tone={t.showcase[2].tone}
          title={t.showcase[2].title}
          body={t.showcase[2].body}
          media={
            <div className="flex flex-col gap-3">
              <div className="self-end rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-[12px] leading-5 text-white shadow-sm">
                {L.reply}
                <span className="mt-1 block text-right text-[9px] text-blue-100">
                  {L.replyTime} ✓✓
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-[11px] font-bold text-slate-500">
                  {L.quickReplies}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {L.chips.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          }
          aside={
            <div className="w-full max-w-[230px] rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
              {L.views.map((view, index) => (
                <div
                  key={view.label}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 ${
                    index === 1 ? "bg-blue-50 text-blue-700" : "text-slate-600"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      index === 1 ? "bg-blue-600" : "bg-slate-300"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
                    {view.label}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums">
                    {view.count}
                  </span>
                </div>
              ))}
            </div>
          }
        />
      </section>

      {/* ---------- industries ---------- */}
      <section className="border-y border-slate-200 bg-slate-50/60">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="text-center text-2xl font-bold tracking-tight text-slate-950">
            {t.industriesTitle}
          </h2>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {t.industries.map((industry) => (
              <div
                key={industry.label}
                className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-5 text-center"
              >
                <span className="text-slate-500">
                  <Icon name={industry.icon} className="h-6 w-6" />
                </span>
                <span className="text-[12px] font-bold leading-5 text-slate-800">
                  {industry.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- security ---------- */}
      <section className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-center text-2xl font-bold tracking-tight text-slate-950">
          {t.securityTitle}
        </h2>

        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {t.security.map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold text-slate-900">
                  {item.title}
                </span>
                <span className="mt-1 block text-[12.5px] leading-6 text-slate-500">
                  {item.body}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- closer ---------- */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div
          className={`flex flex-wrap items-center gap-6 rounded-2xl ${BRAND_GRADIENT} px-8 py-10 text-white`}
        >
          <div className="min-w-64 flex-1">
            <h2 className="text-2xl font-bold leading-snug tracking-tight">
              {t.closerTitle}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-7 text-white/75">
              {t.closerBody}
            </p>
          </div>
          <a
            href="/register"
            className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-[#0C2C87] transition hover:bg-blue-50"
          >
            {t.ctaPrimary}
          </a>
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-8 text-xs text-slate-400">
          <span className="font-semibold text-slate-600">
            TENH — {t.footerTag}
          </span>
          <span className="ml-auto flex flex-wrap gap-5">
            <a href="/privacy" className="hover:text-slate-700">Privacy</a>
            <a href="/terms" className="hover:text-slate-700">Terms</a>
            <a href="/data-deletion" className="hover:text-slate-700">Data deletion</a>
            <span>© {new Date().getFullYear()} TENH</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ---------------------------------------------------------- showcase band */

function ShowcaseBand({
  tone,
  title,
  body,
  media,
  aside,
  reverse = false,
}: {
  tone: keyof typeof SHOWCASE_TONES;
  title: string;
  body: string;
  media: React.ReactNode;
  aside: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <div
      className={`grid items-center gap-7 rounded-2xl ${SHOWCASE_TONES[tone]} px-6 py-8 md:px-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]`}
    >
      <div className={reverse ? "lg:order-2" : ""}>{media}</div>

      <div className={reverse ? "lg:order-1" : ""}>
        <h3 className="text-xl font-bold leading-snug tracking-tight text-slate-950">
          {title}
        </h3>
        <p className="mt-2.5 max-w-md text-[13.5px] leading-6 text-slate-600">
          {body}
        </p>
      </div>

      <div className="flex justify-center lg:order-3">{aside}</div>
    </div>
  );
}

/* -------------------------------------------------------------- hero mock */

/*
 * A simplified view of the real TENH inbox: the same columns and shapes
 * people see after signing in, with fewer details and larger text so it
 * stays readable at this size. All content is invented.
 */
function InboxMock({ labels }: { labels: Labels }) {
  const conversations = [
    ...labels.msgs.map((m, i) => ({ ...m, count: i === 0 ? 2 : 1 })),
    ...labels.more.map((m) => ({ ...m, count: 0 })),
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="grid grid-cols-[minmax(0,168px)_minmax(0,1fr)] sm:grid-cols-[52px_minmax(0,190px)_minmax(0,1fr)]">
        <div className="hidden flex-col items-center gap-2 border-r border-slate-200 bg-slate-50/70 py-4 sm:flex">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
            <Icon name="inbox" className="h-5 w-5" />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300">
            <Icon name="bell" className="h-5 w-5" />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300">
            <Icon name="users" className="h-5 w-5" />
          </span>
        </div>

        <div className="border-r border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
            <span className="text-[13px] font-bold text-slate-900">
              {labels.inbox}
            </span>
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
              3
            </span>
          </div>

          {conversations.map((row, index) => (
            <div
              key={row.who}
              className={`flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 ${
                index === 0 ? "bg-blue-50/70" : ""
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
                {row.who.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-900">
                    {row.who}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {row.time}
                  </span>
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {row.text}
                </span>
              </span>
              {row.count > 0 ? (
                <span className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                  {row.count}
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <div className="hidden min-w-0 flex-col bg-slate-50/50 sm:flex">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
              {labels.msgs[0].who.slice(0, 1)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-slate-900">
                {labels.msgs[0].who}
              </span>
              <span className="block truncate text-[11px] text-slate-500">
                {labels.threadSub}
              </span>
            </span>
            <span className="ml-auto shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
              {labels.open}
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-2.5 p-4">
            <span className="max-w-[80%] self-start rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3 py-2 text-[12px] leading-5 text-slate-700">
              {labels.msgs[0].text}
            </span>
            <span className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-[12px] leading-5 text-white">
              {labels.reply}
            </span>
          </div>

          <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-3">
            <span className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-400">
              …
            </span>
            <span className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-[11px] font-bold text-white">
              {labels.send}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
