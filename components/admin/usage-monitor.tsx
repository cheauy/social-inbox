"use client";
import { useEffect, useState } from "react";

type Row = { business_id: string; requests: number; database_requests: number; database_bytes: number; storage_bytes: number; upload_bytes: number; observed_bytes_budget: number | null; read_limit: number | null; enforced: boolean };
const mb = (bytes: number) => `${(bytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;

export function UsageMonitor() {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ rows: Row[]; start: string; end: string; hasMore: boolean; mode: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/tenh-admin/usage?offset=${offset}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error || "Unable to load usage."); return body; })
      .then(body => { if (!controller.signal.aborted) { setResult(body); setError(""); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load usage."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [offset, revision]);
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">Workspace traffic</h2><button disabled={loading} onClick={() => { setLoading(true); setError(""); setRevision(v => v + 1); }} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Refresh</button></div>
    <p className="text-sm text-slate-600">Measured application traffic for the current calendar month (UTC). Attributed to the workspace making the request. Direct media downloads and Realtime are excluded; these numbers are not your Supabase bill.</p>
    {error ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p> : null}
    {loading ? <div aria-label="Loading usage" className="h-40 animate-pulse rounded-lg bg-slate-100" /> : result && !error ? <>
      <p className="text-xs text-slate-500">{result.start} – {result.end} · Monitoring: {result.mode}</p>
      {result.mode !== "database" ? <p className="text-sm text-amber-800">New measurements are being written to server logs only. Enable database monitoring to populate this report.</p> : null}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-slate-500">{["Workspace", "Requests", "Database reads/writes", "Response data", "Uploads", "Budget", "Refresh limit"].map(title => <th key={title} className="p-3 font-medium">{title}</th>)}</tr></thead><tbody>
        {result.rows.map(row => { const bytes = Number(row.database_bytes) + Number(row.storage_bytes); const percent = row.observed_bytes_budget ? bytes / row.observed_bytes_budget * 100 : null; return <tr key={row.business_id} className="border-b last:border-0"><td className="p-3 font-mono text-xs" title={row.business_id}>{row.business_id}</td><td className="p-3">{Number(row.requests).toLocaleString()}</td><td className="p-3">{Number(row.database_requests).toLocaleString()}</td><td className="p-3">{mb(bytes)}</td><td className="p-3">{mb(Number(row.upload_bytes))}</td><td className={`p-3 ${percent !== null && percent >= 80 ? "font-semibold text-amber-700" : "text-slate-500"}`}>{percent === null ? "Not set" : `${percent.toFixed(0)}%${percent >= 100 ? " · Exceeded" : percent >= 80 ? " · Review usage" : ""}`}</td><td className="p-3">{row.enforced && row.read_limit ? `${row.read_limit}/min` : "Monitor only"}</td></tr>; })}
      </tbody></table></div>
      {result.rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No measurements recorded for this month yet.</p> : null}
      <div className="flex justify-end gap-3"><button disabled={offset === 0} onClick={() => { setLoading(true); setError(""); setOffset(v => Math.max(0,v-50)); }} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button><button disabled={!result.hasMore} onClick={() => { setLoading(true); setError(""); setOffset(v => v+50); }} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button></div>
    </> : null}
  </section>;
}
