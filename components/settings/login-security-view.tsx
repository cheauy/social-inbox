"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { DeleteAccountSection } from "@/components/profile/delete-account-section";

type AuthSnapshot = {
  email: string;
  emailVerified: boolean;
  linkedProviders: string[];
  hasPassword: boolean;
  identityCount: number;
  recoveryEmail: string | null;
};

type PasswordState = {
  open: boolean;
  current: string;
  password: string;
  confirm: string;
  signOutOthers: boolean;
  busy: boolean;
  error: string | null;
  success: string | null;
};

type RecoveryState = {
  open: boolean;
  value: string;
  busy: boolean;
  error: string | null;
  success: string | null;
};

function Icon({
  name,
  className = "h-6 w-6",
}: {
  name:
    | "lock"
    | "shield"
    | "mail"
    | "activity"
    | "trash"
    | "help"
    | "external"
    | "chevron";
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

  if (name === "lock") {
    return (
      <svg {...common}>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <path d="M12 14v2" />
      </svg>
    );
  }

  if (name === "shield") {
    return (
      <svg {...common}>
        <path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" />
        <path d="M12 8v7" />
        <path d="M9.5 11 12 8.5l2.5 2.5" />
      </svg>
    );
  }

  if (name === "mail") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  }

  if (name === "activity") {
    return (
      <svg {...common}>
        <path d="m4 15 4-4 3 3 5-7 4 3" />
        <path d="M18 7h2v2" />
      </svg>
    );
  }

  if (name === "trash") {
    return (
      <svg {...common}>
        <path d="M4 7h16" />
        <path d="M9 7V4h6v3" />
        <path d="m7 7 1 13h8l1-13" />
        <path d="M10 11v5M14 11v5" />
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

  if (name === "external") {
    return (
      <svg {...common}>
        <path d="M14 5h5v5" />
        <path d="m19 5-8 8" />
        <path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.23-.2-1.77H12v3.41h5.52a4.77 4.77 0 0 1-2.04 3.04l-.02.11 2.96 2.29.2.02c1.84-1.69 2.98-4.18 2.98-7.1Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.89 6.61-2.42l-3.15-2.44c-.84.57-1.97.97-3.46.97-2.6 0-4.8-1.76-5.59-4.19l-.1.01-3.08 2.38-.03.1A9.99 9.99 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.41 13.92A6.05 6.05 0 0 1 6.08 12c0-.67.12-1.31.32-1.92l-.01-.13L3.27 7.54l-.1.05A10 10 0 0 0 2 12c0 1.6.38 3.11 1.05 4.41l3.36-2.49Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.89c1.88 0 3.15.81 3.88 1.49l2.8-2.73C16.95 3.04 14.7 2 12 2a10 10 0 0 0-8.83 5.59l3.23 2.49C7.2 7.65 9.4 5.89 12 5.89Z"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12Z"
      />
    </svg>
  );
}

/**
 * Sign-in providers the user can link to this TENH login.
 * Each one must also be enabled in Supabase → Authentication → Providers.
 * "facebook" here is Facebook LOGIN — it is unrelated to the Facebook
 * page connection under Integrations, which uses its own OAuth flow.
 */
const LINKABLE_PROVIDERS = [
  {
    id: "google",
    name: "Google",
    icon: <GoogleIcon />,
    tone: "border-emerald-200 bg-emerald-50 text-emerald-600",
  },
  {
    id: "facebook",
    name: "Facebook",
    icon: <FacebookIcon />,
    tone: "border-blue-200 bg-blue-50 text-blue-600",
  },
] as const;

function StatusChip({
  children,
  tone = "green",
}: {
  children: React.ReactNode;
  tone?: "green" | "gray";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${
        tone === "green"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-100 text-slate-600"
      }`}
    >
      {children}
    </span>
  );
}

function SettingRow({
  icon,
  iconTone,
  title,
  description,
  middle,
  action,
  danger = false,
}: {
  icon: React.ReactNode;
  iconTone: string;
  title: string;
  description: string;
  middle?: React.ReactNode;
  action?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="grid min-h-[102px] gap-4 border-b border-slate-200 px-5 py-5 last:border-b-0 sm:grid-cols-[62px_minmax(0,1fr)_minmax(180px,0.55fr)_auto] sm:items-center sm:px-6">
      <div
        className={`flex h-[52px] w-[52px] items-center justify-center rounded-2xl border ${iconTone}`}
      >
        {icon}
      </div>

      <div className="min-w-0">
        <h3
          className={`text-[17px] font-bold ${
            danger ? "text-red-600" : "text-slate-950"
          }`}
        >
          {title}
        </h3>
        <p className="mt-1 text-sm leading-5 text-slate-500">
          {description}
        </p>
      </div>

      <div className="min-w-0 text-sm font-medium text-slate-700">
        {middle}
      </div>

      <div className="flex items-center justify-between gap-4 sm:justify-end">
        {action}
        <Icon
          name="chevron"
          className={`h-5 w-5 ${
            danger ? "text-red-400" : "text-slate-500"
          }`}
        />
      </div>
    </div>
  );
}

export function LoginSecurityView() {
  const router = useRouter();
  const languageId = useWorkspaceLanguageId();
  const isKhmer = languageId === "km";
  const t = (en: string, km: string) => (isKhmer ? km : en);

  const [auth, setAuth] = useState<AuthSnapshot>({
    email: "",
    emailVerified: false,
    linkedProviders: [],
    // Assume a password exists until we positively learn otherwise, so a
    // failed or slow load never hides the current-password field.
    hasPassword: true,
    identityCount: 0,
    recoveryEmail: null,
  });
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [passwordState, setPasswordState] =
    useState<PasswordState>({
      open: false,
      current: "",
      password: "",
      confirm: "",
      signOutOthers: true,
      busy: false,
      error: null,
      success: null,
    });

  const [recoveryState, setRecoveryState] =
    useState<RecoveryState>({
      open: false,
      value: "",
      busy: false,
      error: null,
      success: null,
    });

  const [providerBusy, setProviderBusy] =
    useState<string | null>(null);
  const [providerNotice, setProviderNotice] =
    useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadSecurityState() {
      setLoading(true);
      setPageError(null);

      try {
        const supabase = createClient();

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          throw new Error(
            userError?.message ??
              "Your session has expired. Please sign in again.",
          );
        }

        const identities = user.identities ?? [];
        const providerList = Array.isArray(
          user.app_metadata?.providers,
        )
          ? (user.app_metadata.providers as string[])
          : [];

        // identities can come back empty on some Supabase configs, so
        // fold in app_metadata as a second source of truth.
        const providerSet = new Set<string>();

        identities.forEach((identity) => {
          if (identity.provider) {
            providerSet.add(identity.provider);
          }
        });

        providerList.forEach((provider) => {
          providerSet.add(provider);
        });

        if (typeof user.app_metadata?.provider === "string") {
          providerSet.add(user.app_metadata.provider);
        }

        const storedRecovery =
          user.user_metadata?.recovery_email;

        if (!alive) {
          return;
        }

        setAuth({
          email: user.email ?? "",
          emailVerified: Boolean(
            user.email_confirmed_at,
          ),
          linkedProviders: [...providerSet],
          // Provisional: overwritten below by the server's
          // authoritative answer. Defaults to true so the
          // current-password field is never hidden by accident.
          hasPassword: true,
          identityCount: Math.max(
            identities.length,
            providerSet.size,
          ),
          recoveryEmail:
            typeof storedRecovery === "string" &&
            storedRecovery
              ? storedRecovery
              : null,
        });
      } catch (error) {
        if (!alive) {
          return;
        }

        setPageError(
          error instanceof Error
            ? error.message
            : "Unable to load login security settings.",
        );
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    }

    async function loadPasswordState() {
      try {
        const response = await fetch("/api/account/password", {
          cache: "no-store",
        });

        const result = (await response.json()) as {
          success?: boolean;
          hasPassword?: boolean;
        };

        if (!alive || !response.ok || !result.success) {
          return;
        }

        setAuth((current) => ({
          ...current,
          hasPassword: result.hasPassword !== false,
        }));
      } catch {
        /* Keep the safe default: assume a password exists. */
      }
    }

    void loadSecurityState();
    void loadPasswordState();

    return () => {
      alive = false;
    };
  }, []);

  const passwordReady = useMemo(
    () =>
      passwordState.password.length >= 8 &&
      passwordState.password === passwordState.confirm &&
      (!auth.hasPassword || passwordState.current.length > 0) &&
      passwordState.password !== passwordState.current &&
      !passwordState.busy,
    [passwordState, auth.hasPassword],
  );

  async function updatePassword() {
    if (!passwordReady) {
      return;
    }

    setPasswordState((current) => ({
      ...current,
      busy: true,
      error: null,
      success: null,
    }));

    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordState.current,
          newPassword: passwordState.password,
          signOutOtherSessions: passwordState.signOutOthers,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        othersSignedOut?: boolean;
        requiresCurrentPassword?: boolean;
      };

      if (!response.ok || !result.success) {
        if (result.requiresCurrentPassword) {
          setAuth((current) => ({
            ...current,
            hasPassword: true,
          }));
        }

        throw new Error(
          result.error ?? "Unable to update your password.",
        );
      }

      setAuth((current) => ({
        ...current,
        hasPassword: true,
        linkedProviders: current.linkedProviders.includes("email")
          ? current.linkedProviders
          : [...current.linkedProviders, "email"],
      }));

      setPasswordState((current) => ({
        ...current,
        current: "",
        password: "",
        confirm: "",
        busy: false,
        success: result.othersSignedOut
          ? t(
              "Password updated. Your other devices were signed out.",
              "បានប្តូរពាក្យសម្ងាត់។ ឧបករណ៍ផ្សេងទៀតរបស់អ្នកត្រូវបានចាកចេញ។",
            )
          : t(
              "Password updated successfully.",
              "បានប្តូរពាក្យសម្ងាត់ដោយជោគជ័យ។",
            ),
      }));
    } catch (error) {
      setPasswordState((current) => ({
        ...current,
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to update your password.",
      }));
    }
  }

  /**
   * Sign-in methods that can actually authenticate this account:
   * every linked OAuth provider, plus the email/password one.
   * Removing the last of these would lock the user out, so it is blocked.
   */
  const signInMethodCount = useMemo(() => {
    const oauth = auth.linkedProviders.filter(
      (provider) => provider !== "email",
    ).length;

    return oauth + (auth.hasPassword ? 1 : 0);
  }, [auth.linkedProviders, auth.hasPassword]);

  async function connectProvider(providerId: string) {
    setProviderBusy(providerId);
    setProviderNotice(null);

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.linkIdentity({
        provider: providerId as "google" | "facebook",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/dashboard/settings/security`,
        },
      });

      if (error) {
        throw error;
      }

      // On success the browser leaves for the provider, so nothing
      // below this line runs.
    } catch (error) {
      setProviderBusy(null);
      setProviderNotice(
        error instanceof Error
          ? error.message
          : "Unable to connect that sign-in method.",
      );
    }
  }

  async function disconnectProvider(
    providerId: string,
    providerName: string,
  ) {
    if (signInMethodCount < 2) {
      setProviderNotice(
        t(
          `${providerName} is your only way to sign in. Set a password or connect another provider first, then you can disconnect it.`,
          `${providerName} គឺជាវិធីតែមួយគត់ដែលអ្នកអាចចូលគណនីបាន។ សូមកំណត់ពាក្យសម្ងាត់ ឬភ្ជាប់ក្រុមហ៊ុនផ្តល់សេវាផ្សេងទៀតជាមុនសិន ទើបអ្នកអាចផ្តាច់វាបាន។`,
        ),
      );
      return;
    }

    setProviderBusy(providerId);
    setProviderNotice(null);

    try {
      const supabase = createClient();

      const { data, error: listError } =
        await supabase.auth.getUserIdentities();

      if (listError) {
        throw listError;
      }

      const identity = data?.identities?.find(
        (item) => item.provider === providerId,
      );

      if (!identity) {
        throw new Error(
          `${providerName} is not connected to this account.`,
        );
      }

      const { error } =
        await supabase.auth.unlinkIdentity(identity);

      if (error) {
        throw error;
      }

      setAuth((current) => ({
        ...current,
        linkedProviders: current.linkedProviders.filter(
          (item) => item !== providerId,
        ),
        identityCount: Math.max(0, current.identityCount - 1),
      }));

      setProviderNotice(
        t(
          `${providerName} was disconnected.`,
          `${providerName} ត្រូវបានផ្តាច់។`,
        ),
      );
    } catch (error) {
      setProviderNotice(
        error instanceof Error
          ? error.message
          : "Unable to disconnect that sign-in method.",
      );
    } finally {
      setProviderBusy(null);
    }
  }

  async function saveRecoveryEmail() {
    setRecoveryState((current) => ({
      ...current,
      busy: true,
      error: null,
      success: null,
    }));

    try {
      const response = await fetch("/api/account/recovery-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recoveryEmail: recoveryState.value.trim(),
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        recoveryEmail?: string | null;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to save your recovery email.",
        );
      }

      setAuth((current) => ({
        ...current,
        recoveryEmail: result.recoveryEmail ?? null,
      }));

      setRecoveryState((current) => ({
        ...current,
        busy: false,
        success: result.recoveryEmail
          ? t("Recovery email saved.", "បានរក្សាទុកអ៊ីមែលសង្គ្រោះ។")
          : t("Recovery email removed.", "បានលុបអ៊ីមែលសង្គ្រោះ។"),
      }));
    } catch (error) {
      setRecoveryState((current) => ({
        ...current,
        busy: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save your recovery email.",
      }));
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-[clamp(18px,4vw,72px)] pt-[clamp(18px,4vh,56px)] pb-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[30px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[34px]">
            {t("Login & security", "ការចូលគណនី និងសុវត្ថិភាព")}
          </h1>
          <p className="mt-1.5 text-base text-slate-500">
            {t("Manage how you sign in and keep your account secure.", "គ្រប់គ្រងរបៀបចូលគណនី និងរក្សាគណនីរបស់អ្នកឲ្យមានសុវត្ថិភាព។")}
          </p>
        </div>

        <a
          href="https://t.me/tenh_chat_support_bot"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 text-sm font-semibold text-blue-600 shadow-sm transition hover:bg-blue-50"
        >
          <Icon
            name="help"
            className="h-4.5 w-4.5"
          />
          {t("Need help?", "ត្រូវការជំនួយ?")}
        </a>
      </header>

      {pageError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.05)]">
        <SettingRow
          icon={
            <Icon
              name="lock"
              className="h-6 w-6"
            />
          }
          iconTone="border-blue-200 bg-blue-50 text-blue-600"
          title={t("Password", "ពាក្យសម្ងាត់")}
          description={t("Update your password regularly to keep your account safe.", "ធ្វើបច្ចុប្បន្នភាពពាក្យសម្ងាត់របស់អ្នកជាប្រចាំ ដើម្បីរក្សាគណនីឲ្យមានសុវត្ថិភាព។")}
          middle={
            loading ? (
              <span className="text-slate-400">
                {t("Checking...", "កំពុងពិនិត្យ...")}
              </span>
            ) : auth.hasPassword ? (
              <span className="tracking-[0.16em] text-slate-600">
                ••••••••
              </span>
            ) : (
              <StatusChip tone="gray">
                {t("Not set", "មិនទាន់កំណត់")}
              </StatusChip>
            )
          }
          action={
            <button
              type="button"
              onClick={() =>
                setPasswordState((current) => ({
                  ...current,
                  open: true,
                  current: "",
                  password: "",
                  confirm: "",
                  error: null,
                  success: null,
                }))
              }
              className="rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
            >
              {auth.hasPassword
                ? t("Change password", "ប្តូរពាក្យសម្ងាត់")
                : t("Set password", "កំណត់ពាក្យសម្ងាត់")}
            </button>
          }
        />

        {LINKABLE_PROVIDERS.map((provider) => {
          const connected = auth.linkedProviders.includes(
            provider.id,
          );

          const busy = providerBusy === provider.id;

          return (
            <SettingRow
              key={provider.id}
              icon={provider.icon}
              iconTone={provider.tone}
              title={t(
                `${provider.name} sign-in`,
                `ការចូលដោយ ${provider.name}`,
              )}
              description={t(
                `Use your ${provider.name} account to sign in to TENH.`,
                `ប្រើគណនី ${provider.name} របស់អ្នក ដើម្បីចូលទៅ TENH។`,
              )}
              middle={
                loading ? (
                  <span className="text-slate-400">
                    {t("Checking...", "កំពុងពិនិត្យ...")}
                  </span>
                ) : connected ? (
                  <StatusChip>
                    {t("Connected", "បានភ្ជាប់")} <span>✓</span>
                  </StatusChip>
                ) : (
                  <StatusChip tone="gray">
                    {t("Not connected", "មិនបានភ្ជាប់")}
                  </StatusChip>
                )
              }
              action={
                <button
                  type="button"
                  disabled={loading || busy}
                  onClick={() =>
                    void (connected
                      ? disconnectProvider(
                          provider.id,
                          provider.name,
                        )
                      : connectProvider(provider.id))
                  }
                  className={`rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                    connected
                      ? "border-slate-300 text-slate-700 hover:bg-slate-50"
                      : "border-blue-200 text-blue-600 hover:bg-blue-50"
                  }`}
                >
                  {busy
                    ? t("Working...", "កំពុងដំណើរការ...")
                    : connected
                      ? t("Disconnect", "ផ្តាច់")
                      : t("Connect", "ភ្ជាប់")}
                </button>
              }
            />
          );
        })}

        {providerNotice ? (
          <p className="border-b border-slate-200 bg-slate-50 px-6 py-3 text-sm text-slate-600">
            {providerNotice}
          </p>
        ) : null}

        <SettingRow
          icon={
            <Icon
              name="mail"
              className="h-6 w-6"
            />
          }
          iconTone="border-emerald-200 bg-emerald-50 text-emerald-600"
          title={t("Email verification", "ការផ្ទៀងផ្ទាត់អ៊ីមែល")}
          description={
            auth.emailVerified
              ? t("Your email address is verified.", "អាសយដ្ឋានអ៊ីមែលរបស់អ្នកត្រូវបានផ្ទៀងផ្ទាត់។")
              : t("Verify your email address to improve account security.", "ផ្ទៀងផ្ទាត់អាសយដ្ឋានអ៊ីមែលរបស់អ្នក ដើម្បីបង្កើនសុវត្ថិភាពគណនី។")
          }
          middle={
            loading ? (
              <span className="text-slate-400">
                {t("Checking...", "កំពុងពិនិត្យ...")}
              </span>
            ) : auth.emailVerified ? (
              <StatusChip>
                {t("Verified", "បានផ្ទៀងផ្ទាត់")} <span>✓</span>
              </StatusChip>
            ) : (
              <StatusChip tone="gray">
                {t("Not verified", "មិនទាន់ផ្ទៀងផ្ទាត់")}
              </StatusChip>
            )
          }
        />

        <SettingRow
          icon={
            <Icon
              name="mail"
              className="h-6 w-6"
            />
          }
          iconTone="border-orange-200 bg-orange-50 text-orange-500"
          title={t("Recovery email", "អ៊ីមែលសម្រាប់សង្គ្រោះ")}
          description={t("Use this email to recover your account if needed.", "ប្រើអ៊ីមែលនេះ ដើម្បីសង្គ្រោះគណនីរបស់អ្នកនៅពេលចាំបាច់។")}
          middle={
            <span className="break-all">
              {loading
                ? t("Checking...", "កំពុងពិនិត្យ...")
                : (auth.recoveryEmail ??
                  t("Not set", "មិនទាន់កំណត់"))}
            </span>
          }
          action={
            <button
              type="button"
              onClick={() =>
                setRecoveryState({
                  open: true,
                  value: auth.recoveryEmail ?? "",
                  busy: false,
                  error: null,
                  success: null,
                })
              }
              className="rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
            >
              {auth.recoveryEmail
                ? t("Edit", "កែសម្រួល")
                : t("Add", "បន្ថែម")}
            </button>
          }
        />

        <SettingRow
          icon={
            <Icon
              name="activity"
              className="h-6 w-6"
            />
          }
          iconTone="border-blue-200 bg-blue-50 text-blue-600"
          title={t("Recent security activity", "សកម្មភាពសុវត្ថិភាពថ្មីៗ")}
          description={t("Review important security events from your account.", "ពិនិត្យមើលព្រឹត្តិការណ៍សុវត្ថិភាពសំខាន់ៗពីគណនីរបស់អ្នក។")}
          action={
            <button
              type="button"
              onClick={() =>
                router.push(
                  "/dashboard/settings/sessions",
                )
              }
              className="rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
            >
              {t("View activity", "មើលសកម្មភាព")}
            </button>
          }
        />

        <SettingRow
          icon={
            <Icon
              name="trash"
              className="h-6 w-6"
            />
          }
          iconTone="border-red-200 bg-red-50 text-red-600"
          title={t("Delete account", "លុបគណនី")}
          description={t("Permanently delete your TENH login and personal account data. If you are the only Owner of an active subscription, TENH will ask whether to transfer it or end it too.", "លុបការចូល TENH និងទិន្នន័យគណនីផ្ទាល់ខ្លួនរបស់អ្នកជាអចិន្ត្រៃយ៍។ ប្រសិនបើអ្នកជាម្ចាស់តែម្នាក់នៃការជាវសកម្ម TENH នឹងសួរថាតើត្រូវផ្ទេរ ឬបញ្ចប់វាដែរឬទេ។")}
          danger
          action={
            <DeleteAccountSection
              email={auth.email}
              variant="row"
              buttonLabel={t("Delete account", "លុបគណនី")}
            />
          }
        />
      </section>

      <section className="flex flex-col gap-4 rounded-[20px] border border-blue-200 bg-gradient-to-r from-blue-50/80 to-violet-50/50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_8px_24px_rgba(37,99,235,0.22)]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              className="h-7 w-7"
              aria-hidden="true"
            >
              <path
                d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="m9 12 2 2 4-5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div>
            <h2 className="font-bold text-slate-950">
              {t("We take your security seriously", "យើងយកចិត្តទុកដាក់ខ្ពស់ចំពោះសុវត្ថិភាពរបស់អ្នក")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("TENH uses industry-standard security measures to keep your data safe and protected.", "TENH ប្រើវិធានការសុវត្ថិភាពតាមស្តង់ដារឧស្សាហកម្ម ដើម្បីរក្សាទិន្នន័យរបស់អ្នកឲ្យមានសុវត្ថិភាព និងការពារ។")}
            </p>
          </div>
        </div>

        <a
          href="/dashboard/settings/security/learn-more"
          className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          {t("Learn more about security", "ស្វែងយល់បន្ថែមអំពីសុវត្ថិភាព")}
          <Icon
            name="chevron"
            className="h-4 w-4"
          />
        </a>
      </section>

      {passwordState.open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-password-title"
        >
          <div className="w-full max-w-lg rounded-[24px] border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2
                id="change-password-title"
                className="text-xl font-bold text-slate-950"
              >
                {t("Change password", "ប្តូរពាក្យសម្ងាត់")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {auth.hasPassword
                  ? t("Confirm your current password, then choose a new one of at least 8 characters.", "បញ្ជាក់ពាក្យសម្ងាត់បច្ចុប្បន្នរបស់អ្នក បន្ទាប់មកជ្រើសរើសពាក្យសម្ងាត់ថ្មីយ៉ាងហោចណាស់ 8 តួអក្សរ។")
                  : t("You signed in with Google, so there is no current password to confirm. Set one of at least 8 characters.", "អ្នកបានចូលដោយ Google ដូច្នេះគ្មានពាក្យសម្ងាត់បច្ចុប្បន្នត្រូវបញ្ជាក់ទេ។ សូមកំណត់យ៉ាងហោចណាស់ 8 តួអក្សរ។")}
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              {auth.hasPassword ? (
                <div>
                  <label className="text-sm font-semibold text-slate-800">
                    {t("Current password", "ពាក្យសម្ងាត់បច្ចុប្បន្ន")}
                  </label>
                  <input
                    type="password"
                    value={passwordState.current}
                    onChange={(event) =>
                      setPasswordState((current) => ({
                        ...current,
                        current: event.target.value,
                        error: null,
                        success: null,
                      }))
                    }
                    autoComplete="current-password"
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  />
                </div>
              ) : null}

              <div>
                <label className="text-sm font-semibold text-slate-800">
                  {t("New password", "ពាក្យសម្ងាត់ថ្មី")}
                </label>
                <input
                  type="password"
                  value={
                    passwordState.password
                  }
                  onChange={(event) =>
                    setPasswordState(
                      (current) => ({
                        ...current,
                        password:
                          event.target.value,
                        error: null,
                        success: null,
                      }),
                    )
                  }
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-800">
                  {t("Confirm password", "បញ្ជាក់ពាក្យសម្ងាត់")}
                </label>
                <input
                  type="password"
                  value={
                    passwordState.confirm
                  }
                  onChange={(event) =>
                    setPasswordState(
                      (current) => ({
                        ...current,
                        confirm:
                          event.target.value,
                        error: null,
                        success: null,
                      }),
                    )
                  }
                  autoComplete="new-password"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
              </div>

              {passwordState.confirm &&
              passwordState.password !==
                passwordState.confirm ? (
                <p className="text-sm text-red-600">
                  {t("Passwords do not match.", "ពាក្យសម្ងាត់មិនត្រូវគ្នា។")}
                </p>
              ) : null}

              <label className="flex items-start gap-3 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={passwordState.signOutOthers}
                  onChange={(event) =>
                    setPasswordState((current) => ({
                      ...current,
                      signOutOthers: event.target.checked,
                    }))
                  }
                  className="mt-1"
                />
                <span>
                  {t("Sign out my other devices after changing the password.", "ចាកចេញពីឧបករណ៍ផ្សេងទៀតរបស់ខ្ញុំ បន្ទាប់ពីប្តូរពាក្យសម្ងាត់។")}
                </span>
              </label>

              {passwordState.error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {passwordState.error}
                </p>
              ) : null}

              {passwordState.success ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {passwordState.success}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                disabled={passwordState.busy}
                onClick={() =>
                  setPasswordState(
                    (current) => ({
                      ...current,
                      open: false,
                    }),
                  )
                }
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                {t("Close", "បិទ")}
              </button>

              <button
                type="button"
                disabled={!passwordReady}
                onClick={() =>
                  void updatePassword()
                }
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {passwordState.busy
                  ? t("Updating...", "កំពុងធ្វើបច្ចុប្បន្នភាព...")
                  : auth.hasPassword
                    ? t("Update password", "ធ្វើបច្ចុប្បន្នភាពពាក្យសម្ងាត់")
                    : t("Set password", "កំណត់ពាក្យសម្ងាត់")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {recoveryState.open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-email-title"
        >
          <div className="w-full max-w-lg rounded-[24px] border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2
                id="recovery-email-title"
                className="text-xl font-bold text-slate-950"
              >
                {t("Recovery email", "អ៊ីមែលសម្រាប់សង្គ្រោះ")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {t("A backup address TENH support can use to reach you if you lose access. Password reset links still go to your account email.", "អាសយដ្ឋានបម្រុងដែលផ្នែកជំនួយ TENH អាចប្រើដើម្បីទាក់ទងអ្នក ប្រសិនបើអ្នកបាត់បង់សិទ្ធិចូល។ តំណកំណត់ពាក្យសម្ងាត់ឡើងវិញនៅតែផ្ញើទៅអ៊ីមែលគណនីរបស់អ្នក។")}
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="text-sm font-semibold text-slate-800">
                  {t("Recovery email address", "អាសយដ្ឋានអ៊ីមែលសង្គ្រោះ")}
                </label>
                <input
                  type="email"
                  value={recoveryState.value}
                  onChange={(event) =>
                    setRecoveryState((current) => ({
                      ...current,
                      value: event.target.value,
                      error: null,
                      success: null,
                    }))
                  }
                  placeholder="backup@example.com"
                  autoComplete="email"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
                <p className="mt-2 text-xs text-slate-500">
                  {t("Leave it empty to remove your recovery email.", "ទុកឲ្យទទេ ដើម្បីលុបអ៊ីមែលសង្គ្រោះរបស់អ្នក។")}
                </p>
              </div>

              {recoveryState.error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {recoveryState.error}
                </p>
              ) : null}

              {recoveryState.success ? (
                <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {recoveryState.success}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                disabled={recoveryState.busy}
                onClick={() =>
                  setRecoveryState((current) => ({
                    ...current,
                    open: false,
                  }))
                }
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                {t("Close", "បិទ")}
              </button>

              <button
                type="button"
                disabled={recoveryState.busy}
                onClick={() => void saveRecoveryEmail()}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {recoveryState.busy
                  ? t("Saving...", "កំពុងរក្សាទុក...")
                  : t("Save", "រក្សាទុក")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </main>
  );
}
