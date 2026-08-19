"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";

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


function getRegisterApiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "Unable to create your account right now. Please try again.";
  }

  const error = (payload as { error?: unknown }).error;

  return typeof error === "string" && error.trim()
    ? error.trim()
    : "Unable to create your account right now. Please try again.";
}

export function RegisterForm() {
  const searchParams = useSearchParams();
  const inviteToken =
    searchParams.get("invite")?.trim() ?? "";

  const [inviteInfo, setInviteInfo] = useState<{
    email: string;
    role: "agent" | "owner";
    businessName: string;
    subscriptionLabel: string;
  } | null>(null);
  const [inviteLoading, setInviteLoading] =
    useState(Boolean(inviteToken));

  const [fullName, setFullName] =
    useState("");

  const [workspaceName, setWorkspaceName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [
    showPassword,
    setShowPassword,
  ] = useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadInvitation() {
      if (!inviteToken) {
        setInviteLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/invitations/accept?token=${encodeURIComponent(inviteToken)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const result = (await response.json()) as {
          success?: boolean;
          error?: string;
          invitation?: {
            email: string;
            role: "agent" | "owner";
            businessName: string;
            subscriptionLabel: string;
          };
        };

        if (!response.ok || !result.success || !result.invitation) {
          throw new Error(
            result.error ??
              "Unable to verify this TENH invitation.",
          );
        }

        if (!cancelled) {
          setInviteInfo(result.invitation);
          setEmail(result.invitation.email);
          setWorkspaceName(result.invitation.businessName);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to verify this TENH invitation.",
          );
        }
      } finally {
        if (!cancelled) {
          setInviteLoading(false);
        }
      }
    }

    void loadInvitation();

    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const normalizedEmail =
      email.trim().toLowerCase();

    if (
      !fullName.trim() ||
      (!inviteToken && !workspaceName.trim()) ||
      (inviteToken && !inviteInfo) ||
      !normalizedEmail ||
      !password ||
      !confirmPassword
    ) {
      setError(
        inviteToken ? "Complete the invitation registration fields." : "Please complete every field.",
      );

      return;
    }

    if (password.length < 8) {
      setError(
        "Password must contain at least 8 characters.",
      );

      return;
    }

    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError(
        "Password must include at least one letter and one number.",
      );

      return;
    }

    if (password !== confirmPassword) {
      setError(
        "Passwords do not match.",
      );

      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/auth/register",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            fullName: fullName.trim(),
            workspaceName:
              workspaceName.trim(),
            email: normalizedEmail,
            password,
            inviteToken:
              inviteToken || undefined,
          }),
        },
      );

      const payload = (await response
        .json()
        .catch(() => null)) as
        | {
            success?: boolean;
            email?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.success) {
        setError(
          getRegisterApiErrorMessage(
            payload,
          ),
        );
        setLoading(false);
        return;
      }

      const verificationEmail =
        payload.email || normalizedEmail;

      sessionStorage.setItem(
        "tenh_verification_email",
        verificationEmail,
      );

      if (inviteToken) {
        sessionStorage.setItem(
          "tenh_pending_invitation_token",
          inviteToken,
        );
      }

      const inviteQuery = inviteToken
        ? `&invite=${encodeURIComponent(inviteToken)}`
        : "";

      window.location.assign(
        `/verify-email?email=${encodeURIComponent(
          verificationEmail,
        )}${inviteQuery}`,
      );
    } catch {
      // Registration now goes through TENH's same-origin server route instead
      // of calling Supabase Auth directly from the browser. This avoids
      // exposing retryable browser/network auth errors in the Next.js dev
      // overlay and gives the customer a stable error message.
      setError(
        "TENH could not reach the registration service. Check your connection and try again.",
      );
      setLoading(false);
    }
  }

  const fieldClass =
    "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100";

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 space-y-5"
    >
      <div>
        <label
          htmlFor="register-name"
          className="text-sm font-bold text-slate-900"
        >
          Full name
        </label>

        <input
          id="register-name"
          value={fullName}
          onChange={(event) =>
            setFullName(
              event.target.value,
            )
          }
          disabled={loading}
          autoComplete="name"
          placeholder="Your full name"
          required
          className={fieldClass}
        />
      </div>

      {inviteToken ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">
            Existing workspace invitation
          </p>
          {inviteLoading ? (
            <p className="mt-2 text-sm text-slate-600">
              Verifying invitation...
            </p>
          ) : inviteInfo ? (
            <>
              <p className="mt-2 font-bold text-slate-900">
                {inviteInfo.businessName}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {inviteInfo.subscriptionLabel} · {inviteInfo.role === "owner" ? "Owner" : "Agent"}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                This registration joins the existing subscription after email verification. TENH will not create another free trial.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-red-700">
              This invitation cannot be used.
            </p>
          )}
        </div>
      ) : (
        <div>
          <label
            htmlFor="register-workspace"
            className="text-sm font-bold text-slate-900"
          >
            Business / workspace name
          </label>

          <input
            id="register-workspace"
            value={workspaceName}
            onChange={(event) =>
              setWorkspaceName(
                event.target.value,
              )
            }
            disabled={loading}
            autoComplete="organization"
            placeholder="Example: Apex Clothing"
            required
            className={fieldClass}
          />

          <p className="mt-2 text-xs leading-5 text-slate-500">
            Your 7-day free trial includes 3 channel connections and 1 user. It starts after email verification and first sign-in.
          </p>
        </div>
      )}

      <div>
        <label
          htmlFor="register-email"
          className="text-sm font-bold text-slate-900"
        >
          Email address
        </label>

        <input
          id="register-email"
          type="email"
          value={email}
          onChange={(event) =>
            setEmail(
              event.target.value,
            )
          }
          disabled={loading || Boolean(inviteToken)}
          autoComplete="email"
          placeholder="you@example.com"
          required
          className={fieldClass}
        />
      </div>

      <div>
        <label
          htmlFor="register-password"
          className="text-sm font-bold text-slate-900"
        >
          Password
        </label>

        <div className="relative mt-2">
          <input
            id="register-password"
            type={
              showPassword
                ? "text"
                : "password"
            }
            value={password}
            onChange={(event) =>
              setPassword(
                event.target.value,
              )
            }
            disabled={loading}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 pr-12 font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
          />

          <button
            type="button"
            onClick={() =>
              setShowPassword(
                (current) => !current,
              )
            }
            disabled={loading}
            className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label={
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
      </div>

      <div>
        <label
          htmlFor="register-confirm-password"
          className="text-sm font-bold text-slate-900"
        >
          Confirm password
        </label>

        <div className="relative mt-2">
          <input
            id="register-confirm-password"
            type={
              showConfirmPassword
                ? "text"
                : "password"
            }
            value={confirmPassword}
            onChange={(event) =>
              setConfirmPassword(
                event.target.value,
              )
            }
            disabled={loading}
            autoComplete="new-password"
            placeholder="Enter password again"
            required
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 pr-12 font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
          />

          <button
            type="button"
            onClick={() =>
              setShowConfirmPassword(
                (current) => !current,
              )
            }
            disabled={loading}
            className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label={
              showConfirmPassword
                ? "Hide confirmation password"
                : "Show confirmation password"
            }
          >
            {showConfirmPassword ? (
              <EyeOffIcon />
            ) : (
              <EyeIcon />
            )}
          </button>
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
          loading ||
          !fullName.trim() ||
          !workspaceName.trim() ||
          !email.trim() ||
          !password ||
          !confirmPassword
        }
        className="flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />

            Creating account...
          </span>
        ) : (
          "Create account"
        )}
      </button>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-bold text-blue-600 hover:text-blue-700"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}