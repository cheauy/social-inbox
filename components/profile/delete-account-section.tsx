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
};

function statusLabel(status: string) {
  if (status === "trialing") {
    return "Trial";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function DeleteAccountSection({
  email,
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

  return (
    <>
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

          <button
            type="button"
            onClick={() => {
              resetModalState();
              setOpen(true);
            }}
            className="shrink-0 rounded-xl border border-red-200 bg-white px-5 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
          >
            Delete account
          </button>
        </div>
      </section>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[24px] border border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-red-600">
                  Danger zone
                </p>
                <h2
                  id="delete-account-title"
                  className="mt-1 text-2xl font-bold text-slate-950"
                >
                  Delete your account?
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  This is permanent. TENH verifies subscription ownership again
                  on the server immediately before deletion.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={deleting}
                aria-label="Close delete account dialog"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-500 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                <p className="font-bold">What will be deleted</p>
                <p className="mt-2 leading-6 text-red-800">
                  Your login account, personal profile information, profile
                  image, and your membership/access to TENH subscriptions will
                  be removed. Historical team references are anonymized as
                  “Deleted user”.
                </p>
                <p className="mt-2 leading-6 text-red-800">
                  Shared customer conversations/messages, paid invoices and
                  receipts, and records TENH must retain for billing, security,
                  fraud prevention, or legal obligations are not silently
                  destroyed with one user account.
                </p>
              </div>

              {checking ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
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
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                  <p className="font-bold">Choose what happens to your subscription</p>
                  <p className="mt-1 leading-6 text-amber-900">
                    You are the only active Owner for the subscription
                    {blockingSubscriptions.length === 1 ? "" : "s"} below.
                    You can keep the workspace by giving Owner access to another
                    active user, or delete anyway and end the subscription too.
                  </p>

                  <div className="mt-4 space-y-3">
                    {blockingSubscriptions.map((subscription) => (
                      <div
                        key={subscription.businessId}
                        className="rounded-xl border border-amber-200 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-bold text-slate-950">
                            {subscription.businessName}
                          </p>
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                            {statusLabel(subscription.status)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 space-y-3">
                    <label
                      className={`block rounded-xl border bg-white p-4 transition ${
                        ownerDecision === "transfer"
                          ? "border-blue-500 ring-2 ring-blue-100"
                          : "border-slate-200"
                      } ${!canTransferAll ? "opacity-70" : "cursor-pointer"}`}
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
                          className="mt-1 h-4 w-4"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-slate-950">
                            Keep subscription — give another user Owner access
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-600">
                            The workspace, remaining prepaid period, channels,
                            members, conversations, and billing history stay with
                            the new Owner after your account is deleted.
                          </p>
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
                                value={
                                  selectedOwners[subscription.businessId] ?? ""
                                }
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
                                  <option
                                    key={candidate.memberId}
                                    value={candidate.memberId}
                                  >
                                    {candidate.name}
                                    {candidate.email
                                      ? ` — ${candidate.email}`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {!canTransferAll ? (
                        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                          At least one subscription has no other active user. Add
                          or reactivate a user first if you want to keep that
                          subscription.
                        </div>
                      ) : null}
                    </label>

                    <label
                      className={`block cursor-pointer rounded-xl border p-4 transition ${
                        ownerDecision === "delete_subscriptions"
                          ? "border-red-500 bg-red-50 ring-2 ring-red-100"
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
                          className="mt-1 h-4 w-4"
                        />
                        <div>
                          <p className="font-bold text-red-700">
                            Delete anyway — end subscription too
                          </p>
                          <p className="mt-1 text-xs leading-5 text-red-700">
                            TENH will immediately end the listed active/trial
                            subscription, disable its connected channels, remove
                            workspace access for all members, and then delete your
                            account. Remaining prepaid time is forfeited and this
                            action does not create a refund.
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
                            className="mt-0.5 h-4 w-4 rounded border-red-300"
                          />
                          <span className="text-xs leading-5 text-red-800">
                            I understand these subscription(s) will end
                            immediately and every member will lose access to the
                            affected workspace(s).
                          </span>
                        </label>
                      ) : null}
                    </label>
                  </div>

                  {!canTransferAll ? (
                    <a
                      href="/dashboard/settings/users"
                      className="mt-4 inline-flex rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-bold text-amber-900 transition hover:bg-amber-100"
                    >
                      Manage users
                    </a>
                  ) : null}
                </div>
              ) : null}

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={(event) => setUnderstood(event.target.checked)}
                  disabled={deleting || checking}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <span className="text-sm leading-6 text-slate-600">
                  I understand this permanently deletes my TENH login and
                  personal profile data, revokes my workspace access, and cannot
                  be undone.
                </span>
              </label>

              <div>
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
                  className="mt-2 w-full rounded-xl border border-red-200 bg-white px-4 py-3 font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-red-500 focus:ring-4 focus:ring-red-100 disabled:bg-slate-100"
                />

                {email ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Account: {email}
                  </p>
                ) : null}
              </div>

              {error ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={deleting}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={deleteAccount}
                disabled={!canDelete}
                className="rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
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
