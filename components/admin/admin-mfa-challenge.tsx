"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type Factor = {
  id: string;
  friendly_name?: string | null;
  factor_type?: string | null;
  status?: string | null;
};

export function AdminMfaChallenge() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [selectedFactorId, setSelectedFactorId] =
    useState<string>("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [factorResponse, aalResponse] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);

      if (factorResponse.error) {
        throw factorResponse.error;
      }

      if (aalResponse.error) {
        throw aalResponse.error;
      }

      if (aalResponse.data.currentLevel === "aal2") {
        router.replace("/dashboard/admin");
        router.refresh();
        return;
      }

      const factorData = factorResponse.data as unknown as {
        all?: Factor[];
        totp?: Factor[];
      };

      const verified = (
        factorData.all ?? factorData.totp ?? []
      ).filter(
        (factor) =>
          factor.factor_type === "totp" &&
          factor.status === "verified",
      );

      setFactors(verified);
      setSelectedFactorId((current) =>
        verified.some((factor) => factor.id === current)
          ? current
          : verified[0]?.id ?? "",
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load your TENH Admin authenticator.",
      );
    } finally {
      setLoading(false);
    }
  }, [router, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function verify() {
    const safeCode = code.replace(/\s+/g, "");

    if (!selectedFactorId) {
      setError("No verified authenticator factor is available.");
      return;
    }

    if (!/^\d{6}$/.test(safeCode)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }

    setVerifying(true);
    setError(null);

    try {
      const { error: verifyError } =
        await supabase.auth.mfa.challengeAndVerify({
          factorId: selectedFactorId,
          code: safeCode,
        });

      if (verifyError) {
        throw verifyError;
      }

      router.replace("/dashboard/admin");
      router.refresh();
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "The authenticator code was not accepted.",
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        <div className="bg-slate-950 px-6 py-6 text-white sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
            TENH Admin Security
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            Verify your authenticator
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Enter the current 6-digit code before opening the Administration center.
          </p>
        </div>

        <div className="space-y-5 p-6 sm:p-8">
          {error ? (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-slate-500">
              Checking your authenticator...
            </p>
          ) : factors.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              No verified TENH Admin authenticator is enrolled. To recover safely, temporarily set TENH_ADMIN_REQUIRE_MFA=false on the server, redeploy, enroll 2FA from Admin → Security, verify it, then turn the requirement back on.
            </div>
          ) : (
            <>
              {factors.length > 1 ? (
                <div>
                  <label className="text-sm font-semibold text-slate-800">
                    Authenticator
                  </label>
                  <select
                    value={selectedFactorId}
                    onChange={(event) =>
                      setSelectedFactorId(event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    {factors.map((factor) => (
                      <option key={factor.id} value={factor.id}>
                        {factor.friendly_name || "TENH Admin authenticator"}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div>
                <label className="text-sm font-semibold text-slate-800">
                  6-digit code
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && code.length === 6) {
                      void verify();
                    }
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="000000"
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.32em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <button
                type="button"
                onClick={() => void verify()}
                disabled={verifying || code.length !== 6}
                className="w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {verifying ? "Verifying..." : "Verify and open Admin"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
