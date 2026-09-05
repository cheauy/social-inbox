"use client";

import { useCallback, useEffect, useState } from "react";

import Image from "next/image";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { parseUserAgent } from "@/lib/auth/parse-user-agent";

type DeviceType = "desktop" | "phone" | "tablet" | "unknown";

type UserSession = {
  id: string;
  isCurrent: boolean;
  browser: string;
  operatingSystem: string;
  deviceType: DeviceType;
  label: string;
  ip: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
  expiresAt: string | null;
  isElevated: boolean;
};

type SessionsResponse = {
  success: boolean;
  supported?: boolean;
  currentSessionId?: string | null;
  sessions?: UserSession[];
  error?: string;
};

type IconName =
  | "desktop"
  | "phone"
  | "tablet"
  | "shield"
  | "help"
  | "device"
  | "refresh"
  | "clock"
  | "pin";

function Icon({
  name,
  className = "h-6 w-6",
}: {
  name: IconName;
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

  if (name === "desktop") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </svg>
    );
  }

  if (name === "phone") {
    return (
      <svg {...common}>
        <rect x="7" y="2" width="10" height="20" rx="2.5" />
        <path d="M11 18h2" />
      </svg>
    );
  }

  if (name === "tablet") {
    return (
      <svg {...common}>
        <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
        <path d="M11 18.5h2" />
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

  if (name === "help") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.7 9a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.4 1-1.4 2" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  if (name === "refresh") {
    return (
      <svg {...common}>
        <path d="M20 11a8 8 0 1 0-.7 4" />
        <path d="M20 4v7h-7" />
      </svg>
    );
  }

  if (name === "clock") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 1.8" />
      </svg>
    );
  }

  if (name === "pin") {
    return (
      <svg {...common}>
        <path d="M12 21s6.5-5.6 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 15.4 12 21 12 21Z" />
        <circle cx="12" cy="10.4" r="2.4" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 6h6" />
      <path d="M11 18h2" />
    </svg>
  );
}

/**
 * Browser logos are served from /public/images/browser-logo.
 * Add or rename a file here and the whole page picks it up.
 * If a file is missing the card falls back to the generic device
 * glyph instead of showing a broken image.
 */
const BROWSER_LOGO_DIR = "/images/browser-logo";

const BROWSER_LOGO_FILES: Record<string, string> = {
  Chrome: "chrome.png",
  Safari: "safari.png",
  Firefox: "firefox.png",
  Edge: "edge.png",
  Opera: "opera.png",
  "Samsung Internet": "samsung.png",
  "Mobile app": "app.png",
};

function browserLogoSrc(browser: string) {
  const file = BROWSER_LOGO_FILES[browser];

  return file ? `${BROWSER_LOGO_DIR}/${file}` : null;
}

function BrowserGlyph({ browser }: { browser: string }) {
  const [failed, setFailed] = useState(false);

  const src = browserLogoSrc(browser);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return <Icon name="device" className="h-8 w-8 text-slate-500" />;
  }

  return (
    <Image
      src={src}
      alt={browser}
      width={36}
      height={36}
      className="h-9 w-9 object-contain"
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}

function deviceIconName(deviceType: DeviceType): IconName {
  if (deviceType === "phone") {
    return "phone";
  }

  if (deviceType === "tablet") {
    return "tablet";
  }

  if (deviceType === "desktop") {
    return "desktop";
  }

  return "device";
}

function formatAbsolute(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(value: string | null, activeNowLabel: string) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes < 5) {
    return activeNowLabel;
  }

  const formatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });

  if (diffMinutes < 60) {
    return formatter.format(-diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (diffHours < 24) {
    return formatter.format(-diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);

  return formatter.format(-diffDays, "day");
}

export function ActiveSessionsView() {
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = useCallback(
    (en: string, km: string) => (isKhmer ? km : en),
    [isKhmer],
  );

  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(
    null,
  );
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fallbackLabel, setFallbackLabel] = useState<string | null>(null);

  const loadSessions = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError(null);

    try {
      const response = await fetch("/api/settings/sessions", {
        cache: "no-store",
      });

      const payload = (await response.json()) as SessionsResponse;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error ?? "Unable to load your active sessions.",
        );
      }

      setSupported(payload.supported !== false);
      setSessions(payload.sessions ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load your active sessions.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Used only when the SQL helper is not installed yet, so the page
    // can still name the device you are reading it on.
    setFallbackLabel(parseUserAgent(navigator.userAgent).label);
    void loadSessions(false);
  }, [loadSessions]);

  async function signOutOtherSessions() {
    setSigningOutOthers(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/settings/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "others" }),
      });

      const payload = (await response.json()) as SessionsResponse;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error ?? "Unable to sign out your other sessions.",
        );
      }

      setMessage(
        t(
          "Every other device was signed out. This device stays signed in.",
          "ឧបករណ៍ផ្សេងទៀតទាំងអស់ត្រូវបានចាកចេញ។ ឧបករណ៍នេះនៅតែចូលដដែល។",
        ),
      );

      await loadSessions(true);
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Unable to sign out your other sessions.",
      );
    } finally {
      setSigningOutOthers(false);
    }
  }

  async function signOutSession(session: UserSession) {
    setPendingSessionId(session.id);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/settings/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });

      const payload = (await response.json()) as SessionsResponse;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.error ?? "Unable to sign out that device.",
        );
      }

      setMessage(
        `${t("Signed out", "បានចាកចេញ")} · ${session.label}`,
      );

      await loadSessions(true);
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Unable to sign out that device.",
      );
    } finally {
      setPendingSessionId(null);
    }
  }

  const activeNowLabel = t("Active now", "កំពុងប្រើឥឡូវនេះ");
  const currentSession = sessions.find((item) => item.isCurrent) ?? null;
  const otherSessions = sessions.filter((item) => !item.isCurrent);
  const deviceCount = sessions.length;

  const currentLabel = currentSession?.label ?? fallbackLabel;

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)] pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[30px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[34px]">
            {t("Active sessions", "សម័យដែលកំពុងប្រើប្រាស់")}
          </h1>

          <p className="mt-1.5 text-base text-slate-500">
            {t(
              "These are the devices currently signed in to your TENH account.",
              "ទាំងនេះគឺជាឧបករណ៍ដែលកំពុងចូលក្នុងគណនី TENH របស់អ្នក។",
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSessions(true)}
            disabled={loading || refreshing}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
          >
            <Icon
              name="refresh"
              className={`h-4.5 w-4.5 ${refreshing ? "animate-spin" : ""}`}
            />
            {t("Refresh", "ធ្វើឲ្យស្រស់")}
          </button>

          <a
            href="https://t.me/tenhchat_support_bot"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-600 shadow-sm transition hover:bg-blue-50"
          >
            <Icon name="help" className="h-4.5 w-4.5" />
            {t("Need help?", "ត្រូវការជំនួយ?")}
          </a>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <section className="grid overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.05)] lg:grid-cols-2">
        <div className="flex items-center gap-5 px-6 py-7">
          <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_8px_24px_rgba(37,99,235,0.2)]">
              <Icon
                name={deviceIconName(
                  currentSession?.deviceType ?? "desktop",
                )}
                className="h-8 w-8"
              />
            </div>

            <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white bg-emerald-500" />
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-950">
              {loading
                ? t("Checking devices...", "កំពុងពិនិត្យឧបករណ៍...")
                : deviceCount > 0
                  ? `${deviceCount} ${
                      deviceCount === 1
                        ? t("signed-in device", "ឧបករណ៍ដែលបានចូល")
                        : t("signed-in devices", "ឧបករណ៍ដែលបានចូល")
                    }`
                  : t("Current session", "សម័យបច្ចុប្បន្ន")}
            </h2>

            <p className="mt-2 text-base text-slate-500">
              {otherSessions.length > 0
                ? t(
                    "Review anything you do not recognise and sign it out.",
                    "សូមពិនិត្យឧបករណ៍ដែលអ្នកមិនស្គាល់ ហើយចាកចេញវា។",
                  )
                : t(
                    "Your current TENH browser session is active.",
                    "សម័យកម្មវិធីរុករក TENH បច្ចុប្បន្នរបស់អ្នកកំពុងដំណើរការ។",
                  )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5 border-t border-slate-200 px-6 py-7 lg:border-l lg:border-t-0">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Icon name="shield" className="h-8 w-8" />
          </div>

          <div>
            <h2 className="text-lg font-bold text-slate-950">
              {t("Security tip", "គន្លឹះសុវត្ថិភាព")}
            </h2>
            <p className="mt-1.5 max-w-md text-base leading-7 text-slate-500">
              {t(
                "If you see unfamiliar activity, sign out other sessions immediately to keep your account safe.",
                "ប្រសិនបើអ្នកឃើញសកម្មភាពមិនស្គាល់ សូមចាកចេញពីសម័យផ្សេងទៀតភ្លាមៗ ដើម្បីរក្សាគណនីរបស់អ្នកឲ្យមានសុវត្ថិភាព។",
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-950">
          {t("Current session", "សម័យបច្ចុប្បន្ន")}
        </h2>

        <div className="rounded-[20px] border border-blue-200 bg-gradient-to-r from-blue-50/70 to-indigo-50/40 px-5 py-5 shadow-[0_4px_14px_rgba(37,99,235,0.04)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                <BrowserGlyph
                  browser={currentSession?.browser ?? "Unknown browser"}
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[17px] font-bold text-slate-950">
                    {loading
                      ? t("Detecting device...", "កំពុងសម្គាល់ឧបករណ៍...")
                      : (currentLabel ??
                        t("Current device", "ឧបករណ៍បច្ចុប្បន្ន"))}
                  </h3>

                  <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-600">
                    {t("This device", "ឧបករណ៍នេះ")}
                  </span>

                  {currentSession?.isElevated ? (
                    <span className="rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-600">
                      {t("2FA verified", "បានផ្ទៀងផ្ទាត់ 2FA")}
                    </span>
                  ) : null}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                  {currentSession?.ip ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="pin" className="h-4 w-4" />
                      {currentSession.ip}
                    </span>
                  ) : null}

                  {currentSession?.createdAt ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="clock" className="h-4 w-4" />
                      {t("Signed in", "បានចូល")}{" "}
                      {formatAbsolute(currentSession.createdAt)}
                    </span>
                  ) : null}
                </div>

                <p className="mt-1 text-sm font-semibold text-emerald-600">
                  {activeNowLabel}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-sm font-semibold text-blue-600">
                {t("Current session", "សម័យបច្ចុប្បន្ន")}
              </span>

              <Icon name="shield" className="h-5 w-5 text-blue-600" />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-950">
            {t("Other sessions", "សម័យផ្សេងទៀត")}
          </h2>

          {!loading && supported ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
              {otherSessions.length}
            </span>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((key) => (
              <div
                key={key}
                className="h-[92px] animate-pulse rounded-[20px] border border-slate-200 bg-slate-50"
              />
            ))}
          </div>
        ) : !supported ? (
          <div className="overflow-hidden rounded-[20px] border border-amber-200 bg-amber-50/60 px-5 py-6">
            <h3 className="font-bold text-slate-950">
              {t("Device list not enabled yet", "បញ្ជីឧបករណ៍មិនទាន់បើកនៅឡើយ")}
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
              {t(
                "Run supabase/sql/active-sessions.sql in the Supabase SQL editor to list every signed-in device. Signing out all other sessions works right now either way.",
                "សូមដំណើរការ supabase/sql/active-sessions.sql ក្នុង Supabase SQL editor ដើម្បីបង្ហាញឧបករណ៍ទាំងអស់ដែលបានចូល។ ការចាកចេញពីសម័យផ្សេងទៀតទាំងអស់ដំណើរការធម្មតារួចហើយ។",
              )}
            </p>
          </div>
        ) : otherSessions.length === 0 ? (
          <div className="flex items-center gap-4 rounded-[20px] border border-slate-200 bg-white px-5 py-6 shadow-[0_6px_20px_rgba(15,23,42,0.04)]">
            <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <Icon name="shield" className="h-7 w-7" />
            </div>

            <div>
              <h3 className="font-bold text-slate-950">
                {t("No other devices", "គ្មានឧបករណ៍ផ្សេងទៀត")}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {t(
                  "This is the only device signed in to your account.",
                  "នេះជាឧបករណ៍តែមួយគត់ដែលបានចូលក្នុងគណនីរបស់អ្នក។",
                )}
              </p>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {otherSessions.map((session) => {
              const lastActive = formatRelative(
                session.lastActiveAt,
                activeNowLabel,
              );

              const isPending = pendingSessionId === session.id;

              return (
                <li
                  key={session.id}
                  className="rounded-[20px] border border-slate-200 bg-white px-5 py-5 shadow-[0_6px_20px_rgba(15,23,42,0.04)]"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <BrowserGlyph browser={session.browser} />
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[17px] font-bold text-slate-950">
                            {session.label}
                          </h3>

                          {session.isElevated ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                              {t("2FA verified", "បានផ្ទៀងផ្ទាត់ 2FA")}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
                          {session.ip ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Icon name="pin" className="h-4 w-4" />
                              {session.ip}
                            </span>
                          ) : null}

                          {lastActive ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Icon name="clock" className="h-4 w-4" />
                              {t("Last active", "សកម្មចុងក្រោយ")}{" "}
                              {lastActive}
                            </span>
                          ) : null}
                        </div>

                        {session.createdAt ? (
                          <p className="mt-1 text-sm text-slate-400">
                            {t("Signed in", "បានចូល")}{" "}
                            {formatAbsolute(session.createdAt)}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void signOutSession(session)}
                      disabled={isPending || signingOutOthers}
                      className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-white px-5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                    >
                      {isPending
                        ? t("Signing out...", "កំពុងចាកចេញ...")
                        : t("Sign out", "ចាកចេញ")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-[20px] border border-orange-200 bg-gradient-to-r from-orange-50/80 to-amber-50/50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-500">
            <Icon name="shield" className="h-7 w-7" />
          </div>

          <div>
            <h2 className="font-bold text-slate-950">
              {t("Don’t recognize a session?", "មិនស្គាល់សម័យណាមួយ?")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {t(
                "Sign out from all other devices to protect your account.",
                "ចាកចេញពីឧបករណ៍ផ្សេងទៀតទាំងអស់ ដើម្បីការពារគណនីរបស់អ្នក។",
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void signOutOtherSessions()}
          disabled={
            signingOutOthers ||
            loading ||
            (supported && otherSessions.length === 0)
          }
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
        >
          {signingOutOthers
            ? t("Signing out...", "កំពុងចាកចេញ...")
            : t(
                "Sign out all other sessions",
                "ចាកចេញពីសម័យផ្សេងទៀតទាំងអស់",
              )}
        </button>
      </section>
    </main>
  );
}
