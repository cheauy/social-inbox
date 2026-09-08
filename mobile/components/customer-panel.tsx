import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar, Empty, IconName, colors, styles } from "./ui";
import type { ConversationStatus } from "../lib/types";

/*
 * The customer, as a panel that slides in from the right.
 *
 * It was a bottom sheet, which is the right shape for a short list of choices
 * and the wrong one for a record: the customer's details, the state of the
 * conversation and everything you can do to it do not fit in the two thirds
 * of the screen a sheet is allowed, and scrolling a sheet fights the gesture
 * that dismisses it. The web keeps this in a right-hand rail. A phone has no
 * room for a rail beside the thread, so it arrives over it -- swipe in from
 * the right edge, swipe out to close.
 *
 * Status, assignment, pin and mark-unread live here too. They used to be a
 * second sheet of their own, which meant deciding what to do about a customer
 * and reading who they are were two different screens.
 */

const { width: SCREEN } = Dimensions.get("window");
const PANEL = Math.min(400, Math.round(SCREEN * 0.88));

/* How far the panel must be dragged before letting go closes it. */
const DISMISS_AFTER = PANEL * 0.3;

export type TeamMember = {
  id: string;
  full_name: string | null;
  role: string | null;
};

export type CustomerDetail = {
  customer: {
    id: string;
    fullName: string;
    profilePictureUrl: string | null;
    platformUserId: string | null;
    phone: string | null;
    address: string | null;
    customerNote: string | null;
    createdAt: string | null;
    lastActiveAt: string | null;
    tags: { id: string; name: string; color: string | null }[];
  };
};

const STATUSES: { key: ConversationStatus; label: string; icon: IconName }[] = [
  { key: "open", label: "Open", icon: "ellipse-outline" },
  { key: "pending", label: "Pending", icon: "time-outline" },
  { key: "resolved", label: "Resolved", icon: "checkmark-circle-outline" },
  { key: "closed", label: "Closed", icon: "archive-outline" },
  { key: "spam", label: "Spam", icon: "alert-circle-outline" },
];

const STATUS_TONE: Record<string, { text: string; fill: string }> = {
  open: { text: "#2FA36B", fill: "#E7F6EE" },
  pending: { text: "#C77700", fill: "#FFF4E3" },
  resolved: { text: colors.blue, fill: colors.pale },
  closed: { text: colors.muted, fill: colors.background },
  spam: { text: colors.red, fill: "#FFF1EF" },
};

function stamp(value?: string | null) {
  if (!value) return "—";

  const at = new Date(value);

  return `${at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}, ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      style={{
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        gap: 10,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: "800",
          letterSpacing: 0.7,
          textTransform: "uppercase",
          color: colors.muted,
        }}
      >
        {title}
      </Text>

      {children}
    </View>
  );
}

function Field({
  icon,
  label,
  value,
  muted,
}: {
  icon: IconName;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={icon} size={13} color={colors.muted} />
        <Text style={{ fontSize: 12.5, color: colors.muted }}>{label}</Text>
      </View>

      <Text
        style={{
          fontSize: 15,
          color: muted ? colors.muted : colors.ink,
          lineHeight: 21,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function ChoiceRow({
  icon,
  label,
  detail,
  active,
  busy,
  onPress,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  active: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 10,
        marginHorizontal: -10,
        borderRadius: 10,
        backgroundColor: pressed ? colors.pale : "transparent",
      })}
    >
      <Ionicons
        name={icon}
        size={17}
        color={active ? colors.blue : colors.muted}
      />

      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 14.5,
            color: colors.ink,
            fontWeight: active ? "800" : "500",
          }}
        >
          {label}
        </Text>

        {detail ? (
          <Text style={{ fontSize: 12, color: colors.muted }}>{detail}</Text>
        ) : null}
      </View>

      {busy ? (
        <ActivityIndicator color={colors.blue} />
      ) : active ? (
        <Ionicons name="checkmark" size={17} color={colors.blue} />
      ) : null}
    </Pressable>
  );
}

export function CustomerPanel({
  open,
  detail,
  loading,
  channelName,
  status,
  pinned,
  assignedTo,
  members,
  membersLoading,
  currentMemberId,
  busy,
  onStatus,
  onAssign,
  onPin,
  onUnread,
  onEditTags,
  onClose,
}: {
  open: boolean;
  detail: CustomerDetail | null;
  loading: boolean;
  channelName: string | null;
  status: ConversationStatus | null;
  pinned: boolean;
  assignedTo: string | null;
  members: TeamMember[];
  membersLoading: boolean;
  currentMemberId: string | null;
  busy: string | null;
  onStatus: (next: ConversationStatus) => void;
  onAssign: (memberId: string | null) => void;
  onPin: () => void;
  onUnread: () => void;
  onEditTags: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  const slide = useRef(new Animated.Value(PANEL)).current;
  const [mounted, setMounted] = useState(open);
  const [statusOpen, setStatusOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
    }

    Animated.timing(slide, {
      toValue: open ? 0 : PANEL,
      duration: open ? 220 : 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Unmounted only once it is off screen, so the contents do not vanish
      // mid-slide, and so a closed panel costs nothing.
      if (finished && !open) {
        setMounted(false);
        setStatusOpen(false);
        setAssignOpen(false);
      }
    });
  }, [open, slide]);

  /*
   * Drag the panel back off to the right to dismiss it.
   *
   * Claimed only for a horizontal drag: the panel scrolls, and a responder
   * that took every touch would make the record unreadable. Dragging left
   * does nothing -- the panel is already as far in as it goes.
   */
  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,

      onPanResponderMove: (_event, gesture) => {
        slide.setValue(Math.max(0, gesture.dx));
      },

      onPanResponderRelease: (_event, gesture) => {
        const goneFarEnough = gesture.dx > DISMISS_AFTER || gesture.vx > 0.5;

        if (goneFarEnough) {
          onClose();
          return;
        }

        Animated.spring(slide, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
    }),
  ).current;

  if (!mounted) {
    return null;
  }

  const customer = detail?.customer ?? null;
  const tone = STATUS_TONE[status ?? "open"] ?? STATUS_TONE.open;
  const assignedName =
    members.find((member) => member.id === assignedTo)?.full_name ?? null;

  return (
    <View style={{ ...StyleSheetAbsolute }} pointerEvents="box-none">
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={{
          ...StyleSheetAbsolute,
          backgroundColor: "rgba(16,34,56,0.35)",
          opacity: slide.interpolate({
            inputRange: [0, PANEL],
            outputRange: [1, 0],
          }),
        }}
      >
        <Pressable
          accessibilityLabel="Close customer details"
          onPress={onClose}
          style={{ flex: 1 }}
        />
      </Animated.View>

      <Animated.View
        {...drag.panHandlers}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: PANEL,
          backgroundColor: "white",
          borderLeftWidth: 1,
          borderLeftColor: colors.border,
          transform: [{ translateX: slide }],
        }}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 14,
            paddingBottom: insets.bottom + 28,
            paddingHorizontal: 18,
          }}
        >
          {loading && !customer ? (
            <View style={{ paddingVertical: 60 }}>
              <ActivityIndicator color={colors.blue} />
            </View>
          ) : !customer ? (
            <Empty
              icon="person-outline"
              title="No customer record"
              detail="This conversation is not linked to a customer yet. It will be as soon as the next message arrives."
            />
          ) : (
            <>
              <View style={{ flexDirection: "row", gap: 12, paddingBottom: 14 }}>
                <Avatar
                  name={customer.fullName}
                  uri={customer.profilePictureUrl}
                  size={46}
                />

                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.heading} numberOfLines={2}>
                    {customer.fullName}
                  </Text>

                  {customer.platformUserId ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Copy the customer ID"
                      onPress={() => {
                        void Clipboard.setStringAsync(
                          customer.platformUserId as string,
                        );

                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{ fontSize: 12, color: colors.muted, flexShrink: 1 }}
                      >
                        ID: {customer.platformUserId}
                      </Text>

                      <Ionicons
                        name={copied ? "checkmark" : "copy-outline"}
                        size={13}
                        color={copied ? "#2FA36B" : colors.muted}
                      />
                    </Pressable>
                  ) : null}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close customer details"
                  hitSlop={10}
                  onPress={onClose}
                >
                  <Ionicons name="close" size={22} color={colors.muted} />
                </Pressable>
              </View>

              <Section title="Contact">
                <Field
                  icon="call-outline"
                  label="Phone"
                  value={customer.phone?.trim() || "Not added"}
                  muted={!customer.phone?.trim()}
                />

                {customer.address?.trim() ? (
                  <Field
                    icon="location-outline"
                    label="Address"
                    value={customer.address}
                  />
                ) : null}
              </Section>

              <Section title="Customer note">
                <Field
                  icon="document-text-outline"
                  label="Note"
                  value={
                    customer.customerNote?.trim() ||
                    "No customer note has been added."
                  }
                  muted={!customer.customerNote?.trim()}
                />
              </Section>

              <Section title="Channel">
                {customer.platformUserId ? (
                  <Field
                    icon="finger-print-outline"
                    label="Customer ID"
                    value={customer.platformUserId}
                  />
                ) : null}

                <Field
                  icon="flag-outline"
                  label="Page"
                  value={channelName ?? "—"}
                />
              </Section>

              <Section title="Conversation">
                {/*
                  Status reads as a badge and opens as a list, so the common
                  case -- glancing at where this conversation stands -- costs
                  nothing, and changing it costs one tap.
                */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Status: ${status ?? "unknown"}. Change it.`}
                  onPress={() => setStatusOpen((current) => !current)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={13}
                    color={colors.muted}
                  />

                  <Text style={{ fontSize: 12.5, color: colors.muted, flex: 1 }}>
                    Status
                  </Text>

                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: tone.fill,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: "800",
                        color: tone.text,
                        textTransform: "capitalize",
                      }}
                    >
                      {status ?? "—"}
                    </Text>
                  </View>

                  <Ionicons
                    name={statusOpen ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={colors.muted}
                  />
                </Pressable>

                {statusOpen
                  ? STATUSES.map((option) => (
                      <ChoiceRow
                        key={option.key}
                        icon={option.icon}
                        label={option.label}
                        active={status === option.key}
                        busy={busy === `status:${option.key}`}
                        onPress={() => {
                          onStatus(option.key);
                          setStatusOpen(false);
                        }}
                      />
                    ))
                  : null}

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="person-outline" size={13} color={colors.muted} />

                  <Text style={{ fontSize: 12.5, color: colors.muted, flex: 1 }}>
                    Assigned to
                  </Text>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Change who this is assigned to"
                    onPress={() => setAssignOpen((current) => !current)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        color: assignedTo ? colors.ink : colors.muted,
                        fontWeight: assignedTo ? "700" : "500",
                      }}
                    >
                      {assignedName ?? (assignedTo ? "Someone" : "Unassigned")}
                    </Text>

                    <Ionicons
                      name={assignOpen ? "chevron-up" : "chevron-down"}
                      size={14}
                      color={colors.muted}
                    />
                  </Pressable>
                </View>

                {/*
                  The web's one-tap "Assign to me", which is the only
                  assignment most agents ever make.
                */}
                {currentMemberId && assignedTo !== currentMemberId ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy === `assign:${currentMemberId}`}
                    onPress={() => onAssign(currentMemberId)}
                    style={({ pressed }) => ({
                      alignSelf: "flex-start",
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 8,
                      backgroundColor: pressed ? colors.border : colors.pale,
                    })}
                  >
                    {busy === `assign:${currentMemberId}` ? (
                      <ActivityIndicator color={colors.blue} />
                    ) : (
                      <Text
                        style={{
                          color: colors.blue,
                          fontSize: 13,
                          fontWeight: "700",
                        }}
                      >
                        Assign to me
                      </Text>
                    )}
                  </Pressable>
                ) : null}

                {assignOpen ? (
                  membersLoading ? (
                    <ActivityIndicator color={colors.blue} />
                  ) : (
                    <>
                      <ChoiceRow
                        icon="person-remove-outline"
                        label="Nobody"
                        active={!assignedTo}
                        busy={busy === "assign:none"}
                        onPress={() => onAssign(null)}
                      />

                      {members.map((member) => (
                        <ChoiceRow
                          key={member.id}
                          icon="person-outline"
                          label={member.full_name ?? "Team member"}
                          detail={member.role ?? undefined}
                          active={assignedTo === member.id}
                          busy={busy === `assign:${member.id}`}
                          onPress={() => onAssign(member.id)}
                        />
                      ))}
                    </>
                  )
                ) : null}

                <Field
                  icon="calendar-outline"
                  label="Customer since"
                  value={stamp(customer.createdAt)}
                />

                <Field
                  icon="time-outline"
                  label="Last active"
                  value={stamp(customer.lastActiveAt)}
                />
              </Section>

              <Section title="Tags">
                {customer.tags.length === 0 ? (
                  <Text style={{ fontSize: 14, color: colors.muted }}>
                    No tags yet
                  </Text>
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {customer.tags.map((tag) => (
                      <View
                        key={tag.id}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 999,
                          backgroundColor: colors.pale,
                        }}
                      >
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor: tag.color ?? colors.muted,
                          }}
                        />

                        <Text
                          style={{
                            color: colors.ink,
                            fontSize: 12.5,
                            fontWeight: "700",
                          }}
                        >
                          {tag.name}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                <ChoiceRow
                  icon="pricetag-outline"
                  label="Edit tags"
                  active={false}
                  busy={false}
                  onPress={onEditTags}
                />
              </Section>

              <Section title="Other">
                <ChoiceRow
                  icon={pinned ? "pin" : "pin-outline"}
                  label={pinned ? "Unpin from the top" : "Pin to the top"}
                  active={pinned}
                  busy={busy === "pin"}
                  onPress={onPin}
                />

                <ChoiceRow
                  icon="mail-unread-outline"
                  label="Mark unread and go back"
                  detail="Puts it back on the pile for whoever picks it up next."
                  active={false}
                  busy={busy === "unread"}
                  onPress={onUnread}
                />
              </Section>
            </>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/* Repeated on the scrim and its container; named so the intent is legible. */
const StyleSheetAbsolute = {
  position: "absolute" as const,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

/*
 * The strip along the right edge of the thread that opens the panel.
 *
 * A gesture nobody can see is a gesture nobody uses, so the header keeps its
 * button and this is the shortcut for the people who find it. Narrow, and
 * claimed only for a leftward drag, so the message list keeps every vertical
 * touch and every tap.
 */
export function CustomerPanelEdge({ onOpen }: { onOpen: () => void }) {
  const edge = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx < -12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,

      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx < -24) {
          onOpen();
        }
      },
    }),
  ).current;

  return (
    <View
      {...edge.panHandlers}
      pointerEvents="box-only"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        right: 0,
        width: 22,
      }}
    />
  );
}
