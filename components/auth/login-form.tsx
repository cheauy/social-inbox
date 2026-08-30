"use client";

import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { useSearchParams } from "next/navigation";

import type { Provider } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";

function GoogleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.2c1.9-1.8 3-4.4 3-7.5Z"
      />

      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3v2.7A10 10 0 0 0 12 22Z"
      />

      <path
        fill="#FBBC05"
        d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.4H3A10 10 0 0 0 2 12c0 1.6.4 3.1 1 4.6l3.4-2.7Z"
      />

      <path
        fill="#EA4335"
        d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 12 2a10 10 0 0 0-9 5.4l3.4 2.7C7.2 7.7 9.4 5.9 12 5.9Z"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="#1877F2"
      />

      <path
        fill="white"
        d="M13.7 21v-7h2.4l.3-2.7h-2.7V9.5c0-.8.2-1.3 1.4-1.3h1.4V5.8c-.2 0-1-.1-2.1-.1-2.1 0-3.5 1.3-3.5 3.6v2H8.5V14h2.4v7h2.8Z"
      />
    </svg>
  );
}

/*
 * Module scope on purpose: defining these inside LoginForm created a new
 * component type on every render, so React unmounted and remounted the icon
 * each time the password field changed.
 */
function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx="12"
        cy="12"
        r="2.5"
      />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="m3 3 18 18"
        strokeLinecap="round"
      />

      <path
        d="M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15.6 15.6 0 0 1-2.4 3.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M6.2 6.3C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6c1.4 0 2.6-.3 3.7-.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


export function LoginForm() {
  const searchParams =
    useSearchParams();

  const requestedNext =
    searchParams.get("next")?.trim() ?? "";

  const safeNext =
    requestedNext.startsWith("/") &&
    !requestedNext.startsWith("//") &&
    !requestedNext.includes("\\")
      ? requestedNext
      : "/dashboard/inbox";

  const invitationToken = (() => {
    if (!safeNext.startsWith("/invite/accept")) {
      return "";
    }

    try {
      return new URL(
        safeNext,
        "https://tenh.local",
      ).searchParams.get("token")?.trim() ?? "";
    } catch {
      return "";
    }
  })();

  // Chromium extensions/password managers can inject attributes such as
  // fdprocessedid before React hydrates the server HTML. Render the actual
  // controls only after hydration so extension DOM mutations cannot create a
  // server/client markup mismatch on the login screen.
  const [mounted, setMounted] =
    useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const callbackError =
    searchParams.get("error");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [emailLoading, setEmailLoading] =
    useState(false);

const [showPassword, setShowPassword] =
  useState(false);

  const [
    oauthLoading,
    setOauthLoading,
  ] = useState<Provider | null>(null);

  const [error, setError] =
    useState<string | null>(
      callbackError
        ? "Login could not be completed. Please try again."
        : null,
    );

  const busy =
    emailLoading ||
    oauthLoading !== null;

  async function signInWithProvider(
    provider: "google" | "facebook",
  ) {
    setOauthLoading(provider);
    setError(null);

    try {
      const supabase =
        createClient();

      const redirectTo =
        `${window.location.origin}` +
        "/auth/callback" +
        `?next=${encodeURIComponent(safeNext)}`;

      const { error: oauthError } =
        await supabase.auth
          .signInWithOAuth({
            provider,

            options: {
              redirectTo,

              scopes:
                provider === "facebook"
                  ? "email,public_profile"
                  : undefined,
            },
          });

      if (oauthError) {
        throw oauthError;
      }
    } catch (oauthError) {
      setOauthLoading(null);

      setError(
        oauthError instanceof Error
          ? oauthError.message
          : `Unable to sign in with ${provider}.`,
      );
    }
  }

  async function handleEmailLogin(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !email.trim() ||
      !password
    ) {
      return;
    }

    setEmailLoading(true);
    setError(null);

    try {
      const supabase =
        createClient();

      const {
        data,
        error: loginError,
      } =
        await supabase.auth
          .signInWithPassword({
            email:
              email.trim().toLowerCase(),

            password,
          });

      if (loginError) {
        throw loginError;
      }

      if (!data.user) {
        throw new Error(
          "Unable to sign in.",
        );
      }

      if (safeNext.startsWith("/invite/accept")) {
        window.location.assign(safeNext);
        return;
      }

      const provisionResponse = await fetch(
        "/api/onboarding/ensure-workspace",
        {
          method: "POST",
          cache: "no-store",
        },
      );

      const provisionPayload = (await provisionResponse.json().catch(() => null)) as
        | { success?: boolean; error?: string; trialGranted?: boolean | null }
        | null;

      if (!provisionResponse.ok || !provisionPayload?.success) {
        throw new Error(
          provisionPayload?.error ||
            "Unable to prepare your TENH workspace.",
        );
      }

      window.location.assign(
        provisionPayload.trialGranted === false
          ? "/dashboard/subscription?trial=not-eligible"
          : "/dashboard/inbox",
      );
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Unable to sign in.",
      );

      setEmailLoading(false);
    }
  }

  if (!mounted) {
    return (
      <div
        className="mt-8 space-y-3"
        aria-hidden="true"
      >
        <div className="h-12 rounded-xl bg-slate-100" />
        <div className="h-12 rounded-xl bg-slate-100" />
        <div className="my-6 h-px bg-slate-200" />
        <div className="h-12 rounded-xl bg-slate-100" />
        <div className="h-12 rounded-xl bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() =>
            void signInWithProvider(
              "google",
            )
          }
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
        >
          <GoogleIcon />

          {oauthLoading === "google"
            ? "Connecting..."
            : "Continue with Google"}
        </button>

        <button
          type="button"
          onClick={() =>
            void signInWithProvider(
              "facebook",
            )
          }
          disabled={busy}
          className="flex w-full items-center justify-center gap-3 rounded-xl bg-[#1877F2] px-5 py-3 font-semibold text-white transition hover:bg-[#166FE5] disabled:cursor-wait disabled:opacity-60"
        >
          <FacebookIcon />

          {oauthLoading === "facebook"
            ? "Connecting..."
            : "Continue with Facebook"}
        </button>
      </div>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-slate-200" />

        <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Or use email
        </span>

        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <form
        onSubmit={handleEmailLogin}
        className="space-y-5"
      >
        <div>
          <label
            htmlFor="login-email"
            className="text-sm font-bold text-slate-900"
          >
            Email address
          </label>

          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            disabled={busy}
            autoComplete="email"
            required
            placeholder="staff@example.com"
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
          />
        </div>

      <div>
  <div className="flex items-center justify-between gap-3">
    <label
      htmlFor="login-password"
      className="text-sm font-bold text-slate-900"
    >
      Password
    </label>

    <button
      type="button"
      className="text-sm font-bold text-blue-600 hover:text-blue-700"
    >
      Forgot password?
    </button>
  </div>

  <div className="relative mt-2">
    <input
      id="login-password"
      type={
        showPassword
          ? "text"
          : "password"
      }
      value={password}
      onChange={(event) =>
        setPassword(event.target.value)
      }
      disabled={busy}
      autoComplete="current-password"
      required
      placeholder="Enter your password"
      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 pr-12 font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
    />

    <button
      type="button"
      onClick={() =>
        setShowPassword(
          (current) => !current,
        )
      }
      disabled={busy}
      className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
      aria-label={
        showPassword
          ? "Hide password"
          : "Show password"
      }
      title={
        showPassword
          ? "Hide password"
          : "Show password"
      }
    >
      {showPassword ? (
        <EyeOffIcon />
      ) : (
        <EyeIcon />
      )}
    </button>
  </div>

  <div className="relative mt-2">
   <p className="text-center text-sm text-slate-500">
  Don&apos;t have an account?{" "}
  <a
    href={
      invitationToken
        ? `/register?invite=${encodeURIComponent(invitationToken)}`
        : "/register"
    }
    className="font-bold text-blue-600 hover:text-blue-700"
  >
    Create account
  </a>
</p>
  </div>

  
</div>

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={
            busy ||
            !email.trim() ||
            !password
          }
          className="flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {emailLoading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />

              Signing in...
            </span>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-xs leading-5 text-slate-500">
        © 2026 Tenh Chat. All rights reserved..
      </p>
    </div>
  );
}