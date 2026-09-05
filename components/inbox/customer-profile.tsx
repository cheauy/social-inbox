"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerNotes } from "@/components/inbox/customer-notes";
import { CustomerFilesModal } from "@/components/inbox/customer-files-modal";
import { ReminderModal } from "@/components/inbox/reminder-modal";
import { ConversationReminderSummary } from "@/components/inbox/conversation-reminder-summary";
import {
  getInitial,
  getStatusClasses,
  getStatusLabel,
} from "@/components/inbox/inbox-utils";
import type { InboxConversation } from "@/types/inbox";
import { getReadableTagTextColor } from "@/lib/display/tag-contrast";
import {
  useWorkspaceLanguageId,
} from "@/components/display/workspace-language-text";

type CustomerProfileProps = {
  activeConversation: InboxConversation | null;
  assigning?: boolean;
  onAssignToMe?: () => void;
  onContactTagsChange?: (
    contactId: string,
    tags: NonNullable<InboxConversation["contact"]>["tags"],
  ) => void;
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
  assigning = false,
  onAssignToMe,
  onContactTagsChange,
}: CustomerProfileProps) {
  const router = useRouter();
  const isKhmer = useWorkspaceLanguageId() === "km";



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
  const [profileTab, setProfileTab] =
    useState<"details" | "notes" | "reminder">("details");
  const [noteCount, setNoteCount] = useState(0);
  const [reminderOpen, setReminderOpen] =
    useState(false);
  const [filesOpen, setFilesOpen] =
    useState(false);

  const contact = activeConversation?.contact ?? null;
  const customerTags =
    contact && Array.isArray(contact.tags)
      ? contact.tags
      : [];

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
            {isKhmer
              ? "ជ្រើសរើសការសន្ទនា ដើម្បីមើលប្រវត្តិរូបអតិថិជន។"
              : "Select a conversation to view the customer profile."}
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
                (isKhmer ? "អតិថិជន Facebook" : "Facebook customer")}
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
      {isKhmer ? "កែសម្រួល" : "Edit"}
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
                    {isKhmer ? "ព័ត៌មានអតិថិជនបានផ្លាស់ប្តូរ" : "Customer information changed"}
                  </p>

                  <p className="mt-1 text-sm leading-5 text-amber-800">
                    {conflict?.message ??
                      (isKhmer
                        ? "ភ្នាក់ងារផ្សេងបានផ្លាស់ប្តូរព័ត៌មានអតិថិជននេះ ខណៈអ្នកកំពុងកែសម្រួល។ សូមផ្ទុកតម្លៃចុងក្រោយ មុនពេលរក្សាទុក ដើម្បីកុំឲ្យការផ្លាស់ប្តូររបស់ពួកគេត្រូវបានសរសេរជាន់។"
                        : "Another agent changed this customer while you were editing. Load the latest values before saving so their changes are not overwritten.")}
                  </p>

                  {conflict?.conflictingFields
                    .length ? (
                    <p className="mt-2 text-xs font-medium text-amber-700">
                      {isKhmer ? "បានផ្លាស់ប្តូរ៖" : "Changed:"} {conflict.conflictingFields.join(", ")}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    onClick={loadLatestValues}
                    className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                  >
                    {isKhmer ? "ផ្ទុកតម្លៃចុងក្រោយ" : "Load latest values"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <ProfileInput
            label={isKhmer ? "លេខទូរស័ព្ទ" : "Phone"}
    icon="phone"
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
              {isKhmer ? "កំណត់ចំណាំអតិថិជន" : "Customer Notes"}
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
              placeholder={isKhmer ? "បន្ថែមព័ត៌មានអតិថិជន..." : "Add  customer information..."}
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
                ? isKhmer ? "កំពុងរក្សាទុក..." : "Saving..."
                : isKhmer ? "រក្សាទុកប្រវត្តិរូប" : "Save profile"}
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
              {isKhmer ? "បោះបង់" : "Cancel"}
            </button>
          </div>
        </div>
      ) : (
        <>
        <div className="flex shrink-0 border-b border-slate-200 bg-white px-2 pt-1">
          {(
            [
              { id: "details", label: isKhmer ? "ព័ត៌មាន" : "Details" },
              { id: "notes", label: isKhmer ? "កំណត់ចំណាំ" : "Notes" },
              { id: "reminder", label: isKhmer ? "ការរំលឹក" : "Reminder" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setProfileTab(item.id)}
              aria-pressed={profileTab === item.id}
              className={`relative flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-xs font-bold transition ${
                profileTab === item.id
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {item.label}
              {item.id === "notes" && noteCount > 0 ? (
                <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[9px] font-bold text-white">
                  {noteCount > 99 ? "99+" : noteCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {profileTab === "details" ? (
        <div className="space-y-6 p-5">
       <ProfileSection title={isKhmer ? "ព័ត៌មានទំនាក់ទំនង" : "Contact information"}>
  <CopyableProfileValue
    label={isKhmer ? "ឈ្មោះអតិថិជន" : "Customer name"}
    icon="user"
    value={
      contact.full_name ??
      (isKhmer ? "អតិថិជន Facebook" : "Facebook customer")
    }
  />

  <CopyableProfileValue
    label={isKhmer ? "លេខទូរស័ព្ទ" : "Phone"}
    icon="phone"
    value={contact.phone}
    emptyText={isKhmer ? "មិនទាន់បន្ថែម" : "Not added"}
  />
</ProfileSection>

  <ProfileSection title={isKhmer ? "កំណត់ចំណាំអតិថិជន" : "Customer note"}>
  <CopyableProfileValue
    label={isKhmer ? "កំណត់ចំណាំ" : "Note"}
    icon="note"
    value={contact.customer_note}
    emptyText={isKhmer ? "មិនទាន់មានកំណត់ចំណាំអតិថិជនទេ។" : "No customer note has been added."}
  />
</ProfileSection>



          <ProfileSection title={isKhmer ? "ព័ត៌មាន Facebook" : "Facebook information"}>
            <ProfileValue
              label={isKhmer ? "លេខសម្គាល់អតិថិជន" : "Customer ID"}
    icon="id"
              value={contact.platform_user_id}
              breakAll
            />

            <ProfileValue
              label={isKhmer ? "ទំព័រ" : "Page"}
    icon="page"
              value={
                activeConversation.social_account
                  ?.account_name ??
                (isKhmer ? "ទំព័រ Facebook" : "Facebook Page")
              }
            />
          </ProfileSection>

          <ProfileSection title={isKhmer ? "ការសន្ទនា" : "Conversation"}>
            <div>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="text-slate-400">
                  <FieldIcon name="status" />
                </span>
                {isKhmer ? "ស្ថានភាព" : "Status"}
              </p>

              <span
                className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClasses(
                  activeConversation.status,
                )}`}
              >
                {isKhmer
                  ? ({
                      open: "បើក",
                      pending: "កំពុងរង់ចាំ",
                      resolved: "បានដោះស្រាយ",
                      closed: "បានបិទ",
                      spam: "សារឥតបានការ",
                    } as const)[activeConversation.status]
                  : getStatusLabel(activeConversation.status)}
              </span>
            </div>

            <div>
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <span className="text-slate-400">
                  <FieldIcon name="assigned" />
                </span>
                {isKhmer ? "បានចាត់តាំងទៅ" : "Assigned to"}
              </p>

              {activeConversation.assigned_to ? (
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {activeConversation.assigned_member?.full_name ??
                    (isKhmer ? "បានចាត់តាំង" : "Assigned")}
                </p>
              ) : (
                <div className="mt-1 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-500">
                    {isKhmer ? "មិនទាន់ចាត់តាំង" : "Unassigned"}
                  </p>

                  {onAssignToMe ? (
                    <button
                      type="button"
                      onClick={onAssignToMe}
                      disabled={assigning}
                      className="shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {assigning
                        ? isKhmer ? "កំពុងចាត់តាំង..." : "Assigning..."
                        : isKhmer ? "ចាត់តាំងឲ្យខ្ញុំ" : "Assign to me"}
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            <ProfileValue
              label={isKhmer ? "ជាអតិថិជនតាំងពី" : "Customer since"}
              icon="since"
              value={formatProfileDate(
                contact.created_at,
              )}
            />

            <ProfileValue
              label={isKhmer ? "សកម្មចុងក្រោយ" : "Last active"}
              icon="active"
              value={formatProfileDate(
                contact.last_contact_at,
              )}
            />
          </ProfileSection>

          <ProfileSection title={isKhmer ? "ស្លាក" : "Tags"}>
            {customerTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {customerTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm"
                    style={{
                      backgroundColor: tag.color,
                      color: getReadableTagTextColor(tag.color),
                    }}
                    title={tag.name}
                  >
                    <span className="max-w-[150px] truncate">
                      {tag.name}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                {isKhmer ? "មិនទាន់មានស្លាក" : "No tags yet"}
              </p>
            )}
          </ProfileSection>

          <section className="border-t border-slate-200 pt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {isKhmer ? "ផ្សេងៗ" : "Other"}
            </p>

            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => setFilesOpen(true)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span className="text-slate-400">
                  <FieldIcon name="files" />
                </span>
                {isKhmer ? "ឯកសារ ឯកសារផ្សេងៗ និងតំណ" : "Files, documents & links"}
              </button>

              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                <span className="text-red-400">
                  <FieldIcon name="spam" />
                </span>
                {isKhmer ? "រាយការណ៍សារឥតបានការ" : "Report spam"}
              </button>
            </div>
          </section>
        </div>
        ) : null}

        {/*
         * Notes stay mounted on every tab. They own the badge count and the
         * realtime subscription behind it, so unmounting them would mean the
         * badge only appeared after someone opened this tab.
         */}
        <div className={profileTab === "notes" ? "p-5" : "hidden"}>
          <CustomerNotes
            onNoteCountChange={setNoteCount}
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
        </div>

        {profileTab === "reminder" ? (
          <div className="p-5">
            <ConversationReminderSummary
              conversationId={activeConversation.id}
              onCreate={() => setReminderOpen(true)}
            />
          </div>
        ) : null}
        </>
      )}
    </div>

    {reminderOpen ? (
      <ReminderModal
        conversationId={activeConversation.id}
        contactId={contact.id}
        customerName={
          contact.full_name ?? (isKhmer ? "អតិថិជន Facebook" : "Facebook customer")
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
          contact.full_name ?? (isKhmer ? "អតិថិជន Facebook" : "Facebook customer")
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
  icon?: FieldIconName;
};

function ProfileInput({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
  icon,
}: ProfileInputProps) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        {icon ? (
          <span className="text-slate-400">
            <FieldIcon name={icon} />
          </span>
        ) : null}
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


/* Small line icons used to label each profile field. */
type FieldIconName =
  | "user"
  | "phone"
  | "note"
  | "id"
  | "page"
  | "status"
  | "assigned"
  | "since"
  | "active"
  | "files"
  | "spam";

function FieldIcon({ name }: { name: FieldIconName }) {
  const paths: Record<FieldIconName, React.ReactNode> = {
    user: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
      </>
    ),
    phone: (
      <path d="M7 3.5h3l1.4 3.5-2 1.4a12 12 0 0 0 5.2 5.2l1.4-2 3.5 1.4v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 5 5.7 2 2 0 0 1 7 3.5z" />
    ),
    note: (
      <>
        <path d="M6 3.5h8.5L19 8v12.5H6z" />
        <path d="M14 3.5V8h4.5M9 12h6M9 16h4" />
      </>
    ),
    id: (
      <>
        <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
        <circle cx="9" cy="11.5" r="2" />
        <path d="M6 16.2a3.5 3.5 0 0 1 6 0M14.5 10.5h4M14.5 14h3" />
      </>
    ),
    page: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M13.5 20v-5h1.8l.3-2.2h-2.1v-1.4c0-.6.2-1 1-1h1.2V8.2a13 13 0 0 0-1.6-.1c-1.7 0-2.8 1-2.8 2.8v1.9H9.4V15h1.9v5" />
      </>
    ),
    status: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.8 12.2 2.2 2.2 4.2-4.6" />
      </>
    ),
    assigned: (
      <>
        <circle cx="10" cy="8" r="3" />
        <path d="M4 19a6 6 0 0 1 12 0" />
        <path d="M17.5 8.5v5M15 11h5" />
      </>
    ),
    since: (
      <>
        <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
        <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
      </>
    ),
    active: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.2v5.2l3.4 2" />
      </>
    ),
    files: (
      <>
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2.5h6A2.5 2.5 0 0 1 20 10v7.5A2.5 2.5 0 0 1 17.5 20h-11A2.5 2.5 0 0 1 4 17.5z" />
      </>
    ),
    spam: (
      <>
        <path d="M12 3.5 21 19H3z" />
        <path d="M12 10v4M12 16.6h.01" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function ProfileSection({
  title,
  children,
}: ProfileSectionProps) {
  return (
    <section className="border-t border-slate-200 pt-5 first:border-t-0 first:pt-0">
      <p className="text-[12.6px] font-bold uppercase tracking-wide text-slate-900">
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
  icon?: FieldIconName;
};

function ProfileValue({
  label,
  value,
  breakAll = false,
  icon,
}: ProfileValueProps) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon ? (
          <span className="text-slate-400">
            <FieldIcon name={icon} />
          </span>
        ) : null}
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
  icon,
}: {
  label: string;
  value: string | null | undefined;
  emptyText?: string;
  icon?: FieldIconName;
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
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon ? (
          <span className="text-slate-400">
            <FieldIcon name={icon} />
          </span>
        ) : null}
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