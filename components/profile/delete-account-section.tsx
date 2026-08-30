"use client";

import { useEffect, useMemo, useState } from "react";

const CONFIRMATION_TEXT = "DELETE MY ACCOUNT";

type OwnerCandidate = {
  memberId: string;
  name: string;
  email: string | null;
  role: string;
};

type BlockingSubscription = {
  businessId: string;
  businessName: string;
  status: string;
  candidates: OwnerCandidate[];
};

type AccountDeletionImpact = {
  canDelete: boolean;
  membershipCount: number;
  activeOwnedSubscriptionCount: number;
  blockingSubscriptions: BlockingSubscription[];
};

type OwnerDecision = "transfer" | "delete_subscriptions" | "";

type DeleteAccountSectionProps = {
  email: string;
  /**
   * "card" renders the standalone Danger zone panel.
   * "row" renders only the trigger button, for embedding inside an
   * existing settings row. The modal is identical in both cases.
   */
  variant?: "card" | "row";
  buttonLabel?: string;
};

function statusLabel(status: string) {
  if (status === "trialing") {
    return "Trial";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function DeleteAccountSection({
  email,
  variant = "card",
  buttonLabel = "Delete account",
}: DeleteAccountSectionProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [impact, setImpact] =
    useState<AccountDeletionImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ownerDecision, setOwnerDecision] =
    useState<OwnerDecision>("");
  const [selectedOwners, setSelectedOwners] = useState<
    Record<string, string>
  >({});
  const [deleteSubscriptionsConfirmed, setDeleteSubscriptionsConfirmed] =
    useState(false);

  const blockingSubscriptions = impact?.blockingSubscriptions ?? [];
  const ownerDecisionRequired =
    impact?.canDelete === false && blockingSubscriptions.length > 0;

  const canTransferAll = blockingSubscriptions.every(
    (subscription) => subscription.candidates.length > 0,
  );

  const transferReady = useMemo(
    () =>
      blockingSubscriptions.length > 0 &&
      blockingSubscriptions.every(
        (subscription) =>
          Boolean(selectedOwners[subscription.businessId]),
      ),
    [blockingSubscriptions, selectedOwners],
  );

  const ownerDecisionReady =
    !ownerDecisionRequired ||
    (ownerDecision === "transfer" && transferReady) ||
    (ownerDecision === "delete_subscriptions" &&
      deleteSubscriptionsConfirmed);

  const canDelete =
    confirmText.trim() === CONFIRMATION_TEXT &&
    understood &&
    Boolean(impact) &&
    ownerDecisionReady &&
    !checking &&
    !deleting;

  function resetModalState() {
    setConfirmText("");
    setUnderstood(false);
    setImpact(null);
    setError(null);
    setChecking(false);
    setOwnerDecision("");
    setSelectedOwners({});
    setDeleteSubscriptionsConfirmed(false);
  }

  function closeModal() {
    if (deleting) {
      return;
    }

    setOpen(false);
    resetModalState();
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, deleting]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const controller = new AbortController();

    async function checkDeletionSafety() {
      setChecking(true);
      setImpact(null);
      setError(null);

      try {
        const response = await fetch("/api/account/delete", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        const result = (await response.json()) as {
          success?: boolean;
          impact?: AccountDeletionImpact;
          error?: string;
        };

        if (!response.ok || !result.success || !result.impact) {
          throw new Error(
            result.error ??
              "Unable to verify whether this account can be deleted safely.",
          );
        }

        setImpact(result.impact);
      } catch (checkError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          checkError instanceof Error
            ? checkError.message
            : "Unable to verify whether this account can be deleted safely.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setChecking(false);
        }
      }
    }

    void checkDeletionSafety();

    return () => {
      controller.abort();
    };
  }, [open]);

  async function deleteAccount() {
    if (!canDelete) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch("/api/account/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          confirmation: confirmText.trim(),
          understood,
          ownerDecision: ownerDecisionRequired
            ? ownerDecision
            : undefined,
          ownerTransfers:
            ownerDecision === "transfer"
              ? blockingSubscriptions.map((subscription) => ({
                  businessId: subscription.businessId,
                  memberId:
                    selectedOwners[subscription.businessId] ?? "",
                }))
              : undefined,
          deleteSubscriptionsConfirmed:
            ownerDecision === "delete_subscriptions"
              ? deleteSubscriptionsConfirmed
              : undefined,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        code?: string;
        impact?: AccountDeletionImpact;
        error?: string;
      };

      if (result.impact) {
        setImpact(result.impact);
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to delete your account.",
        );
      }

      window.location.assign("/login?accountDeleted=1");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete your account.",
      );
      setDeleting(false);
    }
  }

  function openModal() {
    resetModalState();
    setOpen(true);
  }

  const triggerButton = (
    <button
      type="button"
      onClick={openModal}
      className="shrink-0 rounded-xl border border-red-200 bg-white px-5 py-3 text-sm font-semibold text-red-600 transition hover:border-red-300 hover:bg-red-50"
    >
      {buttonLabel}
    </button>
  );

  return (
    <>
      {variant === "row" ? (
        triggerButton
      ) : (
        <section className="mt-6 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-600">
                Danger zone
              </p>
              <h2 className="mt-2 text-xl font-bold text-slate-950">
                Delete account
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Permanently delete your TENH Chat login and personal account data.
                If you are the only Owner of an active subscription, TENH will ask
                whether to transfer it or end it too.
              </p>
            </div>

            {triggerButton}
          </div>
        </section>
      )}

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div className="max-h-[94vh] w-full max-w-[820px] overflow-y-auto rounded-[22px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
            <div className="sticky top-0 z-20 flex items-start justify-between gap-5 border-b border-slate-200 bg-white/95 px-5 py-5 backdrop-blur sm:px-8 sm:py-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-red-600">
                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-red-50">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                      <path d="M12 3 2.8 19h18.4L12 3Z" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M12 9v4" strokeLinecap="round" />
                      <path d="M12 16.5h.01" strokeLinecap="round" />
                    </svg>
                  </span>
                  <p className="text-xs font-extrabold uppercase tracking-[0.14em]">
                    Danger zone
                  </p>
                </div>

                <h2
                  id="delete-account-title"
                  className="mt-2 text-[28px] font-extrabold tracking-[-0.035em] text-slate-950 sm:text-[32px]"
                >
                  Delete your account
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-[15px]">
                  This action is permanent. TENH verifies subscription ownership on the server
                  immediately before deletion.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={deleting}
                aria-label="Close delete account dialog"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-2xl font-light leading-none text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500 sm:h-14 sm:w-14">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true">
                      <path d="M4 7h16" strokeLinecap="round" />
                      <path d="M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="m7 7 1 13h8l1-13" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M10 11v5M14 11v5" strokeLinecap="round" />
                    </svg>
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-slate-950">
                      What will be deleted
                    </h3>
                    <div className="mt-3 divide-y divide-slate-200 text-sm leading-6 text-slate-700">
                      <div className="flex gap-3 pb-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                        <p>
                          Your login account, personal profile information, profile image, and all memberships
                          and access to TENH subscriptions will be removed. Historical team references are
                          anonymized as “Deleted user”.
                        </p>
                      </div>
                      <div className="flex gap-3 pt-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-500" />
                        <p>
                          Shared customer conversations/messages, paid invoices and receipts, and records TENH
                          must retain for billing, security, fraud prevention, or legal obligations are not deleted.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {checking ? (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                  Checking subscription ownership and account safety...
                </div>
              ) : null}

              {!checking && impact?.canDelete ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <p className="font-bold">Ready to delete</p>
                  <p className="mt-1 leading-6">
                    TENH did not find an active subscription that needs an Owner
                    decision before this account can be deleted.
                  </p>
                </div>
              ) : null}

              {!checking && ownerDecisionRequired ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 sm:h-14 sm:w-14">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M22 21v-2a4 4 0 0 0-3-3.87" strokeLinecap="round" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" />
                      </svg>
                    </div>

                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-bold text-slate-950">
                        Choose what happens to your subscription
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        You are the only active Owner for the subscription
                        {blockingSubscriptions.length === 1 ? "" : "s"} below. You can keep the workspace by
                        giving Owner access to another active user, or delete anyway and end the subscription too.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {blockingSubscriptions.map((subscription) => (
                      <div
                        key={subscription.businessId}
                        className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5" aria-hidden="true">
                              <path d="M4 21h16V7l-8-4-8 4v14Z" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01" strokeLinecap="round" />
                            </svg>
                          </div>
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {subscription.businessName}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-100">
                          {statusLabel(subscription.status)}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 space-y-3">
                    <label
                      className={`block rounded-xl border p-4 transition ${
                        ownerDecision === "transfer"
                          ? "border-blue-400 bg-blue-50/40 ring-2 ring-blue-100"
                          : "border-slate-200 bg-white"
                      } ${!canTransferAll ? "opacity-80" : "cursor-pointer"}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="owner-decision"
                          value="transfer"
                          checked={ownerDecision === "transfer"}
                          onChange={() => {
                            setOwnerDecision("transfer");
                            setDeleteSubscriptionsConfirmed(false);
                          }}
                          disabled={!canTransferAll || deleting}
                          className="mt-1 h-5 w-5 shrink-0 accent-blue-600"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-bold text-slate-950">
                                Keep subscription — give another user Owner access
                              </p>
                              <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">
                                The workspace, channels, messages, comments, members, conversations, and billing
                                history stay with the new Owner after your account is deleted.
                              </p>
                            </div>

                            {!canTransferAll ? (
                              <a
                                href="/dashboard/settings/users"
                                onClick={(event) => event.stopPropagation()}
                                className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                Manage users
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {ownerDecision === "transfer" ? (
                        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                          {blockingSubscriptions.map((subscription) => (
                            <div key={subscription.businessId}>
                              <label
                                htmlFor={`new-owner-${subscription.businessId}`}
                                className="text-xs font-bold text-slate-800"
                              >
                                New Owner for {subscription.businessName}
                              </label>
                              <select
                                id={`new-owner-${subscription.businessId}`}
                                value={selectedOwners[subscription.businessId] ?? ""}
                                onChange={(event) =>
                                  setSelectedOwners((current) => ({
                                    ...current,
                                    [subscription.businessId]: event.target.value,
                                  }))
                                }
                                disabled={deleting}
                                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                              >
                                <option value="">Choose an active user</option>
                                {subscription.candidates.map((candidate) => (
                                  <option key={candidate.memberId} value={candidate.memberId}>
                                    {candidate.name}
                                    {candidate.email ? ` — ${candidate.email}` : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {!canTransferAll ? (
                        <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
                          </svg>
                          <span>
                            There is currently no other active user. Add or reactivate a user first if you want to
                            keep this subscription.
                          </span>
                        </div>
                      ) : null}
                    </label>

                    <label
                      className={`block cursor-pointer rounded-xl border p-4 transition ${
                        ownerDecision === "delete_subscriptions"
                          ? "border-red-400 bg-red-50/60 ring-2 ring-red-100"
                          : "border-red-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="owner-decision"
                          value="delete_subscriptions"
                          checked={ownerDecision === "delete_subscriptions"}
                          onChange={() => setOwnerDecision("delete_subscriptions")}
                          disabled={deleting}
                          className="mt-1 h-5 w-5 shrink-0 accent-red-600"
                        />
                        <div>
                          <p className="font-bold text-slate-950">
                            Delete anyway — end subscription too
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">
                            TENH will immediately end the active or trial subscription, disable connected channels,
                            remove workspace access for all members, and delete the workspace data. Remaining prepaid
                            time is forfeited and no refund is created.
                          </p>
                        </div>
                      </div>

                      {ownerDecision === "delete_subscriptions" ? (
                        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-red-200 bg-white p-3">
                          <input
                            type="checkbox"
                            checked={deleteSubscriptionsConfirmed}
                            onChange={(event) =>
                              setDeleteSubscriptionsConfirmed(event.target.checked)
                            }
                            disabled={deleting}
                            className="mt-0.5 h-4 w-4 rounded border-red-300 accent-red-600"
                          />
                          <span className="text-xs leading-5 text-red-800">
                            I understand these subscription(s) will end immediately and every member will lose access
                            to the affected workspace(s).
                          </span>
                        </label>
                      ) : null}
                    </label>
                  </div>
                </section>
              ) : null}

              <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={understood}
                    onChange={(event) => setUnderstood(event.target.checked)}
                    disabled={deleting || checking}
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-blue-600"
                  />
                  <span className="text-sm leading-6 text-slate-700">
                    I understand this permanently deletes my TENH login and personal profile data,
                    revokes my workspace access, and cannot be undone.
                  </span>
                </label>

                <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                  <label
                    htmlFor="delete-account-confirmation"
                    className="text-sm font-bold text-slate-900"
                  >
                    Type {CONFIRMATION_TEXT} to confirm
                  </label>

                  <input
                    id="delete-account-confirmation"
                    value={confirmText}
                    onChange={(event) => setConfirmText(event.target.value)}
                    disabled={deleting || checking}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={CONFIRMATION_TEXT}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-red-400 focus:ring-4 focus:ring-red-100 disabled:bg-slate-100"
                  />

                  <div className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 text-sm font-bold text-slate-400">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden="true">
                      <rect x="5" y="10" width="14" height="10" rx="2" />
                      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                    </svg>
                    DELETE MY ACCOUNT
                  </div>
                </div>

                {email ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Account: {email}
                  </p>
                ) : null}
              </section>

              {error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="sticky bottom-0 z-20 flex flex-col-reverse gap-3 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-center sm:px-6">
              <button
                type="button"
                onClick={closeModal}
                disabled={deleting}
                className="h-11 min-w-[132px] rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={deleteAccount}
                disabled={!canDelete}
                className="inline-flex h-11 min-w-[240px] items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-4 w-4" aria-hidden="true">
                  <path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
                </svg>
                {deleting
                  ? "Deleting account..."
                  : checking
                    ? "Checking account..."
                    : ownerDecisionRequired && !ownerDecisionReady
                      ? "Choose subscription action"
                      : ownerDecision === "delete_subscriptions"
                        ? "Delete account & end subscription"
                        : "Permanently delete account"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
