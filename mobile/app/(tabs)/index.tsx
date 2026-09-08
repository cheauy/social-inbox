import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ChannelAvatar,
  Empty,
  ErrorNotice,
  colors,
  styles,
  time,
} from "../../components/ui";
import { useWorkspaceResource } from "../../components/screen";
import { api } from "../../lib/api/client";
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
      <ChannelAvatar conversation={conversation} />

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

        {/*
          No channel line. The avatar wears the mark, and a third line
          repeating it in words pushed the preview up and said nothing the
          badge had not already said.
        */}
        <View style={styles.row}>
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


type Channel = {
  id: string;
  businessId: string;
  platform: "facebook" | "telegram";
  name: string;
  username: string | null;
};

/*
 * The channel filter, as a sheet rather than a dropdown.
 *
 * A phone has no room for the web's sidebar picker, and the list of channels
 * is short. All Channels is first and always present, because it is the state
 * somebody returns to.
 */
function ChannelSheet({
  open,
  channels,
  selectedId,
  onSelect,
  onClose,
}: {
  open: boolean;
  channels: Channel[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityLabel="Close channel picker"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(16,34,56,0.35)" }}
      />

      <View
        style={{
          backgroundColor: "white",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingBottom: 28,
          maxHeight: "70%",
        }}
      >
        <View style={{ padding: 18, paddingBottom: 10 }}>
          <Text style={styles.heading}>Customer channel</Text>
          <Text style={styles.muted}>
            Show one channel, or everything at once.
          </Text>
        </View>

        <ScrollView>
          {[null, ...channels.map((c) => c.id)].map((id) => {
            const item = channels.find((c) => c.id === id) ?? null;
            const active = id === selectedId;

            return (
              <Pressable
                key={id ?? "all"}
                accessibilityRole="button"
                onPress={() => {
                  onSelect(id);
                  onClose();
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 18,
                  paddingVertical: 14,
                  backgroundColor: pressed ? colors.pale : "transparent",
                })}
              >
                <Ionicons
                  name={
                    item === null
                      ? "layers"
                      : item.platform === "telegram"
                        ? "paper-plane"
                        : "chatbubble-ellipses"
                  }
                  size={21}
                  color={colors.blue}
                />

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.ink,
                      fontSize: 15,
                      fontWeight: active ? "800" : "500",
                    }}
                    numberOfLines={1}
                  >
                    {item === null ? "All Channels" : item.name}
                  </Text>

                  <Text style={[styles.muted, { fontSize: 12 }]}>
                    {item === null
                      ? "Messenger and Telegram"
                      : item.username
                        ? `@${item.username}`
                        : item.platform === "telegram"
                          ? "Telegram"
                          : "Messenger"}
                  </Text>
                </View>

                {active ? (
                  <Ionicons
                    name="checkmark"
                    size={20}
                    color={colors.blue}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}


/*
 * The quick views and the status filter, in one strip.
 *
 * The web keeps them apart -- a rail for views, a panel for status -- but a
 * phone header cannot hold two rows of controls above the list. They are
 * mutually exclusive in practice anyway: nobody asks for "unread and closed".
 * One selection, scrollable, with the views first because they are what an
 * agent reaches for between messages.
 */
type ViewKey =
  | "all"
  | "unread"
  | "pinned"
  | "open"
  | "pending"
  | "resolved"
  | "closed"
  | "spam";

const VIEWS: {
  key: ViewKey;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}[] = [
  { key: "all", label: "All conversations", icon: "layers-outline" },
  { key: "unread", label: "Unread", icon: "mail-unread-outline" },
  { key: "pinned", label: "Pinned", icon: "pin-outline" },
  { key: "open", label: "Open", icon: "ellipse-outline" },
  { key: "pending", label: "Pending", icon: "time-outline" },
  { key: "resolved", label: "Resolved", icon: "checkmark-circle-outline" },
  { key: "closed", label: "Closed", icon: "archive-outline" },
  { key: "spam", label: "Spam", icon: "alert-circle-outline" },
];

function matchesView(conversation: InboxConversation, view: ViewKey) {
  if (view === "all") return true;
  if (view === "unread") return (conversation.unread_count ?? 0) > 0;
  if (view === "pinned") return Boolean(conversation.is_pinned);
  return conversation.status === view;
}

/*
 * Name, message preview and phone, which is what the list holds. Searching
 * further back through a thread needs the server, as it does on the web.
 */
function matchesSearch(conversation: InboxConversation, keyword: string) {
  if (!keyword) return true;

  const haystack = [
    conversation.contact?.full_name,
    conversation.contact?.phone,
    conversation.last_message_text,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(keyword);
}


/*
 * Views and status behind one control, rather than a strip of chips.
 *
 * The chips took a whole row above the list and still ran off the edge at
 * seven of them, so the ones past "Open" were only reachable by scrolling a
 * bar most people would not think to scroll. A sheet costs one tap and can
 * show every option at once, grouped the way the web groups them.
 */
function FilterSheet({
  open,
  view,
  counts,
  onSelect,
  onClose,
}: {
  open: boolean;
  view: ViewKey;
  counts: Record<ViewKey, number>;
  onSelect: (view: ViewKey) => void;
  onClose: () => void;
}) {
  const groups: { title: string; keys: ViewKey[] }[] = [
    { title: "Smart views", keys: ["all", "unread", "pinned"] },
    {
      title: "Conversation status",
      keys: ["open", "pending", "resolved", "closed", "spam"],
    },
  ];

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityLabel="Close filters"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(16,34,56,0.35)" }}
      />

      <View
        style={{
          backgroundColor: "white",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingBottom: 28,
          maxHeight: "78%",
        }}
      >
        <View style={{ padding: 18, paddingBottom: 6 }}>
          <Text style={styles.heading}>Filter</Text>
          <Text style={styles.muted}>
            One at a time, over the channel you have selected.
          </Text>
        </View>

        <ScrollView>
          {groups.map((group) => (
            <View key={group.title}>
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
                {group.title}
              </Text>

              {group.keys.map((key) => {
                const option = VIEWS.find((v) => v.key === key);
                if (!option) return null;

                const active = key === view;

                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    onPress={() => {
                      onSelect(key);
                      onClose();
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingHorizontal: 18,
                      paddingVertical: 13,
                      backgroundColor: pressed ? colors.pale : "transparent",
                    })}
                  >
                    <Ionicons
                      name={option.icon}
                      size={19}
                      color={active ? colors.blue : colors.muted}
                    />

                    <Text
                      style={{
                        flex: 1,
                        color: colors.ink,
                        fontSize: 15,
                        fontWeight: active ? "800" : "500",
                      }}
                    >
                      {option.label}
                    </Text>

                    <Text style={[styles.muted, { fontSize: 13 }]}>
                      {counts[key]}
                    </Text>

                    {active ? (
                      <Ionicons
                        name="checkmark"
                        size={19}
                        color={colors.blue}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
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
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewKey>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [messageMatches, setMessageMatches] = useState<Set<string>>(
    () => new Set(),
  );

  const activeView = VIEWS.find((option) => option.key === view);

  /*
   * Conversations whose history contains the typed text, answered by the
   * server -- the same endpoint the web search uses.
   *
   * The list only holds each conversation's last message, so a phone number a
   * customer sent three messages ago is not in the phone at all. It is also
   * where most numbers actually are: seven contacts in this workspace have a
   * phone field, and every one of them typed it into a message first.
   *
   * Debounced, and aborted when the query moves on, so a fast typist cannot
   * have the slowest of several searches land last.
   */
  useEffect(() => {
    const keyword = search.trim();

    if (keyword.length < 3 || !workspace) {
      setMessageMatches((current) =>
        current.size === 0 ? current : new Set(),
      );

      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ conversationIds?: string[] }>(
        `/api/inbox/search-messages?q=${encodeURIComponent(keyword)}`,
        workspace.businessId,
        { signal: controller.signal },
      )
        .then((result) =>
          setMessageMatches(new Set(result.conversationIds ?? [])),
        )
        .catch(() => {
          /*
           * An aborted request is the normal case, and a failed one must not
           * empty what is already on screen: name and preview matches stand
           * on their own.
           */
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, workspace?.businessId]);

  const { data: channelData } = useWorkspaceResource<{ channels: Channel[] }>(
    workspace ? "/api/inbox/channels" : null,
  );

  /*
   * Only this workspace's channels. The endpoint answers for every workspace
   * the member can reach, and offering another one here would filter the list
   * down to nothing with no way to tell why.
   */
  const channels = (channelData?.channels ?? []).filter(
    (item) => item.businessId === workspace?.businessId,
  );

  const selectedChannel =
    channels.find((item) => item.id === channelId) ?? null;

  const ordered = useMemo(
    () =>
      conversations
        .filter(
          (conversation) =>
            (!channelId ||
              conversation.social_account?.id === channelId) &&
            matchesView(conversation, view) &&
            (matchesSearch(conversation, search.trim().toLowerCase()) ||
              messageMatches.has(conversation.id)),
        )
        .sort((first, second) => {
        // Pinned first, then most recent, matching the web Inbox.
        if (Boolean(first.is_pinned) !== Boolean(second.is_pinned)) {
          return first.is_pinned ? -1 : 1;
        }

        return (
          new Date(second.last_message_at ?? 0).getTime() -
          new Date(first.last_message_at ?? 0).getTime()
        );
      }),
    [channelId, conversations, messageMatches, search, view],
  );

  /*
   * Counted over the channel in force but not the search box: the sheet is
   * for choosing a filter, and a count that moved while you typed would be
   * describing a list you are about to leave.
   */
  const viewCounts = useMemo(() => {
    const inChannel = conversations.filter(
      (conversation) =>
        !channelId || conversation.social_account?.id === channelId,
    );

    return VIEWS.reduce(
      (totals, option) => ({
        ...totals,
        [option.key]: inChannel.filter((conversation) =>
          matchesView(conversation, option.key),
        ).length,
      }),
      {} as Record<ViewKey, number>,
    );
  }, [channelId, conversations]);

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
          <Image
            source={require("../../assets/tenh-logo.png")}
            style={{ width: 34, height: 34 }}
            resizeMode="contain"
            accessibilityLabel="Tenh Chat"
          />

          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { fontSize: 24 }]}>Inbox</Text>
            <Text style={styles.muted} numberOfLines={1}>
              {workspace?.businessName ?? "Choose a workspace"}
            </Text>
          </View>

          {/*
            The channel filter, and the live dot tucked into its corner.

            The dot used to sit alone in this space saying only whether
            realtime was connected -- true but rarely actionable. Riding on the
            control an agent already looks at costs it no room, and the space
            goes to the thing they actually reach for.
          */}
          {workspace ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                selectedChannel
                  ? `Channel: ${selectedChannel.name}. Change channel.`
                  : "All channels. Change channel."
              }
              onPress={() => setChannelOpen(true)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                maxWidth: 150,
                paddingHorizontal: 11,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.pale : "white",
              })}
            >
              <Ionicons
                name={
                  !selectedChannel
                    ? "layers"
                    : selectedChannel.platform === "telegram"
                      ? "paper-plane"
                      : "chatbubble-ellipses"
                }
                size={16}
                color={colors.blue}
              />

              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  color: colors.ink,
                  fontSize: 12.5,
                  fontWeight: "700",
                }}
              >
                {selectedChannel?.name ?? "All"}
              </Text>

              <Ionicons
                name="chevron-down"
                size={13}
                color={colors.muted}
              />

              <View
                accessibilityLabel={
                  live ? "Live updates connected" : "Live updates offline"
                }
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: live ? "#2FA36B" : colors.border,
                }}
              />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/*
        Search and the view strip only exist once a workspace is chosen --
        before that the list below is a workspace picker, and filtering it
        would be filtering the wrong thing.
      */}
      {workspace ? (
        <View
          style={{
            backgroundColor: "white",
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            paddingBottom: 10,
            gap: 10,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              marginHorizontal: 16,
            }}
          >
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
                borderRadius: 12,
                backgroundColor: colors.background,
              }}
            >
              <Ionicons name="search" size={17} color={colors.muted} />

              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search name, number or message"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  fontSize: 15,
                  color: colors.ink,
                }}
              />

              {search.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => setSearch("")}
                  hitSlop={10}
                >
                  <Ionicons
                    name="close-circle"
                    size={17}
                    color={colors.muted}
                  />
                </Pressable>
              ) : null}
            </View>

            {/*
              Beside the search box, and marked when a filter is on -- a
              sheet hides its own state, so the button has to carry it or
              somebody stares at a short list wondering where everything
              went.
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                view === "all"
                  ? "Filter conversations"
                  : `Filtered by ${activeView?.label}. Change filter.`
              }
              onPress={() => setFilterOpen(true)}
              style={({ pressed }) => ({
                width: 42,
                height: 42,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: view === "all" ? colors.border : colors.blue,
                backgroundColor:
                  view === "all"
                    ? pressed
                      ? colors.pale
                      : "white"
                    : colors.blue,
              })}
            >
              <Ionicons
                name="options-outline"
                size={20}
                color={view === "all" ? colors.ink : "white"}
              />
            </Pressable>
          </View>

          {/*
            The filter in words when one is on. The icon alone says "something
            is filtered" but not what, and this is also how it gets cleared
            without opening the sheet again.
          */}
          {view !== "all" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Clear the ${activeView?.label} filter`}
              onPress={() => setView("all")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                marginHorizontal: 16,
                paddingHorizontal: 11,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: colors.pale,
              }}
            >
              <Text
                style={{
                  color: colors.blue,
                  fontSize: 12.5,
                  fontWeight: "700",
                }}
              >
                {activeView?.label} · {ordered.length}
              </Text>

              <Ionicons name="close" size={13} color={colors.blue} />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <FilterSheet
        open={filterOpen}
        view={view}
        counts={viewCounts}
        onSelect={setView}
        onClose={() => setFilterOpen(false)}
      />

      <ChannelSheet
        open={channelOpen}
        channels={channels}
        selectedId={channelId}
        onSelect={setChannelId}
        onClose={() => setChannelOpen(false)}
      />

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
                /*
                 * There are now four ways to end up with an empty list and
                 * only one of them means the workspace is empty. Saying the
                 * wrong one sends somebody looking for a problem that is not
                 * there, so each filter names itself and the way back --
                 * search and the view strip are easy to leave set and forget.
                 */
                icon={search.trim() ? "search-outline" : "chatbubbles-outline"}
                title={
                  search.trim()
                    ? "No match"
                    : view !== "all"
                      ? `Nothing ${VIEWS.find((v) => v.key === view)?.label.toLowerCase()}`
                      : selectedChannel
                        ? "Nothing on this channel"
                        : "No conversations yet"
                }
                detail={
                  search.trim()
                    ? `No customer or message matches "${search.trim()}" in this view. Searching further back through a thread is on the web.`
                    : view !== "all"
                      ? "Tap All in the strip above to see every conversation."
                      : selectedChannel
                        ? `${selectedChannel.name} has no conversations. Tap the channel button above to see all of them.`
                        : "When a customer messages one of this workspace's channels, the conversation appears here."
                }
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
