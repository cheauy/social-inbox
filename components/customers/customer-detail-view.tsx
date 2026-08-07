"use client";
import { CustomerTagsManager } from "@/components/customers/customer-tags-manager";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  useEffect,
  useState,
} from "react";
import { CustomerTimeline } from "@/components/customers/customer-timeline";


type CustomerTag = {
  id: string;
  name: string;
  color: string;
};

type AssignedMember = {
  id: string;
  fullName: string;
  role: string;
  profilePictureUrl: string | null;
};

type LatestConversation = {
  id: string;
  status: string;
  assignedTo: string | null;
  assignedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string | null;

  assignedMember:
    | AssignedMember
    | null;
};

type ConversationItem = {
  id: string;
  status: string;
  assignedTo: string | null;
  assignedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string | null;

  assignedMember: {
    id: string;
    fullName: string;
    role: string;
    profilePictureUrl: string | null;
  } | null;

  socialAccount: {
    id: string;
    platform: string;
    accountName: string | null;
  } | null;
};

type CustomerDetail = {
  id: string;
  businessId: string;
  fullName: string;
  profilePictureUrl: string | null;
  platformUserId: string;
  phone: string | null;
  address: string | null;
  customerNote: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  updatedAt: string | null;
  tags: CustomerTag[];
};

type CustomerEditForm = {
  phone: string;
  address: string;
  customerNote: string;
};

type UpdateCustomerResponse = {
  success?: boolean;
  error?: string;

  contact?: {
    id: string;
    phone: string | null;
    address: string | null;
    customer_note: string | null;
    updated_at: string | null;
  };

  activityRecorded?: boolean;
};

type CustomerDetailResponse = {
  success?: boolean;
  error?: string;

  customer?: CustomerDetail;

  latestConversation:
    | LatestConversation
    | null;

  conversations?: ConversationItem[];
};

function getInitial(
  name: string,
) {
  return (
    name
      .trim()
      .charAt(0)
      .toUpperCase() || "C"
  );
}

function formatDateTime(
  value: string | null,
) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(
    "en",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  ).format(new Date(value));
}



function getStatusClasses(
  status: string,
) {
  switch (status) {
    case "open":
      return "bg-emerald-100 text-emerald-700";

    case "pending":
      return "bg-amber-100 text-amber-700";

    case "resolved":
      return "bg-blue-100 text-blue-700";

    case "closed":
      return "bg-slate-100 text-slate-700";

    case "spam":
      return "bg-red-100 text-red-700";

    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function CustomerDetailView() {
   const params = useParams();


  const customerId =
    typeof params.customerId === "string"
      ? params.customerId.trim()
      : "";
  const [data, setData] =
    useState<CustomerDetailResponse | null>(
      null,
    );

   const [
  historyOpen,
  setHistoryOpen,
] = useState(false);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [editing, setEditing] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [saveError, setSaveError] =
    useState<string | null>(null);

  const [editForm, setEditForm] =
    useState<CustomerEditForm>({
      phone: "",
      address: "",
      customerNote: "",
    });

  const [
  currentTags,
  setCurrentTags,
] = useState<CustomerTag[]>([]);

  useEffect(() => {

    if (!customerId?.trim()) {
    setError(
      "Customer ID is missing.",
    );
    setLoading(false);
    return;
  }
    let cancelled = false;




    async function loadCustomer() {
      setLoading(true);
      setError(null);

     try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(
          customerId,
        )}`,
        {
          cache: "no-store",
        },
      );

        const text =
          await response.text();

        const result =
          text.trim()
            ? (JSON.parse(
                text,
              ) as CustomerDetailResponse)
            : null;

        if (
          !response.ok ||
          !result?.success
        ) {
          throw new Error(
            result?.error ??
              `Unable to load customer. Server returned ${response.status}.`,
          );
        }

        if (!cancelled) {
          setData(result);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load customer.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCustomer();

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  useEffect(() => {
  setCurrentTags(
    data?.customer?.tags ?? [],
  );
}, [data?.customer?.tags]);

    function startEditing() {
  const customer =
    data?.customer;

  if (!customer) {
    return;
  }

  setEditForm({
    phone:
      customer.phone ?? "",

    address:
      customer.address ?? "",

    customerNote:
      customer.customerNote ?? "",
  });

  setSaveError(null);
  setEditing(true);
}

function closeEditing() {
  if (saving) {
    return;
  }

  setEditing(false);
  setSaveError(null);
}

async function saveCustomerProfile() {
  const customer =
    data?.customer;

  const conversation =
    data?.latestConversation;

  if (!customer) {
    setSaveError(
      "Customer information is unavailable.",
    );

    return;
  }

  if (!conversation?.id) {
    setSaveError(
      "A conversation is required to record this profile update.",
    );

    return;
  }

  setSaving(true);
  setSaveError(null);

  try {
    const response = await fetch(
      `/api/contacts/${encodeURIComponent(
        customer.id,
      )}`,
      {
        method: "PATCH",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          conversationId:
            conversation.id,

          phone:
            editForm.phone,

          address:
            editForm.address,

          customerNote:
            editForm.customerNote,
        }),
      },
    );

    const text =
      await response.text();

    const result =
      text.trim()
        ? (JSON.parse(
            text,
          ) as UpdateCustomerResponse)
        : null;

    if (
      !response.ok ||
      !result?.success
    ) {
      throw new Error(
        result?.error ??
          `Unable to update customer. Server returned ${response.status}.`,
      );
    }

    /*
     * Update the current page immediately without
     * removing or reloading your existing functions.
     */
    setData((current) => {
      if (!current?.customer) {
        return current;
      }

      return {
        ...current,

        customer: {
          ...current.customer,

          phone:
            result.contact?.phone ??
            null,

          address:
            result.contact?.address ??
            null,

          customerNote:
            result.contact
              ?.customer_note ??
            null,

          updatedAt:
            result.contact
              ?.updated_at ??
            new Date().toISOString(),
        },
      };
    });

    setEditing(false);
    setSaveError(null);
  } catch (updateError) {
    setSaveError(
      updateError instanceof Error
        ? updateError.message
        : "Unable to update customer.",
    );
  } finally {
    setSaving(false);
  }
}
  

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-100 p-6">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

          Loading customer...
        </div>
      </div>
    );
  }

  if (
    error ||
    !data?.customer
  ) {
    return (
      <div className="min-h-full bg-slate-100 p-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          {error ??
            "Customer was not found."}
        </div>
      </div>
    );
  }

 
  const customer =
    data.customer;

  const latestConversation =
    data.latestConversation;

const conversations =
  data.conversations ?? [];

  
  return (
    <div className="h-full overflow-y-auto bg-slate-100">
      <div className="w-full space-y-5 p-5">
        {/* Header */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              {customer.profilePictureUrl ? (
                <img
                  src={
                    customer.profilePictureUrl
                  }
                  alt=""
                  className="h-20 w-20 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-blue-100 text-2xl font-bold text-blue-700">
                  {getInitial(
                    customer.fullName,
                  )}
                </div>
              )}

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="truncate text-3xl font-bold tracking-tight text-slate-950">
                    {customer.fullName}
                  </h1>

                <div className="flex flex-wrap gap-3">

</div>
                </div>

                <p className="mt-2 break-all text-sm text-slate-500">
                  Facebook ID:{" "}
                  {
                    customer.platformUserId
                  }
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  Customer since{" "}
                  {formatDateTime(
                    customer.createdAt,
                  )}
                </p>

                <p className="mt-1 text-sm text-slate-500">
                  Last active{" "}
                  {formatDateTime(
                    customer.lastActiveAt,
                  )}
                </p>
              </div>
            </div>
 <div className="flex items-center gap-2">
  {latestConversation ? (
    <Link
      href={`/dashboard/inbox?conversation=${latestConversation.id}`}
    className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-600 bg-blue-600 text-white transition hover:border-blue-700 hover:bg-blue-700"
      title="Open conversation"
      aria-label="Open conversation"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path
          d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  ) : null}

  <button
    type="button"
    onClick={() =>
      setHistoryOpen(true)
    }
    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
    title="Customer history"
    aria-label="Customer history"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="M3 12a9 9 0 1 0 3-6.7"
        strokeLinecap="round"
      />

      <path
        d="M3 4v6h6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M12 7v5l3 2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </button>

  <Link
    href="/dashboard/customers"
    className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
    title="Back to customers"
    aria-label="Back to customers"
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path
        d="m15 18-6-6 6-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </Link>
</div>

          </div>

          {/* Tags */}
         {/* Tags */}
<div className="mt-6 border-t border-slate-200 pt-5">
  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
    Customer tags
  </p>

  <div className="mt-3">
    {latestConversation ? (
     <CustomerTagsManager
  contactId={customer.id}
  conversationId={
    latestConversation.id
  }
  businessId={
    customer.businessId
  }
  initialTags={currentTags}
  onTagsChange={(nextTags) => {
    setCurrentTags(nextTags);

    setData((current) => {
      if (!current?.customer) {
        return current;
      }

      return {
        ...current,
        customer: {
          ...current.customer,
          tags: nextTags,
        },
      };
    });
  }}
/>
    ) : (
      <span className="text-sm text-slate-400">
        A conversation is required before tags can be changed.
      </span>
    )}
  </div>
</div>
        </section>

        {/* Profile and assignment */}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-950">
                  Customer information
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Contact details and customer notes.
                </p>
              </div>

              <button
                      type="button"
                      onClick={startEditing}
                      className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Edit profile
                    </button>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <InformationItem
                label="Phone number"
                value={
                  customer.phone ??
                  "Not added"
                }
              />

              <InformationItem
                label="Address"
                value={
                  customer.address ??
                  "Not added"
                }
              />

              <InformationItem
                label="Customer ID"
                value={customer.id}
              />

              <InformationItem
                label="Updated"
                value={formatDateTime(
                  customer.updatedAt,
                )}
              />
            </div>

            <div className="mt-6 border-t border-slate-200 pt-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Customer note
              </p>

              <div className="mt-3 min-h-24 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                {customer.customerNote ??
                  "No customer note has been added."}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">
              Latest assignment
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Current owner of the latest conversation.
            </p>

            <div className="mt-6">
              {latestConversation
                ?.assignedMember ? (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  {latestConversation
                    .assignedMember
                    .profilePictureUrl ? (
                    <img
                      src={
                        latestConversation
                          .assignedMember
                          .profilePictureUrl
                      }
                      alt=""
                      className="h-11 w-11 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
                      {getInitial(
                        latestConversation
                          .assignedMember
                          .fullName,
                      )}
                    </div>
                  )}

                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {
                        latestConversation
                          .assignedMember
                          .fullName
                      }
                    </p>

                    <p className="mt-1 capitalize text-sm text-slate-500">
                      {
                        latestConversation
                          .assignedMember
                          .role
                      }
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
                  The latest conversation is currently unassigned.
                </div>
              )}
            </div>

            <div className="mt-5 space-y-4">
              <InformationItem
                label="Conversation status"
                value={
                  latestConversation
                    ?.status ??
                  "No conversation"
                }
              />

              <InformationItem
                label="Assigned at"
                value={formatDateTime(
                  latestConversation
                    ?.assignedAt ??
                    null,
                )}
              />

              <InformationItem
                label="Last message"
                value={formatDateTime(
                  latestConversation
                    ?.lastMessageAt ??
                    null,
                )}
              />
            </div>
          </section>
        </div>

        

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
  <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h2 className="text-lg font-bold text-slate-950">
        Conversation history
      </h2>

      <p className="mt-1 text-sm text-slate-500">
        Review all conversations connected to this customer.
      </p>
    </div>

    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
      {conversations.length} conversations
    </span>
  </div>

  

  {conversations.length === 0 ? (
    <div className="flex min-h-56 flex-col items-center justify-center p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-xl text-slate-500">
        💬
      </div>

      <h3 className="mt-4 font-bold text-slate-900">
        No conversations found
      </h3>

      <p className="mt-2 text-sm text-slate-500">
        This customer does not have any conversation history yet.
      </p>
    </div>
  ) : (
    <>
      {/* Desktop */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="min-w-full">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                Conversation
              </th>

              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                Page
              </th>

              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                Assigned
              </th>

              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                Status
              </th>

              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                Created
              </th>

              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                Last message
              </th>

              <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-500">
                Action
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {conversations.map(
              (conversation) => (
                <tr
                  key={conversation.id}
                  className="transition hover:bg-slate-50"
                >
                  <td className="px-5 py-4">
                    <div>
                      <p className="font-semibold text-slate-900">
                        Conversation
                      </p>

                      <p className="mt-1 max-w-52 truncate font-mono text-xs text-slate-400">
                        {conversation.id}
                      </p>
                    </div>
                  </td>

                  <td className="px-5 py-4 text-sm text-slate-600">
                    {conversation.socialAccount
                      ?.accountName ??
                      conversation.socialAccount
                        ?.platform ??
                      "Facebook"}
                  </td>

                  <td className="px-5 py-4">
                    {conversation.assignedMember ? (
                      <div className="flex items-center gap-2">
                        {conversation.assignedMember
                          .profilePictureUrl ? (
                          <img
                            src={
                              conversation
                                .assignedMember
                                .profilePictureUrl
                            }
                            alt=""
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                            {getInitial(
                              conversation
                                .assignedMember
                                .fullName,
                            )}
                          </div>
                        )}

                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            {
                              conversation
                                .assignedMember
                                .fullName
                            }
                          </p>

                          <p className="text-xs capitalize text-slate-400">
                            {
                              conversation
                                .assignedMember
                                .role
                            }
                          </p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">
                        Unassigned
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusClasses(
                        conversation.status,
                      )}`}
                    >
                      {conversation.status}
                    </span>
                  </td>

                  <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-500">
                    {formatDateTime(
                      conversation.createdAt,
                    )}
                  </td>

                  <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-500">
                    {formatDateTime(
                      conversation.lastMessageAt,
                    )}
                  </td>

                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`/dashboard/inbox?conversation=${conversation.id}`}
                      className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="divide-y divide-slate-100 lg:hidden">
        {conversations.map(
          (conversation) => (
            <article
              key={conversation.id}
              className="p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">
                    Conversation
                  </p>

                  <p className="mt-1 truncate font-mono text-xs text-slate-400">
                    {conversation.id}
                  </p>
                </div>

                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusClasses(
                    conversation.status,
                  )}`}
                >
                  {conversation.status}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-400">
                    Page
                  </p>

                  <p className="mt-1 font-medium text-slate-700">
                    {conversation.socialAccount
                      ?.accountName ??
                      "Facebook"}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-400">
                    Assigned
                  </p>

                  <p className="mt-1 font-medium text-slate-700">
                    {conversation.assignedMember
                      ?.fullName ??
                      "Unassigned"}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-400">
                    Created
                  </p>

                  <p className="mt-1 font-medium text-slate-700">
                    {formatDateTime(
                      conversation.createdAt,
                    )}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-slate-400">
                    Last message
                  </p>

                  <p className="mt-1 font-medium text-slate-700">
                    {formatDateTime(
                      conversation.lastMessageAt,
                    )}
                  </p>
                </div>
              </div>

              <Link
                href={`/dashboard/inbox?conversation=${conversation.id}`}
                className="mt-4 flex w-full items-center justify-center rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Open conversation
              </Link>
            </article>
          ),
        )}
      </div>
    </>
  )}

  
        </section>

        <section className="mt-8">

  {historyOpen ? (
  <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
    <button
      type="button"
      onClick={() =>
        setHistoryOpen(false)
      }
      className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
      aria-label="Close customer history"
    />

    <section className="relative z-10 flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
        <div>
          <h2 className="text-xl font-bold text-slate-950">
            Conversation update histories
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            View all customer activity including profile updates, assignments, conversation changes and tags.
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setHistoryOpen(false)
          }
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-slate-500 transition hover:bg-slate-100"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <CustomerTimeline
          customerId={customer.id}
        />
      </div>
    </section>
  </div>
) : null}

</section>
      </div>
      {editing ? (
  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
    <button
      type="button"
      onClick={closeEditing}
      className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
      aria-label="Close customer editor"
    />

    <section className="relative z-10 w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
      {/* Modal header */}
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
        <div>
          <h2 className="text-xl font-bold text-slate-950">
            Edit customer
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Update business-managed customer information.
          </p>
        </div>

        <button
          type="button"
          onClick={closeEditing}
          disabled={saving}
          className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Form */}
      <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
        {/* Facebook name: read-only */}
        <div>
          <label className="text-sm font-semibold text-slate-700">
            Facebook customer name
          </label>

          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
            {customer.fullName}
          </div>

          <p className="mt-1 text-xs text-slate-400">
            This name is provided by Facebook and cannot be edited here.
          </p>
        </div>

        {/* Facebook ID: read-only */}
        <div>
          <label className="text-sm font-semibold text-slate-700">
            Facebook ID
          </label>

          <div className="mt-2 break-all rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 font-mono text-xs text-slate-600">
            {customer.platformUserId}
          </div>
        </div>

        {/* Phone */}
        <div>
          <label
            htmlFor="customer-phone"
            className="text-sm font-semibold text-slate-700"
          >
            Phone number
          </label>

          <input
            id="customer-phone"
            type="tel"
            value={editForm.phone}
            onChange={(event) =>
              setEditForm(
                (current) => ({
                  ...current,
                  phone:
                    event.target.value,
                }),
              )
            }
            maxLength={50}
            placeholder="+855..."
            className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        {/* Address */}
        <div>
          <label
            htmlFor="customer-address"
            className="text-sm font-semibold text-slate-700"
          >
            Address
          </label>

          <textarea
            id="customer-address"
            value={editForm.address}
            onChange={(event) =>
              setEditForm(
                (current) => ({
                  ...current,
                  address:
                    event.target.value,
                }),
              )
            }
            rows={3}
            maxLength={1000}
            placeholder="Customer address..."
            className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />
        </div>

        {/* Customer note */}
        <div>
          <label
            htmlFor="customer-note"
            className="text-sm font-semibold text-slate-700"
          >
            Customer note
          </label>

          <textarea
            id="customer-note"
            value={
              editForm.customerNote
            }
            onChange={(event) =>
              setEditForm(
                (current) => ({
                  ...current,
                  customerNote:
                    event.target.value,
                }),
              )
            }
            rows={5}
            maxLength={5000}
            placeholder="Add useful information about this customer..."
            className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          />

          <p className="mt-1 text-right text-xs text-slate-400">
            {
              editForm.customerNote
                .length
            }
            /5000
          </p>
        </div>

        {saveError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {saveError}
          </div>
        ) : null}
      </div>

      {/* Modal footer */}
      <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
        <button
          type="button"
          onClick={closeEditing}
          disabled={saving}
          className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={() =>
            void saveCustomerProfile()
          }
          disabled={saving}
          className="inline-flex min-w-32 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
        >
          {saving ? (
            <>
              <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />

              Saving...
            </>
          ) : (
            "Save changes"
          )}
        </button>
      </div>
    </section>
  </div>
) : null}
    </div>
  );
}

function InformationItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-2 break-words text-sm font-medium text-slate-800">
        {value}
      </p>
    </div>
  );
}