"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

/*
 * One workspace, all the facts, while you are on the call.
 *
 * Billing management already answers "what are they paying"; this answers the
 * question that actually arrives in support: "it is not working". That means
 * the channel's token and webhook state, whether messages are still flowing,
 * and how many are failing -- facts that until now lived only in hand-written
 * SQL.
 *
 * Nothing here writes. Releasing a channel stays in Channel connections, so an
 * inspector opened to read a customer's account cannot change it by accident.
 */

type WorkspaceRow = {
  id: string;
  name: string | null;
  created_at: string | null;
};

type Subscription = {
  plan_code: string | null;
  status: string | null;
  billing_cycle: string | null;
  member_limit: number | null;
  channel_limit: number | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  last_paid_amount: number | null;
  last_paid_currency: string | null;
};

type Member = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

type Channel = {
  id: string;
  platform: string | null;
  account_name: string | null;
  platform_account_id: string | null;
  is_active: boolean | null;
  facebook_token_status: string | null;
  telegram_token_status: string | null;
  telegram_webhook_status: string | null;
  telegram_webhook_url: string | null;
  created_at: string | null;
};

type Usage = {
  conversations: number;
  openConversations: number;
  unassignedOpen: number;
  contacts: number;
  messages: number;
  failedMessages: number;
  savedReplies: number;
  lastMessageAt: string | null;
  lastMessageDirection: string | null;
};

type Detail = {
  workspace: WorkspaceRow & { slug: string | null };
  subscription: Subscription | null;
  members: Member[];
  channels: Channel[];
  usage: Usage;
};

const PLAN_LABELS: Record<string, string> = {
  trial: "Free Trial",
  mini: "Mini",
  standard: "Standard",
  pro: "Pro",
};

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  /*
   * Pinned to en-GB so the server and the browser produce the same string --
   * anything locale-dependent here is a hydration mismatch waiting to happen.
   */
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatWhen(value: string | null) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Never";
  }

  const minutes = Math.round(
    (Date.now() - date.getTime()) / 60_000,
  );

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.round(hours / 24);

  if (days < 30) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  return formatDate(value);
}

function statusTone(status: string | null) {
  if (status === "active") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "trialing") {
    return "bg-blue-100 text-blue-800";
  }

  if (status === "expired" || status === "cancelled") {
    return "bg-red-100 text-red-700";
  }

  if (status === "past_due" || status === "suspended") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-slate-200 text-slate-700";
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warn";
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        tone === "warn"
          ? "border-amber-200 bg-amber-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <p
        className={`text-lg font-bold ${
          tone === "warn" ? "text-amber-900" : "text-slate-950"
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] font-medium text-slate-500">
        {label}
      </p>
    </div>
  );
}

/*
 * The workspace id is what every follow-up query and every support note needs,
 * and it is 36 characters nobody should retype.
 */
function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => setCopied(false));
      }}
      className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600 transition hover:bg-slate-200"
      title="Copy the workspace id"
    >
      {copied ? "Copied" : value}
    </button>
  );
}

export function AdminWorkspaceInspector() {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<WorkspaceRow[]>([]);
  const [searching, setSearching] = useState(true);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Two searches can land out of order, and the slower earlier one would then
   * overwrite the newer list. Only the most recent request may set state.
   */
  const requestRef = useRef(0);

  const runSearch = useCallback(async (query: string) => {
    const ticket = requestRef.current + 1;
    requestRef.current = ticket;
    setSearching(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/tenh-admin/workspace-inspector?query=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        workspaces?: WorkspaceRow[];
      };

      if (requestRef.current !== ticket) {
        return;
      }

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to search workspaces.",
        );
      }

      setResults(result.workspaces ?? []);
    } catch (caught) {
      if (requestRef.current !== ticket) {
        return;
      }

      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to search workspaces.",
      );
      setResults([]);
    } finally {
      if (requestRef.current === ticket) {
        setSearching(false);
      }
    }
  }, []);

  /*
   * Show the newest workspaces the moment the tab opens, so a blank search box
   * is still useful. Every later search is user-driven.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void runSearch("");
  }, [runSearch]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadDetail = useCallback(async (businessId: string) => {
    setDetailLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/tenh-admin/workspace-inspector?businessId=${encodeURIComponent(businessId)}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as
        | ({ success: true } & Detail)
        | { success?: false; error?: string };

      if (!response.ok || !result.success) {
        throw new Error(
          ("error" in result && result.error) ||
            "Unable to open that workspace.",
        );
      }

      setDetail(result);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to open that workspace.",
      );
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDetail(null);
    void runSearch(search.trim());
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <form
          onSubmit={submitSearch}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Workspace name, slug, or owner email"
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
            aria-label="Search workspaces"
          />
          <button
            type="submit"
            className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            Search
          </button>
        </form>

        <p className="mt-2 text-xs text-slate-500">
          Leave it blank to see the 25 newest workspaces. Include an @ to search
          by the owner&apos;s email.
        </p>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          {searching ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              No workspace matches that search.
            </p>
          ) : (
            results.map((workspace, index) => {
              const selected = detail?.workspace.id === workspace.id;

              return (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => void loadDetail(workspace.id)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition ${
                    index > 0 ? "border-t border-slate-100" : ""
                  } ${
                    selected ? "bg-blue-50/60" : "bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-950">
                      {workspace.name ?? "Unnamed workspace"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Created {formatDate(workspace.created_at)}
                    </p>
                  </div>
                  <span
                    className="text-xl leading-none text-slate-400"
                    aria-hidden="true"
                  >
                    {selected && detailLoading ? "…" : "›"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {detail ? (
        <div className="space-y-4">
          {/* ------------------------------------------------- header */}
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-slate-950">
                  {detail.workspace.name ?? "Unnamed workspace"}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  {detail.workspace.slug
                    ? `/${detail.workspace.slug} · `
                    : ""}
                  Signed up {formatDate(detail.workspace.created_at)}
                </p>
              </div>

              <CopyId value={detail.workspace.id} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Conversations"
                value={detail.usage.conversations}
              />
              <Stat label="Open" value={detail.usage.openConversations} />
              <Stat
                label="Unassigned"
                value={detail.usage.unassignedOpen}
                tone={
                  detail.usage.unassignedOpen > 0 ? "warn" : undefined
                }
              />
              <Stat label="Customers" value={detail.usage.contacts} />
              <Stat label="Messages" value={detail.usage.messages} />
              <Stat
                label="Failed sends"
                value={detail.usage.failedMessages}
                tone={
                  detail.usage.failedMessages > 0 ? "warn" : undefined
                }
              />
              <Stat
                label="Quick replies"
                value={detail.usage.savedReplies}
              />
              <Stat
                label={
                  detail.usage.lastMessageDirection === "outgoing"
                    ? "Last reply sent"
                    : "Last message in"
                }
                value={formatWhen(detail.usage.lastMessageAt)}
              />
            </div>
          </div>

          {/* ------------------------------------------- subscription */}
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-400">
              Subscription
            </h3>

            {detail.subscription ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-700">
                <span className="font-bold text-slate-950">
                  {PLAN_LABELS[detail.subscription.plan_code ?? ""] ??
                    detail.subscription.plan_code ??
                    "No plan"}
                </span>

                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusTone(
                    detail.subscription.status,
                  )}`}
                >
                  {detail.subscription.status ?? "unknown"}
                </span>

                {detail.subscription.billing_cycle ? (
                  <span className="text-xs text-slate-500">
                    {detail.subscription.billing_cycle}
                  </span>
                ) : null}

                <span className="text-xs text-slate-500">
                  {detail.subscription.status === "trialing"
                    ? `Trial ends ${formatDate(detail.subscription.trial_ends_at)}`
                    : `Period ends ${formatDate(detail.subscription.current_period_end)}`}
                </span>

                <span className="text-xs text-slate-500">
                  {
                    detail.members.filter((member) => member.is_active)
                      .length
                  }
                  {detail.subscription.member_limit
                    ? ` / ${detail.subscription.member_limit}`
                    : ""}{" "}
                  members ·{" "}
                  {
                    detail.channels.filter(
                      (channel) => channel.is_active,
                    ).length
                  }
                  {detail.subscription.channel_limit
                    ? ` / ${detail.subscription.channel_limit}`
                    : ""}{" "}
                  channels
                </span>

                {detail.subscription.last_paid_amount ? (
                  <span className="text-xs text-slate-500">
                    Last paid {detail.subscription.last_paid_amount}{" "}
                    {detail.subscription.last_paid_currency ?? "USD"}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                This workspace has no subscription row at all — it never
                started a trial.
              </p>
            )}
          </div>

          {/* ----------------------------------------------- channels */}
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-400">
              Channels
            </h3>

            {detail.channels.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No Page or Bot has ever been connected here.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {detail.channels.map((channel) => {
                  const telegram = channel.platform === "telegram";
                  const tokenStatus = telegram
                    ? channel.telegram_token_status
                    : channel.facebook_token_status;
                  const broken =
                    tokenStatus === "invalid" ||
                    tokenStatus === "expired" ||
                    (telegram &&
                      channel.telegram_webhook_status === "failed");

                  return (
                    <div
                      key={channel.id}
                      className={`rounded-xl border px-4 py-3 ${
                        broken
                          ? "border-red-200 bg-red-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-950">
                          {channel.account_name ?? "Unnamed"}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                          {telegram ? "Telegram" : "Messenger"}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            channel.is_active
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {channel.is_active ? "Active" : "Inactive"}
                        </span>
                        {tokenStatus ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              tokenStatus === "valid"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            Token {tokenStatus}
                          </span>
                        ) : null}
                        {telegram && channel.telegram_webhook_status ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              channel.telegram_webhook_status === "active"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            Webhook {channel.telegram_webhook_status}
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-1.5 break-all font-mono text-[11px] text-slate-500">
                        {telegram ? "Bot" : "Page"}{" "}
                        {channel.platform_account_id ?? "—"}
                        {telegram && channel.telegram_webhook_url
                          ? ` · ${channel.telegram_webhook_url}`
                          : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ------------------------------------------------ members */}
          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-400">
              Team
            </h3>

            {detail.members.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No members on this workspace.
              </p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                {detail.members.map((member, index) => (
                  <div
                    key={member.id}
                    className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${
                      index > 0 ? "border-t border-slate-100" : ""
                    } ${member.is_active ? "bg-white" : "bg-slate-50"}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {member.full_name ??
                          member.email ??
                          "Unnamed member"}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {member.email ?? "—"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        {member.role ?? "member"}
                      </span>
                      {member.is_active ? null : (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                          Removed
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
