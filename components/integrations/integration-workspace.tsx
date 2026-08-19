"use client";

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { TelegramChannelPanel } from "@/components/integrations/telegram-channel-panel";
import { WorkspaceContextSwitcher } from "@/components/subscription/workspace-context-switcher";

import {
  TENH_CHANNEL_CATALOG,
  type TenhChannelDefinition,
  type TenhChannelPlatform,
} from "@/lib/channels/channel-catalog";

type IntegrationWorkspaceProps = {
  children: ReactNode;
};

function ChannelMark({
  platform,
}: {
  platform: TenhChannelPlatform;
}) {
  const src =
    platform === "facebook"
      ? "/images/channels/messenger.png"
      : platform === "telegram"
        ? "/images/channels/telegram.png"
        : platform === "instagram"
          ? "/images/channels/instagram.png"
          : platform === "whatsapp"
            ? "/images/channels/whatsapp.png"
            : "/images/channels/tiktok.png";

  const alt =
    platform === "facebook"
      ? "Messenger"
      : platform === "telegram"
        ? "Telegram"
        : platform === "instagram"
          ? "Instagram"
          : platform === "whatsapp"
            ? "WhatsApp"
            : "TikTok";

  return (
    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-xl shadow-sm">
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        draggable={false}
      />
    </span>
  );
}


function StatusPill({
  channel,
  activeCount = 0,
  totalCount = 0,
}: {
  channel: TenhChannelDefinition;
  activeCount?: number;
  totalCount?: number;
}) {
  if (channel.platform === "facebook" || channel.platform === "telegram") {
    if (activeCount > 0) {
      return (
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
          Connected
        </span>
      );
    }

    if (totalCount > 0) {
      return (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
          Disabled
        </span>
      );
    }

    return (
      <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {channel.platform === "telegram" ? "Setup" : "Not connected"}
      </span>
    );
  }

  if (channel.availability === "available") {
    return (
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
        Live
      </span>
    );
  }

  if (channel.availability === "next") {
    return (
      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
        Next
      </span>
    );
  }

  return (
    <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
      Soon
    </span>
  );
}

function PlannedChannelPanel({
  channel,
}: {
  channel: TenhChannelDefinition;
}) {
  const isNext =
    channel.availability === "next";

  return (
    <section className="overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
      <div className="border-b border-slate-200 bg-slate-50/70 px-6 py-5 sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <ChannelMark
              platform={channel.platform}
            />

            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
                Customer channel
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">
                {channel.name}
              </h2>
            </div>
          </div>

          <StatusPill channel={channel} />
        </div>
      </div>

      <div className="p-6 sm:p-7">
        <div
          className={`rounded-2xl border p-5 ${
            isNext
              ? "border-blue-200 bg-blue-50/70"
              : "border-slate-200 bg-slate-50"
          }`}
        >
          <p
            className={`text-sm font-bold ${
              isNext
                ? "text-blue-900"
                : "text-slate-800"
            }`}
          >
            {isNext
              ? "Telegram connection is coming next"
              : `${channel.name} is coming soon`}
          </p>

          <p
            className={`mt-2 max-w-2xl text-sm leading-6 ${
              isNext
                ? "text-blue-800"
                : "text-slate-600"
            }`}
          >
            {channel.description}
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              Connection status
            </p>
            <p className="mt-2 font-semibold text-slate-900">
              Not available yet
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              TENH does not request credentials or create a social account for this channel yet.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              Subscription usage
            </p>
            <p className="mt-2 font-semibold text-slate-900">
              Uses 0 channel slots
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              A channel slot is consumed only after the integration is released and an account is actually connected.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled
          aria-disabled="true"
          className="mt-6 cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-400"
        >
          {isNext
            ? "Telegram connection coming next"
            : "Coming soon"}
        </button>
      </div>
    </section>
  );
}

export function IntegrationWorkspace({
  children,
}: IntegrationWorkspaceProps) {
  const [activePlatform, setActivePlatform] =
    useState<TenhChannelPlatform>("facebook");
  const [telegramSummary, setTelegramSummary] = useState({ active: 0, total: 0 });
  const [facebookSummary, setFacebookSummary] = useState({ active: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;

    async function loadConnectionSummary() {
      try {
        const usageResponse = await fetch("/api/subscription/usage-management", {
          method: "GET",
          cache: "no-store",
        });

        if (!usageResponse.ok) return;

        const usageResult = (await usageResponse.json()) as {
          connections?: Array<{
            platform?: string;
            is_active?: boolean;
          }>;
        };

        if (cancelled) return;

        const connections = usageResult.connections ?? [];
        const facebook = connections.filter(
          (connection) => connection.platform === "facebook",
        );
        const telegram = connections.filter(
          (connection) => connection.platform === "telegram",
        );

        setFacebookSummary({
          total: facebook.length,
          active: facebook.filter((connection) => connection.is_active === true).length,
        });
        setTelegramSummary({
          total: telegram.length,
          active: telegram.filter((connection) => connection.is_active === true).length,
        });
      } catch {
        // Keep navigation usable if a status probe fails.
      }
    }

    void loadConnectionSummary();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeChannel =
    TENH_CHANNEL_CATALOG.find(
      (channel) =>
        channel.platform === activePlatform,
    ) ?? TENH_CHANNEL_CATALOG[0];

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="self-start rounded-[26px] border border-slate-200 bg-white p-3 shadow-[0_8px_30px_rgba(15,23,42,0.05)] lg:sticky lg:top-24">
        <div className="px-3 pb-3 pt-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
            Channels
          </p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">
            Integrations
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Select a channel to manage its connection.
          </p>
        </div>

        <WorkspaceContextSwitcher compact className="mb-3" />

        <nav
          className="space-y-1.5"
          aria-label="Integration channels"
        >
          {TENH_CHANNEL_CATALOG.map(
            (channel) => {
              const isActive =
                activePlatform ===
                channel.platform;

              return (
                <button
                  key={channel.platform}
                  type="button"
                  onClick={() =>
                    setActivePlatform(
                      channel.platform,
                    )
                  }
                  className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                    isActive
                      ? "border-blue-200 bg-blue-50 shadow-sm"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                  }`}
                  aria-current={
                    isActive
                      ? "page"
                      : undefined
                  }
                >
                  <ChannelMark
                    platform={channel.platform}
                  />

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm font-semibold ${
                        isActive
                          ? "text-blue-950"
                          : "text-slate-800"
                      }`}
                    >
                      {channel.shortName}
                    </span>

                    <span className="mt-1 block text-[11px] text-slate-500">
                      {channel.platform === "facebook"
                        ? facebookSummary.total > 0
                          ? `${facebookSummary.active}/${facebookSummary.total} Pages enabled`
                          : "Not connected"
                        : channel.platform === "telegram"
                          ? telegramSummary.total > 0
                            ? `${telegramSummary.active}/${telegramSummary.total} Bots enabled`
                            : "Setup available"
                          : channel.availability ===
                              "available"
                            ? "Available now"
                            : channel.availability ===
                                "next"
                              ? "Coming next"
                              : "Coming soon"}
                    </span>
                  </span>

                  <StatusPill
                    channel={channel}
                    activeCount={
                      channel.platform === "facebook"
                        ? facebookSummary.active
                        : channel.platform === "telegram"
                          ? telegramSummary.active
                          : 0
                    }
                    totalCount={
                      channel.platform === "facebook"
                        ? facebookSummary.total
                        : channel.platform === "telegram"
                          ? telegramSummary.total
                          : 0
                    }
                  />
                </button>
              );
            },
          )}
        </nav>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500">
          Coming-soon channels do not consume workspace channel capacity.
        </div>
      </aside>

      <div className="min-h-0 min-w-0">
        <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain pr-1">
        {activePlatform === "facebook" ? (
          <div className="min-w-0">
            {children}
          </div>
        ) : activePlatform === "telegram" ? (
          <TelegramChannelPanel
            onConnectionChanged={setTelegramSummary}
          />
        ) : (
          <PlannedChannelPanel
            channel={activeChannel}
          />
        )}
        </div>
      </div>
    </div>
  );
}
