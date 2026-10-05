import { cachedRead } from "../../lib/api/read-cache";
import { useOwnedPanelRead } from "../../lib/use-owned-panel-read";
import { messageMedia, selectMessageAction, resolveMessageAction, type MessageActionSelection, type MessageMedia as MediaPreview } from "../../lib/message-action-selection";
import { reserveMessageDownload, completeMessageDownload, protectMessageDownloadShare, releaseMessageDownload, type MessageDownloadLease } from "../../lib/message-download-cache";
import { openInAppLink } from "../../components/in-app-browser";
import { latestCustomerChannel } from "../../../lib/inbox/latest-customer-channel";
import { PostWebView } from "../../components/post-webview";
import { PinnedMessageBar } from "../../components/pinned-message-bar";
import { messengerSourceTimeline } from "../../../lib/facebook/messenger-source";
import { MessengerSourceCard } from "../../components/messenger-source-card";
import { StickerPicker, type StickerChoice } from "../../components/sticker-picker";
import { randomUUID } from "expo-crypto";
import { getMessageActions, isMessagePinned, getReplyImageReference, inboxImageEndpoint } from "../../../lib/inbox/message-actions";
import { canReactToMessengerMessage, getMessengerReaction, MESSENGER_QUICK_REACTIONS, withMessengerReaction } from "../../../lib/facebook/message-reactions";
import { getTelegramReaction, TELEGRAM_QUICK_REACTIONS, telegramReactionTarget } from "../../../lib/telegram/message-reactions";
import { loadTelegramReactionCapability, canUseTelegramReaction, sendTelegramReaction, applyTelegramReactionState, type TelegramReactionCapability } from "../../lib/telegram-reactions";
import { Ionicons } from "@expo/vector-icons";
import { createAudioPlayer, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as ImagePicker from "expo-image-picker";
import { CachedVideo } from "../../components/cached-video";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type AccessibilityActionEvent,
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
import { WorkspaceStoragePicker } from "../../components/workspace-storage-picker";
import { attachStorageDrafts, beginStorageDraftSend, clearStorageDraftOwner, detachStorageDrafts, finishStorageDraftSend, reconcileStorageDrafts, removeStorageDraftFile, storageDraftOwner } from "../../lib/workspace-storage-drafts";
import { locationAttemptKey, readLocationAttempt, saveLocationAttempt, clearLocationAttempt, type LocationAttempt } from "../../lib/location-send-state";
import { LocationPicker } from "../../components/location-picker";
import type { Pending } from "../../components/composer";
import {
  CustomerPanel,
  PanelButton,
  useThreadSwipe,
} from "../../components/customer-panel";
import type {
  CustomerDetail,
  CustomerFile,
  EditableField,
  TeamMember,
  TimelineItem,
} from "../../components/customer-panel";
import {
  api,
  authSessionGeneration,
  cachedApi,
  threadPreviewKey,
  peekReadCache,
  storeReadCache,
  readCacheGeneration,
  clearReadCache,
  ApiError,
  upload as uploadNativeFile,
  uploadMany,
} from "../../lib/api/client";
import { CHAT_BASE_COLOR, useDisplay } from "../../lib/display-provider";
import { useInbox } from "../../lib/inbox-provider";
import { useAuth } from "../../lib/auth/provider";
import { useMediaSource } from "../../lib/media";
import { cacheMedia } from "../../lib/media-cache";
import { facebookPagePhoto } from "../../lib/facebook-page-photo";
import { MAX_PENDING_ATTACHMENTS, attachmentIssue, attachmentBatches, type SizedAttachment } from "../../lib/attachment-send-plan";
import { shrinkImage, fileSize } from "../../lib/shrink";

import { usePresence, useViewers } from "../../lib/presence";
import { AuthImage } from "../../components/auth-image";
import type {
  ConversationStatus,
  InboxConversation,
  InboxMessage,
  SavedReply,
  SavedReplyAttachment,
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
type ThreadCursor = { sentAt: string; id: string };
type ThreadPage = { messages: InboxMessage[]; hasMore: boolean; nextCursor: ThreadCursor | null };

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
/*
 * A name for a downloaded file when the payload does not carry one.
 *
 * Android decides what a file is by its extension, so a photo saved without
 * one lands in the gallery as an unopenable blob.
 */
function extensionFor(message: InboxMessage, uri: string) {
  const fromUrl = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(uri)?.[1];

  if (fromUrl) return `.${fromUrl.toLowerCase()}`;

  if (message.message_type === "video") return ".mp4";
  if (message.message_type === "audio" || message.message_type === "voice") {
    return ".m4a";
  }

  return ".jpg";
}

/*
 * The extension a mime type wants, for a file that arrived without one.
 *
 * Android decides what a file is by its name, and so does the upload: the
 * server reads the part's mime type and refuses an album whose parts are not
 * all image/*. A name with no extension is an octet-stream, and an
 * octet-stream is a failed send.
 */
function extensionForMime(mimeType: string | null | undefined, kind: string) {
  const type = (mimeType ?? "").toLowerCase();

  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";
  if (type.startsWith("image/")) return ".jpg";
  if (type === "video/quicktime") return ".mov";
  if (type.startsWith("video/")) return ".mp4";

  return kind === "video" ? ".mp4" : ".jpg";
}

/* A file size somebody can read: 240 KB, 1.8 MB. */
function readableSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
/*
 * How long a voice note is, before anybody plays it.
 *
 * Telegram says so in the update -- tenh_attachment.duration, in seconds --
 * and that is free. Facebook says nothing at all, so the clip is opened by a
 * player that never plays it, asked how long it is, and thrown away. It costs
 * one metadata read per voice note on screen and it means the bubble can say
 * "0:14" the moment it draws, which is the thing somebody uses to decide
 * whether they have time to listen right now.
 */
function useClipSeconds(uri: string | null, hint: number) {
  const [seconds, setSeconds] = useState(hint);

  useEffect(() => {
    if (hint > 0) {
      setSeconds(hint);
      return;
    }

    if (!uri) return;

    let alive = true;
    let player: ReturnType<typeof createAudioPlayer> | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    try {
      player = createAudioPlayer(uri);
    } catch {
      /* A clip that will not open has no length to report; the bubble simply
         shows no time, exactly as it did before. */
      return;
    }

    /*
     * Polled rather than awaited: duration is filled in when the header has
     * been read, and there is no promise to wait on. Given up on after four
     * seconds so a dead CDN link cannot leave an interval running.
     */
    let waited = 0;

    timer = setInterval(() => {
      waited += 250;

      const value = player?.duration ?? 0;

      if (value > 0) {
        if (alive) setSeconds(value);
        clearInterval(timer);
        player?.remove();
        player = null;
      } else if (waited >= 4000) {
        clearInterval(timer);
        player?.remove();
        player = null;
      }
    }, 250);

    return () => {
      alive = false;
      clearInterval(timer);
      player?.remove();
    };
  }, [uri, hint]);

  return seconds;
}

/*
 * A voice note.
 *
 * The old one was a small play glyph, a fixed 96-point rule and a time that
 * only appeared once you pressed play -- so an unplayed note was a blue
 * lozenge with a line through it, the same width whether it held two seconds
 * or two minutes, and the only way to find out which was to listen to it.
 *
 * This one leads with a play button big enough to hit without looking, draws
 * the clip as a waveform whose bars fill as it plays, and prints the length
 * from the moment it arrives -- counting down to nought while playing, which
 * is what tells you how much is left rather than how much is gone. The whole
 * thing is sized to its content, so the bubble is as wide as the control and
 * not a point wider.
 */
function VoiceMessage({
  outgoing,
  active,
  playing,
  position,
  duration,
  uri,
  hintSeconds,
  onToggle,
  onHold,
}: {
  outgoing: boolean;
  active: boolean;
  playing: boolean;
  position: number;
  duration: number;
  uri: string | null;
  hintSeconds: number;
  onToggle: () => void;
  onHold?: MessageHold;
}) {
  const known = useClipSeconds(uri, hintSeconds);

  /* While it is playing the player is the authority; otherwise the metadata. */
  const total = active && duration > 0 ? duration : known;
  const progress = active && total > 0 ? Math.min(1, position / total) : 0;
  const remaining = active && total > 0 ? Math.max(0, total - position) : total;

  const tint = outgoing ? "white" : colors.blue;
  const idle = outgoing ? "rgba(255,255,255,0.42)" : "#C7DCEA";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        playing
          ? "Pause voice message"
          : `Play voice message${total > 0 ? `, ${clock(total)}` : ""}`
      }
      onPress={onToggle}
      {...messageHoldHandlers(onHold)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: outgoing ? "rgba(255,255,255,0.22)" : colors.pale,
        }}
      >
        <Ionicons
          name={playing ? "pause" : "play"}
          size={19}
          color={tint}
          /* Nudged, because a triangle's visual centre is left of its box. */
          style={{ marginLeft: playing ? 0 : 2 }}
        />
      </View>

      <View style={{ gap: 5 }}>
        {/*
          A waveform rather than a rule. Fixed bars from a fixed pattern --
          the real amplitudes are not in the payload and downloading a clip to
          draw them would cost more than it tells anybody -- but it reads as
          speech, and the filled part is the honest bit: it is the position.
        */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2.5 }}>
          {WAVE.map((height, index) => (
            <View
              key={index}
              style={{
                width: 2.5,
                height,
                borderRadius: 2,
                backgroundColor:
                  index / WAVE.length <= progress ? tint : idle,
              }}
            />
          ))}
        </View>

        <Text
          style={{
            fontSize: 11.5,
            fontVariant: ["tabular-nums"],
            color: outgoing ? "rgba(255,255,255,0.85)" : colors.muted,
          }}
        >
          {remaining > 0 ? clock(remaining) : "Voice message"}
        </Text>
      </View>
    </Pressable>
  );
}

/*
 * The shape of the bars. Twenty-eight of them at about 130 points, which is
 * the width of two words of a message bubble -- wide enough to see the
 * position move, narrow enough that a voice note does not take a whole row of
 * the thread.
 */
const WAVE = [
  7, 11, 16, 22, 14, 9, 13, 19, 26, 17, 10, 14, 21, 27, 18, 12, 8, 15, 23, 16,
  10, 13, 20, 25, 15, 9, 12, 7,
];

/*
 * What became of a message we sent.
 *
 * Messenger reports back: delivered when it reaches the phone, seen when the
 * customer opens it, and TENH writes both onto the row. Telegram's Bot API
 * reports neither for a private chat -- a bot is told the message was
 * accepted and nothing after that -- so a Telegram message says "Sent" and
 * stops, rather than claiming a delivery nobody confirmed.
 */
function receipt(message: InboxMessage, conversation: InboxConversation | null) {
  if (conversation && platformOf(conversation) === "telegram") {
    return "✓ Sent";
  }

  if (message.delivery_status === "seen" || message.seen_at) return "✓✓ Seen";
  if (message.delivery_status === "delivered" || message.delivered_at) {
    return "✓✓ Delivered";
  }

  return "✓ Sent";
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

type MessageHold = (at: { x: number; y: number }) => void;

// Child controls own their responder. Their hold opens the same menu without
// capturing taps or preventing ScrollView from cancelling a moving gesture.
function messageHoldHandlers(onHold?: MessageHold) {
  if (!onHold) return {};
  return {
    delayLongPress: 220,
    accessibilityHint: "Hold for message actions",
    accessibilityActions: [{ name: "longpress" as const, label: "Message actions" }],
    onLongPress: (event: GestureResponderEvent) => {
      if (event.isPropagationStopped?.()) return;
      event.stopPropagation();
      onHold({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
    },
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName !== "longpress") return;
      event.stopPropagation();
      onHold({ x: Dimensions.get("window").width / 2, y: 120 });
    },
  };
}

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

function InlineVideo({ uri }: { uri: string }) {
  return <View accessibilityLabel="Video — tap to play" style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center", backgroundColor: "#e8f1f6" }}><Ionicons name="videocam-outline" size={32} color="#6D7E91" /></View>;
}

function VideoPreview({ uri }: { uri: string }) {
  return <CachedVideo uri={uri} style={{ width: "100%", height: "82%" }} />;
}

function MediaGrid({
  items,
  onOpen,
  onHold,
  sticker = false,
}: {
  items: MediaPreview[];
  onOpen: (item: MediaPreview) => void;
  onHold?: (item: MediaPreview, at: { x: number; y: number }) => void;
  sticker?: boolean;
}) {
  const shown = items;
  const width = sticker ? 128 : items.length === 1 ? 224 : items.length === 2 ? 224 : 228;
  const tile = sticker ? 128 : items.length === 1 ? width : items.length === 2 ? 110 : 73;

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
          accessibilityLabel={`View ${item.kind}${items.length > 1 ? ` ${index + 1} of ${items.length}` : ""}`}
          onPress={() => onOpen(item)}
          {...messageHoldHandlers(onHold ? at => onHold(item, at) : undefined)}
          style={{
            width: tile,
            height: sticker ? 128 : items.length === 1 ? 220 : tile,
            overflow: "hidden",
            borderRadius: sticker ? 0 : items.length === 1 ? 13 : 8,
            backgroundColor: sticker ? "transparent" : "#071421",
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
            <AuthImage uri={item.uri} style={{ width: "100%", height: "100%" }} resizeMode={sticker ? "contain" : "cover"} />
          )}

        </Pressable>
      ))}
    </View>
  );
}

function MessageText({ body, outgoing, onHold }: { body: string; outgoing: boolean; onHold?: MessageHold }) {
  const parts = body.split(/(https?:\/\/[^\s]+)/gi);

  return (
    <Text style={{ color: outgoing ? "white" : colors.ink, fontSize: 15, lineHeight: 21 }}>
      {parts.map((part, index) =>
        /^https?:\/\//i.test(part) ? (
          <Text
            key={`${part}:${index}`}
            accessibilityRole="link"
            onPress={() => void openInAppLink(part)}
            {...messageHoldHandlers(onHold)}
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
    ? facebookPagePhoto(conversation.social_account?.platform_account_id)
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
              <Avatar name={conversation.social_account?.account_name || "Facebook Page"} uri={facebookPagePhoto(conversation.social_account?.platform_account_id)} size={30} />
              <Text style={{ flex: 1, color: colors.ink, fontSize: 13, fontWeight: "800" }} numberOfLines={1}>
                Comment on post{postId ? ` #${postId.split("_").pop()}` : ""}
              </Text>
            </View>

            <View style={{ flexDirection: postPhoto ? "row" : "column", gap: 11, alignItems: "flex-start" }}>
              {postPhoto ? (
                <Pressable onPress={() => onOpen({ kind: "image", uri: postPhoto })} style={{ width: 112, height: 112, overflow: "hidden", borderRadius: 12, backgroundColor: colors.border }}>
                  <AuthImage uri={postPhoto} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
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
              <Pressable onPress={() => void openInAppLink(postUrl)} style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
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
  onHold,
}: {
  outgoing: boolean;
  uri: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onHold?: MessageHold;
}) {
  const tint = outgoing ? "white" : colors.blue;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${label.toLowerCase()}`}
      onPress={() => void openInAppLink(uri)}
      {...messageHoldHandlers(onHold)}
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
  pageReactionOverride,
  quoteMessages,
  onViewMedia,
  onReplyComment,
  onCommentAction,
  onHold,
  commentBusy,
}: {
  message: InboxMessage;
  commentReplies: InboxMessage[];
  conversation: InboxConversation | null;
  pageReactionOverride?: { emoji: string | null };
  quoteMessages?: readonly InboxMessage[];
  onViewMedia: (item: MediaPreview) => void;
  onReplyComment: (message: InboxMessage) => void;
  onCommentAction: (message: InboxMessage, action: "like" | "hide" | "delete") => void;
  onHold: (message: InboxMessage, at: { x: number; y: number }, media?: MediaPreview) => void;
  commentBusy: string | null;
  audio: {
    activeId: string | null;
    playing: boolean;
    position: number;
    duration: number;
    onToggle: (message: InboxMessage) => void;
  };
}) {
  const hold: MessageHold = at => onHold(message, at);
  const outgoing = message.direction === "outgoing";
  const url = message.attachment_url;
  const type = message.message_type;
  const raw = record(message.raw_payload);
  const reactions: { actor: string; emoji: string }[] = (["page", "customer"] as const).flatMap(actor => {
    const emoji = actor === "page" && pageReactionOverride ? pageReactionOverride.emoji : getMessengerReaction(message.raw_payload, actor)?.emoji;
    return emoji ? [{ actor, emoji }] : [];
  });
  const botReaction = getTelegramReaction(message.raw_payload), botTarget = telegramReactionTarget(message);
  const ownedBotReaction = botReaction && botTarget && botReaction.chatId === botTarget.chatId && botReaction.groupKey === botTarget.groupKey ? botReaction : null;
  if (ownedBotReaction?.status === "confirmed" && ownedBotReaction.emoji) reactions.push({ actor: "bot", emoji: ownedBotReaction.emoji });
  const storedQuote = record(raw?.tenh_reply);
  const nativeMessage = record(raw?.message);
  const nativeTelegramQuote = record(nativeMessage?.reply_to_message ?? raw?.reply_to_message);
  const telegramChatId = /^telegram:([^:]+):/.exec(message.platform_message_id ?? "")?.[1];
  const nativeQuoteMid = words(record(nativeMessage?.reply_to ?? raw?.reply_to)?.mid) ??
    (telegramChatId && nativeTelegramQuote?.message_id != null ? `telegram:${telegramChatId}:${nativeTelegramQuote.message_id}` : null);
  // Native reply identity wins. Discard the ENTIRE conflicting saved context,
  // including its text/index/type, before resolving or labelling any image.
  const savedQuote = nativeQuoteMid && storedQuote && words(storedQuote.reply_to_platform_message_id) !== nativeQuoteMid ? null : storedQuote;
  const quoteMessage = storedQuote && !savedQuote ? { ...message, raw_payload: { ...raw, tenh_reply: undefined } } : message;
  const quotedText = raw?.tenh_reply_fallback ? null : words(savedQuote?.preview_text);
  // Resolve the selected image through the authorized endpoint. Saved URLs
  // can expire or be forged; never fetch one directly or substitute photo 1.
  const expectedQuoteMid = nativeQuoteMid ?? words(savedQuote?.reply_to_platform_message_id);
  const savedQuoteId = words(savedQuote?.reply_to_local_message_id);
  const quoteRows = quoteMessages ?? [];
  const quoteIdentityMismatch = quoteRows.some(row => row.id === savedQuoteId &&
    (row.conversation_id !== message.conversation_id || !expectedQuoteMid || row.platform_message_id !== expectedQuoteMid));
  const quoteImage = !quoteIdentityMismatch && !raw?.tenh_reply_fallback && (savedQuote || record(raw?.message)?.reply_to_message || record(raw?.message)?.reply_to || raw?.reply_to_message || raw?.reply_to)
    ? getReplyImageReference(quoteMessage, quoteMessages ?? []) : null;
  const quoteIndex = quoteImage ? quoteImage.photoIndex : savedQuote?.preview_image_index;
  const validQuoteIndex = Number.isSafeInteger(quoteIndex) && Number(quoteIndex) >= 0 && Number(quoteIndex) <= 100;
  const invalidSavedQuoteIndex = savedQuote?.preview_image_index != null && !validQuoteIndex;
  // Resolve by immutable provider ID even when the local row is loaded. An ID
  // lookup alone can return replacement media if that row changes before fetch.
  // The existing endpoint also scopes this lookup to the authorized conversation.
  const quoteImageUri = quoteImage?.platformMessageId && !invalidSavedQuoteIndex && (quoteImage.photoIndex == null || validQuoteIndex)
    ? inboxImageEndpoint({ ...quoteImage, messageId: null }, true) : null;
  const hasPhotoQuote = !raw?.tenh_reply_fallback && Boolean(quoteImage || ["image", "photo"].includes(String(savedQuote?.preview_type)));
  const quotePhotoLabel = hasPhotoQuote ? `Photo${validQuoteIndex ? ` ${Number(quoteIndex) + 1}` : ""}${quoteImageUri ? "" : " unavailable"}` : null;
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
    (Boolean(url) && /^sent (?:an? )?(?:photo|video|sticker|voice message|audio file|file(?::.*)?)$/i.test(text));
  const body = isPlaceholder ? "" : text;
  const media = type === "image" || type === "video" || type === "sticker" ? messageMedia(message) : [];

  /*
   * A sticker is the artwork, not text inside a card -- the same call the web
   * makes. Telegram, Messenger and WhatsApp all draw one straight onto the
   * conversation, because a sticker is a transparent cut-out and a coloured
   * bubble re-adds the rectangle the artist removed. On our blue outgoing
   * bubble its soft edge reads as a badly cropped photo.
   *
   * Captions stay readable below the artwork. Deleted stickers use the
   * separate deleted-message rendering below.
   */
  const bare = type === "sticker" && media.length > 0;

  /*
   * Still on its way. Optimistic messages are the ones this screen drew
   * itself the moment send was pressed; they are replaced by the real row
   * when the thread reloads, and dropped if the send fails.
   */
  const pending = message.id.startsWith("optimistic:");

  /*
   * A message that is gone, however it went.
   *
   * Three things end a message and they were reported three ways: Telegram
   * writes tenh_deleted into the payload, a deleted Facebook comment flips
   * comment_is_deleted, and a Page unsending a Messenger message leaves the
   * row with its text replaced. Only comments were drawn as deleted -- the
   * other two kept the ordinary bubble, so "Message deleted by Page" arrived
   * in the same blue as a real reply and read like something the Page had
   * just said.
   */
  const deleted =
    Boolean(raw?.tenh_deleted) ||
    message.comment_is_deleted === true ||
    /^message deleted( by .+)?$/i.test(body);

  if (deleted) {
    return (
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 4,
          alignItems: outgoing ? "flex-end" : "flex-start",
        }}
      >
        {/*
          The same grey on both sides, and nothing to hold: a deleted message
          is not somebody speaking, so it wears neither speaker's colour, and
          there is nothing left to reply to, copy or save.
        */}
        <View
          style={{
            maxWidth: "82%",
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: 16,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: colors.border,
            backgroundColor: "rgba(246,248,252,0.92)",
          }}
        >
          <Ionicons name="trash-outline" size={14} color={colors.muted} />

          <Text
            style={{
              flexShrink: 1,
              fontSize: 13,
              fontStyle: "italic",
              color: colors.muted,
            }}
          >
            {/^message deleted/i.test(body) ? body : "Message deleted"}
          </Text>

          <Text style={{ fontSize: 11, color: colors.muted }}>
            {time(message.platform_created_at ?? message.created_at)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingTop: 4,
        paddingBottom: reactions.length ? 20 : 4,
        alignItems: outgoing ? "flex-end" : "flex-start",
      }}
    >
      {/*
        Hold a message to act on it.

        Everything you can do to one used to be somewhere else: copying a
        price meant selecting text that is not selectable, saving a photo
        meant opening it and finding the browser, and quoting a message was
        not possible at all. A long press is the gesture every chat app has
        taught, and it costs the bubble nothing -- a tap still opens a photo.
      */}
      <Pressable
        {...messageHoldHandlers(hold)}
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
        {quotedText || hasPhotoQuote ? <View style={{ alignSelf: "stretch", borderLeftWidth: 3, borderLeftColor: outgoing && !bare ? "#a9e4ff" : colors.blue, backgroundColor: outgoing && !bare ? "rgba(0,38,76,0.18)" : "#edf5fa", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 3, flexDirection: "row", alignItems: "center", gap: 8 }}>
          {quoteImageUri ? <AuthImage key={quoteImageUri} uri={quoteImageUri} style={{ width: 40, height: 40, borderRadius: 6 }} resizeMode="cover" /> : hasPhotoQuote ? <Ionicons name="image-outline" size={20} color={outgoing && !bare ? "white" : colors.muted} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", marginBottom: quotedText ? 3 : 0, color: outgoing && !bare ? "#d4f1ff" : colors.blue }}>{quotePhotoLabel ? `Replying to ${quotePhotoLabel}` : "Replying to message"}</Text>
            {quotedText ? <Text numberOfLines={3} style={{ fontSize: 13, lineHeight: 19, color: outgoing && !bare ? "white" : colors.ink }}>{quotedText}</Text> : null}
          </View>
        </View> : null}
        {media.length > 0 ? (
          <MediaGrid items={media} onOpen={onViewMedia} onHold={(item, at) => onHold(message, at, item)} sticker={type === "sticker"} />
        ) : null}

        {url && (type === "audio" || type === "voice") ? (
          <VoiceMessage
            outgoing={outgoing}
            active={audio.activeId === message.id}
            playing={audio.activeId === message.id && audio.playing}
            position={audio.position}
            duration={audio.duration}
            uri={url}
            /* Telegram declares the length; Facebook does not. */
            hintSeconds={
              typeof attachmentMeta?.duration === "number"
                ? attachmentMeta.duration
                : 0
            }
            onToggle={() => audio.onToggle(message)}
            onHold={hold}
          />
        ) : null}

        {isMessagePinned(message) ? <Text style={{ fontSize: 11, color: outgoing && !bare ? "white" : colors.muted }}>📌 Pinned</Text> : null}


        {url && !["image", "audio", "voice", "video", "sticker"].includes(type) ? (
          <MessageFile outgoing={outgoing} uri={url} label={attachmentName || "File"} icon="document" onHold={hold} />
        ) : null}

        {body || !url ? (
          <View style={{ paddingHorizontal: media.length > 0 ? 8 : 0 }}>
            <MessageText body={body || "—"} outgoing={outgoing && !bare} onHold={hold} />
          </View>
        ) : null}

        {/*
          The time, or "Sending" while it is still on its way.

          A message that has left the box but not yet reached Facebook has no
          time worth printing -- it would be the moment the send button was
          pressed, shown as though the customer already had it. On a slow
          connection that is the difference between "it is going" and "did
          that send?", which is the question that makes somebody send it
          twice.
        */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            alignSelf: "flex-end",
            paddingHorizontal: type === "image" && url ? 8 : 0,
          }}
        >
          {pending ? (
            <Ionicons
              name="time-outline"
              size={11}
              color={outgoing && !bare ? "rgba(255,255,255,0.75)" : colors.muted}
            />
          ) : null}

          <Text
            style={{
              fontSize: 11,
              color: outgoing && !bare ? "rgba(255,255,255,0.75)" : colors.muted,
            }}
          >
            {pending
              ? "Sending…"
              : time(message.platform_created_at ?? message.created_at)}
          </Text>

          {/*
            What happened to it after it left, on our own messages only.
            The same three the website shows, and the same reasoning behind
            them: Telegram's Bot API gives a bot no delivery or read receipts
            for a private chat, so a Telegram message can only ever honestly
            say it was sent.
          */}
          {outgoing && !pending ? (
            <Text
              style={{
                fontSize: 11,
                fontWeight: receipt(message, conversation) === "✓✓ Seen" ? "800" : "400",
                color: bare ? colors.muted : "rgba(255,255,255,0.85)",
              }}
            >
              {receipt(message, conversation)}
            </Text>
          ) : null}
        </View>
        {reactions.length ? <View accessibilityLabel="Message reactions" style={{ position: "absolute", right: 8, bottom: -12.6, flexDirection: "row", gap: 2.7, paddingHorizontal: 6.3, paddingVertical: 1.8, borderRadius: 14.4, backgroundColor: "white", borderWidth: 1, borderColor: colors.border, shadowColor: "#20354b", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
          {reactions.map(reaction => <Text key={reaction.actor} accessibilityLabel={`${reaction.actor === "bot" ? "Last confirmed bot" : reaction.actor} reaction ${reaction.emoji}`} style={{ fontSize: 15.3, lineHeight: 20.7 }}>{reaction.emoji}</Text>)}
        </View> : null}
        {ownedBotReaction?.status === "pending" || ownedBotReaction?.status === "uncertain" ? <Text style={{ fontSize: 11, color: colors.muted }}>{ownedBotReaction.status === "pending" ? "Bot reaction pending" : "Bot reaction needs review"}</Text> : null}
      </Pressable>
    </View>
  );
}

/*
 * What you can do to one message, floating over the thread.
 *
 * Held rather than tapped, because a tap already means something on half of
 * these -- opening a photo, playing a clip -- and because holding is what
 * every chat app has taught. The actions are the ones that exist: quoting a
 * message where the platform can carry a quote, copying its words, and saving
 * what it carries. Nothing here pretends to do something the network behind it
 * cannot.
 */
/*
 * What you can do to one message, floating where the message is.
 *
 * A bottom sheet answers a question about the screen; this is a question
 * about one bubble three quarters of the way up it, and an answer that opens
 * at the bottom makes you look away from the thing you are acting on. So the
 * card opens at the thumb: beside the bubble, above the finger when there is
 * no room below it, and always inside the screen.
 */
const MENU_WIDTH = 318;
const MENU_MARGIN = 10;

type MessageMenuControl = {
  open: (selection: MessageActionSelection, at: { x: number; y: number }) => void;
  close: () => void;
};
type ResolvedMessageAction = NonNullable<ReturnType<typeof resolveMessageAction>>;
// Holding a bubble updates only this small host, not the list/player/composer.
function MessageMenuHost({ ref, canReply, saving, platform, resolveSelection, onAction, loadTelegramCapability }: {
  ref: Ref<MessageMenuControl>; canReply: boolean; saving: boolean; platform: string;
  resolveSelection: (selection: MessageActionSelection) => ResolvedMessageAction | null;
  onAction: (action: "reply" | "pin" | "copy" | "download" | "reaction", message: InboxMessage, selection: MessageActionSelection, emoji?: string | null, capability?: TelegramReactionCapability | null) => void;
  loadTelegramCapability?: (message: InboxMessage, owner: string) => Promise<TelegramReactionCapability | null>;
}) {
  const [selection, setSelection] = useState<{ target: MessageActionSelection; at: { x: number; y: number }; flight: number } | null>(null);
  const [telegramCapability, setTelegramCapability] = useState<TelegramReactionCapability | null>(null);
  const capabilityFlight = useRef(0);
  const close = () => { capabilityFlight.current++; setSelection(null); setTelegramCapability(null); };
  useImperativeHandle(ref, () => ({ open: (target, at) => {
    const current = resolveSelection(target);
    if (!current) return;
    const flight = ++capabilityFlight.current;
    setSelection({ target, at, flight }); setTelegramCapability(null);
    if (platform === "telegram" && loadTelegramCapability && telegramReactionTarget(current.message)) {
      void loadTelegramCapability(current.message, target.owner).then(capability => {
        if (capabilityFlight.current === flight && resolveSelection(target) && capability?.owner === target.owner) setTelegramCapability(capability);
      }).catch(() => { /* Reply stays available; reactions fail closed. */ });
    }
  }, close }), [resolveSelection, platform, loadTelegramCapability]);
  const resolved = selection ? resolveSelection(selection.target) : null;
  const act = (action: Parameters<typeof onAction>[0], emoji?: string | null) => {
    if (!selection || saving || selection.flight !== capabilityFlight.current) return;
    const current = resolveSelection(selection.target);
    close();
    if (!current) return;
    const actions = getMessageActions(current.message, platform);
    if (action === "reply" && (!canReply || !actions.reply)) return;
    if (action === "pin" && !actions.pin) return;
    if (action === "reaction" && !canReactToMessengerMessage(current.message, platform) && !canUseTelegramReaction(telegramCapability, current.message, selection.target.owner)) return;
    // Provider reactions/pins always use the stored row; only reply/download
    // receive a photo selection ID. No invented provider IDs or fallback row.
    onAction(action, action === "pin" || action === "reaction" ? current.message : current.photo, selection.target, emoji, telegramCapability);
  };
  return <MessageMenu message={resolved?.photo ?? null} selectionContext={resolved} at={selection?.at ?? null} canReply={canReply} saving={saving} platform={platform} telegramCapability={telegramCapability}
    onReply={() => act("reply")} onPin={() => act("pin")} onCopy={() => act("copy")} onDownload={() => act("download")}
    onReact={emoji => act("reaction", emoji)} onClose={close} />;
}

function MessageMenu({
  message,
  selectionContext,
  at,
  canReply,
  platform,
  onReact,
  saving,
  onReply,
  onCopy,
  onDownload,
  onPin,
  onClose,
  telegramCapability,
}: {
  message: InboxMessage | null;
  selectionContext: ResolvedMessageAction | null;
  at: { x: number; y: number } | null;
  canReply: boolean;
  platform: string;
  onReact: (emoji: string | null) => void;
  saving: boolean;
  onReply: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onPin: () => void;
  onClose: () => void;
  telegramCapability?: TelegramReactionCapability | null;
}) {
  const screen = Dimensions.get("window");


  if (!message || !at) return null;

  const text = message.message_text?.trim() ?? "";
  const url = message.attachment_url;
  const media = ["image", "video", "sticker", "audio", "voice", "file"].includes(
    message.message_type,
  );

  const rows: {
    icon: React.ComponentProps<typeof Ionicons>["name"];
    label: string;
    run: () => void;
  }[] = [];

  /*
   * Not on a message still on its way: it has no id on the network yet, so
   * the quote would be dropped on the way out and nobody would know why.
   */
  const actions = getMessageActions(message, platform);
  const reactionMessage = selectionContext?.message ?? message;
  const choosingTelegramReaction = platform === "telegram" && !!telegramCapability && canUseTelegramReaction(telegramCapability, reactionMessage, telegramCapability.owner);
  const choosingReaction = canReactToMessengerMessage(reactionMessage, platform) || choosingTelegramReaction;
  const currentReaction = choosingTelegramReaction ? telegramCapability?.state?.emoji : getMessengerReaction(message.raw_payload, "page")?.emoji;
  const reactionChoices = choosingTelegramReaction ? [
    ...TELEGRAM_QUICK_REACTIONS.filter(item => telegramCapability.emojis.includes(item.emoji)),
    ...telegramCapability.emojis.filter(emoji => !TELEGRAM_QUICK_REACTIONS.some(item => item.emoji === emoji)).map(emoji => ({ emoji, label: emoji })),
  ].slice(0, 7) : MESSENGER_QUICK_REACTIONS;
  const menuWidth = Math.min(MENU_WIDTH, screen.width - MENU_MARGIN * 2);
  if (canReply && actions.reply) {
    rows.push({ icon: "arrow-undo-outline", label: "Reply", run: onReply });
  }

  if (actions.pin) rows.push({ icon: "bookmark-outline", label: isMessagePinned(message) ? "Unpin" : "Pin", run: onPin });

  /*
   * Copy is for words. A photo, a clip, a voice note or a file has nothing to
   * put on a clipboard -- what somebody wants from those is the file itself,
   * which is what Download is for, and offering both made the menu longer
   * without making it more useful.
   */
  if (text && !media) {
    rows.push({ icon: "copy-outline", label: "Copy", run: onCopy });
  }

  if (url && media) {
    rows.push({
      icon: "download-outline",
      label: "Download",
      run: onDownload,
    });
  }

  if (rows.length === 0 && !choosingReaction) return null;

  /*
   * Placed against the corner the finger is nearest, then pulled back inside
   * the screen. A menu that opens half off the edge is a menu with an action
   * nobody can reach.
   */
  const selectedMedia = selectionContext?.media;
  const telegramReactionUnavailable = platform === "telegram" && !choosingTelegramReaction;
  const albumReaction = choosingTelegramReaction ? telegramCapability?.album : choosingReaction && selectedMedia && messageMedia(selectionContext.message).length > 1;
  const wholeMessageReply = selectedMedia && messageMedia(selectionContext.message).length > 1 && !selectionContext.perPhotoReply;
  const height = rows.length * 46 + 10 + (choosingReaction ? 94 : 0) + (albumReaction || wholeMessageReply ? 42 : 0) + (telegramReactionUnavailable ? 34 : 0);
  const below = at.y + 12;
  const top =
    below + height > screen.height - 24 ? Math.max(24, at.y - height - 12) : below;

  const left = Math.min(
    Math.max(MENU_MARGIN, at.x - menuWidth / 2),
    screen.width - menuWidth - MENU_MARGIN,
  );

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Anywhere else closes it, which is what a tap outside a menu means. */}
      <Pressable
        accessibilityLabel="Close message actions"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(16,34,56,0.18)" }}
      />

      <View
        style={{
          position: "absolute",
          top,
          left,
          width: menuWidth,
          paddingVertical: 5,
          borderRadius: 16,
          backgroundColor: "white",
          elevation: 14,
          shadowColor: "#102238",
          shadowOpacity: 0.24,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        {albumReaction || wholeMessageReply ? <Text style={{ paddingHorizontal: 12, paddingBottom: 8, color: colors.muted, fontSize: 11.5 }}>
          {wholeMessageReply ? "Reply uses the whole message. " : ""}{albumReaction ? choosingTelegramReaction ? "Telegram puts this reaction on the album's first nondeleted message." : "Reactions apply to the whole message." : ""}
        </Text> : null}
        {telegramReactionUnavailable ? <Text style={{ paddingHorizontal: 12, paddingBottom: 8, color: colors.muted, fontSize: 11.5 }}>{telegramCapability?.reason || "Reactions aren't available for this Telegram chat yet."}</Text> : null}
        {choosingReaction ? <View style={{ flexDirection: "row", flexWrap: "wrap", padding: 5 }}>
          {reactionChoices.map(item => <Pressable key={item.emoji} disabled={saving}
            accessibilityRole="button" accessibilityLabel={`React with ${item.label}`}
            onPress={() => onReact(currentReaction === item.emoji ? null : item.emoji)}
            style={{ width: (menuWidth - 10) / 7, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: currentReaction === item.emoji ? colors.pale : "transparent" }}>
            <Text style={{ fontSize: 26 }}>{item.emoji}</Text>
          </Pressable>)}
          {currentReaction ? <Pressable disabled={saving} onPress={() => onReact(null)} style={{ padding: 10 }}><Text>Remove reaction</Text></Pressable> : null}
        </View> : null}
        {rows.map((row, index) => (
          <Pressable
            key={row.label}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            disabled={saving}
            onPress={row.run}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 13,
              paddingHorizontal: 16,
              height: 46,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colors.border,
              backgroundColor: pressed ? colors.pale : "transparent",
            })}
          >
            <Ionicons name={row.icon} size={19} color={colors.ink} />

            <Text
              style={{
                flex: 1,
                fontSize: 15,
                fontWeight: "600",
                color: colors.ink,
              }}
            >
              {row.label}
            </Text>

            {saving && row.label === "Download" ? (
              <ActivityIndicator color={colors.blue} />
            ) : null}
          </Pressable>
        ))}
      </View>
    </Modal>
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
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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

  useEffect(() => {
    if (category && !grouped.some(group => group.name === category)) setCategory(null);
  }, [category, grouped]);
  const query = search.trim().toLocaleLowerCase();
  const visibleGroups = grouped
    .filter(group => !category || group.name === category)
    .map(group => ({ ...group, replies: group.replies.filter(reply => !query || `${reply.title} ${reply.message_text}`.toLocaleLowerCase().includes(query)) }))
    .filter(group => group.replies.length > 0);
  const visibleReplies = visibleGroups.flatMap(group => group.replies);

  return (
    <Sheet
      open={open}
      title="Quick replies"
      detail="Loads into the box so you can change it before sending."
      onClose={onClose}
    >
      <View style={{ flexShrink: 0, paddingHorizontal: 18, paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TextInput
          accessibilityLabel="Search quick replies"
          placeholder="Search replies…"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          style={{ borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.background, color: colors.ink }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
          {[null, ...grouped.map(group => group.name)].map(name => (
            <Pressable
              key={name === null ? "all" : `category:${name}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: category === name }}
              onPress={() => setCategory(name)}
              style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, backgroundColor: category === name ? colors.blue : colors.pale }}
            >
              <Text style={{ color: category === name ? "white" : colors.ink, fontWeight: "700", fontSize: 13 }}>{name ?? "All"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {loading && replies.length === 0 ? (
        <SheetSkeleton rows={4} thumbs />
      ) : replies.length === 0 ? (
        <Empty
          icon="chatbox-ellipses-outline"
          title="No quick replies"
          detail="Quick replies are written on the web, under Settings. They appear here as soon as they are saved."
        />
      ) : (
        <ScrollView key={JSON.stringify([category, query])} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {visibleGroups.length === 0 ? <Empty icon="search-outline" title="No matching replies" detail="Try another category or search." /> : null}
          {visibleReplies.map((reply, replyIndex) => (
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
                borderTopWidth: replyIndex === 0 ? 0 : 1,
                borderTopColor: colors.border,
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

              {/*
                The pictures, under the words.

                A reply that carries a photo said "1" beside a paperclip,
                which is a count of something nobody can see -- and a saved
                reply's picture is usually the whole point of it: the size
                chart, the price list, the map to the shop. They are already
                signed for this request, so drawing them costs nothing extra.
              */}
              <ReplyThumbs attachments={reply.attachments} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

/*
 * The wait, drawn as the thing being waited for.
 *
 * Both sheets opened on a spinner in the middle of an empty panel: it says
 * something is happening and nothing about what, and the answer then lands
 * somewhere else entirely. These are the rows those sheets actually draw --
 * a title, a line of body, and for quick replies the pictures under it -- so
 * the shape is right before the content arrives and nothing jumps.
 */
function SheetSkeleton({ rows, thumbs }: { rows: number; thumbs?: boolean }) {
  const [pulse] = useState(() => new Animated.Value(0.45));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      /* Not announced: "loading, loading, loading" as the bars pulse is worse
         than the silence the spinner left behind. */
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ paddingHorizontal: 18, paddingTop: 14, opacity: pulse }}
    >
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={{ paddingVertical: 12, gap: 8 }}>
          <View
            style={{
              width: row % 2 === 0 ? "42%" : "34%",
              height: 13,
              borderRadius: 7,
              backgroundColor: colors.border,
            }}
          />

          <View
            style={{
              width: row % 3 === 0 ? "88%" : "68%",
              height: 11,
              borderRadius: 6,
              backgroundColor: colors.border,
            }}
          />

          {thumbs && row % 2 === 0 ? (
            <View style={{ flexDirection: "row", gap: 6, marginTop: 2 }}>
              {[0, 1].map((thumb) => (
                <View
                  key={thumb}
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 10,
                    backgroundColor: colors.border,
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </Animated.View>
  );
}

/* The pictures a saved reply carries, as a row of thumbnails. */
function ReplyThumbs({ attachments }: { attachments: SavedReplyAttachment[] }) {
  /*
   * Pictures and videos both. A reply that carries a clip of the product
   * showed nothing at all, and "video" is a thing somebody recognises by its
   * frame -- there is no thumbnail in the payload, so it wears a play mark on
   * the tinted tile rather than pretending to have one.
   */
  const pictures = attachments.filter(
    (file) => (file.kind === "image" || file.kind === "video") && file.url,
  );

  if (pictures.length === 0) return null;

  return (
    <View style={{ flexDirection: "row", gap: 6, marginTop: 5 }}>
      {pictures.slice(0, 4).map((picture) =>
        picture.kind === "video" ? (
          <View
            key={picture.path}
            style={{
              width: 52,
              height: 52,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#102238",
            }}
          >
            <Ionicons name="play" size={19} color="white" />
          </View>
        ) : (
        <AuthImage
          key={picture.path}
          uri={`/api/saved-replies/media?thumbnail=1&path=${encodeURIComponent(picture.path)}`}
          /*
            Cached against the file, not against its link. A saved reply's
            picture arrives behind a signed URL that is different on every
            request, so keying the cache on the URL downloaded the same photo
            again every time the sheet was opened. The storage path is the
            thing that does not change.
          */
          cacheKey={`thumbnail:${picture.path}`}
          style={{
            width: 52,
            height: 52,
            borderRadius: 10,
            backgroundColor: colors.background,
          }}
        />
      ))}

      {pictures.length > 4 ? (
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.background,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "800", color: colors.muted }}>
            +{pictures.length - 4}
          </Text>
        </View>
      ) : null}
    </View>
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
  onRetry,
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
  onRetry?: () => void;
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
      {error ? <ErrorNotice message={error} onRetry={loading ? undefined : onRetry} /> : null}

      {loading && tags.length === 0 ? (
        <SheetSkeleton rows={5} />
      ) : error && tags.length === 0 ? null : tags.length === 0 ? (
        <Empty
          icon="pricetag-outline"
          title="No tags yet"
          detail="Tags are created on the web, under Settings. They appear here as soon as they are saved."
        />
      ) : (
        <ScrollView
          keyboardDismissMode="on-drag"
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
  const { workspace, conversations, workspaces } = useInbox();
  const { session } = useAuth();
  if (!session) return <Redirect href="/sign-in" />;
  const businessId = conversations.find(row => row.id === id)?.business_id ?? workspace?.businessId;
  const membership = workspaces.find(row => row.businessId === businessId && row.subscriptionOperational)?.memberId;
  return <ConversationScreen key={JSON.stringify([session.user.id, id, businessId, membership])} />;
}

function ConversationScreen() {
  const { session } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const resolveMedia = useMediaSource();

  /*
   * Say which conversation this phone is on, and watch who else is on it.
   *
   * Two people answering one customer at once is the oldest failure in a
   * shared inbox, and the website has warned about it for a while. The phone
   * was invisible in that warning: a colleague at a desk could not tell that
   * this thread was already being answered from somebody's hand.
   */
  const { setViewing, leaveViewing, setTyping } = usePresence();
  const viewers = useViewers(id ? String(id) : null);

  /* Of those, the ones with something already in their box. */
  const typists = viewers.filter((viewer) => viewer.is_typing);

  useFocusEffect(useCallback(() => {
    const thread = id ? String(id) : null;

    setViewing(thread);

    /* Named, because the next thread may already have claimed presence by the
       time this one is torn down. */
    return () => {
      if (thread) leaveViewing(thread);
    };
  }, [id, setViewing, leaveViewing]));


  const {
    conversations,
    workspaces,
    workspace,
    member,
    revision,
    threadUpdates,
    settingsRevision,
    updateConversation,
    updateContactTags,
  } = useInbox();

  // Whatever background this phone chose in Settings.
  const { backgroundUri } = useDisplay();

  const conversation = useMemo(
    () => conversations.find((item) => item.id === id) ?? null,
    [conversations, id],
  );

  /*
   * The workspace this thread belongs to -- not whichever one is active.
   *
   * Two workspaces can be merged into one Inbox, so the row above this screen
   * may belong to the other shop. Every request the app makes carries the
   * workspace it is for, and the server checks the membership behind it, so
   * scoping by the conversation's own business is both correct and safe: the
   * message goes to the Page that received it, the tag list offered is that
   * workspace's tags, and a quick reply written for one shop cannot be
   * offered in the other. It is the same thing the website does when it opens
   * a conversation from a merged view.
   */
  const scopeId = conversation?.business_id ?? workspace?.businessId;

  const previewKey = threadPreviewKey(session?.user.id, scopeId,
    workspaces.find(row => row.businessId === scopeId && row.subscriptionOperational)?.memberId, String(id));
  const [preview] = useState(() => previewKey ? peekReadCache<ThreadPage>(previewKey) : undefined);
  const [messages, setMessages] = useState<InboxMessage[]>(() => mergeMessages([], preview?.messages ?? []));
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  useFocusEffect(useCallback(() => {
    setCustomerReadActivity(true, customerReadActivity.current.foreground);
    focusedRef.current = true; setFocused(true);
    return () => {
      setCustomerReadActivity(false, customerReadActivity.current.foreground);
      focusedRef.current = false; setFocused(false);
    };
  }, []));
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const messageChannelPlatform = conversation?.social_account?.platform;
  useEffect(() => {
    if (messageChannelPlatform !== "facebook") return;
    const source = latestCustomerChannel(messages, String(id));
    if (source) updateConversation(String(id), { source_type: source });
  }, [messages, id, messageChannelPlatform, updateConversation]);
  const [pinUpdates, setPinUpdates] = useState<InboxMessage[]>([]);
  const threadList = useRef<FlatList<InboxMessage>>(null);
  const [pinJump, setPinJump] = useState<string | null>(null);
  const [pinHighlight, setPinHighlight] = useState<string | null>(null);
  const pinJumpPages = useRef(0);
  const pinScrollRetries = useRef(0);
  const pinScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setPinUpdates([]); setPinJump(null); setPinHighlight(null);
    return () => { if (pinScrollTimer.current) clearTimeout(pinScrollTimer.current); };
  }, [id, scopeId]);
  useEffect(() => {
    if (!pinHighlight) return;
    const timer = setTimeout(() => setPinHighlight(null), 2500);
    return () => clearTimeout(timer);
  }, [pinHighlight]);
  const [cursor, setCursor] = useState<{ sentAt: string; id: string } | null>(
    preview?.nextCursor ?? null,
  );
  const [hasMore, setHasMore] = useState(Boolean(preview?.hasMore));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderFlight = useRef<Promise<void> | null>(null);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [pending, setPendingState] = useState<Pending[]>([]);
  // Keep same-frame picker completions visible to Storage's capacity check.
  const pendingQueue = useRef(pending);
  const setPending = useCallback((update: Pending[] | ((current: Pending[]) => Pending[])) => {
    const next = typeof update === "function" ? update(pendingQueue.current) : update;
    pendingQueue.current = next;
    setPendingState(next);
  }, []);
  const [storageOpen, setStorageOpen] = useState(false);
  const storageWorkspace = workspaces.find(item => item.businessId === conversation?.business_id);
  const storageReady = Boolean(session && conversation && storageWorkspace?.subscriptionOperational);
  const storageDraft = useRef({ ready: false, blocked: true, pending });
  const storageScope = { userId: session?.user.id ?? "", workspaceId: scopeId ?? "", memberId: storageWorkspace?.memberId ?? "", conversationId: String(id) };
  const storageOwner = storageDraftOwner(storageScope);
  useEffect(() => {
    const recovered = attachStorageDrafts(storageScope);
    if (recovered.length) setPending(current => [...current, ...recovered.filter(file => !current.some(item => item.key === file.key))]);
    return () => detachStorageDrafts(storageOwner);
  }, [storageOwner, setPending]);
  useEffect(() => { reconcileStorageDrafts(storageOwner, pending); }, [storageOwner, pending]);

  /*
   * Whether what is in the box came from a quick reply. It is the only case
   * that earns a Clear all: one tap put it there, so one tap should take it
   * away again.
   */
  const [fromQuickReply, setFromQuickReply] = useState(false);

  /* Set for exactly one send, by somebody who has been asked and said yes. */
  const confirmedOverlapRef = useRef(false);

  /*
   * An unsent reply is what "typing" means here, the same as on the website:
   * words in the box, not recent keypresses. Clearing it or sending stops it
   * at once, which is what makes the other end trustworthy.
   */
  useEffect(() => {
    setTyping(draft.trim().length > 0);
  }, [draft, setTyping]);
  const [sending, setSending] = useState(false);
  const [voiceReady, setVoiceReady] = useState(0);

  /* The message being acted on, and whether a download is in flight. */
  const messageMenu = useRef<MessageMenuControl>(null);

  /*
   * The message the next send will quote, using the website send routes.
   */
  const [quoted, setQuoted] = useState<InboxMessage | null>(null);
  const quotedSelection = useRef<MessageActionSelection | null>(null);
  const downloadFlight = useRef<object | null>(null);
  const [saving, setSaving] = useState(false);
  const [replyingToComment, setReplyingToComment] = useState<InboxMessage | null>(null);
  const [commentBusy, setCommentBusy] = useState<string | null>(null);

  const [replyOpen, setReplyOpen] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const stickerBusy = useRef(false);
  const stickerAttempts = useRef(new Map<string, string>());
  const flowAuthGeneration = authSessionGeneration();
  const repliesOwner = JSON.stringify([session?.user.id, scopeId, String(id),
    workspaces.find(row => row.businessId === scopeId)?.memberId, flowAuthGeneration]);
  const repliesOwnerRef = useRef(repliesOwner);
  repliesOwnerRef.current = repliesOwner;
  // Context generations retire old queued launches and results even after A -> B -> A.
  // Session identity is compared only in memory; no credentials enter the owner key.
  const pickerContext = useRef({ owner: repliesOwner, session, epoch: 0 });
  if (pickerContext.current.owner !== repliesOwner || pickerContext.current.session !== session) {
    pickerContext.current = { owner: repliesOwner, session, epoch: pickerContext.current.epoch + 1 };
  }
  const pickerRenderEpoch = pickerContext.current.epoch;
  const pickerOperation = useRef(0);
  const [replySnapshot, setReplySnapshot] = useState<{ owner: string; replies: SavedReply[] } | null>(null);
  const replies = replySnapshot?.owner === repliesOwner ? replySnapshot.replies : [];
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [preparingReply, setPreparingReply] = useState(false);

  const [tagOpen, setTagOpen] = useState(false);
  const metadataMemberId = workspaces.find(row => row.businessId === scopeId)?.memberId;
  const metadataOwner = JSON.stringify([session?.user.id, scopeId, metadataMemberId, flowAuthGeneration]);
  const metadataOwnerRef = useRef(metadataOwner); metadataOwnerRef.current = metadataOwner;
  const metadataActive = focused && foreground && Boolean(session?.user.id && scopeId && metadataMemberId);
  const tagRead = useOwnedPanelRead(metadataOwner, metadataActive, tagOpen, loadTagDefinitions, settingsRevision, () => authSessionGeneration() === flowAuthGeneration);
  const tags = tagRead.rows ?? [];
  const [assigned, setAssigned] = useState<Set<string>>(() => new Set());
  const [busyTagId, setBusyTagId] = useState<string | null>(null);
  const tagsLoading = tagRead.loading;

  const [panelOpen, setPanelOpen] = useState(false);
  const teamRead = useOwnedPanelRead(metadataOwner, metadataActive, panelOpen, loadTeamMembers, settingsRevision, () => authSessionGeneration() === flowAuthGeneration);
  const members = teamRead.rows ?? [];
  const membersLoading = teamRead.loading;
  const panelActionFlight = useRef<{ owner: string; key: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [locationError, setLocationError] = useState("");
  const locationFlight = useRef<string | null>(null);
  const sendFlight = useRef(false);
  const mediaPickerFlight = useRef(false);
  const [draftSendUnknown, setDraftSendUnknown] = useState(false);
  const locationSequence = useRef(0);
  const locationModalEpoch = useRef(0);
  const [locationRecovery, setLocationRecovery] = useState<LocationAttempt | null>(null);
  const [locationReady, setLocationReady] = useState(false);
  const locationAttempts = useRef(new Map<string, string>());
  useEffect(() => {
    locationSequence.current++; locationModalEpoch.current++;
    setLocationRecovery(null); setLocationReady(false);
    if (locationFlight.current) setSending(false);
    locationFlight.current = null;
    locationAttempts.current.clear();
    setMapOpen(false); setLocationError("");
  }, [scopeId, id]);
  const customerReadOwner = JSON.stringify([repliesOwner, conversation?.contact?.id ?? null]);
  const customerSnapshotScope = useRef({ owner: customerReadOwner, epoch: 0 });
  if (customerSnapshotScope.current.owner !== customerReadOwner) {
    customerSnapshotScope.current = { owner: customerReadOwner, epoch: customerSnapshotScope.current.epoch + 1 };
  }
  const customerSnapshotEpoch = customerSnapshotScope.current.epoch;
  const [customerSnapshot, setCustomerSnapshot] = useState<{ owner: string; data: CustomerDetail | null } | null>(null);
  const customer = customerSnapshot?.owner === customerReadOwner ? customerSnapshot.data : null;
  const setCustomer = useCallback((update: CustomerDetail | null | ((current: CustomerDetail | null) => CustomerDetail | null)) => {
    const owns = () => authSessionGeneration() === flowAuthGeneration &&
      customerSnapshotScope.current.owner === customerReadOwner && customerSnapshotScope.current.epoch === customerSnapshotEpoch;
    if (!owns()) return;
    setCustomerSnapshot(current => owns() ? ({ owner: customerReadOwner, data: typeof update === "function"
      ? update(current?.owner === customerReadOwner ? current.data : null) : update }) : current);
  }, [customerReadOwner, customerSnapshotEpoch, flowAuthGeneration]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const customerRequest = useRef(0);
  const customerOwnerRef = useRef("");
  const customerReadFlight = useRef<{
    owner: string;
    readOwner: string;
    work: Promise<CustomerDetail | null>;
    next: Promise<CustomerDetail | null> | null;
  } | null>(null);
  const tagLocalEdits = useRef(new Map<string, boolean>());
  const tagInboxSnapshot = useRef<{ owner: string; tags: string; items: Tag[] } | null>(null);
  const customerReadActivity = useRef({ owner: "", focused: false, foreground: AppState.currentState === "active", epoch: 0, dirty: false });
  const tagMutationEpoch = useRef(0);
  const tagMutationFlight = useRef<object | null>(null);

  const requestRef = useRef(0);
  const ownerRef = useRef("");
  ownerRef.current = `${scopeId}:${id}`;
  storageDraft.current = { ready: storageReady, blocked: sending || preparingReply || !focused || !foreground || Boolean(replyingToComment), pending };
  useEffect(() => { if (!storageReady || !focused || !foreground) setStorageOpen(false); }, [storageReady, focused, foreground]);
  const screenAlive = useRef(true);
  const syncRef = useRef<{
    pending: Promise<void> | null; dirty: boolean; controller: AbortController | null;
    timer: ReturnType<typeof setTimeout> | undefined; failures: number;
    gap: { cursor: ThreadCursor; anchor: InboxMessage } | null;
  }>({ pending: null, dirty: false, controller: null, timer: undefined, failures: 0, gap: null });
  const [loadedRevision, setLoadedRevision] = useState(0);
  const readWatermark = useRef<string | null>(null);
  const readPending = useRef<Promise<void> | null>(null);
  const readSuppressed = useRef(false);
  const readFailures = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [readRetry, setReadRetry] = useState(0);
  useEffect(() => {
    screenAlive.current = true;
    const listener = AppState.addEventListener("change", state => {
      setCustomerReadActivity(customerReadActivity.current.focused, state === "active");
      setForeground(state === "active");
      if (state !== "active") {
        syncRef.current.controller?.abort();
        clearTimeout(syncRef.current.timer); clearTimeout(readTimer.current);
        syncRef.current.timer = undefined;
        readTimer.current = undefined;
      }
    });
    return () => {
      screenAlive.current = false; ownerRef.current = ""; requestRef.current++;
      syncRef.current.controller?.abort();
      clearTimeout(syncRef.current.timer); clearTimeout(readTimer.current);
      listener.remove();
    };
  }, []);

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

  const sourceTimeline = useMemo(() => messengerSourceTimeline(
    conversation?.facebook_messenger_sources, platform === "facebook" ? messages : [],
  ), [conversation?.facebook_messenger_sources, platform, messages]);

  async function sendSticker(sticker: StickerChoice) {
    if (stickerBusy.current || sending) throw new Error("A message is already sending.");
    const quoteSelection = quotedSelection.current;
    const quote = currentQuote(quoteSelection);
    const quoteOwner = actionScope.current.value;
    stickerBusy.current = true;
    const key = JSON.stringify([scopeId, id, sticker.stickerId, quote?.id]);
    let requestId = stickerAttempts.current.get(key);
    if (!requestId) {
      requestId = randomUUID();
      if (stickerAttempts.current.size >= 32) stickerAttempts.current.delete(stickerAttempts.current.keys().next().value!);
      stickerAttempts.current.set(key, requestId);
    }
    try {
      const result = await api<{ warning?: string }>(platform === "facebook" ? "/api/facebook/stickers/send" : "/api/telegram/send-sticker", scopeId, {
        method: "POST", body: { conversationId: String(id), stickerId: sticker.stickerId,
          ...("setName" in sticker ? { setName: sticker.setName } : { requestId, previewUrl: sticker.previewUrl, label: sticker.label }),
          ...(quote ? { replyToMessageId: quote.id } : {}),
        },
      });
      stickerAttempts.current.delete(key);
      if (!screenAlive.current || actionScope.current.value !== quoteOwner) return;
      if (quotedSelection.current === quoteSelection) {
        quotedSelection.current = null;
        setQuoted(current => current?.id === quoted?.id ? null : current);
      }
      setStickerOpen(false);
      if (result.warning) Alert.alert("Sticker sent", result.warning);
      // A refresh failure must not invite the user to send a confirmed sticker twice.
      void load();
    } finally { stickerBusy.current = false; }
  }

  const contactId = conversation?.contact?.id ?? null;
  customerOwnerRef.current = `${scopeId}:${id}:${contactId ?? ""}`;
  // Panel writes belong to the physical customer context, independently of native foreground state.
  const panelContextKey = JSON.stringify([repliesOwner, contactId, conversation?.business_id]);
  const panelContext = useRef({ key: panelContextKey, epoch: 0, value: JSON.stringify([panelContextKey, 0]) });
  if (panelContext.current.key !== panelContextKey) {
    const epoch = panelContext.current.epoch + 1;
    panelContext.current = { key: panelContextKey, epoch, value: JSON.stringify([panelContextKey, epoch]) };
  }
  const panelOwner = panelContext.current.value;
  // Fence reads at render as well as synchronously in native focus/AppState callbacks.
  setCustomerReadActivity(focused, foreground);
  useEffect(() => {
    customerRequest.current++;
    customerReadFlight.current = null;
    customerReadActivity.current.epoch++;
    customerReadActivity.current.dirty = false;
    tagLocalEdits.current.clear();
    tagInboxSnapshot.current = null;
    tagMutationEpoch.current++;
    tagMutationFlight.current = null;
    setCustomer(null);
    setCustomerLoading(false);
    setBusyTagId(null);
    setAssigned(new Set());
    setTagOpen(false); setPanelOpen(false);
  }, [scopeId, id, contactId, repliesOwner]);
  const recipientId = conversation?.contact?.platform_user_id?.trim() ?? "";
  const tagCount = conversation?.contact?.tags?.length ?? 0;
  const name = conversation?.contact?.full_name ?? "Conversation";

  const load = useCallback((continuation = false, invalidation = true): Promise<void> => {
    const sync = syncRef.current;
    // Ordinary focus/resume/retry callers share the current read. A real
    // message invalidation must still reconcile after an older response.
    if (!continuation && (!sync.pending || invalidation)) sync.dirty = true;
    if (sync.pending) return sync.pending;
    if (!id || !scopeId || !screenAlive.current || !focusedRef.current || AppState.currentState !== "active") return Promise.resolve();
    clearTimeout(sync.timer); sync.timer = undefined;
    const owner = `${scopeId}:${id}`, sequence = ++requestRef.current;
    const controller = new AbortController(); sync.controller = controller;
    const owns = () => screenAlive.current && ownerRef.current === owner && sequence === requestRef.current;
    const valid = () => owns() && !controller.signal.aborted;
    const afterAnchor = (cursor: ThreadCursor, anchor: InboxMessage) => {
      const difference = Date.parse(cursor.sentAt) - sentAt(anchor);
      return difference > 0 || (difference === 0 && cursor.id.localeCompare(anchor.id) > 0);
    };
    const fetchPage = (before?: ThreadCursor) => {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) { query.set("beforeCreatedAt", before.sentAt); query.set("beforeId", before.id); }
      return api<ThreadPage>(`/api/conversations/${encodeURIComponent(id)}/messages?${query}`, scopeId, { signal: controller.signal, expectedUserId: session?.user.id });
    };
    const apply = (data: ThreadPage) => {
      const merged = mergeMessages(messagesRef.current, data.messages ?? []);
      messagesRef.current = merged; setMessages(merged);
    };
    sync.pending = (async () => {
      let pages = 0, retryable = true;
      try {
        do {
          if (sync.dirty) {
            sync.dirty = false;
            const anchor = messagesRef.current.find(row => !row.id.startsWith("optimistic:"));
            const cacheEpoch = readCacheGeneration();
            const data = await fetchPage(); pages++;
            if (!valid()) return;
            if (previewKey) storeReadCache(previewKey, {
              messages: (data.messages ?? []).slice(-PAGE_SIZE), hasMore: data.hasMore, nextCursor: data.nextCursor,
            }, cacheEpoch);
            apply(data);
            setCursor(current => current ?? data.nextCursor ?? null);
            setHasMore(current => current || Boolean(data.hasMore));
            if (!sync.gap && anchor && data.hasMore && data.nextCursor && afterAnchor(data.nextCursor, anchor)) {
              sync.gap = { cursor: data.nextCursor, anchor };
            }
          }
          // Catch up to the previous newest message, at most 100 rows per burst.
          // A continuation never restarts at the newest page or skips to the old history cursor.
          while (sync.gap && pages < 4) {
            const gap = sync.gap;
            const data = await fetchPage(gap.cursor); pages++;
            if (!valid()) return;
            apply(data);
            sync.gap = data.hasMore && data.nextCursor && afterAnchor(data.nextCursor, gap.anchor)
              ? { cursor: data.nextCursor, anchor: gap.anchor } : null;
          }
        } while (sync.dirty && pages < 4 && valid());
        if (valid()) { sync.failures = 0; setError(""); setLoadedRevision(value => value + 1); }
      } catch (loadError) {
        if (!valid()) { sync.dirty = true; return; }
        retryable = !(loadError instanceof ApiError && [401, 403, 404].includes(loadError.status));
        if (!retryable) {
          clearReadCache(key => key === previewKey);
          messagesRef.current = []; setMessages([]); sync.gap = null;
          setCursor(null); setHasMore(false);
        }
        else { sync.dirty = true; sync.failures++; }
        setError(loadError instanceof Error ? loadError.message : "Unable to load this conversation.");
      } finally {
        sync.pending = null;
        if (owns()) {
          setLoading(false);
          if (retryable && focusedRef.current && AppState.currentState === "active" && (sync.dirty || sync.gap)) {
            sync.timer = setTimeout(() => void load(true), sync.failures ? Math.min(30_000, 1000 * 2 ** Math.min(sync.failures - 1, 5)) : 300);
          }
        }
      }
    })();
    return sync.pending;
  }, [id, scopeId, previewKey, session?.user.id]);

  // revision ticks: only this thread's changes invalidate messages. Global lifecycle and
  // fallback refreshes still revalidate, while joining an existing read.
  const threadVersion = threadUpdates.byId[String(id)] ?? 0;
  const seenThreadUpdate = useRef({ all: threadUpdates.all, version: threadVersion });
  useEffect(() => {
    const invalidation = seenThreadUpdate.current.all !== threadUpdates.all || seenThreadUpdate.current.version !== threadVersion;
    seenThreadUpdate.current = { all: threadUpdates.all, version: threadVersion };
    if (focused && foreground) void load(false, invalidation);
    else {
      syncRef.current.controller?.abort(); clearTimeout(syncRef.current.timer); clearTimeout(readTimer.current);
      readTimer.current = undefined;
    }
  }, [load, threadUpdates.all, threadUpdates.refresh, threadVersion, focused, foreground]);

  /*
   * Older messages, one page at a time, as the agent scrolls back.
   *
   * Keyset paging on the oldest message held rather than an offset: new
   * messages arriving at the other end would shift every offset by one and
   * quietly skip or repeat a message in the middle.
   */
  const loadOlder = useCallback(async () => {
    if (olderFlight.current) return olderFlight.current;
    if (!id || !cursor || !hasMore || loadingOlder || syncRef.current.pending || syncRef.current.gap) {
      return;
    }
    const owner = `${scopeId}:${id}`, sequence = requestRef.current;
    const valid = () => screenAlive.current && ownerRef.current === owner && sequence === requestRef.current;
    setLoadingOlder(true);

    const work = (async () => { try {
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
        scopeId,
        { expectedUserId: session?.user.id },
      );

      if (!valid()) return;
      const merged = mergeMessages(messagesRef.current, data.messages ?? []);
      messagesRef.current = merged; setMessages(merged);
      setCursor(data.nextCursor ?? null);
      setHasMore(Boolean(data.hasMore));
    } catch (olderError) {
      if (!valid()) return;
      if (olderError instanceof ApiError && [401, 403, 404].includes(olderError.status)) {
        clearReadCache(key => key === previewKey);
        messagesRef.current = []; setMessages([]); setCursor(null); setHasMore(false);
      }
      setError(
        olderError instanceof Error
          ? olderError.message
          : "Unable to load older messages.",
      );
    } finally {
      if (screenAlive.current && ownerRef.current === owner) setLoadingOlder(false);
    }
    })();
    olderFlight.current = work;
    try { await work; } finally { if (olderFlight.current === work) olderFlight.current = null; }
  }, [cursor, hasMore, id, loadingOlder, scopeId, previewKey, session?.user.id]);

  // Acknowledge successfully displayed incoming messages, not the screen mount.
  useEffect(() => {
    if (!id || !conversation || !focused || !foreground || !loadedRevision || readSuppressed.current || readPending.current || readTimer.current ||
      syncRef.current.pending || syncRef.current.dirty || syncRef.current.gap) return;
    const watermark = messages.find(row => row.direction === "incoming" && !row.id.startsWith("optimistic:"))?.id;
    if (!watermark || readWatermark.current === watermark) return;
    if ((conversation.unread_count ?? 0) === 0) { readWatermark.current = watermark; return; }
    const owner = `${scopeId}:${id}`;
    let acknowledged = false;
    readPending.current = api(
      `/api/conversations/${encodeURIComponent(id)}/read`,
      scopeId,
      { method: "PATCH" },
    ).then(() => {
      if (!screenAlive.current || ownerRef.current !== owner || readSuppressed.current) return;
      acknowledged = true;
      readWatermark.current = watermark; readFailures.current = 0;
      // A newer arrival remains unread until its own successful acknowledgment.
      if (messagesRef.current.find(row => row.direction === "incoming" && !row.id.startsWith("optimistic:"))?.id === watermark) {
        updateConversation(id, { unread_count: 0 });
      }
    }).catch(error => {
      if (!screenAlive.current || ownerRef.current !== owner || readSuppressed.current ||
        (error instanceof ApiError && [401, 403, 404].includes(error.status))) return;
      readFailures.current++;
      clearTimeout(readTimer.current);
      if (focusedRef.current && AppState.currentState === "active") {
        readTimer.current = setTimeout(() => { readTimer.current = undefined; if (screenAlive.current) setReadRetry(value => value + 1); }, Math.min(30_000, 1000 * 2 ** Math.min(readFailures.current - 1, 5)));
      }
    }).finally(() => {
      readPending.current = null;
      if (acknowledged && screenAlive.current && ownerRef.current === owner && !readSuppressed.current) setReadRetry(value => value + 1);
    });
  }, [id, conversation, scopeId, messages, loadedRevision, focused, foreground, readRetry, updateConversation]);

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
  }
  useEffect(() => {
    if (!replyOpen || !focused || !foreground || !scopeId) return;
    let alive = true;
    const owner = repliesOwner, controller = new AbortController();
    const owns = () => alive && screenAlive.current && repliesOwnerRef.current === owner &&
      focusedRef.current && customerReadActivity.current.foreground;
    setRepliesLoading(replies.length === 0);
    void api<{ savedReplies: SavedReply[] }>("/api/saved-replies?activeOnly=true", scopeId, { signal: controller.signal })
      .then(data => { if (owns()) setReplySnapshot({ owner, replies: data.savedReplies ?? [] }); })
      .catch(error => {
        if (!owns()) return;
        if (error instanceof ApiError && [401, 403].includes(error.status)) setReplySnapshot(null);
        setError(error instanceof Error ? error.message : "Unable to load quick replies.");
      })
      .finally(() => { if (owns()) setRepliesLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [replyOpen, settingsRevision, repliesOwner, scopeId, focused, foreground]);

  /*
   * A quick reply's media has to come down before it can go back up: the
   * saved copy lives behind a signed link, and the send endpoints take an
   * upload, not a URL. Downloading to the cache is what the web does with a
   * blob, one step further because a phone has a filesystem to use.
   */
  async function pickReply(reply: SavedReply) {
    setDraft(reply.message_text);
    setFromQuickReply(true);

    // Public Facebook comment replies are text-only. The saved words are
    // still useful, while silently attaching the saved photos would make the
    // eventual send fail Meta validation.
    if (replyingToComment) {
      return;
    }

    // Voice-message quick replies are sent from the web Inbox for now. Leaving
    // them out is honest; the phone's staging treats every non-video file as a
    // photo, so including one would fail the whole send.
    const sendable = reply.attachments.filter((item) => item.kind === "image" || item.kind === "video");
    const skippedVoice = reply.attachments.length - sendable.length;

    if (skippedVoice > 0) {
      setError("This quick reply's voice message can only be sent from the web Inbox. Its text and other media are added.");
    }

    const withUrls = sendable.filter((item) => item.url);

    if (withUrls.length === 0) {
      return;
    }

    setPreparingReply(true);
    const staged: Pending[] = [];

    try {
      for (const [index, attachment] of withUrls.entries()) {
        try {
          /*
           * The saved name, and an extension that matches what it actually
           * is.
           *
           * The upload declares no mime type of its own: expo-file-system
           * reads it back off the file, and the server then checks that the
           * declared kind matches -- an album refuses outright unless every
           * part is image/*. A saved reply whose name lost its extension
           * somewhere therefore uploaded as application/octet-stream and the
           * whole send failed, text and all.
           */
          const safe = attachment.name.replace(/[^\w.-]+/g, "_").slice(-60) || "attachment";
          const named = /\.[a-z0-9]{2,5}$/i.test(safe)
            ? safe
            : `${safe}${extensionForMime(attachment.mimeType, attachment.kind)}`;
          const target = new File(Paths.cache, `${Date.now()}-${index}-${named}`);
          const source = resolveMedia(attachment.url);
          const local = source && await cacheMedia(source.uri, `reply:${attachment.path}`, source.headers, source.cacheScope, attachment.kind === "video");
          // Give the upload its own named copy; cache eviction must not remove
          // an attachment already staged in the composer.
          const saved = local ? (new File(local).copy(target), target)
            : await File.downloadFileAsync(source?.uri ?? attachment.url as string, target, { headers: source?.headers });

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
  async function pickFromLibrary() {
    if (!screenAlive.current || !focusedRef.current || !customerReadActivity.current.foreground || ownerRef.current !== `${scopeId}:${id}` || pickerContext.current.epoch !== pickerRenderEpoch || pickerContext.current.session !== session || pickerContext.current.owner !== repliesOwner || !session?.user.id) return;
    if (mediaPickerFlight.current || sending || pending.length >= MAX_PENDING_ATTACHMENTS) {
      if (pending.length >= MAX_PENDING_ATTACHMENTS) setError("Remove an attachment before adding more than 30 items.");
      return;
    }
    mediaPickerFlight.current = true;
    const owner = `${scopeId}:${id}`, epoch = pickerRenderEpoch, operation = ++pickerOperation.current;
    const ownsResponse = () => screenAlive.current && ownerRef.current === owner && pickerContext.current.epoch === epoch && pickerContext.current.session === session && pickerContext.current.owner === repliesOwner && pickerOperation.current === operation;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!ownsResponse()) return;
      if (!permission.granted && permission.accessPrivileges !== "limited") {
        setError("Allow photo library access to choose images and videos, or use Documents."); return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"], allowsMultipleSelection: true,
        allowsEditing: false, orderedSelection: true,
        selectionLimit: MAX_PENDING_ATTACHMENTS - pending.length, quality: 1,
      });
      if (!ownsResponse() || result.canceled) return;
      const added: Pending[] = result.assets.map(asset => {
        const video = asset.type === "video";
        return { key: `media:${randomUUID()}`, uri: asset.uri,
          name: asset.fileName || (video ? "video.mp4" : "photo.jpg"),
          mimeType: asset.mimeType || (video ? /\.mov$/i.test(asset.fileName || asset.uri) ? "video/quicktime" : "video/mp4" : "image/jpeg"),
          kind: video ? "video" : "image" };
      });
      setPending(current => {
        if (!ownsResponse()) return current;
        const room = MAX_PENDING_ATTACHMENTS - current.length;
        return [...current, ...added.slice(0, Math.max(0, room))];
      });
      if (ownsResponse() && added.length > MAX_PENDING_ATTACHMENTS - pending.length) setError("Only the first 30 attachments were added. Send or remove some before choosing more.");
    } catch {
      if (ownsResponse()) setError("Could not open the photo library. Close it and try again.");
    } finally { if (pickerOperation.current === operation) mediaPickerFlight.current = false; }
  }

  /*
   * A recorded voice note joins the queue like any other attachment, so it
   * can go with a sentence rather than instead of one.
   */
  /*
   * A voice note goes the moment the thumb lifts.
   *
   * It used to be staged like a picked photo and wait for the send button,
   * which is the wrong shape for hold-to-talk: the gesture already said
   * "send this", and what an agent saw instead was their recording sitting in
   * the composer marked as an attachment while the customer got nothing.
   *
   * Staged and then sent on the next render rather than in one breath,
   * because send() reads the staged list out of state -- calling it here
   * would send the list as it was before this note was added to it.
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

    setVoiceReady((count) => count + 1);
  }

  useEffect(() => {
    if (voiceReady > 0) void send();
    // send() is rebuilt every render; the ticket is what marks a new recording.
  }, [voiceReady]);

  /*
   * Where this phone is, sent the way the web sends it.
   *
   * Telegram has a real location message and takes the coordinates. Messenger
   * has nothing of the kind, so it gets the same Google Maps link the web
   * writes into the reply box -- which is what a customer can actually open.
   */
  function closeLocationPicker() {
    locationModalEpoch.current++;
    setMapOpen(false);
  }

  async function openLocationPicker() {
    const epoch = ++locationModalEpoch.current;
    const owner = `${scopeId}:${id}`;
    const ownsModal = () => screenAlive.current && ownerRef.current === owner && locationModalEpoch.current === epoch;
    setMapOpen(true); setLocationError(""); setLocationReady(false);
    try {
      if (platform === "telegram") {
        if (!session?.user.id || !scopeId || !id) throw new Error("Sign in again before sending a location.");
        const attempt = await readLocationAttempt(locationAttemptKey(session.user.id, scopeId, id));
        if (ownsModal()) setLocationRecovery(attempt);
      } else if (ownsModal()) setLocationRecovery(null);
      if (ownsModal()) setLocationReady(true);
    } catch {
      if (ownsModal()) setLocationError("Could not read location delivery tracking. Close the map and try again before sending.");
    }
  }

  async function sendLocation({ latitude, longitude }: { latitude: number; longitude: number }, reconcileOnly = false) {
    const owner = `${scopeId}:${id}`;
    if (!id || !scopeId || sending || locationFlight.current === owner || !screenAlive.current || ownerRef.current !== owner) return;
    const sequence = ++locationSequence.current;
    const modalEpoch = locationModalEpoch.current;
    const ownsTransport = () => screenAlive.current && ownerRef.current === owner && locationSequence.current === sequence;
    const ownsResponse = () => ownsTransport() && locationModalEpoch.current === modalEpoch;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      setLocationError("Choose a valid location before sending."); return;
    }
    if (platform === "facebook" && !recipientId) {
      setLocationError("This Facebook customer has no Messenger recipient ID. Refresh the Inbox and try again."); return;
    }
    locationFlight.current = owner;
    const key = JSON.stringify([owner, recipientId, latitude, longitude]);
    let clientRequestId = locationAttempts.current.get(key);
    if (!clientRequestId) {
      clientRequestId = `optimistic:location.${randomUUID()}`;
      if (locationAttempts.current.size >= 8) locationAttempts.current.delete(locationAttempts.current.keys().next().value!);
      locationAttempts.current.set(key, clientRequestId);
    }
    setSending(true); setError(""); setLocationError("");
    try {
      if (platform === "telegram") {
        if (!session?.user.id) throw new Error("Sign in again before sending a location.");
        const storageKey = locationAttemptKey(session.user.id, scopeId, id);
        const previous = await readLocationAttempt(storageKey);
        if (!ownsTransport()) return;
        if (previous && !reconcileOnly) {
          if (ownsTransport()) setLocationRecovery(previous);
          throw new Error("An earlier location may have been delivered. Check delivery before sending another location.");
        }
        const attempt = previous ?? { requestId: clientRequestId.slice("optimistic:location.".length), latitude, longitude };
        if (reconcileOnly && !previous) throw new Error("No saved location request was found. Close and reopen the map.");
        const query = new URLSearchParams({ conversationId: id, requestId: attempt.requestId, latitude: String(attempt.latitude), longitude: String(attempt.longitude) });
        const tracked = await api<{ delivery: string; locationTracking: string }>(`/api/telegram/send-location?${query}`, scopeId);
        if (!ownsTransport()) return;
        if (tracked.locationTracking !== "v1") throw new Error("Location delivery tracking needs a newer TENH server. No retry was sent.");
        if (reconcileOnly) {
          if (tracked.delivery !== "confirmed") throw new Error("Location delivery is still unknown. Verify in Telegram and contact TENH support; do not resend it.");
          await clearLocationAttempt(storageKey, attempt.requestId);
          if (ownsTransport()) setLocationRecovery(null);
        } else {
          if (tracked.delivery !== "not_found") throw new Error("This location request already exists. Check delivery before sending.");
          // Preserve the selected point and request ID before any provider dispatch.
          await saveLocationAttempt(storageKey, attempt);
          if (!ownsTransport()) {
            // No POST was attempted: remove only this preflight reservation.
            await clearLocationAttempt(storageKey, attempt.requestId);
            return;
          }
          setLocationRecovery(attempt);
          if (!ownsTransport()) return;
          const sent = await api<{ delivery: string; locationTracking: string }>("/api/telegram/send-location", scopeId, {
            method: "POST", body: { conversationId: id, ...attempt },
          });
          if (sent.delivery !== "confirmed" || sent.locationTracking !== "v1") throw new Error("Location delivery is unknown. Check delivery; do not resend it.");
          await clearLocationAttempt(storageKey, attempt.requestId);
          if (ownsTransport()) setLocationRecovery(null);
        }
      } else {
        await api("/api/facebook/send", scopeId, { method: "POST", body: {
          conversationId: id, recipientId, clientRequestId,
          message: `📍 Location: https://www.google.com/maps?q=${latitude},${longitude}`,
        } });
      }
      locationAttempts.current.delete(key);
      if (ownsResponse()) setMapOpen(false);
      // A reopened picker keeps its own state; the thread still refreshes.
      if (ownsTransport()) void load().catch(() => {});
    } catch (locationError) {
      if (!ownsResponse()) return;
      const message = locationError instanceof Error ? locationError.message : "Unable to send that location.";
      setError(message); setLocationError(message);
    } finally {
      // Closing/reopening the modal does not orphan the transport lock.
      if (ownsTransport()) { locationFlight.current = null; setSending(false); }
    }
  }

  async function pickFile() {
    // The initiating render owns a queued iOS launch, not just matching thread IDs.
    if (!screenAlive.current || !focusedRef.current || !customerReadActivity.current.foreground || ownerRef.current !== `${scopeId}:${id}` || pickerContext.current.epoch !== pickerRenderEpoch || pickerContext.current.session !== session || pickerContext.current.owner !== repliesOwner || !session?.user.id) return;
    if (mediaPickerFlight.current || sending || pending.length >= MAX_PENDING_ATTACHMENTS) {
      if (pending.length >= MAX_PENDING_ATTACHMENTS) setError("Remove an attachment before adding more than 30 items.");
      return;
    }
    mediaPickerFlight.current = true;
    const pickerOwner = `${scopeId}:${id}`, epoch = pickerRenderEpoch, operation = ++pickerOperation.current;
    const ownsResponse = () => screenAlive.current && ownerRef.current === pickerOwner && pickerContext.current.epoch === epoch && pickerContext.current.session === session && pickerContext.current.owner === repliesOwner && pickerOperation.current === operation;
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled || !ownsResponse()) return;
      const added: Pending[] = result.assets.map((asset, index) => ({
        key: `${randomUUID()}:${index}`, uri: asset.uri,
        name: asset.name || "attachment", mimeType: asset.mimeType || "application/octet-stream",
        kind: kindOf(asset.mimeType ?? "", asset.name ?? ""),
      }));
      setPending(current => ownsResponse() ? [...current, ...added.slice(0, Math.max(0, MAX_PENDING_ATTACHMENTS - current.length))] : current);
      if (ownsResponse() && added.length > MAX_PENDING_ATTACHMENTS - pending.length) setError("Only the first 30 attachments were added. Send or remove some before choosing more.");
    } catch (cause) {
      if (ownsResponse()) setError(cause instanceof Error ? cause.message : "Could not open Documents. Close the picker and try again.");
    } finally { if (pickerOperation.current === operation) mediaPickerFlight.current = false; }
  }

  /*
   * The version of this file that will fit through the door.
   *
   * The deployment caps a request body at 4.5 MB and counts the whole
   * multipart request, so two 2.6 MB photos in one album came back "Request
   * Entity Too Large" and took the message with them. Photos over the
   * threshold are resized on the way out; video and files are sent as they
   * are, because re-encoding those is a different job with different
   * trade-offs.
   */
  async function sendable(file: Pending): Promise<Pending> {
    if (file.kind !== "image") return file;

    const smaller = await shrinkImage(file.uri, /\.(heic|heif|avif)$/i.test(file.name || file.uri) || !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(file.mimeType));

    if (!smaller.shrank) return file.mimeType === "image/jpg" ? { ...file, mimeType: "image/jpeg" } : file;

    return {
      ...file,
      uri: smaller.uri,
      mimeType: smaller.mimeType || file.mimeType,
      name: file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg",
    };
  }

  async function uploadOne(original: Pending, caption = "", replyToMessageId?: string) {
    const file = original;
    const photoOrVideo = file.kind === "image" || file.kind === "video";
    const path =
      platform === "telegram"
        ? photoOrVideo
          ? "/api/telegram/send-photo"
          : "/api/telegram/send-media"
        : "/api/facebook/send-attachment";

    await uploadNativeFile(path, scopeId, file, {
      conversationId: String(id),
      kind: file.kind,
      ...(replyToMessageId ? { replyToMessageId } : {}),
      ...(platform === "facebook" ? { recipientId } : {}),
      ...(caption ? { caption } : {}),
    });
  }

  async function uploadAlbum(originals: Pending[], caption = "", replyToMessageId?: string) {
    const files = originals;

    if (platform === "telegram") {
      await uploadMany(
        "/api/telegram/send-photo",
        scopeId,
        files.map((file) => ({ ...file, fieldName: "files" })),
        { conversationId: String(id), ...(replyToMessageId ? { replyToMessageId } : {}), ...(caption ? { caption } : {}) },
      );
      return;
    }

    await uploadMany(
      "/api/facebook/send-attachment",
      scopeId,
      files.map((file, index) => ({
        ...file,
        fieldName: index === 0 ? "file" : "additionalFiles",
      })),
      { conversationId: String(id), recipientId, kind: "image", ...(replyToMessageId ? { replyToMessageId } : {}) },
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
      await api(`/api/facebook/comments/${action}`, scopeId, {
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

  /* The fields every message this screen draws for itself shares. */
  function optimisticBase(messageId: string, at: string) {
    return {
      id: messageId,
      platform_message_id: messageId,
      conversation_id: String(id),
      sender_type: "page",
      sender_platform_id: conversation?.social_account?.platform_account_id ?? "",
      recipient_platform_id: recipientId,
      direction: "outgoing",
      platform_created_at: at,
      created_at: at,
      comment_is_liked: false,
      comment_is_hidden: false,
      comment_is_deleted: false,
      comment_deleted_by: null,
      delivery_status: null,
      delivered_at: null,
      seen_at: null,
    } satisfies Omit<
      InboxMessage,
      "message_type" | "message_text" | "attachment_url" | "raw_payload"
    >;
  }

  function optimisticMessage(file: Pending, index: number, at: string): InboxMessage {
    return {
      ...optimisticBase(`optimistic:inbox:${at}:${index}`, at),
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
    };
  }

  function optimisticText(body: string, messageId: string, at: string): InboxMessage {
    return {
      ...optimisticBase(messageId, at),
      message_type: "text",
      message_text: body,
      attachment_url: null,
      raw_payload: null,
    };
  }

  /*
   * The last check before two answers reach one customer.
   *
   * Presence already says who else is in the thread, but a strip above the
   * composer is read by somebody looking at the composer -- and by the time a
   * reply is written the eye has been on the keyboard for a minute. So when a
   * colleague has a half-written reply of their own, sending asks once.
   *
   * Only for a colleague who is actually writing. Somebody merely reading the
   * thread is not a reason to interrupt: a confirmation that appears when
   * nothing is wrong is one people learn to tap through.
   */
  async function send() {
    if (sending || sendFlight.current) return;
    if (typists.length > 0 && !confirmedOverlapRef.current) {
      const who =
        typists.length === 1
          ? typists[0].name
          : `${typists.length} teammates`;

      Alert.alert(
        `${who} ${typists.length === 1 ? "is" : "are"} writing a reply`,
        "Send yours as well, or wait and see what they say?",
        [
          { text: "Wait", style: "cancel" },
          {
            text: "Send anyway",
            onPress: () => {
              confirmedOverlapRef.current = true;
              void send().finally(() => {
                confirmedOverlapRef.current = false;
              });
            },
          },
        ],
      );

      return;
    }

    const text = draft.trim();

    if ((!text && pending.length === 0) || !id || sending) {
      return;
    }
    if (pending.length > MAX_PENDING_ATTACHMENTS) {
      setError("Send up to 30 attachments at a time. Remove the extra attachments first.");
      return;
    }

    if (pending.some(file => file.deliveryUnknown) || draftSendUnknown) {
      setError("A previous send may have reached the customer. Verify the thread, then remove the uncertain attachment or edit/clear the uncertain text before sending again."); return;
    }

    if (replyingToComment) {
      const target = replyingToComment;
      const commentId = facebookCommentId(target);

      if (!text || !commentId || sending) return;
      if (pending.length > 0) {
        setError("Facebook comment replies can only contain text. Remove the queued attachments first.");
        return;
      }

      sendFlight.current = true;
      setSending(true);
      setError("");
      setDraft("");

      try {
        await api("/api/facebook/comments/reply", scopeId, {
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
        sendFlight.current = false;
        setSending(false);
      }

      return;
    }

    if (platform === "facebook" && !recipientId) {
      setError("This Facebook customer has no Messenger recipient ID. Refresh the Inbox and try again.");
      return;
    }

    const replySelectionSnapshot = quotedSelection.current;
    let quotedSnapshot: InboxMessage | null;
    try { quotedSnapshot = currentQuote(replySelectionSnapshot); }
    catch (quoteError) {
      setError(quoteError instanceof Error ? quoteError.message : "Choose the reply message again.");
      return;
    }
    sendFlight.current = true;
    const sendOwner = `${scopeId}:${id}`;
    const ownsSend = () => screenAlive.current && ownerRef.current === sendOwner;
    let prepared: SizedAttachment[];
    setSending(true);
    try {
      prepared = await Promise.all(pending.map(async original => {
        const file = await sendable(original);
        return { ...file, name: file.name.slice(0, 140), bytes: fileSize(file.uri) };
      }));
      if (!ownsSend()) { sendFlight.current = false; return; }
      const issues = new Map(prepared.flatMap(file => {
        const issue = attachmentIssue(file, platform); return issue ? [[file.key, issue] as const] : [];
      }));
      if (issues.size) {
        setPending(current => current.map(file => ({ ...file, error: issues.get(file.key) })));
        setError("Some attachments cannot be sent. Review the item errors and choose smaller or supported files.");
        setSending(false); sendFlight.current = false; return;
      }
    } catch {
      if (ownsSend()) { setError("Could not prepare the attachments. Pick the affected files again."); setSending(false); }
      sendFlight.current = false; return;
    }
    try {
      if (quotedSnapshot && quotedSelection.current !== replySelectionSnapshot) throw new Error("The reply was cancelled or changed. Review the message before sending.");
      quotedSnapshot = currentQuote(replySelectionSnapshot);
    }
    catch (quoteError) {
      setError(quoteError instanceof Error ? quoteError.message : "Choose the reply message again.");
      setSending(false); sendFlight.current = false; return;
    }
    const pendingSnapshot = [...pending];
    const storageSendOwner = storageOwner;
    beginStorageDraftSend(storageSendOwner, pendingSnapshot);
    const sentFileKeys = new Set<string>();
    let activeBatch: Pending[] = [];
    let textConfirmed = false;
    let textInFlight = false;
    let captionInFlight = false;
    const sentAt = new Date().toISOString();
    const textId = `optimistic:text:${sentAt}`;
    const optimisticIds = [
      ...pendingSnapshot.map((_, index) => `optimistic:inbox:${sentAt}:${index}`),
      textId,
    ];
    const visualFiles = pendingSnapshot.filter((file) => file.kind === "image" || file.kind === "video");
    const telegramCaption = platform === "telegram" && visualFiles.length > 0 && visualFiles.length === pendingSnapshot.length && text.length <= 1024 ? text : "";
    const preview = text || (pendingSnapshot[0]?.kind === "audio" ? "You sent a voice message" : pendingSnapshot[0]?.kind === "video" ? "You sent a video" : pendingSnapshot[0]?.kind === "image" ? "You sent a photo" : pendingSnapshot[0] ? `You sent ${pendingSnapshot[0].name}` : "");

    setSending(true);
    setError("");
    setDraft("");
    setPending([]);
    setQuoted(null);
    setFromQuickReply(false);
    /*
     * Drawn before the request, not after it.
     *
     * Attachments already appeared straight away; a typed message did not --
     * it left the box and nothing took its place until the send came back and
     * the thread reloaded, which on a Cambodian mobile connection is a couple
     * of seconds of a screen that looks like it ate the message.
     */
    const drawn: InboxMessage[] = [
      ...(text ? [optimisticText(text, textId, sentAt)] : []),
      ...pendingSnapshot.map((file, index) => optimisticMessage(file, index, sentAt)),
    ];

    if (drawn.length > 0) {
      setMessages((current) => mergeMessages(current, drawn));
    }
    updateConversation(String(id), { last_message_text: preview, last_message_at: sentAt });

    try {
      const batches = attachmentBatches(prepared, platform);
      for (const [index, batch] of batches.entries()) {
        if (!ownsSend()) return;
        const replyTarget = quotedSnapshot && replySelectionSnapshot ? resolveSelection(replySelectionSnapshot) : null;
        if (quotedSnapshot && !replyTarget) throw new Error("The reply target changed. Choose the message again.");
        const replyId = replyTarget?.photo.id;
        const caption = index === 0 ? telegramCaption : "";
        activeBatch = batch;
        captionInFlight = !!caption;
        if (batch.length === 1) await uploadOne(batch[0], caption, replyId);
        else await uploadAlbum(batch, caption, replyId);
        batch.forEach(file => sentFileKeys.add(file.key));
        if (caption) textConfirmed = true;
        captionInFlight = false;
        activeBatch = [];
      }

      if (text && !telegramCaption) {
        if (!ownsSend()) return;
        const replyTarget = quotedSnapshot && replySelectionSnapshot ? resolveSelection(replySelectionSnapshot) : null;
        if (quotedSnapshot && !replyTarget) throw new Error("The reply target changed. Choose the message again.");
        textInFlight = true;
        await api(`/api/${platform}/send`, scopeId, {
          method: "POST",
          body: {
            conversationId: id,
            message: text,
            ...(platform === "facebook" ? { recipientId } : {}),
            /*
             * The quote, when there is one. Both send routes take a TENH
             * message id and resolve it to the platform's own -- Telegram's
             * message id, Messenger's mid -- and both ignore one that does
             * not belong to this conversation.
             */
            ...(quotedSnapshot
              ? { replyToMessageId: replyTarget!.photo.id }
              : {}),
          },
        });
        textConfirmed = true; textInFlight = false;
      }

      if (!ownsSend()) return;
      setMessages((current) => current.filter((message) => !optimisticIds.includes(message.id)));
      void load().catch(() => {});
    } catch (sendError) {
      if (!ownsSend()) return;
      const failedKeys = new Set(activeBatch.map(file => file.key));
      const failureMessage = sendError instanceof Error ? sendError.message : "Upload response was lost.";
      if (textInFlight || captionInFlight) setDraftSendUnknown(true);
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
      if (!textConfirmed) setDraft((current) => current || text);
      if (quotedSnapshot) setQuoted(current => current ?? quotedSnapshot);
      setPending((current) => {
        const held = new Set(current.map((file) => file.key));
        return [
          ...pendingSnapshot.filter(
            (file) => !sentFileKeys.has(file.key) && !held.has(file.key),
          ).map(file => ({ ...file,
            error: failedKeys.has(file.key) ? `${failureMessage} Delivery is unknown; verify the thread before removing this item.` : "Not sent because an earlier upload failed.",
            deliveryUnknown: failedKeys.has(file.key),
          })),
          ...current,
        ];
      });

      void load().catch(() => {});
    } finally {
      finishStorageDraftSend(storageSendOwner, sentFileKeys, new Set(activeBatch.map(file => file.key)), pendingQueue.current);
      sendFlight.current = false;
      if (ownsSend()) setSending(false);
    }
  }

  function setCustomerReadActivity(nextFocused: boolean, nextForeground: boolean) {
    const activity = customerReadActivity.current;
    if (activity.owner !== customerOwnerRef.current) {
      activity.owner = customerOwnerRef.current;
      activity.epoch++;
      activity.dirty = false;
    }
    if (activity.focused === nextFocused && activity.foreground === nextForeground) return;
    activity.focused = nextFocused;
    activity.foreground = nextForeground;
    activity.epoch++;
    if (customerReadFlight.current?.owner === customerOwnerRef.current) {
      customerRequest.current++;
      activity.dirty = true;
    }
  }

  const loadCustomer = useCallback(async (fresh = false): Promise<CustomerDetail | null> => {
    if (!contactId) return null;
    const owner = `${scopeId}:${id}:${contactId}`;
    if (authSessionGeneration() !== flowAuthGeneration || !screenAlive.current || repliesOwnerRef.current !== repliesOwner || customerOwnerRef.current !== owner) return null;
    const activity = customerReadActivity.current;
    if (!activity.focused || !activity.foreground || tagMutationFlight.current) {
      activity.dirty = true;
      return null;
    }
    const pendingRead = customerReadFlight.current;
    if (pendingRead?.owner === owner && pendingRead.readOwner === repliesOwner) {
      // Invalidate the transport, not merely a logical cachedApi waiter.
      activity.dirty = true;
      customerRequest.current++;
      if (!pendingRead.next) {
        pendingRead.next = pendingRead.work.then(() => {
          if (authSessionGeneration() !== flowAuthGeneration || !screenAlive.current || repliesOwnerRef.current !== repliesOwner || customerOwnerRef.current !== owner || !activity.dirty ||
              !activity.focused || !activity.foreground || tagMutationFlight.current) return null;
          return loadCustomer(true);
        });
      }
      return pendingRead.next;
    }
    const sequence = ++customerRequest.current;
    const mutation = tagMutationEpoch.current, epoch = activity.epoch;
    const owns = () => authSessionGeneration() === flowAuthGeneration && screenAlive.current && repliesOwnerRef.current === repliesOwner && customerOwnerRef.current === owner &&
      activity.owner === owner && activity.focused && activity.foreground && activity.epoch === epoch &&
      sequence === customerRequest.current && mutation === tagMutationEpoch.current;
    activity.dirty = false;
    setCustomerLoading(true);
    const flight = { owner, readOwner: repliesOwner, work: Promise.resolve<CustomerDetail | null>(null), next: null as Promise<CustomerDetail | null> | null };
    customerReadFlight.current = flight;
    const work = (async () => {
      try {
        const path = `/api/customers/${encodeURIComponent(contactId)}`;
        const data = fresh || tagLocalEdits.current.size > 0
          ? await api<CustomerDetail>(path, scopeId, { expectedUserId: session?.user.id })
          : await cachedRead<CustomerDetail>(JSON.stringify([session?.user.id, scopeId, path, metadataMemberId, flowAuthGeneration]),
            () => api<CustomerDetail>(path, scopeId, { expectedUserId: session?.user.id }), { freshMs: 0, onCached: data => {
            if (!owns()) return;
            setCustomer(data);
            setAssigned(new Set((data.customer.tags ?? []).map(tag => tag.id)));
            setCustomerLoading(false);
          } });
        if (!owns()) return null;
        tagLocalEdits.current.clear();
        const items = data.customer.tags ?? [];
        tagInboxSnapshot.current = { owner, tags: items.map(tag => tag.id).sort().join(","), items };
        setCustomer(data);
        setAssigned(new Set(items.map(tag => tag.id)));
        updateContactTags(contactId, items.map(tag => ({ id: tag.id, name: tag.name, color: tag.color ?? colors.muted })));
        return data;
      } catch (customerError) {
        if (!owns()) return null;
        if (customerError instanceof ApiError && [401, 403, 404].includes(customerError.status)) {
          setCustomer(null);
          setAssigned(new Set());
        }
        setError(customerError instanceof Error ? customerError.message : "Unable to load this customer.");
        return null;
      } finally {
        if (authSessionGeneration() === flowAuthGeneration && customerReadFlight.current === flight) {
          customerReadFlight.current = null;
          if (authSessionGeneration() === flowAuthGeneration && screenAlive.current && repliesOwnerRef.current === repliesOwner && customerOwnerRef.current === owner) setCustomerLoading(false);
        }
      }
    })();
    flight.work = work;
    return work;
  }, [contactId, scopeId, id, repliesOwner, session?.user.id, metadataMemberId, flowAuthGeneration, setCustomer, updateContactTags]);

  // Use the website's per-message eligibility; comment replies keep their own composer.
  const replyable = conversation?.source_type !== "comment";
  const messageActionBusy = useRef<{ owner: string } | null>(null);
  const [messageActionPending, setMessageActionPending] = useState(false);
  const [reactionPreview, setReactionPreview] = useState<{ id: string; emoji: string | null } | null>(null);
  const actionScope = useRef({ key: "", epoch: 0, value: "", activityEpoch: customerReadActivity.current.epoch });
  const actionKey = conversation && session ? JSON.stringify([session.user.id, conversation.business_id,
    storageWorkspace?.memberId, id, conversation.social_account?.id, platform, conversation.source_type,
    workspace?.businessId, storageReady, focused, foreground, customerReadActivity.current.epoch]) : "";
  if (actionScope.current.key !== actionKey) {
    actionScope.current = { key: actionKey, epoch: actionScope.current.epoch + 1,
      value: actionKey ? JSON.stringify([actionKey, actionScope.current.epoch + 1]) : "", activityEpoch: customerReadActivity.current.epoch };
  }
  const actionOwner = actionScope.current.value;
  const resolveSelection = useCallback((selection: MessageActionSelection) => {
    if (!screenAlive.current || !focusedRef.current || !customerReadActivity.current.foreground) return null;
    if (actionScope.current.activityEpoch !== customerReadActivity.current.epoch) return null;
    return resolveMessageAction(selection, actionScope.current.value, messagesRef.current);
  }, []);
  useEffect(() => {
    messageMenu.current?.close(); quotedSelection.current = null; setQuoted(null);
    messageActionBusy.current = null; downloadFlight.current = null;
    setMessageActionPending(false); setReactionPreview(null); setSaving(false);
  }, [actionOwner]);

  function currentQuote(selection = quotedSelection.current) {
    if (!quoted) return null;
    const target = selection ? resolveSelection(selection) : null;
    if (!target || !getMessageActions(target.message, platform).reply || !replyable) {
      throw new Error("The reply target is no longer available. Choose the message again or cancel the reply.");
    }
    return target.photo;
  }

  async function actOnMessage(target: InboxMessage, action: "pin" | "reaction", emoji: string | null = null, telegramCapability?: TelegramReactionCapability | null) {
    if (messageActionBusy.current || target.conversation_id !== String(id)) return;
    const scope = actionScope.current.value;
    const telegramReaction = action === "reaction" && platform === "telegram";
    if (telegramReaction && (!telegramCapability || !canUseTelegramReaction(telegramCapability, target, scope) || telegramCapability.scope.businessId !== conversation?.business_id || !session?.user.id)) return;
    if (!screenAlive.current || !focusedRef.current || !customerReadActivity.current.foreground || !scope) return;
    const reactionAuthGeneration = telegramReaction ? telegramCapability!.authGeneration : null;
    const ownsReactionAuth = () => !telegramReaction || authSessionGeneration() === reactionAuthGeneration;
    const flight = { owner: scope };
    messageActionBusy.current = flight;
    const activityEpoch = customerReadActivity.current.epoch;
    const ownsReactionContext = () => ownsReactionAuth() && screenAlive.current && focusedRef.current && customerReadActivity.current.foreground &&
      customerReadActivity.current.epoch === activityEpoch && actionScope.current.value === scope;
    const ownsAction = () => ownsReactionContext() && messageActionBusy.current === flight;
    setMessageActionPending(true);
    if (action === "reaction" && !telegramReaction) setReactionPreview({ id: target.id, emoji });
    messageMenu.current?.close();
    try {
      if (telegramReaction && telegramCapability && session) {
        const confirmed = await sendTelegramReaction(telegramCapability, target, scope, emoji, session.user.id);
        if (ownsAction()) setMessages(current => ownsReactionContext() ? applyTelegramReactionState(current, confirmed.scope, confirmed.state) : current);
        return;
      }
      const result = await api<{ message?: InboxMessage; timestamp?: number; warning?: string }>(
        action === "pin" ? `/api/conversations/${encodeURIComponent(String(id))}/message-pins` : "/api/facebook/messages/reaction",
        scopeId, {
          method: action === "pin" ? "PATCH" : "POST",
          body: action === "pin" ? { messageId: target.id, pinned: !isMessagePinned(target) }
            : { conversationId: target.conversation_id, messageId: target.id, reaction: emoji },
        });
      if (!ownsAction()) return;
      if (action === "pin" && result.message) {
        const confirmed = result.message;
        setPinUpdates(current => [...current.filter(row => row.id !== confirmed.id), confirmed].slice(-100));
      }
      setMessages(current => current.map(row => {
        if (row.id !== target.id) return row;
        if (action === "reaction") {
          const confirmed = getMessengerReaction(result.message?.raw_payload, "page") ?? { emoji, timestamp: result.timestamp ?? Date.now() };
          return { ...row, raw_payload: withMessengerReaction(row.raw_payload, "page", confirmed) };
        }
        const pin = result.message?.raw_payload?.tenh_message_pin;
        const existing = record(row.raw_payload?.tenh_message_pin);
        if (!pin || String(existing?.updated_at ?? "") > String(record(pin)?.updated_at ?? "")) return row;
        return { ...row, raw_payload: { ...row.raw_payload, tenh_message_pin: pin } };
      }));
      if (result.warning) Alert.alert("Reaction", result.warning);
    } catch (error) {
      if (ownsAction()) Alert.alert("Message action", error instanceof Error ? error.message : telegramReaction ? "The bot reaction result is unconfirmed. Do not retry; refresh and review Telegram." : "Unable to save. Please try again.");
      if (telegramReaction && telegramCapability && session && ownsAction()) {
        // Refresh durable state after uncertainty; never resend the provider action.
        try {
          const current = await loadTelegramReactionCapability(target, scope, telegramCapability.scope.businessId, telegramCapability.scope.accountId, session.user.id);
          if (ownsAction() && current?.state) setMessages(rows => ownsReactionContext() ? applyTelegramReactionState(rows, current.scope, current.state!) : rows);
        } catch { /* The error below still states the action is unconfirmed. */ }
      }
    } finally {
      if (messageActionBusy.current === flight) {
        messageActionBusy.current = null;
        if (ownsReactionAuth() && screenAlive.current && actionScope.current.value === scope) { setMessageActionPending(false); setReactionPreview(null); }
      }
    }
  }

  function copyMessage(message: InboxMessage) {
    const text = message.message_text?.trim();

    if (!text) return;

    void Clipboard.setStringAsync(text);
    messageMenu.current?.close();
  }

  /*
   * Saving what a message carries.
   *
   * Downloaded with the session cookie when the file is proxied through TENH,
   * because that is the only way those bytes come out at all. A picture or a
   * clip goes to the phone's gallery, where somebody expects to find it;
   * anything else is handed to the share sheet, which is Android's own answer
   * to "where should this go".
   */
  async function downloadMessage(message: InboxMessage, selection: MessageActionSelection) {
    const url = message.attachment_url;

    if (!url || saving || !resolveSelection(selection)) return;
    const flight = {}; downloadFlight.current = flight;
    const owns = () => downloadFlight.current === flight && Boolean(resolveSelection(selection));
    let lease: MessageDownloadLease | null = null;
    setSaving(true);

    try {
      const target = resolveMedia(url);

      if (!target) throw new Error("This attachment has no address.");

      const folder = new Directory(Paths.cache, "tenh-downloads");

      if (!folder.exists) folder.create({ intermediates: true });

      const name =
        words(record(record(message.raw_payload)?.tenh_attachment)?.name) ||
        `tenh-${message.id.slice(0, 8)}${extensionFor(message, target.uri)}`;

      // Native downloads can outlive a blur/owner reset. Give each operation
      // an immutable destination, including when provider filenames match.
      // Keep shared files in cache: Android can consume them after shareAsync
      // resolves, so deleting/reusing one at that point would break the share.
      const safeName = name.replace(/[\/\\\u0000-\u001f]/g, "_").slice(0, 140);
      const operationId = randomUUID();
      const file = new File(folder, `${operationId}-${safeName}`);
      lease = reserveMessageDownload(file, operationId);

      const saved = await File.downloadFileAsync(target.uri, file, {
        headers: target.headers,
        idempotent: false,
      });
      completeMessageDownload(lease);

      /*
       * Handed to Android's own share sheet, which is where "save this" lives
       * on this phone: Photos, Drive, Files, a chat app, whatever is
       * installed. Writing to the gallery directly needs expo-media-library,
       * whose native module Expo Go does not carry -- it threw the moment
       * anybody pressed Download, which is a worse answer than one extra tap.
       */
      const sharingAvailable = await Sharing.isAvailableAsync();
      if (!owns()) return;
      protectMessageDownloadShare(lease);
      if (sharingAvailable) {
        await Sharing.shareAsync(saved.uri);
      } else {
        Alert.alert("Saved", `It is on this phone as ${name}.`);
      }

      if (owns()) messageMenu.current?.close();
    } catch (downloadError) {
      if (!owns()) return;
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Unable to save that.",
      );
    } finally {
      if (lease) { try { releaseMessageDownload(lease); } catch { /* Cache admission stays guarded until a later safe sweep. */ } }
      if (downloadFlight.current === flight) { downloadFlight.current = null; if (screenAlive.current) setSaving(false); }
    }
  }

  /*
   * A reminder, on the same endpoint the website's follow-up panel uses.
   *
   * Assigned to whoever is setting it. The web lets an owner hand a follow-up
   * to somebody else, which is a picker and a decision; on a phone, the
   * person who just read the message is the person who will chase it, and
   * assigning it anywhere else is a job for the desk.
   */
  async function createReminder(note: string, remindAt: string) {
    const flight = beginPanelAction("reminder");
    if (!flight) return false;
    try {
      if (!contactId || !metadataMemberId) throw new Error("Reminders need a customer and a signed-in member.");
      await api("/api/reminders", scopeId, {
        method: "POST", expectedUserId: session?.user.id,
        body: { conversationId: String(id), contactId, assignedTo: metadataMemberId, note, remindAt },
      });
      return ownsPanelAction(flight);
    } catch (remindError) {
      if (ownsPanelAction(flight)) setError(remindError instanceof Error ? remindError.message : "Unable to set that reminder.");
      return false;
    } finally { finishPanelAction(flight); }
  }

  /*
   * Everything this customer has sent or had saved against them.
   *
   * The endpoint answers with two lists -- files somebody saved to the record
   * and every attachment that came through a conversation -- and they are
   * flattened into one here. "Where is that receipt" is one question, and
   * which of the two lists holds the answer is not the customer's problem.
   */
  async function loadFiles(signal: AbortSignal): Promise<CustomerFile[]> {
    if (authSessionGeneration() !== flowAuthGeneration || !contactId || !scopeId || !session?.user.id) throw new ApiError("This customer is no longer available.", 403);
    const owner = customerOwnerRef.current, readOwner = repliesOwner;

    try {
      const data = await api<{
        savedFiles?: {
          id: string;
          itemType: "file" | "link";
          displayName: string | null;
          externalUrl: string | null;
          previewUrl: string | null;
          mimeType: string | null;
          sizeBytes: number | null;
          description: string | null;
          createdAt: string;
        }[];
        conversationAttachments?: {
          id: string;
          messageType: string;
          messageText: string | null;
          attachmentUrl: string;
          createdAt: string;
        }[];
      }>(`/api/customers/${encodeURIComponent(contactId)}/files`, scopeId, { signal, expectedUserId: session.user.id });
      if (authSessionGeneration() !== flowAuthGeneration || signal.aborted || !screenAlive.current || repliesOwnerRef.current !== readOwner || customerOwnerRef.current !== owner || !focusedRef.current || !customerReadActivity.current.foreground) throw new ApiError("Customer files read was cancelled.", 409);

      /*
       * A saved file is filed by what it actually is, not by the two buckets
       * the endpoint stores it in: a photo somebody saved to the record
       * belongs with the photos, not in a list of documents named after
       * their file names.
       */
      const saved: CustomerFile[] = (data.savedFiles ?? []).map((file) => ({
        id: `saved:${file.id}`,
        kind:
          file.itemType === "link"
            ? "link"
            : file.mimeType?.startsWith("image/")
              ? "image"
              : file.mimeType?.startsWith("video/")
                ? "video"
                : "file",
        name: file.displayName || (file.itemType === "link" ? "Link" : "File"),
        url: file.previewUrl ?? file.externalUrl,
        detail:
          file.description ||
          (file.sizeBytes ? readableSize(file.sizeBytes) : null),
        createdAt: file.createdAt,
        /* The row id outlives the signed preview link the thumbnail uses. */
        cacheKey: `saved:${file.id}`,
      }));

      /*
       * Voice notes are left out.
       *
       * A customer who sends five voice messages a day fills this list with
       * rows that all read the same and open a player -- and somebody opening
       * "Files, documents & links" is looking for a receipt or an address,
       * not for a recording they can already hear in the thread.
       */
      const sent: CustomerFile[] = (data.conversationAttachments ?? [])
        .filter(
          (attachment) =>
            !["audio", "voice"].includes(attachment.messageType ?? ""),
        )
        .map((attachment) => ({
          id: `sent:${attachment.id}`,
          kind:
            attachment.messageType === "image" ||
            attachment.messageType === "sticker"
              ? ("image" as const)
              : attachment.messageType === "video"
                ? ("video" as const)
                : ("file" as const),
          name:
            attachment.messageText?.trim() ||
            `${attachment.messageType || "Attachment"} in the conversation`,
          url: attachment.attachmentUrl,
          detail: "Sent in a conversation",
          createdAt: attachment.createdAt,
          cacheKey: `sent:${attachment.id}`,
        }));

      return [...saved, ...sent].sort(
        (first, second) =>
          new Date(second.createdAt).getTime() -
          new Date(first.createdAt).getTime(),
      );
    } catch (filesError) { throw filesError; }
  }

  async function loadHistory(signal: AbortSignal): Promise<TimelineItem[]> {
    if (authSessionGeneration() !== flowAuthGeneration || !contactId || !scopeId || !session?.user.id) throw new ApiError("This customer is no longer available.", 403);
    const owner = customerOwnerRef.current, readOwner = repliesOwner;
    const data = await api<{ items: TimelineItem[] }>(
      `/api/customers/${encodeURIComponent(contactId)}/timeline`, scopeId, { signal, expectedUserId: session.user.id },
    );
    if (authSessionGeneration() !== flowAuthGeneration || signal.aborted || !screenAlive.current || repliesOwnerRef.current !== readOwner || customerOwnerRef.current !== owner || !focusedRef.current || !customerReadActivity.current.foreground) throw new ApiError("Customer history read was cancelled.", 409);
    return data.items ?? [];
  }

  async function openTags() {
    if (authSessionGeneration() !== flowAuthGeneration) return;
    setError("");
    setTagOpen(true);
    setAssigned(new Set((conversation?.contact?.tags ?? []).map(tag => tag.id)));

    // A tag picker needs current assignments, not a panel's cached preview.
    await loadCustomer(true);
  }
  async function loadTagDefinitions(signal: AbortSignal): Promise<Tag[]> {
    if (authSessionGeneration() !== flowAuthGeneration) throw new ApiError("Tag read was cancelled.", 409);
    const data = await api<{ tags: Tag[] }>("/api/tags?activeOnly=true", scopeId, { signal, expectedUserId: session?.user.id });
    if (authSessionGeneration() !== flowAuthGeneration || signal.aborted || !screenAlive.current || metadataOwnerRef.current !== metadataOwner || !focusedRef.current || !customerReadActivity.current.foreground) throw new ApiError("Tag read was cancelled.", 409);
    return data.tags ?? [];
  }

  async function loadTeamMembers(signal: AbortSignal): Promise<TeamMember[]> {
    if (authSessionGeneration() !== flowAuthGeneration) throw new ApiError("Team read was cancelled.", 409);
    const data = await api<{ members: TeamMember[] }>("/api/team/members", scopeId, { signal, expectedUserId: session?.user.id });
    if (authSessionGeneration() !== flowAuthGeneration || signal.aborted || !screenAlive.current || metadataOwnerRef.current !== metadataOwner || !focusedRef.current || !customerReadActivity.current.foreground) throw new ApiError("Team read was cancelled.", 409);
    return data.members ?? [];
  }
  useEffect(() => {
    // The protected customer read and local mutation own the picker state.
    // An older Inbox bootstrap must not undo a successful tag change.
    if (tagOpen && !busyTagId && customer && focused && foreground && !customerReadActivity.current.dirty) {
      setAssigned(new Set((customer.customer.tags ?? []).map(tag => tag.id)));
    }
  }, [tagOpen, busyTagId, customer?.customer.tags, focused, foreground]);
  useEffect(() => {
    if (!contactId || !screenAlive.current) return;
    const owner = `${scopeId}:${id}:${contactId}`;
    if (customerOwnerRef.current !== owner) return;
    const items = conversation?.contact?.tags ?? [];
    const inboxTags = items.map(tag => tag.id).sort().join(",");
    const previous = tagInboxSnapshot.current;
    const changed = previous?.owner === owner && previous.tags !== inboxTags;
    tagInboxSnapshot.current = { owner, tags: inboxTags, items };
    const activity = customerReadActivity.current;
    const waiting = customerReadFlight.current?.owner === owner;
    const customerTags = (customer?.customer.tags ?? []).map(tag => tag.id).sort().join(",");
    if ((changed && (tagOpen || waiting || activity.dirty || tagMutationFlight.current)) ||
        (tagOpen && customer?.customer.id === contactId && inboxTags !== customerTags)) {
      activity.dirty = true;
      customerRequest.current++;
    }
    if (!activity.focused || !activity.foreground) {
      setCustomerLoading(false);
      return;
    }
    if (!activity.dirty) return;
    if (tagOpen) {
      const preview = new Set(items.map(tag => tag.id));
      for (const [tagId, selected] of tagLocalEdits.current) {
        if (selected) preview.add(tagId); else preview.delete(tagId);
      }
      setAssigned(preview);
    }
    // One pending flag survives inactive transitions and mutation completion.
    // One queued transport per flight starts only for the current active owner.
    if (!tagMutationFlight.current) void loadCustomer(true);
  }, [tagOpen, busyTagId, conversation?.contact?.tags, customer?.customer.id, focused, foreground, loadCustomer]);


  async function toggleTag(tag: Tag) {
    if (authSessionGeneration() !== flowAuthGeneration || !contactId || !scopeId || !session?.user.id || !metadataMemberId || conversation?.business_id !== scopeId || tagMutationFlight.current ||
        !customerReadActivity.current.focused || !customerReadActivity.current.foreground) {
      return;
    }
    const owner = `${scopeId}:${id}:${contactId}`;
    if (!screenAlive.current || repliesOwnerRef.current !== repliesOwner || customerOwnerRef.current !== owner) return;
    const flight = {};
    tagMutationFlight.current = flight;
    tagMutationEpoch.current++;
    customerRequest.current++;
    setCustomerLoading(false);
    const ownsContext = () => authSessionGeneration() === flowAuthGeneration && screenAlive.current &&
      panelContext.current.value === panelOwner && repliesOwnerRef.current === repliesOwner && customerOwnerRef.current === owner;
    const owns = () => ownsContext() && tagMutationFlight.current === flight;

    const on = assigned.has(tag.id);
    const previousEdit = tagLocalEdits.current.get(tag.id);
    tagLocalEdits.current.set(tag.id, !on);
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
      if (!ownsContext()) return current;
      const next = new Set(current);

      if (on) {
        next.delete(tag.id);
      } else {
        next.add(tag.id);
      }

      return next;
    });

    if (contactId) {
      tagInboxSnapshot.current = { owner, tags: nextConversationTags.map(tag => tag.id).sort().join(","), items: nextConversationTags };
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
          scopeId,
          { method: "DELETE", expectedUserId: session?.user.id },
        );
      } else {
        await api(
          `/api/contacts/${encodeURIComponent(contactId)}/tags`,
          scopeId,
          { method: "POST", expectedUserId: session?.user.id, body: { tagId: tag.id, conversationId: id } },
        );
      }
    } catch (toggleError) {
      if (!owns()) return;
      if (previousEdit === undefined) tagLocalEdits.current.delete(tag.id);
      else tagLocalEdits.current.set(tag.id, previousEdit);
      setAssigned((current) => {
      if (!ownsContext()) return current;
        const next = new Set(current);

        if (on) {
          next.add(tag.id);
        } else {
          next.delete(tag.id);
        }

        return next;
      });

      if (contactId) {
        // Roll back only this attempted tag; retain newer remote assignments.
        const latest = tagInboxSnapshot.current?.owner === owner
          ? tagInboxSnapshot.current.items : previousConversationTags;
        const restored = latest.filter(item => item.id !== tag.id);
        const previousTag = previousConversationTags.find(item => item.id === tag.id);
        if (on && previousTag) restored.push(previousTag);
        tagInboxSnapshot.current = { owner, tags: restored.map(tag => tag.id).sort().join(","), items: restored };
        updateContactTags(contactId, restored.map(item => ({ ...item, color: item.color ?? colors.muted })));
      }

      setCustomer((current) =>
        current
          ? {
              ...current,
              customer: { ...current.customer, tags: previousCustomerTags
                  .filter(item => on && item.id === tag.id)
                  .concat(current.customer.tags.filter(item => item.id !== tag.id)) },
            }
          : current,
      );

      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to change this tag.",
      );
    } finally {
      if (owns()) {
        tagMutationFlight.current = null;
        setBusyTagId(null);
      }
    }
  }

  /*
   * Every one of these moves the row first and puts it back if the server
   * refuses. The list behind is the same object, so a status changed here
   * shows there before the request lands -- and un-shows if it fails.
   */
  function panelActionOwner() {
    return authSessionGeneration() === flowAuthGeneration && panelContext.current.value === panelOwner && screenAlive.current &&
      repliesOwnerRef.current === repliesOwner && ownerRef.current === `${scopeId}:${id}` &&
      conversation?.business_id === scopeId && session?.user.id && metadataMemberId ? panelOwner : null;
  }
  function beginPanelAction(key: string) {
    const owner = panelActionOwner();
    if (!owner || !focusedRef.current || !customerReadActivity.current.foreground || panelActionFlight.current) return null;
    const flight = { owner, key };
    panelActionFlight.current = flight;
    setBusyAction(key);
    setError("");
    return flight;
  }
  function ownsPanelAction(flight: { owner: string; key: string }) {
    return panelActionFlight.current === flight && panelActionOwner() === flight.owner;
  }
  function finishPanelAction(flight: { owner: string; key: string }) {
    if (!ownsPanelAction(flight)) return;
    panelActionFlight.current = null;
    setBusyAction(null);
  }
  useEffect(() => {
    panelActionFlight.current = null;
    readSuppressed.current = false;
    setBusyAction(null);
  }, [panelOwner]);

  async function runAction(key: string, patch: Record<string, unknown>, request: () => Promise<unknown>, reservedFlight?: { owner: string; key: string }) {
    if (!id || !conversation) return false;
    const flight = reservedFlight ?? beginPanelAction(key);
    if (!flight || !ownsPanelAction(flight)) return false;
    const before = Object.fromEntries(Object.keys(patch).map(field => [field, (conversation as unknown as Record<string, unknown>)[field]]));
    updateConversation(id, patch);
    try { await request(); return ownsPanelAction(flight); }
    catch (actionError) {
      if (ownsPanelAction(flight)) {
        updateConversation(id, before);
        setError(actionError instanceof Error ? actionError.message : "Unable to change this conversation.");
      }
      return false;
    } finally { finishPanelAction(flight); }
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
    if (!contactId) return false;
    const flight = beginPanelAction(`field:${field}`); if (!flight) return false;
    try {
      await api(`/api/contacts/${encodeURIComponent(contactId)}`, scopeId, {
        method: "PATCH", expectedUserId: session?.user.id, body: { conversationId: id, [field]: value },
      });
      if (!ownsPanelAction(flight)) return false;
      await loadCustomer();
      return ownsPanelAction(flight);
    } catch (saveError) {
      if (ownsPanelAction(flight)) setError(saveError instanceof Error ? saveError.message : "Unable to save that.");
      return false;
    } finally { finishPanelAction(flight); }
  }

  function openPanel() { if (authSessionGeneration() !== flowAuthGeneration) return; setPanelOpen(true); void loadCustomer(); }

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
      api(`/api/conversations/${encodeURIComponent(String(id))}/status`, scopeId, {
        method: "PATCH", expectedUserId: session?.user.id,
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
          scopeId,
          { method: "PATCH", expectedUserId: session?.user.id, body: { assignedTo: memberId } },
        ),
    );
  }

  async function togglePin() {
    const next = !conversation?.is_pinned;

    await runAction("pin", { is_pinned: next }, () =>
      api(`/api/conversations/${encodeURIComponent(String(id))}/pin`, scopeId, {
        method: "PATCH", expectedUserId: session?.user.id,
        body: { isPinned: next },
      }),
    );
  }

  async function markUnread() {
    // Reserve before waiting: a second tap must not clear the first action's suppression.
    const flight = beginPanelAction("unread");
    if (!flight) return;
    const unreadOwner = flight.owner;
    readSuppressed.current = true;
    clearTimeout(readTimer.current);
    readTimer.current = undefined;
    try {
      // Let any earlier read finish before writing the explicit unread state.
      await readPending.current;
      if (!ownsPanelAction(flight)) return;
      const done = await runAction("unread", { unread_count: 1 }, () =>
        api(`/api/conversations/${encodeURIComponent(String(id))}/unread`, scopeId, {
          method: "PATCH", expectedUserId: session?.user.id,
        }), flight,
      );
      if (panelActionOwner() !== unreadOwner) return;
      if (done) {
        setPanelOpen(false);
        if (focusedRef.current && customerReadActivity.current.foreground) router.back();
      } else readSuppressed.current = false;
    } catch (unreadError) {
      if (panelActionOwner() === unreadOwner) {
        readSuppressed.current = false;
        setError(unreadError instanceof Error ? unreadError.message : "Unable to mark this conversation unread.");
      }
    } finally { finishPanelAction(flight); }
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

  useEffect(() => {
    if (!pinJump || loading) return;
    const index = commentThreads.messages.findIndex(row => row.id === pinJump);
    if (index >= 0) {
      threadList.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      setPinHighlight(pinJump); setPinJump(null);
    } else if (!loadingOlder) {
      if (hasMore && pinJumpPages.current < 12) {
        pinJumpPages.current += 1;
        void loadOlder();
      } else {
        setPinJump(null);
        Alert.alert("Pinned message", "This message is further back or no longer available. Load older messages and try again.");
      }
    }
  }, [pinJump, commentThreads.messages, loading, loadingOlder, hasMore, loadOlder]);

  const swipe = useThreadSwipe(
    () => void openPanel(),
    Boolean(contactId) && !panelOpen,
  );

  return (
    <KeyboardAvoidingView
      style={[
        styles.screen,
        { backgroundColor: CHAT_BASE_COLOR },
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
      <AuthImage
        uri={backgroundUri}
        resizeMode="cover"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />

      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
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

      {replyable && scopeId ? <PinnedMessageBar key={`${scopeId}:${id}`} conversationId={String(id)} workspaceId={scopeId}
            messages={messages} updated={pinUpdates} busy={messageActionPending} revision={revision} enabled={focused && foreground}
        onJump={message => { pinJumpPages.current = 0; pinScrollRetries.current = 0; setPinJump(message.id); }}
        onUnpin={message => void actOnMessage(message, "pin")} /> : null}
      <ErrorNotice message={error} onRetry={() => void load(false, false)} />

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
          ref={threadList}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            if (pinScrollRetries.current++ >= 3) return;
            threadList.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
            if (pinScrollTimer.current) clearTimeout(pinScrollTimer.current);
            pinScrollTimer.current = setTimeout(() => threadList.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }), 250);
          }}
          keyboardDismissMode="on-drag"
          /* A tap on the thread, not on a control, puts the keyboard away --
             the same rule every scroller in the app now follows. */
          keyboardShouldPersistTaps="handled"
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
                <View style={pinHighlight === item.id ? { backgroundColor: "#D2EEFF", borderRadius: 12 } : undefined}><Bubble
                  message={item}
                  commentReplies={commentThreads.repliesByMessageId.get(item.id) ?? []}
                  conversation={conversation}
                  quoteMessages={messages}
                  pageReactionOverride={reactionPreview?.id === item.id ? reactionPreview : undefined}
                  onViewMedia={setMediaPreview}
                  onReplyComment={beginCommentReply}
                  onCommentAction={requestCommentAction}
                  onHold={(message, at, media) => {
                    const selection = selectMessageAction(actionScope.current.value, message, media);
                    if (selection && resolveSelection(selection)) messageMenu.current?.open(selection, at);
                  }}
                  commentBusy={commentBusy}
                  audio={{
                    activeId: playingId,
                    playing: playerStatus.playing,
                    position: playerStatus.currentTime,
                    duration: playerStatus.duration,
                    onToggle: toggleAudio,
                  }}
                /></View>

                {/*
                  After the bubble, not before it. An inverted list mirrors
                  each cell as well as the list, so the child drawn second is
                  the one that lands higher up the screen -- and a day's label
                  belongs above the first message of that day. Written the
                  natural way round, "Yesterday" sat underneath the message it
                  was labelling.
                */}
                {(sourceTimeline.before.get(item.id) ?? []).map(source => <MessengerSourceCard key={source.key} source={source} onOpenImage={uri => setMediaPreview({ kind: "image", uri })} onOpenPost={setPostUrl} />)}
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

      {/*
        Who else has this thread open, on the composer.

        It belongs at the bottom because that is where the hand and the eye
        already are the moment it matters -- just before typing a reply
        somebody else may be typing too. What it must not be is loud: this was
        an amber band the width of the screen, which read as a warning about
        the customer rather than a note about a colleague. White, a hairline,
        their faces, their name.
      */}
      {viewers.length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 6,
            backgroundColor: "white",
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <View style={{ flexDirection: "row" }}>
            {viewers.slice(0, 4).map((viewer, index) => (
              <View
                key={viewer.user_id}
                style={{
                  marginLeft: index === 0 ? 0 : -8,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: "white",
                }}
              >
                <Avatar
                  name={viewer.name}
                  uri={viewer.profile_picture_url}
                  size={22}
                />
              </View>
            ))}

            {viewers.length > 4 ? (
              <View
                style={{
                  marginLeft: -8,
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  borderWidth: 2,
                  borderColor: "white",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.background,
                }}
              >
                <Text
                  style={{ fontSize: 9.5, fontWeight: "800", color: colors.muted }}
                >
                  +{viewers.length - 4}
                </Text>
              </View>
            ) : null}
          </View>

          {/*
            Typing outranks viewing. Somebody reading the thread is worth
            knowing; somebody with a half-written reply in the box is the
            thing that makes two answers arrive at once, so it is what the
            line says whenever it is true.
          */}
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontSize: 12,
              color: typists.length > 0 ? "#C77700" : colors.muted,
            }}
          >
            <Text
              style={{
                fontWeight: "800",
                color: typists.length > 0 ? "#C77700" : colors.ink,
              }}
            >
              {typists.length === 1
                ? typists[0].name
                : typists.length > 1
                  ? `${typists.length} people`
                  : viewers.length === 1
                    ? viewers[0].name
                    : `${viewers.length} people`}
            </Text>{" "}
            {typists.length === 1
              ? "is writing a reply…"
              : typists.length > 1
                ? "are writing replies…"
                : viewers.length === 1
                  ? "is viewing this"
                  : "are viewing this"}
          </Text>
        </View>
      ) : null}

      {/*
        What the next message will quote, with a way to change your mind.
        Above the composer rather than inside it, the way every chat app puts
        it, so the box you type in is still the box you type in.
      */}
      {quoted ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 9,
            backgroundColor: "white",
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <View
            style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: colors.blue }}
          />

          {quoted.message_type === "image" && quoted.attachment_url ? <AuthImage uri={quoted.attachment_url} style={{ width: 40, height: 40, borderRadius: 6 }} resizeMode="cover" /> : null}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11.5, fontWeight: "800", color: colors.blue }}>
              Replying to{" "}
              {quoted.direction === "outgoing"
                ? "your message"
                : (conversation?.contact?.full_name ?? "the customer")}
            </Text>

            <Text numberOfLines={1} style={[styles.muted, { fontSize: 12.5 }]}>
              {quoted.message_text?.trim() ||
                (quoted.message_type === "image"
                  ? "Photo"
                  : quoted.message_type === "video"
                    ? "Video"
                    : "Attachment")}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Do not quote this message"
            hitSlop={10}
            onPress={() => { quotedSelection.current = null; setQuoted(null); }}
          >
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      <Composer
        draft={draft}
        onDraftChange={(value) => { if (value !== draft) setDraftSendUnknown(false); setDraft(value); }}
        pending={pending}
        onRemovePending={(key) => {
          removeStorageDraftFile(storageOwner, key);
          setPending((current) => current.filter((item) => item.key !== key));
        }}
        sending={sending || preparingReply}
        sendBlockedReason={pending.some(file => file.deliveryUnknown) ? "An attachment may already be delivered. Verify the thread and remove that item before sending again." : draftSendUnknown ? "The text may already be delivered. Verify the thread, then edit or clear it before sending again." : ""}
        bottomInset={insets.bottom}
        onPickMedia={() => void pickFromLibrary()}
        onPickFile={() => void pickFile()}
        onStorage={storageReady && !replyingToComment ? () => setStorageOpen(true) : undefined}
        onSendLocation={() => void openLocationPicker()}
        onQuickReplies={() => void openReplies()}
        onStickers={conversation?.source_type !== "comment" ? () => setStickerOpen(true) : undefined}
        onVoice={stageVoice}
        onSend={() => void send()}
        fromQuickReply={fromQuickReply}
        onClearAll={() => {
          clearStorageDraftOwner(storageOwner);
          setDraftSendUnknown(false);
          setDraft("");
          setPending([]);
          setQuoted(null);
          setFromQuickReply(false);
          setError("");
        }}
        attachmentsDisabled={Boolean(replyingToComment)}
      />

      <MessageMenuHost ref={messageMenu} canReply={replyable} platform={platform} saving={saving || messageActionPending || sending} resolveSelection={resolveSelection}
        loadTelegramCapability={(message, owner) => {
          if (!conversation?.business_id || !conversation.social_account?.id || !session?.user.id || owner !== actionScope.current.value) return Promise.resolve(null);
          return loadTelegramReactionCapability(message, owner, conversation.business_id, conversation.social_account.id, session.user.id);
        }}
        onAction={(action, message, selection, emoji, capability) => {
          if (action === "reply") { quotedSelection.current = selection; setQuoted(message); }
          else if (action === "copy") copyMessage(message);
          else if (action === "download") void downloadMessage(message, selection);
          else void actOnMessage(message, action, emoji, capability);
        }} />

      {stickerOpen && scopeId ? <StickerPicker key={`stickers:${scopeId}:${id}`} conversationId={String(id)} workspaceId={scopeId} platform={platform} onClose={() => setStickerOpen(false)} onSend={sendSticker} /> : null}
      {storageOpen && storageReady && focused && foreground && session && storageWorkspace && conversation ? <WorkspaceStoragePicker
        key={JSON.stringify([session.user.id, conversation.business_id, storageWorkspace.memberId, id])}
        scope={{ userId: session.user.id, workspaceId: conversation.business_id, memberId: storageWorkspace.memberId, conversationId: String(id) }}
        room={MAX_PENDING_ATTACHMENTS - pending.length}
        onClose={() => setStorageOpen(false)}
        onDraft={files => {
          const current = storageDraft.current;
          if (!screenAlive.current || !focusedRef.current || ownerRef.current !== `${conversation.business_id}:${id}` || !current.ready || current.blocked || sendFlight.current || pendingQueue.current.length + files.length > MAX_PENDING_ATTACHMENTS) return false;
          const next = [...pendingQueue.current, ...files];
          storageDraft.current = { ...current, pending: next };
          setPending(next);
          return true;
        }} /> : null}
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
        sendBlocked={!locationReady || !!locationRecovery}
        pendingPoint={locationRecovery}
        onCheckDelivery={locationRecovery ? () => void sendLocation(locationRecovery, true) : undefined}
        sendError={locationError}
        onSend={(point) => void sendLocation(point)}
        onClose={closeLocationPicker}
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

      {postUrl ? <PostWebView url={postUrl} onClose={() => setPostUrl(null)} /> : null}
      <CustomerPanel
        key={JSON.stringify([repliesOwner, contactId])}
        readOwner={JSON.stringify([repliesOwner, contactId])}
        readActive={focused && foreground && Boolean(session?.user.id && scopeId && contactId && customer?.customer.id === contactId)}
        open={panelOpen}
        detail={customer}
        loading={customerLoading}
        channelName={conversation?.social_account?.account_name ?? null}
        platform={conversation?.social_account?.platform}
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
        isCurrent={() => authSessionGeneration() === flowAuthGeneration}
        currentMemberId={metadataMemberId ?? null}
        onTeamRetry={teamRead.error ? teamRead.retry : undefined}
        busy={busyAction}
        onStatus={(next) => void changeStatus(next)}
        onAssign={(memberId) => void assign(memberId)}
        onPin={() => void togglePin()}
        onUnread={() => void markUnread()}
        onSaveField={saveField}
        onRemind={createReminder}
        onHistory={loadHistory}
        onFiles={loadFiles}
        error={panelOpen ? teamRead.error || error : ""}
        onClose={() => setPanelOpen(false)}
      />

      <QuickTagSheet
        open={tagOpen}
        tags={tags}
        assigned={assigned}
        busyId={busyTagId}
        loading={tagsLoading}
        error={tagOpen ? tagRead.error || error : ""}
        onRetry={tagRead.error ? tagRead.retry : undefined}
        name={name}
        onToggle={(tag) => void toggleTag(tag)}
        onClose={() => setTagOpen(false)}
      />

    </KeyboardAvoidingView>
  );
}
