import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Empty,
  ErrorNotice,
  IconName,
  colors,
  relativeTime,
  styles,
} from "../../components/ui";
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
  notification_type: string;
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

export default function Notifications() {
  const { session } = useAuth();
  const { workspace } = useInbox();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<Notification[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
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
      const [alerts, current, plan] = await Promise.all([
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
      ]);

      setItems(alerts.notifications ?? []);
      setAnnouncement(current.announcement ?? null);
      setSubscription(plan.subscription ?? null);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load notifications.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspace?.businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const unread = items.filter((item) => !item.is_read).length;

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
    }).catch(() => {
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

  async function dismissAnnouncement() {
    if (!workspace || !announcement) {
      return;
    }

    const dismissed = announcement;
    setAnnouncement(null);

    await api("/api/system-announcements/current", workspace.businessId, {
      method: "POST",
      body: { action: "dismiss", announcementId: dismissed.id },
    }).catch(() => {
      setAnnouncement(dismissed);
    });
  }

  /*
   * Alerts carry the web's own links -- /dashboard/inbox?conversation=…,
   * /dashboard/group-chat?room=…. The two that name something this app can
   * open are followed; the rest just mark themselves read, because sending
   * somebody to a browser to read a payment receipt is not an improvement.
   */
  function open(item: Notification) {
    void markRead(item.id);

    const link = item.link ?? "";
    const conversation = /[?&]conversation=([0-9a-f-]{36})/i.exec(link);
    const room = /[?&]room=([0-9a-f-]{36})/i.exec(link);

    if (conversation) {
      router.push({
        pathname: "/conversation/[id]",
        params: { id: conversation[1] },
      });
    } else if (room) {
      router.push({ pathname: "/room/[id]", params: { id: room[1] } });
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

          {unread > 0 ? (
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
      </View>

      <ErrorNotice message={error} onRetry={() => void load()} />

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
          {announcement ? (
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

          {planWarning ? (
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

          <Section title={unread > 0 ? `Alerts · ${unread} unread` : "Alerts"}>
            {items.length === 0 ? (
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
                  Nothing waiting
                </Text>

                <Text style={[styles.muted, { fontSize: 13, textAlign: "center" }]}>
                  Mentions, reminders and anything TENH needs you to know appear
                  here.
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
                {items.map((item, index) => {
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
        </ScrollView>
      )}
    </View>
  );
}
