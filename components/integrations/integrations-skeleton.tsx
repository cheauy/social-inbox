"use client";

import type { ReactNode } from "react";

type Platform =
  | "messenger"
  | "telegram"
  | "instagram"
  | "whatsapp"
  | "tiktok";

type PlatformTab = {
  id: Platform;
  label: string;
  count: number;
};

type FacebookPageItem = {
  id: string;
  pageId: string;
  name: string;
  avatarUrl?: string | null;

  connected: boolean;
  inboxActive: boolean;
  messengerConnected: boolean;
  commentsConnected: boolean;
  tokenConnected: boolean;

  conversations?: number;
  messages?: number;
  teamMembers?: number;
};

type IntegrationsSkeletonProps = {
  workspaceName: string;
  workspaceRole?: string;

  activePlatform: Platform;
  tabs: PlatformTab[];

  facebookPages: FacebookPageItem[];

  onWorkspaceClick?: () => void;
  onPlatformChange?: (platform: Platform) => void;

  onAddFacebookPage?: () => void;

  onUseInInbox?: (page: FacebookPageItem) => void;
  onActivateInbox?: (page: FacebookPageItem) => void;
  onOpenPage?: (page: FacebookPageItem) => void;
  onSyncComments?: (page: FacebookPageItem) => void;
  onDisconnect?: (page: FacebookPageItem) => void;
  onMore?: (page: FacebookPageItem) => void;

  telegramContent?: ReactNode;
  instagramContent?: ReactNode;
  whatsappContent?: ReactNode;
  tiktokContent?: ReactNode;
};

function MessengerIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-black text-white">
      ↗
    </span>
  );
}

function TelegramIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-500 text-sm font-black text-white">
      ➤
    </span>
  );
}

function InstagramIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pink-500 text-xs font-black text-white">
      ◎
    </span>
  );
}

function WhatsAppIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-sm font-black text-white">
      ☎
    </span>
  );
}

function TikTokIcon() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-sm font-black text-white">
      ♪
    </span>
  );
}

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === "telegram") return <TelegramIcon />;
  if (platform === "instagram") return <InstagramIcon />;
  if (platform === "whatsapp") return <WhatsAppIcon />;
  if (platform === "tiktok") return <TikTokIcon />;
  return <MessengerIcon />;
}

function SmallStatus({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "neutral";
}) {
  const className =
    tone === "green"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-600";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
    >
      {tone === "green" ? (
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
      ) : null}
      {children}
    </span>
  );
}

function Metric({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: ReactNode;
  sublabel?: string;
}) {
  return (
    <div className="min-w-[110px]">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
      {sublabel ? (
        <p className="mt-1 text-xs text-slate-400">{sublabel}</p>
      ) : null}
    </div>
  );
}

function PageAvatar({ page }: { page: FacebookPageItem }) {
  if (page.avatarUrl) {
    return (
      <img
        src={page.avatarUrl}
        alt=""
        className="h-12 w-12 rounded-full object-cover"
      />
    );
  }

  const initials = page.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-950 text-sm font-bold text-white">
      {initials || "FB"}
    </div>
  );
}

export function IntegrationsSkeleton({
  workspaceName,
  workspaceRole = "Owner",
  activePlatform,
  tabs,
  facebookPages,
  onWorkspaceClick,
  onPlatformChange,
  onAddFacebookPage,
  onUseInInbox,
  onActivateInbox,
  onOpenPage,
  onSyncComments,
  onDisconnect,
  onMore,
  telegramContent,
  instagramContent,
  whatsappContent,
  tiktokContent,
}: IntegrationsSkeletonProps) {
  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-[1500px] px-5 py-4 sm:px-6">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Workspace
          </p>

          <button
            type="button"
            onClick={onWorkspaceClick}
            className="flex w-full max-w-[460px] items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:bg-slate-50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-black text-blue-600">
                WS
              </div>

              <span className="truncate font-semibold text-slate-900">
                {workspaceName}
              </span>

              <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700">
                {workspaceRole}
              </span>
            </div>

            <span className="text-slate-400">⌄</span>
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-[1500px] px-5 py-6 sm:px-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-500">
            Channels
          </p>

          <h1 className="mt-1 text-3xl font-bold text-slate-950">
            Integrations
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Connect and manage all your social channels in one place.
          </p>
        </div>

        <div className="mt-7 overflow-x-auto">
          <div className="inline-flex min-w-max items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            {tabs.map((tab) => {
              const active = activePlatform === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onPlatformChange?.(tab.id)}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span className="scale-75">
                    <PlatformIcon platform={tab.id} />
                  </span>

                  <span>{tab.label}</span>

                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      active
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {activePlatform === "messenger" ? (
          <section className="mt-6 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <MessengerIcon />

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-950">
                      Facebook Pages
                    </h2>

                    <SmallStatus tone="green">
                      {
                        facebookPages.filter((page) => page.connected).length
                      }{" "}
                      Connected
                    </SmallStatus>
                  </div>

                  <p className="mt-1 text-sm text-slate-500">
                    Manage your Facebook Pages and Messenger conversations.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onAddFacebookPage}
                className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100"
              >
                + Add Facebook Page
              </button>
            </div>

            <div className="space-y-3 p-4">
              {facebookPages.map((page) => (
                <article
                  key={page.id}
                  className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-center">
                    <div className="flex min-w-[300px] flex-1 items-start gap-4">
                      <PageAvatar page={page} />

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-bold text-slate-950">
                            {page.name}
                          </h3>

                          {page.inboxActive ? (
                            <SmallStatus tone="green">
                              Connected
                            </SmallStatus>
                          ) : (
                            <SmallStatus tone="amber">
                              Inbox inactive
                            </SmallStatus>
                          )}
                        </div>

                        <p className="mt-1 text-sm text-slate-500">
                          Page ID: {page.pageId}
                        </p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {page.messengerConnected ? (
                            <SmallStatus tone="green">
                              Messenger
                            </SmallStatus>
                          ) : (
                            <SmallStatus>Messenger</SmallStatus>
                          )}

                          {page.commentsConnected ? (
                            <SmallStatus tone="green">
                              Comments
                            </SmallStatus>
                          ) : (
                            <SmallStatus>Comments</SmallStatus>
                          )}

                          <SmallStatus
                            tone={
                              page.tokenConnected ? "green" : "neutral"
                            }
                          >
                            Token:{" "}
                            {page.tokenConnected
                              ? "connected"
                              : "unavailable"}
                          </SmallStatus>
                        </div>
                      </div>
                    </div>

                    {page.inboxActive ? (
                      <>
                        <div className="hidden h-28 w-px bg-slate-200 xl:block" />

                        <div className="grid flex-[1.15] grid-cols-2 gap-5 sm:grid-cols-3">
                          <Metric
                            label="Conversations"
                            value={page.conversations ?? "—"}
                            sublabel="Last 7 days"
                          />

                          <Metric
                            label="Messages"
                            value={page.messages ?? "—"}
                            sublabel="Last 7 days"
                          />

                          <Metric
                            label="Team Members"
                            value={page.teamMembers ?? "—"}
                            sublabel="Assigned"
                          />
                        </div>

                        <div className="hidden h-28 w-px bg-slate-200 xl:block" />

                        <div className="grid min-w-[260px] grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => onUseInInbox?.(page)}
                            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                          >
                            ◫ Use in Inbox
                          </button>

                          <button
                            type="button"
                            onClick={() => onOpenPage?.(page)}
                            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Open Page ↗
                          </button>

                          <button
                            type="button"
                            onClick={() => onSyncComments?.(page)}
                            className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-700 hover:bg-violet-100"
                          >
                            Sync comments
                          </button>

                          <button
                            type="button"
                            onClick={() => onDisconnect?.(page)}
                            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100"
                          >
                            Disconnect
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => onMore?.(page)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-slate-400 hover:bg-slate-100"
                          aria-label={`More actions for ${page.name}`}
                        >
                          ⋮
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="flex-[1.3]">
                          <div className="flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="font-semibold text-amber-900">
                                Inbox is not active
                              </p>

                              <p className="mt-1 text-sm text-amber-700">
                                Activate this channel so new Facebook messages can appear in TENH.
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => onActivateInbox?.(page)}
                              className="shrink-0 rounded-xl border border-amber-300 bg-amber-100 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-200"
                            >
                              Activate Inbox
                            </button>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onMore?.(page)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xl text-slate-400 hover:bg-slate-100"
                        >
                          ⋮
                        </button>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {activePlatform === "telegram" ? (
          <div className="mt-6">{telegramContent}</div>
        ) : null}

        {activePlatform === "instagram" ? (
          <div className="mt-6">{instagramContent}</div>
        ) : null}

        {activePlatform === "whatsapp" ? (
          <div className="mt-6">{whatsappContent}</div>
        ) : null}

        {activePlatform === "tiktok" ? (
          <div className="mt-6">{tiktokContent}</div>
        ) : null}
      </main>
    </div>
  );
}
