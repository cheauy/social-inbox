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
  Sheet,
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
 * Smart views and status, kept apart.
 *
 * They were one exclusive list, which meant asking for "unread" gave up on
 * "open" -- and those are different questions. The web answers both at once:
 * a rail for the view, a panel for the status. Two controls cost one more
 * icon in the header and get that back.
 *
 * The smart views are the web's own, in the web's order: the three rail tabs,
 * then the four Default Smart Views from the panel. Personal saved views are
 * not here -- they carry workspace scope, tag sets and channel rules that the
 * phone has no filter engine for, and half-honouring a saved view would be
 * worse than not offering it.
 */
type SmartView =
  | "all"
  | "unread"
  | "pinned"
  | "my"
  | "unassigned"
  | "comment"
  | "open";

type StatusKey = "all" | "open" | "pending" | "resolved" | "closed" | "spam";

type FilterOption<T> = {
  key: T;
  label: string;
  group: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

const SMART_VIEWS: FilterOption<SmartView>[] = [
  {
    key: "all",
    label: "All conversations",
    group: "Smart views",
    icon: "albums-outline",
  },
  {
    key: "unread",
    label: "Unread",
    group: "Smart views",
    icon: "mail-unread-outline",
  },
  {
    key: "pinned",
    label: "Pinned",
    group: "Smart views",
    icon: "pin-outline",
  },
  {
    key: "my",
    label: "Assign to me",
    group: "Default Smart Views",
    icon: "person-circle-outline",
  },
  {
    key: "unassigned",
    label: "Unassigned",
    group: "Default Smart Views",
    icon: "person-remove-outline",
  },
  {
    key: "comment",
    label: "Facebook Comment",
    group: "Default Smart Views",
    icon: "chatbox-ellipses-outline",
  },
  {
    key: "open",
    label: "Open conversation",
    group: "Default Smart Views",
    icon: "chatbubbles-outline",
  },
];

const STATUSES: FilterOption<StatusKey>[] = [
  {
    key: "all",
    label: "Any status",
    group: "Conversation status",
    icon: "options-outline",
  },
  {
    key: "open",
    label: "Open",
    group: "Conversation status",
    icon: "ellipse-outline",
  },
  {
    key: "pending",
    label: "Pending",
    group: "Conversation status",
    icon: "time-outline",
  },
  {
    key: "resolved",
    label: "Resolved",
    group: "Conversation status",
    icon: "checkmark-circle-outline",
  },
  {
    key: "closed",
    label: "Closed",
    group: "Conversation status",
    icon: "archive-outline",
  },
  {
    key: "spam",
    label: "Spam",
    group: "Conversation status",
    icon: "alert-circle-outline",
  },
];

/*
 * The same tests the web's own matchesView runs, in the same order.
 *
 * "Assign to me" needs the member id for the workspace in view, not the user
 * id: assignment is recorded against team_members, and one person has a
 * different member row in every workspace they belong to.
 */
function matchesSmartView(
  conversation: InboxConversation,
  view: SmartView,
  memberId: string | null,
) {
  if (view === "unread") return (conversation.unread_count ?? 0) > 0;
  if (view === "pinned") return Boolean(conversation.is_pinned);
  if (view === "my") {
    return Boolean(memberId && conversation.assigned_to === memberId);
  }
  if (view === "unassigned") return !conversation.assigned_to;
  if (view === "comment") return conversation.source_type === "comment";
  if (view === "open") return conversation.status === "open";
  return true;
}

function matchesStatus(conversation: InboxConversation, status: StatusKey) {
  return status === "all" || conversation.status === status;
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
 * One active filter, and the way off it.
 */
function FilterPill({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Clear the ${label} filter`}
      onPress={onClear}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: pressed ? colors.border : colors.pale,
      })}
    >
      <Text style={{ color: colors.blue, fontSize: 12.5, fontWeight: "700" }}>
        {label}
      </Text>

      <Ionicons name="close" size={13} color={colors.blue} />
    </Pressable>
  );
}

/*
 * The button that opens one of them.
 *
 * Filled while its filter is on. A sheet hides its own state once it closes,
 * so the button has to carry it -- otherwise somebody stares at a short list
 * wondering where the rest of it went.
 */
function FilterButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 42,
        height: 42,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: active ? colors.blue : colors.border,
        backgroundColor: active ? colors.blue : pressed ? colors.pale : "white",
      })}
    >
      <Ionicons name={icon} size={20} color={active ? "white" : colors.ink} />
    </Pressable>
  );
}

/*
 * One row in either sheet: icon, label, and how many conversations it leaves.
 */
function OptionRow<T extends string>({
  option,
  active,
  count,
  onPress,
}: {
  option: FilterOption<T>;
  active: boolean;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
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

      <Text style={[styles.muted, { fontSize: 13 }]}>{count}</Text>

      {active ? (
        <Ionicons name="checkmark" size={19} color={colors.blue} />
      ) : null}
    </Pressable>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </Text>
  );
}

/*
 * A list of options with its group headings, inserted wherever the group
 * changes. Both sheets draw the same rows; only which lists they are handed
 * differs.
 */
function OptionList<T extends string>({
  options,
  selected,
  counts,
  onSelect,
}: {
  options: FilterOption<T>[];
  selected: T;
  counts: Record<string, number>;
  onSelect: (value: T) => void;
}) {
  return (
    <>
      {options.map((option, index) => (
        <View key={option.key}>
          {index === 0 || options[index - 1].group !== option.group ? (
            <GroupLabel>{option.group}</GroupLabel>
          ) : null}

          <OptionRow
            option={option}
            active={option.key === selected}
            count={counts[option.key] ?? 0}
            onPress={() => onSelect(option.key)}
          />
        </View>
      ))}
    </>
  );
}

/*
 * The smart-view icon: the three views on their own, one tap and gone.
 *
 * All three are in the filter sheet as well. They are here too because
 * moving between all, unread and pinned is what an agent does between
 * messages, and that should not cost a scroll past five statuses.
 */
function SmartViewSheet({
  open,
  selected,
  counts,
  onSelect,
  onClose,
}: {
  open: boolean;
  selected: SmartView;
  counts: Record<string, number>;
  onSelect: (value: SmartView) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      title="Smart views"
      detail="Cuts across every status, over the channel you have selected."
      onClose={onClose}
    >
      <ScrollView>
        <OptionList
          options={SMART_VIEWS}
          selected={selected}
          counts={counts}
          onSelect={(value) => {
            onSelect(value);
            onClose();
          }}
        />
      </ScrollView>
    </Sheet>
  );
}

/*
 * The filter icon: both lists, in full.
 *
 * They are two selections rather than one list of nine -- a view and a
 * status hold at the same time -- so this sheet does not close on a tap the
 * way the smart-view one does. Set the view, set the status, and the button
 * along the bottom says what you are about to be left with.
 */
function FilterSheet({
  open,
  smartView,
  status,
  counts,
  onSmartView,
  onStatus,
  onClose,
}: {
  open: boolean;
  smartView: SmartView;
  status: StatusKey;
  counts: { smart: Record<string, number>; status: Record<string, number> };
  onSmartView: (value: SmartView) => void;
  onStatus: (value: StatusKey) => void;
  onClose: () => void;
}) {
  const total = counts.smart[smartView] ?? 0;

  return (
    <Sheet
      open={open}
      title="Filter"
      detail="A smart view and a status, together."
      onClose={onClose}
    >
      <ScrollView>
        <OptionList
          options={SMART_VIEWS}
          selected={smartView}
          counts={counts.smart}
          onSelect={onSmartView}
        />

        <OptionList
          options={STATUSES}
          selected={status}
          counts={counts.status}
          onSelect={onStatus}
        />
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 16,
          paddingBottom: 4,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        {smartView !== "all" || status !== "all" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear both filters"
            onPress={() => {
              onSmartView("all");
              onStatus("all");
            }}
            style={({ pressed }) => ({
              paddingHorizontal: 16,
              paddingVertical: 13,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.pale : "white",
            })}
          >
            <Text
              style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}
            >
              Clear
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [
            styles.button,
            { flex: 1, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
            Show {total} {total === 1 ? "conversation" : "conversations"}
          </Text>
        </Pressable>
      </View>
    </Sheet>
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
  const [smartView, setSmartView] = useState<SmartView>("all");
  const [status, setStatus] = useState<StatusKey>("all");
  const [smartOpen, setSmartOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [messageMatches, setMessageMatches] = useState<Set<string>>(
    () => new Set(),
  );

  /*
   * Assignment is recorded against this workspace's member row, so the id
   * has to come from the workspace in view rather than from the session.
   */
  const memberId = workspace?.memberId ?? null;

  const activeSmart = SMART_VIEWS.find((option) => option.key === smartView);
  const activeStatus = STATUSES.find((option) => option.key === status);
  const filtering = smartView !== "all" || status !== "all";

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
            matchesSmartView(conversation, smartView, memberId) &&
            matchesStatus(conversation, status) &&
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
    [
      channelId,
      conversations,
      memberId,
      messageMatches,
      search,
      smartView,
      status,
    ],
  );

  /*
   * Each count is what tapping that row would actually leave on screen, so
   * the two sheets read against each other: the statuses are counted inside
   * the smart view you are already in, and the smart views inside the status.
   * Counting each in isolation would promise "Open 466" from inside Unread
   * and then hand back nine.
   *
   * The channel counts; the search box does not. A number that moved while
   * you typed would be describing a list you are about to leave.
   */
  const counts = useMemo(() => {
    const inChannel = conversations.filter(
      (conversation) =>
        !channelId || conversation.social_account?.id === channelId,
    );

    return {
      smart: SMART_VIEWS.reduce(
        (totals, option) => ({
          ...totals,
          [option.key]: inChannel.filter(
            (conversation) =>
              matchesSmartView(conversation, option.key, memberId) &&
              matchesStatus(conversation, status),
          ).length,
        }),
        {} as Record<SmartView, number>,
      ),
      status: STATUSES.reduce(
        (totals, option) => ({
          ...totals,
          [option.key]: inChannel.filter(
            (conversation) =>
              matchesSmartView(conversation, smartView, memberId) &&
              matchesStatus(conversation, option.key),
          ).length,
        }),
        {} as Record<StatusKey, number>,
      ),
    };
  }, [channelId, conversations, memberId, smartView, status]);

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
      {/*
        Header, search and filters are one white surface.

        They were two blocks with a border between them, which drew a seam
        across the top of the screen and made the search box look like it
        belonged to the list rather than to the header. Same padding, one
        container, one edge where it meets the conversations.
      */}
      <View
        style={[
          styles.header,
          workspace
            ? { borderBottomWidth: 0, paddingBottom: 12, gap: 12 }
            : null,
        ]}
      >
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

        {/*
          Search and the filters only exist once a workspace is chosen --
          before that the list below is a workspace picker, and filtering it
          would be filtering the wrong thing.
        */}
        {workspace ? (
          <View style={{ gap: 10, marginHorizontal: 16 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
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
                The first is the shortcut, the second is everything.

                Smart views are what an agent moves between while working, so
                they get their own icon and their own three-row sheet. The
                filter icon opens the full list -- both smart views and every
                status -- for the times you are setting up a view rather than
                flicking between them. Each button wears its filter's icon
                when one is set, so the header says what is on without
                opening anything.
              */}
              <FilterButton
                icon={activeSmart?.icon ?? "albums-outline"}
                label={
                  smartView === "all"
                    ? "Smart views"
                    : `Smart view: ${activeSmart?.label}. Change it.`
                }
                active={smartView !== "all"}
                onPress={() => setSmartOpen(true)}
              />

              <FilterButton
                icon={
                  status === "all"
                    ? "options-outline"
                    : (activeStatus?.icon ?? "options-outline")
                }
                label={
                  filtering
                    ? `Filtered by ${[activeSmart, activeStatus]
                        .filter((option) => option && option.key !== "all")
                        .map((option) => option?.label)
                        .join(" and ")}. Change it.`
                    : "Filter conversations"
                }
                active={filtering}
                onPress={() => setStatusOpen(true)}
              />
            </View>

            {/*
              What is on, in words, and how to take it off. The icons say
              "something is filtered" but not what, and clearing one should
              not mean opening its sheet again to find All.
            */}
            {filtering ? (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {smartView !== "all" && activeSmart ? (
                  <FilterPill
                    label={activeSmart.label}
                    onClear={() => setSmartView("all")}
                  />
                ) : null}

                {status !== "all" && activeStatus ? (
                  <FilterPill
                    label={activeStatus.label}
                    onClear={() => setStatus("all")}
                  />
                ) : null}

                <Text style={[styles.muted, { fontSize: 12.5 }]}>
                  {ordered.length}{" "}
                  {ordered.length === 1 ? "conversation" : "conversations"}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <SmartViewSheet
        open={smartOpen}
        selected={smartView}
        counts={counts.smart}
        onSelect={setSmartView}
        onClose={() => setSmartOpen(false)}
      />

      <FilterSheet
        open={statusOpen}
        smartView={smartView}
        status={status}
        counts={counts}
        onSmartView={setSmartView}
        onStatus={setStatus}
        onClose={() => setStatusOpen(false)}
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
                 * Four ways to end up with an empty list and only one of them
                 * means the workspace is empty. Naming the wrong one sends
                 * somebody looking for a problem that is not there, so each
                 * filter names itself and the way back -- search and the two
                 * filters are all easy to leave set and forget.
                 */
                icon={search.trim() ? "search-outline" : "chatbubbles-outline"}
                title={
                  search.trim()
                    ? "No match"
                    : filtering
                      ? `Nothing ${[
                          smartView !== "all"
                            ? activeSmart?.label.toLowerCase()
                            : null,
                          status !== "all"
                            ? activeStatus?.label.toLowerCase()
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" and ")}`
                      : selectedChannel
                        ? "Nothing on this channel"
                        : "No conversations yet"
                }
                detail={
                  search.trim()
                    ? `No customer or message matches "${search.trim()}" here. Searching further back through a thread is on the web.`
                    : filtering
                      ? "Tap a filter chip above to clear it and see more."
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
