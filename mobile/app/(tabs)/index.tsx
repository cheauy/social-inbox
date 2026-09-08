import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  ChannelBadge,
  Empty,
  ErrorNotice,
  colors,
  styles,
  time,
} from "../../components/ui";
import { useAuth } from "../../lib/auth/provider";
import { useInbox } from "../../lib/inbox-provider";
import type { InboxConversation, Workspace } from "../../lib/types";

function WorkspacePicker({
  workspaces,
  onSelect,
  busy,
}: {
  workspaces: Workspace[];
  onSelect: (workspace: Workspace) => void;
  busy: boolean;
}) {
  if (workspaces.length === 0) {
    return (
      <Empty
        icon="briefcase-outline"
        title="No workspace available"
        detail="This account is not an active member of any workspace with a live subscription. Open TENH on the web to check."
      />
    );
  }

  return (
    <View style={{ padding: 16, gap: 10 }}>
      <Text style={styles.heading}>Choose a workspace</Text>

      {workspaces.map((workspace) => {
        /*
         * An expired workspace is listed but not selectable, and says why.
         * Hiding it would leave somebody who knows they have that workspace
         * looking for it.
         */
        const usable = workspace.subscriptionOperational;

        return (
          <Pressable
            key={workspace.businessId}
            accessibilityRole="button"
            disabled={!usable || busy}
            onPress={() => onSelect(workspace)}
            style={({ pressed }) => [
              styles.card,
              { opacity: !usable ? 0.55 : pressed ? 0.7 : 1 },
            ]}
          >
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.heading}>
                  {workspace.businessName}
                </Text>
                <Text style={styles.muted}>
                  {usable
                    ? workspace.role
                    : "Subscription expired — renew on the web"}
                </Text>
              </View>

              {usable ? (
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.muted}
                />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: InboxConversation;
  onPress: () => void;
}) {
  const unread = (conversation.unread_count ?? 0) > 0;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: pressed ? colors.pale : "white",
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Avatar
        name={conversation.contact?.full_name}
        uri={conversation.contact?.profile_picture_url}
      />

      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.row}>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: colors.ink,
              fontSize: 15,
              fontWeight: unread ? "800" : "600",
            }}
          >
            {conversation.contact?.full_name ?? "Customer"}
          </Text>

          <Text style={{ fontSize: 12, color: colors.muted }}>
            {time(conversation.last_message_at)}
          </Text>
        </View>

        <Text
          numberOfLines={1}
          style={{
            color: unread ? colors.ink : colors.muted,
            fontSize: 14,
            fontWeight: unread ? "600" : "400",
          }}
        >
          {conversation.last_message_text?.trim() || "No messages yet"}
        </Text>

        <View style={styles.row}>
          <ChannelBadge conversation={conversation} />

          {unread ? (
            <View
              style={{
                marginLeft: "auto",
                minWidth: 22,
                paddingHorizontal: 7,
                paddingVertical: 2,
                borderRadius: 11,
                backgroundColor: colors.blue,
              }}
            >
              <Text
                style={{
                  color: "white",
                  fontSize: 11,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                {conversation.unread_count}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function Inbox() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    workspaces,
    workspace,
    conversations,
    loading,
    error,
    live,
    refresh,
    loadWorkspaces,
    selectWorkspace,
  } = useInbox();

  const [refreshing, setRefreshing] = useState(false);
  const [switching, setSwitching] = useState(false);

  const ordered = useMemo(
    () =>
      [...conversations].sort((first, second) => {
        // Pinned first, then most recent, matching the web Inbox.
        if (Boolean(first.is_pinned) !== Boolean(second.is_pinned)) {
          return first.is_pinned ? -1 : 1;
        }

        return (
          new Date(second.last_message_at ?? 0).getTime() -
          new Date(first.last_message_at ?? 0).getTime()
        );
      }),
    [conversations],
  );

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  async function pullToRefresh() {
    setRefreshing(true);

    try {
      await loadWorkspaces();
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function choose(next: Workspace) {
    setSwitching(true);

    try {
      await selectWorkspace(next);
    } catch {
      // selectWorkspace already reported it through the provider's error.
    } finally {
      setSwitching(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Inbox</Text>
            <Text style={styles.muted}>
              {workspace?.businessName ?? "Choose a workspace"}
            </Text>
          </View>

          {/*
            A quiet dot rather than a label. It says whether updates are
            arriving on their own; when it is off, pull to refresh is the
            answer, and that gesture is already there.
          */}
          <View
            accessibilityLabel={
              live ? "Live updates connected" : "Live updates offline"
            }
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: live ? "#2FA36B" : colors.border,
            }}
          />
        </View>
      </View>

      <ErrorNotice message={error} onRetry={() => void pullToRefresh()} />

      {!workspace ? (
        loading ? (
          <View style={{ padding: 40 }}>
            <ActivityIndicator color={colors.blue} />
          </View>
        ) : (
          <WorkspacePicker
            workspaces={workspaces}
            onSelect={(next) => void choose(next)}
            busy={switching}
          />
        )
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              onPress={() =>
                router.push({
                  pathname: "/conversation/[id]",
                  params: { id: item.id },
                })
              }
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void pullToRefresh()}
              tintColor={colors.blue}
            />
          }
          ListEmptyComponent={
            loading ? (
              <View style={{ padding: 40 }}>
                <ActivityIndicator color={colors.blue} />
              </View>
            ) : (
              <Empty
                title="No conversations yet"
                detail="When a customer messages one of this workspace's channels, the conversation appears here."
              />
            )
          }
          contentContainerStyle={
            ordered.length === 0 ? { flexGrow: 1 } : undefined
          }
        />
      )}
    </View>
  );
}
