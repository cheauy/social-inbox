import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
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
} from "../../../components/ui";
import { RoomComposer } from "../../../components/room-composer";
import type { RoomPending } from "../../../components/room-composer";
import { api, ApiError } from "../../../lib/api/client";
import { useInbox } from "../../../lib/inbox-provider";

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
  const { workspace, member, revision, rooms, roster, refreshRooms } =
    useInbox();

  const current = rooms.find((item) => item.id === id) ?? null;

  const [room, setRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pending, setPending] = useState<RoomPending[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionEveryone, setMentionEveryone] = useState(false);

  /*
   * Mute is per member, so it lives in a table of its own and the room row
   * knows nothing about it. The list already worked it out, so it travels
   * here as a param rather than costing a second request on open.
   */
  /*
   * Mute follows the provider once it has the room, and falls back to what
   * the list passed in until then -- so the bell is right on the first frame
   * rather than flickering.
   */
  const [mutedLocally, setMuted] = useState(passedMuted === "1");
  const muted = current?.is_muted ?? mutedLocally;
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

  /*
   * Attachments are staged like the customer composer's, so a file and the
   * sentence explaining it leave together. The upload happens on send: the
   * server wants an attachment id in the message body, and an id created for
   * a message nobody sent is a row pointing at nothing.
   */
  async function pickFromLibrary(mediaTypes: ImagePicker.MediaType[]) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError("TENH needs permission to your photos to attach one.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsMultipleSelection: mediaTypes.includes("images"),
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    setPending((current) => [
      ...current,
      ...result.assets.map((asset, index) => {
        const video = asset.type === "video";

        return {
          key: `${asset.assetId ?? asset.uri}:${index}`,
          uri: asset.uri,
          name: asset.fileName || (video ? "video.mp4" : "photo.jpg"),
          mimeType: asset.mimeType || (video ? "video/mp4" : "image/jpeg"),
          kind: video ? ("video" as const) : ("image" as const),
        };
      }),
    ]);
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (result.canceled) {
      return;
    }

    setPending((current) => [
      ...current,
      ...result.assets.map((asset, index) => ({
        key: `${asset.uri}:${index}`,
        uri: asset.uri,
        name: asset.name || "attachment",
        mimeType: asset.mimeType || "application/octet-stream",
        kind: "file" as const,
      })),
    ]);
  }

  function stageVoice(uri: string, millis: number) {
    setPending((current) => [
      ...current,
      {
        key: `voice:${Date.now()}`,
        uri,
        name: `voice-${Math.round(millis / 1000)}s.m4a`,
        mimeType: "audio/m4a",
        kind: "audio" as const,
      },
    ]);
  }

  /*
   * A mention is the person's name in the text and their id alongside it,
   * which is how the web records one. Both have to agree: the server sends
   * the notification off the id, and the reader sees the name.
   */
  function mention(name: string, memberId: string | null) {
    const token = memberId ? `@${name}` : "@everyone";

    setDraft((current) =>
      current.trim().length === 0 ? `${token} ` : `${current.trimEnd()} ${token} `,
    );

    if (memberId) {
      setMentions((current) =>
        current.includes(memberId) ? current : [...current, memberId],
      );
    } else {
      setMentionEveryone(true);
    }
  }

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

      // The provider owns the room now, so the list, this header and the tab
      // badge all move together rather than each finding out separately.
      await refreshRooms();

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

    if ((!text && pending.length === 0) || !id || !workspace || sending) {
      return;
    }

    setSending(true);
    setError("");

    try {
      /*
       * Files first, because the message carries their ids. A failed upload
       * therefore stops the send rather than posting a message that promises
       * an attachment nobody can open.
       */
      const attachmentIds: string[] = [];

      for (const file of pending) {
        const form = new FormData();

        form.append("roomId", String(id));
        form.append("file", {
          uri: file.uri,
          name: file.name,
          type: file.mimeType,
        } as unknown as Blob);

        const uploaded = await api<{ attachment: { id: string } }>(
          "/api/team-chat/attachments",
          workspace.businessId,
          { method: "POST", body: form },
        );

        if (uploaded.attachment?.id) {
          attachmentIds.push(uploaded.attachment.id);
        }
      }

      const data = await api<{ message: RoomMessage }>(
        `/api/team-chat/rooms/${encodeURIComponent(id)}/messages`,
        workspace.businessId,
        {
          method: "POST",
          body: {
            messageText: text,
            attachmentIds,
            mentionedMemberIds: mentions,
            mentionEveryone,
          },
        },
      );

      setDraft("");
      setPending([]);
      setMentions([]);
      setMentionEveryone(false);

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

  const title = current?.name?.trim() || room?.name?.trim() || passedName || "Room";

  /*
   * What the group is for, or how many people are in it when nobody has said.
   * Read from the provider's copy, which the details screen also writes to,
   * so a description changed there is right here without a reload.
   */
  const subtitle =
    current?.description?.trim() ||
    (current
      ? `${current.member_count} member${current.member_count === 1 ? "" : "s"}`
      : "Team room");

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

          {/*
            The name, and under it what the group is for.

            Tapping either opens the details, which is where somebody looks
            when they want to know who can read what they are about to type.
            The description is truncated rather than wrapped: a header that
            grows a line when a group gets a longer purpose pushes the whole
            thread down.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title}. Open group details.`}
            onPress={() =>
              router.push({
                pathname: "/room/[id]/details",
                params: { id: String(id) },
              })
            }
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              opacity: pressed ? 0.6 : 1,
            })}
          >
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
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Text numberOfLines={1} style={[styles.heading, { flexShrink: 1 }]}>
                  {title}
                </Text>

                {muted ? (
                  <Ionicons
                    name="notifications-off"
                    size={13}
                    color={colors.muted}
                  />
                ) : null}
              </View>

              <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
                {subtitle}
              </Text>
            </View>
          </Pressable>

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

      <RoomComposer
        roomName={title}
        draft={draft}
        onDraftChange={setDraft}
        pending={pending}
        onRemovePending={(key) =>
          setPending((items) => items.filter((item) => item.key !== key))
        }
        roster={roster}
        sending={sending}
        bottomInset={insets.bottom}
        onPickImages={() => void pickFromLibrary(["images"])}
        onPickVideo={() => void pickFromLibrary(["videos"])}
        onPickFile={() => void pickFile()}
        onVoice={stageVoice}
        onMention={mention}
        onSend={() => void send()}
      />

    </KeyboardAvoidingView>
  );
}
