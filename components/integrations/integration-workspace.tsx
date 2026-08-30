"use client";

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { TelegramChannelPanel } from "@/components/integrations/telegram-channel-panel";

import {
  TENH_CHANNEL_CATALOG,
  type TenhChannelDefinition,
  type TenhChannelPlatform,
} from "@/lib/channels/channel-catalog";

type IntegrationWorkspaceProps = {
  children: ReactNode;
  canManageChannels?: boolean;
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
  const isKhmer = useWorkspaceLanguageId() === "km";
  if (channel.platform === "facebook" || channel.platform === "telegram") {
    if (activeCount > 0) {
      return (
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
          {isKhmer ? "បានភ្ជាប់" : "Connected"}
        </span>
      );
    }

    if (totalCount > 0) {
      return (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
          {isKhmer ? "បានបិទ" : "Disabled"}
        </span>
      );
    }

    return (
      <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {channel.platform === "telegram"
          ? isKhmer ? "រៀបចំ" : "Setup"
          : isKhmer ? "មិនទាន់ភ្ជាប់" : "Not connected"}
      </span>
    );
  }

  if (channel.availability === "available") {
    return (
      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
        {isKhmer ? "កំពុងប្រើ" : "Live"}
      </span>
    );
  }

  if (channel.availability === "next") {
    return (
      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700">
        {isKhmer ? "បន្ទាប់" : "Next"}
      </span>
    );
  }

  return (
    <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
      {isKhmer ? "ឆាប់ៗនេះ" : "Soon"}
    </span>
  );
}

function PlannedChannelPanel({
  channel,
}: {
  channel: TenhChannelDefinition;
}) {
  const isKhmer = useWorkspaceLanguageId() === "km";
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
                {isKhmer ? "ឆានែលអតិថិជន" : "Customer channel"}
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
              ? isKhmer
                ? "ការតភ្ជាប់ Telegram នឹងមកដល់បន្ទាប់"
                : "Telegram connection is coming next"
              : isKhmer
                ? `${channel.name} នឹងមកដល់ឆាប់ៗនេះ`
                : `${channel.name} is coming soon`}
          </p>

          <p
            className={`mt-2 max-w-2xl text-sm leading-6 ${
              isNext
                ? "text-blue-800"
                : "text-slate-600"
            }`}
          >
            {isKhmer
              ? `ការគាំទ្រ ${channel.name} ត្រូវបានគ្រោងសម្រាប់ការអាប់ដេត TENH Chat នាពេលខាងមុខ។`
              : channel.description}
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              {isKhmer ? "ស្ថានភាពការតភ្ជាប់" : "Connection status"}
            </p>
            <p className="mt-2 font-semibold text-slate-900">
              {isKhmer ? "មិនទាន់អាចប្រើបាន" : "Not available yet"}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {isKhmer ? "TENH មិនទាន់ស្នើព័ត៌មានសម្ងាត់ ឬបង្កើតគណនីសង្គមសម្រាប់ឆានែលនេះទេ។" : "TENH does not request credentials or create a social account for this channel yet."}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              {isKhmer ? "ការប្រើប្រាស់គម្រោង" : "Subscription usage"}
            </p>
            <p className="mt-2 font-semibold text-slate-900">
              {isKhmer ? "ប្រើ 0 កន្លែងឆានែល" : "Uses 0 channel slots"}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              {isKhmer ? "កន្លែងឆានែលនឹងត្រូវបានប្រើតែបន្ទាប់ពីការតភ្ជាប់ត្រូវបានដាក់ឱ្យប្រើ និងមានគណនីមួយត្រូវបានភ្ជាប់ពិតប្រាកដ។" : "A channel slot is consumed only after the integration is released and an account is actually connected."}
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
            ? isKhmer
              ? "ការតភ្ជាប់ Telegram នឹងមកដល់បន្ទាប់"
              : "Telegram connection coming next"
            : isKhmer
              ? "ឆាប់ៗនេះ"
              : "Coming soon"}
        </button>
      </div>
    </section>
  );
}


type AddConnectionModalProps = {
  open: boolean;
  selectedPlatform: TenhChannelPlatform;
  facebookCount: number;
  telegramCount: number;
  onClose: () => void;
  onSelect: (platform: TenhChannelPlatform) => void;
  onContinue: () => void;
};

function ConnectionInstructions({
  platform,
}: {
  platform: TenhChannelPlatform;
}) {
  const isKhmer = useWorkspaceLanguageId() === "km";

  const steps =
    platform === "facebook"
      ? [
          {
            title: isKhmer ? "ភ្ជាប់ Facebook Page" : "Connect Facebook Page",
            description: isKhmer
              ? "TENH បើកដំណើរការតភ្ជាប់ Facebook ដែលមានស្រាប់សម្រាប់កន្លែងធ្វើការនេះ។"
              : "TENH opens the existing Facebook connection flow for this workspace.",
          },
          {
            title: isKhmer ? "អនុញ្ញាតជាមួយ Facebook" : "Authorize with Facebook",
            description: isKhmer
              ? "ផ្តល់សិទ្ធិឱ្យ TENH ចូលប្រើ Page សារ និងមតិយោបល់ដែលអ្នកជ្រើសរើស។"
              : "Grant TENH access to the Pages, messages, and comments you choose.",
          },
          {
            title: isKhmer ? "ជ្រើសរើស Page" : "Select Pages",
            description: isKhmer
              ? "ជ្រើសរើស Facebook Page មួយ ឬច្រើនដែលត្រូវភ្ជាប់ទៅកន្លែងធ្វើការនេះ។"
              : "Choose one or more Facebook Pages that should be connected to this workspace.",
          },
          {
            title: isKhmer ? "ធ្វើសមកាលកម្មសារ និងមតិយោបល់" : "Sync messages and comments",
            description: isKhmer
              ? "TENH រក្សា Page ដែលបានភ្ជាប់ឱ្យអាចប្រើបានក្នុង Inbox ខណៈប្រវត្តិដែលមានស្រាប់នៅតែត្រូវបានរក្សាទុក។"
              : "TENH keeps the connected Page available in Inbox while your existing history stays preserved.",
          },
        ]
      : platform === "telegram"
        ? [
            {
              title: isKhmer ? "បង្កើត ឬជ្រើសរើស Telegram Bot" : "Create or choose a Telegram bot",
              description: isKhmer
                ? "បង្កើត Bot ក្នុង @BotFather ឬប្រើ Bot ដែលមានស្រាប់របស់អាជីវកម្មអ្នក។"
                : "Create the bot in @BotFather, or use an existing bot that belongs to your business.",
            },
            {
              title: isKhmer ? "ចម្លង Bot Token" : "Copy the Bot Token",
              description: isKhmer
                ? "ចម្លង Bot Token ឯកជនពី BotFather។ TENH នឹងមិនបង្ហាញវាម្តងទៀតបន្ទាប់ពីរក្សាទុក។"
                : "Copy the private Bot Token from BotFather. TENH never displays it again after saving.",
            },
            {
              title: isKhmer ? "បិទភ្ជាប់ Token ទៅក្នុង TENH" : "Paste the token into TENH",
              description: isKhmer
                ? "TENH ផ្ទៀងផ្ទាត់ Bot ដោយប្រើដំណើរការតភ្ជាប់ Telegram ដែលមានស្រាប់។"
                : "TENH verifies the bot using the existing Telegram connection flow.",
            },
            {
              title: isKhmer ? "បើក Inbox" : "Activate Inbox",
              description: isKhmer
                ? "បើក webhook ដើម្បីឱ្យសារ Telegram ថ្មីអាចចូលដល់ TENH Inbox របស់អ្នក។"
                : "Enable the webhook so new Telegram messages can reach your TENH Inbox.",
            },
          ]
        : [
            {
              title: isKhmer
                ? `ការតភ្ជាប់ ${platform === "instagram" ? "Instagram" : platform === "whatsapp" ? "WhatsApp" : "TikTok"}`
                : `${platform === "instagram" ? "Instagram" : platform === "whatsapp" ? "WhatsApp" : "TikTok"} connection`,
              description: isKhmer
                ? "ឆានែលនេះត្រូវបានបង្ហាញក្នុង TENH សម្រាប់ផែនការអភិវឌ្ឍ ប៉ុន្តែមិនទាន់អាចភ្ជាប់អតិថិជនបានទេ។"
                : "This channel is shown in TENH for roadmap visibility, but customer connection is not available yet.",
            },
          ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <span className="h-9 w-9 shrink-0 overflow-hidden rounded-xl">
          <img
            src={
              platform === "facebook"
                ? "/images/channels/messenger.png"
                : platform === "telegram"
                  ? "/images/channels/telegram.png"
                  : platform === "instagram"
                    ? "/images/channels/instagram.png"
                    : platform === "whatsapp"
                      ? "/images/channels/whatsapp.png"
                      : "/images/channels/tiktok.png"
            }
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-slate-950">
              {platform === "facebook"
                ? "Messenger / Facebook Page"
                : platform === "telegram"
                  ? "Telegram Bot"
                  : platform === "instagram"
                    ? "Instagram"
                    : platform === "whatsapp"
                      ? "WhatsApp"
                      : "TikTok"}
            </p>

            {platform === "facebook" ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                {isKhmer ? "ណែនាំ" : "Recommended"}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {steps.map((step, index) => (
          <div key={step.title} className="relative flex gap-4">
            {index < steps.length - 1 ? (
              <span
                className="absolute left-[17px] top-9 h-[calc(100%+4px)] w-px bg-blue-200"
                aria-hidden="true"
              />
            ) : null}

            <span className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold text-blue-700">
              {index + 1}
            </span>

            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-semibold text-slate-950">
                {step.title}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {step.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddConnectionModal({
  open,
  selectedPlatform,
  facebookCount,
  telegramCount,
  onClose,
  onSelect,
  onContinue,
}: AddConnectionModalProps) {
  const isKhmer = useWorkspaceLanguageId() === "km";

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const available =
    selectedPlatform === "facebook" ||
    selectedPlatform === "telegram";

  return (
    <div className="fixed inset-0 z-[180] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label={isKhmer ? "បិទផ្ទាំងបន្ថែមការតភ្ជាប់" : "Close Add Connection"}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-connection-title"
        className="relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-7">
          <div>
            <h2
              id="add-connection-title"
              className="text-2xl font-bold tracking-[-0.02em] text-slate-950"
            >
              {isKhmer ? "បន្ថែមការតភ្ជាប់" : "Add Connection"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isKhmer ? "ភ្ជាប់ឆានែលទំនាក់ទំនងថ្មីទៅកន្លែងធ្វើការនេះ។" : "Connect a new communication channel to this workspace."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-2xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            aria-label={isKhmer ? "បិទ" : "Close"}
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid min-h-full lg:grid-cols-[0.95fr_1.05fr]">
            <div className="border-b border-slate-200 p-5 sm:p-7 lg:border-b-0 lg:border-r">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  1
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-950">
                    {isKhmer ? "ជ្រើសរើសប្រភេទឆានែល" : "Choose channel type"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {isKhmer ? "ជ្រើសរើសវេទិកាដែលអ្នកចង់ភ្ជាប់។" : "Select the platform you want to connect."}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {TENH_CHANNEL_CATALOG.map((channel) => {
                  const selected =
                    selectedPlatform === channel.platform;
                  const count =
                    channel.platform === "facebook"
                      ? facebookCount
                      : channel.platform === "telegram"
                        ? telegramCount
                        : 0;
                  const connectable =
                    channel.platform === "facebook" ||
                    channel.platform === "telegram";

                  return (
                    <button
                      key={channel.platform}
                      type="button"
                      onClick={() => onSelect(channel.platform)}
                      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${
                        selected
                          ? "border-blue-500 bg-blue-50/50 ring-1 ring-blue-100"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <ChannelMark platform={channel.platform} />

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-slate-950">
                            {channel.shortName}
                          </span>

                          {selected ? (
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                              ✓
                            </span>
                          ) : null}
                        </span>

                        <span className="mt-1 block text-xs leading-5 text-slate-500">
                          {channel.platform === "facebook"
                            ? isKhmer
                              ? "ភ្ជាប់ Facebook Page សម្រាប់សារ Messenger និងមតិយោបល់។"
                              : "Connect Facebook Pages for Messenger messages and comments."
                            : channel.platform === "telegram"
                              ? isKhmer
                                ? "ភ្ជាប់ Telegram Bot សម្រាប់ការជជែកអតិថិជន និង Inbox webhook។"
                                : "Connect Telegram bots for customer chats and Inbox webhooks."
                              : isKhmer
                                ? `ការគាំទ្រ ${channel.shortName} ត្រូវបានគ្រោងសម្រាប់ការអាប់ដេត TENH Chat នាពេលខាងមុខ។`
                                : channel.description}
                        </span>

                        <span className="mt-2 block text-xs font-semibold">
                          {connectable ? (
                            <span className="text-emerald-700">
                              ● {isKhmer ? `បានភ្ជាប់ ${count}` : `${count} connected`}
                            </span>
                          ) : (
                            <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-600">
                              {isKhmer ? "ឆាប់ៗនេះ" : "Coming soon"}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-5 sm:p-7">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                  2
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-950">
                    {isKhmer ? "ព័ត៌មានលម្អិតការតភ្ជាប់" : "Connection details"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {isKhmer ? "អនុវត្តតាមជំហានដើម្បីភ្ជាប់ឆានែលរបស់អ្នក។" : "Follow the steps to connect your channel."}
                  </p>
                </div>
              </div>

              <ConnectionInstructions platform={selectedPlatform} />

              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                <p className="text-xs font-semibold text-blue-950">
                  {isKhmer
                    ? `មានឆានែលដែលបានភ្ជាប់ ${facebookCount + telegramCount} នៅក្នុងកន្លែងធ្វើការនេះ`
                    : `${facebookCount + telegramCount} connected channel${facebookCount + telegramCount === 1 ? "" : "s"} in this workspace`}
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-700">
                  {isKhmer ? "កម្រិតឆានែលនៃគម្រោងបច្ចុប្បន្នរបស់អ្នកនៅតែអនុវត្ត នៅពេលការតភ្ជាប់ថ្មីត្រូវបានបើក។" : "Your existing subscription channel limit still applies when a new connection is activated."}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            {isKhmer ? "បោះបង់" : "Cancel"}
          </button>

          <button
            type="button"
            disabled={!available}
            onClick={onContinue}
            className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            {available ? (isKhmer ? "បន្ត" : "Continue") : (isKhmer ? "ឆាប់ៗនេះ" : "Coming soon")}
          </button>
        </div>
      </section>
    </div>
  );
}

export function IntegrationWorkspace({
  children,
  canManageChannels = true,
}: IntegrationWorkspaceProps) {
  const isKhmer = useWorkspaceLanguageId() === "km";
  const [activePlatform, setActivePlatform] =
    useState<TenhChannelPlatform>("facebook");
  const [telegramSummary, setTelegramSummary] = useState({ active: 0, total: 0 });
  const [facebookSummary, setFacebookSummary] = useState({ active: 0, total: 0 });
  const [addConnectionOpen, setAddConnectionOpen] = useState(false);
  const [addConnectionPlatform, setAddConnectionPlatform] =
    useState<TenhChannelPlatform>("facebook");
  const [telegramAddRequest, setTelegramAddRequest] = useState(0);

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
    <div className="mx-auto w-full max-w-[1344px] space-y-6">
      <section className="min-w-0">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[27px] font-bold tracking-[-0.025em] text-slate-950">
              {isKhmer ? "ការតភ្ជាប់" : "Integrations"}
            </h2>
            <p className="mt-1.5 text-base text-slate-600">
              {isKhmer ? "ភ្ជាប់ និងគ្រប់គ្រងគណនីបណ្តាញសង្គមដែលអាជីវកម្មរបស់អ្នកប្រើ។" : "Connect and manage the social accounts used by your business."}
            </p>
          </div>

          <button
            type="button"
            disabled={!canManageChannels}
            onClick={() => {
              if (!canManageChannels) return;
              setAddConnectionPlatform(
                activePlatform === "telegram" ? "telegram" : "facebook",
              );
              setAddConnectionOpen(true);
            }}
            title={
              canManageChannels
                ? undefined
                : isKhmer
                  ? "អ្នកមានសិទ្ធិមើលតែប៉ុណ្ណោះ។ ត្រូវការសិទ្ធិ Manage ដើម្បីបន្ថែមការតភ្ជាប់។"
                  : "View only. Manage permission is required to add a connection."
            }
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-blue-500 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:hover:bg-slate-300"
          >
            <span className="mr-1.5 text-lg leading-none">+</span>
            {isKhmer ? "បន្ថែមការតភ្ជាប់" : "Add Connection"}
          </button>
        </div>

        <nav
          className="mt-5 flex max-w-full items-center gap-2 overflow-x-auto pb-1.5"
          aria-label={isKhmer ? "ឆានែលការតភ្ជាប់" : "Integration channels"}
        >
          {TENH_CHANNEL_CATALOG.map((channel) => {
            const isActive = activePlatform === channel.platform;
            const totalCount =
              channel.platform === "facebook"
                ? facebookSummary.total
                : channel.platform === "telegram"
                  ? telegramSummary.total
                  : 0;

            return (
              <button
                key={channel.platform}
                type="button"
                onClick={() => setActivePlatform(channel.platform)}
                className={`inline-flex shrink-0 items-center gap-2.5 rounded-full px-4 py-2.5 text-base font-medium transition ${
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : channel.canConnect
                      ? "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                      : "text-slate-400 hover:bg-slate-50"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="h-5 w-5 shrink-0 overflow-hidden rounded">
                  <img
                    src={
                      channel.platform === "facebook"
                        ? "/images/channels/messenger.png"
                        : channel.platform === "telegram"
                          ? "/images/channels/telegram.png"
                          : channel.platform === "instagram"
                            ? "/images/channels/instagram.png"
                            : channel.platform === "whatsapp"
                              ? "/images/channels/whatsapp.png"
                              : "/images/channels/tiktok.png"
                    }
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </span>

                <span>{channel.shortName}</span>

                {totalCount > 0 ? (
                  <span
                    className={`min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold ${
                      isActive
                        ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {totalCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </section>

      <div className="min-h-0 min-w-0 pt-1">
        {activePlatform === "facebook" ? (
          <div className="min-w-0">{children}</div>
        ) : activePlatform === "telegram" ? (
          <TelegramChannelPanel
            onConnectionChanged={setTelegramSummary}
            openAddBotSignal={telegramAddRequest}
          />
        ) : (
          <PlannedChannelPanel channel={activeChannel} />
        )}
      </div>

      <AddConnectionModal
        open={addConnectionOpen}
        selectedPlatform={addConnectionPlatform}
        facebookCount={facebookSummary.total}
        telegramCount={telegramSummary.total}
        onClose={() => setAddConnectionOpen(false)}
        onSelect={setAddConnectionPlatform}
        onContinue={() => {
          if (addConnectionPlatform === "facebook") {
            window.location.assign("/api/facebook/oauth/pages");
            return;
          }

          if (addConnectionPlatform === "telegram") {
            setActivePlatform("telegram");
            setTelegramAddRequest((value) => value + 1);
            setAddConnectionOpen(false);
          }
        }}
      />
    </div>
  );
}
