type SecurityIconName =
  | "account"
  | "channel"
  | "shield"
  | "sessions"
  | "access"
  | "monitor"
  | "message"
  | "report"
  | "retention"
  | "telegram"
  | "lock";

function SecurityIcon({
  name,
  className = "h-7 w-7",
}: {
  name: SecurityIconName;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };

  if (name === "account") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3" />
        <path d="M6.5 20v-1.8A5.5 5.5 0 0 1 12 12.7a5.5 5.5 0 0 1 5.5 5.5V20" />
      </svg>
    );
  }

  if (name === "channel") {
    return (
      <svg {...common}>
        <path d="M10.4 13.6 8.2 15.8a4 4 0 0 1-5.7-5.7l3.1-3.1a4 4 0 0 1 5.7 0" />
        <path d="m13.6 10.4 2.2-2.2a4 4 0 1 1 5.7 5.7l-3.1 3.1a4 4 0 0 1-5.7 0" />
        <path d="m8.8 15.2 6.4-6.4" />
      </svg>
    );
  }

  if (name === "shield") {
    return (
      <svg {...common}>
        <path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    );
  }

  if (name === "sessions") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="14" height="11" rx="2" />
        <rect x="15" y="8" width="6" height="12" rx="1.5" />
        <path d="M8 19h4M10 15v4" />
      </svg>
    );
  }

  if (name === "access") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19v-1.5A5.5 5.5 0 0 1 9 12" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M13.5 19v-1a4.5 4.5 0 0 1 7-3.7" />
      </svg>
    );
  }

  if (name === "monitor") {
    return (
      <svg {...common}>
        <path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </svg>
    );
  }

  if (name === "message") {
    return (
      <svg {...common}>
        <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
        <path d="M7 10h10M7 13h7" />
      </svg>
    );
  }

  if (name === "report") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
        <path d="M12 9.5v3M12 15h.01" />
      </svg>
    );
  }

  if (name === "retention") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (name === "telegram") {
    return (
      <svg {...common}>
        <path d="m21 4-8.1 16-3.4-6.2L3 11l18-7Z" />
        <path d="m9.5 13.8 5-4.3" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="6" y="10" width="12" height="10" rx="2" />
      <path d="M9 10V7a3 3 0 0 1 6 0v3" />
      <path d="M12 14v2" />
    </svg>
  );
}

function SecurityItem({
  icon,
  title,
  description,
  tone,
}: {
  icon: SecurityIconName;
  title: string;
  description: string;
  tone: "blue" | "green" | "violet" | "orange" | "red";
}) {
  const tones = {
    blue: "border-blue-100 bg-blue-50 text-blue-600",
    green: "border-emerald-100 bg-emerald-50 text-emerald-600",
    violet: "border-violet-100 bg-violet-50 text-violet-600",
    orange: "border-orange-100 bg-orange-50 text-orange-500",
    red: "border-red-100 bg-red-50 text-red-500",
  };

  return (
    <div className="flex min-h-[122px] gap-5 px-7 py-6 sm:px-8">
      <div
        className={`flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-full border ${tones[tone]}`}
      >
        <SecurityIcon name={icon} />
      </div>
      <div className="min-w-0 pt-0.5">
        <h2 className="text-[17px] font-bold text-slate-950">{title}</h2>
        <p className="mt-1.5 max-w-[480px] text-[15px] leading-6 text-slate-600">
          {description}
        </p>
      </div>
    </div>
  );
}

function SecurityHeroArt() {
  return (
    <div
      className="relative hidden h-[210px] min-w-[430px] items-center justify-center lg:flex"
      aria-hidden="true"
    >
      <div
        className="absolute h-[170px] w-[390px] rounded-[50%] border border-dashed"
        style={{ borderColor: "rgba(191, 219, 254, 0.72)" }}
      />
      <div
        className="absolute h-[125px] w-[305px] rounded-[50%] border border-dashed"
        style={{ borderColor: "rgba(191, 219, 254, 0.62)" }}
      />
      <div
        className="absolute h-[82px] w-[220px] rounded-[50%] border border-dashed"
        style={{ borderColor: "rgba(191, 219, 254, 0.52)" }}
      />

      <div
        className="absolute left-3 top-[78px] flex h-12 w-12 items-center justify-center rounded-full shadow-sm"
        style={{ backgroundColor: "#F4ECFF", color: "#6D28D9" }}
      >
        <SecurityIcon name="account" className="h-6 w-6" />
      </div>
      <div
        className="absolute right-4 top-[89px] flex h-12 w-12 items-center justify-center rounded-full shadow-sm"
        style={{ backgroundColor: "#EEF4FF", color: "#2563EB" }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-6 w-6"
        >
          <rect x="4" y="5" width="16" height="5" rx="1.5" />
          <rect x="4" y="14" width="16" height="5" rx="1.5" />
          <path d="M8 7.5h.01M8 16.5h.01M16 7.5h2M16 16.5h2" />
        </svg>
      </div>
      <div
        className="absolute right-[64px] top-1 flex h-12 w-12 items-center justify-center rounded-full shadow-sm"
        style={{ backgroundColor: "#EEFAEF", color: "#43B649" }}
      >
        <SecurityIcon name="lock" className="h-6 w-6" />
      </div>

      <div className="relative z-10 h-[158px] w-[142px] drop-shadow-[0_18px_30px_rgba(49,88,224,0.22)]">
        <svg viewBox="0 0 142 158" className="h-full w-full" role="presentation">
          <path
            d="M71 3 132 27v47c0 39.1-23.1 66.6-61 81C33.1 140.6 10 113.1 10 74V27L71 3Z"
            fill="#DDE7FF"
          />
          <path
            d="M71 14 121 34v40c0 31.9-18.5 54.6-50 68-31.5-13.4-50-36.1-50-68V34L71 14Z"
            fill="#3158E0"
          />
          <path
            d="M71 14 121 34v40c0 31.9-18.5 54.6-50 68V14Z"
            fill="#2D50D4"
            opacity="0.4"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-white">
          <SecurityIcon name="lock" className="h-[58px] w-[58px]" />
        </div>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default function SecurityLearnMorePage() {
  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-6 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)] pb-10">
      <section className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="max-w-[720px]">
          <h1 className="text-[32px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[38px]">
            We take your security seriously
          </h1>
          <p className="mt-4 max-w-[650px] text-[17px] leading-8 text-slate-600">
            TENH uses industry-standard security measures to keep your data safe and protected.
          </p>
        </div>
        <SecurityHeroArt />
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_10px_32px_rgba(15,23,42,0.06)]">
        <div className="grid md:grid-cols-2">
          <div className="divide-y divide-slate-200 md:border-r md:border-slate-200">
            <SecurityItem
              icon="lock"
              tone="blue"
              title="Account security"
              description="Secure sign-in, strong password protection, and multi-factor authentication options."
            />
            <SecurityItem
              icon="shield"
              tone="green"
              title="Data protection"
              description="All data is encrypted in transit and at rest using industry-standard encryption (HTTPS/TLS)."
            />
            <SecurityItem
              icon="access"
              tone="violet"
              title="Access control"
              description="Owner and Agent roles with fine-grained permissions to protect your workspace."
            />
            <SecurityItem
              icon="message"
              tone="orange"
              title="Message privacy"
              description="Only authorized members in your workspace can view customer conversations."
            />
            <SecurityItem
              icon="retention"
              tone="blue"
              title="Data retention & deletion"
              description="Control how long data is retained and request deletion of your workspace data at any time."
            />
          </div>

          <div className="divide-y divide-slate-200 border-t border-slate-200 md:border-t-0">
            <SecurityItem
              icon="channel"
              tone="green"
              title="Connected channels"
              description="We securely store and handle your Facebook Page and Telegram Bot credentials and tokens."
            />
            <SecurityItem
              icon="sessions"
              tone="violet"
              title="Active sessions"
              description="Review all devices and sessions that have access to your account and sign out anytime."
            />
            <SecurityItem
              icon="monitor"
              tone="orange"
              title="Security monitoring"
              description="We continuously monitor for suspicious activity and protect against unauthorized access."
            />
            <SecurityItem
              icon="report"
              tone="red"
              title="Report a security issue"
              description="Help us keep TENH secure by reporting any suspicious activity or vulnerabilities."
            />
          </div>
        </div>

        <div className="mx-6 mb-6 mt-3 flex flex-col gap-4 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/90 to-indigo-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-[0_8px_20px_rgba(37,99,235,0.2)]">
              <SecurityIcon name="shield" className="h-7 w-7" />
            </div>
            <div>
              <h2 className="font-bold text-slate-950">Need help with security?</h2>
              <p className="mt-1 text-sm text-slate-600">
                Contact the TENH support team — we&apos;re here to help.
              </p>
            </div>
          </div>

          <a
            href="https://t.me/tenh_chat_support_bot"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <SecurityIcon name="telegram" className="h-5 w-5" />
            Contact support
          </a>
        </div>
      </section>

      <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
        <SecurityIcon name="lock" className="h-4 w-4" />
        Your security and privacy are our top priorities.
      </p>
    </main>
  );
}
