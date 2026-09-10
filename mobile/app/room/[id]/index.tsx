import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { File, UploadType } from "expo-file-system";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { VideoView, useVideoPlayer } from "expo-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  Empty,
  ErrorNotice,
  IconButton,
  Sheet,
  colors,
  styles,
  time,
} from "../../../components/ui";
import { TeamRoomIcon } from "../../../components/team-room-icon";
import { RoomComposer } from "../../../components/room-composer";
import type { RoomPending } from "../../../components/room-composer";
import { api, ApiError, upload as uploadNativeFile } from "../../../lib/api/client";
import { useInbox } from "../../../lib/inbox-provider";
import { supabase } from "../../../lib/supabase/client";

const PAGE_SIZE = 40;
const DELETED_MESSAGE_PREFIX = "__TENH_DELETED_BY__:";
const URL_PATTERN = /(https?:\/\/[^\s]+)/gi;

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
  attachments?: RoomAttachment[];
};

type RoomAttachment = {
  id: string;
  kind: "image" | "video" | "audio" | "file";
  url: string | null;
  file_name: string;
  mime_type: string;
  byte_size: number;
};

type MediaPreview = {
  kind: "image" | "video";
  url: string;
};

type Room = {
  id: string;
  name: string | null;
  is_general?: boolean;
  is_muted?: boolean;
  icon?: "people" | "megaphone" | "briefcase" | "headset" | "cart" | "rocket" | "heart" | "star";
};

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

function fileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function deletedBy(messageText: string | null | undefined) {
  if (!messageText?.startsWith(DELETED_MESSAGE_PREFIX)) return null;
  return messageText.slice(DELETED_MESSAGE_PREFIX.length).trim() || "Team member";
}

function cleanLinkTarget(value: string) {
  return value.replace(/[),.!?]+$/, "");
}

function MessageText({ value, mine, onLongPress }: { value: string; mine: boolean; onLongPress: () => void }) {
  const parts = value.split(URL_PATTERN);
  const heldLinkRef = useRef(false);

  return (
    <Text style={{ color: mine ? "white" : colors.ink, fontSize: 15, lineHeight: 21 }}>
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <Text key={`${index}:${part}`}>{part}</Text>;

        return (
          <Text
            key={`${index}:${part}`}
            accessibilityRole="link"
            onLongPress={() => {
              heldLinkRef.current = true;
              onLongPress();
            }}
            onPress={() => {
              if (heldLinkRef.current) {
                heldLinkRef.current = false;
                return;
              }
              void Linking.openURL(cleanLinkTarget(part));
            }}
            style={{
              color: mine ? "white" : colors.blue,
              textDecorationLine: "underline",
              fontWeight: "600",
            }}
          >
            {part}
          </Text>
        );
      })}
    </Text>
  );
}

function VideoPreview({ url }: { url: string }) {
  const player = useVideoPlayer(url, (instance) => {
    instance.play();
  });

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: "100%", aspectRatio: 16 / 9, maxHeight: "78%" }}
    />
  );
}

function InlineVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (instance) => {
    instance.muted = true;
  });

  return <VideoView player={player} nativeControls={false} contentFit="cover" style={{ width: "100%", height: "100%" }} />;
}

function MediaPreviewModal({
  preview,
  onClose,
}: {
  preview: MediaPreview | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={Boolean(preview)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(3,10,20,.94)",
          justifyContent: "center",
          padding: 16,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close media viewer"
          onPress={onClose}
          style={{
            position: "absolute",
            top: 46,
            right: 18,
            zIndex: 2,
            width: 42,
            height: 42,
            borderRadius: 21,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255,255,255,.14)",
          }}
        >
          <Ionicons name="close" size={25} color="white" />
        </Pressable>

        {preview?.kind === "image" ? (
          <Image
            source={{ uri: preview.url }}
            style={{ width: "100%", height: "82%" }}
            resizeMode="contain"
          />
        ) : preview?.kind === "video" ? (
          <VideoPreview key={preview.url} url={preview.url} />
        ) : null}

      </View>
    </Modal>
  );
}

function AttachmentView({
  attachments,
  mine,
  playingAudioId,
  audioPlaying,
  audioPosition,
  audioDuration,
  onToggleAudio,
  onPreview,
  onLongPress,
}: {
  attachments: RoomAttachment[];
  mine: boolean;
  playingAudioId: string | null;
  audioPlaying: boolean;
  audioPosition: number;
  audioDuration: number;
  onToggleAudio: (attachment: RoomAttachment) => void;
  onPreview: (preview: MediaPreview) => void;
  onLongPress: () => void;
}) {
  const heldRef = useRef(false);
  const images = attachments.filter((item) => item.kind === "image" && item.url);
  const others = attachments.filter((item) => item.kind !== "image" || !item.url);
  const tile = images.length === 1 ? 248 : images.length === 2 ? 125 : 90;

  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start", gap: 7 }}>
      {images.length > 0 ? (
        <View style={{ width: images.length === 1 ? tile : images.length === 2 ? tile * 2 + 4 : tile * 3 + 8, maxWidth: "100%", flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {images.slice(0, 9).map((attachment, index) => (
            <Pressable
              key={attachment.id}
              onLongPress={() => { heldRef.current = true; onLongPress(); }}
              onPress={() => {
                if (heldRef.current) { heldRef.current = false; return; }
                if (attachment.url) onPreview({ kind: "image", url: attachment.url });
              }}
              style={{ width: tile, height: images.length === 1 ? 210 : tile, borderRadius: 14, overflow: "hidden", backgroundColor: colors.border }}
            >
              <Image source={{ uri: attachment.url ?? undefined }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
              {index === 8 && images.length > 9 ? <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(16,34,56,.58)" }}><Text style={{ color: "white", fontSize: 22, fontWeight: "800" }}>+{images.length - 9}</Text></View> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {others.map((attachment) => {
        const isPlaying = playingAudioId === attachment.id && audioPlaying;
        const action = () => {
          if (!attachment.url) return;
          if (attachment.kind === "video") {
            onPreview({ kind: "video", url: attachment.url });
          } else if (attachment.kind === "audio") {
            onToggleAudio(attachment);
          } else {
            void Linking.openURL(attachment.url);
          }
        };

        if (attachment.kind === "video" && attachment.url) {
          return (
            <Pressable key={attachment.id} onLongPress={() => { heldRef.current = true; onLongPress(); }} onPress={() => { if (heldRef.current) { heldRef.current = false; return; } action(); }} style={{ width: 270, maxWidth: "100%", aspectRatio: 16 / 9, overflow: "hidden", borderRadius: 16, backgroundColor: "#06111F" }}>
              <InlineVideo url={attachment.url} />
              <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(3,10,20,.18)" }}>
                <View style={{ width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.92)" }}><Ionicons name="play" size={22} color={colors.blue} /></View>
              </View>
            </Pressable>
          );
        }

        if (attachment.kind === "audio") {
          const active = playingAudioId === attachment.id;
          const duration = active && audioDuration > 0 ? audioDuration : 0;
          const progress = duration > 0 ? Math.min(1, audioPosition / duration) : 0;
          return (
            <Pressable key={attachment.id} disabled={!attachment.url} onLongPress={() => { heldRef.current = true; onLongPress(); }} onPress={() => { if (heldRef.current) { heldRef.current = false; return; } action(); }} style={({ pressed }) => ({ width: 270, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 18, backgroundColor: mine ? colors.blue : "white", borderWidth: 1, borderColor: mine ? colors.blue : colors.border, opacity: pressed ? 0.72 : 1 })}>
              <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: mine ? "rgba(255,255,255,.2)" : colors.pale }}><Ionicons name={isPlaying ? "pause" : "play"} size={18} color={mine ? "white" : colors.blue} /></View>
              <View style={{ flex: 1 }}>
                <View style={{ height: 26, flexDirection: "row", alignItems: "center", gap: 2 }}>
                  {[8,14,10,20,13,23,16,11,19,25,14,21,10,17,23,12,19,9,16,12,20,8,14,10].map((height, index, bars) => (
                    <View key={index} style={{ width: 2, height, borderRadius: 2, backgroundColor: index / bars.length <= progress ? (mine ? "white" : colors.blue) : (mine ? "rgba(255,255,255,.42)" : "#B8D8EA") }} />
                  ))}
                </View>
                <Text style={{ color: mine ? "rgba(255,255,255,.75)" : colors.muted, fontSize: 10.5 }}>{duration > 0 ? `${Math.floor(audioPosition / 60)}:${String(Math.floor(audioPosition % 60)).padStart(2, "0")} / ${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, "0")}` : "Voice message"}</Text>
              </View>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={attachment.id}
            disabled={!attachment.url}
            onLongPress={() => { heldRef.current = true; onLongPress(); }}
            onPress={() => { if (heldRef.current) { heldRef.current = false; return; } action(); }}
            style={({ pressed }) => ({ width: 260, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: 15, borderWidth: 1, borderColor: mine ? colors.blue : colors.border, backgroundColor: mine ? colors.blue : "white", opacity: pressed ? 0.7 : 1 })}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: mine ? "rgba(255,255,255,.18)" : colors.pale }}>
              <Ionicons name="document-text" size={18} color={mine ? "white" : colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: mine ? "white" : colors.ink, fontSize: 13, fontWeight: "700" }}>{attachment.file_name}</Text>
              <Text style={{ color: mine ? "rgba(255,255,255,.72)" : colors.muted, fontSize: 11 }}>{fileSize(attachment.byte_size) || "Document"}</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={mine ? "white" : colors.muted} />
          </Pressable>
        );
      })}
    </View>
  );
}

function ThreadSkeleton() {
  return (
    <View style={{ flex: 1, padding: 16, gap: 18 }} accessibilityLabel="Loading messages">
      {[218, 256, 174, 278, 204].map((width, index) => (
        <View key={index} style={{ width, height: index === 3 ? 112 : 58, alignSelf: index % 2 ? "flex-end" : "flex-start", borderRadius: 18, backgroundColor: index % 2 ? "#D8EDF8" : "#E9EEF4", opacity: 0.82 }} />
      ))}
    </View>
  );
}

function SharedItemsSheet({
  open,
  messages,
  onClose,
  onPreview,
}: {
  open: boolean;
  messages: RoomMessage[];
  onClose: () => void;
  onPreview: (preview: MediaPreview) => void;
}) {
  // Voice notes stay in the conversation only. Plain links stay in the
  // message bubble only; neither belongs in Files/Documents.
  const attachments = messages
    .flatMap((message) => message.attachments ?? [])
    .filter((item) => item.kind !== "audio");
  const media = attachments.filter((item) => (item.kind === "image" || item.kind === "video") && item.url);
  const files = attachments.filter((item) => item.kind === "file");

  return (
    <Sheet open={open} title="Files & media" detail="Photos, videos and documents shared in this room." onClose={onClose} fullHeight>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 18, paddingBottom: 18, gap: 16 }}>
        {attachments.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 34, gap: 9 }}><Ionicons name="folder-open-outline" size={30} color={colors.muted} /><Text style={styles.muted}>Nothing has been shared yet.</Text></View>
        ) : null}
        {media.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "800" }}>Media</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {media.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => item.url && onPreview({ kind: item.kind as "image" | "video", url: item.url })}
                  style={{ width: 94, height: 94, borderRadius: 12, overflow: "hidden", backgroundColor: colors.border, alignItems: "center", justifyContent: "center" }}
                >
                  {item.kind === "image" ? (
                    <Image source={{ uri: item.url ?? undefined }} style={{ width: 94, height: 94 }} resizeMode="cover" />
                  ) : (
                    <><Ionicons name="play-circle" size={34} color={colors.blue} /><Text numberOfLines={1} style={{ paddingHorizontal: 5, marginTop: 4, color: colors.muted, fontSize: 10 }}>{item.file_name}</Text></>
                  )}
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {files.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "800" }}>Files and documents</Text>
            {files.map((item) => (
              <Pressable key={item.id} disabled={!item.url} onPress={() => item.url && void Linking.openURL(item.url)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 11, padding: 12, borderRadius: 14, backgroundColor: pressed ? colors.pale : "#F7F9FC", borderWidth: 1, borderColor: colors.border })}>
                <Ionicons name="document-text-outline" size={20} color={colors.blue} />
                <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: colors.ink, fontWeight: "700" }}>{item.file_name}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>{fileSize(item.byte_size) || "Document"}</Text></View>
                <Ionicons name="open-outline" size={17} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

function MessageActionsSheet({
  message,
  mine,
  canDelete,
  onReply,
  onEdit,
  onDelete,
  onClose,
}: {
  message: RoomMessage | null;
  mine: boolean;
  canDelete: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const row = (icon: React.ComponentProps<typeof Ionicons>["name"], label: string, run: () => void, destructive = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      onPress={run}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: 15, backgroundColor: pressed ? colors.pale : "white" })}
    >
      <Ionicons name={icon} size={21} color={destructive ? colors.red : colors.ink} />
      <Text style={{ color: destructive ? colors.red : colors.ink, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );

  return (
    <Sheet open={Boolean(message)} title="Message actions" detail="Choose what you want to do." onClose={onClose}>
      <View style={{ paddingBottom: 8 }}>
        {row("arrow-undo-outline", "Reply", onReply)}
        {mine ? row("create-outline", "Edit", onEdit) : null}
        {canDelete ? row("trash-outline", "Delete", onDelete, true) : null}
      </View>
    </Sheet>
  );
}

function RoomBubble({
  message,
  showSender,
  mine,
  canAct,
  deleting,
  playingAudioId,
  audioPlaying,
  audioPosition,
  audioDuration,
  onLongPress,
  onToggleAudio,
  onPreview,
}: {
  message: RoomMessage;
  showSender: boolean;
  mine: boolean;
  canAct: boolean;
  deleting: boolean;
  playingAudioId: string | null;
  audioPlaying: boolean;
  audioPosition: number;
  audioDuration: number;
  onLongPress: () => void;
  onToggleAudio: (attachment: RoomAttachment) => void;
  onPreview: (preview: MediaPreview) => void;
}) {
  const name = message.sender?.full_name ?? "Someone";
  const deletedName = deletedBy(message.message_text);

  return (
    <Pressable
      accessibilityRole={canAct && !deletedName ? "button" : "text"}
      accessibilityLabel={canAct && !deletedName ? `${mine ? "Your" : name + "'s"} message. Long press for actions.` : undefined}
      onLongPress={canAct && !deletedName ? onLongPress : undefined}
      delayLongPress={450}
      style={{
        flexDirection: mine ? "row-reverse" : "row",
        alignSelf: mine ? "flex-end" : "stretch",
        alignItems: "flex-end",
        gap: 9,
        paddingHorizontal: 14,
        paddingTop: showSender ? 10 : 2,
        paddingBottom: 2,
        opacity: deleting ? 0.45 : 1,
      }}
    >
      {!mine ? <View style={{ width: 32 }}>
        {showSender ? <Avatar name={name} uri={message.sender?.profile_picture_url} size={32} /> : null}
      </View> : null}

      <View style={{ maxWidth: "80%", alignItems: mine ? "flex-end" : "flex-start", gap: 4 }}>
        {showSender && !mine ? (
          <Text style={{ color: colors.ink, fontSize: 13.5, fontWeight: "800" }}>{name}</Text>
        ) : null}

        {deletedName ? (
          <View style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, backgroundColor: "#EEF2F6", borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.muted, fontSize: 13, fontStyle: "italic" }}>
              Message deleted by {deletedName}
            </Text>
          </View>
        ) : message.message_text?.trim() ? (
          <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, borderBottomRightRadius: mine ? 5 : 18, borderBottomLeftRadius: mine ? 18 : 5, backgroundColor: mine ? colors.blue : "white", borderWidth: mine ? 0 : 1, borderColor: colors.border }}>
            <MessageText value={message.message_text.trim()} mine={mine} onLongPress={onLongPress} />
          </View>
        ) : null}

        {!deletedName && message.attachments && message.attachments.length > 0 ? (
          <AttachmentView
            attachments={message.attachments}
            mine={mine}
            playingAudioId={playingAudioId}
            audioPlaying={audioPlaying}
            audioPosition={audioPosition}
            audioDuration={audioDuration}
            onToggleAudio={onToggleAudio}
            onPreview={onPreview}
            onLongPress={onLongPress}
          />
        ) : null}

        <Text style={{ color: colors.muted, fontSize: 10.5 }}>{time(message.created_at)}{message.edited_at && !deletedName ? " · edited" : ""}</Text>
      </View>
    </Pressable>
  );
}

export default function RoomScreen() {
  const { id, name: passedName } = useLocalSearchParams<{
    id: string;
    name?: string;
  }>();

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { workspace, member, revision, rooms, roster, canManageRooms } = useInbox();

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
  const [sharedOpen, setSharedOpen] = useState(false);
  const [preview, setPreview] = useState<MediaPreview | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<RoomMessage | null>(null);
  const [replyingTo, setReplyingTo] = useState<RoomMessage | null>(null);

  const player = useAudioPlayer(null, { updateInterval: 250 });
  const playerStatus = useAudioPlayerStatus(player);

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

  useEffect(() => {
    if (playerStatus.didJustFinish) {
      setPlayingAudioId(null);
    }
  }, [playerStatus.didJustFinish]);

  function toggleRoomAudio(attachment: RoomAttachment) {
    if (!attachment.url) return;

    if (playingAudioId === attachment.id) {
      if (playerStatus.playing) player.pause();
      else player.play();
      return;
    }

    setPlayingAudioId(attachment.id);
    player.replace(attachment.url);
    player.play();
  }

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
      selectionLimit: mediaTypes.includes("images") ? Math.max(1, 10 - pending.length) : 1,
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
          byteSize: asset.fileSize,
        };
      }),
    ].slice(0, 10));
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
        byteSize: asset.size,
      })),
    ]);
  }

  function voiceFile(uri: string, millis: number): RoomPending {
    return {
      key: `voice:${Date.now()}`,
      uri,
      name: `voice-${Math.max(1, Math.round(millis / 1000))}s.m4a`,
      mimeType: "audio/mp4",
      kind: "audio",
    };
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

  function beginEdit(message: RoomMessage) {
    const text = message.message_text?.trim() ?? "";
    if (deletedBy(text)) return;

    setEditingMessageId(message.id);
    setDraft(text);
    setReplyingTo(null);
    setPending([]);
    setMentions([]);
    setMentionEveryone(false);
    setError("");
  }

  function cancelEdit() {
    setEditingMessageId(null);
    setDraft("");
  }

  function openMessageActions(message: RoomMessage) {
    if (deletingId || deletedBy(message.message_text)) return;
    setActionMessage(message);
  }

  async function remove(message: RoomMessage) {
    if (!workspace || !member) return;

    const previous = message;
    const optimistic: RoomMessage = {
      ...message,
      message_text: `${DELETED_MESSAGE_PREFIX}${member.full_name || "Team member"}`,
      edited_at: null,
      attachments: [],
    };

    setDeletingId(message.id);
    setError("");
    setMessages((current) => mergeMessages(current, [optimistic]));

    try {
      const result = await api<{ message?: RoomMessage }>(
        `/api/team-chat/messages/${encodeURIComponent(message.id)}`,
        workspace.businessId,
        { method: "DELETE" },
      );

      if (result.message) {
        setMessages((current) => mergeMessages(current, [result.message as RoomMessage]));
      }

      if (editingMessageId === message.id) cancelEdit();
    } catch (deleteError) {
      setMessages((current) => mergeMessages(current, [previous]));
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete that message.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function uploadPendingFile(file: RoomPending): Promise<RoomAttachment> {
    if (!id || !workspace) throw new Error("This room is unavailable.");

    const localFile = new File(file.uri);
    const byteSize = file.byteSize ?? localFile.size ?? 0;

    let prepared: {
      attachment: RoomAttachment;
      upload: { signedUrl: string; path: string; token: string };
    };

    try {
      prepared = await api<typeof prepared>(
        "/api/team-chat/attachments",
        workspace.businessId,
        {
          method: "POST",
          body: {
            action: "prepare",
            roomId: String(id),
            fileName: file.name,
            mimeType: file.mimeType,
            byteSize,
          },
        },
      );
    } catch (prepareError) {
      // Installed builds may briefly talk to the previous API deployment.
      // Its multipart endpoint is still supported, so photos, voice notes and
      // ordinary files keep working while the signed-upload route rolls out.
      try {
        const fallback = await uploadNativeFile<{ attachment: RoomAttachment }>(
          "/api/team-chat/attachments",
          workspace.businessId,
          { uri: file.uri, mimeType: file.mimeType },
          { roomId: String(id) },
        );
        return fallback.attachment;
      } catch (fallbackError) {
        throw fallbackError instanceof Error ? fallbackError : prepareError;
      }
    }

    try {
      const publicKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
      const { data: authData } = await supabase.auth.getSession();
      const accessToken = authData.session?.access_token || publicKey;
      const uploadResult = await localFile.upload(prepared.upload.signedUrl, {
        httpMethod: "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        headers: {
          "content-type": prepared.attachment.mime_type,
          "cache-control": "max-age=3600",
          "x-upsert": "false",
          apikey: publicKey,
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        const detail = uploadResult.body?.trim().slice(0, 240);
        throw new Error(`Upload failed (HTTP ${uploadResult.status})${detail ? `: ${detail}` : "."}`);
      }

      const signed = await api<{ attachment: RoomAttachment }>(
        `/api/team-chat/attachments?attachmentId=${encodeURIComponent(prepared.attachment.id)}`,
        workspace.businessId,
      );

      return signed.attachment;
    } catch (uploadError) {
      void api(
        `/api/team-chat/attachments?attachmentId=${encodeURIComponent(prepared.attachment.id)}`,
        workspace.businessId,
        { method: "DELETE" },
      ).catch(() => undefined);
      throw uploadError;
    }
  }

  async function uploadPendingFiles(files: RoomPending[]) {
    const uploaded: RoomAttachment[] = [];

    // Three at a time keeps the UI responsive and avoids serial uploads
    // without flooding a slower mobile connection with ten videos at once.
    for (let index = 0; index < files.length; index += 3) {
      const batch = await Promise.all(files.slice(index, index + 3).map(uploadPendingFile));
      uploaded.push(...batch);
    }

    return uploaded;
  }

  async function send(directFiles?: RoomPending[]) {
    const direct = Boolean(directFiles);
    const rawText = direct ? "" : draft.trim();
    const replySnapshot = direct ? null : replyingTo;
    const replyName = replySnapshot?.sender?.full_name || "Team member";
    const replyExcerpt = replySnapshot?.message_text?.trim() ||
      replySnapshot?.attachments?.[0]?.file_name || "Attachment";
    const text = replySnapshot
      ? `↪ ${replyName}: ${replyExcerpt.slice(0, 120)}\n${rawText}`.trim()
      : rawText;
    const filesToSend = directFiles ?? pending;

    if ((!text && filesToSend.length === 0) || !id || !workspace || !member || sending) {
      return;
    }

    if (editingMessageId) {
      if (!text) return;

      setSending(true);
      setError("");

      try {
        const data = await api<{ message: RoomMessage }>(
          `/api/team-chat/messages/${encodeURIComponent(editingMessageId)}`,
          workspace.businessId,
          { method: "PATCH", body: { messageText: text } },
        );

        if (data.message) {
          setMessages((current) => mergeMessages(current, [data.message]));
        }
        setEditingMessageId(null);
        setDraft("");
      } catch (editError) {
        setError(editError instanceof Error ? editError.message : "Unable to edit that message.");
      } finally {
        setSending(false);
      }
      return;
    }

    const pendingSnapshot = [...filesToSend];
    const mentionSnapshot = direct ? [] : [...mentions];
    const everyoneSnapshot = direct ? false : mentionEveryone;
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createdAt = new Date().toISOString();
    const optimisticAttachments: RoomAttachment[] = pendingSnapshot.map((file, index) => ({
      id: `${tempId}-attachment-${index}`,
      kind: file.kind,
      url: file.uri,
      file_name: file.name,
      mime_type: file.mimeType,
      byte_size: 0,
    }));
    const optimisticMessage: RoomMessage = {
      id: tempId,
      room_id: String(id),
      sender_member_id: member.id,
      message_text: text,
      edited_at: null,
      created_at: createdAt,
      sender: {
        id: member.id,
        full_name: member.full_name,
        email: member.email,
        role: member.role,
        profile_picture_url: member.profile_picture_url,
      },
      attachments: optimisticAttachments,
    };

    // The message appears immediately. Network/upload work follows without
    // making the user stare at a blocked composer.
    setSending(true);
    setError("");
    setMessages((current) => mergeMessages(current, [optimisticMessage]));
    if (!direct) {
      setDraft("");
      setPending([]);
      setMentions([]);
      setMentionEveryone(false);
      setReplyingTo(null);
    }

    let uploaded: RoomAttachment[] = [];

    try {
      uploaded = await uploadPendingFiles(pendingSnapshot);

      const data = await api<{ message: RoomMessage }>(
        `/api/team-chat/rooms/${encodeURIComponent(id)}/messages`,
        workspace.businessId,
        {
          method: "POST",
          body: {
            messageText: text,
            attachmentIds: uploaded.map((item) => item.id),
            mentionedMemberIds: mentionSnapshot,
            mentionEveryone: everyoneSnapshot,
          },
        },
      );

      setMessages((current) => {
        const withoutPending = current.filter((item) => item.id !== tempId);
        return data.message ? mergeMessages(withoutPending, [data.message]) : withoutPending;
      });

      if (!data.message) void load();
    } catch (sendError) {
      setMessages((current) => current.filter((item) => item.id !== tempId));
      if (direct) {
        setPending((current) => [...pendingSnapshot, ...current].slice(0, 10));
      } else {
        setDraft(rawText);
        setPending(pendingSnapshot);
        setMentions(mentionSnapshot);
        setMentionEveryone(everyoneSnapshot);
        setReplyingTo(replySnapshot);
      }

      // If the message itself failed after uploads succeeded, discard those
      // still-unbound rows/files. Bound uploads reject this cleanup safely.
      uploaded.forEach((attachment) => {
        void api(
          `/api/team-chat/attachments?attachmentId=${encodeURIComponent(attachment.id)}`,
          workspace.businessId,
          { method: "DELETE" },
        ).catch(() => undefined);
      });

      setError(
        sendError instanceof ApiError
          ? sendError.message
          : sendError instanceof Error
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
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
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
              <TeamRoomIcon icon={current?.icon ?? room?.icon} size={38} />
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Text numberOfLines={1} style={[styles.heading, { flexShrink: 1 }]}>
                  {title}
                </Text>

              </View>

              <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
                {subtitle}
              </Text>
            </View>
          </Pressable>

          <IconButton icon="folder-open-outline" label="Files and media" onPress={() => setSharedOpen(true)} />
        </View>
      </View>

      <ErrorNotice message={error} onRetry={() => void load()} />

      {loading && messages.length === 0 ? (
        <ThreadSkeleton />
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
                mine={Boolean(member && item.sender_member_id === member.id)}
                canAct
                deleting={deletingId === item.id}
                playingAudioId={playingAudioId}
                audioPlaying={playerStatus.playing}
                audioPosition={playerStatus.currentTime ?? 0}
                audioDuration={playerStatus.duration ?? 0}
                onLongPress={() => openMessageActions(item)}
                onToggleAudio={toggleRoomAudio}
                onPreview={setPreview}
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

      {editingMessageId ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 14,
            paddingVertical: 8,
            backgroundColor: colors.pale,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Ionicons name="create-outline" size={17} color={colors.blue} />
          <Text style={{ flex: 1, color: colors.ink, fontSize: 12.5, fontWeight: "700" }}>
            Editing your message
          </Text>
          <Pressable accessibilityRole="button" onPress={cancelEdit}>
            <Text style={{ color: colors.blue, fontSize: 12.5, fontWeight: "800" }}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {replyingTo && !editingMessageId ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: "#F2F8FC", borderTopWidth: 1, borderTopColor: colors.border }}>
          <Ionicons name="arrow-undo-outline" size={18} color={colors.blue} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.blue, fontSize: 12.5, fontWeight: "800" }}>Replying to {replyingTo.sender?.full_name || "Team member"}</Text>
            <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>{replyingTo.message_text?.trim() || replyingTo.attachments?.[0]?.file_name || "Attachment"}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={() => setReplyingTo(null)}><Ionicons name="close" size={20} color={colors.muted} /></Pressable>
        </View>
      ) : null}

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
        onPickImages={() => editingMessageId ? undefined : void pickFromLibrary(["images"])}
        onPickVideo={() => editingMessageId ? undefined : void pickFromLibrary(["videos"])}
        onPickFile={() => editingMessageId ? undefined : void pickFile()}
        onVoice={(uri, millis) => editingMessageId ? undefined : void send([voiceFile(uri, millis)])}
        onMention={mention}
        onSend={() => void send()}
      />

      <SharedItemsSheet
        open={sharedOpen}
        messages={messages}
        onClose={() => setSharedOpen(false)}
        onPreview={(next) => {
          setSharedOpen(false);
          setPreview(next);
        }}
      />

      <MediaPreviewModal preview={preview} onClose={() => setPreview(null)} />

      <MessageActionsSheet
        message={actionMessage}
        mine={Boolean(actionMessage && member && actionMessage.sender_member_id === member.id)}
        canDelete={Boolean(actionMessage && member && (actionMessage.sender_member_id === member.id || canManageRooms))}
        onReply={() => {
          if (actionMessage) setReplyingTo(actionMessage);
          setEditingMessageId(null);
          setActionMessage(null);
        }}
        onEdit={() => {
          if (actionMessage) beginEdit(actionMessage);
          setActionMessage(null);
        }}
        onDelete={() => {
          const target = actionMessage;
          setActionMessage(null);
          if (target) void remove(target);
        }}
        onClose={() => setActionMessage(null)}
      />

    </KeyboardAvoidingView>
  );
}
