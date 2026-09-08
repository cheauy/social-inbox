import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  ChannelAvatar,
  ChannelBadge,
  Empty,
  ErrorNotice,
  IconButton,
  Sheet,
  colors,
  platformOf,
  styles,
  time,
} from "../../components/ui";
import {
  CustomerPanel,
  PanelButton,
  useThreadSwipe,
} from "../../components/customer-panel";
import type {
  CustomerDetail,
  EditableField,
  TeamMember,
} from "../../components/customer-panel";
import { api, ApiError } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import type {
  ConversationStatus,
  InboxMessage,
  SavedReply,
} from "../../lib/types";

/*
 * The thread is held newest-first and drawn inverted, which puts the newest
 * at the bottom with nothing measured and nothing scrolled after layout. An
 * inverted list also keeps the newest message pinned when the keyboard opens,
 * which is what anyone expects from a chat, and it puts "load older" on the
 * end the list reaches when you scroll up.
 *
 * The API hands back the opposite order -- oldest-first, because the web
 * renders top-down -- so every page is reversed on the way in. Feeding it
 * straight through drew the whole conversation upside down: the newest
 * message sat at the top and time ran backwards as you read down.
 */
const PAGE_SIZE = 25;

const sentAt = (message: InboxMessage) =>
  new Date(message.platform_created_at ?? message.created_at).getTime();

/*
 * Newest first, and each message once.
 *
 * A refresh re-fetches the newest page while the agent may have scrolled back
 * through several older ones. Replacing the list would throw that history
 * away every time a message arrives; merging by id keeps it and still picks
 * up whatever is new.
 */
function mergeMessages(current: InboxMessage[], incoming: InboxMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort((first, second) => {
    const difference = sentAt(second) - sentAt(first);

    // Same timestamp to the second happens on an album; id keeps it stable.
    return difference !== 0 ? difference : second.id.localeCompare(first.id);
  });
}

/*
 * What TENH will accept as an upload, and what it calls each one.
 *
 * The kind travels with the file because the server will not guess for us on
 * anything but obvious types, and Messenger treats a video sent as "file"
 * differently from one sent as "video".
 */
type AttachmentKind = "image" | "video" | "file";

type Pending = {
  key: string;
  uri: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
};

type Tag = {
  id: string;
  name: string;
  color: string | null;
};

function kindOf(mimeType: string, name: string): AttachmentKind {
  const type = mimeType.toLowerCase();
  const extension = name.toLowerCase().split(".").pop() ?? "";

  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp"].includes(extension)) {
    return "image";
  }

  if (type.startsWith("video/") || ["mp4", "mov", "m4v", "3gp"].includes(extension)) {
    return "video";
  }

  return "file";
}

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const whole = Math.floor(seconds);

  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function dayMonth(value?: string | null) {
  return value
    ? new Date(value).toLocaleDateString([], {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
}

/*
 * The thread while it is loading.
 *
 * A spinner in the middle of an empty screen says only "wait", and on a slow
 * Cambodian connection that can be several seconds of a screen that looks
 * broken. Bubble-shaped placeholders say what is coming and where it will
 * sit, so nothing jumps when the real messages land -- and they say it in the
 * shape of a conversation, which is the answer to "did I open the right one".
 *
 * Alternating sides and uneven widths on purpose: a column of identical bars
 * reads as a list, not as people talking.
 */
const SKELETON_ROWS: { outgoing: boolean; width: number; lines: number }[] = [
  { outgoing: false, width: 0.62, lines: 2 },
  { outgoing: true, width: 0.45, lines: 1 },
  { outgoing: false, width: 0.5, lines: 1 },
  { outgoing: true, width: 0.7, lines: 2 },
  { outgoing: false, width: 0.4, lines: 1 },
  { outgoing: true, width: 0.55, lines: 1 },
];

function ThreadSkeleton() {
  const pulse = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => loop.stop();
  }, [pulse]);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading this conversation"
      style={{ flex: 1, paddingVertical: 12, justifyContent: "flex-end" }}
    >
      {SKELETON_ROWS.map((row, index) => (
        <Animated.View
          key={index}
          style={{
            opacity: pulse,
            paddingHorizontal: 14,
            paddingVertical: 4,
            alignItems: row.outgoing ? "flex-end" : "flex-start",
          }}
        >
          <View
            style={{
              width: `${row.width * 100}%`,
              backgroundColor: row.outgoing ? "#BFE2F4" : "white",
              borderRadius: 18,
              borderWidth: row.outgoing ? 0 : 1,
              borderColor: colors.border,
              paddingHorizontal: 14,
              paddingVertical: 12,
              gap: 8,
            }}
          >
            {Array.from({ length: row.lines }).map((_, line) => (
              <View
                key={line}
                style={{
                  height: 10,
                  borderRadius: 5,
                  // The last line of a paragraph is short, the way real text is.
                  width: line === row.lines - 1 ? "70%" : "100%",
                  backgroundColor: row.outgoing
                    ? "rgba(255,255,255,0.65)"
                    : colors.border,
                }}
              />
            ))}
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

/*
 * A voice message, played rather than described.
 *
 * The bubble used to read "[audio]", which is the placeholder the webhook
 * writes into message_text when Messenger sends a clip with no words in it.
 * A customer's voice note is often the whole message, so a row that only
 * admits one exists is not much of an inbox.
 *
 * The player itself lives one level up: one player for the screen, handed the
 * clip you tapped. Ten bubbles each holding their own would be ten remote
 * files opened at once, and two of them could play over each other.
 */
function VoiceMessage({
  outgoing,
  active,
  playing,
  position,
  duration,
  onToggle,
}: {
  outgoing: boolean;
  active: boolean;
  playing: boolean;
  position: number;
  duration: number;
  onToggle: () => void;
}) {
  const tint = outgoing ? "white" : colors.blue;
  const track = outgoing ? "rgba(255,255,255,0.35)" : colors.border;
  const progress = active && duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={playing ? "Pause voice message" : "Play voice message"}
      onPress={onToggle}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={playing ? "pause-circle" : "play-circle"} size={34} color={tint} />

      <View style={{ width: 128, gap: 6 }}>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: track }}>
          <View
            style={{
              width: `${progress * 100}%`,
              height: 4,
              borderRadius: 2,
              backgroundColor: tint,
            }}
          />
        </View>

        <Text style={{ fontSize: 11, color: outgoing ? "rgba(255,255,255,0.8)" : colors.muted }}>
          {active && duration > 0 ? `${clock(position)} / ${clock(duration)}` : "Voice message"}
        </Text>
      </View>
    </Pressable>
  );
}

/*
 * A photo at its own shape.
 *
 * The intrinsic size only arrives with the image, so it starts square and
 * settles once onLoad reports the real one. Guessing wrong for a moment is
 * cheaper than reserving nothing and letting the whole thread jump when each
 * picture lands.
 */
function MessagePhoto({ uri }: { uri: string }) {
  const [ratio, setRatio] = useState(1);

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Open photo"
      onPress={() => void Linking.openURL(uri)}
    >
      <Image
        source={{ uri }}
        onLoad={(event) => {
          const { width, height } = event.nativeEvent.source;

          if (width > 0 && height > 0) {
            setRatio(width / height);
          }
        }}
        style={{
          width: 208,
          aspectRatio: ratio,
          maxHeight: 320,
          borderRadius: 12,
          backgroundColor: colors.border,
        }}
        resizeMode="cover"
      />
    </Pressable>
  );
}

/*
 * Video and documents: a card that opens them, not a player.
 *
 * Playing video in the thread would mean another native module and a second
 * set of controls for something an agent watches once. The system player
 * already does it, and knows how to go full screen.
 */
function MessageFile({
  outgoing,
  uri,
  label,
  icon,
}: {
  outgoing: boolean;
  uri: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}) {
  const tint = outgoing ? "white" : colors.blue;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${label.toLowerCase()}`}
      onPress={() => void Linking.openURL(uri)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={icon} size={26} color={tint} />

      <Text style={{ color: outgoing ? "white" : colors.ink, fontSize: 15, fontWeight: "600" }}>
        {label}
      </Text>

      <Ionicons
        name="open-outline"
        size={15}
        color={outgoing ? "rgba(255,255,255,0.8)" : colors.muted}
      />
    </Pressable>
  );
}

function Bubble({
  message,
  audio,
}: {
  message: InboxMessage;
  audio: {
    activeId: string | null;
    playing: boolean;
    position: number;
    duration: number;
    onToggle: (message: InboxMessage) => void;
  };
}) {
  const outgoing = message.direction === "outgoing";
  const url = message.attachment_url;
  const type = message.message_type;

  /*
   * The placeholder the webhook writes for a message that is only an
   * attachment. Once the attachment is drawn, repeating "[image]" under it
   * says nothing.
   */
  const text = message.message_text?.trim() ?? "";
  const isPlaceholder = /^\[(audio|image|video|file|sticker)\]$/i.test(text);
  const body = isPlaceholder ? "" : text;

  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 4,
        alignItems: outgoing ? "flex-end" : "flex-start",
      }}
    >
      <View
        style={{
          maxWidth: "82%",
          backgroundColor: outgoing ? colors.blue : "white",
          borderRadius: 18,
          borderWidth: outgoing ? 0 : 1,
          borderColor: colors.border,
          paddingHorizontal: type === "image" && url ? 6 : 14,
          paddingVertical: type === "image" && url ? 6 : 10,
          gap: 6,
        }}
      >
        {url && type === "image" ? <MessagePhoto uri={url} /> : null}

        {url && type === "audio" ? (
          <VoiceMessage
            outgoing={outgoing}
            active={audio.activeId === message.id}
            playing={audio.activeId === message.id && audio.playing}
            position={audio.position}
            duration={audio.duration}
            onToggle={() => audio.onToggle(message)}
          />
        ) : null}

        {url && type === "video" ? (
          <MessageFile outgoing={outgoing} uri={url} label="Video" icon="videocam" />
        ) : null}

        {url && type !== "image" && type !== "audio" && type !== "video" ? (
          <MessageFile outgoing={outgoing} uri={url} label="Attachment" icon="document" />
        ) : null}

        {body || !url ? (
          <Text
            style={{
              color: outgoing ? "white" : colors.ink,
              fontSize: 15,
              lineHeight: 21,
              paddingHorizontal: type === "image" && url ? 8 : 0,
            }}
          >
            {body || "—"}
          </Text>
        ) : null}

        <Text
          style={{
            fontSize: 11,
            color: outgoing ? "rgba(255,255,255,0.75)" : colors.muted,
            alignSelf: "flex-end",
            paddingHorizontal: type === "image" && url ? 8 : 0,
          }}
        >
          {time(message.platform_created_at ?? message.created_at)}
        </Text>
      </View>
    </View>
  );
}

/*
 * Where an attachment comes from.
 *
 * Two buttons in the composer would have cost 44 more points beside three
 * others, and left the reply box too narrow to see a sentence in. One button
 * asks which, which is also the only question there is.
 */
function AttachSheet({
  open,
  onMedia,
  onFile,
  onClose,
}: {
  open: boolean;
  onMedia: () => void;
  onFile: () => void;
  onClose: () => void;
}) {
  const choices: {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    label: string;
    detail: string;
    onPress: () => void;
  }[] = [
    {
      icon: "images-outline",
      label: "Photo or video",
      detail: "From this phone's gallery.",
      onPress: onMedia,
    },
    {
      icon: "document-outline",
      label: "File",
      detail: "A document, PDF or anything else.",
      onPress: onFile,
    },
  ];

  return (
    <Sheet
      open={open}
      title="Attach"
      detail="Added to the box, sent with your next message."
      onClose={onClose}
    >
      {choices.map((choice) => (
        <Pressable
          key={choice.label}
          accessibilityRole="button"
          onPress={() => {
            onClose();
            choice.onPress();
          }}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            paddingHorizontal: 18,
            paddingVertical: 14,
            backgroundColor: pressed ? colors.pale : "transparent",
          })}
        >
          <Ionicons name={choice.icon} size={22} color={colors.blue} />

          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>
              {choice.label}
            </Text>
            <Text style={[styles.muted, { fontSize: 12.5 }]}>{choice.detail}</Text>
          </View>
        </Pressable>
      ))}
    </Sheet>
  );
}

/*
 * Quick replies, as the web keeps them.
 *
 * Tapping one loads it into the composer rather than sending it: almost every
 * saved reply on this workspace is a greeting somebody then adds a name or a
 * price to, and a picker that sent on tap would make that impossible.
 */
function QuickReplySheet({
  open,
  replies,
  loading,
  onPick,
  onClose,
}: {
  open: boolean;
  replies: SavedReply[];
  loading: boolean;
  onPick: (reply: SavedReply) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      title="Quick replies"
      detail="Loads into the box so you can change it before sending."
      onClose={onClose}
    >
      {loading ? (
        <View style={{ padding: 40 }}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : replies.length === 0 ? (
        <Empty
          icon="flash-outline"
          title="No quick replies"
          detail="Quick replies are written on the web, under Settings. They appear here as soon as they are saved."
        />
      ) : (
        <ScrollView>
          {replies.map((reply) => (
            <Pressable
              key={reply.id}
              accessibilityRole="button"
              onPress={() => {
                onPick(reply);
                onClose();
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 18,
                paddingVertical: 13,
                gap: 3,
                backgroundColor: pressed ? colors.pale : "transparent",
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, color: colors.ink, fontSize: 15, fontWeight: "700" }}>
                  {reply.title}
                </Text>

                {reply.attachments.length > 0 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="attach" size={14} color={colors.muted} />
                    <Text style={[styles.muted, { fontSize: 12 }]}>
                      {reply.attachments.length}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text numberOfLines={2} style={[styles.muted, { fontSize: 13.5 }]}>
                {reply.message_text}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

/*
 * Tags belong to the customer, not to this conversation, so a tag added here
 * shows on every conversation they ever have. That is the point of them, and
 * the reason the sheet says whose they are.
 */
function QuickTagSheet({
  open,
  tags,
  assigned,
  busyId,
  loading,
  name,
  onToggle,
  onClose,
}: {
  open: boolean;
  tags: Tag[];
  assigned: Set<string>;
  busyId: string | null;
  loading: boolean;
  name: string;
  onToggle: (tag: Tag) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Tags" detail={`On ${name}, across every conversation.`} onClose={onClose}>
      {loading ? (
        <View style={{ padding: 40 }}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : tags.length === 0 ? (
        <Empty
          icon="pricetag-outline"
          title="No tags yet"
          detail="Tags are created on the web, under Settings. They appear here as soon as they are saved."
        />
      ) : (
        <ScrollView>
          {tags.map((tag) => {
            const on = assigned.has(tag.id);

            return (
              <Pressable
                key={tag.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                disabled={busyId === tag.id}
                onPress={() => onToggle(tag)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 18,
                  paddingVertical: 13,
                  backgroundColor: pressed ? colors.pale : "transparent",
                })}
              >
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: tag.color ?? colors.muted,
                  }}
                />

                <Text
                  style={{
                    flex: 1,
                    color: colors.ink,
                    fontSize: 15,
                    fontWeight: on ? "800" : "500",
                  }}
                >
                  {tag.name}
                </Text>

                {busyId === tag.id ? (
                  <ActivityIndicator color={colors.blue} />
                ) : on ? (
                  <Ionicons name="checkmark" size={19} color={colors.blue} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}

export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { conversations, workspace, member, revision, updateConversation } =
    useInbox();

  const conversation = useMemo(
    () => conversations.find((item) => item.id === id) ?? null,
    [conversations, id],
  );

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [cursor, setCursor] = useState<{ sentAt: string; id: string } | null>(
    null,
  );
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);

  const [attachOpen, setAttachOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);

  const [tagOpen, setTagOpen] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(() => new Set());
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);

  const requestRef = useRef(0);
  const readMarkedRef = useRef<string | null>(null);

  /*
   * One player for the screen, given whichever clip was tapped. Tapping a
   * second voice message replaces the source, which also stops the first --
   * two customers talking over each other is not something to build.
   */
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const playerStatus = useAudioPlayerStatus(player);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const platform =
    conversation?.social_account?.platform === "telegram" ? "telegram" : "facebook";

  const contactId = conversation?.contact?.id ?? null;
  const name = conversation?.contact?.full_name ?? "Conversation";

  const load = useCallback(async () => {
    if (!id) {
      return;
    }

    const sequence = ++requestRef.current;

    try {
      const data = await api<{
        messages: InboxMessage[];
        hasMore: boolean;
        nextCursor: { sentAt: string; id: string } | null;
      }>(
        `/api/conversations/${encodeURIComponent(id)}/messages?limit=${PAGE_SIZE}`,
        workspace?.businessId,
      );

      // A slower earlier request must not overwrite a newer one.
      if (sequence !== requestRef.current) {
        return;
      }

      setMessages((current) => mergeMessages(current, data.messages ?? []));
      setError("");

      /*
       * Only the first page moves the cursor. Once older pages are loaded
       * the newest page knows nothing about where the agent has read back
       * to, and taking its cursor would send them there again.
       */
      setCursor((current) => current ?? data.nextCursor ?? null);
      setHasMore((current) => current || Boolean(data.hasMore));
    } catch (loadError) {
      if (sequence !== requestRef.current) {
        return;
      }

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load this conversation.",
      );
    } finally {
      if (sequence === requestRef.current) {
        setLoading(false);
      }
    }
  }, [id, workspace?.businessId]);

  // revision ticks when Realtime reports a change in this workspace.
  useEffect(() => {
    void load();
  }, [load, revision]);

  /*
   * Older messages, one page at a time, as the agent scrolls back.
   *
   * Keyset paging on the oldest message held rather than an offset: new
   * messages arriving at the other end would shift every offset by one and
   * quietly skip or repeat a message in the middle.
   */
  const loadOlder = useCallback(async () => {
    if (!id || !cursor || !hasMore || loadingOlder) {
      return;
    }

    setLoadingOlder(true);

    try {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        beforeCreatedAt: cursor.sentAt,
        beforeId: cursor.id,
      });

      const data = await api<{
        messages: InboxMessage[];
        hasMore: boolean;
        nextCursor: { sentAt: string; id: string } | null;
      }>(
        `/api/conversations/${encodeURIComponent(id)}/messages?${query.toString()}`,
        workspace?.businessId,
      );

      setMessages((current) => mergeMessages(current, data.messages ?? []));
      setCursor(data.nextCursor ?? null);
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
  }, [cursor, hasMore, id, loadingOlder, workspace?.businessId]);

  /*
   * Marked read once per conversation, not on every realtime tick. The server
   * write is what counts; the local patch is only so the row loses its badge
   * without waiting for the next bootstrap.
   */
  useEffect(() => {
    if (!id || !conversation || readMarkedRef.current === id) {
      return;
    }

    if ((conversation.unread_count ?? 0) === 0) {
      readMarkedRef.current = id;
      return;
    }

    readMarkedRef.current = id;
    updateConversation(id, { unread_count: 0 });

    void api(
      `/api/conversations/${encodeURIComponent(id)}/read`,
      workspace?.businessId,
      { method: "PATCH" },
    ).catch(() => {
      // Leaving the badge cleared locally is the lesser wrong: the next
      // bootstrap restores the truth either way.
    });
  }, [id, conversation, workspace?.businessId, updateConversation]);

  // A clip that reached its end is no longer the one playing.
  useEffect(() => {
    if (playerStatus.didJustFinish) {
      setPlayingId(null);
    }
  }, [playerStatus.didJustFinish]);

  function toggleAudio(message: InboxMessage) {
    const url = message.attachment_url;

    if (!url) {
      return;
    }

    if (playingId === message.id) {
      if (playerStatus.playing) {
        player.pause();
      } else {
        player.play();
      }

      return;
    }

    setPlayingId(message.id);
    player.replace(url);
    player.play();
  }

  async function openReplies() {
    setReplyOpen(true);

    if (replies.length > 0) {
      return;
    }

    setRepliesLoading(true);

    try {
      const data = await api<{ savedReplies: SavedReply[] }>(
        "/api/saved-replies?activeOnly=true",
        workspace?.businessId,
      );

      setReplies(data.savedReplies ?? []);
    } catch (replyError) {
      setError(
        replyError instanceof Error
          ? replyError.message
          : "Unable to load quick replies.",
      );
    } finally {
      setRepliesLoading(false);
    }
  }

  /*
   * A quick reply's media has to come down before it can go back up: the
   * saved copy lives behind a signed link, and the send endpoints take an
   * upload, not a URL. Downloading to the cache is what the web does with a
   * blob, one step further because a phone has a filesystem to use.
   */
  async function pickReply(reply: SavedReply) {
    setDraft(reply.message_text);

    const withUrls = reply.attachments.filter((item) => item.url);

    if (withUrls.length === 0) {
      return;
    }

    const staged: Pending[] = [];

    for (const attachment of withUrls) {
      try {
        const safe = attachment.name.replace(/[^\w.-]+/g, "_").slice(-60) || "attachment";
        const target = new File(Paths.cache, `${Date.now()}-${safe}`);
        const saved = await File.downloadFileAsync(attachment.url as string, target);

        if (saved) {
          staged.push({
            key: `${reply.id}:${attachment.path}`,
            uri: saved.uri,
            name: attachment.name || safe,
            mimeType: attachment.mimeType || "application/octet-stream",
            kind: attachment.kind === "video" ? "video" : "image",
          });
        }
      } catch {
        // Counted below rather than thrown: one unreachable file should not
        // cost the agent the other three and the text.
      }
    }

    setPending((current) => [...current, ...staged]);

    if (staged.length < withUrls.length) {
      const missing = withUrls.length - staged.length;

      setError(
        `${missing} of this quick reply's ${withUrls.length} attachments could not be loaded. Check what is attached before sending.`,
      );
    }
  }

  async function pickMedia() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError("TENH needs permission to your photos to attach one.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      quality: 1,
    });

    if (result.canceled) {
      return;
    }

    setPending((current) => [
      ...current,
      ...result.assets.map((asset, index) => {
        const fallback = asset.type === "video" ? "video.mp4" : "photo.jpg";
        const name = asset.fileName || fallback;

        return {
          key: `${asset.assetId ?? asset.uri}:${index}`,
          uri: asset.uri,
          name,
          mimeType: asset.mimeType || (asset.type === "video" ? "video/mp4" : "image/jpeg"),
          kind: asset.type === "video" ? ("video" as const) : ("image" as const),
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
        kind: kindOf(asset.mimeType ?? "", asset.name ?? ""),
      })),
    ]);
  }

  async function upload(file: Pending) {
    const form = new FormData();

    form.append("conversationId", String(id));
    form.append("kind", file.kind);
    form.append("file", {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob);

    await api(
      platform === "telegram" ? "/api/telegram/send-media" : "/api/facebook/send-attachment",
      workspace?.businessId,
      { method: "POST", body: form },
    );
  }

  async function send() {
    const text = draft.trim();

    if ((!text && pending.length === 0) || !id || sending) {
      return;
    }

    setSending(true);
    setError("");

    try {
      /*
       * Text first, then the files in the order they were added. Messenger
       * has no caption field, so a picture and the sentence about it are two
       * messages either way -- this at least puts them in the order they
       * were written.
       */
      if (text) {
        await api(`/api/${platform}/send`, workspace?.businessId, {
          method: "POST",
          body: { conversationId: id, message: text },
        });

        setDraft("");
      }

      for (const file of pending) {
        await upload(file);

        setPending((current) => current.filter((item) => item.key !== file.key));
      }

      await load();
    } catch (sendError) {
      /*
       * Whatever has not gone yet is deliberately left in the box. Messenger
       * refuses sends outside its window and after a comment reply, and
       * losing what was typed to a policy error the agent cannot do anything
       * about would be its own bug.
       */
      setError(
        sendError instanceof ApiError
          ? sendError.message
          : "Unable to send. Check your connection and try again.",
      );

      await load();
    } finally {
      setSending(false);
    }
  }

  const loadCustomer = useCallback(async () => {
    if (!contactId) {
      return null;
    }

    setCustomerLoading(true);

    try {
      const data = await api<CustomerDetail>(
        `/api/customers/${encodeURIComponent(contactId)}`,
        workspace?.businessId,
      );

      setCustomer(data);
      setAssigned(new Set((data.customer.tags ?? []).map((tag) => tag.id)));

      return data;
    } catch (customerError) {
      setError(
        customerError instanceof Error
          ? customerError.message
          : "Unable to load this customer.",
      );

      return null;
    } finally {
      setCustomerLoading(false);
    }
  }, [contactId, workspace?.businessId]);

  async function openTags() {
    setTagOpen(true);
    setTagsLoading(true);

    try {
      const [tagList] = await Promise.all([
        api<{ tags: Tag[] }>("/api/tags?activeOnly=true", workspace?.businessId),
        loadCustomer(),
      ]);

      setTags(tagList.tags ?? []);
    } catch (tagError) {
      setError(
        tagError instanceof Error ? tagError.message : "Unable to load tags.",
      );
    } finally {
      setTagsLoading(false);
    }
  }

  async function toggleTag(tag: Tag) {
    if (!contactId || busyTagId) {
      return;
    }

    const on = assigned.has(tag.id);

    setBusyTagId(tag.id);
    setError("");

    // Moved first so the row answers the tap; put back if the server refuses.
    setAssigned((current) => {
      const next = new Set(current);

      if (on) {
        next.delete(tag.id);
      } else {
        next.add(tag.id);
      }

      return next;
    });

    try {
      if (on) {
        await api(
          `/api/contacts/${encodeURIComponent(contactId)}/tags/${encodeURIComponent(tag.id)}`,
          workspace?.businessId,
          { method: "DELETE" },
        );
      } else {
        await api(
          `/api/contacts/${encodeURIComponent(contactId)}/tags`,
          workspace?.businessId,
          { method: "POST", body: { tagId: tag.id, conversationId: id } },
        );
      }
    } catch (toggleError) {
      setAssigned((current) => {
        const next = new Set(current);

        if (on) {
          next.add(tag.id);
        } else {
          next.delete(tag.id);
        }

        return next;
      });

      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to change this tag.",
      );
    } finally {
      setBusyTagId(null);
    }
  }

  /*
   * Every one of these moves the row first and puts it back if the server
   * refuses. The list behind is the same object, so a status changed here
   * shows there before the request lands -- and un-shows if it fails.
   */
  async function runAction(
    key: string,
    patch: Record<string, unknown>,
    request: () => Promise<unknown>,
  ) {
    if (!id || !conversation || busyAction) {
      return false;
    }

    const before = Object.fromEntries(
      Object.keys(patch).map((field) => [
        field,
        (conversation as unknown as Record<string, unknown>)[field],
      ]),
    );

    setBusyAction(key);
    setError("");
    updateConversation(id, patch);

    try {
      await request();

      return true;
    } catch (actionError) {
      updateConversation(id, before);

      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to change this conversation.",
      );

      return false;
    } finally {
      setBusyAction(null);
    }
  }

  /*
   * One panel, so one open: the customer record and the team it can be
   * assigned to are fetched together rather than each waiting for its own
   * sheet to be tapped. The team is fetched once per visit; the customer
   * every time, because a tag added on another device should show.
   */
  /*
   * Phone and note, written back from the panel.
   *
   * The customer is reloaded rather than patched locally: the endpoint
   * normalises what it stores -- trimming, and turning an emptied field into
   * null -- and showing the agent their raw draft would quietly disagree with
   * what everybody else sees.
   */
  async function saveField(field: EditableField, value: string) {
    if (!contactId || busyAction) {
      return false;
    }

    setBusyAction(`field:${field}`);
    setError("");

    try {
      await api(
        `/api/contacts/${encodeURIComponent(contactId)}`,
        workspace?.businessId,
        {
          method: "PATCH",
          /*
           * The endpoint wants the conversation as well as the field. It logs
           * the edit against the thread it was made from, which is how the
           * customer timeline knows where a phone number came from.
           */
          body: { conversationId: id, [field]: value },
        },
      );

      await loadCustomer();

      return true;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save that.",
      );

      return false;
    } finally {
      setBusyAction(null);
    }
  }

  async function openPanel() {
    setPanelOpen(true);
    void loadCustomer();

    if (members.length > 0) {
      return;
    }

    setMembersLoading(true);

    try {
      const data = await api<{ members: TeamMember[] }>(
        "/api/team/members",
        workspace?.businessId,
      );

      setMembers(data.members ?? []);
    } catch (memberError) {
      setError(
        memberError instanceof Error
          ? memberError.message
          : "Unable to load the team.",
      );
    } finally {
      setMembersLoading(false);
    }
  }

  async function changeStatus(next: ConversationStatus) {
    if (conversation?.status === next) {
      return;
    }

    /*
     * The panel stays open. It did close when this was a sheet of nothing but
     * choices, but the panel is a record you read as well as act on, and
     * throwing it away because you resolved something is the wrong reflex.
     * The badge above the list changes where you can see it.
     */
    await runAction(`status:${next}`, { status: next }, () =>
      api(`/api/conversations/${encodeURIComponent(String(id))}/status`, workspace?.businessId, {
        method: "PATCH",
        body: { status: next },
      }),
    );
  }

  async function assign(memberId: string | null) {
    if ((conversation?.assigned_to ?? null) === memberId) {
      return;
    }

    await runAction(
      `assign:${memberId ?? "none"}`,
      { assigned_to: memberId },
      () =>
        api(
          `/api/conversations/${encodeURIComponent(String(id))}/assignment`,
          workspace?.businessId,
          { method: "PATCH", body: { assignedTo: memberId } },
        ),
    );
  }

  async function togglePin() {
    const next = !conversation?.is_pinned;

    await runAction("pin", { is_pinned: next }, () =>
      api(`/api/conversations/${encodeURIComponent(String(id))}/pin`, workspace?.businessId, {
        method: "PATCH",
        body: { isPinned: next },
      }),
    );
  }

  async function markUnread() {
    const done = await runAction("unread", { unread_count: 1 }, () =>
      api(`/api/conversations/${encodeURIComponent(String(id))}/unread`, workspace?.businessId, {
        method: "PATCH",
      }),
    );

    if (done) {
      /*
       * Leaving is the point of the action. Staying would put the screen
       * straight back into its mark-as-read effect the next time it mounts,
       * and the agent would wonder why the badge did not stick.
       */
      setPanelOpen(false);
      router.back();
    }
  }

  const canSend = !sending && (draft.trim().length > 0 || pending.length > 0);

  const swipe = useThreadSwipe(
    () => void openPanel(),
    Boolean(contactId) && !panelOpen,
  );

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={styles.header}>
        <View style={styles.row}>
          <IconButton icon="chevron-back" label="Back to inbox" onPress={() => router.back()} />

          {/*
            The same mark the list row wears, so the thread you opened is
            recognisably the row you tapped. Falls back to a plain avatar
            before the conversation has been found in the provider.
          */}
          {conversation ? (
            <ChannelAvatar conversation={conversation} size={38} />
          ) : (
            <Avatar name={name} size={38} />
          )}

          <View style={{ flex: 1, gap: 3 }}>
            <Text numberOfLines={1} style={styles.heading}>
              {name}
            </Text>

            {conversation ? <ChannelBadge conversation={conversation} /> : null}
          </View>

          {/*
            One control, because there is one panel now. Tags and status
            moved inside it -- three icons across a header this narrow left
            no room for the customer's name.
          */}
          <PanelButton disabled={!contactId} onPress={() => void openPanel()} />
        </View>
      </View>

      <ErrorNotice message={error} onRetry={() => void load()} />

      {/*
        Everything between the header and the composer answers a right-to-left
        swipe by pulling the panel in.
      */}
      <View style={{ flex: 1 }} {...swipe}>
      {loading && messages.length === 0 ? (
        <ThreadSkeleton />
      ) : messages.length === 0 ? (
        /*
         * Both of these have to claim the space the thread would have taken,
         * or the composer rides up under the header and the rest of the
         * screen is left blank below it.
         */
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Empty
            title="No messages yet"
            detail="Anything this customer sends will appear here."
          />
        </View>
      ) : (
        <FlatList
          inverted
          // Claims the space between header and composer whether there are
          // three messages or three hundred.
          style={{ flex: 1 }}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Bubble
              message={item}
              audio={{
                activeId: playingId,
                playing: playerStatus.playing,
                position: playerStatus.currentTime,
                duration: playerStatus.duration,
                onToggle: toggleAudio,
              }}
            />
          )}
          /*
           * Inverted, so the list's "end" is the top of the screen -- which
           * is where older messages belong. Half a screen of warning is
           * enough to have them by the time the agent gets there.
           */
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
      </View>

      {/*
        What is queued to go with the next send. Attachments are staged rather
        than sent on pick so a quick reply's text and its picture leave
        together, and so a wrong file can be taken back off.
      */}
      {pending.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10 }}
          style={{ maxHeight: 56, backgroundColor: "white" }}
        >
          {pending.map((file) => (
            <View
              key={file.key}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 11,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: colors.pale,
              }}
            >
              <Ionicons
                name={
                  file.kind === "image"
                    ? "image"
                    : file.kind === "video"
                      ? "videocam"
                      : "document"
                }
                size={15}
                color={colors.blue}
              />

              <Text numberOfLines={1} style={{ maxWidth: 140, color: colors.ink, fontSize: 12.5, fontWeight: "600" }}>
                {file.name}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${file.name}`}
                disabled={sending}
                hitSlop={8}
                onPress={() =>
                  setPending((current) => current.filter((item) => item.key !== file.key))
                }
              >
                <Ionicons name="close" size={14} color={colors.blue} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 4,
          padding: 12,
          paddingBottom: 12 + insets.bottom,
          backgroundColor: "white",
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <IconButton
          icon="attach-outline"
          label="Attach a photo, video or file"
          disabled={sending}
          onPress={() => setAttachOpen(true)}
        />

        <IconButton
          icon="flash-outline"
          label="Quick replies"
          disabled={sending}
          onPress={() => void openReplies()}
        />

        <TextInput
          value={draft}
          onChangeText={setDraft}
          style={[styles.input, { flex: 1, maxHeight: 120, marginLeft: 4 }]}
          placeholder="Write a reply…"
          placeholderTextColor={colors.muted}
          multiline
          editable={!sending}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          disabled={!canSend}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.button,
            {
              minWidth: 52,
              paddingHorizontal: 16,
              opacity: !canSend ? 0.4 : pressed ? 0.7 : 1,
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

      <AttachSheet
        open={attachOpen}
        onMedia={() => void pickMedia()}
        onFile={() => void pickFile()}
        onClose={() => setAttachOpen(false)}
      />

      <QuickReplySheet
        open={replyOpen}
        replies={replies}
        loading={repliesLoading}
        onPick={(reply) => void pickReply(reply)}
        onClose={() => setReplyOpen(false)}
      />

      <CustomerPanel
        open={panelOpen}
        detail={customer}
        loading={customerLoading}
        channelName={conversation?.social_account?.account_name ?? null}
        channelIcon={
          conversation && platformOf(conversation) === "telegram"
            ? "paper-plane"
            : conversation && platformOf(conversation) === "comment"
              ? "chatbox-ellipses"
              : "chatbubble-ellipses"
        }
        status={conversation?.status ?? null}
        pinned={Boolean(conversation?.is_pinned)}
        assignedTo={conversation?.assigned_to ?? null}
        members={members}
        membersLoading={membersLoading}
        currentMemberId={member?.id ?? null}
        busy={busyAction}
        onStatus={(next) => void changeStatus(next)}
        onAssign={(memberId) => void assign(memberId)}
        onPin={() => void togglePin()}
        onUnread={() => void markUnread()}
        onEditTags={() => void openTags()}
        onSaveField={saveField}
        error={panelOpen ? error : ""}
        onClose={() => setPanelOpen(false)}
      />

      <QuickTagSheet
        open={tagOpen}
        tags={tags}
        assigned={assigned}
        busyId={busyTagId}
        loading={tagsLoading}
        name={name}
        onToggle={(tag) => void toggleTag(tag)}
        onClose={() => setTagOpen(false)}
      />

    </KeyboardAvoidingView>
  );
}
