import {
  TENH_CHANNEL_CATALOG,
  type TenhChannelAvailability,
  type TenhChannelPlatform,
} from "@/lib/channels/channel-catalog";

function ChannelIcon({
  platform,
}: {
  platform: TenhChannelPlatform;
}) {
  const label =
    platform === "facebook"
      ? "M"
      : platform === "telegram"
        ? "T"
        : platform === "instagram"
          ? "I"
          : platform === "whatsapp"
            ? "W"
            : "T";

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm font-black text-slate-700">
      {label}
    </div>
  );
}

function getStatusClasses(
  availability: TenhChannelAvailability,
) {
  if (availability === "available") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (availability === "next") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-600";
}

export function ChannelRoadmap() {
  return (
    <section className="mt-6 rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.05)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
            Channel roadmap
          </p>

          <h2 className="mt-1 text-xl font-bold text-slate-950">
            One workspace, more customer channels
          </h2>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Messenger is available now. Telegram is coming next, with
            Instagram, WhatsApp and TikTok planned for future TENH Chat
            updates.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {TENH_CHANNEL_CATALOG.map((channel) => (
          <article
            key={channel.platform}
            className="flex min-h-[190px] flex-col rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <ChannelIcon platform={channel.platform} />

              <span
                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${getStatusClasses(
                  channel.availability,
                )}`}
              >
                {channel.statusLabel}
              </span>
            </div>

            <h3 className="mt-4 font-bold text-slate-950">
              {channel.name}
            </h3>

            <p className="mt-2 flex-1 text-sm leading-5 text-slate-500">
              {channel.description}
            </p>

            {channel.availability === "available" ? (
              <p className="mt-4 text-xs font-semibold text-emerald-700">
                Manage the live connection above.
              </p>
            ) : (
              <button
                type="button"
                disabled
                aria-disabled="true"
                className="mt-4 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-400"
              >
                {channel.statusLabel}
              </button>
            )}
          </article>
        ))}
      </div>

      <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm leading-6 text-blue-900">
        Coming-soon channels are informational only. They do not create a
        social account, request credentials, register a webhook, or consume a
        subscription channel slot until the integration is actually released
        and connected.
      </div>
    </section>
  );
}
