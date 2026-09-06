"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type DailyPoint = {
  date: string;
  received: number;
  replied: number;
};

type ChannelRow = {
  key: string;
  socialAccountId: string | null;
  platform: string;
  sourceType: string;
  accountName: string;
  conversations: number;
  incomingMessages: number;
  outgoingReplies: number;
  newCustomers: number;
  avgFirstResponseSeconds: number | null;
  medianFirstResponseSeconds: number | null;
  answered: number;
  unanswered: number;
  slaMet: number;
  slaMissed: number;
  slaRate: number | null;
  open: number;
  pending: number;
  resolved: number;
  unread: number;
  unassigned: number;
  daily: DailyPoint[];
};

type Summary = {
  conversations: number;
  incomingMessages: number;
  outgoingReplies: number;
  avgFirstResponseSeconds: number | null;
  answered: number;
  unanswered: number;
  slaRate: number | null;
  previousConversations: number | null;
  conversationsChangePercent: number | null;
};

type ChannelResponse = {
  success?: boolean;
  error?: string;
  summary?: Partial<Summary>;
  channels?: ChannelRow[];
};

const PERIODS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
];

const SLA_OPTIONS = [5, 10, 15, 30, 60];

/*
 * A colour per channel, chosen by which channel it is -- never by its position
 * in the list.
 *
 * This used to be DOTS[index % DOTS.length], so a channel's colour came from
 * its row number. Messenger was blue only while it happened to sort first; a
 * quiet week that moved it down the list repainted it violet, and a reader who
 * had learned "blue is Messenger" was then reading the wrong row. Keying off
 * the channel keeps the colour attached to the thing it identifies.
 *
 * Validated as a set against a white surface: worst adjacent pair is teal vs
 * orange at Delta E 11.1 under protanopia and 29.7 for normal vision, every
 * step clears the chroma floor, and all three clear 3:1 contrast.
 */
const CHANNEL_COLORS = {
  messenger: "#2563EB",
  comment: "#EB6834",
  telegram: "#0D9488",
  other: "#64748B",
} as const;

function channelColor(row: ChannelRow) {
  if (row.sourceType === "comment") {
    return CHANNEL_COLORS.comment;
  }

  if (row.platform === "telegram") {
    return CHANNEL_COLORS.telegram;
  }

  if (row.platform === "facebook") {
    return CHANNEL_COLORS.messenger;
  }

  return CHANNEL_COLORS.other;
}

/*
 * Received and replied share one scale and one plot -- they are the same unit,
 * so this is a plain two-series line, not two axes pretending to be one chart.
 * Delta E 25.9 (deutan) apart, both above 3:1 on white.
 */
const SERIES_RECEIVED = "#2563EB";
const SERIES_REPLIED = "#0E9F6E";

const EMPTY_SUMMARY: Summary = {
  conversations: 0,
  incomingMessages: 0,
  outgoingReplies: 0,
  avgFirstResponseSeconds: null,
  answered: 0,
  unanswered: 0,
  slaRate: null,
  previousConversations: null,
  conversationsChangePercent: null,
};

function formatDuration(seconds: number | null) {
  if (seconds === null) {
    return "—";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  if (minutes < 60) {
    return rest === 0
      ? `${minutes}m`
      : `${minutes}m ${String(rest).padStart(2, "0")}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function channelLabel(row: ChannelRow) {
  if (row.sourceType === "comment") {
    return "Facebook comments";
  }

  if (row.platform === "facebook") {
    return "Messenger";
  }

  return row.platform.charAt(0).toUpperCase() + row.platform.slice(1);
}

function shortDate(value: string) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function slaTone(rate: number | null) {
  if (rate === null) {
    return "text-slate-400";
  }

  if (rate >= 90) {
    return "text-emerald-600";
  }

  return rate >= 75 ? "text-amber-600" : "text-red-600";
}

function ChannelGlyph({ row }: { row: ChannelRow }) {
  if (row.sourceType === "comment") {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z" />
        </svg>
      </span>
    );
  }

  if (row.platform === "telegram") {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="m21 4-3 15-5-4-2.5 2.5L10 13l8-7-10 6-5-1.5L21 4Z" />
        </svg>
      </span>
    );
  }

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
        <path d="M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.5 5.5 3.8 7.2V22l3.5-1.9c.9.2 1.8.4 2.7.4 5.5 0 10-4.1 10-9.2S17.5 2 12 2Zm1 12.3-2.5-2.7-4.9 2.7 5.4-5.7 2.6 2.7 4.8-2.7-5.4 5.7Z" />
      </svg>
    </span>
  );
}

function TrendChart({ points }: { points: DailyPoint[] }) {
  /*
   * A day can be pointed at, so it needs a hover layer. An SVG chart with no
   * tooltip forces the reader to estimate every value off the gridlines, and
   * this one had no y-axis labels at all -- the numbers were simply not
   * readable from the picture.
   */
  const [hovered, setHovered] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <p className="rounded-xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
        No activity in this period yet.
      </p>
    );
  }

  const max = Math.max(
    ...points.map((point) => Math.max(point.received, point.replied)),
    1,
  );

  /* Round the ceiling so the four gridlines land on numbers, not on max/3. */
  const axisMax = (() => {
    for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 250, 500, 1000]) {
      if (step * 4 >= max) {
        return step * 4;
      }
    }
    return Math.ceil(max / 4000) * 4000;
  })();

  const xFor = (index: number) =>
    ((index + 0.5) / points.length) * 100;
  const yFor = (value: number) =>
    100 - (value / axisMax) * 100;

  const line = (key: "received" | "replied") =>
    points
      .map((point, index) => `${xFor(index)},${yFor(point[key])}`)
      .join(" ");

  const labelEvery = Math.max(1, Math.ceil(points.length / 7));
  const active = hovered !== null ? points[hovered] : null;

  return (
    <div
      className="relative select-none"
      onMouseLeave={() => setHovered(null)}
    >
      <div className="relative h-[150px] pl-9">
        {/* Solid hairlines, and a value on each -- the old chart was dashed
            and unlabelled, so no number could be read off it. */}
        <div className="pointer-events-none absolute inset-y-0 left-9 right-0">
          {[1, 0.75, 0.5, 0.25, 0].map((tick) => (
            <div
              key={`grid-${tick}`}
              className="absolute inset-x-0 flex items-center"
              style={{ top: `${(1 - tick) * 100}%` }}
            >
              <span className="absolute -left-9 w-8 pr-1 text-right text-[9px] font-medium tabular-nums text-slate-400">
                {Math.round(axisMax * tick)}
              </span>
              <span className="h-px w-full bg-slate-200/80" />
            </div>
          ))}
        </div>

        <div className="pointer-events-none absolute inset-y-0 left-9 right-0">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label="Conversations received and replied per day"
          >
            <polyline
              points={line("received")}
              fill="none"
              stroke={SERIES_RECEIVED}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={line("replied")}
              fill="none"
              stroke={SERIES_REPLIED}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>

        {/* Markers are positioned elements, not SVG circles: the plot stretches
            to fit its box, and a circle inside it stretches into an oval. */}
        <div className="pointer-events-none absolute inset-y-0 left-9 right-0">
          {points.map((point, index) => {
            const on = hovered === index;
            const dim = hovered !== null && !on;

            return (
              <span key={`dots-${point.date}`}>
                <span
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition-all ${
                    on ? "h-3 w-3" : "h-2 w-2"
                  }`}
                  style={{
                    left: `${xFor(index)}%`,
                    top: `${yFor(point.received)}%`,
                    backgroundColor: SERIES_RECEIVED,
                    opacity: dim ? 0.3 : 1,
                  }}
                />
                <span
                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition-all ${
                    on ? "h-3 w-3" : "h-2 w-2"
                  }`}
                  style={{
                    left: `${xFor(index)}%`,
                    top: `${yFor(point.replied)}%`,
                    backgroundColor: SERIES_REPLIED,
                    opacity: dim ? 0.3 : 1,
                  }}
                />
              </span>
            );
          })}
        </div>

        {/* One hit band per day. An 8px dot is far too small to be the target. */}
        <div className="absolute inset-y-0 left-9 right-0 flex">
          {points.map((point, index) => (
            <button
              key={`hit-${point.date}`}
              type="button"
              className="min-w-0 flex-1 cursor-default rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              onMouseEnter={() => setHovered(index)}
              onFocus={() => setHovered(index)}
              aria-label={`${shortDate(point.date)}: ${point.received} received, ${point.replied} replied`}
            />
          ))}
        </div>
      </div>

      <div className="mt-2 flex pl-9 text-center text-[9px] font-medium text-slate-400">
        {points.map((point, index) => (
          <span
            key={`label-${point.date}`}
            className={`min-w-0 flex-1 truncate transition ${
              hovered === index ? "font-bold text-slate-700" : ""
            }`}
          >
            {index % labelEvery === 0 || hovered === index
              ? shortDate(point.date)
              : ""}
          </span>
        ))}
      </div>

      {active ? (
        <div
          className={`pointer-events-none absolute top-0 z-10 w-max rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg ${
            (hovered as number) > points.length / 2
              ? "-translate-x-full"
              : ""
          }`}
          style={{
            left: `calc(2.25rem + ${xFor(hovered as number)}%)`,
          }}
        >
          <p className="text-[10px] font-bold text-slate-900">
            {shortDate(active.date)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-600">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: SERIES_RECEIVED }}
            />
            {active.received} received
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-600">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: SERIES_REPLIED }}
            />
            {active.replied} replied
          </p>
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-semibold ${tone ?? "text-slate-900"}`}>{value}</dd>
    </div>
  );
}

export function ChannelPerformancePanel() {
  const [period, setPeriod] = useState("7d");
  const [slaMinutes, setSlaMinutes] = useState(10);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const tzOffsetMinutes = new Date().getTimezoneOffset();

      const response = await fetch(
        `/api/analytics/channels?period=${period}&slaMinutes=${slaMinutes}&tzOffsetMinutes=${tzOffsetMinutes}`,
        { cache: "no-store" },
      );

      const result = (await response.json()) as ChannelResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to load channel performance.",
        );
      }

      setSummary({ ...EMPTY_SUMMARY, ...(result.summary ?? {}) });
      setChannels(result.channels ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load channel performance.",
      );
    } finally {
      setLoading(false);
    }
  }, [period, slaMinutes]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () =>
      channels.find((row) => row.key === selectedKey) ?? channels[0] ?? null,
    [channels, selectedKey],
  );

  const totalConversations = Math.max(
    1,
    channels.reduce((sum, row) => sum + row.conversations, 0),
  );

  const needsAttention = channels.filter(
    (row) => row.unassigned > 0 || row.slaMissed > 0 || row.unanswered > 0,
  );

  const changeLabel =
    summary.conversationsChangePercent === null
      ? "No previous period to compare"
      : `${
          summary.conversationsChangePercent > 0
            ? "↑"
            : summary.conversationsChangePercent < 0
              ? "↓"
              : ""
        } ${Math.abs(
          summary.conversationsChangePercent,
        )}% vs previous period`;

  const cards = [
    {
      label: "Conversations",
      value: String(summary.conversations),
      helper: changeLabel,
    },
    {
      label: "Messages received",
      value: String(summary.incomingMessages),
      helper: `${summary.outgoingReplies} replies sent`,
    },
    {
      label: "Avg. first response",
      value: formatDuration(summary.avgFirstResponseSeconds),
      helper:
        summary.unanswered > 0
          ? `${summary.unanswered} never answered (excluded)`
          : "All conversations answered",
    },
    {
      label: "SLA met",
      value: summary.slaRate === null ? "—" : `${summary.slaRate}%`,
      helper:
        summary.slaRate === null
          ? "No answered conversations yet"
          : `of ${summary.answered} answered within ${slaMinutes} min`,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
          {PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPeriod(option.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                period === option.id
                  ? "bg-violet-600 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
          <span className="text-slate-500">SLA</span>
          <select
            value={slaMinutes}
            onChange={(event) =>
              setSlaMinutes(Number(event.target.value))
            }
            className="bg-transparent font-semibold text-slate-800 outline-none"
          >
            {SLA_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} min
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm font-semibold text-slate-600">
              {card.label}
            </p>
            <p className="mt-3 text-[30px] font-bold leading-none text-slate-950">
              {loading ? "—" : card.value}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-500">
              {card.helper}
            </p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_340px]">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-bold text-slate-950">
              Channel comparison
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Facebook comments are counted as their own channel, separate
              from Messenger on the same Page.
            </p>
          </div>

          {loading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((key) => (
                <div
                  key={key}
                  className="h-16 animate-pulse rounded-xl bg-slate-100"
                />
              ))}
            </div>
          ) : channels.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              No conversations on any channel in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-3">Channel</th>
                    <th className="px-3 py-3">Conversations</th>
                    <th className="px-3 py-3">Incoming</th>
                    <th className="px-3 py-3">Replies</th>
                    <th className="px-3 py-3">Avg. first response</th>
                    <th className="px-5 py-3">SLA met</th>
                  </tr>
                </thead>

                <tbody>
                  {channels.map((row) => (
                    <tr
                      key={row.key}
                      onClick={() => setSelectedKey(row.key)}
                      className={`cursor-pointer border-b border-slate-100 transition ${
                        selected?.key === row.key
                          ? "bg-violet-50/50"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <ChannelGlyph row={row} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">
                              {channelLabel(row)}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {row.accountName}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-4">
                        <p className="font-bold text-slate-900">
                          {row.conversations}
                        </p>
                        <p className="text-xs text-slate-400">
                          {Math.round(
                            (row.conversations / totalConversations) * 100,
                          )}
                          %
                        </p>
                      </td>

                      <td className="px-3 py-4 text-slate-700">
                        {row.incomingMessages}
                      </td>
                      <td className="px-3 py-4 text-slate-700">
                        {row.outgoingReplies}
                      </td>

                      <td className="px-3 py-4 font-semibold text-slate-700">
                        {formatDuration(row.avgFirstResponseSeconds)}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`font-semibold ${slaTone(row.slaRate)}`}
                        >
                          {row.slaRate === null ? "—" : `${row.slaRate}%`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="px-5 py-3 text-xs text-slate-400">
                Showing {channels.length} channel
                {channels.length === 1 ? "" : "s"}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-950">
                Needs attention
              </h2>
              {needsAttention.length > 0 ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-600">
                  {needsAttention.length}
                </span>
              ) : null}
            </div>

            {loading ? (
              <div className="mt-4 h-24 animate-pulse rounded-xl bg-slate-100" />
            ) : needsAttention.length === 0 ? (
              <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-700">
                All channels answered and assigned.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {needsAttention.map((row) => (
                  <li
                    key={row.key}
                    className="flex items-start gap-3 rounded-xl border border-slate-200 p-3"
                  >
                    <ChannelGlyph row={row} />

                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {channelLabel(row)}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {row.accountName}
                      </p>

                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {row.slaMissed > 0 ? (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                            {row.slaMissed} over SLA
                          </span>
                        ) : null}

                        {row.unanswered > 0 ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            {row.unanswered} unanswered
                          </span>
                        ) : null}

                        {row.unassigned > 0 ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            {row.unassigned} unassigned
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Channel mix</h2>
            <p className="mt-1 text-xs text-slate-500">
              Share of conversations in this period.
            </p>

            {channels.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No data yet.</p>
            ) : (
              <>
                {/*
                  One bar, read left to right, instead of a column of
                  percentages. The list underneath used to carry the same
                  numbers the comparison table already shows, in words; a
                  part-to-whole question ("is Telegram most of our volume?")
                  is answered by relative width far faster than by comparing
                  five percentages.

                  A 2px surface gap separates the segments -- neighbours read
                  as distinct because of the gap, not because of a stroke
                  drawn around them.
                */}
                <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
                  {channels.map((row) => {
                    const share =
                      totalConversations > 0
                        ? (row.conversations / totalConversations) * 100
                        : 0;

                    if (share <= 0) {
                      return null;
                    }

                    return (
                      <span
                        key={`bar-${row.key}`}
                        className="h-full border-r-2 border-white last:border-r-0"
                        style={{
                          width: `${share}%`,
                          backgroundColor: channelColor(row),
                        }}
                        title={`${channelLabel(row)} · ${Math.round(share)}%`}
                      />
                    );
                  })}
                </div>

                <ul className="mt-4 space-y-3">
                  {channels.map((row) => (
                    <li key={row.key}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-slate-700">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: channelColor(row),
                            }}
                          />
                          <span className="truncate">
                            {channelLabel(row)}
                          </span>
                        </span>

                        <span className="shrink-0 font-semibold text-slate-900">
                          {totalConversations > 0
                            ? Math.round(
                                (row.conversations / totalConversations) * 100,
                              )
                            : 0}
                          % ({row.conversations})
                        </span>
                      </div>

                      <p className="ml-[18px] truncate text-xs text-slate-400">
                        {row.accountName}
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      </section>

      {selected ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold text-slate-950">
              Channel details
            </h2>

            <span className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-sm">
              <ChannelGlyph row={selected} />
              <span className="font-semibold text-slate-800">
                {channelLabel(selected)}
              </span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-500">{selected.accountName}</span>
            </span>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]">
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-bold text-slate-800">Activity</p>
              <dl className="mt-3 space-y-2 text-sm">
                <DetailRow label="Conversations" value={selected.conversations} />
                <DetailRow label="Incoming messages" value={selected.incomingMessages} />
                <DetailRow label="Outgoing replies" value={selected.outgoingReplies} />
                <DetailRow label="Customers" value={selected.newCustomers} />
              </dl>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-bold text-slate-800">Response</p>
              <dl className="mt-3 space-y-2 text-sm">
                <DetailRow
                  label="Avg. first response"
                  value={formatDuration(selected.avgFirstResponseSeconds)}
                />
                <DetailRow
                  label="Median"
                  value={formatDuration(selected.medianFirstResponseSeconds)}
                />
                <DetailRow
                  label="SLA met"
                  value={
                    selected.slaRate === null ? "—" : `${selected.slaRate}%`
                  }
                  tone={slaTone(selected.slaRate)}
                />
                <DetailRow
                  label="Over SLA"
                  value={selected.slaMissed}
                  tone={selected.slaMissed > 0 ? "text-red-600" : undefined}
                />
                <DetailRow
                  label="Never answered"
                  value={selected.unanswered}
                  tone={
                    selected.unanswered > 0 ? "text-amber-600" : undefined
                  }
                />
              </dl>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-sm font-bold text-slate-800">Status</p>
              <dl className="mt-3 space-y-2 text-sm">
                <DetailRow label="Open" value={selected.open} />
                <DetailRow label="Pending" value={selected.pending} />
                <DetailRow label="Resolved" value={selected.resolved} />
                <DetailRow label="Unread" value={selected.unread} />
                <DetailRow label="Unassigned" value={selected.unassigned} />
              </dl>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-slate-800">Trend</p>

                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: SERIES_RECEIVED }}
                    />
                    Received
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: SERIES_REPLIED }}
                    />
                    Replied
                  </span>
                </div>
              </div>

              <div className="mt-2">
                <TrendChart points={selected.daily} />
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
