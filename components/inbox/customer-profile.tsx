"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerTagSelector } from "@/components/inbox/customer-tag-selector";
import { CustomerNotes } from "@/components/inbox/customer-notes";
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
  fullName: string;
  phone: string;
  email: string;
  companyName: string;
  customerNote: string;
};

const emptyForm: CustomerForm = {
  fullName: "",
  phone: "",
  email: "",
  companyName: "",
  customerNote: "",
};

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


  type ProfileForm = {
  phone: string;
  customerNote: string;
};


  const [editing, setEditing] =
    useState(false);
  const [saving, setSaving] =
    useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [form, setForm] =
    useState<CustomerForm>(emptyForm);

  const contact = activeConversation?.contact ?? null;

  useEffect(() => {
    setEditing(false);
    setError(null);
    setForm(emptyForm);
  }, [activeConversation?.id]);

  function startEditing() {
    if (!contact) {
      return;
    }

    setForm({
      fullName: contact.full_name ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      companyName: contact.company_name ?? "",
      customerNote: contact.customer_note ?? "",
    });

    setError(null);
    setEditing(true);
  }

  async function saveProfile() {
    if (!contact) {
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
            "Content-Type": "application/json",
          },
          body: JSON.stringify(form),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ??
            "Unable to update customer.",
        );
      }

      setEditing(false);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update customer.",
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
              Notes
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
              placeholder="Add internal customer information..."
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
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:bg-slate-300"
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
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                Create reminder
              </button>

              <button
                type="button"
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