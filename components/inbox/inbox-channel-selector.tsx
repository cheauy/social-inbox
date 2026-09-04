"use client";

import {
  useRouter,
  useSearchParams,
} from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  shortSubscriptionId,
  subscriptionAccentColor,
} from "@/lib/inbox/subscription-visual";
import {
  useWorkspaceLanguageId,
} from "@/components/display/workspace-language-text";

type InboxChannel = {
  id: string;
  businessId: string;
  subscriptionId: string | null;
  subscriptionStatus?: string | null;
  subscriptionOperational?: boolean;
  membershipAccessAllowed?: boolean;
  accessAllowed: boolean;
  subscriptionAccessAllowed: boolean;
  channelEnabled: boolean;
  platform: "facebook" | "telegram";
  platformAccountId: string | null;
  name: string;
  username: string | null;
};

type ChannelsResponse = {
  success?: boolean;
  error?: string;
  currentBusinessId?: string | null;
  currentBusinessAccess?: boolean;
  channels?: InboxChannel[];
};

type SubscriptionGroup = {
  key: string;
  businessId: string;
  subscriptionId: string | null;
  accessAllowed: boolean;
  operational: boolean;
  channels: InboxChannel[];
};

const REMOVED_ACCESS_TITLE =
  "You no longer have access to this subscription.";

const REMOVED_ACCESS_DETAIL =
  "An Owner may have removed your access. Your TENH account and other subscriptions are unchanged.";

const SUBSCRIPTION_LOCKED_TITLE =
  "This subscription is inactive.";

const SUBSCRIPTION_LOCKED_DETAIL =
  "Reactivate this subscription before its channels can appear in the operational TENH Inbox.";

const CHANNEL_DISABLED_TITLE =
  "This channel is disabled.";

const CHANNEL_DISABLED_DETAIL =
  "An Owner disabled this channel. It does not use a channel slot and cannot be opened until an Owner enables it.";

function ChannelIcon({
  platform,
}: {
  platform: "facebook" | "telegram" | "all";
}) {
  if (platform === "all") {
    return (
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-4.5 w-4.5"
        >
          <path
            d="m12 3 8 4-8 4-8-4 8-4Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m4 12 8 4 8-4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m4 17 8 4 8-4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  const src =
    platform === "facebook"
      ? "/images/channels/messenger.png"
      : "/images/channels/telegram.png";

  return (
    <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg">
      <img
        src={src}
        alt={platform === "facebook" ? "Messenger" : "Telegram"}
        className="h-full w-full object-cover"
        draggable={false}
      />
    </span>
  );
}

/*
 * "bar" is the original full-width row above the conversation list.
 * "rail" is an icon-only trigger that lives in the inbox icon rail and
 * floats its panel to the right, the same way Smart Views do.
 */
type InboxChannelSelectorVariant = "bar" | "rail";

export function InboxChannelSelector({
  variant = "bar",
}: {
  variant?: InboxChannelSelectorVariant;
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isKhmer = useWorkspaceLanguageId() === "km";

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<InboxChannel[]>([]);
  const [deniedChannelId, setDeniedChannelId] =
    useState<string | null>(null);
  const [switchingChannelId, setSwitchingChannelId] =
    useState<string | null>(null);

  const selectedChannelId =
    searchParams.get("channel") ??
    searchParams.get("page");

  const selectedWorkspaceId =
    searchParams.get("workspace");

  useEffect(() => {
    let cancelled = false;

    async function loadChannels() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          "/api/inbox/channels",
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as ChannelsResponse;

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ?? "Unable to load channels.",
          );
        }

        if (!cancelled) {
          setChannels(result.channels ?? []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load channels.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadChannels();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedChannel =
    useMemo(
      () =>
        selectedChannelId
          ? channels.find(
              (channel) =>
                channel.id === selectedChannelId,
            ) ?? null
          : null,
      [channels, selectedChannelId],
    );

  const subscriptionGroups =
    useMemo(() => {
      const groups = new Map<string, SubscriptionGroup>();

      for (const channel of channels) {
        const key =
          channel.subscriptionId ??
          `legacy:${channel.businessId}`;

        const existing = groups.get(key);

        if (existing) {
          existing.channels.push(channel);
          existing.accessAllowed =
            existing.accessAllowed ||
            channel.subscriptionAccessAllowed;
          existing.operational =
            existing.operational &&
            channel.subscriptionOperational !== false;
          continue;
        }

        groups.set(key, {
          key,
          businessId: channel.businessId,
          subscriptionId: channel.subscriptionId,
          accessAllowed:
            channel.subscriptionAccessAllowed,
          operational:
            channel.subscriptionOperational !== false,
          channels: [channel],
        });
      }

      return Array.from(groups.values());
    }, [channels]);

  function channelSecondaryText(channel: InboxChannel) {
    if (channel.platform === "telegram") {
      return channel.username
        ? `@${channel.username}`
        : "Telegram Bot";
    }

    return "Messenger";
  }

  function buildInboxUrl({
    channelId = null,
    workspaceId = null,
  }: {
    channelId?: string | null;
    workspaceId?: string | null;
  }) {
    const query =
      new URLSearchParams(searchParams.toString());

    query.delete("conversation");
    query.delete("page");

    if (channelId) {
      query.set("channel", channelId);
      query.delete("workspace");
    } else {
      query.delete("channel");

      if (workspaceId) {
        query.set("workspace", workspaceId);
      } else {
        query.delete("workspace");
      }
    }

    const queryString = query.toString();

    return queryString
      ? `/dashboard/inbox?${queryString}`
      : "/dashboard/inbox";
  }

  function accessErrorForChannel(channel: InboxChannel) {
    if (channel.membershipAccessAllowed === false) {
      return `${REMOVED_ACCESS_TITLE} ${REMOVED_ACCESS_DETAIL}`;
    }

    if (channel.subscriptionOperational === false) {
      return `${SUBSCRIPTION_LOCKED_TITLE} ${SUBSCRIPTION_LOCKED_DETAIL}`;
    }

    return `${CHANNEL_DISABLED_TITLE} ${CHANNEL_DISABLED_DETAIL}`;
  }

  async function selectChannel(channel: InboxChannel) {
    setError(null);

    if (!channel.accessAllowed) {
      setDeniedChannelId(channel.id);
      setError(accessErrorForChannel(channel));
      setOpen(true);
      return;
    }

    setDeniedChannelId(null);
    setSwitchingChannelId(channel.id);

    try {
      setOpen(false);
      router.push(
        buildInboxUrl({
          channelId: channel.id,
        }),
      );
      router.refresh();
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : "Unable to open this channel.",
      );
      setOpen(true);
    } finally {
      setSwitchingChannelId(null);
    }
  }

  async function selectSubscription(group: SubscriptionGroup) {
    setError(null);

    if (!group.accessAllowed) {
      setError(
        group.operational
          ? `${REMOVED_ACCESS_TITLE} ${REMOVED_ACCESS_DETAIL}`
          : `${SUBSCRIPTION_LOCKED_TITLE} ${SUBSCRIPTION_LOCKED_DETAIL}`,
      );
      setOpen(true);
      return;
    }

    setSwitchingChannelId(`group:${group.key}`);

    try {
      setOpen(false);
      router.push(
        buildInboxUrl({
          workspaceId: group.businessId,
        }),
      );
      router.refresh();
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : "Unable to open this subscription.",
      );
      setOpen(true);
    } finally {
      setSwitchingChannelId(null);
    }
  }

  function selectAllChannels() {
    setDeniedChannelId(null);
    setError(null);
    setOpen(false);

    router.push(
      buildInboxUrl({
        channelId: null,
        workspaceId: null,
      }),
    );
    router.refresh();
  }

  const selectedWorkspaceGroup =
    selectedWorkspaceId
      ? subscriptionGroups.find(
          (group) =>
            group.businessId === selectedWorkspaceId,
        ) ?? null
      : null;

  const selectedLabel =
    selectedChannel
      ? selectedChannel.platform === "telegram" &&
        selectedChannel.username
        ? `@${selectedChannel.username}`
        : selectedChannel.name
      : selectedWorkspaceGroup
        ? shortSubscriptionId(
            selectedWorkspaceGroup.subscriptionId,
          )
        : isKhmer ? "ឆានែលទាំងអស់" : "All Channels";

  const selectedPlatform =
    selectedChannel?.platform ?? "all";

  function renderChannelButton(
    channel: InboxChannel,
  ) {
    const selected =
      selectedChannelId === channel.id;
    const denied =
      deniedChannelId === channel.id;
    const switching =
      switchingChannelId === channel.id;

    return (
      <div key={channel.id} className="rounded-xl">
        <button
          type="button"
          onClick={() =>
            void selectChannel(channel)
          }
          disabled={Boolean(switchingChannelId)}
          className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition disabled:cursor-wait ${
            selected
              ? "bg-blue-50"
              : channel.accessAllowed
                ? "hover:bg-slate-50"
                : "hover:bg-red-50/60"
          }`}
        >
          <ChannelIcon platform={channel.platform} />

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">
              {channel.name}
            </span>

            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {channelSecondaryText(channel)}
            </span>

            {!channel.accessAllowed ? (
              <span className="mt-1 block text-[11px] font-semibold leading-4 text-red-600">
                {channel.membershipAccessAllowed === false
                  ? REMOVED_ACCESS_TITLE
                  : channel.subscriptionOperational === false
                    ? SUBSCRIPTION_LOCKED_TITLE
                    : CHANNEL_DISABLED_TITLE}
              </span>
            ) : null}

            {denied ? (
              <span className="mt-1 block text-[11px] leading-4 text-red-500">
                {accessErrorForChannel(channel)}
              </span>
            ) : null}
          </span>

          {switching ? (
            <span className="shrink-0 text-xs font-semibold text-slate-400">
              {isKhmer ? "កំពុងបើក…" : "Opening…"}
            </span>
          ) : selected && channel.accessAllowed ? (
            <span className="shrink-0 text-sm font-bold text-blue-600">
              ✓
            </span>
          ) : !channel.accessAllowed ? (
            <span className="shrink-0 text-sm font-bold text-red-500">
              !
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  const isRail = variant === "rail";
  const channelLabel = isKhmer ? "ឆានែលអតិថិជន" : "Customer channel";

  return (
    <div
      className={
        isRail
          ? "relative"
          : "relative flex h-[86px] shrink-0 items-center border-b border-slate-200 bg-white px-3 py-3"
      }
    >
      {isRail ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className={`group relative mx-auto flex h-11 w-11 items-center justify-center rounded-xl border transition ${
            open
              ? "border-blue-600 bg-blue-50 text-blue-700"
              : "border-transparent text-slate-500 hover:bg-white hover:text-slate-900"
          }`}
          aria-expanded={open}
          aria-label={channelLabel}
        >
          <ChannelIcon platform={selectedPlatform} />

          <span className="pointer-events-none absolute left-[52px] top-1/2 z-[100] hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-xl group-hover:block">
            {channelLabel}
            {loading ? "" : ` · ${selectedLabel}`}
            <span className="absolute right-full top-1/2 -translate-y-1/2 border-y-4 border-r-4 border-y-transparent border-r-slate-950" />
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() =>
            setOpen((current) => !current)
          }
          className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white"
          aria-expanded={open}
        >
          <ChannelIcon platform={selectedPlatform} />

          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              {channelLabel}
            </span>

            <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900">
              {loading
                ? isKhmer ? "កំពុងផ្ទុកឆានែល..." : "Loading channels..."
                : selectedLabel}
            </span>
          </span>

          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`h-4 w-4 shrink-0 text-slate-400 transition ${
              open ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          >
            <path
              d="m6 9 6 6 6-6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
            aria-label={isKhmer ? "បិទកម្មវិធីជ្រើសរើសឆានែល" : "Close channel selector"}
          />

          <div
            className={
              isRail
                ? "absolute left-[52px] top-0 z-50 max-h-[440px] w-[320px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl"
                : "absolute left-3 right-3 top-[72px] z-50 max-h-[440px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl"
            }
          >
            <button
              type="button"
              onClick={selectAllChannels}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                !selectedChannelId && !selectedWorkspaceId
                  ? "bg-blue-50"
                  : "hover:bg-slate-50"
              }`}
            >
              <ChannelIcon platform="all" />

              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">
                  {isKhmer ? "ឆានែលទាំងអស់" : "All Channels"}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {isKhmer ? "Messenger និង Telegram" : "Messenger and Telegram"}
                </span>
              </span>

              {!selectedChannelId && !selectedWorkspaceId ? (
                <span className="text-sm font-bold text-blue-600">
                  ✓
                </span>
              ) : null}
            </button>

            {subscriptionGroups.map((group) => {
              const color = subscriptionAccentColor(
                group.subscriptionId,
                group.businessId,
              );
              const groupSelected =
                selectedWorkspaceId === group.businessId &&
                !selectedChannelId;
              const groupSwitching =
                switchingChannelId === `group:${group.key}`;

              return (
                <div
                  key={group.key}
                  className="mt-2 border-t border-slate-100 pt-2"
                >
                  <button
                    type="button"
                    onClick={() =>
                      void selectSubscription(group)
                    }
                    disabled={Boolean(switchingChannelId)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition ${
                      groupSelected
                        ? "bg-slate-100"
                        : group.accessAllowed
                          ? "hover:bg-slate-50"
                          : "hover:bg-red-50/60"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-600">
                      {shortSubscriptionId(group.subscriptionId)}
                    </span>
                    {groupSwitching ? (
                      <span className="text-[10px] font-semibold text-slate-400">
                        {isKhmer ? "កំពុងបើក…" : "Opening…"}
                      </span>
                    ) : groupSelected ? (
                      <span className="text-xs font-bold text-slate-600">
                        ✓
                      </span>
                    ) : !group.accessAllowed ? (
                      <span className="text-xs font-bold text-red-500">
                        !
                      </span>
                    ) : null}
                  </button>

                  <div className="mt-0.5">
                    {group.channels.map(renderChannelButton)}
                  </div>
                </div>
              );
            })}

            {!loading && channels.length === 0 ? (
              <div className="px-3 py-5 text-center text-xs text-slate-500">
                No channels connected.
              </div>
            ) : null}

            {error ? (
              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                {error}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}