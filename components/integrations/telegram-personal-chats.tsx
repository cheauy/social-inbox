"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

type SharedChat = { id: string; chatId: string; title: string; username: string | null; unread: number; history: "none" | "last_50" };
type ListedChat = { chat_id: string; title: string; username: string | null; last_message_at: string | null };

function useT() {
  const km = useWorkspaceLanguageId() === "km";
  return (en: string, kmText: string) => (km ? kmText : en);
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

/**
 * D1 chat sharing for the account holder. Nothing is shared by default; only
 * ticked chats are imported, and only they become visible to the team members
 * allowed by the account's team-access setting.
 */
export function PersonalChatManager({ sessionId, channelId, canManage, canRemoveData, onChanged }: {
  sessionId: string;
  channelId?: string | null;
  canManage: boolean;
  canRemoveData: boolean;
  onChanged?: () => void;
}) {
  const t = useT();
  const base = `/api/telegram-personal/connections/${sessionId}/chats`;
  const [shared, setShared] = useState<SharedChat[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [autoShare, setAutoShare] = useState(false);
  const [autoShareAvailable, setAutoShareAvailable] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [listState, setListState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [listed, setListed] = useState<ListedChat[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importHistory, setImportHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unshareTarget, setUnshareTarget] = useState<SharedChat | null>(null);
  const [deleteHistory, setDeleteHistory] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    if (!canManage) return;
    void fetch(base, { cache: "no-store" })
      .then((response) => (response.ok ? readJson<{ shared?: SharedChat[]; waitingCount?: number; autoShare?: boolean; autoShareAvailable?: boolean }>(response) : null))
      .then((data) => {
        if (!data) return;
        setShared(data.shared ?? []);
        setWaiting(data.waitingCount ?? 0);
        setAutoShare(data.autoShare === true);
        setAutoShareAvailable(data.autoShareAvailable === true);
      })
      .catch(() => undefined);
  }, [base, canManage]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 20000);
    return () => { clearTimeout(first); clearInterval(timer); if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  async function openChooser() {
    setChooserOpen(true);
    setListState("loading");
    setSelected(new Set());
    setError(null);
    const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }) });
    const data = await readJson<{ commandId?: string; error?: string }>(response);
    if (!response.ok || !data.commandId) {
      setListState("failed");
      setError(data.error ?? t("Unable to load your chats.", "មិនអាចផ្ទុកការជជែករបស់អ្នកបានទេ។"));
      return;
    }
    const startedAt = Date.now();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void fetch(`${base}?commandId=${data.commandId}`, { cache: "no-store" })
        .then((r) => readJson<{ state?: string; chats?: ListedChat[] }>(r))
        .then((state) => {
          if (state.state === "ready") {
            if (pollRef.current) clearInterval(pollRef.current);
            const sharedIds = new Set(shared.map((chat) => chat.chatId));
            setListed((state.chats ?? []).filter((chat) => !sharedIds.has(chat.chat_id)));
            setListState("ready");
          } else if (state.state !== "pending" || Date.now() - startedAt > 45000) {
            if (pollRef.current) clearInterval(pollRef.current);
            setListState("failed");
            setError(t("Telegram did not return your chats. Make sure the worker is running and try again.", "Telegram មិនបានបញ្ជូនការជជែករបស់អ្នកមកវិញទេ។ សូមប្រាកដថា worker កំពុងដំណើរការ ហើយព្យាយាមម្តងទៀត។"));
          }
        })
        .catch(() => undefined);
    }, 1500);
  }

  async function shareSelected() {
    setBusy(true);
    setError(null);
    let failed = 0;
    for (const chatId of selected) {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "share", chatId, history: importHistory ? "last_50" : "none" }),
      });
      if (!response.ok) failed += 1;
    }
    setBusy(false);
    if (failed) setError(t(`${failed} chat(s) could not be shared. Load your chats again and retry.`, `ការជជែក ${failed} មិនអាចចែករំលែកបានទេ។ សូមផ្ទុកម្តងទៀត ហើយព្យាយាមម្តងទៀត។`));
    else setChooserOpen(false);
    load();
    onChanged?.();
  }

  async function confirmUnshare() {
    if (!unshareTarget) return;
    setBusy(true);
    const response = await fetch(`${base}/${unshareTarget.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "UNSHARE", deleteHistory }),
    });
    setBusy(false);
    if (!response.ok) {
      setError((await readJson<{ error?: string }>(response)).error ?? t("Request failed.", "សំណើបរាជ័យ។"));
      return;
    }
    setUnshareTarget(null);
    load();
    onChanged?.();
  }

  async function toggleAutoShare(enabled: boolean) {
    setBusy(true);
    setError(null);
    const response = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "auto_share", enabled }),
    });
    setBusy(false);
    if (!response.ok) {
      setError((await readJson<{ error?: string }>(response)).error ?? t("Request failed.", "សំណើបរាជ័យ។"));
      return;
    }
    setAutoShare(enabled);
    load();
    onChanged?.();
  }

  async function confirmRemoveData() {
    setBusy(true);
    const response = await fetch(`/api/telegram-personal/connections/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove_data", confirm: "REMOVE_DATA" }),
    });
    setBusy(false);
    if (!response.ok) {
      setError((await readJson<{ error?: string }>(response)).error ?? t("Request failed.", "សំណើបរាជ័យ។"));
      return;
    }
    setRemoveOpen(false);
    load();
    onChanged?.();
  }

  return (
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      {canManage && autoShareAvailable ? (
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={autoShare}
            disabled={busy}
            onChange={(event) => void toggleAutoShare(event.target.checked)}
          />
          <span className="text-xs text-slate-700">
            <span className="block font-semibold text-slate-900">
              {t("Share all my one-to-one chats automatically", "ចែករំលែកការជជែកមួយទល់មួយទាំងអស់ដោយស្វ័យប្រវត្តិ")}
            </span>
            {t(
              "Each chat with a person appears in TENH when a new message arrives. Older messages are not copied. Groups, channels and bots stay out. Your team sees them only if Team access allows.",
              "ការជជែកនីមួយៗជាមួយមនុស្សនឹងបង្ហាញក្នុង TENH នៅពេលមានសារថ្មី។ សារចាស់ៗមិនត្រូវបានចម្លងទេ។ ក្រុម ឆានែល និង bot មិនត្រូវបាននាំចូលទេ។ ក្រុមការងាររបស់អ្នកមើលឃើញតែនៅពេលការកំណត់ Team access អនុញ្ញាត។",
            )}
          </span>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canManage ? (
          <button type="button" onClick={() => void openChooser()} className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
            {t("Choose chats to share", "ជ្រើសរើសការជជែកដើម្បីចែករំលែក")}
          </button>
        ) : null}
        <Link
          href={channelId ? `/dashboard/inbox?channel=${encodeURIComponent(channelId)}` : "/dashboard/inbox"}
          className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {t("Open in TENH Inbox", "បើកក្នុង TENH Inbox")}
        </Link>
        {canManage && waiting > 0 ? (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
            {t(`${waiting} new chat${waiting === 1 ? "" : "s"} waiting`, `ការជជែកថ្មី ${waiting} កំពុងរង់ចាំ`)}
          </span>
        ) : null}
        {canRemoveData ? (
          <button type="button" onClick={() => setRemoveOpen(true)} className="ml-auto text-xs font-semibold text-rose-700 hover:underline">
            {t("Remove imported data", "លុបទិន្នន័យដែលបាននាំចូល")}
          </button>
        ) : null}
      </div>

      {canManage ? (
        shared.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {shared.map((chat) => (
              <li key={chat.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-slate-900">{chat.title}</span>
                  {chat.username ? <span className="ml-1 text-xs text-slate-500">@{chat.username}</span> : null}
                </span>
                <button type="button" onClick={() => { setDeleteHistory(false); setUnshareTarget(chat); }} className="shrink-0 text-xs font-semibold text-slate-600 hover:text-rose-700">
                  {t("Stop sharing", "ឈប់ចែករំលែក")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">{t("No chats are shared yet. Your team sees nothing from this account.", "មិនទាន់មានការជជែកណាមួយត្រូវបានចែករំលែកទេ។ ក្រុមរបស់អ្នកមិនឃើញអ្វីពីគណនីនេះទេ។")}</p>
        )
      ) : null}

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p> : null}

      {chooserOpen ? (
        <div className="fixed inset-0 z-[190] flex items-center justify-center p-4">
          <button type="button" aria-label={t("Close", "បិទ")} onClick={() => setChooserOpen(false)} className="absolute inset-0 bg-slate-950/40" />
          <section role="dialog" aria-modal="true" className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="font-bold text-slate-950">{t("Choose chats to share with your team", "ជ្រើសរើសការជជែកដើម្បីចែករំលែកជាមួយក្រុម")}</p>
              <p className="mt-1 text-xs text-slate-500">{t("Only one-to-one chats are listed. Groups, bots and contacts are never imported.", "បង្ហាញតែការជជែកមួយទល់មួយប៉ុណ្ណោះ។ ក្រុម bot និងទំនាក់ទំនងមិនត្រូវបាននាំចូលទេ។")}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {listState === "loading" ? <p className="text-sm text-slate-500">{t("Loading your recent chats…", "កំពុងផ្ទុកការជជែកថ្មីៗរបស់អ្នក…")}</p> : null}
              {listState === "ready" && !listed.length ? <p className="text-sm text-slate-500">{t("No other one-to-one chats found.", "រកមិនឃើញការជជែកមួយទល់មួយផ្សេងទៀតទេ។")}</p> : null}
              {listState === "ready" ? (
                <ul className="space-y-1">
                  {listed.map((chat) => (
                    <li key={chat.chat_id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
                        <input type="checkbox" checked={selected.has(chat.chat_id)} onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(chat.chat_id); else next.delete(chat.chat_id);
                          setSelected(next);
                        }} />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          <span className="font-semibold text-slate-900">{chat.title}</span>
                          {chat.username ? <span className="ml-1 text-xs text-slate-500">@{chat.username}</span> : null}
                        </span>
                        {chat.last_message_at ? <span className="shrink-0 text-xs text-slate-400">{new Date(chat.last_message_at).toLocaleDateString()}</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="space-y-3 border-t border-slate-200 px-5 py-4">
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" checked={importHistory} onChange={(event) => setImportHistory(event.target.checked)} />
                <span>{t("Also import the last 50 messages of each chosen chat", "នាំចូលសារ 50 ចុងក្រោយនៃការជជែកនីមួយៗដែលបានជ្រើសរើសផងដែរ")}</span>
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setChooserOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">{t("Cancel", "បោះបង់")}</button>
                <button type="button" disabled={!selected.size || busy} onClick={() => void shareSelected()} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400">
                  {busy ? t("Sharing…", "កំពុងចែករំលែក…") : t(`Share ${selected.size || ""}`.trim(), `ចែករំលែក ${selected.size || ""}`.trim())}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {unshareTarget ? (
        <div className="fixed inset-0 z-[190] flex items-center justify-center p-4">
          <button type="button" aria-label={t("Close", "បិទ")} onClick={() => setUnshareTarget(null)} className="absolute inset-0 bg-slate-950/40" />
          <section role="dialog" aria-modal="true" className="relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <p className="font-bold text-slate-950">{t("Stop sharing this chat?", "ឈប់ចែករំលែកការជជែកនេះ?")}</p>
            <p className="mt-1 text-sm text-slate-600">
              {unshareTarget.title} · {t("New messages from this chat will no longer come into TENH.", "សារថ្មីពីការជជែកនេះនឹងលែងចូលមក TENH ទៀតហើយ។")}
            </p>
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={deleteHistory} onChange={(event) => setDeleteHistory(event.target.checked)} />
              <span>{t("Also delete its messages from TENH (Telegram is not affected)", "លុបសាររបស់វាពី TENH ផងដែរ (Telegram មិនរងផលប៉ះពាល់ទេ)")}</span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setUnshareTarget(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">{t("Cancel", "បោះបង់")}</button>
              <button type="button" disabled={busy} onClick={() => void confirmUnshare()} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-200">
                {busy ? t("Working…", "កំពុងដំណើរការ…") : t("Stop sharing", "ឈប់ចែករំលែក")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmActionDialog
        open={removeOpen}
        title={t("Remove all imported data?", "លុបទិន្នន័យដែលបាននាំចូលទាំងអស់?")}
        description={t("Every shared chat and message from this Telegram account will be deleted from TENH.", "ការជជែក និងសារដែលបានចែករំលែកទាំងអស់ពីគណនី Telegram នេះនឹងត្រូវលុបពី TENH។")}
        note={t("The account stays connected, and nothing changes in Telegram. This cannot be undone.", "គណនីនៅតែភ្ជាប់ ហើយគ្មានអ្វីផ្លាស់ប្តូរក្នុង Telegram ទេ។ សកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។")}
        confirmLabel={t("Remove data", "លុបទិន្នន័យ")}
        cancelLabel={t("Cancel", "បោះបង់")}
        loading={busy}
        tone="danger"
        icon="trash"
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => void confirmRemoveData()}
      />
    </div>
  );
}
