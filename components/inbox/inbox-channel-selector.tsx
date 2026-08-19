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

type InboxChannel = {
  id: string;
  businessId: string;
  accessAllowed: boolean;
  subscriptionAccessAllowed: boolean;
  channelEnabled: boolean;
  platform:
    | "facebook"
    | "telegram";
  platformAccountId:
    | string
    | null;
  name: string;
  username:
    | string
    | null;
};

type ChannelsResponse = {
  success?: boolean;
  error?: string;
  currentBusinessId?: string | null;
  currentBusinessAccess?: boolean;
  channels?: InboxChannel[];
};

const REMOVED_ACCESS_TITLE =
  "You no longer have access to this subscription.";

const REMOVED_ACCESS_DETAIL =
  "An Owner may have removed your access. Your TENH account and any other subscriptions are unchanged.";

const CHANNEL_DISABLED_TITLE =
  "This channel is disabled.";

const CHANNEL_DISABLED_DETAIL =
  "An Owner disabled this channel. It does not use a channel slot and cannot be opened until an Owner enables it.";

function ChannelIcon({
  platform,
}: {
  platform:
    | "facebook"
    | "telegram"
    | "all";
}) {
  if (platform === "all") {
    return (
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-700"
        aria-hidden="true"
      >
        A
      </span>
    );
  }

  const src =
    platform === "facebook"
      ? "/images/channels/messenger.png"
      : "/images/channels/telegram.png";

  const alt =
    platform === "facebook"
      ? "Messenger"
      : "Telegram";

  return (
    <span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg">
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        draggable={false}
      />
    </span>
  );
}

export function InboxChannelSelector() {
  const router =
    useRouter();
  const searchParams =
    useSearchParams();

  const [open, setOpen] =
    useState(false);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState<string | null>(null);
  const [channels, setChannels] =
    useState<InboxChannel[]>([]);
  const [
    currentBusinessId,
    setCurrentBusinessId,
  ] =
    useState<string | null>(null);
  const [
    currentBusinessAccess,
    setCurrentBusinessAccess,
  ] =
    useState(true);
  const [
    deniedChannelId,
    setDeniedChannelId,
  ] =
    useState<string | null>(null);
  const [
    switchingChannelId,
    setSwitchingChannelId,
  ] =
    useState<string | null>(null);

  const selectedChannelId =
    searchParams.get("channel") ??
    searchParams.get("page");

  useEffect(() => {
    let cancelled = false;

    async function loadChannels() {
      setLoading(true);
      setError(null);

      try {
        const response =
          await fetch(
            "/api/inbox/channels",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        const result =
          (await response.json()) as
            ChannelsResponse;

        if (
          !response.ok ||
          !result.success
        ) {
          throw new Error(
            result.error ??
              "Unable to load channels.",
          );
        }

        if (!cancelled) {
          setChannels(
            result.channels ?? [],
          );
          setCurrentBusinessId(
            result.currentBusinessId ??
              null,
          );
          setCurrentBusinessAccess(
            result.currentBusinessAccess !==
              false,
          );
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
                channel.id ===
                selectedChannelId,
            ) ?? null
          : null,
      [
        channels,
        selectedChannelId,
      ],
    );

  const facebookChannels =
    useMemo(
      () =>
        channels.filter(
          (channel) =>
            channel.platform ===
            "facebook",
        ),
      [channels],
    );

  const telegramChannels =
    useMemo(
      () =>
        channels.filter(
          (channel) =>
            channel.platform ===
            "telegram",
        ),
      [channels],
    );

  function channelSecondaryText(
    channel: InboxChannel,
  ) {
    if (
      channel.platform ===
      "telegram"
    ) {
      return channel.username
        ? `@${channel.username}`
        : "Telegram Bot";
    }

    return "Messenger";
  }

  function buildInboxUrl(
    channelId: string | null,
  ) {
    const query =
      new URLSearchParams(
        searchParams.toString(),
      );

    /*
     * A conversation belongs to one channel.
     * When switching channels, remove the
     * previous conversation selection.
     */
    query.delete("conversation");

    /*
     * V3.1.17 used ?page=<social_account_uuid>.
     * Keep reading it for backward compatibility,
     * but V3.11.4 writes the generic ?channel= key.
     */
    query.delete("page");

    if (channelId) {
      query.set(
        "channel",
        channelId,
      );
    } else {
      query.delete("channel");
    }

    const queryString =
      query.toString();

    return queryString
      ? `/dashboard/inbox?${queryString}`
      : "/dashboard/inbox";
  }

  async function selectChannel(
    channel: InboxChannel,
  ) {
    setError(null);

    /*
     * A removed subscription remains visible so the user understands what
     * happened, but TENH never opens it and never changes workspace context.
     */
    if (!channel.accessAllowed) {
      setDeniedChannelId(
        channel.id,
      );
      setError(
        channel.subscriptionAccessAllowed &&
        !channel.channelEnabled
          ? `${CHANNEL_DISABLED_TITLE} ${CHANNEL_DISABLED_DETAIL}`
          : `${REMOVED_ACCESS_TITLE} ${REMOVED_ACCESS_DETAIL}`,
      );
      setOpen(true);
      return;
    }

    setDeniedChannelId(null);
    setSwitchingChannelId(
      channel.id,
    );

    try {
      /*
       * Moving to a channel that belongs to another subscription is a manual
       * user action. TENH never performs this switch automatically.
       */
      if (
        channel.businessId !==
        currentBusinessId
      ) {
        const switchResponse =
          await fetch(
            "/api/workspaces/switch",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                businessId:
                  channel.businessId,
              }),
            },
          );

        const switchResult =
          (await switchResponse.json()) as {
            success?: boolean;
            error?: string;
          };

        if (
          !switchResponse.ok ||
          !switchResult.success
        ) {
          if (
            switchResponse.status ===
            403
          ) {
            setChannels(
              (current) =>
                current.map(
                  (item) =>
                    item.businessId ===
                    channel.businessId
                      ? {
                          ...item,
                          subscriptionAccessAllowed:
                            false,
                          accessAllowed:
                            false,
                        }
                      : item,
                ),
            );
            setDeniedChannelId(
              channel.id,
            );
            setOpen(true);
            return;
          }

          throw new Error(
            switchResult.error ??
              "Unable to open this channel.",
          );
        }

        setCurrentBusinessId(
          channel.businessId,
        );
        setCurrentBusinessAccess(
          true,
        );
      }

      setOpen(false);

      router.push(
        buildInboxUrl(
          channel.id,
        ),
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
      setSwitchingChannelId(
        null,
      );
    }
  }

  function selectAllChannels() {
    setDeniedChannelId(null);

    /*
     * "All Channels" only shows conversations for the currently accessible
     * subscription. If that subscription was removed, do not silently move
     * the user elsewhere.
     */
    if (!currentBusinessAccess) {
      setError(
        `${REMOVED_ACCESS_TITLE} ${REMOVED_ACCESS_DETAIL}`,
      );
      setOpen(true);
      return;
    }

    setError(null);
    setOpen(false);

    router.push(
      buildInboxUrl(null),
    );
    router.refresh();
  }

  const selectedLabel =
    selectedChannel
      ? selectedChannel.platform ===
          "telegram"
        ? selectedChannel.username
          ? `@${selectedChannel.username}`
          : selectedChannel.name
        : selectedChannel.name
      : "All Channels";

  const selectedPlatform =
    selectedChannel?.platform ??
    "all";

  const selectedAccessBlocked =
    Boolean(
      selectedChannel &&
        !selectedChannel.accessAllowed,
    );

  const selectedBlockTitle =
    selectedChannel &&
    selectedChannel.subscriptionAccessAllowed &&
    !selectedChannel.channelEnabled
      ? CHANNEL_DISABLED_TITLE
      : REMOVED_ACCESS_TITLE;

  function renderChannelButton(
    channel: InboxChannel,
  ) {
    const selected =
      selectedChannelId ===
      channel.id;

    const denied =
      deniedChannelId ===
      channel.id;

    const switching =
      switchingChannelId ===
      channel.id;

    const selectedClasses =
      channel.platform ===
      "telegram"
        ? "bg-sky-50"
        : "bg-blue-50";

    return (
      <div
        key={channel.id}
        className="rounded-xl"
      >
        <button
          type="button"
          onClick={() =>
            void selectChannel(
              channel,
            )
          }
          disabled={Boolean(
            switchingChannelId,
          )}
          className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition disabled:cursor-wait ${
            selected
              ? selectedClasses
              : channel.accessAllowed
                ? "hover:bg-slate-50"
                : "hover:bg-red-50/60"
          }`}
        >
          <ChannelIcon
            platform={
              channel.platform
            }
          />

          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">
              {channel.name}
            </span>

            <span className="mt-0.5 block truncate text-xs text-slate-500">
              {channelSecondaryText(
                channel,
              )}
            </span>

            {!channel.accessAllowed ? (
              <span className="mt-1 block text-[11px] font-semibold leading-4 text-red-600">
                {channel.subscriptionAccessAllowed &&
                !channel.channelEnabled
                  ? CHANNEL_DISABLED_TITLE
                  : REMOVED_ACCESS_TITLE}
              </span>
            ) : null}

            {denied ? (
              <span className="mt-1 block text-[11px] leading-4 text-red-500">
                {channel.subscriptionAccessAllowed &&
                !channel.channelEnabled
                  ? CHANNEL_DISABLED_DETAIL
                  : REMOVED_ACCESS_DETAIL}
              </span>
            ) : null}
          </span>

          {switching ? (
            <span className="shrink-0 text-xs font-semibold text-slate-400">
              Opening…
            </span>
          ) : selected &&
            channel.accessAllowed ? (
            <span
              className={`shrink-0 text-sm font-bold ${
                channel.platform ===
                "telegram"
                  ? "text-sky-600"
                  : "text-blue-600"
              }`}
            >
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

  return (
    <div className="relative shrink-0 border-b border-slate-200 bg-white px-3 py-3">
      <button
        type="button"
        onClick={() =>
          setOpen(
            (current) =>
              !current,
          )
        }
        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
          selectedAccessBlocked
            ? "border-red-200 bg-red-50/50 hover:bg-red-50"
            : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
        }`}
        aria-expanded={open}
      >
        <ChannelIcon
          platform={
            selectedPlatform
          }
        />

        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Customer channel
          </span>

          <span className="mt-0.5 block truncate text-sm font-semibold text-slate-900">
            {loading
              ? "Loading channels..."
              : selectedLabel}
          </span>

          {selectedAccessBlocked ? (
            <span className="mt-1 block text-[11px] font-semibold text-red-600">
              {selectedBlockTitle}
            </span>
          ) : null}
        </span>

        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`h-4 w-4 shrink-0 text-slate-400 transition ${
            open
              ? "rotate-180"
              : ""
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

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() =>
              setOpen(false)
            }
            aria-label="Close channel selector"
          />

          <div className="absolute left-3 right-3 top-[72px] z-50 max-h-[420px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
            <button
              type="button"
              onClick={
                selectAllChannels
              }
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                !selectedChannelId &&
                currentBusinessAccess
                  ? "bg-blue-50"
                  : currentBusinessAccess
                    ? "hover:bg-slate-50"
                    : "hover:bg-red-50/60"
              }`}
            >
              <ChannelIcon
                platform="all"
              />

              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">
                  All Channels
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Messenger and Telegram
                </span>
                {!currentBusinessAccess ? (
                  <span className="mt-1 block text-[11px] font-semibold text-red-600">
                    {REMOVED_ACCESS_TITLE}
                  </span>
                ) : null}
              </span>

              {!selectedChannelId &&
              currentBusinessAccess ? (
                <span className="text-sm font-bold text-blue-600">
                  ✓
                </span>
              ) : null}
            </button>

            {facebookChannels.length >
            0 ? (
              <div className="mt-2 border-t border-slate-100 pt-2">
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Messenger
                </p>

                {facebookChannels.map(
                  renderChannelButton,
                )}
              </div>
            ) : null}

            {telegramChannels.length >
            0 ? (
              <div className="mt-2 border-t border-slate-100 pt-2">
                <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Telegram
                </p>

                {telegramChannels.map(
                  renderChannelButton,
                )}
              </div>
            ) : null}

            {!loading &&
            channels.length === 0 ? (
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
