"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

type CustomerReport = {
  id: string;
  category: string;
  subject: string;
  message: string;
  status: "open" | "reviewing" | "resolved";
  adminReply: string | null;
  reviewedAt: string | null;
  attachmentFileName: string | null;
  attachmentMimeType: string | null;
  attachmentSizeBytes: number | null;
  attachmentUrl: string | null;
  createdAt: string;
};

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatFileSize(value: number | null) {
  if (!value || value <= 0) return "";
  if (value < 1024 * 1024) {
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function statusStyle(status: CustomerReport["status"]) {
  if (status === "resolved") {
    return "bg-emerald-100 text-emerald-700";
  }

  if (status === "reviewing") {
    return "bg-blue-100 text-blue-700";
  }

  return "bg-amber-100 text-amber-700";
}

function statusLabel(status: CustomerReport["status"]) {
  if (status === "reviewing") return "Under review";
  if (status === "resolved") return "Resolved";
  return "Open";
}

export function CustomerReportForm() {
  const [category, setCategory] = useState("technical");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reports, setReports] = useState<CustomerReport[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReports = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/customer-reports", {
        cache: "no-store",
      });
      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        reports?: CustomerReport[];
      };

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to load your reports.",
        );
      }

      setReports(result.reports ?? []);
    } catch (loadError) {
      if (!quiet) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load your reports.",
        );
      }
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadReports();

    const timer = window.setInterval(() => {
      void loadReports(true);
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadReports]);

  const unresolvedCount = useMemo(
    () =>
      reports.filter(
        (report) =>
          report.status === "open" ||
          report.status === "reviewing",
      ).length,
    [reports],
  );

  function chooseAttachment(file: File | null) {
    setError(null);

    if (!file) {
      setAttachment(null);
      return;
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      setAttachment(null);
      setError("Attachment must be JPG, PNG, WEBP, or PDF.");
      return;
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      setAttachment(null);
      setError("Attachment must be no larger than 8 MB.");
      return;
    }

    setAttachment(file);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    let uploadedPath: string | null = null;
    let uploadedReportId: string | null = null;

    try {
      if (attachment) {
        const prepareResponse = await fetch("/api/customer-reports", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "prepare-upload",
            fileName: attachment.name,
            mimeType: attachment.type,
            sizeBytes: attachment.size,
          }),
        });

        const prepareResult = (await prepareResponse.json()) as {
          success?: boolean;
          error?: string;
          reportId?: string;
          upload?: {
            bucket: string;
            path: string;
            token: string;
          };
        };

        if (
          !prepareResponse.ok ||
          !prepareResult.success ||
          !prepareResult.reportId ||
          !prepareResult.upload
        ) {
          throw new Error(
            prepareResult.error ??
              "Unable to prepare the report attachment.",
          );
        }

        uploadedReportId = prepareResult.reportId;
        uploadedPath = prepareResult.upload.path;

        const supabase = createClient();
        const { error: uploadError } = await supabase.storage
          .from(prepareResult.upload.bucket)
          .uploadToSignedUrl(
            prepareResult.upload.path,
            prepareResult.upload.token,
            attachment,
            {
              contentType: attachment.type,
            },
          );

        if (uploadError) {
          throw new Error(uploadError.message);
        }
      }

      const response = await fetch("/api/customer-reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "submit",
          category,
          subject,
          message,
          reportId: uploadedReportId,
          fileName: attachment?.name ?? null,
          mimeType: attachment?.type ?? null,
          sizeBytes: attachment?.size ?? null,
          storagePath: uploadedPath,
        }),
      });

      const result = (await response.json()) as {
        success?: boolean;
        error?: string;
        report?: {
          id: string;
        };
      };

      if (!response.ok || !result.success || !result.report) {
        throw new Error(
          result.error ?? "Unable to submit your report.",
        );
      }

      setSubject("");
      setMessage("");
      setAttachment(null);
      setSuccess(
        `Report submitted. Reference: ${result.report.id}`,
      );
      await loadReports();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to submit your report.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              Contact TENH
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              Report a problem
            </h2>
          </div>

          {unresolvedCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
              {unresolvedCount} active
            </span>
          ) : null}
        </div>

        <p className="mt-2 text-sm leading-6 text-slate-500">
          Send a bug, billing, account, or Facebook integration issue to the TENH admin team.
        </p>

        <label className="mt-5 block text-sm font-semibold text-slate-800">
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="technical">Bug / technical issue</option>
            <option value="billing">Billing / payment</option>
            <option value="facebook">Facebook integration</option>
            <option value="account">Account / login</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="mt-4 block text-sm font-semibold text-slate-800">
          Subject
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={140}
            placeholder="Short summary of the problem"
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <label className="mt-4 block text-sm font-semibold text-slate-800">
          Message
          <textarea
            rows={7}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={5000}
            placeholder="Describe what happened, what you expected, and any useful details. Do not paste passwords, API keys, or payment secrets."
            className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <div className="mt-4">
          <label className="block text-sm font-semibold text-slate-800">
            Screenshot / file <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 transition hover:border-blue-300 hover:bg-blue-50/40">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-700">
                {attachment ? attachment.name : "Choose attachment"}
              </span>
              <span className="mt-0.5 block text-xs text-slate-400">
                JPG, PNG, WEBP, or PDF · max 8 MB
              </span>
            </span>
            <span className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">
              Browse
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(event) => {
                chooseAttachment(event.target.files?.[0] ?? null);
                event.currentTarget.value = "";
              }}
            />
          </label>

          {attachment ? (
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="mt-2 text-xs font-semibold text-red-600 hover:text-red-700"
            >
              Remove attachment
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}

        <button
          type="button"
          disabled={
            saving ||
            subject.trim().length < 3 ||
            message.trim().length < 10 ||
            unresolvedCount >= 5
          }
          onClick={() => void submit()}
          className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          {saving ? "Submitting…" : "Submit report"}
        </button>

        {unresolvedCount >= 5 ? (
          <p className="mt-2 text-center text-xs text-amber-700">
            You already have 5 reports open or under review.
          </p>
        ) : null}
      </section>

      <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
              Your reports
            </p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">
              Support history
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void loadReports()}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="mt-5 text-sm text-slate-500">
            Loading reports…
          </p>
        ) : reports.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            You have not submitted a report yet.
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {reports.map((report) => (
              <article
                key={report.id}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold text-slate-950">
                    {report.subject}
                  </p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle(report.status)}`}
                  >
                    {statusLabel(report.status)}
                  </span>
                </div>

                <p className="mt-1 text-xs text-slate-400">
                  {report.category} · {formatDate(report.createdAt)}
                </p>

                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {report.message}
                </p>

                {report.attachmentFileName ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-700">
                        {report.attachmentFileName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {formatFileSize(report.attachmentSizeBytes)}
                      </p>
                    </div>
                    {report.attachmentUrl ? (
                      <a
                        href={report.attachmentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs font-bold text-blue-600 hover:text-blue-700"
                      >
                        View file
                      </a>
                    ) : null}
                  </div>
                ) : null}

                {report.adminReply ? (
                  <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-[0.1em] text-blue-600">
                      TENH reply
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-blue-900">
                      {report.adminReply}
                    </p>
                    {report.reviewedAt ? (
                      <p className="mt-2 text-[11px] text-blue-500">
                        Updated {formatDate(report.reviewedAt)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
