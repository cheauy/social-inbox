"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerTagSelector } from "@/components/inbox/customer-tag-selector";
import { CustomerNotes } from "@/components/inbox/customer-notes";
import { CustomerFilesModal } from "@/components/inbox/customer-files-modal";
import { ReminderModal } from "@/components/inbox/reminder-modal";
import {
  getInitial,
  getStatusClasses,
  getStatusLabel,
} from "@/components/inbox/inbox-utils";
import type { InboxConversation } from "@/types/inbox";

type CustomerProfileProps = {
  activeConversation: InboxConversation | null;
};

type CustomerForm = {
  phone: string;
  customerNote: string;
};

type CustomerBaseline = {
  phone: string | null;
  customerNote: string | null;
};

type ConflictContact = {
  id: string;
  phone: string | null;
  address: string | null;
  customer_note: string | null;
  updated_at: string | null;
};

type CustomerConflict = {
  message: string;
  conflictingFields: string[];
  currentContact: ConflictContact | null;
};

const emptyForm: CustomerForm = {
  phone: "",
  customerNote: "",
};

function comparableText(
  value: string | null | undefined,
): string {
  return (value ?? "").trim();
}

function baselineMatchesContact(
  baseline: CustomerBaseline | null,
  contact: InboxConversation["contact"] | null,
): boolean {
  if (!baseline || !contact) {
    return true;
  }

  return (
    comparableText(baseline.phone) ===
      comparableText(contact.phone) &&
    comparableText(baseline.customerNote) ===
      comparableText(contact.customer_note)
  );
}

function formatProfileDate(
  value: string | null | undefined,
) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CustomerProfile({
  activeConversation,
}: CustomerProfileProps) {
  const router = useRouter();

  const [editing, setEditing] =
    useState(false);
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [form, setForm] =
    useState<CustomerForm>(emptyForm);
  const [baseline, setBaseline] =
    useState<CustomerBaseline | null>(null);
  const [conflict, setConflict] =
    useState<CustomerConflict | null>(null);
  const [reminderOpen, setReminderOpen] =
    useState(false);
  const [filesOpen, setFilesOpen] =
    useState(false);

  const contact = activeConversation?.contact ?? null;

  const liveConflictDetected =
    editing &&
    !baselineMatchesContact(
      baseline,
      contact,
    );

  useEffect(() => {
    setEditing(false);
    setError(null);
    setConflict(null);
    setBaseline(null);
    setForm(emptyForm);
    setReminderOpen(false);
    setFilesOpen(false);
  }, [activeConversation?.id]);

function startEditing() {
  if (!contact) {
    return;
  }

  setForm({
    phone: contact.phone ?? "",
    customerNote:
      contact.customer_note ?? "",
  });

  setBaseline({
    phone: contact.phone,
    customerNote:
      contact.customer_note,
  });

  setConflict(null);
  setError(null);
  setEditing(true);
}

function loadLatestValues() {
  if (!contact) {
    return;
  }

  const latest =
    conflict?.currentContact ?? null;

  const latestPhone = latest
    ? latest.phone
    : contact.phone;

  const latestCustomerNote = latest
    ? latest.customer_note
    : contact.customer_note;

  setForm({
    phone: latestPhone ?? "",
    customerNote:
      latestCustomerNote ?? "",
  });

  setBaseline({
    phone: latestPhone,
    customerNote:
      latestCustomerNote,
  });

  setConflict(null);
  setError(null);

  /*
   * Ask the server for the newest enriched inbox data too.
   * The form above is updated immediately from the 409 payload,
   * so this refresh does not block the agent.
   */
  router.refresh();
}

async function saveProfile() {
  if (!contact || !activeConversation) {
    return;
  }

  setSaving(true);
  setError(null);

  try {
    const response = await fetch(
      `/api/contacts/${contact.id}`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          conversationId:
            activeConversation.id,

          phone: form.phone,

          customerNote:
            form.customerNote,

          /*
           * V2.9B optimistic concurrency token.
           * These are the values that were on screen when editing began.
           * The API refuses to overwrite a newer agent change.
           */
          expected: {
            phone: baseline
              ? baseline.phone
              : contact.phone,
            customerNote: baseline
              ? baseline.customerNote
              : contact.customer_note,
          },
        }),
      },
    );

    const result =
      (await response.json()) as {
        success?: boolean;
        error?: string;

        contact?: {
          id: string;
          phone: string | null;
          customer_note:
            | string
            | null;
        };

        changedFields?: Array<{
          field: string;
          label: string;
          oldValue: string | null;
          newValue: string | null;
        }>;

        activityRecorded?: boolean;

        conflict?: boolean;
        conflictingFields?: string[];
        currentContact?:
          | ConflictContact
          | null;
      };

    if (
      response.status === 409 &&
      result.conflict
    ) {
      setConflict({
        message:
          result.error ??
          "Customer information changed by another agent.",
        conflictingFields:
          result.conflictingFields ?? [],
        currentContact:
          result.currentContact ?? null,
      });

      setError(null);
      return;
    }

    if (
      !response.ok ||
      !result.success
    ) {
      throw new Error(
        result.error ??
          "Unable to update customer profile.",
      );
    }

    setEditing(false);
    setError(null);
    setConflict(null);
    setBaseline(null);

    router.refresh();
  } catch (saveError) {
    setError(
      saveError instanceof Error
        ? saveError.message
        : "Unable to update customer profile.",
    );
  } finally {
    setSaving(false);
  }
}
  if (!contact || !activeConversation) {
    return (
      <aside className="border-l border-slate-200 bg-white">
        <div className="flex h-full items-center justify-center p-6">
          <p className="text-center text-sm text-slate-500">
            Select a conversation to view the
            customer profile.
          </p>
        </div>
      </aside>
    );
  }

 return (
  <aside className="flex h-full min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white">
    {/* Fixed customer header */}
    <div className="shrink-0 border-b border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {contact.profile_picture_url ? (
            <img
              src={contact.profile_picture_url}
              alt=""
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-100 text-2xl font-semibold text-blue-700">
              {getInitial(contact.full_name)}
            </div>
          )}

          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900">
              {contact.full_name ??
                "Facebook customer"}
            </h2>

            <p className="mt-1 break-all text-sm text-slate-500">
              ID: {contact.platform_user_id}
            </p>
          </div>
        </div>

      <div className="flex shrink-0 items-center gap-2">
  {!editing ? (
    <button
      type="button"
      onClick={startEditing}
      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
    >
      Edit
    </button>
  ) : null}
</div>
      </div>
    </div>

    {/* Scrollable profile content */}
    <div className="min-h-0 flex-1 overflow-y-auto">
      {editing ? (
        <div className="space-y-4 p-5">
          {(liveConflictDetected || conflict) ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">
                  !
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-900">
                    Customer information changed
                  </p>

                  <p className="mt-1 text-sm leading-5 text-amber-800">
                    {conflict?.message ??
                      "Another agent changed this customer while you were editing. Load the latest values before saving so their changes are not overwritten."}
                  </p>

                  {conflict?.conflictingFields
                    .length ? (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      Changed: {conflict.conflictingFields.join(", ")}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={loadLatestValues}
                    className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                  >
                    Load latest values
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <ProfileInput
            label="Phone"
            value={form.phone}
            placeholder="+855..."
            type="tel"
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                phone: value,
              }))
            }
          />

        
          <div>
            <label className="text-sm font-medium text-slate-700">
              Customer Notes
            </label>

            <textarea
              value={form.customerNote}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  customerNote:
                    event.target.value,
                }))
              }
              rows={5}
              placeholder="Add  customer information..."
              className="mt-1 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error ? (
            <p className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveProfile()}
              disabled={
                saving ||
                liveConflictDetected ||
                Boolean(conflict)
              }
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {saving
                ? "Saving..."
                : "Save profile"}
            </button>

            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
                setConflict(null);
                setBaseline(null);
              }}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-6 p-5">
       <ProfileSection title="Contact information">
  <CopyableProfileValue
    label="Customer name"
    value={
      contact.full_name ??
      "Facebook customer"
    }
  />

  <CopyableProfileValue
    label="Phone"
    value={contact.phone}
    emptyText="Not added"
  />
</ProfileSection>

  <ProfileSection title="Customer note">
  <CopyableProfileValue
    label="Note"
    value={contact.customer_note}
    emptyText="No customer note has been added."
  />
</ProfileSection>

<CustomerNotes
  contactId={contact.id}
  conversationId={
    activeConversation.id
  }
  currentMemberId={
    activeConversation.assigned_to
  }
  currentMemberName={
    activeConversation.assigned_member
      ?.full_name ?? null
  }
/>
          <ProfileSection title="Facebook information">
            <ProfileValue
              label="Customer ID"
              value={contact.platform_user_id}
              breakAll
            />

            <ProfileValue
              label="Page"
              value={
                activeConversation.social_account
                  ?.account_name ??
                "Facebook Page"
              }
            />
          </ProfileSection>

          <ProfileSection title="Conversation">
            <div>
              <p className="text-xs text-slate-500">
                Status
              </p>

              <span
                className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClasses(
                  activeConversation.status,
                )}`}
              >
                {getStatusLabel(
                  activeConversation.status,
                )}
              </span>
            </div>

            <ProfileValue
              label="Assigned to"
              value={
                activeConversation.assigned_member
                  ?.full_name ??
                "Unassigned"
              }
            />

            <ProfileValue
              label="Customer since"
              value={formatProfileDate(
                contact.created_at,
              )}
            />

            <ProfileValue
              label="Last active"
              value={formatProfileDate(
                contact.last_contact_at,
              )}
            />
          </ProfileSection>
          <section className="border-t border-slate-200 pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Other
            </p>

            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => setReminderOpen(true)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                Create reminder
              </button>

              <button
                type="button"
                onClick={() => setFilesOpen(true)}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                Files, documents & links
              </button>

              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Report spam
              </button>
            </div>
          </section>
        </div>
      )}
    </div>

    {reminderOpen ? (
      <ReminderModal
        conversationId={activeConversation.id}
        contactId={contact.id}
        customerName={
          contact.full_name ?? "Facebook customer"
        }
        defaultAssignedTo={
          activeConversation.assigned_to
        }
        onClose={() => setReminderOpen(false)}
        onCreated={() => {
          setReminderOpen(false);
          window.dispatchEvent(
            new CustomEvent("tenh-reminder-changed"),
          );
        }}
      />
    ) : null}

    {filesOpen ? (
      <CustomerFilesModal
        contactId={contact.id}
        conversationId={activeConversation.id}
        customerName={
          contact.full_name ?? "Facebook customer"
        }
        onClose={() => setFilesOpen(false)}
      />
    ) : null}
  </aside>
);
}

type ProfileInputProps = {
  label: string;
  value: string;
  placeholder?: string;
  type?: "text" | "email" | "tel";
  onChange: (value: string) => void;
};

function ProfileInput({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
}: ProfileInputProps) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700">
        {label}
      </label>

      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </div>
  );
}

type ProfileSectionProps = {
  title: string;
  children: React.ReactNode;
};

function ProfileSection({
  title,
  children,
}: ProfileSectionProps) {
  return (
    <section className="border-t border-slate-200 pt-5 first:border-t-0 first:pt-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </p>

      <div className="mt-3 space-y-3">
        {children}
      </div>
    </section>
  );
}

type ProfileValueProps = {
  label: string;
  value: string;
  breakAll?: boolean;
};

function ProfileValue({
  label,
  value,
  breakAll = false,
}: ProfileValueProps) {
  return (
    <div>
      <p className="text-xs text-slate-500">
        {label}
      </p>

      <p
        className={`text-sm font-medium text-slate-800 ${
          breakAll ? "break-all" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <rect
        x="8"
        y="8"
        width="11"
        height="11"
        rx="2"
      />

      <path
        d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyableProfileValue({
  label,
  value,
  emptyText = "Not added",
}: {
  label: string;
  value: string | null | undefined;
  emptyText?: string;
}) {
  const [copied, setCopied] =
    useState(false);

  const displayValue =
    value?.trim() || emptyText;

  const canCopy =
    Boolean(value?.trim());

  async function copyValue() {
    if (!value?.trim()) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        value,
      );

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      window.alert(
        "Unable to copy this value.",
      );
    }
  }

  return (
    <div>
      <p className="text-xs text-slate-500">
        {label}
      </p>

      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="min-w-0 flex-1 break-words text-sm text-slate-900">
          {displayValue}
        </p>

        {canCopy ? (
          <button
            type="button"
            onClick={() =>
              void copyValue()
            }
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition ${
              copied
                ? "bg-emerald-50 text-emerald-600"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            }`}
            title={
              copied
                ? "Copied"
                : `Copy ${label.toLowerCase()}`
            }
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="h-4 w-4"
              >
                <path
                  d="M5 13l4 4L19 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <CopyIcon />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}