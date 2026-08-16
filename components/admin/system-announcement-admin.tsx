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
    "border-violet-200 bg-violet-50 text-violet-700",
  info:
    "border-blue-200 bg-blue-50 text-blue-700",
  maintenance:
    "border-amber-200 bg-amber-50 text-amber-700",
  important:
    "border-red-200 bg-red-50 text-red-700",
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

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-violet-600">
                User notification
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">
                Publish a TENH update alert
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                The newest active alert appears directly below the TENH dashboard header. Users can dismiss it after reading.
              </p>
            </div>

            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-center">
              <p className="text-2xl font-black text-violet-950">
                {activeCount}
              </p>
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-violet-600">
                Active alerts
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 p-5 sm:p-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div>
            <label className="text-sm font-bold text-slate-800">
              Alert type
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {toneOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTone(option.value)}
                  className={`rounded-2xl border p-3 text-left transition ${
                    tone === option.value
                      ? toneClasses[option.value]
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-sm font-bold">
                    {option.label}
                  </p>
                  <p className="mt-1 text-xs leading-4 opacity-65">
                    {option.helper}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-bold text-slate-800">
                Title
              </label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                placeholder="Example: New Inbox improvements are now live"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <label className="text-sm font-bold text-slate-800">
                  Message
                </label>
                <span className="text-xs text-slate-400">
                  {message.length}/1500
                </span>
              </div>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={1500}
                rows={4}
                placeholder="Tell users what changed and what they need to know."
                className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-sm font-bold text-slate-800">
                  Button label
                  <span className="ml-1 font-normal text-slate-400">
                    optional
                  </span>
                </label>
                <input
                  value={linkLabel}
                  onChange={(event) => setLinkLabel(event.target.value)}
                  maxLength={40}
                  placeholder="View update"
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
              </div>

              <div>
                <label className="text-sm font-bold text-slate-800">
                  Button link
                  <span className="ml-1 font-normal text-slate-400">
                    optional
                  </span>
                </label>
                <input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="/dashboard/inbox or https://..."
                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-bold text-slate-800">
                Automatically end alert
                <span className="ml-1 font-normal text-slate-400">
                  optional
                </span>
              </label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">
                Preview
              </p>
              <div className={`mt-3 rounded-2xl border p-4 ${toneClasses[tone]}`}>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] opacity-70">
                  {toneOptions.find((item) => item.value === tone)?.label}
                </p>
                <p className="mt-1 text-sm font-bold">
                  {title.trim() || "Your update title"}
                </p>
                <p className="mt-1 text-sm leading-5 opacity-70">
                  {message.trim() || "Your update message will appear here."}
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void publish()}
                disabled={
                  saving || !title.trim() || !message.trim()
                }
                className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? "Publishing..." : "Publish update alert"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-950">
              Alert history
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Active and previous TENH update messages.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadAnnouncements()}
            disabled={loading}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {!loading && announcements.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500">
              No update alerts have been published yet.
            </div>
          ) : null}

          {announcements.map((alert) => {
            const state = getAlertState(alert);

            return (
              <article
                key={alert.id}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] ${toneClasses[alert.tone]}`}
                      >
                        {alert.tone}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] ${
                          state === "Active"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {state}
                      </span>
                    </div>

                    <h3 className="mt-2 font-bold text-slate-950">
                      {alert.title}
                    </h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                      {alert.message}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
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
                      className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
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
