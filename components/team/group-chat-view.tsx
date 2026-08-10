"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { MentionComposer } from "@/components/team/mention-composer";

type TeamMember = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  profile_picture_url: string | null;
};

type TeamRoom = {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_general: boolean;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  member_ids: string[];
  member_count: number;
  unread_count: number;
};

type CurrentMember = {
  id: string;
  full_name: string;
  role: string;
  profile_picture_url: string | null;
};

type TeamMessage = {
  id: string;
  business_id: string;
  room_id: string;
  sender_member_id: string;
  message_text: string;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  sender:
    | TeamMember
    | TeamMember[]
    | null;
};

type RoomsResponse = {
  success?: boolean;
  error?: string;
  rooms?: TeamRoom[];
  members?: TeamMember[];
  currentMember?: CurrentMember;
  businessId?: string;
  canManage?: boolean;
};

type MessagesResponse = {
  success?: boolean;
  error?: string;
  messages?: TeamMessage[];
  hasMore?: boolean;
};

async function readJsonResponse<T>(
  response: Response,
  label: string,
): Promise<T> {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error(
      `${label}: server returned an empty response (HTTP ${response.status}).`,
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const looksLikeHtml =
      text.trimStart().startsWith("<");

    throw new Error(
      looksLikeHtml
        ? `${label}: the API route returned HTML instead of JSON (HTTP ${response.status}). Check that the route file exists at the exact [roomId] path and restart npm run dev.`
        : `${label}: the server returned invalid JSON (HTTP ${response.status}).`,
    );
  }
}

function getInitial(name: string | null | undefined) {
  return name?.trim().charAt(0).toUpperCase() || "T";
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeSender(
  sender: TeamMessage["sender"],
): TeamMember | null {
  return Array.isArray(sender)
    ? sender[0] ?? null
    : sender;
}

export function GroupChatView() {
  const searchParams = useSearchParams();
  const requestedRoomId = searchParams.get("room");

  const [rooms, setRooms] = useState<TeamRoom[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [currentMember, setCurrentMember] =
    useState<CurrentMember | null>(null);
  const [businessId, setBusinessId] =
    useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [selectedRoomId, setSelectedRoomId] =
    useState<string | null>(
      searchParams.get("room"),
    );
  const [messages, setMessages] =
    useState<TeamMessage[]>([]);
  const [loadingRooms, setLoadingRooms] =
    useState(true);
  const [loadingMessages, setLoadingMessages] =
    useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] =
    useState<string | null>(null);
  const [messageText, setMessageText] =
    useState("");
  const [mentionedMemberIds, setMentionedMemberIds] =
    useState<string[]>([]);
  const [mentionEveryone, setMentionEveryone] =
    useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] =
    useState("");
  const [createMemberIds, setCreateMemberIds] =
    useState<string[]>([]);
  const [manageMembersOpen, setManageMembersOpen] =
    useState(false);
  const [manageMemberIds, setManageMemberIds] =
    useState<string[]>([]);
  const [modalBusy, setModalBusy] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedRoomIdRef = useRef<string | null>(null);
  const messageLoadSequenceRef = useRef(0);

  const selectedRoom = useMemo(
    () =>
      rooms.find((room) => room.id === selectedRoomId) ??
      null,
    [rooms, selectedRoomId],
  );

  const loadRooms = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/team-chat/rooms",
        { cache: "no-store" },
      );
      const result =
        await readJsonResponse<RoomsResponse>(
          response,
          "Unable to load group chat",
        );

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to load group chat.",
        );
      }

      const nextRooms = result.rooms ?? [];
      setRooms(nextRooms);
      setMembers(result.members ?? []);
      setCurrentMember(result.currentMember ?? null);
      setBusinessId(result.businessId ?? null);
      setCanManage(result.canManage === true);

      setSelectedRoomId((current) => {
        // Keep the room the agent explicitly selected. Realtime room/member
        // refreshes must never bounce the UI back to the old URL room.
        if (
          current &&
          nextRooms.some((room) => room.id === current)
        ) {
          return current;
        }

        const roomFromUrl =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get(
                "room",
              )
            : null;

        if (
          roomFromUrl &&
          nextRooms.some((room) => room.id === roomFromUrl)
        ) {
          return roomFromUrl;
        }

        return nextRooms[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load group chat.",
      );
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  const markRoomRead = useCallback(
    async (roomId: string) => {
      try {
        await fetch(
          `/api/team-chat/rooms/${encodeURIComponent(
            roomId,
          )}/read`,
          { method: "POST" },
        );

        setRooms((current) =>
          current.map((room) =>
            room.id === roomId
              ? { ...room, unread_count: 0 }
              : room,
          ),
        );
      } catch {
        // Read state is helpful, but should not interrupt chat.
      }
    },
    [],
  );

  const loadMessages = useCallback(
    async (
      roomId: string,
      options?: {
        showLoader?: boolean;
      },
    ) => {
      const showLoader = options?.showLoader !== false;
      const requestSequence =
        ++messageLoadSequenceRef.current;

      if (showLoader) {
        setLoadingMessages(true);
      }

      try {
        const response = await fetch(
          `/api/team-chat/rooms/${encodeURIComponent(
            roomId,
          )}/messages?limit=80`,
          { cache: "no-store" },
        );

        const result =
          await readJsonResponse<MessagesResponse>(
            response,
            "Unable to load team messages",
          );

        if (!response.ok || !result.success) {
          throw new Error(
            result.error ?? "Unable to load team messages.",
          );
        }

        // Never let an older request overwrite a room the agent has
        // already switched away from.
        if (
          requestSequence === messageLoadSequenceRef.current &&
          selectedRoomIdRef.current === roomId
        ) {
          setMessages(result.messages ?? []);
        }

        void markRoomRead(roomId);
      } catch (loadError) {
        if (selectedRoomIdRef.current === roomId) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load team messages.",
          );
        }
      } finally {
        if (
          showLoader &&
          requestSequence === messageLoadSequenceRef.current
        ) {
          setLoadingMessages(false);
        }
      }
    },
    [markRoomRead],
  );

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    selectedRoomIdRef.current = selectedRoomId;

    if (!selectedRoomId) {
      setMessages([]);
      return;
    }

    void loadMessages(selectedRoomId);

    // V2.11.1: update the query string without triggering a
    // Next.js server navigation/RSC render. Calling router.replace()
    // here caused a render loop because the effect also depended on
    // useSearchParams().
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);

      if (url.searchParams.get("room") !== selectedRoomId) {
        url.searchParams.set("room", selectedRoomId);
        window.history.replaceState(
          window.history.state,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    }
  }, [loadMessages, selectedRoomId]);

  // Handle a room id received from a notification/deep link.
  // IMPORTANT: depend only on the URL value. Depending on rooms or
  // selectedRoomId caused a freshly selected/created room to bounce
  // back to the previous room during Realtime refreshes.
  useEffect(() => {
    if (
      requestedRoomId &&
      requestedRoomId !== selectedRoomIdRef.current
    ) {
      setSelectedRoomId(requestedRoomId);
    }
  }, [requestedRoomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages.length]);

  useEffect(() => {
    if (!businessId) {
      return;
    }

    const supabase = createClient();
    let cancelled = false;
    let channel:
      | ReturnType<typeof supabase.channel>
      | null = null;

    async function startRealtime() {
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session || cancelled) {
        return;
      }

      await supabase.realtime.setAuth(
        session.access_token,
      );

      if (cancelled) {
        return;
      }

      const filter = `business_id=eq.${businessId}`;

      channel = supabase
        .channel(`tenh-team-chat-${businessId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "team_chat_events",
            filter,
          },
          (payload) => {
            const row = (payload.new ?? {}) as {
              room_id?: string;
              message_id?: string;
              event_type?: "INSERT" | "UPDATE" | "DELETE";
            };

            void loadRooms();

            if (
              !row.room_id ||
              row.room_id !== selectedRoomIdRef.current
            ) {
              return;
            }

            if (row.event_type === "DELETE" && row.message_id) {
              setMessages((current) =>
                current.filter(
                  (message) => message.id !== row.message_id,
                ),
              );
              return;
            }

            // INSERT / UPDATE sync silently in the background. Do not
            // replace the conversation with a full-screen loading state.
            void loadMessages(row.room_id, {
              showLoader: false,
            });
          },
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_chat_rooms",
            filter,
          },
          () => void loadRooms(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "team_chat_room_members",
            filter,
          },
          () => void loadRooms(),
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "team_chat_room_events",
            filter,
          },
          (payload) => {
            const row = (payload.new ?? {}) as {
              room_id?: string;
              event_type?: "DELETE";
            };

            if (row.event_type === "DELETE" && row.room_id) {
              applyDeletedRoom(row.room_id);
            }

            void loadRooms();
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log(
              "[Tenh Team Chat V2.11.2] ✅ REALTIME READY",
            );
          }
        });
    }

    void startRealtime();

    return () => {
      cancelled = true;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [businessId, loadMessages, loadRooms]);

  function chooseRoom(roomId: string) {
    selectedRoomIdRef.current = roomId;
    setSelectedRoomId(roomId);
    setMessageText("");
    setMentionedMemberIds([]);
    setMentionEveryone(false);
    setError(null);
  }

  function applyDeletedRoom(roomId: string) {
    setRooms((current) => {
      const remaining = current.filter(
        (room) => room.id !== roomId,
      );

      if (selectedRoomIdRef.current === roomId) {
        const fallbackRoom =
          remaining.find((room) => room.is_general) ??
          remaining[0] ??
          null;

        const fallbackRoomId = fallbackRoom?.id ?? null;
        selectedRoomIdRef.current = fallbackRoomId;
        setSelectedRoomId(fallbackRoomId);
        setMessages([]);
        setMessageText("");
        setMentionedMemberIds([]);
        setMentionEveryone(false);
      }

      return remaining;
    });
  }

  async function sendMessage() {
    if (
      !selectedRoomId ||
      !messageText.trim() ||
      sending
    ) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/team-chat/rooms/${encodeURIComponent(
          selectedRoomId,
        )}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messageText,
            mentionedMemberIds,
            mentionEveryone,
          }),
        },
      );

      const result =
        await readJsonResponse<{
          success?: boolean;
          error?: string;
          message?: TeamMessage;
        }>(response, "Unable to send team message");

      if (!response.ok || !result.success || !result.message) {
        throw new Error(
          result.error ?? "Unable to send team message.",
        );
      }

      const sentMessage = result.message;

      setMessages((current) => {
        const withoutDuplicate = current.filter(
          (message) => message.id !== sentMessage.id,
        );

        return [...withoutDuplicate, sentMessage].sort(
          (first, second) =>
            new Date(first.created_at).getTime() -
            new Date(second.created_at).getTime(),
        );
      });

      setMessageText("");
      setMentionedMemberIds([]);
      setMentionEveryone(false);
      void markRoomRead(selectedRoomId);
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to send team message.",
      );
    } finally {
      setSending(false);
    }
  }

  async function createGroup() {
    if (!createName.trim() || modalBusy) {
      return;
    }

    setModalBusy(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/team-chat/rooms",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: createName,
            description: createDescription,
            memberIds: createMemberIds,
          }),
        },
      );

      const result =
        await readJsonResponse<{
          success?: boolean;
          error?: string;
          room?: { id?: string };
        }>(response, "Unable to create team group");

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to create team group.",
        );
      }

      setCreateOpen(false);
      setCreateName("");
      setCreateDescription("");
      setCreateMemberIds([]);

      if (result.room?.id) {
        // Select the new room immediately. loadRooms() now preserves the
        // current selection instead of forcing the old URL room.
        chooseRoom(result.room.id);
      }

      await loadRooms();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create team group.",
      );
    } finally {
      setModalBusy(false);
    }
  }

  function openManageMembers() {
    if (!selectedRoom || selectedRoom.is_general) {
      return;
    }

    setManageMemberIds(selectedRoom.member_ids);
    setManageMembersOpen(true);
  }

  async function saveMembers() {
    if (!selectedRoom || modalBusy) {
      return;
    }

    setModalBusy(true);

    try {
      const response = await fetch(
        `/api/team-chat/rooms/${encodeURIComponent(
          selectedRoom.id,
        )}/members`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            memberIds: manageMemberIds,
          }),
        },
      );

      const result =
        await readJsonResponse<{
          success?: boolean;
          error?: string;
        }>(response, "Unable to update group members");

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to update group members.",
        );
      }

      setManageMembersOpen(false);
      await loadRooms();
    } catch (memberError) {
      setError(
        memberError instanceof Error
          ? memberError.message
          : "Unable to update group members.",
      );
    } finally {
      setModalBusy(false);
    }
  }

  async function deleteGroup() {
    if (
      !selectedRoom ||
      selectedRoom.is_general ||
      !canManage ||
      modalBusy
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Delete #${selectedRoom.name}?\n\nAll messages and memberships in this group will be permanently deleted. This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setModalBusy(true);
    setError(null);

    try {
      const roomId = selectedRoom.id;
      const response = await fetch(
        `/api/team-chat/rooms/${encodeURIComponent(roomId)}`,
        { method: "DELETE" },
      );

      const result =
        await readJsonResponse<{
          success?: boolean;
          error?: string;
        }>(response, "Unable to delete team group");

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ?? "Unable to delete team group.",
        );
      }

      applyDeletedRoom(roomId);
      setManageMembersOpen(false);
      await loadRooms();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete team group.",
      );
    } finally {
      setModalBusy(false);
    }
  }

  async function editMessage(message: TeamMessage) {
    const nextText = window.prompt(
      "Edit team message",
      message.message_text,
    );

    if (
      nextText === null ||
      !nextText.trim() ||
      nextText.trim() === message.message_text.trim()
    ) {
      return;
    }

    const response = await fetch(
      `/api/team-chat/messages/${encodeURIComponent(
        message.id,
      )}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messageText: nextText,
        }),
      },
    );

    const result =
      await readJsonResponse<{
        success?: boolean;
        error?: string;
        message?: TeamMessage;
      }>(response, "Unable to edit team message");

    if (!response.ok || !result.success || !result.message) {
      setError(
        result.error ?? "Unable to edit team message.",
      );
      return;
    }

    const updatedMessage = result.message;

    setMessages((current) =>
      current.map((item) =>
        item.id === updatedMessage.id
          ? updatedMessage
          : item,
      ),
    );
  }

  async function deleteMessage(message: TeamMessage) {
    if (!window.confirm("Delete this team message?")) {
      return;
    }

    const response = await fetch(
      `/api/team-chat/messages/${encodeURIComponent(
        message.id,
      )}`,
      { method: "DELETE" },
    );
    const result =
      await readJsonResponse<{
        success?: boolean;
        error?: string;
      }>(response, "Unable to delete team message");

    if (!response.ok || !result.success) {
      setError(
        result.error ?? "Unable to delete team message.",
      );
      return;
    }

    setMessages((current) =>
      current.filter((item) => item.id !== message.id),
    );
  }

  const totalUnread = rooms.reduce(
    (sum, room) => sum + room.unread_count,
    0,
  );

  if (loadingRooms) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 text-sm text-slate-500">
        Loading internal team chat...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-slate-50">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="font-bold text-slate-950">
                Group Chat
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                Internal team only
              </p>
            </div>

            {totalUnread > 0 ? (
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">
                {totalUnread}
              </span>
            ) : null}
          </div>

          {canManage ? (
            <button
              type="button"
              onClick={() => {
                setCreateMemberIds(
                  currentMember ? [currentMember.id] : [],
                );
                setCreateOpen(true);
              }}
              className="mt-3 w-full rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
            >
              + New group
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {rooms.map((room) => {
            const selected = room.id === selectedRoomId;

            return (
              <button
                key={room.id}
                type="button"
                onClick={() => chooseRoom(room.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                  selected
                    ? "bg-blue-50 text-blue-800"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                    selected
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  #
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {room.name}
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {room.member_count} member
                    {room.member_count === 1 ? "" : "s"}
                  </span>
                </span>

                {room.unread_count > 0 ? (
                  <span className="flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {room.unread_count > 99
                      ? "99+"
                      : room.unread_count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-white">
        {selectedRoom ? (
          <>
            <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-slate-200 px-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-bold text-slate-950">
                    # {selectedRoom.name}
                  </h2>
                  {selectedRoom.is_general ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      Everyone
                    </span>
                  ) : null}
                </div>

                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {selectedRoom.description ||
                    `${selectedRoom.member_count} team members`}
                </p>
              </div>

              {canManage && !selectedRoom.is_general ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openManageMembers}
                    disabled={modalBusy}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Manage members
                  </button>

                  <button
                    type="button"
                    onClick={() => void deleteGroup()}
                    disabled={modalBusy}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {modalBusy ? "Please wait..." : "Delete group"}
                  </button>
                </div>
              ) : null}
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-5 py-5">
              {loadingMessages ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  Loading messages...
                </div>
              ) : messages.length === 0 ? (
                <div className="mx-auto mt-16 max-w-md text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-2xl font-bold text-blue-700">
                    #
                  </div>
                  <h3 className="mt-4 font-bold text-slate-900">
                    Start #{selectedRoom.name}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Messages here are private to your internal team and are never sent to customers.
                  </p>
                </div>
              ) : (
                <div className="mx-auto max-w-4xl space-y-4">
                  {messages.map((message) => {
                    const sender = normalizeSender(
                      message.sender,
                    );
                    const mine =
                      message.sender_member_id ===
                      currentMember?.id;
                    const canDelete =
                      mine || canManage;

                    return (
                      <article
                        key={message.id}
                        className="group flex items-start gap-3"
                      >
                        {sender?.profile_picture_url ? (
                          <img
                            src={sender.profile_picture_url}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                            {getInitial(sender?.full_name)}
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {sender?.full_name ?? "Team member"}
                            </span>
                            <span className="text-[11px] capitalize text-slate-400">
                              {sender?.role ?? "member"}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {formatMessageTime(
                                message.created_at,
                              )}
                            </span>
                            {message.edited_at ? (
                              <span className="text-[11px] text-slate-400">
                                edited
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                            {message.message_text}
                          </div>
                        </div>

                        <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                          {mine ? (
                            <button
                              type="button"
                              onClick={() =>
                                void editMessage(message)
                              }
                              className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-white hover:text-slate-900"
                            >
                              Edit
                            </button>
                          ) : null}

                          {canDelete ? (
                            <button
                              type="button"
                              onClick={() =>
                                void deleteMessage(message)
                              }
                              className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-200 bg-white p-4">
              <div className="mx-auto max-w-4xl">
                <MentionComposer
                  value={messageText}
                  onChange={setMessageText}
                  members={members.filter(
                    (member) =>
                      member.id !== currentMember?.id,
                  )}
                  mentionedMemberIds={mentionedMemberIds}
                  onMentionedMemberIdsChange={
                    setMentionedMemberIds
                  }
                  mentionEveryone={mentionEveryone}
                  onMentionEveryoneChange={
                    setMentionEveryone
                  }
                  placeholder={`Message #${selectedRoom.name}...`}
                  rows={3}
                  disabled={sending}
                />

                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">
                    Internal only. Use @ to notify a teammate.
                  </p>
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={sending || !messageText.trim()}
                    className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300"
                  >
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            No team chat rooms available.
          </div>
        )}

        {error ? (
          <div className="absolute bottom-5 right-5 z-50 max-w-md rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
            <div className="flex items-start gap-3">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="font-bold"
              >
                ×
              </button>
            </div>
          </div>
        ) : null}
      </main>

      {createOpen ? (
        <RoomMembersModal
          title="Create team group"
          members={members}
          selectedMemberIds={createMemberIds}
          onSelectedMemberIdsChange={setCreateMemberIds}
          name={createName}
          onNameChange={setCreateName}
          description={createDescription}
          onDescriptionChange={setCreateDescription}
          showRoomFields
          busy={modalBusy}
          confirmLabel="Create group"
          onConfirm={() => void createGroup()}
          onClose={() => setCreateOpen(false)}
        />
      ) : null}

      {manageMembersOpen && selectedRoom ? (
        <RoomMembersModal
          title={`Members of #${selectedRoom.name}`}
          members={members}
          selectedMemberIds={manageMemberIds}
          onSelectedMemberIdsChange={setManageMemberIds}
          busy={modalBusy}
          confirmLabel="Save members"
          onConfirm={() => void saveMembers()}
          onClose={() => setManageMembersOpen(false)}
        />
      ) : null}
    </div>
  );
}

type RoomMembersModalProps = {
  title: string;
  members: TeamMember[];
  selectedMemberIds: string[];
  onSelectedMemberIdsChange: (ids: string[]) => void;
  name?: string;
  onNameChange?: (value: string) => void;
  description?: string;
  onDescriptionChange?: (value: string) => void;
  showRoomFields?: boolean;
  busy: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

function RoomMembersModal({
  title,
  members,
  selectedMemberIds,
  onSelectedMemberIdsChange,
  name = "",
  onNameChange,
  description = "",
  onDescriptionChange,
  showRoomFields = false,
  busy,
  confirmLabel,
  onConfirm,
  onClose,
}: RoomMembersModalProps) {
  const selected = new Set(selectedMemberIds);

  function toggle(memberId: string) {
    if (selected.has(memberId)) {
      onSelectedMemberIdsChange(
        selectedMemberIds.filter(
          (id) => id !== memberId,
        ),
      );
    } else {
      onSelectedMemberIdsChange([
        ...selectedMemberIds,
        memberId,
      ]);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h3 className="font-bold text-slate-950">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-5">
          {showRoomFields ? (
            <div className="mb-5 space-y-3">
              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Group name
                </label>
                <input
                  value={name}
                  onChange={(event) =>
                    onNameChange?.(event.target.value)
                  }
                  maxLength={80}
                  placeholder="Support Team"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">
                  Description
                </label>
                <input
                  value={description}
                  onChange={(event) =>
                    onDescriptionChange?.(
                      event.target.value,
                    )
                  }
                  placeholder="Optional group description"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">
              Team members
            </p>
            <span className="text-xs text-slate-400">
              {selectedMemberIds.length} selected
            </span>
          </div>

          <div className="mt-2 space-y-1">
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => toggle(member.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-50 ${
                  selected.has(member.id)
                    ? "bg-blue-50"
                    : ""
                }`}
              >
                {member.profile_picture_url ? (
                  <img
                    src={member.profile_picture_url}
                    alt=""
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                    {getInitial(member.full_name)}
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {member.full_name}
                  </span>
                  <span className="block truncate text-xs capitalize text-slate-400">
                    {member.role}
                  </span>
                </span>

                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
                    selected.has(member.id)
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-300 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={
              busy ||
              (showRoomFields && !name.trim())
            }
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300"
          >
            {busy ? "Saving..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
