"use client";

import Image from "next/image";
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
 */

type Lang = "en" | "km";

const PLAN_MONTHLY_CENTS = {
  standard: 1300,
  team: 2500,
  pro: 5900,
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
    dir: "Messenger · Facebook comments · Telegram",
    headline: "Every customer message, one inbox.",
    lede:
      "TENH brings your Facebook Messenger chats, Facebook comments, and Telegram messages into one workspace — so your team stops switching tabs and nobody gets missed.",
    ctaPrimary: "Start free",
    ctaSecondary: "See how it works",
    note: "Works in English and ភាសាខ្មែរ · Pay with KHQR Code",
    channelsLead: "Connect the channels your customers already use",
    comingSoon: "Coming soon",
    howEyebrow: "How it works",
    howTitle: "One queue your whole team can actually work through.",
    howLede:
      "Messages from every channel land in the same list. Assign an owner, set a status, and everyone can see who is handling what — without asking in a group chat.",
    queueTitle: "The shared queue",
    queueLede:
      "Status and owner travel with the conversation, so nothing is answered twice or forgotten overnight.",
    features: [
      {
        title: "Saved replies",
        body: "Keep your best answers to delivery, price, and stock questions one click away.",
      },
      {
        title: "Tags & customer notes",
        body: "Label conversations your way, and leave internal notes only your team can read.",
      },
      {
        title: "Customer history",
        body: "Open a profile to see every past conversation and order before you answer.",
      },
      {
        title: "Round-robin assignment",
        body: "Share new conversations evenly across agents instead of whoever sees it first.",
      },
      {
        title: "Reports & response time",
        body: "See replies per agent, busiest channels, and how fast your team answers.",
      },
      {
        title: "Roles & permissions",
        body: "Decide who can invite people, connect channels, or see reports.",
      },
    ],
    pricingEyebrow: "Pricing",
    pricingTitle: "Pay for the channels and seats you use.",
    pricingLede:
      "Every plan includes the full inbox — no feature is locked behind a higher tier. Longer billing cycles cost less per month.",
    cycleLabels: ["1 month", "3 months", "6 months", "1 year"],
    billedMonthly: "Billed monthly",
    billedEvery: (total: string, months: number) =>
      `${total} billed every ${months} months`,
    perMonth: "/mo",
    popular: "Most popular",
    channelsUnit: "channels",
    usersUnit: "users",
    plans: {
      standard: {
        name: "Standard",
        points: [
          "For solo sellers and small shops",
          "Full inbox, tags, saved replies",
          "Customer profiles and notes",
        ],
      },
      team: {
        name: "Team",
        points: [
          "For small teams on several Pages and Bots",
          "Assignment and round-robin",
          "Reports and response times",
        ],
      },
      pro: {
        name: "Pro",
        points: [
          "For growing support teams",
          "Roles, permissions, change history",
          "Priority support",
        ],
      },
    },
    payNote: "Pay with KHQR Code · Prices in USD · Cancel any time",
    faqEyebrow: "Questions",
    faqTitle: "Before you start",
    faq: [
      {
        q: "Which channels can I connect?",
        a: "Facebook Messenger, Facebook comments on your Page posts, and Telegram bots. Each connected Page or Bot counts as one channel against your plan.",
      },
      {
        q: "Does TENH work in Khmer?",
        a: "Yes. The whole workspace switches between English and Khmer, and each teammate can choose their own language.",
      },
      {
        q: "Can my team work in the same inbox at once?",
        a: "Yes. Conversations can be assigned to an owner, and everyone sees status changes live, so two agents do not answer the same customer.",
      },
      {
        q: "How do I pay?",
        a: "With KHQR Code. You can pay monthly, or save 5%, 10%, or 20% by paying for 3 months, 6 months, or a year.",
      },
    ],
    closerTitle: "Stop losing customers in three different apps.",
    closerBody:
      "Connect your first Page or Bot in a few minutes and see every conversation in one place.",
    footerTag: "One inbox. Every conversation.",
  },
  km: {
    dir: "Messenger · មតិយោបល់ Facebook · Telegram",
    headline: "សារអតិថិជនទាំងអស់ នៅក្នុងប្រអប់សារតែមួយ។",
    lede:
      "TENH ប្រមូលការជជែក Facebook Messenger, មតិយោបល់ Facebook និងសារ Telegram មកក្នុងកន្លែងធ្វើការតែមួយ ដើម្បីឱ្យក្រុមរបស់អ្នកលែងប្តូរផ្ទាំងច្រើន និងមិនខកខានសារណាមួយឡើយ។",
    ctaPrimary: "ចាប់ផ្តើមឥតគិតថ្លៃ",
    ctaSecondary: "មើលរបៀបប្រើប្រាស់",
    note: "ប្រើបានជាភាសាអង់គ្លេស និងភាសាខ្មែរ · ទូទាត់ដោយ KHQR Code",
    channelsLead: "ភ្ជាប់ឆានែលដែលអតិថិជនរបស់អ្នកកំពុងប្រើ",
    comingSoon: "នឹងមកដល់ឆាប់ៗ",
    howEyebrow: "របៀបដំណើរការ",
    howTitle: "បញ្ជីការងារតែមួយ ដែលក្រុមទាំងមូលអាចធ្វើការជាមួយបាន។",
    howLede:
      "សារពីគ្រប់ឆានែលចូលមកក្នុងបញ្ជីតែមួយ។ ចាត់តាំងអ្នកទទួលបន្ទុក កំណត់ស្ថានភាព ហើយអ្នកគ្រប់គ្នាឃើញថានរណាកំពុងដោះស្រាយអ្វី ដោយមិនចាំបាច់សួរក្នុងក្រុមឡើយ។",
    queueTitle: "បញ្ជីការងាររួម",
    queueLede:
      "ស្ថានភាព និងអ្នកទទួលបន្ទុកតាមការសន្ទនាជានិច្ច ដូច្នេះគ្មានសារណាឆ្លើយពីរដង ឬត្រូវបានភ្លេចនោះទេ។",
    features: [
      {
        title: "ការឆ្លើយតបរហ័ស",
        body: "រក្សាចម្លើយល្អបំផុតអំពីការដឹកជញ្ជូន តម្លៃ និងស្តុក ឱ្យនៅជិតត្រឹមចុចម្តង។",
      },
      {
        title: "ស្លាក និងកំណត់ចំណាំអតិថិជន",
        body: "ដាក់ស្លាកការសន្ទនាតាមរបៀបរបស់អ្នក និងទុកកំណត់ចំណាំផ្ទៃក្នុងសម្រាប់តែក្រុមរបស់អ្នក។",
      },
      {
        title: "ប្រវត្តិអតិថិជន",
        body: "បើកប្រវត្តិរូបដើម្បីមើលការសន្ទនា និងការកម្ម៉ង់ពីមុនមុននឹងឆ្លើយតប។",
      },
      {
        title: "ការចាត់តាំងវេនស្មើគ្នា",
        body: "ចែកការសន្ទនាថ្មីស្មើៗគ្នាដល់ភ្នាក់ងារ ជំនួសឱ្យអ្នកណាឃើញមុនយកមុន។",
      },
      {
        title: "របាយការណ៍ និងល្បឿនឆ្លើយតប",
        body: "មើលចំនួនឆ្លើយតបតាមភ្នាក់ងារ ឆានែលមមាញឹកបំផុត និងល្បឿនឆ្លើយតបរបស់ក្រុម។",
      },
      {
        title: "តួនាទី និងសិទ្ធិ",
        body: "សម្រេចថានរណាអាចអញ្ជើញសមាជិក ភ្ជាប់ឆានែល ឬមើលរបាយការណ៍។",
      },
    ],
    pricingEyebrow: "តម្លៃ",
    pricingTitle: "បង់ថ្លៃតាមឆានែល និងចំនួនអ្នកប្រើដែលអ្នកប្រើពិត។",
    pricingLede:
      "គ្រប់គម្រោងមានប្រអប់សារពេញលេញ — គ្មានមុខងារណាត្រូវបានចាក់សោសម្រាប់តែគម្រោងខ្ពស់ទេ។ ការទូទាត់រយៈពេលវែងជាង មានតម្លៃទាបជាងក្នុងមួយខែ។",
    cycleLabels: ["១ ខែ", "៣ ខែ", "៦ ខែ", "១ ឆ្នាំ"],
    billedMonthly: "គិតថ្លៃរៀងរាល់ខែ",
    billedEvery: (total: string, months: number) =>
      `${total} រៀងរាល់ ${months} ខែ`,
    perMonth: "/ខែ",
    popular: "ពេញនិយមបំផុត",
    channelsUnit: "ឆានែល",
    usersUnit: "អ្នកប្រើ",
    plans: {
      standard: {
        name: "Standard",
        points: [
          "សម្រាប់អ្នកលក់ម្នាក់ឯង និងហាងតូច",
          "ប្រអប់សារពេញលេញ ស្លាក ការឆ្លើយតបរហ័ស",
          "ប្រវត្តិរូប និងកំណត់ចំណាំអតិថិជន",
        ],
      },
      team: {
        name: "Team",
        points: [
          "សម្រាប់ក្រុមតូចដែលមាន Page និង Bot ច្រើន",
          "ការចាត់តាំង និងវេនស្មើគ្នា",
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
    payNote: "ទូទាត់ដោយ KHQR Code · តម្លៃជាដុល្លារ · បោះបង់បានគ្រប់ពេល",
    faqEyebrow: "សំណួរ",
    faqTitle: "មុននឹងចាប់ផ្តើម",
    faq: [
      {
        q: "តើខ្ញុំអាចភ្ជាប់ឆានែលអ្វីខ្លះ?",
        a: "Facebook Messenger, មតិយោបល់ Facebook លើ Page របស់អ្នក និង Telegram Bot។ រាល់ Page ឬ Bot ដែលភ្ជាប់ រាប់ជាមួយឆានែលក្នុងគម្រោងរបស់អ្នក។",
      },
      {
        q: "តើ TENH ប្រើជាភាសាខ្មែរបានទេ?",
        a: "បាទ/ចាស។ កន្លែងធ្វើការទាំងមូលប្តូររវាងភាសាអង់គ្លេស និងភាសាខ្មែរ ហើយសមាជិកម្នាក់ៗអាចជ្រើសរើសភាសាផ្ទាល់ខ្លួន។",
      },
      {
        q: "តើក្រុមរបស់ខ្ញុំធ្វើការក្នុងប្រអប់សារតែមួយព្រមគ្នាបានទេ?",
        a: "បាទ/ចាស។ ការសន្ទនាអាចចាត់តាំងឱ្យអ្នកទទួលបន្ទុក ហើយអ្នកគ្រប់គ្នាឃើញការប្តូរស្ថានភាពភ្លាមៗ ដូច្នេះភ្នាក់ងារពីរនាក់មិនឆ្លើយអតិថិជនតែម្នាក់ទេ។",
      },
      {
        q: "តើខ្ញុំទូទាត់ដោយរបៀបណា?",
        a: "ដោយ KHQR Code។ អ្នកអាចបង់ប្រចាំខែ ឬសន្សំ ៥% ១០% ឬ ២០% ដោយបង់សម្រាប់ ៣ ខែ ៦ ខែ ឬមួយឆ្នាំ។",
      },
    ],
    closerTitle: "ឈប់បាត់បង់អតិថិជននៅក្នុងកម្មវិធីបីផ្សេងគ្នា។",
    closerBody:
      "ភ្ជាប់ Page ឬ Bot ដំបូងរបស់អ្នកក្នុងរយៈពេលពីរបីនាទី ហើយមើលការសន្ទនាទាំងអស់នៅកន្លែងតែមួយ។",
    footerTag: "ប្រអប់សារតែមួយ។ គ្រប់ការសន្ទនា។",
  },
} as const;

const LIVE_CHANNELS = [
  { src: "/images/channels/messenger.png", en: "Messenger", km: "Messenger" },
  { src: null, en: "Facebook comments", km: "មតិយោបល់ Facebook" },
  { src: "/images/channels/telegram.png", en: "Telegram", km: "Telegram" },
];

const SOON_CHANNELS = [
  { src: "/images/channels/instagram.png", label: "Instagram" },
  { src: "/images/channels/whatsapp.png", label: "WhatsApp" },
  { src: "/images/channels/tiktok.png", label: "TikTok" },
];

export function MarketingPage() {
  const [lang, setLang] = useState<Lang>("en");
  const [cycleIndex, setCycleIndex] = useState(0);

  const t = COPY[lang];
  const cycle = CYCLES[cycleIndex];

  function priceFor(monthlyCents: number) {
    const total = Math.round(
      monthlyCents * cycle.months * (1 - cycle.discount),
    );
    const perMonth = Math.round(total / cycle.months);

    return {
      perMonth: money(perMonth),
      billed:
        cycle.months === 1
          ? t.billedMonthly
          : t.billedEvery(money(total), cycle.months),
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

  /*
   * No scroll container of its own: standalone it scrolls with the document,
   * and the dashboard wrapper supplies its own scrolling shell.
   */
  return (
    <div className="bg-white">
      {/* ---------- top bar: logo + language ---------- */}
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3.5">
          <Image
            src="/images/tenh_logo.png"
            alt="Tenh Chat"
            width={44}
            height={44}
            className="h-10 w-10 object-contain"
          />
          <div>
            <p className="text-base font-bold leading-tight text-slate-950">
              Tenh Chat
            </p>
            <p className="text-xs text-slate-500">Customer messaging</p>
          </div>

          <div className="ml-auto flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                lang === "en"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <UkFlag />
              English
            </button>
            <button
              type="button"
              onClick={() => setLang("km")}
              aria-pressed={lang === "km"}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                lang === "km"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <KhFlag />
              ខ្មែរ
            </button>
          </div>
        </div>
      </div>

      {/* ---------- hero ---------- */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-14 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
            {t.dir}
          </p>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-950 lg:text-5xl">
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
              href="#how"
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

        <InboxMock />
      </section>

      {/* ---------- channels ---------- */}
      <section className="border-y border-slate-200 bg-slate-50/60">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="text-center text-sm text-slate-500">
            {t.channelsLead}
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {LIVE_CHANNELS.map((channel) => (
              <span
                key={channel.en}
                className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm"
              >
                {channel.src ? (
                  <Image
                    src={channel.src}
                    alt=""
                    width={22}
                    height={22}
                    className="h-5.5 w-5.5 object-contain"
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
                {lang === "en" ? channel.en : channel.km}
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
                  className="h-5.5 w-5.5 object-contain opacity-55 grayscale"
                />
                {channel.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- features ---------- */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-16">
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
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-950">{t.queueTitle}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t.queueLede}</p>

            <div className="mt-5 flex flex-col gap-2">
              {[
                { who: "Oun Ny", via: "Messenger · Dara · 2m", pill: "New", tone: "bg-blue-50 text-blue-700" },
                { who: "Tii", via: "Comments · Sreyneang · 18m", pill: "Pending", tone: "bg-amber-50 text-amber-700" },
                { who: "Jä Wä", via: "Telegram · Dara · 1h", pill: "Closed", tone: "bg-slate-100 text-slate-500" },
              ].map((row) => (
                <div
                  key={row.who}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700">
                    {row.who.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {row.who}
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      {row.via}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.tone}`}
                  >
                    {row.pill}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col">
            {t.features.map((feature, index) => (
              <div
                key={feature.title}
                className={`py-4 ${
                  index === t.features.length - 1
                    ? ""
                    : "border-b border-slate-200"
                }`}
              >
                <h4 className="text-[15px] font-bold text-slate-900">
                  {feature.title}
                </h4>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {feature.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- pricing ---------- */}
      <section className="bg-slate-950 py-16 text-white">
        <div className="mx-auto max-w-6xl px-6">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              {t.pricingEyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              {t.pricingTitle}
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-slate-400">
              {t.pricingLede}
            </p>
          </div>

          <div className="mt-7 inline-flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-white/5 p-1">
            {CYCLES.map((item, index) => (
              <button
                key={item.months}
                type="button"
                onClick={() => setCycleIndex(index)}
                aria-pressed={cycleIndex === index}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  cycleIndex === index
                    ? "bg-white text-slate-950"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t.cycleLabels[index]}
                {item.discount > 0 ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      cycleIndex === index
                        ? "bg-amber-100 text-amber-700"
                        : "bg-amber-400/20 text-amber-300"
                    }`}
                  >
                    -{Math.round(item.discount * 100)}%
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const price = priceFor(plan.cents);

              return (
                <div
                  key={plan.key}
                  className={`flex flex-col rounded-2xl border p-6 ${
                    plan.featured
                      ? "border-white bg-white text-slate-950 shadow-xl"
                      : "border-slate-800 bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base font-bold">{plan.copy.name}</span>
                    {plan.featured ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                        {t.popular}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-3 text-4xl font-extrabold tabular-nums tracking-tight">
                    {price.perMonth}
                    <span
                      className={`ml-1 text-sm font-medium ${
                        plan.featured ? "text-slate-500" : "text-slate-400"
                      }`}
                    >
                      {t.perMonth}
                    </span>
                  </p>

                  <p
                    className={`mt-1.5 min-h-5 text-xs ${
                      plan.featured ? "text-slate-500" : "text-slate-400"
                    }`}
                  >
                    {price.billed}
                  </p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums ${
                        plan.featured ? "bg-slate-100" : "bg-white/10"
                      }`}
                    >
                      {plan.channels} {t.channelsUnit}
                    </span>
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums ${
                        plan.featured ? "bg-slate-100" : "bg-white/10"
                      }`}
                    >
                      {plan.users} {t.usersUnit}
                    </span>
                  </div>

                  <ul
                    className={`mt-4 flex flex-1 flex-col gap-2 text-sm ${
                      plan.featured ? "text-slate-600" : "text-slate-400"
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
                        : "border border-slate-700 text-white hover:border-slate-500"
                    }`}
                  >
                    {t.ctaPrimary}
                  </a>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <Image
              src="/images/aba-khqr.png"
              alt="KHQR"
              width={72}
              height={26}
              className="h-6 w-auto rounded bg-white object-contain px-1.5 py-0.5"
            />
            {t.payNote}
          </div>
        </div>
      </section>

      {/* ---------- faq ---------- */}
      <section className="mx-auto max-w-6xl px-6 py-16">
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
        <div className="flex flex-wrap items-center gap-6 rounded-2xl bg-blue-600 px-8 py-10 text-white">
          <div className="min-w-64 flex-1">
            <h2 className="text-2xl font-bold tracking-tight">
              {t.closerTitle}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-blue-100">
              {t.closerBody}
            </p>
          </div>
          <a
            href="/register"
            className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-blue-700 transition hover:bg-blue-50"
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
 * A scaled-down copy of the real TENH inbox: icon rail, conversation list,
 * and a Facebook-comment thread. Kept in the same visual language as the
 * product so the marketing shot never drifts from what people actually get.
 */
function InboxMock() {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="grid grid-cols-[44px_minmax(0,150px)_minmax(0,1fr)]">
        {/* icon rail */}
        <div className="flex flex-col items-center gap-3 border-r border-slate-200 bg-white py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </span>
          <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
            </svg>
            <span className="absolute -right-1.5 -top-1 rounded-full bg-blue-600 px-1 text-[8px] font-bold text-white">
              79
            </span>
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M12 2l2 6 6 .5-4.5 4 1.4 6-4.9-3.2L7.1 18.5l1.4-6L4 8.5 10 8z" />
            </svg>
          </span>
        </div>

        {/* conversation list */}
        <div className="border-r border-slate-200 bg-white">
          <div className="border-b border-slate-100 p-2">
            <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
              <p className="text-[7px] font-bold uppercase tracking-wider text-slate-400">
                Customer channel
              </p>
              <p className="text-[10px] font-bold text-slate-900">
                All Channels
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-slate-100 px-2.5 py-1.5">
            <span className="text-[9px] font-bold text-slate-700">
              Unread · 79
            </span>
            <span className="text-[8px] font-semibold text-blue-600">
              Clear view
            </span>
          </div>

          {[
            { name: "ជីវិតឯងករាល្យ ស៊ីយ៉ុង", count: 2 },
            { name: "Tii", count: 1 },
            { name: "Jä Wä", count: 2 },
            { name: "ចារា ចារា", count: 1 },
          ].map((row, index) => (
            <div
              key={row.name}
              className={`flex items-center gap-2 border-b border-slate-100 px-2.5 py-2 ${
                index === 0 ? "bg-slate-50" : ""
              }`}
            >
              <span className="relative shrink-0">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[8px] font-bold text-blue-700">
                  {row.name.slice(0, 1)}
                </span>
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white bg-[#0084FF]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[9px] font-bold text-slate-900">
                  {row.name}
                </span>
                <span className="block truncate text-[8px] text-slate-400">
                  តើបងមាន កម្មងស់...
                </span>
              </span>
              <span className="flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1 text-[7px] font-bold text-white">
                {row.count}
              </span>
            </div>
          ))}
        </div>

        {/* thread */}
        <div className="flex min-w-0 flex-col bg-slate-50/40">
          <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-bold text-slate-900">
                Oun Ny
              </span>
              <span className="block truncate text-[8px] text-slate-400">
                Melody Clothing · #60696DD1
              </span>
            </span>
            <span className="ml-auto shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[8px] font-semibold text-slate-600">
              Open
            </span>
          </div>

          <div className="flex-1 space-y-2 p-3">
            <p className="text-center text-[7px] font-semibold text-slate-400">
              Today
            </p>

            <div className="rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm">
              <div className="flex gap-2">
                <span className="h-12 w-10 shrink-0 rounded bg-gradient-to-br from-slate-200 to-slate-300" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-[8px] font-bold text-blue-600">
                    <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" aria-hidden="true">
                      <circle cx="12" cy="12" r="11" fill="#1877F2" />
                    </svg>
                    Comment on post
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] font-bold text-slate-900">
                    Melody Clothing
                  </span>
                  <span className="block truncate text-[8px] text-slate-500">
                    ម៉ូដថ្មីម៉ូយ។
                  </span>
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[7px] font-bold text-blue-700">
                O
              </span>
              <span className="min-w-0">
                <span className="block text-[7px] font-bold uppercase tracking-wide text-blue-600">
                  Facebook comment
                </span>
                <span className="mt-0.5 inline-block rounded-lg rounded-tl-sm border border-slate-200 bg-white px-2 py-1 text-[9px] text-slate-700">
                  hm b
                </span>
              </span>
            </div>

            <div className="flex justify-end">
              <span className="max-w-[75%] rounded-lg rounded-br-sm bg-blue-600 px-2 py-1 text-[9px] text-white">
                Hi! Yes, this one is still in stock. Would you like us to
                reserve it for you?
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2">
            <span className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[8px] text-slate-400">
              Write a reply…
            </span>
            <span className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[8px] font-bold text-white">
              Send
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
