"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type AnnouncementTone =
  | "info"
  | "update"
  | "maintenance"
  | "important";

type Announcement = {
  id: string;
  title: string;
  message: string;
  tone: AnnouncementTone;
  link_label: string | null;
  link_url: string | null;
  is_active: boolean;
  starts_at: string;
  ends_at: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

type ApiResponse = {
  success?: boolean;
  error?: string;
  announcements?: Announcement[];
};

const toneOptions: Array<{
  value: AnnouncementTone;
  label: string;
  helper: string;
}> = [
  {
    value: "update",
    label: "New update",
    helper: "Product improvements and new features",
  },
  {
    value: "info",
    label: "Notice",
    helper: "General information for TENH users",
  },
  {
    value: "maintenance",
    label: "Maintenance",
    helper: "Planned service or maintenance notice",
  },
  {
    value: "important",
    label: "Important",
    helper: "High-priority message that needs attention",
  },
];

const toneClasses: Record<AnnouncementTone, string> = {
  update:
    "border-violet-300 bg-violet-100 text-violet-700",
  info:
    "border-blue-200 bg-blue-50 text-blue-700",
  maintenance:
    "border-amber-200 bg-amber-50 text-amber-800",
  important:
    "border-rose-200 bg-rose-50 text-rose-700",
};

const toneDotClasses: Record<AnnouncementTone, string> = {
  update: "bg-violet-500",
  info: "bg-blue-400",
  maintenance: "bg-amber-500",
  important: "bg-rose-500",
};

function formatDate(value: string | null) {
  if (!value) {
    return "No end date";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getAlertState(alert: Announcement) {
  const now = Date.now();
  const startsAt = new Date(alert.starts_at).getTime();
  const endsAt = alert.ends_at
    ? new Date(alert.ends_at).getTime()
    : null;

  if (!alert.is_active) {
    return "Ended";
  }

  if (Number.isFinite(startsAt) && startsAt > now) {
    return "Scheduled";
  }

  if (endsAt && Number.isFinite(endsAt) && endsAt <= now) {
    return "Expired";
  }

  return "Active";
}

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 21h4" strokeLinecap="round" />
    </svg>
  );
}

export function SystemAnnouncementAdmin() {
  const [announcements, setAnnouncements] =
    useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] =
    useState<AnnouncementTone>("update");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [showEndInput, setShowEndInput] = useState(false);

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/tenh-admin/announcements",
        { cache: "no-store" },
      );
      const result = (await response.json()) as ApiResponse;

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to load update alerts.",
        );
      }

      setAnnouncements(result.announcements ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load update alerts.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAnnouncements();
  }, [loadAnnouncements]);

  const activeCount = useMemo(
    () =>
      announcements.filter(
        (item) => getAlertState(item) === "Active",
      ).length,
    [announcements],
  );

  async function publish() {
    if (!title.trim() || !message.trim() || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        "/api/tenh-admin/announcements",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create",
            title,
            message,
            tone,
            linkLabel,
            linkUrl,
            endsAt: endsAt || null,
          }),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to publish this update alert.",
        );
      }

      setTitle("");
      setMessage("");
      setTone("update");
      setLinkLabel("");
      setLinkUrl("");
      setEndsAt("");
      setShowEndInput(false);
      setSuccess(
        "Update alert published. Active TENH users will see it in the dashboard.",
      );
      await loadAnnouncements();
    } catch (publishError) {
      setError(
        publishError instanceof Error
          ? publishError.message
          : "Unable to publish this update alert.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function endAlert(announcementId: string) {
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        "/api/tenh-admin/announcements",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "end",
            announcementId,
          }),
        },
      );

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to end this alert.",
        );
      }

      setSuccess("The alert has been ended.");
      await loadAnnouncements();
    } catch (endError) {
      setError(
        endError instanceof Error
          ? endError.message
          : "Unable to end this alert.",
      );
    }
  }

  const selectedToneLabel =
    toneOptions.find((item) => item.value === tone)?.label ??
    "New update";

  const publishButtonLabel = saving
    ? "Publishing..."
    : !title.trim()
      ? "Add a title to publish"
      : !message.trim()
        ? "Add a message to publish"
        : "Publish update";

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      ) : null}

      <section>
        <div className="flex items-end justify-between gap-4 border-b border-slate-200 pb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
              Admin
            </p>
            <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-950">
              Publish an update alert
            </h2>
          </div>

          <p className="pb-0.5 text-xs text-slate-500">
            {loading
              ? "Checking live alerts..."
              : activeCount === 0
                ? "No alert is live right now"
                : `${activeCount} alert${activeCount === 1 ? " is" : "s are"} live right now`}
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          <div>
            <p className="text-xs font-medium text-slate-700">Type</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {toneOptions.map((option) => {
                const selected = tone === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setTone(option.value)}
                    title={option.helper}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      selected
                        ? toneClasses[option.value]
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-sm ${toneDotClasses[option.value]}`}
                      aria-hidden="true"
                    />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="tenh-announcement-title"
                className="text-xs font-medium text-slate-700"
              >
                Title
              </label>
              <span className="text-[11px] text-slate-400">
                {title.length} / 120
              </span>
            </div>
            <input
              id="tenh-announcement-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="New inbox improvements are live"
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="tenh-announcement-message"
                className="text-xs font-medium text-slate-700"
              >
                Message
              </label>
              <span className="text-[11px] text-slate-400">
                {message.length} / 1500
              </span>
            </div>
            <textarea
              id="tenh-announcement-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={1500}
              rows={3}
              placeholder="What changed, and what should they do about it."
              className="mt-1.5 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            <p className="mt-1.5 text-[11px] text-slate-400">
              Keep it concise so users can understand the update quickly.
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="tenh-announcement-link-label"
                className="text-xs font-medium text-slate-700"
              >
                Button label <span className="text-slate-400">optional</span>
              </label>
              <input
                id="tenh-announcement-link-label"
                value={linkLabel}
                onChange={(event) => setLinkLabel(event.target.value)}
                maxLength={40}
                placeholder="View update"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </div>

            <div>
              <label
                htmlFor="tenh-announcement-link-url"
                className="text-xs font-medium text-slate-700"
              >
                Button link <span className="text-slate-400">optional</span>
              </label>
              <input
                id="tenh-announcement-link-url"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="/dashboard/inbox"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
              />
            </div>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={showEndInput}
                onClick={() => {
                  setShowEndInput((current) => {
                    if (current) {
                      setEndsAt("");
                    }
                    return !current;
                  });
                }}
                className={`relative h-5 w-9 rounded-full transition ${
                  showEndInput ? "bg-violet-600" : "bg-slate-200"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition ${
                    showEndInput ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
              <div>
                <p className="text-xs font-semibold text-slate-800">
                  End automatically
                </p>
                <p className="text-[11px] text-slate-400">
                  Otherwise it stays live until you remove it.
                </p>
              </div>
            </div>

            {showEndInput ? (
              <div className="mt-3 max-w-sm">
                <label
                  htmlFor="tenh-announcement-ends-at"
                  className="text-[11px] font-medium text-slate-500"
                >
                  End date and time
                </label>
                <input
                  id="tenh-announcement-ends-at"
                  type="datetime-local"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
          How users will see it
        </p>

        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <span className="text-xs font-bold text-slate-900">TENH</span>
            <div className="flex items-center gap-3 text-slate-400">
              <BellIcon />
              <span className="h-5 w-5 rounded-full bg-slate-200" />
            </div>
          </div>

          <div className="p-3 sm:p-4">
            <div className={`rounded-lg border px-3 py-3 ${toneClasses[tone]}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.08em] opacity-75">
                    {selectedToneLabel}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-bold">
                    {title.trim() || "Your update title"}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-4 opacity-80">
                    {message.trim() || "Your message appears here."}
                  </p>
                  {linkLabel.trim() ? (
                    <span className="mt-2 inline-flex rounded-md border border-current/20 bg-white/50 px-2 py-1 text-[10px] font-semibold">
                      {linkLabel.trim()}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs opacity-70" aria-hidden="true">
                  ×
                </span>
              </div>
            </div>

            <div className="mt-2 h-2 w-[44%] rounded-full bg-slate-200" />
            <div className="mt-1.5 h-2 w-[70%] rounded-full bg-slate-100" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-800">
            Goes to every TENH user
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Users can dismiss this alert individually.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void publish()}
          disabled={saving || !title.trim() || !message.trim()}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {publishButtonLabel}
        </button>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-950">
            Alert history
          </h2>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400">
              {loading
                ? "Loading..."
                : announcements.length === 0
                  ? "Nothing published yet"
                  : `${announcements.length} alert${announcements.length === 1 ? "" : "s"}`}
            </span>
            <button
              type="button"
              onClick={() => void loadAnnouncements()}
              disabled={loading}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {!loading && announcements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center text-xs text-slate-500">
              Your first alert will appear here, with the option to end it early.
            </div>
          ) : null}

          {announcements.map((alert) => {
            const state = getAlertState(alert);

            return (
              <article
                key={alert.id}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${toneClasses[alert.tone]}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-sm ${toneDotClasses[alert.tone]}`} />
                        {toneOptions.find((item) => item.value === alert.tone)?.label ?? alert.tone}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          state === "Active"
                            ? "bg-emerald-100 text-emerald-700"
                            : state === "Scheduled"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {state}
                      </span>
                    </div>

                    <h3 className="mt-2 text-sm font-semibold text-slate-950">
                      {alert.title}
                    </h3>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-600">
                      {alert.message}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
                      <span>Published {formatDate(alert.created_at)}</span>
                      <span>Ends {formatDate(alert.ends_at)}</span>
                      {alert.created_by_email ? (
                        <span>By {alert.created_by_email}</span>
                      ) : null}
                    </div>
                  </div>

                  {state === "Active" ? (
                    <button
                      type="button"
                      onClick={() => void endAlert(alert.id)}
                      className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                    >
                      End alert
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
