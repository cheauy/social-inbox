"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

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
  paidTimeRemaining?: boolean;
};

type AccountDeletionImpact = {
  canDelete: boolean;
  membershipCount: number;
  activeOwnedSubscriptionCount: number;
  blockingSubscriptions: BlockingSubscription[];
  subscriptions?: { businessId: string; businessName: string; status: string }[];
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
  const submitting = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
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

  const transferReady = blockingSubscriptions.length > 0 && blockingSubscriptions.every(subscription =>
    subscription.candidates.some(candidate => candidate.memberId === selectedOwners[subscription.businessId]));

  const ownerDecisionReady =
    !ownerDecisionRequired ||
    (ownerDecision === "transfer" && transferReady) ||
    (ownerDecision === "delete_subscriptions" &&
      deleteSubscriptionsConfirmed);

  const canDelete =
    confirmText.trim() === CONFIRMATION_TEXT &&
    understood &&
    Boolean(impact && (impact.canDelete || ownerDecisionRequired)) &&
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
    if (submitting.current) {
      return;
    }

    setOpen(false);
    resetModalState();
  }

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

        if (!controller.signal.aborted) setImpact(result.impact);
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
    if (!canDelete || submitting.current) {
      return;
    }

    submitting.current = true;
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
        setOwnerDecision("");
        setSelectedOwners({});
        setDeleteSubscriptionsConfirmed(false);
        setConfirmText("");
        setUnderstood(false);
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
      submitting.current = false;
      setDeleting(false);
    }
  }

  function openModal() {
    if (open || submitting.current) return;
    resetModalState();
    setOpen(true);
  }

  const triggerButton = (
    <button
      type="button"
      onClick={openModal}
      ref={triggerRef}
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
                Permanently delete your TENH Chat login and redact your workspace profile. Shared history and required records remain.
                If you are the only Owner of an active subscription, TENH will ask
                whether to transfer it or end it too.
              </p>
            </div>

            {triggerButton}
          </div>
        </section>
      )}

      <ConfirmActionDialog
        open={open}
        title="Delete account"
        subtitle="Permanent. This cannot be undone."
        description="Your profile and access will be removed."
        confirmLabel="Delete account"
        cancelLabel="Cancel"
        loadingLabel="Deleting account…"
        closeLabel="Close delete account dialog"
        icon="trash"
        loading={deleting}
        confirmDisabled={!canDelete}
        error={error}
        returnFocusRef={triggerRef}
        onCancel={closeModal}
        onConfirm={() => void deleteAccount()}
      >
        <p className="mt-1 text-sm leading-6 text-slate-600">Shared chats and billing records are kept.</p>
        <details className="mt-3 rounded-xl border border-slate-200 px-3 text-sm text-slate-600">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-slate-800 focus-visible:outline-2 focus-visible:outline-blue-600">Details</summary>
          <div className="space-y-2 pb-3 leading-6">
            <p>Your login, personal profile information, profile image and workspace access are removed. Historical team references are anonymized as “Deleted user”.</p>
            <p>Shared customer conversations/messages, paid invoices and receipts, and records required for billing, security, fraud prevention or legal obligations remain.</p>
            <p>Shared history and required records remain retained when a subscription ends. Ending access does not delete shared workspace history.</p>
          </div>
        </details>

        {checking ? <p role="status" className="mt-4 text-sm text-slate-600">Checking subscriptions…</p> : null}
        {!checking && impact ? <section className="mt-5" aria-labelledby="affected-subscriptions-title">
          <h3 id="affected-subscriptions-title" className="text-sm font-bold text-slate-950">Affected subscriptions</h3>
          {(impact.subscriptions ?? blockingSubscriptions).length ? <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 px-3">
            {(impact.subscriptions ?? blockingSubscriptions).map(subscription => {
              const soleOwner = blockingSubscriptions.some(item => item.businessId === subscription.businessId);
              return <li key={subscription.businessId} className="min-w-0 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{subscription.businessName}</p>
                  <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{statusLabel(subscription.status)}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-600">{soleOwner ? "You are the only active owner. Choose an action below." : "Your access will be removed. This subscription will not be ended."}</p>
              </li>;
            })}
          </ul> : <p className="mt-2 text-sm text-slate-600">No subscriptions to review.</p>}
        </section> : null}

        {!checking && ownerDecisionRequired ? <fieldset className="mt-5 space-y-3" disabled={deleting}>
          <legend className="text-sm font-bold text-slate-950">Sole-owner subscriptions</legend>
          <p className="text-xs leading-5 text-slate-600">Choose one action for all {blockingSubscriptions.length === 1 ? "sole-owner subscriptions" : `${blockingSubscriptions.length} sole-owner subscriptions`} listed above.</p>
          <div className={`rounded-xl border p-3 ${ownerDecision === "transfer" ? "border-blue-400 bg-blue-50/30" : "border-slate-200"}`}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input type="radio" name="owner-decision" value="transfer" checked={ownerDecision === "transfer"}
                onChange={() => { setOwnerDecision("transfer"); setDeleteSubscriptionsConfirmed(false); }}
                disabled={!canTransferAll || deleting} className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600" />
              <span className="min-w-0"><span className="block text-sm font-semibold text-slate-950">Transfer ownership</span>
                <span className="mt-1 block text-sm text-slate-600">Keep the workspace and subscription.</span></span>
            </label>
            <a href="/dashboard/settings/users" aria-disabled={deleting} onClick={event => { if (submitting.current) event.preventDefault(); }}
              className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600">Manage users</a>
            {!canTransferAll ? <p className="mt-2 text-xs leading-5 text-slate-600">Add another active user first. {blockingSubscriptions.filter(item => !item.candidates.length).map(item => item.businessName).join(", ")}</p> : null}
            {ownerDecision === "transfer" ? <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
              {blockingSubscriptions.map(subscription => <div key={subscription.businessId}>
                <label htmlFor={`new-owner-${subscription.businessId}`} className="text-xs font-semibold text-slate-800">New owner for {subscription.businessName}</label>
                <select id={`new-owner-${subscription.businessId}`} value={selectedOwners[subscription.businessId] ?? ""}
                  onChange={event => setSelectedOwners(current => ({ ...current, [subscription.businessId]: event.target.value }))}
                  className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600">
                  <option value="">Choose an active user</option>
                  {subscription.candidates.map(candidate => <option key={candidate.memberId} value={candidate.memberId}>{candidate.name}{candidate.email ? ` — ${candidate.email}` : ""}</option>)}
                </select>
              </div>)}
            </div> : null}
          </div>
          <label className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3 ${ownerDecision === "delete_subscriptions" ? "border-red-300 bg-red-50/40" : "border-slate-200"}`}>
            <input type="radio" name="owner-decision" value="delete_subscriptions" checked={ownerDecision === "delete_subscriptions"}
              onChange={() => { setOwnerDecision("delete_subscriptions"); setDeleteSubscriptionsConfirmed(false); }}
              className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" />
            <span className="min-w-0"><span className="block text-sm font-semibold text-slate-950">End subscription</span>
              <span className="mt-1 block text-sm text-slate-600">All members lose access. Channels disconnect.</span>
              {blockingSubscriptions.some(item => item.paidTimeRemaining) ? <span className="mt-2 block text-xs leading-5 text-red-700">Unused paid time is lost. No refund.</span> : null}
            </span>
          </label>
        </fieldset> : null}

        <fieldset className="mt-5 space-y-3 border-t border-slate-200 pt-4" disabled={!impact || deleting || checking}>
          <legend className="text-sm font-bold text-slate-950">Confirm account deletion</legend>
          {ownerDecisionRequired && ownerDecision === "delete_subscriptions" ? <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" checked={deleteSubscriptionsConfirmed} onChange={event => setDeleteSubscriptionsConfirmed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-red-600" />
            <span className="text-sm leading-6 text-slate-700">I understand the sole-owner subscriptions listed above will end immediately, all members will lose workspace access, and connected channels will disconnect.</span>
          </label> : null}
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input type="checkbox" checked={understood} onChange={event => setUnderstood(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-red-600" />
            <span className="text-sm leading-6 text-slate-700">I understand this permanently deletes my TENH login, redacts my workspace profile, revokes my workspace access, and cannot be undone.</span>
          </label>
          <div>
            <label htmlFor="delete-account-confirmation" className="text-sm font-semibold text-slate-900">Type {CONFIRMATION_TEXT} to confirm</label>
            <input id="delete-account-confirmation" value={confirmText} onChange={event => setConfirmText(event.target.value)} autoComplete="off" spellCheck={false}
              placeholder={CONFIRMATION_TEXT} className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-red-600" />
          </div>
          {email ? <p className="break-words text-xs text-slate-500">Account: {email}</p> : null}
        </fieldset>
      </ConfirmActionDialog>
    </>
  );
}
