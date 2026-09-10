import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Animated,
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
  PlatformMark,
  Sheet,
  TagChip,
  colors,
  relativeTime,
  styles,
} from "../../components/ui";
import { useWorkspaceResource } from "../../components/screen";
import { api } from "../../lib/api/client";
import { useAuth } from "../../lib/auth/provider";
import { useInbox } from "../../lib/inbox-provider";
import type { InboxConversation, Workspace } from "../../lib/types";

/*
 * Placeholder rows, shaped like the real ones.
 *
 * Switching channel throws away four hundred rows and builds a different set,
 * and on a mid-range phone that lands as a stall with the old list still on
 * screen -- which reads as the tap not having worked. Rows that are visibly
 * not the answer are better than the wrong answer held still.
 */
function ListSkeleton() {
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => loop.stop();
  }, [pulse]);

  return (
    <View>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <Animated.View
          key={row}
          style={{
            opacity: pulse,
            flexDirection: "row",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: colors.border,
            }}
          />

          <View style={{ flex: 1, gap: 8, paddingTop: 6 }}>
            <View
              style={{
                height: 11,
                width: `${45 + ((row * 13) % 30)}%`,
                borderRadius: 6,
                backgroundColor: colors.border,
              }}
            />

            <View
              style={{
                height: 10,
                width: `${60 + ((row * 17) % 25)}%`,
                borderRadius: 5,
                backgroundColor: colors.background,
              }}
            />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const ConversationRow = memo(function ConversationRow({
  conversation,
  onPress,
}: {
  conversation: InboxConversation;
  onPress: () => void;
}) {
  const unread = (conversation.unread_count ?? 0) > 0;
  const tags = conversation.contact?.tags ?? [];

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
          /*
           * An unread row is tinted, not just bolder. Weight alone is hard to
           * pick out of a list of four hundred while scrolling, and the badge
           * is at the far right where the eye is not.
           */
          backgroundColor: pressed
            ? colors.border
            : unread
              ? colors.pale
              : "white",
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <ChannelAvatar conversation={conversation} />

      <View style={{ flex: 1, gap: 3 }}>
        <View style={[styles.row, { gap: 7 }]}>
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

          {conversation.is_pinned ? (
            <Ionicons
              accessibilityLabel="Pinned conversation"
              name="bookmark"
              size={14}
              color={colors.pin}
            />
          ) : null}

          <Text style={{ fontSize: 12, color: colors.muted }}>
            {relativeTime(conversation.last_message_at)}
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
          The customer's tags, under the preview.

          This is the line the channel name used to waste. A tag is why a row
          matters -- VIP, COD, a complaint -- and the avatar already says
          which network it came in on.
        */}
        {tags.length > 0 || unread ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 1,
              minHeight: 22,
            }}
          >
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                overflow: "hidden",
              }}
            >
              {tags.slice(0, 4).map((tag) => (
                <TagChip
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  compact
                  showCheck={false}
                />
              ))}

              {tags.length > 4 ? (
                <Text style={{ fontSize: 11, color: colors.muted }}>
                  +{tags.length - 4}
                </Text>
              ) : null}
            </View>

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
        ) : null}
      </View>
    </Pressable>
  );
});


type Channel = {
  id: string;
  businessId: string;
  platform: "facebook" | "telegram";
  name: string;
  username: string | null;
};

type Tag = {
  id: string;
  name: string;
  color: string | null;
};

/*
 * A tag, and the workspace it belongs to.
 *
 * Tags are workspace data. With two workspaces merged into one list there can
 * be two "VIP"s, and which one is being filtered on changes the answer, so
 * the workspace travels with the tag rather than being assumed from whichever
 * one happens to be active.
 */
type ScopedTag = Tag & { businessId: string };

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
  workspaceNames,
  selectedId,
  onSelect,
  onClose,
}: {
  open: boolean;
  channels: Channel[];
  /* Empty unless more than one workspace is open. */
  workspaceNames: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  /* The same keyboard rule the shared Sheet follows -- see Sheet in ui.tsx. */
  useEffect(() => {
    if (open) {
      Keyboard.dismiss();
      return;
    }

    const frame = requestAnimationFrame(() => Keyboard.dismiss());
    const later = setTimeout(() => Keyboard.dismiss(), 180);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
    };
  }, [open]);

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
                {/*
                  The channel's own mark, not a glyph standing in for it.
                  A row that says "Apex Clothing" and shows a grey paper
                  plane makes you read the words to learn what it is; the
                  logo is the thing an agent already recognises.
                */}
                {item === null ? (
                  <Ionicons name="layers" size={24} color={colors.blue} />
                ) : (
                  <PlatformMark
                    platform={item.platform === "telegram" ? "telegram" : "messenger"}
                    size={24}
                  />
                )}

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

                  <Text style={[styles.muted, { fontSize: 12 }]} numberOfLines={1}>
                    {item === null
                      ? "Messenger and Telegram"
                      : /*
                          The workspace's name is appended when two are open:
                          a Page belongs to one of them, and two shops can
                          easily run Pages with similar names.
                        */
                        [
                          item.username
                            ? `@${item.username}`
                            : item.platform === "telegram"
                              ? "Telegram"
                              : "Messenger",
                          workspaceNames[item.businessId],
                        ]
                          .filter(Boolean)
                          .join(" · ")}
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
 * Tags to filter by -- more than one at a time.
 *
 * It used to close on the first tap and show one tag's customers, which is
 * the wrong shape for the question people actually ask here: "who has bought
 * and is COD", or "show me VIP and complaints together". Several ticked tags
 * mean a customer carrying any of them, the same rule the website's tag
 * filter uses, and the sheet stays open until it is done being answered.
 */
function TagSheet({
  open,
  tags,
  workspaceNames,
  selectedIds,
  counts,
  onToggle,
  onClear,
  onClose,
}: {
  open: boolean;
  tags: ScopedTag[];
  /* Empty unless more than one workspace is open. */
  workspaceNames: Record<string, string>;
  selectedIds: string[];
  counts: Record<string, number>;
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const chosen = selectedIds.length;

  return (
    <Sheet
      open={open}
      title="Filter by Tags"
      detail={
        chosen === 0
          ? "Pick one or more tags. A customer with any of them is shown."
          : chosen === 1
            ? "1 tag picked. A customer with any picked tag is shown."
            : `${chosen} tags picked. A customer with any of them is shown.`
      }
      onClose={onClose}
    >
      <ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: chosen === 0 }}
          onPress={() => {
            onClear();
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
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.pale,
            }}
          >
            <Ionicons name="pricetag-outline" size={15} color={colors.blue} />
          </View>

          <Text
            style={{
              flex: 1,
              color: colors.ink,
              fontSize: 15,
              fontWeight: chosen === 0 ? "800" : "500",
            }}
          >
            All tags
          </Text>

          <Text style={[styles.muted, { fontSize: 13 }]}>{counts.all ?? 0}</Text>

          {chosen === 0 ? (
            <Ionicons name="checkmark" size={19} color={colors.blue} />
          ) : null}
        </Pressable>

        {tags.map((tag) => {
          const active = selectedIds.includes(tag.id);

          return (
            <Pressable
              key={tag.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              /* No close: picking a second tag is the point. */
              onPress={() => onToggle(tag.id)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 18,
                paddingVertical: 14,
                backgroundColor: pressed ? colors.pale : "transparent",
              })}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.pale,
                }}
              >
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: tag.color ?? colors.muted,
                  }}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.ink,
                    fontSize: 15,
                    fontWeight: active ? "800" : "500",
                  }}
                >
                  {tag.name}
                </Text>

                {/*
                  Which workspace's tag this is, when two are open. Two shops
                  both have a VIP, and picking the wrong one filters the list
                  to nothing for no visible reason.
                */}
                {workspaceNames[tag.businessId] ? (
                  <Text numberOfLines={1} style={[styles.muted, { fontSize: 11.5 }]}>
                    {workspaceNames[tag.businessId]}
                  </Text>
                ) : null}
              </View>

              <Text style={[styles.muted, { fontSize: 13 }]}>
                {counts[tag.id] ?? 0}
              </Text>

              {/*
                A box rather than a tick, because a tick that appears and
                disappears reads as "this one" where a row of boxes reads as
                "as many as you like".
              */}
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 7,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: active ? 0 : 1.5,
                  borderColor: colors.border,
                  backgroundColor: active ? colors.blue : "transparent",
                }}
              >
                {active ? (
                  <Ionicons name="checkmark" size={14} color="white" />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/*
        Done, once anything is ticked. The sheet no longer closes itself, so
        there has to be a way out that is not the backdrop -- and it says what
        it is about to leave behind.
      */}
      {chosen > 0 ? (
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear tag filter"
            onPress={onClear}
            style={({ pressed }) => ({
              paddingHorizontal: 16,
              paddingVertical: 13,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.pale : "white",
            })}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>
              Clear
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => ({
              flex: 1,
              alignItems: "center",
              paddingVertical: 13,
              borderRadius: 12,
              backgroundColor: pressed ? "#0A6FA8" : colors.blue,
            })}
          >
            <Text style={{ fontSize: 15, fontWeight: "800", color: "white" }}>
              Show {chosen === 1 ? "1 tag" : `${chosen} tags`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Sheet>
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
  badge = 0,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  active: boolean;
  /* How many tags are picked. Nothing is drawn for one: the button is
     already filled, and "1" beside a funnel is a number nobody needs. */
  badge?: number;
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

      {badge > 1 ? (
        <View
          style={{
            position: "absolute",
            top: -5,
            right: -5,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: "white",
            backgroundColor: colors.ink,
          }}
        >
          <Text style={{ color: "white", fontSize: 10, fontWeight: "800" }}>
            {badge}
          </Text>
        </View>
      ) : null}
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
        /* Pinned wears the pin's own colour, so the filter and the mark on
           the rows it filters to are visibly the same thing. */
        color={
          option.key === "pinned"
            ? colors.pin
            : active
              ? colors.blue
              : colors.muted
        }
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
    merged,
    revision,
    conversations,
    loading,
    error,
    live,
    refresh,
    loadWorkspaces,
    selectWorkspace,
  } = useInbox();

  const [refreshing, setRefreshing] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);

  const toggleTagFilter = useCallback((id: string) => {
    setTagIds((current) =>
      current.includes(id)
        ? current.filter((one) => one !== id)
        : [...current, id],
    );
  }, []);

  /*
   * The sheet closes on the tap, before anything is filtered.
   *
   * Doing both in one pass meant the sheet sat there through the re-render
   * and then vanished, so the tap felt ignored and then abrupt. The filter
   * goes on the next tick behind a skeleton, which is the part that actually
   * takes time.
   */
  const chooseChannel = useCallback((next: string | null) => {
    setChannelOpen(false);
    setChannelId(next);
  }, []);
  const [search, setSearch] = useState("");

  /*
   * Let go of the search box before a filter sheet opens.
   *
   * Android restores focus to whatever had it when a modal closes, and the
   * sheets dismiss the keyboard on their own way out -- but a field that is
   * still focused underneath will pull it back up the next time anything
   * touches focus. Blurring here means the tap that opens a filter also ends
   * the typing it interrupted, which is what it looks like it should do.
   */
  const searchField = useRef<TextInput>(null);

  const openFilter = useCallback((show: () => void) => {
    searchField.current?.blur();
    Keyboard.dismiss();
    show();
  }, []);
  const deferredSearch = useDeferredValue(search);
  const [smartView, setSmartView] = useState<SmartView>("all");
  const [status, setStatus] = useState<StatusKey>("all");
  const [statusOpen, setStatusOpen] = useState(false);
  const [messageMatches, setMessageMatches] = useState<Set<string>>(
    () => new Set(),
  );

  /* Keep relative timestamps moving from Now -> 1 min ago -> 1 hr ago. */
  const [, setClockTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setClockTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  /*
   * Assignment is recorded against this workspace's member row, so the id
   * has to come from the workspace in view rather than from the session.
   */
  const memberId = workspace?.memberId ?? null;

  /*
   * "Mine" means a different row in every workspace.
   *
   * Assignment is recorded against a team_members row, and somebody who
   * belongs to two workspaces has two of them. With both merged into one list,
   * comparing everything against the active workspace's id would quietly hide
   * every conversation assigned to them in the other shop.
   */
  const memberIdFor = useCallback(
    (businessId: string) =>
      workspaces.find((one) => one.businessId === businessId)?.memberId ??
      memberId,
    [workspaces, memberId],
  );

  /*
   * The workspaces this list is drawn from: the merged set, or just the one.
   * Everything the Inbox asks the server for is asked once per workspace in
   * it, because every one of those answers -- tags, channels, search -- is
   * workspace data and belongs to exactly one of them.
   */
  const scope = useMemo(
    () => (merged.length > 0 ? merged : workspace ? [workspace.businessId] : []),
    [merged, workspace?.businessId],
  );

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
      /*
       * One search per open workspace, unioned. The endpoint answers for the
       * workspace the request carries, so a merged list searching only the
       * active one would find a phone number in one shop's history and
       * silently miss the identical one in the other's.
       */
      void Promise.all(
        scope.map((businessId) =>
          api<{ conversationIds?: string[] }>(
            `/api/inbox/search-messages?q=${encodeURIComponent(keyword)}`,
            businessId,
            { signal: controller.signal },
          ).then((result) => result.conversationIds ?? []),
        ),
      )
        .then((lists) => setMessageMatches(new Set(lists.flat())))
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
  }, [search, scope]);

  const { data: channelData } = useWorkspaceResource<{ channels: Channel[] }>(
    workspace ? "/api/inbox/channels" : null,
  );

  /*
   * Only the channels of the workspaces actually open. The endpoint answers
   * for every workspace the member can reach, and offering one that is not in
   * the list would filter it down to nothing with no way to tell why.
   */
  const channels = useMemo(
    () =>
      (channelData?.channels ?? []).filter((item) =>
        scope.includes(item.businessId),
      ),
    [channelData?.channels, scope],
  );

  /*
   * Tags, per workspace, exactly as the website scopes them.
   *
   * A tag belongs to one workspace: two shops both have a "VIP" and they are
   * two different rows with two different ids and often two different
   * colours. One request per open workspace keeps them apart -- the endpoint
   * takes a businessId and checks the membership behind it -- and each tag
   * carries the workspace it came from, so the filter sheet can say which
   * "VIP" it is about and the count beside it can only ever count that
   * workspace's customers.
   */
  const [tags, setTags] = useState<ScopedTag[]>([]);

  useEffect(() => {
    if (scope.length === 0) {
      setTags([]);
      return;
    }

    let alive = true;

    void Promise.all(
      scope.map((businessId) =>
        api<{ tags: Tag[] }>(
          `/api/tags?activeOnly=true&businessId=${encodeURIComponent(businessId)}`,
          businessId,
        )
          .then((data) =>
            (data.tags ?? []).map((tag) => ({ ...tag, businessId })),
          )
          /* One workspace failing must not empty the other one's tags. */
          .catch(() => [] as ScopedTag[]),
      ),
    ).then((lists) => {
      if (alive) setTags(lists.flat());
    });

    return () => {
      alive = false;
    };
  }, [scope, revision]);

  const selectedChannel =
    channels.find((item) => item.id === channelId) ?? null;
  const selectedTags = useMemo(
    () => tags.filter((item) => tagIds.includes(item.id)),
    [tags, tagIds],
  );

  /*
   * A conversation passes the tag filter when its customer carries any one of
   * the picked tags -- the same rule the website uses. "All of them" sounds
   * stricter and more useful and is neither: two tags that rarely co-occur
   * give an empty list and no clue why.
   */
  const matchesTags = useCallback(
    (conversation: InboxConversation) =>
      tagIds.length === 0 ||
      (conversation.contact?.tags ?? []).some((tag) => tagIds.includes(tag.id)),
    [tagIds],
  );

  /*
   * Names to label tags with, and only when there is something to tell apart:
   * a single workspace's tags do not need its name repeated down the sheet.
   */
  const tagWorkspaceNames = useMemo(() => {
    if (scope.length < 2) return {};

    return Object.fromEntries(
      workspaces
        .filter((one) => scope.includes(one.businessId))
        .map((one) => [one.businessId, one.businessName]),
    );
  }, [scope, workspaces]);
  const hasAnyFilter = filtering || selectedTags.length > 0;

  const ordered = useMemo(
    () =>
      conversations
        .filter(
          (conversation) =>
            (!channelId ||
              conversation.social_account?.id === channelId) &&
            matchesTags(conversation) &&
            matchesSmartView(conversation, smartView, memberIdFor(conversation.business_id)) &&
            matchesStatus(conversation, status) &&
            (matchesSearch(conversation, deferredSearch.trim().toLowerCase()) ||
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
      deferredSearch,
      smartView,
      status,
      matchesTags,
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
        (!channelId || conversation.social_account?.id === channelId) &&
        matchesTags(conversation),
    );

    return {
      smart: SMART_VIEWS.reduce(
        (totals, option) => ({
          ...totals,
          [option.key]: inChannel.filter(
            (conversation) =>
              matchesSmartView(conversation, option.key, memberIdFor(conversation.business_id)) &&
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
              matchesSmartView(conversation, smartView, memberIdFor(conversation.business_id)) &&
              matchesStatus(conversation, option.key),
          ).length,
        }),
        {} as Record<StatusKey, number>,
      ),
    };
  }, [channelId, conversations, memberIdFor, smartView, status, matchesTags]);

  const tagCounts = useMemo(() => {
    const eligible = conversations.filter(
      (conversation) =>
        (!channelId || conversation.social_account?.id === channelId) &&
        matchesSmartView(conversation, smartView, memberIdFor(conversation.business_id)) &&
        matchesStatus(conversation, status),
    );

    return tags.reduce(
      (totals, tag) => ({
        ...totals,
        [tag.id]: eligible.filter((conversation) =>
          (conversation.contact?.tags ?? []).some((item) => item.id === tag.id),
        ).length,
      }),
      { all: eligible.length } as Record<string, number>,
    );
  }, [channelId, conversations, memberIdFor, smartView, status, tags]);

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  /*
   * Which workspace comes before anything a tab can show, so it is asked on
   * its own screen rather than under a tab bar whose other four tabs cannot
   * answer until it is settled. Held until the list has actually loaded --
   * redirecting on the empty first frame would bounce anybody who already has
   * a workspace out to a chooser and straight back.
   */
  if (!workspace && !loading) {
    return <Redirect href="/workspaces" />;
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

  return (
    <View style={styles.screen}>
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
          { paddingTop: insets.top + 16 },
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

          {/*
            The workspace name is the way back to choosing one.
            
            The back gesture works too now that the chooser is underneath, but
            a gesture is not a thing you can see: somebody who wants the other
            shop needs somewhere to press, and the name of the one they are in
            is where they will press.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              workspace
                ? merged.length > 1
                  ? `${merged.length} workspaces merged. Switch workspace.`
                  : `${workspace.businessName}. Switch workspace.`
                : "Choose a workspace"
            }
            onPress={() => router.push("/workspaces")}
            style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={[styles.title, { fontSize: 24 }]}>Inbox</Text>

            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              {/*
                What this list is of. With several workspaces merged, naming
                only the active one would describe a third of what is on
                screen and read as a bug.
              */}
              <Text style={styles.muted} numberOfLines={1}>
                {merged.length > 1
                  ? `${merged.length} workspaces merged`
                  : (workspace?.businessName ?? "Choose a workspace")}
              </Text>

              <Ionicons name="swap-horizontal" size={13} color={colors.muted} />
            </View>
          </Pressable>

          {/* The channel filter. */}
          {workspace ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                selectedChannel
                  ? `Channel: ${selectedChannel.name}. Change channel.`
                  : "All channels. Change channel."
              }
              onPress={() => openFilter(() => setChannelOpen(true))}
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
              {!selectedChannel ? (
                <Ionicons name="layers" size={16} color={colors.blue} />
              ) : (
                <PlatformMark
                  platform={
                    selectedChannel.platform === "telegram" ? "telegram" : "messenger"
                  }
                  size={16}
                />
              )}

              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  color: colors.ink,
                  fontSize: 12.5,
                  fontWeight: "700",
                }}
              >
                {selectedChannel?.name ?? "All Channels"}
              </Text>

              <Ionicons
                name="chevron-down"
                size={13}
                color={colors.muted}
              />

              {/*
                Nothing while realtime is connected, which is nearly always.
                A green dot that is always green is not information -- but the
                moment it stops being true an agent is reading a list that has
                quietly stopped updating, and that is worth a mark.
              */}
              {live ? null : (
                <Ionicons
                  name="cloud-offline-outline"
                  accessibilityLabel="Live updates offline"
                  size={14}
                  color="#C77700"
                />
              )}
            </Pressable>
          ) : null}
        </View>

        {/*
          Search and the filters only exist once a workspace is chosen --
          before that the list below is a workspace picker, and filtering it
          would be filtering the wrong thing.
        */}
        {workspace ? (
          <View style={{ gap: 10 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
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
                  ref={searchField}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search name or number"
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

              <FilterButton
                icon={selectedTags.length > 0 ? "funnel" : "funnel-outline"}
                label={
                  selectedTags.length > 0
                    ? `Filtered by ${selectedTags.map((tag) => tag.name).join(", ")}. Change tags.`
                    : "Filter by tags"
                }
                active={selectedTags.length > 0}
                badge={selectedTags.length}
                onPress={() => openFilter(() => setTagOpen(true))}
              />

              {/*
                One button, because one sheet holds everything.

                A second icon opened a shortlist that was already inside the
                filter sheet, so it spent 42 points of a narrow header saying
                what the button beside it could say, and left the search box
                too short to read a name in.
              */}
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
                onPress={() => openFilter(() => setStatusOpen(true))}
              />
            </View>

            {/*
              What is on, in words, and how to take it off. The icons say
              "something is filtered" but not what, and clearing one should
              not mean opening its sheet again to find All.
            */}
            {hasAnyFilter ? (
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

                {/*
                  One pill per tag, each clearable on its own. A single pill
                  reading "3 tags" makes taking one of them back off an
                  all-or-nothing job.
                */}
                {selectedTags.map((tag) => (
                  <FilterPill
                    key={tag.id}
                    label={tag.name}
                    onClear={() => toggleTagFilter(tag.id)}
                  />
                ))}

                <Text style={[styles.muted, { fontSize: 12.5 }]}>
                  {ordered.length}{" "}
                  {ordered.length === 1 ? "conversation" : "conversations"}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <FilterSheet
        open={statusOpen}
        smartView={smartView}
        status={status}
        counts={counts}
        onSmartView={setSmartView}
        onStatus={setStatus}
        onClose={() => setStatusOpen(false)}
      />

      <TagSheet
        open={tagOpen}
        tags={tags}
        workspaceNames={tagWorkspaceNames}
        selectedIds={tagIds}
        counts={tagCounts}
        onToggle={toggleTagFilter}
        onClear={() => setTagIds([])}
        onClose={() => setTagOpen(false)}
      />

      <ChannelSheet
        open={channelOpen}
        channels={channels}
        workspaceNames={tagWorkspaceNames}
        selectedId={channelId}
        onSelect={chooseChannel}
        onClose={() => setChannelOpen(false)}
      />

      <ErrorNotice message={error} onRetry={() => void pullToRefresh()} />

      {!workspace ? (
        /*
         * Nothing to show until a workspace is chosen, and choosing one is a
         * screen of its own now -- with no tab bar under it, because none of
         * those tabs mean anything until this question is answered.
         */
        <View style={{ padding: 40 }}>
          <ActivityIndicator color={colors.blue} />
        </View>
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
                    : hasAnyFilter
                      ? `Nothing ${[
                          smartView !== "all"
                            ? activeSmart?.label.toLowerCase()
                            : null,
                          status !== "all"
                            ? activeStatus?.label.toLowerCase()
                            : null,
                          selectedTags.length > 0
                            ? `tagged ${selectedTags
                                .map((tag) => tag.name)
                                .join(" or ")}`
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
                    : hasAnyFilter
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
          initialNumToRender={14}
          maxToRenderPerBatch={12}
          updateCellsBatchingPeriod={24}
          windowSize={9}
          removeClippedSubviews
        />
      )}
    </View>
  );
}
