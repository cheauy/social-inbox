"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/*
 * TENH v1, from the website's side.
 *
 * Everything here is optional and says so. The card detects the extension by
 * asking the page for it and waiting a moment; if nothing answers, the Inbox,
 * the webhooks and every send behave exactly as they always have, and this
 * card offers a download link instead of a status.
 *
 * The only thing that crosses into the extension is a five-minute pairing
 * code. No session, no cookie, nothing belonging to Facebook.
 */

type Device = {
  id: string;
  name: string;
  version: string | null;
  isMine: boolean;
  memberName: string;
  online: boolean;
  facebookConnected: boolean;
  pageId: string | null;
  pageName: string | null;
  url: string | null;
  composerState: string;
  pairedAt: string;
  lastSeenAt: string | null;
};

type Observation = {
  id: string;
  conversationId: string | null;
  preview: string | null;
  observedAt: string;
  state: "in_tenh" | "waiting" | "missing_from_tenh" | "unknown_conversation";
};

const PING_TIMEOUT_MS = 1200;

function relative(value: string | null) {
  if (!value) return "never";

  const elapsed = Date.now() - new Date(value).getTime();

  if (!Number.isFinite(elapsed)) return "never";
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.round(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.round(elapsed / 3_600_000)} hr ago`;

  return `${Math.round(elapsed / 86_400_000)} days ago`;
}

export function TenhCompanionCard() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const pending = useRef<number | null>(null);

  /*
   * Ask once, and treat silence as an answer. A page cannot see whether an
   * extension exists; it can only speak and wait, and waiting for ever is how
   * a settings screen ends up with a spinner nobody can explain.
   */
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data;

      if (!data || typeof data !== "object") return;
      if (data.source !== "TENH_EXTENSION") return;

      if (
        data.type === "TENH_EXTENSION_PONG" ||
        data.type === "TENH_EXTENSION_READY"
      ) {
        if (pending.current) window.clearTimeout(pending.current);

        setInstalled(true);
        setVersion(typeof data.version === "string" ? data.version : null);
      }
    }

    window.addEventListener("message", onMessage);

    window.postMessage(
      { source: "TENH_WEB", type: "TENH_EXTENSION_PING" },
      window.location.origin,
    );

    pending.current = window.setTimeout(
      () => setInstalled((current) => current ?? false),
      PING_TIMEOUT_MS,
    );

    return () => {
      window.removeEventListener("message", onMessage);
      if (pending.current) window.clearTimeout(pending.current);
    };
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const response = await fetch("/api/extension/status", {
        cache: "no-store",
      });
      const result = await response.json();

      if (result?.success) setDevices(result.devices ?? []);
    } catch {
      /* The card is an extra; a failed list must not take the page with it. */
    }

    try {
      const response = await fetch("/api/extension/observations", {
        cache: "no-store",
      });
      const result = await response.json();

      if (result?.success) setObservations(result.observations ?? []);
    } catch {
      /* Same rule. This section disappears rather than breaking the page. */
    }
  }, []);

  useEffect(() => {
    void loadDevices();

    const timer = window.setInterval(() => void loadDevices(), 30_000);

    return () => window.clearInterval(timer);
  }, [loadDevices]);

  async function startPairing() {
    setBusy(true);
    setError("");
    setCopied(false);

    try {
      const response = await fetch("/api/extension/pair-code", {
        method: "POST",
      });
      const result = await response.json();

      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Unable to start pairing.");
      }

      setCode(result.code);

      /* The extension is the only thing that can redeem it, so it is only
         useful for the five minutes the server gave it. */
      window.setTimeout(() => setCode(null), 5 * 60_000);
    } catch (pairError) {
      setError(
        pairError instanceof Error
          ? pairError.message
          : "Unable to start pairing.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(deviceId: string) {
    setError("");

    try {
      const response = await fetch("/api/extension/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const result = await response.json();

      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? "Unable to disconnect that browser.");
      }

      await loadDevices();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Unable to disconnect that browser.",
      );
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">TENH v1</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            An optional Chrome extension. It puts this customer&apos;s TENH
            tags, notes and quick replies beside Facebook, and opens the right
            conversation. Install it while signed in here and it connects
            itself — no code, and no connecting again tomorrow. Everything in
            TENH works exactly the same without it.
          </p>
        </div>

        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
            installed
              ? "bg-emerald-50 text-emerald-700"
              : "bg-slate-100 text-slate-500"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              installed ? "bg-emerald-600" : "bg-slate-400"
            }`}
          />
          {installed === null
            ? "Checking…"
            : installed
              ? `Installed${version ? ` · v${version}` : ""}`
              : "Not installed"}
        </span>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href="/tenh-companion"
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Installation steps
        </a>

        {/* Kept for the browser that is not signed in here -- a shared
            computer, or somebody pairing a machine they are not on. */}
        <button
          type="button"
          onClick={() => void startPairing()}
          disabled={busy}
          className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          {busy ? "Preparing…" : "Pair another browser with a code"}
        </button>
      </div>

      {code ? (
        <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50/70 p-5">
          <p className="text-sm font-semibold text-blue-900">
            Paste this into the TENH v1 popup on the other browser
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="rounded-lg bg-white px-4 py-2 text-lg font-bold tracking-[0.2em] text-slate-900">
              {code}
            </code>

            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(code);
                setCopied(true);
              }}
              className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <p className="mt-3 text-xs leading-5 text-blue-800">
            It works once and expires in five minutes. It pairs a browser to
            your own TENH account — it is not a password and gives no access to
            conversations.
          </p>
        </div>
      ) : null}

      <div className="mt-6">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          Connected browsers
        </p>

        {devices.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No browser is paired with this workspace yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 p-4"
              >
                <div>
                  <p className="font-semibold text-slate-900">
                    {device.name}
                    {device.isMine ? (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
                        This is you
                      </span>
                    ) : null}
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    {device.memberName}
                    {device.version ? ` · v${device.version}` : ""}
                  </p>

                  <p className="mt-2 text-sm text-slate-600">
                    <span
                      className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                        device.online ? "bg-emerald-600" : "bg-slate-300"
                      }`}
                    />
                    {device.online ? "Online" : `Last seen ${relative(device.lastSeenAt)}`}
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    Facebook{" "}
                    {device.facebookConnected ? "signed in" : "not detected"}
                    {device.pageName ? ` · ${device.pageName}` : ""}
                    {device.composerState === "available"
                      ? " · reply box available"
                      : device.composerState === "unavailable"
                        ? " · reply box disabled by Facebook"
                        : ""}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void disconnect(device.id)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {observations.length > 0 ? (
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Replies typed in Facebook
          </p>

          <p className="mt-2 text-sm leading-6 text-slate-600">
            Replies a paired browser watched somebody send from Facebook
            itself, and whether Meta&apos;s webhook delivered them to TENH. A
            reply stuck on &ldquo;not in TENH&rdquo; usually means another app
            holds this Page&apos;s webhook. Nothing here is added to a
            conversation: the webhook remains the only thing that writes
            messages.
          </p>

          <ul className="mt-3 space-y-2">
            {observations.slice(0, 8).map((observation) => (
              <li
                key={observation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {observation.preview ?? "A reply"}
                </span>

                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    observation.state === "in_tenh"
                      ? "bg-emerald-50 text-emerald-700"
                      : observation.state === "waiting"
                        ? "bg-slate-100 text-slate-500"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {observation.state === "in_tenh"
                    ? "In TENH"
                    : observation.state === "waiting"
                      ? "Waiting for Meta"
                      : observation.state === "unknown_conversation"
                        ? "Page not connected to TENH"
                        : "Never arrived in TENH"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-5 text-xs leading-5 text-slate-500">
        TENH always sends through the official Messenger API first. The
        companion never types into Facebook, never reads Facebook cookies or
        passwords, and respects a reply box Facebook has disabled.
      </p>
    </section>
  );
}
