import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  Empty,
  ErrorNotice,
  IconButton,
  colors,
  styles,
  time,
} from "../../components/ui";
import { api, ApiError } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";

const PAGE_SIZE = 40;

type Sender = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  profile_picture_url: string | null;
};

type RoomMessage = {
  id: string;
  room_id: string;
  sender_member_id: string | null;
  message_text: string | null;
  edited_at: string | null;
  created_at: string;
  sender: Sender | null;
  attachments?: { id: string; file_name?: string | null }[];
};

type Room = {
  id: string;
  name: string | null;
  is_general?: boolean;
  is_muted?: boolean;
};

/*
 * Held newest-first and drawn inverted, the same way the customer thread is:
 * the newest sits at the bottom with nothing measured, the keyboard does not
 * push it out of view, and scrolling up reaches the list's "end", which is
 * where older messages belong.
 *
 * The API returns oldest-first because the web renders top-down, so each page
 * is reversed on the way in.
 */
function mergeMessages(current: RoomMessage[], incoming: RoomMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort((first, second) => {
    const difference =
      new Date(second.created_at).getTime() -
      new Date(first.created_at).getTime();

    return difference !== 0 ? difference : second.id.localeCompare(first.id);
  });
}

/*
 * A team message.
 *
 * Nobody's own messages sit on the right the way a customer thread does --
 * a room has five people in it, not two, so which side a bubble is on stops
 * meaning anything. The name carries it instead, and only on the first
 * message of a run, so a burst from one person reads as one turn.
 */
function RoomBubble({
  message,
  showSender,
  mine,
  deleting,
  onDelete,
}: {
  message: RoomMessage;
  showSender: boolean;
  mine: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const name = message.sender?.full_name ?? "Someone";

  return (
    <Pressable
      /*
       * Long press to delete, and only your own. The server also lets an
       * owner or admin delete anyone's, but a room is a conversation between
       * colleagues -- reaching into someone else's words wants the deliberate
       * surface the web has, not a long press you can trigger by resting a
       * thumb on the screen.
       */
      accessibilityRole={mine ? "button" : "text"}
      accessibilityLabel={
        mine ? `Your message: ${message.message_text ?? ""}. Long press to delete.` : undefined
      }
      onLongPress={mine ? onDelete : undefined}
      delayLongPress={500}
      style={{
        flexDirection: "row",
        gap: 10,
        paddingHorizontal: 14,
        paddingTop: showSender ? 10 : 2,
        paddingBottom: 2,
        opacity: deleting ? 0.4 : 1,
      }}
    >
      <View style={{ width: 32 }}>
        {showSender ? (
          <Avatar
            name={name}
            uri={message.sender?.profile_picture_url}
            size={32}
          />
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        {showSender ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                color: mine ? colors.blue : colors.ink,
                fontSize: 13.5,
                fontWeight: "800",
              }}
            >
              {mine ? "You" : name}
            </Text>

            <Text style={{ fontSize: 11, color: colors.muted }}>
              {time(message.created_at)}
            </Text>
          </View>
        ) : null}

        <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 21 }}>
          {message.message_text?.trim() || "—"}
        </Text>

        {message.attachments && message.attachments.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="attach" size={13} color={colors.muted} />

            <Text style={[styles.muted, { fontSize: 12 }]}>
              {message.attachments.length} attachment
              {message.attachments.length === 1 ? "" : "s"} — open on the web
            </Text>
          </View>
        ) : null}

        {message.edited_at ? (
          <Text style={[styles.muted, { fontSize: 11 }]}>edited</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function RoomScreen() {
  const { id, name: passedName, muted: passedMuted } = useLocalSearchParams<{
    id: string;
    name?: string;
    muted?: string;
  }>();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { workspace, member, revision } = useInbox();

  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /*
   * Mute is per member, so it lives in a table of its own and the room row
   * knows nothing about it. The list already worked it out, so it travels
   * here as a param rather than costing a second request on open.
   */
  const [muted, setMuted] = useState(passedMuted === "1");
  const [muting, setMuting] = useState(false);

  const requestRef = useRef(0);
  const readMarkedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id || !workspace) {
      return;
    }

    const sequence = ++requestRef.current;

    try {
      const data = await api<{
        room: Room;
        messages: RoomMessage[];
        hasMore: boolean;
      }>(
        `/api/team-chat/rooms/${encodeURIComponent(id)}/messages?limit=${PAGE_SIZE}`,
        workspace.businessId,
      );

      if (sequence !== requestRef.current) {
        return;
      }

      setRoom(data.room ?? null);
      setMessages((current) => mergeMessages(current, data.messages ?? []));
      setHasMore((current) => current || Boolean(data.hasMore));
      setError("");
    } catch (loadError) {
      if (sequence !== requestRef.current) {
        return;
      }

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load this room.",
      );
    } finally {
      if (sequence === requestRef.current) {
        setLoading(false);
      }
    }
  }, [id, workspace?.businessId]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  /*
   * Marked read once per room per visit.
   *
   * Nothing local is patched: the unread count belongs to the server and the
   * list that draws it reloads when its tab comes back into view, which is
   * the moment the number matters.
   */
  useEffect(() => {
    if (!id || !workspace || loading || readMarkedRef.current === id) {
      return;
    }

    readMarkedRef.current = id;

    void api(
      `/api/team-chat/rooms/${encodeURIComponent(id)}/read`,
      workspace.businessId,
      { method: "POST" },
    ).catch(() => {
      // The next visit marks it again; nothing here is worth an error line.
    });
  }, [id, workspace?.businessId, loading]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[messages.length - 1];

    if (!id || !workspace || !oldest || !hasMore || loadingOlder) {
      return;
    }

    setLoadingOlder(true);

    try {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        before: oldest.created_at,
      });

      const data = await api<{ messages: RoomMessage[]; hasMore: boolean }>(
        `/api/team-chat/rooms/${encodeURIComponent(id)}/messages?${query.toString()}`,
        workspace.businessId,
      );

      setMessages((current) => mergeMessages(current, data.messages ?? []));
      setHasMore(Boolean(data.hasMore));
    } catch (olderError) {
      setError(
        olderError instanceof Error
          ? olderError.message
          : "Unable to load older messages.",
      );
    } finally {
      setLoadingOlder(false);
    }
  }, [hasMore, id, loadingOlder, messages, workspace?.businessId]);

  async function toggleMute() {
    if (!id || !workspace || muting) {
      return;
    }

    const next = !muted;

    setMuting(true);
    setError("");
    setMuted(next);

    try {
      await api(
        `/api/team-chat/rooms/${encodeURIComponent(id)}/mute`,
        workspace.businessId,
        { method: "PATCH", body: { muted: next } },
      );

    } catch (muteError) {
      setMuted(!next);

      setError(
        muteError instanceof Error
          ? muteError.message
          : "Unable to change notifications for this room.",
      );
    } finally {
      setMuting(false);
    }
  }

  function confirmDelete(message: RoomMessage) {
    if (deletingId) {
      return;
    }

    Alert.alert(
      "Delete this message?",
      "It disappears for everyone in the room. This cannot be undone.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void remove(message),
        },
      ],
    );
  }

  async function remove(message: RoomMessage) {
    if (!workspace) {
      return;
    }

    setDeletingId(message.id);
    setError("");

    try {
      await api(
        `/api/team-chat/messages/${encodeURIComponent(message.id)}`,
        workspace.businessId,
        { method: "DELETE" },
      );

      setMessages((current) =>
        current.filter((item) => item.id !== message.id),
      );
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete that message.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function send() {
    const text = draft.trim();

    if (!text || !id || !workspace || sending) {
      return;
    }

    setSending(true);
    setError("");

    try {
      const data = await api<{ message: RoomMessage }>(
        `/api/team-chat/rooms/${encodeURIComponent(id)}/messages`,
        workspace.businessId,
        { method: "POST", body: { messageText: text } },
      );

      setDraft("");

      /*
       * The posted message comes back, so it goes straight in rather than
       * waiting for a reload -- the room answers the tap. Mentions still need
       * the web: picking who to mention needs the member list and a parser,
       * and half a mention that silently notifies nobody would be worse than
       * not offering it.
       */
      if (data.message) {
        setMessages((current) => mergeMessages(current, [data.message]));
      } else {
        await load();
      }
    } catch (sendError) {
      // The draft stays in the box; see the customer composer for why.
      setError(
        sendError instanceof ApiError
          ? sendError.message
          : "Unable to send. Check your connection and try again.",
      );
    } finally {
      setSending(false);
    }
  }

  const title = room?.name?.trim() || passedName || "Room";

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={styles.header}>
        <View style={styles.row}>
          <IconButton
            icon="chevron-back"
            label="Back to rooms"
            onPress={() => router.back()}
          />

          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              backgroundColor: colors.pale,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="people" size={20} color={colors.blue} />
          </View>

          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={styles.heading}>
              {title}
            </Text>

            <Text style={[styles.muted, { fontSize: 12 }]}>
              {muted ? "Muted · team room" : "Team room"}
            </Text>
          </View>

          {/*
            Muting is the one room setting worth a tap from here: a busy room
            is exactly the room you are in when you decide you have had
            enough of it. A direct mention still gets through, which is the
            server's rule and the reason muting is safe to offer.
          */}
          {muting ? (
            <View style={{ minWidth: 44, alignItems: "center" }}>
              <ActivityIndicator color={colors.blue} />
            </View>
          ) : (
            <IconButton
              icon={muted ? "notifications-off" : "notifications-outline"}
              label={
                muted
                  ? "Unmute this room"
                  : "Mute this room. Mentions still come through."
              }
              onPress={() => void toggleMute()}
            />
          )}
        </View>
      </View>

      <ErrorNotice message={error} onRetry={() => void load()} />

      {loading && messages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : messages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Empty
            icon="chatbubbles-outline"
            title="Nothing here yet"
            detail="Say something and it appears for everyone in this room."
          />
        </View>
      ) : (
        <FlatList
          inverted
          style={{ flex: 1 }}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => {
            /*
             * Inverted, so the message drawn after this one in the array is
             * the one above it on screen. A run by one person shows its name
             * once, on the first message of the run -- which is the last one
             * the array reaches.
             */
            const above = messages[index + 1];

            return (
              <RoomBubble
                message={item}
                showSender={
                  !above || above.sender_member_id !== item.sender_member_id
                }
                mine={Boolean(
                  member && item.sender_member_id === member.id,
                )}
                deleting={deletingId === item.id}
                onDelete={() => confirmDelete(item)}
              />
            );
          }}
          onEndReached={() => void loadOlder()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingOlder ? (
              <View style={{ paddingVertical: 16 }}>
                <ActivityIndicator color={colors.blue} />
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingVertical: 12 }}
        />
      )}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          padding: 12,
          paddingBottom: 12 + insets.bottom,
          backgroundColor: "white",
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          style={[styles.input, { flex: 1, maxHeight: 120 }]}
          placeholder={`Message ${title}…`}
          placeholderTextColor={colors.muted}
          multiline
          editable={!sending}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send to the room"
          disabled={sending || draft.trim().length === 0}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.button,
            {
              minWidth: 52,
              paddingHorizontal: 16,
              opacity:
                sending || draft.trim().length === 0
                  ? 0.4
                  : pressed
                    ? 0.7
                    : 1,
            },
          ]}
        >
          {sending ? (
            <ActivityIndicator color="white" />
          ) : (
            <Ionicons name="send" size={19} color="white" />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
