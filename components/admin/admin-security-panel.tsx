"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";

type Factor = {
  id: string;
  friendly_name?: string | null;
  factor_type?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type SecurityState = {
  userId: string;
  email: string;
  emailVerified: boolean;
  currentAal: string;
  nextAal: string;
  factors: Factor[];
};

function maskUuid(value: string) {
  if (value.length < 16) {
    return value;
  }

  return `${value.slice(0, 8)}••••${value.slice(-8)}`;
}

function qrImageSource(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith("data:")) {
    return trimmed;
  }

  if (trimmed.startsWith("<svg")) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmed)}`;
  }

  return trimmed;
}

export function AdminSecurityPanel({
  adminMfaRequired,
}: {
  adminMfaRequired: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<SecurityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [enrollment, setEnrollment] =
    useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const loadSecurity = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [userResponse, factorResponse, aalResponse] =
        await Promise.all([
          supabase.auth.getUser(),
          supabase.auth.mfa.listFactors(),
          supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);

      if (userResponse.error || !userResponse.data.user) {
        throw new Error(
          userResponse.error?.message ??
            "Unable to verify the current admin session.",
        );
      }

      if (factorResponse.error) {
        throw new Error(factorResponse.error.message);
      }

      if (aalResponse.error) {
        throw new Error(aalResponse.error.message);
      }

      const factorData = factorResponse.data as unknown as {
        all?: Factor[];
        totp?: Factor[];
        phone?: Factor[];
      };

      const factors =
        factorData.all ?? [
          ...(factorData.totp ?? []),
          ...(factorData.phone ?? []),
        ];

      const assurance = aalResponse.data as unknown as {
        currentLevel?: string | null;
        nextLevel?: string | null;
      };

      setState({
        userId: userResponse.data.user.id,
        email: userResponse.data.user.email ?? "—",
        emailVerified: Boolean(
          userResponse.data.user.email_confirmed_at,
        ),
        currentAal: assurance.currentLevel ?? "aal1",
        nextAal: assurance.nextLevel ?? "aal1",
        factors,
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load admin security status.",
      );
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadSecurity();
  }, [loadSecurity]);

  const verifiedTotpFactors =
    state?.factors.filter(
      (factor) =>
        factor.factor_type === "totp" &&
        factor.status === "verified",
    ) ?? [];

  const unverifiedTotpFactors =
    state?.factors.filter(
      (factor) =>
        factor.factor_type === "totp" &&
        factor.status !== "verified",
    ) ?? [];

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setEnrollment(null);
    setCode("");

    try {
      // Clean up abandoned unverified TOTP setups before starting another one.
      for (const factor of unverifiedTotpFactors) {
        const { error: removeError } =
          await supabase.auth.mfa.unenroll({
            factorId: factor.id,
          });

        if (removeError) {
          throw removeError;
        }
      }

      const { data, error: enrollError } =
        await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "TENH Admin",
        });

      if (enrollError || !data) {
        throw new Error(
          enrollError?.message ?? "Unable to start 2FA setup.",
        );
      }

      const totp = data.totp;

      if (!totp?.qr_code || !totp.secret) {
        throw new Error(
          "Supabase did not return the authenticator QR code.",
        );
      }

      setEnrollment({
        factorId: data.id,
        qrCode: totp.qr_code,
        secret: totp.secret,
      });
    } catch (enrollError) {
      setError(
        enrollError instanceof Error
          ? enrollError.message
          : "Unable to start 2FA setup.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnrollment() {
    const safeCode = code.replace(/\s+/g, "");

    if (!enrollment || !/^\d{6}$/.test(safeCode)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: verifyError } =
        await supabase.auth.mfa.challengeAndVerify({
          factorId: enrollment.factorId,
          code: safeCode,
        });

      if (verifyError) {
        throw verifyError;
      }

      setEnrollment(null);
      setCode("");
      setSuccess(
        "Two-factor authentication is verified. This session is now AAL2.",
      );
      await loadSecurity();
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "The authenticator code could not be verified.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeFactor(factorId: string) {
    if (
      !window.confirm(
        "Remove this TENH Admin authenticator factor? Do not continue unless you still have a safe way to restore admin access.",
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: removeError } =
        await supabase.auth.mfa.unenroll({ factorId });

      if (removeError) {
        throw removeError;
      }

      setSuccess("Authenticator factor removed.");
      await loadSecurity();
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Unable to remove the authenticator factor.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading && !state) {
    return (
      <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">
          Loading admin security status...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          {success}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
            Administrator identity
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">
            Protected TENH administrator
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Administration access is bound to the configured Supabase user ID and email on the server.
          </p>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-400">
              Admin email
            </p>
            <p className="mt-1 break-all text-sm font-bold text-slate-900">
              {state?.email ?? "—"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-400">
              Supabase user ID
            </p>
            <p className="mt-1 font-mono text-sm font-bold text-slate-900">
              {state ? maskUuid(state.userId) : "—"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-400">
              Email verified
            </p>
            <p className="mt-1 text-sm font-bold text-slate-900">
              {state?.emailVerified ? "Yes" : "No"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-400">
              Current session
            </p>
            <p className="mt-1 text-sm font-bold uppercase text-slate-900">
              {state?.currentAal ?? "—"}
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-600">
              Two-factor authentication
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              Authenticator app
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Use Google Authenticator, Microsoft Authenticator, 1Password, Authy, or another TOTP-compatible app.
            </p>
          </div>

          <span
            className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-bold ${
              verifiedTotpFactors.length > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            {verifiedTotpFactors.length > 0
              ? "2FA enrolled"
              : "2FA not enrolled"}
          </span>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-400">
                MFA enforcement
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900">
                {adminMfaRequired ? "Required" : "Not required yet"}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-400">
                Current AAL
              </p>
              <p className="mt-1 text-sm font-bold uppercase text-slate-900">
                {state?.currentAal ?? "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold text-slate-400">
                Next available AAL
              </p>
              <p className="mt-1 text-sm font-bold uppercase text-slate-900">
                {state?.nextAal ?? "—"}
              </p>
            </div>
          </div>

          {verifiedTotpFactors.length === 0 && !enrollment ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
              <h3 className="font-bold text-blue-950">
                Set up TENH Admin 2FA
              </h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-blue-800/80">
                Keep TENH_ADMIN_REQUIRE_MFA=false until you finish this setup and verify one code successfully.
              </p>
              <button
                type="button"
                onClick={() => void startEnrollment()}
                disabled={busy}
                className="mt-4 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Starting..." : "Set up 2FA"}
              </button>
            </div>
          ) : null}

          {enrollment ? (
            <div className="grid gap-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                {/* Supabase returns either a QR data URL or SVG-compatible value. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrImageSource(enrollment.qrCode)}
                  alt="TENH Admin authenticator QR code"
                  className="mx-auto h-auto w-full max-w-[260px]"
                />
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  Step 1
                </p>
                <h3 className="mt-1 text-lg font-bold text-slate-950">
                  Scan the QR code
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Add TENH Admin to your authenticator app. Then enter the current 6-digit code below.
                </p>

                <button
                  type="button"
                  onClick={() => setShowSecret((current) => !current)}
                  className="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  {showSecret ? "Hide setup key" : "Can’t scan? Show setup key"}
                </button>

                {showSecret ? (
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-700">
                      Keep this setup key private
                    </p>
                    <p className="mt-1 break-all font-mono text-sm font-bold text-amber-950">
                      {enrollment.secret}
                    </p>
                  </div>
                ) : null}

                <div className="mt-5 max-w-sm">
                  <label className="text-sm font-semibold text-slate-800">
                    6-digit verification code
                  </label>
                  <input
                    value={code}
                    onChange={(event) =>
                      setCode(
                        event.target.value
                          .replace(/\D/g, "")
                          .slice(0, 6),
                      )
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-lg tracking-[0.25em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={() => void verifyEnrollment()}
                    disabled={busy || code.length !== 6}
                    className="mt-3 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {busy ? "Verifying..." : "Enable 2FA"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {verifiedTotpFactors.length > 0 ? (
            <div className="space-y-3">
              {verifiedTotpFactors.map((factor) => (
                <div
                  key={factor.id}
                  className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-bold text-emerald-950">
                      {factor.friendly_name || "TENH Admin authenticator"}
                    </p>
                    <p className="mt-1 text-xs text-emerald-800/70">
                      Verified factor · {maskUuid(factor.id)}
                    </p>
                  </div>

                  {state?.currentAal === "aal2" ? (
                    <button
                      type="button"
                      onClick={() => void removeFactor(factor.id)}
                      disabled={busy}
                      className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Remove factor
                    </button>
                  ) : (
                    <Link
                      href="/dashboard/admin/mfa"
                      className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-center text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                    >
                      Verify 2FA session
                    </Link>
                  )}
                </div>
              ))}
            </div>
          ) : null}

          {verifiedTotpFactors.length > 0 && !adminMfaRequired ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              2FA is enrolled. After you confirm this page shows a verified factor and your current session can reach AAL2, set <strong>TENH_ADMIN_REQUIRE_MFA=true</strong> in Vercel and redeploy.
            </div>
          ) : null}

          {adminMfaRequired ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
              TENH Admin MFA enforcement is ON. Admin pages and mutation APIs require an AAL2 session.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
