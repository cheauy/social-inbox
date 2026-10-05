"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { PersonalBadge } from "@/components/integrations/telegram-personal-panel";
import { createClient } from "@/lib/supabase/client";

type PersonalChat = {
  id: string;
  title: string;
  username: string | null;
  accountName: string;
  lastMessageAt: string | null;
  preview: string | null;
  lastDirection: "incoming" | "outgoing" | null;
  unread: number;
};

type PersonalMessage = {
  id: string;
  telegramMessageId: number;
  direction: "incoming" | "outgoing";
  type: "text" | "placeholder";
  body: string | null;
  placeholder: string | null;
  sentAt: string;
};

function useT() {
  const km = useWorkspaceLanguageId() === "km";
  return (en: string, kmText: string) => (km ? kmText : en);
}

const PLACEHOLDER_LABEL: Record<string, [string, string, string]> = {
  photo: ["📷", "Photo", "រូបថត"],
  video: ["🎬", "Video", "វីដេអូ"],
  voice: ["🎤", "Voice message", "សារជាសំឡេង"],
  video_note: ["🎥", "Video message", "សារជាវីដេអូ"],
  sticker: ["🙂", "Sticker", "ស្ទីកឃ័រ"],
  file: ["📎", "File", "ឯកសារ"],
  audio: ["🎵", "Audio", "សំឡេង"],
  gif: ["🎞️", "GIF", "GIF"],
  location: ["📍", "Location", "ទីតាំង"],
  contact: ["👤", "Contact", "ទំនាក់ទំនង"],
  poll: ["📊", "Poll", "ការស្ទង់មតិ"],
  other: ["💬", "Message", "សារ"],
};

function timeLabel(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString();
}

async function getJson<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T | null }> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init });
    const data = response.ok ? ((await response.json()) as T) : null;
    return { status: response.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

/**
 * D1 Personal inbox: read-only view of shared Telegram Personal chats.
 * Data comes only from /api/telegram-personal/inbox, which applies the
 * account's team-access setting; Realtime events (filtered by the same rule in
 * the database) only trigger a refetch.
 */
export function TelegramPersonalInbox() {
  const t = useT();
  const [state, setState] = useState<"loading" | "ready" | "disabled" | "error">("loading");
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [chats, setChats] = useState<PersonalChat[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PersonalMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const selectedRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refreshChats = useCallback(() => {
    void getJson<{ businessId: string; chats: PersonalChat[] }>("/api/telegram-personal/inbox").then(({ status, data }) => {
      if (status === 404) return setState("disabled");
      if (!data) return setState((current) => (current === "ready" ? current : "error"));
      setBusinessId(data.businessId);
      setChats(data.chats);
      setState("ready");
    });
  }, []);

  const markRead = useCallback((chatId: string) => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void getJson(`/api/telegram-personal/inbox/${chatId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    }).then(() => setChats((current) => current.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat))));
  }, []);

  /** Loads the newest page and merges it with what is shown, keyed by message id (no duplicates). */
  const refreshMessages = useCallback((chatId: string) => {
    void getJson<{ messages: PersonalMessage[]; hasMore: boolean }>(`/api/telegram-personal/inbox/${chatId}`).then(({ data }) => {
      if (!data || selectedRef.current !== chatId) return;
      setMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]));
        for (const message of data.messages) byId.set(message.id, message);
        return [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.telegramMessageId - b.telegramMessageId);
      });
      setHasMore((current) => current || data.hasMore);
      markRead(chatId);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
    });
  }, [markRead]);

  function openChat(chatId: string) {
    selectedRef.current = chatId;
    setSelectedId(chatId);
    setMessages([]);
    setHasMore(false);
    refreshMessages(chatId);
  }

  async function loadOlder() {
    const chatId = selectedRef.current;
    const oldest = messages[0];
    if (!chatId || !oldest) return;
    setLoadingOlder(true);
    const { data } = await getJson<{ messages: PersonalMessage[]; hasMore: boolean }>(
      `/api/telegram-personal/inbox/${chatId}?before=${encodeURIComponent(oldest.sentAt)}&beforeId=${oldest.telegramMessageId}`,
    );
    setLoadingOlder(false);
    if (!data || selectedRef.current !== chatId) return;
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of data.messages) byId.set(message.id, message);
      return [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.telegramMessageId - b.telegramMessageId);
    });
    setHasMore(data.hasMore);
  }

  useEffect(() => {
    const first = setTimeout(refreshChats, 0);
    // Fallback if Realtime is unavailable: refresh while the tab is visible.
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshChats();
      if (selectedRef.current) refreshMessages(selectedRef.current);
    }, 20000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refreshChats, refreshMessages]);

  useEffect(() => {
    if (!businessId) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const supabase = createClient();
    const schedule = (chatRowId: string | null) => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        refreshChats();
        if (chatRowId && chatRowId === selectedRef.current) refreshMessages(chatRowId);
      }, 300);
    };
    const filter = `business_id=eq.${businessId}`;
    const channel = supabase
      .channel(`tgp-personal-${businessId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "telegram_personal_messages", filter }, (payload) => {
        const row = (payload.new ?? {}) as { chat_row_id?: string };
        schedule(row.chat_row_id ?? null);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "telegram_personal_chats", filter }, () => schedule(null))
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [businessId, refreshChats, refreshMessages]);

  const selected = chats.find((chat) => chat.id === selectedId) ?? null;

  if (state === "disabled") {
    return <p className="p-6 text-sm text-slate-500">{t("Telegram Personal is not enabled for this workspace.", "Telegram ផ្ទាល់ខ្លួនមិនត្រូវបានបើកសម្រាប់កន្លែងធ្វើការនេះទេ។")}</p>;
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-140px)] w-full max-w-[1344px] flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <img src="/images/channels/telegram.png" alt="" className="h-7 w-7 rounded-lg" />
          <h2 className="text-xl font-bold text-slate-950">{t("Telegram Personal", "Telegram ផ្ទាល់ខ្លួន")}</h2>
          <PersonalBadge />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/dashboard/inbox" className="font-semibold text-blue-700 hover:underline">{t("← Main inbox", "← Inbox មេ")}</Link>
          <Link href="/dashboard/integrations" className="text-slate-500 hover:underline">{t("Manage shared chats", "គ្រប់គ្រងការជជែកដែលបានចែករំលែក")}</Link>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white md:grid-cols-[340px_1fr]">
        <aside className={`min-h-0 overflow-y-auto border-slate-200 md:border-r ${selected ? "hidden md:block" : ""}`}>
          {state === "loading" ? <p className="p-4 text-sm text-slate-500">{t("Loading…", "កំពុងផ្ទុក…")}</p> : null}
          {state === "error" ? <p className="p-4 text-sm text-rose-700">{t("Unable to load chats.", "មិនអាចផ្ទុកការជជែកបានទេ។")}</p> : null}
          {state === "ready" && !chats.length ? (
            <p className="p-4 text-sm text-slate-500">
              {t("No shared chats you can see yet. The account holder chooses chats in Integrations → Telegram.", "មិនទាន់មានការជជែកដែលអ្នកអាចមើលឃើញទេ។ ម្ចាស់គណនីជ្រើសរើសការជជែកនៅ Integrations → Telegram។")}
            </p>
          ) : null}
          <ul>
            {chats.map((chat) => (
              <li key={chat.id}>
                <button type="button" onClick={() => openChat(chat.id)}
                  className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${chat.id === selectedId ? "bg-blue-50/60" : ""}`}>
                  <img src="/images/channels/telegram.png" alt="" className="mt-0.5 h-8 w-8 shrink-0 rounded-full" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${chat.unread ? "font-bold text-slate-950" : "font-semibold text-slate-800"}`}>{chat.title}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">{timeLabel(chat.lastMessageAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">
                        {chat.lastDirection === "outgoing" ? t("You: ", "អ្នក៖ ") : ""}{chat.preview ?? ""}
                      </span>
                      {chat.unread ? <span className="min-w-5 shrink-0 rounded-full bg-blue-600 px-1.5 text-center text-[11px] font-bold text-white">{chat.unread}</span> : null}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-violet-700"><PersonalBadge /> {chat.accountName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className={`flex min-h-0 flex-col ${selected ? "" : "hidden md:flex"}`}>
          {selected ? (
            <>
              <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
                <button type="button" className="text-sm text-blue-700 md:hidden" onClick={() => { selectedRef.current = null; setSelectedId(null); }}>←</button>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950">{selected.title}</p>
                  <p className="truncate text-xs text-slate-500">{selected.username ? `@${selected.username} · ` : ""}{t("via", "តាម")} {selected.accountName}</p>
                </div>
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-4">
                {hasMore ? (
                  <div className="text-center">
                    <button type="button" disabled={loadingOlder} onClick={() => void loadOlder()} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                      {loadingOlder ? t("Loading…", "កំពុងផ្ទុក…") : t("Load older messages", "ផ្ទុកសារចាស់ៗ")}
                    </button>
                  </div>
                ) : null}
                {messages.map((message) => {
                  const outgoing = message.direction === "outgoing";
                  const label = message.type === "placeholder" ? PLACEHOLDER_LABEL[message.placeholder ?? "other"] ?? PLACEHOLDER_LABEL.other : null;
                  return (
                    <div key={message.id} className={`flex ${outgoing ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm ${outgoing ? "bg-blue-600 text-white" : "bg-white text-slate-900"}`}>
                        {label ? (
                          <p className={`text-xs font-semibold ${outgoing ? "text-blue-100" : "text-slate-500"}`}>
                            {label[0]} {t(label[1], label[2])} · {t("open Telegram to view", "បើក Telegram ដើម្បីមើល")}
                          </p>
                        ) : null}
                        {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
                        <p className={`mt-1 text-right text-[10px] ${outgoing ? "text-blue-100" : "text-slate-400"}`}>{timeLabel(message.sentAt)}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
              <footer className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
                {t("Read-only for now. Replying from TENH comes in the next update; reply in Telegram meanwhile.", "បច្ចុប្បន្នអាចអានបានតែប៉ុណ្ណោះ។ ការឆ្លើយតបពី TENH នឹងមកដល់នៅការអាប់ដេតបន្ទាប់ សូមឆ្លើយតបក្នុង Telegram សិន។")}
              </footer>
            </>
          ) : (
            <p className="m-auto p-6 text-sm text-slate-500">{t("Choose a chat to read it.", "ជ្រើសរើសការជជែកដើម្បីអាន។")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
