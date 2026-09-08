import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
  ChannelBadge,
  Empty,
  ErrorNotice,
  IconButton,
  colors,
  styles,
  time,
} from "../../components/ui";
import { api, ApiError } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import type { InboxMessage } from "../../lib/types";

/*
 * Messages come back newest-first from the API and the list is inverted, so
 * the newest sits at the bottom without measuring anything or scrolling after
 * layout. An inverted FlatList also keeps the newest message pinned when the
 * keyboard opens, which is the behaviour anyone expects from a chat.
 */
const PAGE_SIZE = 25;

function Bubble({ message }: { message: InboxMessage }) {
  const outgoing = message.direction === "outgoing";

  const body =
    message.message_text?.trim() ||
    (message.attachment_url ? "Sent an attachment" : "");

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
          paddingHorizontal: 14,
          paddingVertical: 10,
          gap: 4,
        }}
      >
        <Text
          style={{
            color: outgoing ? "white" : colors.ink,
            fontSize: 15,
            lineHeight: 21,
          }}
        >
          {body || "—"}
        </Text>

        <Text
          style={{
            fontSize: 11,
            color: outgoing ? "rgba(255,255,255,0.75)" : colors.muted,
            alignSelf: "flex-end",
          }}
        >
          {time(message.platform_created_at ?? message.created_at)}
        </Text>
      </View>
    </View>
  );
}

export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { conversations, workspace, revision, updateConversation } =
    useInbox();

  const conversation = useMemo(
    () => conversations.find((item) => item.id === id) ?? null,
    [conversations, id],
  );

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const requestRef = useRef(0);
  const readMarkedRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      return;
    }

    const sequence = ++requestRef.current;

    try {
      const data = await api<{ messages: InboxMessage[] }>(
        `/api/conversations/${encodeURIComponent(id)}/messages?limit=${PAGE_SIZE}`,
        workspace?.businessId,
      );

      // A slower earlier request must not overwrite a newer one.
      if (sequence !== requestRef.current) {
        return;
      }

      setMessages(data.messages ?? []);
      setError("");
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

  async function send() {
    const text = draft.trim();

    if (!text || !id || sending) {
      return;
    }

    const platform =
      conversation?.social_account?.platform === "telegram"
        ? "telegram"
        : "facebook";

    setSending(true);
    setError("");

    try {
      await api(`/api/${platform}/send`, workspace?.businessId, {
        method: "POST",
        body: { conversationId: id, message: text },
      });

      setDraft("");
      await load();
    } catch (sendError) {
      /*
       * The draft is deliberately left in the box. Messenger refuses sends
       * outside its window and after a comment reply, and losing what was
       * typed to a policy error the agent cannot do anything about would be
       * its own bug.
       */
      setError(
        sendError instanceof ApiError
          ? sendError.message
          : "Unable to send. Check your connection and try again.",
      );
    } finally {
      setSending(false);
    }
  }

  const name = conversation?.contact?.full_name ?? "Conversation";

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
            label="Back to inbox"
            onPress={() => router.back()}
          />

          <Avatar
            name={name}
            uri={conversation?.contact?.profile_picture_url}
            size={38}
          />

          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={1} style={styles.heading}>
              {name}
            </Text>

            {conversation ? (
              <ChannelBadge conversation={conversation} />
            ) : null}
          </View>
        </View>
      </View>

      <ErrorNotice message={error} onRetry={() => void load()} />

      {loading && messages.length === 0 ? (
        <View style={{ padding: 40 }}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : messages.length === 0 ? (
        <Empty
          title="No messages yet"
          detail="Anything this customer sends will appear here."
        />
      ) : (
        <FlatList
          inverted
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <Bubble message={item} />}
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
          placeholder="Write a reply…"
          placeholderTextColor={colors.muted}
          multiline
          editable={!sending}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
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
