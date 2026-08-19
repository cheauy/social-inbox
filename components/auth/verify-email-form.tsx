"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
  type FormEvent,
} from "react";

import { useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function VerifyEmailForm() {
  const searchParams =
    useSearchParams();

  const emailFromQuery =
    searchParams.get("email") ?? "";

  const inviteFromQuery =
    searchParams.get("invite")?.trim() ?? "";

  const [inviteToken, setInviteToken] =
    useState(inviteFromQuery);

  const [email, setEmail] =
    useState(emailFromQuery);

  const [token, setToken] =
    useState("");

  const [verifying, setVerifying] =
    useState(false);

  const [resending, setResending] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState<string | null>(null);

    const [verified, setVerified] =
  useState(false);

  useEffect(() => {
    if (inviteFromQuery) {
      setInviteToken(inviteFromQuery);
    } else {
      const storedInvite =
        sessionStorage.getItem(
          "tenh_pending_invitation_token",
        );

      if (storedInvite) {
        setInviteToken(storedInvite);
      }
    }

    if (emailFromQuery) {
      setEmail(emailFromQuery);
      return;
    }

    const storedEmail =
      sessionStorage.getItem(
        "tenh_verification_email",
      );

    if (storedEmail) {
      setEmail(storedEmail);
    }
  }, [emailFromQuery, inviteFromQuery]);

  function handleTokenChange(
    value: string,
  ) {
    setToken(
      value.replace(/\D/g, "").slice(0, 8),
    );
  }

  async function handleVerify(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!email || token.length !== 8) {
      setError(
        "Enter the complete eight-digit verification code.",
      );

      return;
    }

    setVerifying(true);
    setError(null);
    setMessage(null);

    try {
      const supabase =
        createClient();

      const {
        data,
        error: verifyError,
      } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "email",
      });

      if (verifyError) {
        throw verifyError;
      }

      if (!data.user) {
        throw new Error(
          "Unable to verify your email.",
        );
      }

      let nextDestination =
        "/dashboard/inbox";
      let successMessage =
        "Email verified successfully.";

      if (inviteToken) {
        const acceptResponse = await fetch(
          "/api/invitations/accept",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
              token: inviteToken,
            }),
          },
        );

        const acceptPayload = (await acceptResponse.json().catch(() => null)) as
          | {
              success?: boolean;
              error?: string;
            }
          | null;

        if (!acceptResponse.ok || !acceptPayload?.success) {
          throw new Error(
            acceptPayload?.error ||
              "Email verified, but TENH could not accept your workspace invitation.",
          );
        }

        sessionStorage.removeItem(
          "tenh_pending_invitation_token",
        );
        nextDestination =
          "/dashboard/inbox?joined=1";
        successMessage =
          "Email verified and workspace invitation accepted.";
      } else {
        const provisionResponse = await fetch(
          "/api/onboarding/ensure-workspace",
          {
            method: "POST",
            cache: "no-store",
          },
        );

        const provisionPayload = (await provisionResponse.json().catch(() => null)) as
          | {
              success?: boolean;
              error?: string;
              trialGranted?: boolean | null;
            }
          | null;

        if (!provisionResponse.ok || !provisionPayload?.success) {
          throw new Error(
            provisionPayload?.error ||
              "Email verified, but TENH could not prepare your workspace.",
          );
        }

        if (provisionPayload.trialGranted === false) {
          nextDestination =
            "/dashboard/subscription?trial=not-eligible";
          successMessage =
            "Email verified. This account is not eligible for another free trial; choose a paid subscription to continue.";
        }
      }

      sessionStorage.removeItem(
        "tenh_verification_email",
      );

      setVerified(true);
      setMessage(successMessage);

      window.setTimeout(() => {
        window.location.assign(
          nextDestination,
        );
      }, 1800);
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "The verification code is invalid or expired.",
      );

      setVerifying(false);
    }
  }

  async function handleResend() {
    if (!email) {
      setError(
        "Email address is missing. Please register again.",
      );

      return;
    }

    setResending(true);
    setError(null);
    setMessage(null);

    try {
      const supabase =
        createClient();

      const { error: resendError } =
        await supabase.auth.resend({
          type: "signup",
          email,
        });

      if (resendError) {
        throw resendError;
      }

      setMessage(
        "A new verification code was sent.",
      );
    } catch (resendError) {
      setError(
        resendError instanceof Error
          ? resendError.message
          : "Unable to resend the verification code.",
      );
    } finally {
      setResending(false);
    }
  }

  if (verified) {
  return (
    <div className="mt-8 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="h-8 w-8 text-emerald-600"
          aria-hidden="true"
        >
          <path
            d="M5 13l4 4L19 7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h2 className="mt-5 text-2xl font-bold text-slate-950">
        Verification complete
      </h2>

      <p className="mt-2 text-sm text-slate-500">
        Your email has been verified successfully.
      </p>

      <div className="mt-6 flex items-center justify-center gap-3 text-sm font-medium text-blue-600">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

        Loading your dashboard...
      </div>
    </div>
  );
}

  return (
    
    <form
      onSubmit={handleVerify}
      className="mt-8 space-y-5"
    >
      <div>
        <label
          htmlFor="verification-email"
          className="text-sm font-bold text-slate-900"
        >
          Email address
        </label>

        <input
          id="verification-email"
          type="email"
          value={email}
          onChange={(event) =>
            setEmail(
              event.target.value,
            )
          }
          disabled={
            verifying || resending
          }
          className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3.5 font-medium text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </div>

      <div>
        <label
          htmlFor="verification-code"
          className="text-sm font-bold text-slate-900"
        >
          Verification code
        </label>

        <input
          id="verification-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={token}
          onChange={(event) =>
            handleTokenChange(
              event.target.value,
            )
          }
          disabled={
            verifying || resending
          }
          maxLength={8}
          placeholder="00000000"
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-4 text-center font-mono text-3xl font-bold tracking-[0.45em] text-slate-950 outline-none placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
        />
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {message ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={
          verifying ||
          resending ||
          !email ||
          token.length !== 8
        }
        className="flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3.5 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {verifying
          ? "Verifying..."
          : "Verify email"}
      </button>

      <button
        type="button"
        onClick={() =>
          void handleResend()
        }
        disabled={
          verifying || resending
        }
        className="w-full text-center text-sm font-bold text-blue-600 hover:text-blue-700 disabled:text-slate-400"
      >
        {resending
          ? "Sending new code..."
          : "Resend verification code"}
      </button>

      <p className="text-center text-sm text-slate-500">
        Wrong email?{" "}
        <Link
          href="/register"
          className="font-bold text-blue-600 hover:text-blue-700"
        >
          Register again
        </Link>
      </p>
    </form>

    
  );
}