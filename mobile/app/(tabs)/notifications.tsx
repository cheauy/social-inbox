import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import DateTimePicker from "@react-native-community/datetimepicker";

import {
  Dialog,
  Empty,
  ErrorNotice,
  IconName,
  colors,
  relativeTime,
  styles,
} from "../../components/ui";
import { SwipeRow } from "../../components/swipe-row";
import { api } from "../../lib/api/client";
import { useAuth } from "../../lib/auth/provider";
import { useInbox } from "../../lib/inbox-provider";

/*
 * Everything TENH has to tell you that is not a customer message.
 *
 * The tab listed unread conversations, which the Inbox already does and does
 * better. What was missing is the rest of it: a mention in a team room, a
 * reminder falling due, a Facebook page that has stopped authorising, a
 * payment approved or rejected, a subscription running out, and whatever
 * TENH itself is announcing. The web gathers those in the bell; this is the
 * same set, from the same two endpoints.
 */

type Notification = {
  id: string;
  business_id: string;
  notification_type: string;
  /* Set on the alerts that belong to a thread -- a mention, a reminder. */
  conversation_id: string | null;
  title: string | null;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string | null;
};

type Announcement = {
  id: string;
  title: string | null;
  message: string | null;
  tone: string | null;
  link_label: string | null;
  link_url: string | null;
  created_at: string | null;
};

/*
 * A reminder somebody set on a conversation and has not dealt with yet.
 *
 * The alert only appears when one falls due, which is the wrong time to find
 * out you have eleven of them. The endpoint answers with every open one --
 * an owner sees the team's, everybody else sees their own -- so the tab can
 * say what is coming as well as what has arrived.
 */
type Reminder = {
  id: string;
  conversation_id: string;
  note: string;
  remind_at: string;
  contact: { id: string; full_name: string | null } | null;
  assigned_member: { id: string; full_name: string | null } | null;
};

type Subscription = {
  status: string;
  plan_code: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
};

/*
 * How each kind of alert looks. The web tints reminders amber, an approved
 * payment green and a rejected one red; the rest are blue. Same idea, because
 * an agent scanning the list is reading colour before words.
 */
const VISUALS: Record<string, { icon: IconName; tone: string }> = {
  conversation_reminder: { icon: "alarm-outline", tone: "#C77700" },
  team_chat_mention: { icon: "at-outline", tone: "#6D4AFF" },
  manual_payment_approved: { icon: "checkmark-circle-outline", tone: "#2FA36B" },
  manual_payment_rejected: { icon: "close-circle-outline", tone: colors.red },
  facebook_reauthorization_required: {
    icon: "warning-outline",
    tone: colors.red,
  },
  facebook_connection_attention: { icon: "warning-outline", tone: "#C77700" },
  tenh_customer_report: { icon: "help-buoy-outline", tone: colors.blue },
};

const visualOf = (type: string) =>
  VISUALS[type] ?? { icon: "notifications-outline" as IconName, tone: colors.blue };

/** Days until a date, rounded up, or null if there is no date. */
function daysUntil(value: string | null) {
  if (!value) return null;

  const days = Math.ceil(
    (new Date(value).getTime() - Date.now()) / 86400000,
  );

  return Number.isFinite(days) ? days : null;
}

/*
 * Four ways to read the same pile.
 *
 * Everything arrived as one list, so a mention from a colleague sat between a
 * payment receipt and a Facebook token warning, and a reminder was only
 * visible in the seconds after it fired. The tabs are what people actually
 * come here for: everything, the operational alerts, the times somebody said
 * your name, and what you have promised to do.
 */
type Tab = "all" | "alerts" | "team" | "remind";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "all", label: "All", icon: "albums-outline" },
  { key: "alerts", label: "Alerts", icon: "notifications-outline" },
  { key: "team", label: "Team", icon: "at-outline" },
  { key: "remind", label: "Remind", icon: "alarm-outline" },
];

const MENTION = "team_chat_mention";
const REMINDER = "conversation_reminder";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

      {children}
    </View>
  );
}

/*
 * What somebody has promised to do, and when.
 *
 * Sorted by the time it is due, soonest first, so the top of the list is the
 * next thing rather than the newest thing. An overdue one is amber and says
 * how late it is; the rest say when they land. Tapping opens the conversation
 * it was set on, which is the only reason anybody set it.
 */
function Reminders({
  reminders,
  busyId,
  onOpen,
  onComplete,
  onDelete,
  onEdit,
}: {
  reminders: Reminder[];
  busyId: string | null;
  onOpen: (reminder: Reminder) => void;
  onComplete: (id: string) => void;
  onDelete: (reminder: Reminder) => void;
  onEdit: (reminder: Reminder) => void;
}) {
  /* One row's drawer at a time; two open drawers is two half-read lists. */
  const [openId, setOpenId] = useState<string | null>(null);

  if (reminders.length === 0) {
    return (
      <View
        style={{
          padding: 28,
          borderRadius: 16,
          backgroundColor: "white",
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          gap: 6,
        }}
      >
        <Ionicons name="alarm-outline" size={26} color={colors.muted} />

        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
          Nothing to chase
        </Text>

        <Text style={[styles.muted, { fontSize: 13, textAlign: "center" }]}>
          Open a conversation, tap Remind in the customer panel, and it appears
          here until it is done.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        borderRadius: 16,
        backgroundColor: "white",
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      {reminders.map((reminder, index) => {
        const due = new Date(reminder.remind_at).getTime();
        const late = due <= Date.now();

        return (
          <View
            key={reminder.id}
            style={{
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colors.border,
            }}
          >
            {/*
              Done and Delete live off the right-hand edge.

              They sat on the row as buttons, six millimetres from the tap that
              opens the conversation -- and one of them throws a reminder away.
              Behind a deliberate drag, neither is something a thumb does by
              accident, and the row goes back to being a row.
            */}
            <SwipeRow
              id={reminder.id}
              openId={openId}
              onOpen={setOpenId}
              actions={[
                {
                  icon: "checkmark-done-outline",
                  label: "Done",
                  tone: "#2FA36B",
                  onPress: () => {
                    setOpenId(null);
                    onComplete(reminder.id);
                  },
                },
                {
                  icon: "trash-outline",
                  label: "Delete",
                  tone: colors.red,
                  onPress: () => {
                    setOpenId(null);
                    onDelete(reminder);
                  },
                },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${reminder.note}, ${
                  late ? "overdue" : "due"
                } ${relativeTime(reminder.remind_at)}`}
                onPress={() => onOpen(reminder)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 13,
                  backgroundColor: pressed
                    ? colors.border
                    : late
                      ? "#FBF6EA"
                      : "white",
                })}
              >
                <View
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 11,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: late ? "#F7E6C4" : colors.background,
                  }}
                >
                  {busyId === reminder.id ? (
                    <ActivityIndicator color={colors.blue} />
                  ) : (
                    <Ionicons
                      name={late ? "alarm" : "alarm-outline"}
                      size={17}
                      color={late ? "#C77700" : colors.muted}
                    />
                  )}
                </View>

                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={2}
                    style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}
                  >
                    {reminder.note}
                  </Text>

                  <Text numberOfLines={1} style={[styles.muted, { fontSize: 13 }]}>
                    {reminder.contact?.full_name ?? "Customer"}
                    {reminder.assigned_member?.full_name
                      ? ` · ${reminder.assigned_member.full_name}`
                      : ""}
                  </Text>

                  <Text
                    style={{
                      fontSize: 11.5,
                      fontWeight: late ? "800" : "400",
                      color: late ? "#C77700" : colors.muted,
                    }}
                  >
                    {late
                      ? `Due ${relativeTime(reminder.remind_at).toLowerCase()}`
                      : `In ${untilLabel(due)}`}
                  </Text>
                </View>

                {/*
                  The pencil stays on the row, at the far right: changing a
                  reminder is the safe action, and hiding it behind the same
                  drag as Delete would make the harmless thing as much work as
                  the destructive one.
                */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change this reminder"
                  hitSlop={10}
                  onPress={() => onEdit(reminder)}
                  style={({ pressed }) => ({
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: pressed ? colors.pale : "transparent",
                  })}
                >
                  <Ionicons name="pencil" size={17} color={colors.muted} />
                </Pressable>
              </Pressable>
            </SwipeRow>
          </View>
        );
      })}
    </View>
  );
}

/* "3 hr", "2 days" -- how long until a reminder lands. */
function untilLabel(due: number) {
  const minutes = Math.max(1, Math.round((due - Date.now()) / 60000));

  if (minutes < 60) return `${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/*
 * Changing a reminder after the fact.
 *
 * Whatever somebody typed at the time was written mid-conversation, in a
 * hurry, for a moment that has usually moved -- the delivery slipped, the
 * customer answered, the note reads as nonsense a day later. Editing it is
 * the same two fields it was set with; deleting it is the honest option when
 * the thing simply does not need doing.
 */
function ReminderEditor({
  reminder,
  onClose,
  onSave,
  onDelete,
}: {
  reminder: Reminder | null;
  onClose: () => void;
  onSave: (id: string, note: string, remindAt: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [at, setAt] = useState(new Date());
  const [picking, setPicking] = useState<"date" | "time" | null>(null);
  const [busy, setBusy] = useState(false);

  /* Loaded from whichever reminder was tapped, and reloaded if another is. */
  useEffect(() => {
    if (!reminder) return;

    setNote(reminder.note);
    setAt(new Date(reminder.remind_at));
    setPicking(null);
  }, [reminder?.id]);

  const ready = note.trim().length > 0 && at.getTime() > Date.now();

  async function save() {
    if (!reminder || !ready || busy) return;

    setBusy(true);

    try {
      if (await onSave(reminder.id, note.trim(), at.toISOString())) onClose();
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!reminder || busy) return;

    Alert.alert(
      "Delete this reminder?",
      "It disappears from everybody's list. Nothing about the conversation changes.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setBusy(true);

            void onDelete(reminder.id)
              .then((done) => {
                if (done) onClose();
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }

  return (
    <Dialog
      open={Boolean(reminder)}
      title="Edit reminder"
      detail={reminder?.contact?.full_name ?? ""}
      onClose={onClose}
    >
      <View style={{ padding: 18, gap: 14 }}>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What needs doing?"
          placeholderTextColor={colors.muted}
          multiline
          editable={!busy}
          style={[
            styles.input,
            { minHeight: 84, paddingTop: 12, textAlignVertical: "top" },
          ]}
        />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change the date"
            onPress={() => {
              Keyboard.dismiss();
              setPicking("date");
            }}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              paddingHorizontal: 12,
              paddingVertical: 11,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.pale : "white",
            })}
          >
            <Ionicons name="calendar-outline" size={15} color={colors.blue} />

            <Text
              numberOfLines={1}
              style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}
            >
              {at.toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change the time"
            onPress={() => {
              Keyboard.dismiss();
              setPicking("time");
            }}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              paddingHorizontal: 12,
              paddingVertical: 11,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.pale : "white",
            })}
          >
            <Ionicons name="time-outline" size={15} color={colors.blue} />

            <Text
              numberOfLines={1}
              style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}
            >
              {at.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </Text>
          </Pressable>
        </View>

        {picking ? (
          <DateTimePicker
            value={at}
            mode={picking}
            minimumDate={picking === "date" ? new Date() : undefined}
            onChange={(event, next) => {
              setPicking(null);

              if (event.type !== "set" || !next) return;

              const merged = new Date(at);

              if (picking === "date") {
                merged.setFullYear(
                  next.getFullYear(),
                  next.getMonth(),
                  next.getDate(),
                );
              } else {
                merged.setHours(next.getHours(), next.getMinutes(), 0, 0);
              }

              setAt(merged);
            }}
          />
        ) : null}

        {!ready && note.trim() ? (
          <Text style={{ fontSize: 12.5, color: colors.red }}>
            That time has already passed.
          </Text>
        ) : null}
      </View>

      <View
        style={{ flexDirection: "row", gap: 10, padding: 18, paddingTop: 0 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete this reminder"
          disabled={busy}
          onPress={remove}
          style={({ pressed }) => ({
            width: 48,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: pressed ? "#FBEAEA" : "white",
          })}
        >
          <Ionicons name="trash-outline" size={18} color={colors.red} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={busy || !ready}
          onPress={() => void save()}
          style={({ pressed }) => ({
            flex: 1,
            alignItems: "center",
            paddingVertical: 13,
            borderRadius: 12,
            opacity: ready ? 1 : 0.45,
            backgroundColor: pressed ? "#0A6FA8" : colors.blue,
          })}
        >
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ fontSize: 14.5, fontWeight: "800", color: "white" }}>
              Save changes
            </Text>
          )}
        </Pressable>
      </View>
    </Dialog>
  );
}

export default function Notifications() {
  const { session } = useAuth();
  const {
    workspace,
    workspaces,
    merged,
    selectWorkspace,
    alertsRevision,
    refreshAlerts,
  } = useInbox();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>("all");
  const [items, setItems] = useState<Notification[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [reminderBusy, setReminderBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    try {
      /*
       * Three sources, together. An announcement or a subscription warning
       * failing should not cost the alerts, so each is allowed to come back
       * empty rather than taking the screen down.
       */
      const [alerts, current, plan, pending] = await Promise.all([
        api<{ notifications: Notification[] }>(
          "/api/team-notifications",
          workspace.businessId,
        ),
        api<{ announcement: Announcement | null }>(
          "/api/system-announcements/current",
          workspace.businessId,
        ).catch(() => ({ announcement: null })),
        api<{ subscription: Subscription | null }>(
          "/api/subscription/current",
          workspace.businessId,
        ).catch(() => ({ subscription: null })),
        api<{ reminders: Reminder[] }>(
          "/api/reminders",
          workspace.businessId,
        ).catch(() => ({ reminders: [] })),
      ]);

      setItems(alerts.notifications ?? []);
      setAnnouncement(current.announcement ?? null);
      setSubscription(plan.subscription ?? null);
      setReminders(
        [...(pending.reminders ?? [])].sort(
          (first, second) =>
            new Date(first.remind_at).getTime() -
            new Date(second.remind_at).getTime(),
        ),
      );
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load notifications.",
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [workspace?.businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  /* Realtime and the 30-second fallback refresh in place. Replacing the
     whole screen with a loader on every alert update made a live screen look
     less live than a stale one. */
  const seenAlertsRevision = useRef(alertsRevision);
  useEffect(() => {
    if (seenAlertsRevision.current === alertsRevision) return;
    seenAlertsRevision.current = alertsRevision;
    void load(true);
  }, [alertsRevision, load]);

  /*
   * A mention and a reminder are errands, not records.
   *
   * Somebody said your name in a room, or something you promised to do has
   * come due: both are asking you to go somewhere, and once you have been the
   * asking is finished. Leaving them on the list afterwards means the list
   * only ever grows, and a screen you have to prune is a screen nobody reads.
   *
   * Everything else stays after it is read. A payment result or a Page that
   * has stopped authorising is a fact about the workspace, and somebody may
   * well want to look at it twice.
   */
  const visible = items.filter(
    (item) =>
      !item.is_read ||
      (item.notification_type !== MENTION &&
        item.notification_type !== REMINDER),
  );

  const unread = visible.filter((item) => !item.is_read).length;

  const mentions = visible.filter(
    (item) => item.notification_type === MENTION,
  );
  const alerts = visible.filter((item) => item.notification_type !== MENTION);

  /* A reminder whose time has come, against one still to come. */
  const overdue = reminders.filter(
    (one) => new Date(one.remind_at).getTime() <= Date.now(),
  ).length;

  const counts: Record<Tab, number> = {
    all: unread,
    alerts: alerts.filter((item) => !item.is_read).length,
    team: mentions.filter((item) => !item.is_read).length,
    remind: reminders.length,
  };

  const shown = tab === "team" ? mentions : tab === "alerts" ? alerts : visible;

  async function markRead(id: string) {
    if (!workspace) {
      return;
    }

    // Moved first so the row answers the tap; the reload puts it right.
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, is_read: true } : item,
      ),
    );

    await api("/api/team-notifications", workspace.businessId, {
      method: "PATCH",
      body: { action: "mark_read", notificationId: id },
    })
      .then(() => refreshAlerts())
      .catch(() => {
        // The next load restores the truth either way.
      });
  }

  async function markAllRead() {
    if (!workspace || busy) {
      return;
    }

    setBusy(true);
    setItems((current) => current.map((item) => ({ ...item, is_read: true })));

    try {
      await api("/api/team-notifications", workspace.businessId, {
        method: "PATCH",
        body: { action: "mark_all_read" },
      });
      await refreshAlerts();
    } catch (markError) {
      setError(
        markError instanceof Error
          ? markError.message
          : "Unable to mark those read.",
      );

      await load();
    } finally {
      setBusy(false);
    }
  }

  async function completeReminder(id: string) {
    if (!workspace || reminderBusy) return;

    const reminder = reminders.find((one) => one.id === id);

    setReminderBusy(id);

    /* Gone from the list on the tap: a reminder somebody has just dealt with
       should not sit there while a request goes out and comes back. */
    const previous = reminders;
    setReminders((current) => current.filter((one) => one.id !== id));

    try {
      await api(`/api/reminders/${encodeURIComponent(id)}`, workspace.businessId, {
        method: "PATCH",
        body: { action: "complete" },
      });

      /*
       * The alert it raised goes with it.
       *
       * A reminder that has come due writes a notification, and finishing the
       * reminder left that notification sitting unread -- a bell on the tab
       * for a job already done, which somebody then has to dismiss a second
       * time in a different list.
       */
      if (reminder) void clearReminderAlerts(reminder.conversation_id);
    } catch (completeError) {
      setReminders(previous);
      setError(
        completeError instanceof Error
          ? completeError.message
          : "Unable to close that reminder.",
      );
    } finally {
      setReminderBusy(null);
    }
  }

  /*
   * Deleting from the row asks first. The editor's own bin already does, and
   * a swipe is easier to make by accident than a button in a dialog.
   */
  function confirmDelete(reminder: Reminder) {
    Alert.alert(
      "Delete this reminder?",
      "It disappears from everybody's list. Nothing about the conversation changes.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void deleteReminder(reminder.id),
        },
      ],
    );
  }

  async function clearReminderAlerts(conversationId: string) {
    const stale = items.filter(
      (item) =>
        !item.is_read &&
        item.notification_type === REMINDER &&
        item.conversation_id === conversationId,
    );

    if (stale.length === 0) return;

    setItems((current) =>
      current.map((item) =>
        stale.some((one) => one.id === item.id)
          ? { ...item, is_read: true }
          : item,
      ),
    );

    await Promise.all(stale.map((item) => markRead(item.id))).catch(() => {
      // The next load restores the truth either way.
    });
  }

  async function saveReminder(id: string, note: string, remindAt: string) {
    if (!workspace) return false;

    try {
      await api(
        `/api/reminders/manage/${encodeURIComponent(id)}`,
        workspace.businessId,
        { method: "PATCH", body: { note, remindAt } },
      );

      setReminders((current) =>
        [...current]
          .map((one) =>
            one.id === id ? { ...one, note, remind_at: remindAt } : one,
          )
          .sort(
            (first, second) =>
              new Date(first.remind_at).getTime() -
              new Date(second.remind_at).getTime(),
          ),
      );

      return true;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to change that reminder.",
      );

      return false;
    }
  }

  async function deleteReminder(id: string) {
    if (!workspace) return false;

    const previous = reminders;
    setReminders((current) => current.filter((one) => one.id !== id));

    try {
      await api(`/api/reminders/${encodeURIComponent(id)}`, workspace.businessId, {
        method: "DELETE",
      });

      return true;
    } catch (deleteError) {
      setReminders(previous);
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete that reminder.",
      );

      return false;
    }
  }

  async function dismissAnnouncement() {
    if (!workspace || !announcement) {
      return;
    }

    const dismissed = announcement;
    setAnnouncement(null);

    await api("/api/system-announcements/current", workspace.businessId, {
      method: "POST",
      body: { action: "dismiss", announcementId: dismissed.id },
    })
      .then(() => refreshAlerts())
      .catch(() => {
        setAnnouncement(dismissed);
      });
  }

  /*
   * Alerts carry the web's own links -- /dashboard/inbox?conversation=…,
   * /dashboard/group-chat?room=…. The two that name something this app can
   * open are followed; the rest just mark themselves read, because sending
   * somebody to a browser to read a payment receipt is not an improvement.
   */
  async function open(item: Notification) {
    void markRead(item.id);

    const link = item.link ?? "";
    const conversation = /[?&]conversation=([0-9a-f-]{36})/i.exec(link);
    const room = /[?&]room=([0-9a-f-]{36})/i.exec(link);

    /*
     * The notification API is account-wide, just like the website's bell.
     * A room always needs its own workspace active; an Inbox conversation
     * only needs switching when it is outside the currently merged Inbox.
     */
    const needsWorkspace =
      Boolean(room && item.business_id !== workspace?.businessId) ||
      Boolean(conversation && !merged.includes(item.business_id));

    if (needsWorkspace) {
      const target = workspaces.find(
        (one) =>
          one.businessId === item.business_id &&
          one.subscriptionOperational,
      );

      if (!target) {
        setError(
          "This alert belongs to a workspace that is no longer available.",
        );
        await load();
        return;
      }

      try {
        await selectWorkspace(target);
      } catch {
        setError("Unable to open the workspace for this alert.");
        await load();
        return;
      }
    }

    if (conversation) {
      router.push({
        pathname: "/conversation/[id]",
        params: { id: conversation[1] },
      });
    } else if (room) {
      router.push({ pathname: "/room/[id]", params: { id: room[1] } });
    } else if (/^https?:\/\//i.test(link)) {
      void Linking.openURL(link);
    } else if (link.includes("subscription")) {
      router.push("/settings/profile");
    }
  }

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  /*
   * A subscription is only worth a card when it needs something: a trial
   * running down, a payment that has not gone through, or a term ending
   * inside a week. A healthy plan does not need announcing on this screen.
   */
  const endsIn = daysUntil(
    subscription?.status === "trialing"
      ? (subscription.trial_ends_at ?? subscription.current_period_end)
      : (subscription?.current_period_end ?? null),
  );

  const planWarning =
    subscription &&
    (subscription.status === "past_due" ||
      subscription.status === "canceled" ||
      subscription.status === "expired" ||
      (endsIn !== null && endsIn <= 7))
      ? {
          urgent:
            subscription.status !== "trialing" &&
            subscription.status !== "active",
          title:
            subscription.status === "trialing"
              ? endsIn !== null && endsIn <= 0
                ? "Your trial has ended"
                : `Trial ends in ${endsIn} day${endsIn === 1 ? "" : "s"}`
              : subscription.status === "active"
                ? endsIn !== null && endsIn <= 0
                  ? "Your plan has ended"
                  : `Plan renews in ${endsIn} day${endsIn === 1 ? "" : "s"}`
                : `Subscription ${subscription.status}`,
          body: "Renewing and changing a plan are on the web. TENH bills in advance, so access continues until the date on your plan.",
        }
      : null;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Notifications</Text>
            <Text style={styles.muted} numberOfLines={1}>
              {workspace?.businessName ?? "No workspace selected"}
            </Text>
          </View>

          {unread > 0 && tab !== "remind" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Mark all ${unread} as read`}
              disabled={busy}
              onPress={() => void markAllRead()}
              style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: pressed ? colors.border : colors.pale,
              })}
            >
              {busy ? (
                <ActivityIndicator color={colors.blue} />
              ) : (
                <Text
                  style={{ color: colors.blue, fontSize: 13, fontWeight: "700" }}
                >
                  Mark all read
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>

        {workspace ? (
          <View style={{ flexDirection: "row", gap: 6, marginTop: 12 }}>
            {TABS.map((one) => {
              const active = one.key === tab;
              const count = counts[one.key];

              return (
                <Pressable
                  key={one.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={
                    count > 0 ? `${one.label}, ${count}` : one.label
                  }
                  onPress={() => setTab(one.key)}
                  style={{
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    paddingVertical: 9,
                    borderRadius: 12,
                    backgroundColor: active ? colors.pale : colors.background,
                  }}
                >
                  <Ionicons
                    name={one.icon}
                    size={14}
                    color={active ? colors.blue : colors.muted}
                  />

                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 12,
                      fontWeight: "800",
                      color: active ? colors.blue : colors.muted,
                    }}
                  >
                    {one.label}
                  </Text>

                  {/*
                    The count is what is waiting, not what exists: unread for
                    the alert tabs, still-open for reminders. A number that
                    never goes down is furniture.
                  */}
                  {count > 0 ? (
                    <View
                      style={{
                        minWidth: 17,
                        paddingHorizontal: 4,
                        height: 17,
                        borderRadius: 9,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor:
                          one.key === "remind" && overdue > 0
                            ? "#C77700"
                            : colors.blue,
                      }}
                    >
                      <Text
                        style={{ color: "white", fontSize: 10, fontWeight: "800" }}
                      >
                        {count > 9 ? "9+" : count}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <ErrorNotice message={error} onRetry={() => void load()} />

      <ReminderEditor
        reminder={editing}
        onClose={() => setEditing(null)}
        onSave={saveReminder}
        onDelete={deleteReminder}
      />

      {!workspace ? (
        <Empty
          icon="briefcase-outline"
          title="Choose a workspace"
          detail="Open the Inbox tab and pick a workspace. Everything else is scoped to it."
        />
      ) : loading ? (
        <View style={{ padding: 40 }}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : (
        <ScrollView
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: 16, gap: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={colors.blue}
            />
          }
        >
          {announcement && tab === "all" ? (
            <Section title="From TENH">
              <View
                style={{
                  padding: 14,
                  gap: 8,
                  borderRadius: 16,
                  backgroundColor: "white",
                  borderWidth: 1,
                  borderColor: colors.blue,
                }}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Ionicons
                    name="sparkles-outline"
                    size={17}
                    color={colors.blue}
                  />

                  <Text style={[styles.heading, { flex: 1, fontSize: 16 }]}>
                    {announcement.title ?? "TENH update"}
                  </Text>
                </View>

                {announcement.message ? (
                  <Text
                    style={{ fontSize: 14, color: colors.ink, lineHeight: 20 }}
                  >
                    {announcement.message}
                  </Text>
                ) : null}

                <View style={{ flexDirection: "row", gap: 10, paddingTop: 4 }}>
                  {announcement.link_url ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        void Linking.openURL(announcement.link_url as string)
                      }
                      style={({ pressed }) => ({
                        paddingHorizontal: 14,
                        paddingVertical: 8,
                        borderRadius: 8,
                        backgroundColor: pressed ? "#0072AB" : colors.blue,
                      })}
                    >
                      <Text
                        style={{
                          color: "white",
                          fontSize: 13,
                          fontWeight: "700",
                        }}
                      >
                        {announcement.link_label ?? "Read more"}
                      </Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void dismissAnnouncement()}
                    style={{ paddingHorizontal: 12, paddingVertical: 8 }}
                  >
                    <Text
                      style={{
                        color: colors.muted,
                        fontSize: 13,
                        fontWeight: "700",
                      }}
                    >
                      Dismiss
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Section>
          ) : null}

          {planWarning && tab === "all" ? (
            <Section title="Subscription">
              <View
                style={{
                  padding: 14,
                  gap: 6,
                  borderRadius: 16,
                  backgroundColor: planWarning.urgent ? "#FFF1EF" : "white",
                  borderWidth: 1,
                  borderColor: planWarning.urgent ? colors.red : colors.border,
                }}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Ionicons
                    name={planWarning.urgent ? "alert-circle" : "card-outline"}
                    size={17}
                    color={planWarning.urgent ? colors.red : colors.muted}
                  />

                  <Text
                    style={{
                      flex: 1,
                      fontSize: 15,
                      fontWeight: "700",
                      color: planWarning.urgent ? colors.red : colors.ink,
                    }}
                  >
                    {planWarning.title}
                  </Text>
                </View>

                <Text style={[styles.muted, { fontSize: 13, lineHeight: 19 }]}>
                  {planWarning.body}
                </Text>
              </View>
            </Section>
          ) : null}

          {tab === "remind" ? (
            <Section
              title={
                reminders.length === 0
                  ? "Reminders"
                  : overdue > 0
                    ? `Reminders · ${overdue} due`
                    : `Reminders · ${reminders.length} pending`
              }
            >
              <Reminders
                reminders={reminders}
                busyId={reminderBusy}
                onOpen={(reminder) =>
                  router.push({
                    pathname: "/conversation/[id]",
                    params: { id: reminder.conversation_id },
                  })
                }
                onComplete={(id) => void completeReminder(id)}
                onDelete={confirmDelete}
                onEdit={setEditing}
              />
            </Section>
          ) : (
          <Section
            title={
              tab === "team"
                ? "Mentions"
                : counts[tab] > 0
                  ? `Alerts · ${counts[tab]} unread`
                  : "Alerts"
            }
          >
            {shown.length === 0 ? (
              <View
                style={{
                  padding: 28,
                  borderRadius: 16,
                  backgroundColor: "white",
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons
                  name="notifications-off-outline"
                  size={26}
                  color={colors.muted}
                />

                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
                  {tab === "team" ? "No mentions" : "Nothing waiting"}
                </Text>

                <Text style={[styles.muted, { fontSize: 13, textAlign: "center" }]}>
                  {tab === "team"
                    ? "When somebody writes your name in a team room, it lands here."
                    : "Payments, page warnings and anything TENH needs you to know appear here."}
                </Text>
              </View>
            ) : (
              <View
                style={{
                  borderRadius: 16,
                  backgroundColor: "white",
                  borderWidth: 1,
                  borderColor: colors.border,
                  overflow: "hidden",
                }}
              >
                {shown.map((item, index) => {
                  const visual = visualOf(item.notification_type);

                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title ?? "Notification"}${
                        item.is_read ? "" : ", unread"
                      }`}
                      onPress={() => open(item)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        gap: 12,
                        paddingHorizontal: 14,
                        paddingVertical: 13,
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderTopColor: colors.border,
                        backgroundColor: pressed
                          ? colors.border
                          : item.is_read
                            ? "white"
                            : colors.pale,
                      })}
                    >
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 11,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: `${visual.tone}1A`,
                        }}
                      >
                        <Ionicons
                          name={visual.icon}
                          size={17}
                          color={visual.tone}
                        />
                      </View>

                      <View style={{ flex: 1, gap: 2 }}>
                        <Text
                          numberOfLines={2}
                          style={{
                            fontSize: 14.5,
                            color: colors.ink,
                            fontWeight: item.is_read ? "600" : "800",
                          }}
                        >
                          {item.title ?? "Notification"}
                        </Text>

                        {item.body ? (
                          <Text
                            numberOfLines={2}
                            style={[styles.muted, { fontSize: 13 }]}
                          >
                            {item.body}
                          </Text>
                        ) : null}

                        <Text style={[styles.muted, { fontSize: 11.5 }]}>
                          {relativeTime(item.created_at)}
                        </Text>
                      </View>

                      {item.is_read ? null : (
                        <View
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 5,
                            marginTop: 6,
                            backgroundColor: colors.blue,
                          }}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </Section>
          )}
        </ScrollView>
      )}
    </View>
  );
}
