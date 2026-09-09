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
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar, Empty, IconName, TagChip, colors, styles } from "./ui";
import type { ConversationStatus } from "../lib/types";

/*
 * The customer, as a panel that slides in from the right.
 *
 * It was two bottom sheets. A sheet is the right shape for a short list of
 * choices and the wrong one for a record: the details, the state of the
 * conversation and everything you can do to it do not fit in the two thirds
 * of the screen a sheet is allowed, and scrolling a sheet fights the gesture
 * that dismisses it. The web keeps this in a right-hand rail; a phone has no
 * room for a rail beside the thread, so it arrives over it.
 */

const { width: SCREEN } = Dimensions.get("window");
const PANEL = Math.min(400, Math.round(SCREEN * 0.88));

/* How far the panel must be dragged before letting go closes it. */
const DISMISS_AFTER = PANEL * 0.3;

const FILL = {
  position: "absolute" as const,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

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

export type EditableField = "phone" | "customerNote";

const STATUSES: { key: ConversationStatus; label: string; icon: IconName }[] = [
  { key: "open", label: "Open", icon: "ellipse-outline" },
  { key: "pending", label: "Pending", icon: "time-outline" },
  { key: "resolved", label: "Resolved", icon: "checkmark-circle-outline" },
  { key: "closed", label: "Closed", icon: "archive-outline" },
  { key: "spam", label: "Spam", icon: "alert-circle-outline" },
];

const STATUS_TONE: Record<string, string> = {
  open: "#2FA36B",
  pending: "#C77700",
  resolved: colors.blue,
  closed: colors.muted,
  spam: colors.red,
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

/*
 * A titled group, drawn as a card on the panel's tinted ground.
 *
 * The sections used to be separated by hairlines on white, which left the
 * whole record as one long undifferentiated column -- the eye had nothing to
 * catch on and the headings did all the work. Cards give each group an edge,
 * and match how every other screen in the app is built.
 */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          paddingLeft: 4,
          fontSize: 11,
          fontWeight: "800",
          letterSpacing: 0.7,
          textTransform: "uppercase",
          color: colors.muted,
        }}
      >
        {title}
      </Text>

      <View
        style={{
          backgroundColor: "white",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 14,
          paddingVertical: 4,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** A hairline between two rows of the same card. */
function Divider() {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: colors.border,
        marginHorizontal: -14,
      }}
    />
  );
}

/** A copy button that says it worked, then goes quiet again. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label}`}
      hitSlop={10}
      onPress={() => {
        void Clipboard.setStringAsync(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      <Ionicons
        name={done ? "checkmark" : "copy-outline"}
        size={14}
        color={done ? "#2FA36B" : colors.muted}
      />
    </Pressable>
  );
}

/*
 * A field you can read, copy and change without leaving the panel.
 *
 * Both of these are things an agent learns mid-conversation -- a customer
 * says their number out loud and it wants writing down before the next
 * message arrives. Sending them to the web for that is how a phone number
 * ends up only in the thread.
 */
function Editable({
  icon,
  label,
  value,
  empty,
  multiline,
  busy,
  onSave,
}: {
  icon: IconName;
  label: string;
  value: string | null;
  empty: string;
  multiline?: boolean;
  busy: boolean;
  onSave: (next: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  const text = value?.trim() ?? "";

  useEffect(() => {
    if (!editing) {
      setDraft(value ?? "");
    }
  }, [value, editing]);

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={icon} size={13} color={colors.muted} />

        <Text style={{ fontSize: 12.5, color: colors.muted, flex: 1 }}>
          {label}
        </Text>

        {text && !editing ? <CopyButton value={text} label={label} /> : null}

        {/*
          A pencil, so the field says it can be changed. Both of these read as
          plain text otherwise, and "Not added" looks like a statement rather
          than an invitation -- an agent has no reason to try tapping it.
        */}
        {editing ? null : (
          <Ionicons name="pencil" size={13} color={colors.muted} />
        )}
      </View>

      {editing ? (
        <View style={{ gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            multiline={multiline}
            keyboardType={multiline ? "default" : "phone-pad"}
            placeholder={empty}
            placeholderTextColor={colors.muted}
            editable={!busy}
            style={[
              styles.input,
              { fontSize: 15, paddingVertical: 10, minHeight: multiline ? 78 : 0 },
            ]}
          />

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={async () => {
                if (await onSave(draft.trim())) {
                  setEditing(false);
                }
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                backgroundColor: pressed ? "#0072AB" : colors.blue,
              })}
            >
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text
                  style={{ color: "white", fontSize: 13, fontWeight: "700" }}
                >
                  Save
                </Text>
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setDraft(value ?? "");
                setEditing(false);
              }}
              style={{ paddingHorizontal: 14, paddingVertical: 8 }}
            >
              <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "700" }}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            text ? `${label}: ${text}. Edit it.` : `Add a ${label.toLowerCase()}`
          }
          onPress={() => setEditing(true)}
        >
          <Text
            style={{
              fontSize: 15,
              lineHeight: 21,
              color: text ? colors.ink : colors.muted,
            }}
          >
            {text || empty}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/*
 * One of the three things you can do to a conversation.
 *
 * A card each rather than three icons sharing one grey strip: they are
 * separate decisions, one of them is a toggle that stays on, and a strip gave
 * no way to show which. An active pin now reads as a filled card.
 */
function HeaderAction({
  icon,
  label,
  tint,
  active,
  busy,
  onPress,
}: {
  icon: IconName;
  label: string;
  tint?: string;
  active?: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const colour = tint ?? (active ? colors.blue : colors.ink);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: 5,
        paddingVertical: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: active ? colour : colors.border,
        backgroundColor: active
          ? tint === "#F04452"
            ? "#FFF1F2"
            : colors.pale
          : pressed
            ? colors.pale
            : "white",
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.blue} />
      ) : (
        <Ionicons name={icon} size={20} color={colour} />
      )}

      <Text
        numberOfLines={1}
        style={{ fontSize: 11.5, fontWeight: "800", color: colour }}
      >
        {label}
      </Text>
    </Pressable>
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
      <Ionicons name={icon} size={17} color={active ? colors.blue : colors.muted} />

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
  channelIcon,
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
  onSaveField,
  onClose,
  error,
}: {
  open: boolean;
  detail: CustomerDetail | null;
  loading: boolean;
  channelName: string | null;
  channelIcon: IconName;
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
  onSaveField: (field: EditableField, value: string) => Promise<boolean>;
  onClose: () => void;
  error: string;
}) {
  const insets = useSafeAreaInsets();

  const slide = useRef(new Animated.Value(PANEL)).current;
  const [mounted, setMounted] = useState(open);
  const [statusOpen, setStatusOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
    }

    Animated.timing(slide, {
      toValue: open ? 0 : PANEL,
      duration: open ? 220 : 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) {
        setMounted(false);
        setStatusOpen(false);
        setAssignOpen(false);
      }
    });
  }, [open, slide]);

  /*
   * Drag the panel back off to the right. Claimed only for a horizontal drag:
   * the panel scrolls, and a responder that took every touch would make the
   * record unreadable.
   */
  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,

      onPanResponderMove: (_event, gesture) => {
        slide.setValue(Math.max(0, gesture.dx));
      },

      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx > DISMISS_AFTER || gesture.vx > 0.5) {
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
  const statusLabel =
    STATUSES.find((option) => option.key === status)?.label ?? "Status";
  const statusIcon =
    STATUSES.find((option) => option.key === status)?.icon ?? "ellipse-outline";
  const assignedName =
    members.find((member) => member.id === assignedTo)?.full_name ?? null;

  return (
    <View style={FILL} pointerEvents="box-none">
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={{
          ...FILL,
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
        /*
         * Claim any touch nothing inside wanted. The backdrop runs the full
         * width behind this, and Android hands an unclaimed touch to the view
         * below -- so tapping a gap between the cards was closing the panel.
         */
        onStartShouldSetResponder={() => true}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: PANEL,
          backgroundColor: colors.background,
          borderLeftWidth: 1,
          borderLeftColor: colors.border,
          transform: [{ translateX: slide }],
        }}
      >
        {/*
          A refusal from anything in here has to be readable in here. The
          thread has its own error line, and it sits behind this panel: an
          agent tapping Save watched nothing happen and had no way to learn
          that the server had turned it down.
        */}
        {error ? (
          <View
            accessibilityRole="alert"
            style={{
              backgroundColor: "#FFF1EF",
              paddingTop: insets.top + 10,
              paddingBottom: 10,
              paddingHorizontal: 18,
            }}
          >
            <Text style={{ color: colors.red, fontSize: 13, lineHeight: 19 }}>
              {error}
            </Text>
          </View>
        ) : null}

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingTop: error ? 14 : insets.top + 14,
            paddingBottom: insets.bottom + 28,
            paddingHorizontal: 14,
            gap: 16,
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
              <View
                style={{
                  flexDirection: "row",
                  gap: 12,
                  padding: 14,
                  borderRadius: 16,
                  backgroundColor: "white",
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Avatar
                  name={customer.fullName}
                  uri={customer.profilePictureUrl}
                  size={46}
                />

                <View style={{ flex: 1, gap: 3 }}>
                  <View
                    style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                  >
                    <Text style={styles.heading} numberOfLines={2}>
                      {customer.fullName}
                    </Text>

                    <CopyButton value={customer.fullName} label="the name" />
                  </View>

                  {customer.platformUserId ? (
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 12, color: colors.muted }}
                    >
                      ID: {customer.platformUserId}
                    </Text>
                  ) : null}

                  {/* The page this customer reached, the way the web names it. */}
                  <View
                    style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                  >
                    <Ionicons name={channelIcon} size={13} color={colors.blue} />

                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 12.5, color: colors.ink, flexShrink: 1 }}
                    >
                      {channelName ?? "—"}
                    </Text>
                  </View>
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

              {/*
                The three things you do to a conversation, at the top where a
                toolbar belongs, rather than in a section at the bottom you
                have to scroll a record to reach.
              */}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <HeaderAction
                  icon={pinned ? "bookmark" : "bookmark-outline"}
                  label={pinned ? "Unpin" : "Pin"}
                  tint={pinned ? "#F04452" : undefined}
                  active={pinned}
                  busy={busy === "pin"}
                  onPress={onPin}
                />

                <HeaderAction
                  icon="mail-unread-outline"
                  label="Unread"
                  busy={busy === "unread"}
                  onPress={onUnread}
                />

                <HeaderAction
                  icon={statusIcon}
                  label={statusLabel}
                  tint={STATUS_TONE[status ?? "open"]}
                  busy={Boolean(busy?.startsWith("status:"))}
                  onPress={() => setStatusOpen((current) => !current)}
                />
              </View>

              {statusOpen ? (
                <View
                  style={{
                    backgroundColor: "white",
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.border,
                    paddingHorizontal: 14,
                    paddingVertical: 4,
                  }}
                >
                  {STATUSES.map((option) => (
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
                  ))}
                </View>
              ) : null}

              <Section title="Tags">
                <View style={{ paddingVertical: 12 }}>
                  {customer.tags.length === 0 ? (
                    <Text style={{ fontSize: 14.5, color: colors.muted }}>
                      No tag yet
                    </Text>
                  ) : (
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                    >
                      {customer.tags.map((tag) => (
                        <TagChip
                          key={tag.id}
                          name={tag.name}
                          color={tag.color}
                        />
                      ))}
                    </View>
                  )}
                </View>
              </Section>

              <Section title="Information">
                <View style={{ paddingVertical: 12 }}>
                  <Editable
                    icon="call-outline"
                    label="Phone"
                    value={customer.phone}
                    empty="Not added"
                    busy={busy === "field:phone"}
                    onSave={(next) => onSaveField("phone", next)}
                  />
                </View>

                <Divider />

                <View style={{ paddingVertical: 12 }}>
                  <Editable
                    icon="document-text-outline"
                    label="Note"
                    value={customer.customerNote}
                    empty="No customer note has been added."
                    multiline
                    busy={busy === "field:customerNote"}
                    onSave={(next) => onSaveField("customerNote", next)}
                  />
                </View>
              </Section>

              <Section title="Conversation">
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingVertical: 12,
                  }}
                >
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

                {currentMemberId && assignedTo !== currentMemberId ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy === `assign:${currentMemberId}`}
                    onPress={() => onAssign(currentMemberId)}
                    style={({ pressed }) => ({
                      alignSelf: "flex-start",
                      marginBottom: 12,
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

                <Divider />

                <View style={{ gap: 3, paddingVertical: 12 }}>
                  <View
                    style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={13}
                      color={colors.muted}
                    />

                    <Text style={{ fontSize: 12.5, color: colors.muted }}>
                      Customer since
                    </Text>
                  </View>

                  <Text style={{ fontSize: 15, color: colors.ink }}>
                    {stamp(customer.createdAt)}
                  </Text>
                </View>
              </Section>
            </>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/*
 * The button in the thread header that pulls the panel in.
 *
 * Three dots rather than a dock: the panel is everything else about this
 * conversation, and an overflow menu is the one control every phone user
 * already knows to press when they want the rest of it. The same control
 * whether you tap it or swipe the panel in from the right.
 */
export function PanelButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the customer panel. Or swipe in from the right edge."
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.icon,
        { opacity: disabled ? 0.35 : pressed ? 0.55 : 1 },
      ]}
    >
      <Ionicons name="ellipsis-vertical" size={22} color={colors.blue} />
    </Pressable>
  );
}

/*
 * Swipe anywhere on the thread, right to left, to pull the panel in.
 *
 * Taken on the capture phase and only for a clear leftward drag, so a tap on
 * a bubble still reaches the bubble and a vertical scroll still scrolls. An
 * edge strip did this before and was 22 points wide -- discoverable by
 * accident at best, and it swallowed taps on the right side of every
 * outgoing message.
 */
export function useThreadSwipe(onOpen: () => void, enabled: boolean) {
  const opened = useRef(false);

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        gesture.dx < -24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,

      onPanResponderGrant: () => {
        opened.current = false;
      },

      onPanResponderMove: (_event, gesture) => {
        if (!opened.current && gesture.dx < -40) {
          opened.current = true;
          onOpenRef.current();
        }
      },
    }),
  ).current;

  // Kept in a ref so the responder, created once, always calls the current
  // handler rather than the one that existed on first render.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  return enabled ? responder.panHandlers : {};
}
