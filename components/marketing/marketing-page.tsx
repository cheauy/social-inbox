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
 * Every person, shop and order shown here is invented sample data. Nothing
 * on this page is a real customer.
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
  includedChannels: 3,
  includedUsers: 1,
  extraChannelCents: 400,
  extraUserCents: 300,
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

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
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
    howEyebrow: "Inside TENH",
    howTitle: "Everything your team needs to answer well.",
    howLede:
      "TENH is built for teams handling customer messages every day: shared assignment, saved replies, customer history, reminders and reporting. Choose any tool to see how it looks inside the workspace.",
    previewHint: "Select a tool to preview it",
    features: [
      {
        title: "Saved replies",
        body: "Answer common questions about price, stock and delivery in one click instead of typing again.",
        preview: {
          header: "Quick replies",
          rows: [
            { title: "Delivery price", sub: "Delivery is $1.50 inside the city." },
            { title: "In stock today", sub: "Yes, this item is still available." },
            { title: "Payment options", sub: "You can pay on delivery or transfer." },
          ],
          note: "One click puts the text in the reply box.",
        },
      },
      {
        title: "Tags & customer notes",
        body: "Label conversations your way, and leave notes only your team can see.",
        preview: {
          header: "Alex Morgan",
          rows: [
            { title: "Tags", sub: "VIP · Order · Follow up", pill: "3", tone: "blue" },
            { title: "Note from Maya", sub: "Prefers delivery after 5pm." },
            { title: "Note from Ben", sub: "Asked about bulk price last month." },
          ],
          note: "Notes stay internal. Customers never see them.",
        },
      },
      {
        title: "Customer history",
        body: "See what a customer asked and ordered before, so you never ask them to repeat it.",
        preview: {
          header: "Alex Morgan · History",
          rows: [
            { title: "Order #10482", sub: "12 Mar", pill: "Delivered", tone: "green" },
            { title: "Order #10231", sub: "28 Feb", pill: "Delivered", tone: "green" },
            { title: "First message", sub: "14 Feb · Messenger" },
          ],
          note: "6 conversations and 2 orders on this profile.",
        },
      },
      {
        title: "Assign to a teammate",
        body: "Give a conversation to the right person, or let an agent claim it, so everyone knows who is answering.",
        preview: {
          header: "Shared queue",
          rows: [
            { title: "Alex Morgan", sub: "Messenger · nobody yet", pill: "New", tone: "blue" },
            { title: "Jordan Lee", sub: "Comment Facebook · Maya", pill: "In progress", tone: "amber" },
            { title: "Sam Rivera", sub: "Telegram · Ben", pill: "Done", tone: "green" },
          ],
          note: "Everyone sees the same list, so nobody answers twice.",
        },
      },
      {
        title: "Follow-up reminders",
        body: "Set a reminder on a conversation and TENH tells you when it is time to come back to the customer.",
        preview: {
          header: "Reminders",
          rows: [
            { title: "Alex Morgan", sub: "Check if the size fits", pill: "Tomorrow 9:00", tone: "amber" },
            { title: "Casey Kim", sub: "Send the new price list", pill: "Fri 14:00", tone: "slate" },
          ],
          note: "TENH notifies you when a reminder is due.",
        },
      },
      {
        title: "Saved filters",
        body: "Save the lists you check every day — unread, assigned to me, one channel — and open them in one click.",
        preview: {
          header: "My views",
          rows: [
            { title: "Unread", sub: "Everything nobody has answered", pill: "6", tone: "blue" },
            { title: "Assigned to me", sub: "My conversations today", pill: "3", tone: "slate" },
            { title: "Telegram only", sub: "One channel at a time", pill: "2", tone: "slate" },
          ],
          note: "Build the list once, open it every day.",
        },
      },
      {
        title: "Team chat & mentions",
        body: "Talk to your team inside TENH and mention someone when a conversation needs them.",
        preview: {
          header: "Support team",
          rows: [
            { title: "Maya", sub: "@Ben can you take Alex Morgan?" },
            { title: "Ben", sub: "Taking it now." },
            { title: "Maya", sub: "Thanks, customer is waiting." },
          ],
          note: "Internal chat. It is never sent to the customer.",
        },
      },
      {
        title: "Customer files",
        body: "Keep receipts, photos and documents on the customer profile, next to their conversations.",
        preview: {
          header: "Files · Alex Morgan",
          rows: [
            { title: "receipt-10482.pdf", sub: "Uploaded by Maya · 142 KB" },
            { title: "size-chart.png", sub: "Uploaded by Ben · 88 KB" },
            { title: "delivery-note.jpg", sub: "Uploaded by Maya · 210 KB" },
          ],
          note: "Stored on the profile, not lost in the chat.",
        },
      },
      {
        title: "Reports & response time",
        body: "See how many messages each agent answers, which channel is busiest, and how fast your team replies.",
        preview: {
          header: "This week",
          rows: [
            { title: "Messages answered", sub: "Across all channels", pill: "1,248", tone: "blue" },
            { title: "Average first reply", sub: "Time to the first answer", pill: "4m 12s", tone: "green" },
            { title: "Busiest channel", sub: "Where most messages arrive", pill: "Messenger", tone: "slate" },
          ],
          note: "Broken down per agent and per channel.",
        },
      },
      {
        title: "Roles & permissions",
        body: "Choose who can invite people, connect channels, or open reports.",
        preview: {
          header: "Roles",
          rows: [
            { title: "Owner", sub: "Everything, including billing", pill: "1", tone: "blue" },
            { title: "Manager", sub: "Team, tags and reports", pill: "2", tone: "slate" },
            { title: "Agent", sub: "Inbox only", pill: "5", tone: "slate" },
          ],
          note: "You decide what each role is allowed to open.",
        },
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
          "Share new chats between agents",
          "Reports and response times",
        ],
      },
      pro: {
        name: "Pro",
        points: [
          "For a growing support team",
          "Roles, permissions, change history",
          "Priority support",
        ],
      },
    },
    customName: "Custom",
    customTagline: "Build your own size",
    customFrom: "from",
    customPoints: (channels: string, users: string) => [
      `Choose ${channels} channels and ${users} users`,
      `+$4 per extra channel, +$3 per extra user`,
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
    howEyebrow: "ខាងក្នុង TENH",
    howTitle: "គ្រប់យ៉ាងដែលក្រុមរបស់អ្នកត្រូវការដើម្បីឆ្លើយបានល្អ។",
    howLede:
      "TENH ត្រូវបានសាងសម្រាប់ក្រុមដែលដោះស្រាយសារអតិថិជនរាល់ថ្ងៃ៖ ការចាត់តាំងរួម ការឆ្លើយតបរហ័ស ប្រវត្តិអតិថិជន ការរំលឹក និងរបាយការណ៍។ ជ្រើសរើសឧបករណ៍ណាមួយដើម្បីមើលរូបរាងខាងក្នុង។",
    previewHint: "ជ្រើសរើសឧបករណ៍ដើម្បីមើល",
    features: [
      {
        title: "ការឆ្លើយតបរហ័ស",
        body: "ឆ្លើយសំណួរញឹកញាប់អំពីតម្លៃ ស្តុក និងការដឹកជញ្ជូន ត្រឹមចុចម្តង ដោយមិនចាំបាច់វាយម្តងទៀត។",
        preview: {
          header: "ចម្លើយរហ័ស",
          rows: [
            { title: "តម្លៃដឹកជញ្ជូន", sub: "ដឹកជញ្ជូន $1.50 ក្នុងទីក្រុង។" },
            { title: "មានស្តុកថ្ងៃនេះ", sub: "បាទ/ចាស ទំនិញនេះនៅមាន។" },
            { title: "របៀបទូទាត់", sub: "អាចបង់ពេលដឹកជញ្ជូន ឬផ្ទេរប្រាក់។" },
          ],
          note: "ចុចម្តងដាក់អត្ថបទចូលប្រអប់ឆ្លើយតប។",
        },
      },
      {
        title: "ស្លាក និងកំណត់ចំណាំអតិថិជន",
        body: "ដាក់ស្លាកការសន្ទនាតាមរបៀបរបស់អ្នក និងទុកកំណត់ចំណាំសម្រាប់តែក្រុមរបស់អ្នកមើល។",
        preview: {
          header: "Alex Morgan",
          rows: [
            { title: "ស្លាក", sub: "VIP · កម្ម៉ង់ · តាមដាន", pill: "3", tone: "blue" },
            { title: "កំណត់ចំណាំពី Maya", sub: "ចូលចិត្តដឹកជញ្ជូនក្រោយម៉ោង ៥ ល្ងាច។" },
            { title: "កំណត់ចំណាំពី Ben", sub: "ធ្លាប់សួរតម្លៃដុំកាលពីខែមុន។" },
          ],
          note: "កំណត់ចំណាំសម្រាប់តែផ្ទៃក្នុង។ អតិថិជនមិនឃើញទេ។",
        },
      },
      {
        title: "ប្រវត្តិអតិថិជន",
        body: "មើលឃើញអ្វីដែលអតិថិជនធ្លាប់សួរ និងធ្លាប់កម្ម៉ង់ ដូច្នេះមិនចាំបាច់ឱ្យគាត់និយាយឡើងវិញ។",
        preview: {
          header: "Alex Morgan · ប្រវត្តិ",
          rows: [
            { title: "កម្ម៉ង់ #10482", sub: "១២ មីនា", pill: "ដឹកជញ្ជូនរួច", tone: "green" },
            { title: "កម្ម៉ង់ #10231", sub: "២៨ កុម្ភៈ", pill: "ដឹកជញ្ជូនរួច", tone: "green" },
            { title: "សារដំបូង", sub: "១៤ កុម្ភៈ · Messenger" },
          ],
          note: "មានការសន្ទនា ៦ និងកម្ម៉ង់ ២ លើប្រវត្តិរូបនេះ។",
        },
      },
      {
        title: "ចាត់តាំងឱ្យសមាជិកក្រុម",
        body: "ប្រគល់ការសន្ទនាឱ្យអ្នកសមស្រប ឬឱ្យភ្នាក់ងារយកដោយខ្លួនឯង ដូច្នេះអ្នកគ្រប់គ្នាដឹងថានរណាកំពុងឆ្លើយ។",
        preview: {
          header: "បញ្ជីការងាររួម",
          rows: [
            { title: "Alex Morgan", sub: "Messenger · មិនទាន់មានអ្នកឆ្លើយ", pill: "ថ្មី", tone: "blue" },
            { title: "Jordan Lee", sub: "Comment Facebook · Maya", pill: "កំពុងធ្វើ", tone: "amber" },
            { title: "Sam Rivera", sub: "Telegram · Ben", pill: "រួចរាល់", tone: "green" },
          ],
          note: "អ្នកគ្រប់គ្នាឃើញបញ្ជីតែមួយ ដូច្នេះគ្មានអ្នកឆ្លើយពីរដងទេ។",
        },
      },
      {
        title: "ការរំលឹកតាមដាន",
        body: "កំណត់ការរំលឹកលើការសន្ទនា ហើយ TENH ប្រាប់អ្នកនៅពេលដល់ម៉ោងត្រឡប់ទៅរកអតិថិជនវិញ។",
        preview: {
          header: "ការរំលឹក",
          rows: [
            { title: "Alex Morgan", sub: "ពិនិត្យថាទំហំសមឬអត់", pill: "ស្អែក ៩:០០", tone: "amber" },
            { title: "Casey Kim", sub: "ផ្ញើតារាងតម្លៃថ្មី", pill: "សុក្រ ១៤:០០", tone: "slate" },
          ],
          note: "TENH ជូនដំណឹងពេលដល់ម៉ោងរំលឹក។",
        },
      },
      {
        title: "តម្រងរក្សាទុក",
        body: "រក្សាទុកបញ្ជីដែលអ្នកមើលរាល់ថ្ងៃ — មិនទាន់អាន ចាត់តាំងឱ្យខ្ញុំ ឬឆានែលណាមួយ — ហើយបើកត្រឹមចុចម្តង។",
        preview: {
          header: "បញ្ជីរបស់ខ្ញុំ",
          rows: [
            { title: "មិនទាន់អាន", sub: "អ្វីដែលគ្មាននរណាឆ្លើយ", pill: "6", tone: "blue" },
            { title: "ចាត់តាំងឱ្យខ្ញុំ", sub: "ការសន្ទនារបស់ខ្ញុំថ្ងៃនេះ", pill: "3", tone: "slate" },
            { title: "តែ Telegram", sub: "មួយឆានែលម្តង", pill: "2", tone: "slate" },
          ],
          note: "បង្កើតម្តង បើកប្រើរាល់ថ្ងៃ។",
        },
      },
      {
        title: "ជជែកជាក្រុម និងការនិយាយឈ្មោះ",
        body: "និយាយជាមួយក្រុមរបស់អ្នកនៅក្នុង TENH និងហៅឈ្មោះនរណាម្នាក់ពេលការសន្ទនាត្រូវការគាត់។",
        preview: {
          header: "ក្រុមគាំទ្រ",
          rows: [
            { title: "Maya", sub: "@Ben ជួយយក Alex Morgan បានទេ?" },
            { title: "Ben", sub: "កំពុងយកឥឡូវនេះ។" },
            { title: "Maya", sub: "អរគុណ អតិថិជនកំពុងរង់ចាំ។" },
          ],
          note: "ជជែកផ្ទៃក្នុង។ មិនផ្ញើទៅអតិថិជនទេ។",
        },
      },
      {
        title: "ឯកសារអតិថិជន",
        body: "រក្សាវិក្កយបត្រ រូបភាព និងឯកសារនៅលើប្រវត្តិរូបអតិថិជន ជាប់នឹងការសន្ទនារបស់គាត់។",
        preview: {
          header: "ឯកសារ · Alex Morgan",
          rows: [
            { title: "receipt-10482.pdf", sub: "ដាក់ដោយ Maya · 142 KB" },
            { title: "size-chart.png", sub: "ដាក់ដោយ Ben · 88 KB" },
            { title: "delivery-note.jpg", sub: "ដាក់ដោយ Maya · 210 KB" },
          ],
          note: "រក្សានៅលើប្រវត្តិរូប មិនបាត់ក្នុងការជជែកទេ។",
        },
      },
      {
        title: "របាយការណ៍ និងល្បឿនឆ្លើយតប",
        body: "មើលថាភ្នាក់ងារម្នាក់ៗឆ្លើយប៉ុន្មានសារ ឆានែលណាមមាញឹកបំផុត និងក្រុមឆ្លើយលឿនប៉ុណ្ណា។",
        preview: {
          header: "សប្តាហ៍នេះ",
          rows: [
            { title: "សារបានឆ្លើយ", sub: "គ្រប់ឆានែលរួមគ្នា", pill: "1,248", tone: "blue" },
            { title: "ឆ្លើយលើកដំបូងជាមធ្យម", sub: "រយៈពេលដល់ចម្លើយដំបូង", pill: "4m 12s", tone: "green" },
            { title: "ឆានែលមមាញឹកបំផុត", sub: "កន្លែងសារចូលច្រើនជាងគេ", pill: "Messenger", tone: "slate" },
          ],
          note: "បំបែកតាមភ្នាក់ងារ និងតាមឆានែល។",
        },
      },
      {
        title: "តួនាទី និងសិទ្ធិ",
        body: "ជ្រើសរើសថានរណាអាចអញ្ជើញសមាជិក ភ្ជាប់ឆានែល ឬបើករបាយការណ៍។",
        preview: {
          header: "តួនាទី",
          rows: [
            { title: "ម្ចាស់", sub: "គ្រប់យ៉ាង រួមទាំងការទូទាត់", pill: "1", tone: "blue" },
            { title: "អ្នកគ្រប់គ្រង", sub: "ក្រុម ស្លាក និងរបាយការណ៍", pill: "2", tone: "slate" },
            { title: "ភ្នាក់ងារ", sub: "តែប្រអប់សារ", pill: "5", tone: "slate" },
          ],
          note: "អ្នកសម្រេចថាតួនាទីនីមួយៗអាចបើកអ្វីខ្លះ។",
        },
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
          "ប្រអប់សារពេញលេញ ស្លាក ការឆ្លើយតបរហ័ស",
          "ប្រវត្តិរូប និងកំណត់ចំណាំអតិថិជន",
        ],
      },
      team: {
        name: "Team",
        points: [
          "សម្រាប់ក្រុមតូចដែលមាន Page និង Bot ខ្លះ",
          "ចែកការសន្ទនាថ្មីរវាងភ្នាក់ងារ",
          "របាយការណ៍ និងល្បឿនឆ្លើយតប",
        ],
      },
      pro: {
        name: "Pro",
        points: [
          "សម្រាប់ក្រុមគាំទ្រដែលកំពុងរីកចម្រើន",
          "តួនាទី សិទ្ធិ និងប្រវត្តិការផ្លាស់ប្តូរ",
          "ការគាំទ្រអាទិភាព",
        ],
      },
    },
    customName: "Custom",
    customTagline: "បង្កើតទំហំតាមតម្រូវការ",
    customFrom: "ចាប់ពី",
    customPoints: (channels: string, users: string) => [
      `ជ្រើសរើស ${channels} ឆានែល និង ${users} អ្នកប្រើ`,
      `+$4 ក្នុងមួយឆានែលបន្ថែម, +$3 ក្នុងមួយអ្នកប្រើបន្ថែម`,
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

const PREVIEW_TONES = {
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-700",
  green: "bg-emerald-50 text-emerald-700",
  slate: "bg-slate-100 text-slate-600",
} as const;

export function MarketingPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [cycleIndex, setCycleIndex] = useState(0);
  const [featureIndex, setFeatureIndex] = useState(0);

  const t = COPY[lang];
  const cycle = CYCLES[cycleIndex];
  const active = t.features[featureIndex] ?? t.features[0];

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
          <InboxMock />
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
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <circle cx="12" cy="12" r="11" fill="#1877F2" />
                    <path
                      d="M13.2 19v-6h2l.3-2.3h-2.3V9.2c0-.66.2-1.1 1.1-1.1h1.2V6.1a15 15 0 0 0-1.8-.1c-1.8 0-3 1.1-3 3v1.7H8.7V13h2v6z"
                      fill="#fff"
                    />
                  </svg>
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

      {/* ---------- features ---------- */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {t.howEyebrow}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
            {t.howTitle}
          </h2>
          <p className="mt-3 text-[15px] leading-7 text-slate-600">
            {t.howLede}
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1.05fr_1fr]">
          {/*
            Left panel previews whichever tool is selected on the right, so
            the claim and the picture of it stay side by side.
          */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                    <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
                  </svg>
                </span>
                <span className="min-w-0 truncate text-[13px] font-bold text-slate-900">
                  {active.preview.header}
                </span>
                <span className="ml-auto shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                  {t.sampleBadge}
                </span>
              </div>

              <div className="flex flex-col">
                {active.preview.rows.map((row) => (
                  <div
                    key={row.title}
                    className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-slate-900">
                        {row.title}
                      </span>
                      <span className="block truncate text-[12px] text-slate-500">
                        {row.sub}
                      </span>
                    </span>
                    {"pill" in row && row.pill ? (
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                          PREVIEW_TONES[
                            ("tone" in row && row.tone
                              ? row.tone
                              : "slate") as keyof typeof PREVIEW_TONES
                          ]
                        }`}
                      >
                        {row.pill}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>

              <p className="border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-[12px] leading-6 text-slate-600">
                {active.preview.note}
              </p>
            </div>
          </div>

          <div className="flex flex-col">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {t.previewHint}
            </p>

            {t.features.map((feature, index) => {
              const selected = index === featureIndex;

              return (
                <button
                  key={feature.title}
                  type="button"
                  onClick={() => setFeatureIndex(index)}
                  aria-pressed={selected}
                  className={`group rounded-xl border-b border-slate-200 px-3 py-3.5 text-left transition last:border-b-0 ${
                    selected
                      ? "bg-blue-50/70"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full transition ${
                        selected ? "bg-blue-600" : "bg-slate-300"
                      }`}
                    />
                    <span
                      className={`text-[15px] font-bold ${
                        selected ? "text-blue-800" : "text-slate-900"
                      }`}
                    >
                      {feature.title}
                    </span>
                  </span>
                  <span className="mt-1 block pl-3.5 text-sm leading-7 text-slate-600">
                    {feature.body}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- pricing ---------- */}
      {/*
        Background follows the logo: its blue-to-magenta arc, deepened so
        white type stays readable. The amber accents are the logo's orange.
      */}
      <section
        id="pricing"
        className="bg-[linear-gradient(135deg,#06143A_0%,#0C2C87_46%,#3D1370_100%)] py-16 text-white"
      >
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

            {/* Custom: same shape as the fixed plans, priced from the base. */}
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

      {/* ---------- closer ---------- */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="flex flex-wrap items-center gap-6 rounded-2xl bg-[linear-gradient(135deg,#06143A_0%,#0C2C87_46%,#3D1370_100%)] px-8 py-10 text-white">
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

/*
 * A simplified view of the real TENH inbox: the same three columns and the
 * same shapes people see after signing in, with fewer details and larger
 * text so it stays readable at this size. All content is invented.
 */
function InboxMock() {
  const conversations = [
    { name: "Alex Morgan", preview: "Is this still in stock?", time: "2m", count: 2 },
    { name: "Jordan Lee", preview: "How much is delivery?", time: "18m", count: 1 },
    { name: "Sam Rivera", preview: "Can I pay on delivery?", time: "1h", count: 0 },
    { name: "Casey Kim", preview: "Do you have a bigger size?", time: "3h", count: 0 },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="grid grid-cols-[minmax(0,168px)_minmax(0,1fr)] sm:grid-cols-[52px_minmax(0,190px)_minmax(0,1fr)]">
        {/* icon rail */}
        <div className="hidden flex-col items-center gap-2 border-r border-slate-200 bg-slate-50/70 py-4 sm:flex">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
              <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
            </svg>
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
              <path d="M12 3l2 6h6l-4.8 3.6 1.8 6L12 15l-5 3.6 1.8-6L4 9h6z" />
            </svg>
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300">
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor">
              <circle cx="12" cy="8" r="3.2" />
              <path d="M5 20a7 7 0 0 1 14 0z" />
            </svg>
          </span>
        </div>

        {/* conversation list */}
        <div className="border-r border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
            <span className="text-[13px] font-bold text-slate-900">Inbox</span>
            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
              3
            </span>
          </div>

          {conversations.map((row, index) => (
            <div
              key={row.name}
              className={`flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 ${
                index === 0 ? "bg-blue-50/70" : ""
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
                {row.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-900">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-400">
                    {row.time}
                  </span>
                </span>
                <span className="block truncate text-[11px] text-slate-500">
                  {row.preview}
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

        {/* thread */}
        <div className="hidden min-w-0 flex-col bg-slate-50/50 sm:flex">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600">
              A
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-slate-900">
                Alex Morgan
              </span>
              <span className="block truncate text-[11px] text-slate-500">
                Comment Facebook · Acme Store
              </span>
            </span>
            <span className="ml-auto shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
              Open
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-2.5 p-4">
            <span className="max-w-[80%] self-start rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3 py-2 text-[12px] leading-5 text-slate-700">
              Is this still in stock?
            </span>
            <span className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-blue-600 px-3 py-2 text-[12px] leading-5 text-white">
              Yes! We still have it. Would you like us to keep one for you?
            </span>
            <span className="max-w-[80%] self-start rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3 py-2 text-[12px] leading-5 text-slate-700">
              Yes please, size M.
            </span>
          </div>

          <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-3">
            <span className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-400">
              Write a reply…
            </span>
            <span className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-[11px] font-bold text-white">
              Send
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
