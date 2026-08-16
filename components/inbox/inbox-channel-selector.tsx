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
  channels?: InboxChannel[];
};

function ChannelIcon({
  platform,
}: {
  platform:
    | "facebook"
    | "telegram"
    | "all";
}) {
  const label =
    platform === "facebook"
      ? "M"
      : platform === "telegram"
        ? "T"
        : "A";

  return (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
        platform === "facebook"
          ? "bg-blue-600 text-white"
          : platform === "telegram"
            ? "bg-sky-500 text-white"
            : "bg-slate-100 text-slate-700"
      }`}
      aria-hidden="true"
    >
      {label}
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

  function selectChannel(
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

    setOpen(false);

    router.push(
      queryString
        ? `/dashboard/inbox?${queryString}`
        : "/dashboard/inbox",
    );
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
        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-white"
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
              onClick={() =>
                selectChannel(
                  null,
                )
              }
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                !selectedChannelId
                  ? "bg-blue-50"
                  : "hover:bg-slate-50"
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
              </span>

              {!selectedChannelId ? (
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
                  (channel) => (
                    <button
                      key={
                        channel.id
                      }
                      type="button"
                      onClick={() =>
                        selectChannel(
                          channel.id,
                        )
                      }
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        selectedChannelId ===
                        channel.id
                          ? "bg-blue-50"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <ChannelIcon
                        platform="facebook"
                      />

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">
                          {
                            channel.name
                          }
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {channelSecondaryText(
                            channel,
                          )}
                        </span>
                      </span>

                      {selectedChannelId ===
                      channel.id ? (
                        <span className="text-sm font-bold text-blue-600">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  ),
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
                  (channel) => (
                    <button
                      key={
                        channel.id
                      }
                      type="button"
                      onClick={() =>
                        selectChannel(
                          channel.id,
                        )
                      }
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        selectedChannelId ===
                        channel.id
                          ? "bg-sky-50"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <ChannelIcon
                        platform="telegram"
                      />

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900">
                          {
                            channel.name
                          }
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {channelSecondaryText(
                            channel,
                          )}
                        </span>
                      </span>

                      {selectedChannelId ===
                      channel.id ? (
                        <span className="text-sm font-bold text-sky-600">
                          ✓
                        </span>
                      ) : null}
                    </button>
                  ),
                )}
              </div>
            ) : null}

            {!loading &&
            channels.length === 0 ? (
              <div className="px-3 py-5 text-center text-xs text-slate-500">
                No active channels connected.
              </div>
            ) : null}

            {error ? (
              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
