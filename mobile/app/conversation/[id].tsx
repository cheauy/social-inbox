import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { VideoView, useVideoPlayer } from "expo-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
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
  Empty,
  ErrorNotice,
  IconButton,
  Sheet,
  channel,
  colors,
  platformOf,
  styles,
  time,
} from "../../components/ui";
import { Composer } from "../../components/composer";
import { LocationPicker } from "../../components/location-picker";
import type { Pending } from "../../components/composer";
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
import {
  api,
  ApiError,
  upload as uploadNativeFile,
  uploadMany,
} from "../../lib/api/client";
import { CHAT_BASE_COLOR, useDisplay } from "../../lib/display-provider";
import { useInbox } from "../../lib/inbox-provider";
import { useMediaSource } from "../../lib/media";
import { AuthImage } from "../../components/auth-image";
import type {
  ConversationStatus,
  InboxConversation,
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
 * The day a message belongs to, and how to name it.
 *
 * Every bubble carried a clock and nothing else, so a thread that had been
 * going a fortnight read as one long day and 9:36 AM could have been this
 * morning or a week last Tuesday. Today and Yesterday by name because that is
 * how people say them; anything older gets its date, and anything from
 * another year gets the year too.
 */
const dayOf = (message: InboxMessage) => {
  const at = new Date(message.platform_created_at ?? message.created_at);

  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
};

function dayLabel(stamp: number) {
  const day = new Date(stamp);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((midnight.getTime() - stamp) / 86400000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";

  return day.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(day.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function DaySeparator({ label }: { label: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 12 }}>
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 5,
          borderRadius: 999,
          backgroundColor: colors.border,
        }}
      >
        <Text
          style={{ fontSize: 11.5, fontWeight: "800", color: colors.muted }}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

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

type Tag = {
  id: string;
  name: string;
  color: string | null;
};

function kindOf(mimeType: string, name: string): Pending["kind"] {
  const type = mimeType.toLowerCase();
  const extension = name.toLowerCase().split(".").pop() ?? "";

  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp"].includes(extension)) {
    return "image";
  }

  if (type.startsWith("video/") || ["mp4", "mov", "m4v", "3gp"].includes(extension)) {
    return "video";
  }

  if (type.startsWith("audio/") || ["mp3", "m4a", "aac", "wav", "ogg", "opus"].includes(extension)) {
    return "audio";
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
        gap: 9,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Ionicons name={playing ? "pause-circle" : "play-circle"} size={30} color={tint} />

      {/*
        Sized to the clip, not to a guess. It was a fixed 128-point track with
        the words "Voice message" under it, which made a two-second note as
        wide as a sentence and left a bubble that was mostly empty. The track
        is the width it needs and the time sits beside it.
      */}
      <View style={{ width: 96, height: 4, borderRadius: 2, backgroundColor: track }}>
        <View
          style={{
            width: `${progress * 100}%`,
            height: 4,
            borderRadius: 2,
            backgroundColor: tint,
          }}
        />
      </View>

      {/*
        Only once there is a time to show. A clip's length is not known until
        it has been loaded into the player, and printing 0:00 before then
        claims every unplayed voice note is empty.
      */}
      {active && duration > 0 ? (
        <Text
          style={{
            fontSize: 12,
            fontVariant: ["tabular-nums"],
            color: outgoing ? "rgba(255,255,255,0.85)" : colors.muted,
          }}
        >
          {clock(position)}
        </Text>
      ) : null}
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
function MessagePhoto({
  uri,
  onOpen,
}: {
  uri: string;
  onOpen: (uri: string) => void;
}) {
  const [ratio, setRatio] = useState(1);

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="View photo"
      onPress={() => onOpen(uri)}
    >
      <AuthImage
        uri={uri}
        onLoad={({ width, height }) => setRatio(width / height)}
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

type MediaPreview = {
  kind: "image" | "video";
  uri: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function words(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function facebookCommentId(message: InboxMessage) {
  const raw = record(message.raw_payload);
  return words(raw?.comment_id) ?? words(raw?.reply_comment_id) ?? message.platform_message_id?.trim() ?? null;
}

function facebookParentCommentId(message: InboxMessage) {
  const raw = record(message.raw_payload);
  return words(raw?.parent_comment_id) ?? words(record(raw?.comment)?.parent_id);
}

function messageMedia(message: InboxMessage): MediaPreview[] {
  const raw = record(message.raw_payload);
  const payloadMessage = record(raw?.message);
  const rawAttachments = Array.isArray(payloadMessage?.attachments)
    ? payloadMessage.attachments
    : Array.isArray(raw?.attachments)
      ? raw.attachments
      : [];
  const found = rawAttachments.flatMap((value): MediaPreview[] => {
    const item = record(value);
    const payload = record(item?.payload);
    const imageData = record(item?.image_data);
    const uri = words(payload?.url) ?? words(imageData?.url) ?? words(item?.url);
    const declared = words(item?.type)?.toLowerCase();

    if (!uri || (declared !== "image" && declared !== "video")) return [];
    return [{ kind: declared, uri }];
  });

  if (message.attachment_url && !found.some((item) => item.uri === message.attachment_url)) {
    found.unshift({
      kind: message.message_type === "video" ? "video" : "image",
      uri: message.attachment_url,
    });
  }

  return found;
}

function InlineVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.muted = true;
  });

  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const resolve = useMediaSource();
  const player = useVideoPlayer(resolve(uri) ?? uri, (instance) => {
    instance.play();
  });

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: "100%", height: "82%" }}
    />
  );
}

function MediaGrid({
  items,
  onOpen,
}: {
  items: MediaPreview[];
  onOpen: (item: MediaPreview) => void;
}) {
  const shown = items.slice(0, 9);
  const width = items.length === 1 ? 224 : items.length === 2 ? 224 : 228;
  const tile = items.length === 1 ? width : items.length === 2 ? 110 : 73;

  return (
    <View
      style={{
        width,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 4,
      }}
    >
      {shown.map((item, index) => (
        <Pressable
          key={`${item.uri}:${index}`}
          accessibilityRole="button"
          accessibilityLabel={`View ${item.kind}`}
          onPress={() => onOpen(item)}
          style={{
            width: tile,
            height: items.length === 1 ? 220 : tile,
            overflow: "hidden",
            borderRadius: items.length === 1 ? 13 : 8,
            backgroundColor: "#071421",
          }}
        >
          {item.kind === "video" ? (
            <>
              <InlineVideo uri={item.uri} />
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  inset: 0,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(3,10,20,.16)",
                }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.92)" }}>
                  <Ionicons name="play" size={19} color={colors.blue} />
                </View>
              </View>
            </>
          ) : (
            <AuthImage uri={item.uri} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
          )}

          {index === 8 && items.length > 9 ? (
            <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(16,34,56,.6)" }}>
              <Text style={{ color: "white", fontSize: 21, fontWeight: "800" }}>+{items.length - 9}</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function MessageText({ body, outgoing }: { body: string; outgoing: boolean }) {
  const parts = body.split(/(https?:\/\/[^\s]+)/gi);

  return (
    <Text style={{ color: outgoing ? "white" : colors.ink, fontSize: 15, lineHeight: 21 }}>
      {parts.map((part, index) =>
        /^https?:\/\//i.test(part) ? (
          <Text
            key={`${part}:${index}`}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(part)}
            style={{ color: outgoing ? "white" : colors.blue, textDecorationLine: "underline", fontWeight: "600" }}
          >
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

function CommentReplyRow({
  reply,
  conversation,
  onOpen,
  onReply,
  onAction,
  busy,
}: {
  reply: InboxMessage;
  conversation: InboxConversation;
  onOpen: (item: MediaPreview) => void;
  onReply: (message: InboxMessage) => void;
  onAction: (message: InboxMessage, action: "like" | "hide" | "delete") => void;
  busy: boolean;
}) {
  const raw = record(reply.raw_payload);
  const outgoing = reply.direction === "outgoing";
  const name = outgoing
    ? conversation.social_account?.account_name || "Facebook Page"
    : words(raw?.commenter_name) ?? conversation.contact?.full_name ?? "Facebook commenter";
  const picture = outgoing
    ? null
    : words(raw?.commenter_profile_picture_url) ?? conversation.contact?.profile_picture_url;
  const photo = reply.message_type === "image" ? reply.attachment_url : null;

  return (
    <View style={{ marginLeft: 48, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 }}>
      {reply.comment_is_deleted ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 4 }}>
          <Ionicons name="trash-outline" size={14} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 12.5, fontStyle: "italic" }}>
            Reply deleted by {reply.comment_deleted_by === "page" ? "Page" : "commenter"}
          </Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            <Avatar name={name} uri={picture} size={34} />
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.ink, fontSize: 13.5, fontWeight: "800" }}>{name}</Text>
              {outgoing ? (
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.pale }}>
                  <Text style={{ color: colors.blue, fontSize: 10, fontWeight: "800" }}>YOU</Text>
                </View>
              ) : null}
              <Text style={{ marginLeft: "auto", color: colors.muted, fontSize: 11 }}>{time(reply.platform_created_at ?? reply.created_at)}</Text>
            </View>
          </View>

          {reply.message_text?.trim() ? <MessageText body={reply.message_text.trim()} outgoing={false} /> : null}
          {photo ? <MessagePhoto uri={photo} onOpen={(uri) => onOpen({ kind: "image", uri })} /> : null}
          {reply.comment_is_hidden ? <Text style={{ color: "#9A5B00", fontSize: 11.5, fontWeight: "700" }}>Hidden on Facebook</Text> : null}

          <View style={{ flexDirection: "row", alignItems: "center", gap: 15, paddingBottom: 1 }}>
            {!outgoing ? (
              <>
                <Pressable disabled={reply.comment_is_hidden || busy} onPress={() => onReply(reply)} style={({ pressed }) => ({ opacity: reply.comment_is_hidden || busy ? 0.35 : pressed ? 0.55 : 1 })}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>Reply</Text>
                </Pressable>
                <Pressable disabled={busy} onPress={() => onAction(reply, "like")} style={({ pressed }) => ({ opacity: busy ? 0.35 : pressed ? 0.55 : 1 })}>
                  <Text style={{ color: reply.comment_is_liked ? colors.blue : colors.muted, fontSize: 12, fontWeight: "700" }}>{reply.comment_is_liked ? "Unlike" : "Like"}</Text>
                </Pressable>
                <Pressable disabled={busy} onPress={() => onAction(reply, "hide")} style={({ pressed }) => ({ opacity: busy ? 0.35 : pressed ? 0.55 : 1 })}>
                  <Text style={{ color: reply.comment_is_hidden ? "#C77700" : colors.muted, fontSize: 12, fontWeight: "700" }}>{reply.comment_is_hidden ? "Unhide" : "Hide"}</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable disabled={busy} onPress={() => onAction(reply, "delete")} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 4, opacity: busy ? 0.35 : pressed ? 0.55 : 1 })}>
              <Ionicons name="trash-outline" size={14} color={colors.muted} />
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>Delete</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function FacebookCommentCard({
  message,
  replies,
  conversation,
  onOpen,
  onReply,
  onAction,
  busyAction,
}: {
  message: InboxMessage;
  replies: InboxMessage[];
  conversation: InboxConversation;
  onOpen: (item: MediaPreview) => void;
  onReply: (message: InboxMessage) => void;
  onAction: (message: InboxMessage, action: "like" | "hide" | "delete") => void;
  busyAction: string | null;
}) {
  const raw = record(message.raw_payload);
  const savedPost = record(raw?.post);
  const preview = record(raw?.post_preview) ?? savedPost;
  const root =
    message.platform_message_id === conversation.facebook_comment_id ||
    words(raw?.comment_id) === conversation.facebook_comment_id;
  const postId =
    words(raw?.post_id) ??
    words(preview?.id) ??
    (root ? conversation.facebook_post_id : null);
  const postPhoto = words(preview?.full_picture);
  const postText = words(preview?.message);
  const postUrl = words(preview?.permalink_url) ?? (postId ? `https://facebook.com/${postId}` : null);
  const commenter = words(raw?.commenter_name) ?? conversation.contact?.full_name ?? "Facebook commenter";
  const commenterPhoto = words(raw?.commenter_profile_picture_url) ?? conversation.contact?.profile_picture_url;
  const commentPhoto = message.message_type === "image" ? message.attachment_url : null;

  if (message.comment_is_deleted) {
    return (
      <View style={{ paddingHorizontal: 14, paddingVertical: 5, alignItems: "flex-start" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(255,255,255,.9)" }}>
          <Ionicons name="trash-outline" size={16} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 13, fontStyle: "italic" }}>Comment deleted by {message.comment_deleted_by === "page" ? "Page" : "commenter"}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 6, alignItems: message.direction === "outgoing" ? "flex-end" : "flex-start" }}>
      <View style={{ width: 370, maxWidth: "96%", overflow: "hidden", borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(255,255,255,.97)" }}>
        {root && (postId || postPhoto || postText) ? (
          <View style={{ padding: 12, gap: 9, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: "#F8FBFE" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "#1877F2", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="logo-facebook" size={16} color="white" />
              </View>
              <Text style={{ flex: 1, color: colors.ink, fontSize: 13, fontWeight: "800" }} numberOfLines={1}>
                Comment on post{postId ? ` #${postId.split("_").pop()}` : ""}
              </Text>
            </View>

            <View style={{ flexDirection: postPhoto ? "row" : "column", gap: 11, alignItems: "flex-start" }}>
              {postPhoto ? (
                <Pressable onPress={() => onOpen({ kind: "image", uri: postPhoto })} style={{ width: 112, height: 112, overflow: "hidden", borderRadius: 12, backgroundColor: colors.border }}>
                  <Image source={{ uri: postPhoto }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                </Pressable>
              ) : null}
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ color: colors.ink, fontSize: 16, fontWeight: "800" }} numberOfLines={2}>
                  {conversation.social_account?.account_name || "Facebook Page"}
                </Text>
                {postText ? <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }} numberOfLines={5}>{postText}</Text> : null}
              </View>
            </View>
            {postUrl ? (
              <Pressable onPress={() => void Linking.openURL(postUrl)} style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: colors.blue, fontSize: 12.5, fontWeight: "800" }}>View post ↗</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={{ padding: 13, gap: 7 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            <Avatar name={commenter} uri={commenterPhoto} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.blue, fontSize: 10.5, fontWeight: "800" }}>FACEBOOK COMMENT</Text>
              <Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: "800" }} numberOfLines={1}>{commenter}</Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 11 }}>{time(message.platform_created_at ?? message.created_at)}</Text>
          </View>
          {message.message_text?.trim() ? <MessageText body={message.message_text.trim()} outgoing={false} /> : null}
          {commentPhoto ? <MessagePhoto uri={commentPhoto} onOpen={(uri) => onOpen({ kind: "image", uri })} /> : null}
          {message.comment_is_hidden ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Ionicons name="eye-off-outline" size={13} color="#C77700" />
              <Text style={{ color: "#9A5B00", fontSize: 11.5, fontWeight: "700" }}>Hidden on Facebook</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingTop: 2 }}>
            <Pressable
              accessibilityRole="button"
              disabled={message.comment_is_hidden || Boolean(busyAction)}
              onPress={() => onReply(message)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, opacity: message.comment_is_hidden || busyAction ? 0.35 : pressed ? 0.55 : 1 })}
            >
              <Ionicons name="chatbubble-outline" size={15} color={colors.muted} />
              <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: "700" }}>Reply</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={Boolean(busyAction)} onPress={() => onAction(message, "like")} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, opacity: busyAction ? 0.35 : pressed ? 0.55 : 1 })}>
              <Ionicons name={message.comment_is_liked ? "thumbs-up" : "thumbs-up-outline"} size={15} color={message.comment_is_liked ? colors.blue : colors.muted} />
              <Text style={{ color: message.comment_is_liked ? colors.blue : colors.muted, fontSize: 12.5, fontWeight: "700" }}>{message.comment_is_liked ? "Unlike" : "Like"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={Boolean(busyAction)} onPress={() => onAction(message, "hide")} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 5, opacity: busyAction ? 0.35 : pressed ? 0.55 : 1 })}>
              <Ionicons name={message.comment_is_hidden ? "eye-outline" : "eye-off-outline"} size={15} color={message.comment_is_hidden ? "#C77700" : colors.muted} />
              <Text style={{ color: message.comment_is_hidden ? "#C77700" : colors.muted, fontSize: 12.5, fontWeight: "700" }}>{message.comment_is_hidden ? "Unhide" : "Hide"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={Boolean(busyAction)} onPress={() => onAction(message, "delete")} style={({ pressed }) => ({ marginLeft: "auto", opacity: busyAction ? 0.35 : pressed ? 0.55 : 1 })}>
              <Ionicons name="trash-outline" size={16} color={colors.muted} />
            </Pressable>
          </View>

          {replies.map((reply) => (
            <CommentReplyRow
              key={reply.id}
              reply={reply}
              conversation={conversation}
              onOpen={onOpen}
              onReply={onReply}
              onAction={onAction}
              busy={Boolean(busyAction?.startsWith(`${reply.id}:`))}
            />
          ))}
        </View>
      </View>
    </View>
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
  commentReplies,
  audio,
  conversation,
  onViewMedia,
  onReplyComment,
  onCommentAction,
  commentBusy,
}: {
  message: InboxMessage;
  commentReplies: InboxMessage[];
  conversation: InboxConversation | null;
  onViewMedia: (item: MediaPreview) => void;
  onReplyComment: (message: InboxMessage) => void;
  onCommentAction: (message: InboxMessage, action: "like" | "hide" | "delete") => void;
  commentBusy: string | null;
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
  const raw = record(message.raw_payload);
  const attachmentMeta = record(raw?.tenh_attachment);
  const attachmentName = words(attachmentMeta?.name);
  const isComment =
    conversation?.source_type === "comment" &&
    Boolean(
      message.platform_message_id === conversation.facebook_comment_id ||
        words(raw?.comment_id) ||
        words(raw?.post_id) ||
        raw?.item === "comment" ||
        raw?.source === "facebook_comment_reply",
    );

  if (isComment && conversation) {
    return (
      <FacebookCommentCard
        message={message}
        replies={commentReplies}
        conversation={conversation}
        onOpen={onViewMedia}
        onReply={onReplyComment}
        onAction={onCommentAction}
        busyAction={commentBusy}
      />
    );
  }

  /*
   * The placeholder the webhook writes for a message that is only an
   * attachment. Once the attachment is drawn, repeating "[image]" under it
   * says nothing.
   */
  const text = message.message_text?.trim() ?? "";
  const isPlaceholder =
    /^\[(audio|voice|image|video|file|sticker)\]$/i.test(text) ||
    (Boolean(url) && /^sent (?:an? )?(?:photo|video|voice message|audio file|file(?::.*)?)$/i.test(text));
  const body = isPlaceholder ? "" : text;
  const media = type === "image" || type === "video" || type === "sticker" ? messageMedia(message) : [];

  /*
   * A sticker is the artwork, not text inside a card -- the same call the web
   * makes. Telegram, Messenger and WhatsApp all draw one straight onto the
   * conversation, because a sticker is a transparent cut-out and a coloured
   * bubble re-adds the rectangle the artist removed. On our blue outgoing
   * bubble its soft edge reads as a badly cropped photo.
   *
   * The bubble comes back the moment there is something to say: a caption, or
   * a deleted sticker that is now a line of text.
   */
  const bare = type === "sticker" && media.length > 0 && !body;

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
          backgroundColor: bare ? "transparent" : outgoing ? colors.blue : "white",
          borderRadius: 18,
          borderWidth: bare || outgoing ? 0 : 1,
          borderColor: colors.border,
          paddingHorizontal: bare ? 0 : type === "image" && url ? 6 : 14,
          paddingVertical: bare ? 0 : type === "image" && url ? 6 : 10,
          gap: 6,
        }}
      >
        {media.length > 0 ? (
          <MediaGrid items={media} onOpen={onViewMedia} />
        ) : null}

        {url && (type === "audio" || type === "voice") ? (
          <VoiceMessage
            outgoing={outgoing}
            active={audio.activeId === message.id}
            playing={audio.activeId === message.id && audio.playing}
            position={audio.position}
            duration={audio.duration}
            onToggle={() => audio.onToggle(message)}
          />
        ) : null}

        {url && !["image", "audio", "voice", "video", "sticker"].includes(type) ? (
          <MessageFile outgoing={outgoing} uri={url} label={attachmentName || "File"} icon="document" />
        ) : null}

        {body || !url ? (
          <View style={{ paddingHorizontal: media.length > 0 ? 8 : 0 }}>
            <MessageText body={body || "—"} outgoing={outgoing} />
          </View>
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
  /*
   * Grouped in the order the server sent them, which is the order the web
   * shows: a category appears where its first reply does, rather than
   * alphabetically, so the two read the same. Anything with no category
   * collects at the end under one heading instead of scattering.
   */
  const grouped = useMemo(() => {
    const byName = new Map<string, SavedReply[]>();

    for (const reply of replies) {
      const name = reply.category?.trim() || "Uncategorised";

      byName.set(name, [...(byName.get(name) ?? []), reply]);
    }

    const uncategorised = byName.get("Uncategorised");
    byName.delete("Uncategorised");

    const groups = [...byName.entries()].map(([name, list]) => ({
      name,
      replies: list,
    }));

    return uncategorised
      ? [...groups, { name: "Uncategorised", replies: uncategorised }]
      : groups;
  }, [replies]);

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
          {grouped.map((group) => (
            <View key={group.name}>
              {/*
                Categories, the way they are set on the web. A workspace with
                forty saved replies is unusable as one flat list, and the
                category is already on every row -- it was just being thrown
                away on the way in.
              */}
              <Text
                style={{
                  paddingHorizontal: 18,
                  paddingTop: 14,
                  paddingBottom: 4,
                  fontSize: 11,
                  fontWeight: "800",
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: colors.muted,
                }}
              >
                {group.name}
              </Text>

              {group.replies.map((reply) => (
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
            </View>
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
  error,
  name,
  onToggle,
  onClose,
}: {
  open: boolean;
  tags: Tag[];
  assigned: Set<string>;
  busyId: string | null;
  loading: boolean;
  error: string;
  name: string;
  onToggle: (tag: Tag) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      title="Add Tags"
      detail={`Choose tags for ${name}. Changes apply across every conversation.`}
      onClose={onClose}
    >
      {error ? <ErrorNotice message={error} /> : null}

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
        <ScrollView
          style={{ maxHeight: 420 }}
          contentContainerStyle={{ paddingVertical: 6 }}
          showsVerticalScrollIndicator={false}
        >
          {tags.map((tag) => {
            const on = assigned.has(tag.id);

            return (
              <Pressable
                key={tag.id}
                accessibilityRole="button"
                accessibilityLabel={`${on ? "Remove" : "Add"} ${tag.name} tag`}
                accessibilityState={{ selected: on }}
                disabled={busyId === tag.id}
                onPress={() => onToggle(tag)}
                style={({ pressed }) => ({
                  minHeight: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 20,
                  paddingVertical: 10,
                  backgroundColor: pressed ? colors.pale : "transparent",
                  opacity: busyId === tag.id ? 0.55 : pressed ? 0.72 : 1,
                })}
              >
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: tag.color ?? colors.blue,
                  }}
                />

                <Text
                  numberOfLines={1}
                  style={{
                    flex: 1,
                    color: colors.ink,
                    fontSize: 15,
                    fontWeight: on ? "700" : "500",
                  }}
                >
                  {tag.name}
                </Text>

                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: on ? 0 : 1.5,
                    borderColor: tag.color ?? colors.border,
                    backgroundColor: on
                      ? tag.color ?? colors.blue
                      : "white",
                  }}
                >
                  {on ? (
                    <Ionicons name="checkmark" size={16} color="white" />
                  ) : null}
                </View>
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
  const resolveMedia = useMediaSource();


  const {
    conversations,
    workspace,
    member,
    revision,
    updateConversation,
    updateContactTags,
  } = useInbox();

  // Whatever background this phone chose in Settings.
  const { backgroundUri } = useDisplay();

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
  const [replyingToComment, setReplyingToComment] = useState<InboxMessage | null>(null);
  const [commentBusy, setCommentBusy] = useState<string | null>(null);

  const [replyOpen, setReplyOpen] = useState(false);
  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [preparingReply, setPreparingReply] = useState(false);

  const [tagOpen, setTagOpen] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(() => new Set());
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
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
  const recipientId = conversation?.contact?.platform_user_id?.trim() ?? "";
  const tagCount = conversation?.contact?.tags?.length ?? 0;
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
    /*
     * Resolved the same way a picture is: a Telegram voice note is proxied
     * through TENH and needs the origin and the cookie, or the player gets a
     * 401 and sits at nought seconds forever.
     */
    player.replace(resolveMedia(url) ?? url);
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

    // Public Facebook comment replies are text-only. The saved words are
    // still useful, while silently attaching the saved photos would make the
    // eventual send fail Meta validation.
    if (replyingToComment) {
      return;
    }

    const withUrls = reply.attachments.filter((item) => item.url);

    if (withUrls.length === 0) {
      return;
    }

    setPreparingReply(true);
    const staged: Pending[] = [];

    try {
      for (const [index, attachment] of withUrls.entries()) {
        try {
          const safe = attachment.name.replace(/[^\w.-]+/g, "_").slice(-60) || "attachment";
          const target = new File(Paths.cache, `${Date.now()}-${index}-${safe}`);
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
    } finally {
      setPreparingReply(false);
    }
  }

  /*
   * Photos and video are separate choices now. They were one picker offering
   * both, which reads fine in a menu and badly in practice: an agent sending
   * a product shot had to notice that videos were also in there, and Android
   * shows a different, slower picker when both types are allowed.
   */
  async function pickFromLibrary(
    mediaTypes: ImagePicker.MediaType[],
    multiple: boolean,
  ) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError("TENH needs permission to your photos to attach one.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes,
      allowsMultipleSelection: multiple,
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

  /*
   * A recorded voice note joins the queue like any other attachment, so it
   * can go with a sentence rather than instead of one.
   */
  function stageVoice(uri: string, millis: number) {
    setPending((current) => [
      ...current,
      {
        key: `voice:${Date.now()}`,
        uri,
        name: `voice-message-${Math.round(millis / 1000)}s.m4a`,
        mimeType: "audio/mp4",
        kind: "audio" as const,
      },
    ]);
  }

  /*
   * Where this phone is, sent the way the web sends it.
   *
   * Telegram has a real location message and takes the coordinates. Messenger
   * has nothing of the kind, so it gets the same Google Maps link the web
   * writes into the reply box -- which is what a customer can actually open.
   */
  async function sendLocation({
    latitude,
    longitude,
  }: {
    latitude: number;
    longitude: number;
  }) {
    if (!id || sending) {
      return;
    }

    setSending(true);
    setError("");

    try {
      if (platform === "telegram") {
        await api("/api/telegram/send-location", workspace?.businessId, {
          method: "POST",
          body: { conversationId: id, latitude, longitude },
        });
      } else {
        await api("/api/facebook/send", workspace?.businessId, {
          method: "POST",
          body: {
            conversationId: id,
            message: `📍 Location: https://www.google.com/maps?q=${latitude},${longitude}`,
          },
        });
      }

      setMapOpen(false);
      await load();
    } catch (locationError) {
      setError(
        locationError instanceof ApiError
          ? locationError.message
          : "Unable to send that location.",
      );
    } finally {
      setSending(false);
    }
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

  async function uploadOne(file: Pending, caption = "") {
    const photoOrVideo = file.kind === "image" || file.kind === "video";
    const path =
      platform === "telegram"
        ? photoOrVideo
          ? "/api/telegram/send-photo"
          : "/api/telegram/send-media"
        : "/api/facebook/send-attachment";

    await uploadNativeFile(path, workspace?.businessId, file, {
      conversationId: String(id),
      kind: file.kind,
      ...(platform === "facebook" ? { recipientId } : {}),
      ...(caption ? { caption } : {}),
    });
  }

  async function uploadAlbum(files: Pending[], caption = "") {
    if (platform === "telegram") {
      await uploadMany(
        "/api/telegram/send-photo",
        workspace?.businessId,
        files.map((file) => ({ ...file, fieldName: "files" })),
        { conversationId: String(id), ...(caption ? { caption } : {}) },
      );
      return;
    }

    await uploadMany(
      "/api/facebook/send-attachment",
      workspace?.businessId,
      files.map((file, index) => ({
        ...file,
        fieldName: index === 0 ? "file" : "additionalFiles",
      })),
      { conversationId: String(id), recipientId, kind: "image" },
    );
  }

  function beginCommentReply(message: InboxMessage) {
    if (pending.length > 0) {
      setError("Remove the queued attachments before replying to a Facebook comment. Comment replies can only contain text.");
      return;
    }

    setError("");
    setReplyingToComment(message);
  }

  async function performCommentAction(
    message: InboxMessage,
    action: "like" | "hide" | "delete",
  ) {
    const commentId = facebookCommentId(message);
    if (!commentId || commentBusy) return;

    const before = new Map(messages.map((item) => [item.id, item]));
    const affectedIds = new Set(
      messages
        .filter(
          (item) =>
            item.id === message.id ||
            (action === "delete" && facebookParentCommentId(item) === commentId),
        )
        .map((item) => item.id),
    );
    const liked = !message.comment_is_liked;
    const hidden = !message.comment_is_hidden;
    setCommentBusy(`${message.id}:${action}`);
    setError("");

    setMessages((current) =>
      current.map((item) => {
        const isTarget = item.id === message.id;
        const isChild = action === "delete" && facebookParentCommentId(item) === commentId;
        if (!isTarget && !isChild) return item;
        if (action === "like" && isTarget) return { ...item, comment_is_liked: liked };
        if (action === "hide" && isTarget) return { ...item, comment_is_hidden: hidden };
        return { ...item, comment_is_deleted: true, comment_deleted_by: "page" as const };
      }),
    );

    try {
      await api(`/api/facebook/comments/${action}`, workspace?.businessId, {
        method: "POST",
        body: {
          commentId,
          ...(action === "like" ? { liked } : {}),
          ...(action === "hide" ? { hidden } : {}),
        },
      });
      if (action === "delete" && replyingToComment?.id === message.id) {
        setReplyingToComment(null);
      }
    } catch (actionError) {
      setMessages((current) =>
        current.map((item) =>
          affectedIds.has(item.id) ? before.get(item.id) ?? item : item,
        ),
      );
      setError(actionError instanceof Error ? actionError.message : `Unable to ${action} this comment.`);
    } finally {
      setCommentBusy(null);
    }
  }

  function requestCommentAction(
    message: InboxMessage,
    action: "like" | "hide" | "delete",
  ) {
    if (action !== "delete") {
      void performCommentAction(message, action);
      return;
    }

    Alert.alert(
      "Delete comment?",
      "This removes the comment and its replies from Facebook.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void performCommentAction(message, action) },
      ],
    );
  }

  function optimisticMessage(file: Pending, index: number, at: string): InboxMessage {
    return {
      id: `optimistic:inbox:${at}:${index}`,
      platform_message_id: `optimistic:inbox:${at}:${index}`,
      conversation_id: String(id),
      sender_type: "page",
      sender_platform_id: conversation?.social_account?.platform_account_id ?? "",
      recipient_platform_id: recipientId,
      direction: "outgoing",
      message_type: file.kind,
      message_text:
        file.kind === "image"
          ? "Sent a photo"
          : file.kind === "video"
            ? "Sent a video"
            : file.kind === "audio"
              ? "Sent a voice message"
              : `Sent a file: ${file.name}`,
      attachment_url: file.uri,
      raw_payload: { tenh_attachment: { name: file.name, type: file.kind, mime_type: file.mimeType } },
      platform_created_at: at,
      created_at: at,
      comment_is_liked: false,
      comment_is_hidden: false,
      comment_is_deleted: false,
      comment_deleted_by: null,
      delivery_status: null,
      delivered_at: null,
      seen_at: null,
    };
  }

  async function send() {
    const text = draft.trim();

    if ((!text && pending.length === 0) || !id || sending) {
      return;
    }

    if (replyingToComment) {
      const target = replyingToComment;
      const commentId = facebookCommentId(target);

      if (!text || !commentId || sending) return;
      if (pending.length > 0) {
        setError("Facebook comment replies can only contain text. Remove the queued attachments first.");
        return;
      }

      setSending(true);
      setError("");
      setDraft("");

      try {
        await api("/api/facebook/comments/reply", workspace?.businessId, {
          method: "POST",
          body: { conversationId: id, commentId, message: text },
        });
        setReplyingToComment(null);
        updateConversation(String(id), { last_message_text: text, last_message_at: new Date().toISOString() });
        await load();
      } catch (replyError) {
        setDraft((current) => current || text);
        setError(replyError instanceof Error ? replyError.message : "Unable to reply to this comment.");
      } finally {
        setSending(false);
      }

      return;
    }

    if (platform === "facebook" && !recipientId) {
      setError("This Facebook customer has no Messenger recipient ID. Refresh the Inbox and try again.");
      return;
    }

    const pendingSnapshot = [...pending];
    const sentFileKeys = new Set<string>();
    const sentAt = new Date().toISOString();
    const optimisticIds = pendingSnapshot.map((_, index) => `optimistic:inbox:${sentAt}:${index}`);
    const visualFiles = pendingSnapshot.filter((file) => file.kind === "image" || file.kind === "video");
    const telegramCaption = platform === "telegram" && visualFiles.length === pendingSnapshot.length && text.length <= 1024 ? text : "";
    const preview = text || (pendingSnapshot[0]?.kind === "audio" ? "You sent a voice message" : pendingSnapshot[0]?.kind === "video" ? "You sent a video" : pendingSnapshot[0]?.kind === "image" ? "You sent a photo" : pendingSnapshot[0] ? `You sent ${pendingSnapshot[0].name}` : "");

    setSending(true);
    setError("");
    setDraft("");
    setPending([]);
    if (pendingSnapshot.length > 0) {
      setMessages((current) => mergeMessages(current, pendingSnapshot.map((file, index) => optimisticMessage(file, index, sentAt))));
    }
    updateConversation(String(id), { last_message_text: preview, last_message_at: sentAt });

    try {
      /*
       * Text first, then the files in the order they were added. Messenger
       * has no caption field, so a picture and the sentence about it are two
       * messages either way -- this at least puts them in the order they
       * were written.
       */
      const canAlbum =
        visualFiles.length > 1 &&
        visualFiles.length === pendingSnapshot.length &&
        (platform === "telegram" || visualFiles.every((file) => file.kind === "image"));

      if (canAlbum) {
        await uploadAlbum(visualFiles, telegramCaption);
        visualFiles.forEach((file) => sentFileKeys.add(file.key));
      } else {
        for (const file of pendingSnapshot) {
          await uploadOne(file, platform === "telegram" && pendingSnapshot.length === 1 ? telegramCaption : "");
          sentFileKeys.add(file.key);
        }
      }

      if (text && !telegramCaption) {
        await api(`/api/${platform}/send`, workspace?.businessId, {
          method: "POST",
          body: {
            conversationId: id,
            message: text,
            ...(platform === "facebook" ? { recipientId } : {}),
          },
        });
      }

      setMessages((current) => current.filter((message) => !optimisticIds.includes(message.id)));
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

      setMessages((current) => current.filter((message) => !optimisticIds.includes(message.id)));
      setDraft((current) => current || text);
      setPending((current) => {
        const held = new Set(current.map((file) => file.key));
        return [
          ...pendingSnapshot.filter(
            (file) => !sentFileKeys.has(file.key) && !held.has(file.key),
          ),
          ...current,
        ];
      });

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

      /*
       * The conversation's own copy of the tags is caught up here too.
       *
       * It arrives with the bootstrap and only changes when this app changes
       * it, so a tag added from the web -- or from this phone in an earlier
       * session -- left the header badge and the list row saying one while
       * the panel said three. This is the freshest reading either of them
       * gets, so it is the one to trust.
       */
      updateContactTags(
        contactId,
        (data.customer.tags ?? []).map((tag) => ({
          id: tag.id,
          name: tag.name,
          // CustomerTag has a colour; the panel's copy allows null, and the
          // chip falls back to the same grey either way.
          color: tag.color ?? colors.muted,
        })),
      );

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
  }, [contactId, workspace?.businessId, updateContactTags]);

  async function openTags() {
    setError("");
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
    const previousConversationTags = conversation?.contact?.tags ?? [];
    const previousCustomerTags = customer?.customer.tags ?? [];
    const inboxTag = {
      id: tag.id,
      name: tag.name,
      color: tag.color ?? colors.muted,
    };
    const nextConversationTags = on
      ? previousConversationTags.filter((item) => item.id !== tag.id)
      : previousConversationTags.some((item) => item.id === tag.id)
        ? previousConversationTags
        : [...previousConversationTags, inboxTag];
    const nextCustomerTags = on
      ? previousCustomerTags.filter((item) => item.id !== tag.id)
      : previousCustomerTags.some((item) => item.id === tag.id)
        ? previousCustomerTags
        : [...previousCustomerTags, tag];

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

    if (contactId) {
      updateContactTags(contactId, nextConversationTags);
    }

    setCustomer((current) =>
      current
        ? {
            ...current,
            customer: { ...current.customer, tags: nextCustomerTags },
          }
        : current,
    );

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

      if (contactId) {
        updateContactTags(contactId, previousConversationTags);
      }

      setCustomer((current) =>
        current
          ? {
              ...current,
              customer: { ...current.customer, tags: previousCustomerTags },
            }
          : current,
      );

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

  const commentThreads = useMemo(() => {
    const byCommentId = new Map<string, InboxMessage>();
    const childrenByParent = new Map<string, InboxMessage[]>();
    const nestedIds = new Set<string>();

    for (const item of messages) {
      const commentId = facebookCommentId(item);
      if (commentId) byCommentId.set(commentId, item);
    }

    for (const item of messages) {
      const parentId = facebookParentCommentId(item);
      if (!parentId || !byCommentId.has(parentId)) continue;
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), item]);
      nestedIds.add(item.id);
    }

    const repliesByMessageId = new Map<string, InboxMessage[]>();
    for (const rootMessage of messages) {
      if (nestedIds.has(rootMessage.id)) continue;
      const rootId = facebookCommentId(rootMessage);
      if (!rootId) continue;

      const replies: InboxMessage[] = [];
      const visit = (parentId: string) => {
        for (const child of childrenByParent.get(parentId) ?? []) {
          replies.push(child);
          const childId = facebookCommentId(child);
          if (childId) visit(childId);
        }
      };
      visit(rootId);
      replies.sort((first, second) => sentAt(first) - sentAt(second));
      if (replies.length > 0) repliesByMessageId.set(rootMessage.id, replies);
    }

    return {
      messages: messages.filter((item) => !nestedIds.has(item.id)),
      repliesByMessageId,
    };
  }, [messages]);

  const swipe = useThreadSwipe(
    () => void openPanel(),
    Boolean(contactId) && !panelOpen,
  );

  return (
    <KeyboardAvoidingView
      style={[
        styles.screen,
        { paddingTop: insets.top, backgroundColor: CHAT_BASE_COLOR },
      ]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top}
    >
      {/*
        The wallpaper, behind everything. The header and the composer paint
        over it, exactly as the rail does on the web, so it shows where the
        bubbles are and nowhere else. Base colour underneath because a cold
        thread draws before a megabyte of PNG arrives, and bubbles have to be
        readable on that first frame.
      */}
      <Image
        source={{ uri: backgroundUri }}
        resizeMode="cover"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />

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

            {/*
              The page this conversation belongs to, not the word for the
              channel it came in on. An agent working three shops needs to
              know which one the customer wrote to; that it was Messenger is
              already on the avatar. Falls back to the channel name on a
              workspace whose page name has not reached the phone yet.
            */}
            {conversation ? (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                <Ionicons
                  name="storefront-outline"
                  size={13}
                  color={colors.muted}
                />

                <Text
                  numberOfLines={1}
                  style={{ fontSize: 12.5, color: colors.muted, flexShrink: 1 }}
                >
                  {conversation.social_account?.account_name?.trim() ||
                    channel(conversation)}
                  {conversation.contact?.platform_user_id
                    ? `  •  ID: ${conversation.contact.platform_user_id}`
                    : ""}
                </Text>
              </View>
            ) : null}
          </View>

          {/*
            The count comes off the conversation rather than the panel's copy
            of the customer, so it is right before the panel has ever been
            opened -- and toggling a tag patches the conversation in the
            provider, which is what makes it move the moment you tap.
          */}
          <IconButton
            icon="pricetags-outline"
            label={
              tagCount > 0
                ? `${tagCount} customer ${tagCount === 1 ? "tag" : "tags"}. Add or edit them.`
                : "Add customer tags"
            }
            badge={tagCount}
            disabled={!contactId}
            onPress={() => void openTags()}
          />

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
          data={commentThreads.messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => {
            /*
             * Inverted, so the next item in the array is the one above on
             * screen. When it belongs to an earlier day, this message is the
             * first of its own day and the separator goes above it.
             */
            const older = commentThreads.messages[index + 1];
            const startsADay = !older || dayOf(older) !== dayOf(item);

            return (
              <>
                <Bubble
                  message={item}
                  commentReplies={commentThreads.repliesByMessageId.get(item.id) ?? []}
                  conversation={conversation}
                  onViewMedia={setMediaPreview}
                  onReplyComment={beginCommentReply}
                  onCommentAction={requestCommentAction}
                  commentBusy={commentBusy}
                  audio={{
                    activeId: playingId,
                    playing: playerStatus.playing,
                    position: playerStatus.currentTime,
                    duration: playerStatus.duration,
                    onToggle: toggleAudio,
                  }}
                />

                {/*
                  After the bubble, not before it. An inverted list mirrors
                  each cell as well as the list, so the child drawn second is
                  the one that lands higher up the screen -- and a day's label
                  belongs above the first message of that day. Written the
                  natural way round, "Yesterday" sat underneath the message it
                  was labelling.
                */}
                {startsADay ? (
                  <DaySeparator label={dayLabel(dayOf(item))} />
                ) : null}
              </>
            );
          }}
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

      {replyingToComment ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#B9DDF1", backgroundColor: "#ECF8FF" }}>
          <Ionicons name="chatbubble-outline" size={17} color={colors.blue} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.blue, fontSize: 11, fontWeight: "800" }}>REPLYING TO FACEBOOK COMMENT</Text>
            <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 13 }}>{replyingToComment.message_text?.trim() || "Selected comment"}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel comment reply" onPress={() => setReplyingToComment(null)} hitSlop={10}>
            <Ionicons name="close" size={20} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      <Composer
        draft={draft}
        onDraftChange={setDraft}
        pending={pending}
        onRemovePending={(key) =>
          setPending((current) => current.filter((item) => item.key !== key))
        }
        sending={sending || preparingReply}
        bottomInset={insets.bottom}
        onPickImages={() => void pickFromLibrary(["images"], true)}
        onPickVideo={() => void pickFromLibrary(["videos"], false)}
        onPickFile={() => void pickFile()}
        onSendLocation={() => setMapOpen(true)}
        onQuickReplies={() => void openReplies()}
        onVoice={stageVoice}
        onSend={() => void send()}
        attachmentsDisabled={Boolean(replyingToComment)}
      />

      <QuickReplySheet
        open={replyOpen}
        replies={replies}
        loading={repliesLoading}
        onPick={(reply) => void pickReply(reply)}
        onClose={() => setReplyOpen(false)}
      />

      <LocationPicker
        open={mapOpen}
        sending={sending}
        onSend={(point) => void sendLocation(point)}
        onClose={() => setMapOpen(false)}
      />

      {/*
        A photo, full screen, in the app. Tapping one used to hand the URL to
        the browser, which meant leaving the conversation, waiting for Chrome,
        and coming back to a thread that had scrolled.
      */}
      <Modal
        visible={Boolean(mediaPreview)}
        transparent
        animationType="fade"
        onRequestClose={() => setMediaPreview(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.94)" }}>
          <Pressable
            accessibilityLabel="Close media viewer"
            onPress={() => setMediaPreview(null)}
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            {mediaPreview?.kind === "image" ? (
              <AuthImage
                uri={mediaPreview.uri}
                style={{ width: "100%", height: "100%" }}
                resizeMode="contain"
              />
            ) : mediaPreview?.kind === "video" ? (
              <VideoPreview key={mediaPreview.uri} uri={mediaPreview.uri} />
            ) : null}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close media viewer"
            onPress={() => setMediaPreview(null)}
            style={{ position: "absolute", top: insets.top + 12, right: 16, width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.16)" }}
          >
            <Ionicons name="close" size={24} color="white" />
          </Pressable>

        </View>
      </Modal>

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
        error={tagOpen ? error : ""}
        name={name}
        onToggle={(tag) => void toggleTag(tag)}
        onClose={() => setTagOpen(false)}
      />

    </KeyboardAvoidingView>
  );
}
