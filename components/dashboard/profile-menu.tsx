"use client";

import Link from "next/link";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

type ProfileMenuProps = {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
};

function getInitial(name?: string | null) {
  return (
    name?.trim().charAt(0).toUpperCase() ||
    "U"
  );
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="8"
        r="4"
      />

      <path
        d="M4 21a8 8 0 0 1 16 0"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LogoutIcon() {
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
        d="M10 17l5-5-5-5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M15 12H3"
        strokeLinecap="round"
      />

      <path
        d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ProfileMenu({
  name,
  email,
  avatarUrl,
}: ProfileMenuProps) {
  const [open, setOpen] =
    useState(false);

  const [signingOut, setSigningOut] =
    useState(false);

  const displayName =
    name?.trim() || "Tenh Chat User";

  async function handleSignOut() {
    setSigningOut(true);

    try {
      const supabase =
        createClient();

      const { error } =
        await supabase.auth.signOut();

      if (error) {
        throw error;
      }

      window.location.replace("/login");
    } catch (signOutError) {
      console.error(
        "Unable to sign out:",
        signOutError,
      );

      setSigningOut(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() =>
          setOpen((current) => !current)
        }
        className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-slate-950 font-semibold text-white transition hover:ring-4 hover:ring-blue-100"
        aria-label="Open profile menu"
        aria-expanded={open}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          getInitial(displayName)
        )}
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() =>
              setOpen(false)
            }
            aria-label="Close profile menu"
          />

          <div className="absolute right-0 top-14 z-50 w-72 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-700">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    getInitial(
                      displayName,
                    )
                  )}
                </div>

                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">
                    {displayName}
                  </p>

                  <p className="truncate text-sm text-slate-500">
                    {email ?? "No email"}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-2">
              <Link
                href="/dashboard/profile"
                onClick={() =>
                  setOpen(false)
                }
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                <UserIcon />

                Profile information
              </Link>
            </div>

            <div className="border-t border-slate-200 p-2">
              <button
                type="button"
                onClick={() =>
                  void handleSignOut()
                }
                disabled={signingOut}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
              >
                {signingOut ? (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-red-200 border-t-red-600" />
                ) : (
                  <LogoutIcon />
                )}

                {signingOut
                  ? "Signing out..."
                  : "Sign out"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}