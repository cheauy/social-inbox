"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

type InvitePreview = {
  email: string;
  role: "agent" | "owner";
  expiresAt: string;
  businessName: string;
  subscriptionId: string;
  subscriptionLabel: string;
};

type PreviewResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  invitation?: InvitePreview;
};

export function InviteAcceptView({
  token,
}: {
  token: string;
}) {
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [preview, setPreview] =
    useState<InvitePreview | null>(null);
  const [signedInEmail, setSignedInEmail] =
    useState<string | null>(null);
  const [error, setError] =
    useState<string | null>(null);

  const nextPath = useMemo(
    () =>
      `/invite/accept?token=${encodeURIComponent(token)}`,
    [token],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!token) {
        setError(
          "This invitation link is missing its secure token.",
        );
        setLoading(false);
        return;
      }

      try {
        const [previewResponse, authResult] =
          await Promise.all([
            fetch(
              `/api/invitations/accept?token=${encodeURIComponent(token)}`,
              {
                method: "GET",
                cache: "no-store",
              },
            ),
            createClient().auth.getUser(),
          ]);

        const result =
          (await previewResponse.json()) as PreviewResponse;

        if (!previewResponse.ok || !result.success) {
          throw new Error(
            result.error ??
              "Unable to verify this TENH invitation.",
          );
        }

        if (!cancelled) {
          setPreview(result.invitation ?? null);
          setSignedInEmail(
            authResult.data.user?.email
              ?.trim()
              .toLowerCase() ?? null,
          );
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
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function signOutWrongAccount() {
    setError(null);

    try {
      await createClient().auth.signOut();
    } finally {
      window.location.assign(
        `/login?next=${encodeURIComponent(nextPath)}`,
      );
    }
  }

  async function acceptInvitation() {
    if (!preview || accepting) {
      return;
    }

    setAccepting(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/invitations/accept",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            token,
          }),
        },
      );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
        };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to accept this invitation.",
        );
      }

      window.location.assign(
        "/dashboard/inbox?joined=1",
      );
    } catch (acceptError) {
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : "Unable to accept this invitation.",
      );
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        <p className="mt-4 text-sm font-medium text-slate-500">
          Verifying invitation...
        </p>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="rounded-3xl border border-red-200 bg-white p-8 text-center shadow-xl">
        <h1 className="text-2xl font-bold text-slate-950">
          Invitation unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-red-700">
          {error ??
            "This invitation is no longer available."}
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white"
        >
          Go to TENH login
        </Link>
      </div>
    );
  }

  const invitedEmail =
    preview.email.trim().toLowerCase();
  const signedInMatches =
    signedInEmail === invitedEmail;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl sm:p-10">
      <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-blue-600">
        TENH workspace invitation
      </p>

      <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
        Join {preview.businessName}
      </h1>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-slate-500">
            Subscription
          </span>
          <span className="font-bold text-slate-800">
            {preview.subscriptionLabel}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-500">
            Role
          </span>
          <span className="font-bold text-slate-800">
            {preview.role === "owner"
              ? "Owner"
              : "Agent"}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-slate-500">
            Invited email
          </span>
          <span className="truncate font-medium text-slate-800">
            {preview.email}
          </span>
        </div>
      </div>

      <p className="mt-5 text-sm leading-6 text-slate-600">
        Accepting joins this existing subscription. It does not create another TENH trial or move any Messenger/Telegram channel.
      </p>

      {error ? (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!signedInEmail ? (
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Link
            href={`/login?next=${encodeURIComponent(nextPath)}`}
            className="flex items-center justify-center rounded-xl border border-slate-300 px-5 py-3 font-bold text-slate-700 hover:bg-slate-50"
          >
            Sign in
          </Link>
          <Link
            href={`/register?invite=${encodeURIComponent(token)}`}
            className="flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700"
          >
            Create account
          </Link>
        </div>
      ) : !signedInMatches ? (
        <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
          <p>
            You are signed in as <strong>{signedInEmail}</strong>, but this invitation was sent to <strong>{preview.email}</strong>.
          </p>
          <button
            type="button"
            onClick={() =>
              void signOutWrongAccount()
            }
            className="mt-3 rounded-xl border border-amber-300 bg-white px-4 py-2 font-bold text-amber-900 hover:bg-amber-100"
          >
            Sign out and use invited email
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={accepting}
          onClick={() =>
            void acceptInvitation()
          }
          className="mt-7 flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3.5 font-bold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
        >
          {accepting
            ? "Joining workspace..."
            : "Accept invitation"}
        </button>
      )}
    </div>
  );
}
