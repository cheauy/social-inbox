import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { TabScreen } from "../../components/screen";
import { IconName, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";

/*
 * The web Dashboard, on a phone.
 *
 * This tab used to show a different set of numbers to the one an owner sees
 * when they open TENH on a laptop -- the same endpoint, but its own choice of
 * fields and its own periods. Two screens claiming to be "analytics" and
 * disagreeing is worse than either, so this reads the four sources the
 * Dashboard reads and shows what it shows.
 *
 * Date filters and deeper channel/hour breakdowns use the same report routes
 * as the web Analytics workspace, so the phone and desktop agree.
 */

type ConversationSummary = {
  receivedConversations: number;
  resolvedConversations: number;
  resolutionRate: number | null;
  currentUnread: number;
  currentUnassigned: number;
  waitingOverSla: number;
  incomingMessages: number;
  outgoingMessages: number;
  totalMessages: number;
};

type AgentSummary = {
  attributedFirstResponses: number;
  avgFirstResponseSeconds: number;
  slaMet: number;
  slaMissed: number;
  slaRate: number | null;
};

type CustomerSummary = {
  newCustomers: number;
  returningCustomers: number;
};

type WorkloadMember = { overdueReminders: number };

type BusyHourRow = {
  hour: number;
  conversations: number;
};

type ChannelRow = {
  key: string;
  platform: string;
  sourceType: string;
  accountName: string;
  conversations: number;
  incomingMessages: number;
  outgoingReplies: number;
  avgFirstResponseSeconds: number | null;
  answered: number;
  unanswered: number;
  slaRate: number | null;
  unassigned: number;
};

type ChannelSummary = {
  conversations: number;
  incomingMessages: number;
  outgoingReplies: number;
  avgFirstResponseSeconds: number | null;
  answered: number;
  unanswered: number;
  slaRate: number | null;
};

type Overview = {
  conversations: ConversationSummary;
  agents: AgentSummary;
  customers: CustomerSummary;
  unassigned: number;
  overdueReminders: number;
  busyHours: BusyHourRow[];
  channels: ChannelRow[];
  channelSummary: ChannelSummary;
};

/*
 * The Dashboard's own default. It is a field on the web, and a control the
 * phone has no room for -- so it follows the same starting point rather than
 * inventing a different one.
 */
const SLA_MINUTES = 10;

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
] as const;

const EMPTY: Overview = {
  conversations: {
    receivedConversations: 0,
    resolvedConversations: 0,
    resolutionRate: null,
    currentUnread: 0,
    currentUnassigned: 0,
    waitingOverSla: 0,
    incomingMessages: 0,
    outgoingMessages: 0,
    totalMessages: 0,
  },
  agents: {
    attributedFirstResponses: 0,
    avgFirstResponseSeconds: 0,
    slaMet: 0,
    slaMissed: 0,
    slaRate: null,
  },
  customers: { newCustomers: 0, returningCustomers: 0 },
  unassigned: 0,
  overdueReminders: 0,
  busyHours: [],
  channels: [],
  channelSummary: {
    conversations: 0,
    incomingMessages: 0,
    outgoingReplies: 0,
    avgFirstResponseSeconds: null,
    answered: 0,
    unanswered: 0,
    slaRate: null,
  },
};

/** A number that needs somebody to do something about it. */
function Attention({
  icon,
  tone,
  label,
  value,
  helper,
}: {
  icon: IconName;
  tone: string;
  label: string;
  value: number;
  helper: string;
}) {
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: "47%",
        gap: 8,
        padding: 14,
        borderRadius: 16,
        backgroundColor: "white",
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${tone}1A`,
          }}
        >
          <Ionicons name={icon} size={15} color={tone} />
        </View>

        <Text style={{ flex: 1, fontSize: 12.5, color: colors.muted }}>
          {label}
        </Text>
      </View>

      <Text style={{ fontSize: 26, fontWeight: "800", color: colors.ink }}>
        {value}
      </Text>

      <Text style={{ fontSize: 12, color: colors.muted }}>{helper}</Text>
    </View>
  );
}

/** A number that describes the period rather than demanding anything. */
function Glance({
  icon,
  label,
  value,
  helper,
}: {
  icon: IconName;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 13,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 11,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.pale,
        }}
      >
        <Ionicons name={icon} size={17} color={colors.blue} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12.5, color: colors.muted }}>{label}</Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>{helper}</Text>
      </View>

      <Text style={{ fontSize: 19, fontWeight: "800", color: colors.ink }}>
        {value}
      </Text>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: "white",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </Text>
  );
}

function SkeletonBlock({
  height,
  width = "100%",
  radius = 10,
}: {
  height: number;
  width?: number | `${number}%`;
  radius?: number;
}) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: "#DDE7F2",
      }}
    />
  );
}

/* The loading shape matches the real sections, so the screen does not jump. */
function AnalyticsSkeleton() {
  const [pulse] = useState(() => new Animated.Value(0.45));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: 16, gap: 12 }}
    >
      <Animated.View style={{ gap: 12, opacity: pulse }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <SkeletonBlock width={18} height={18} radius={6} />
          <SkeletonBlock width={92} height={14} radius={7} />
        </View>

        <View style={{ flexDirection: "row", gap: 8, overflow: "hidden" }}>
          {[72, 88, 72, 78].map((width, index) => (
            <SkeletonBlock key={index} width={width} height={38} radius={12} />
          ))}
        </View>

        <SkeletonBlock width={108} height={11} radius={6} />

        <View style={{ flexDirection: "row", gap: 10 }}>
          <SkeletonBlock height={116} width="49%" radius={16} />
          <SkeletonBlock height={116} width="49%" radius={16} />
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <SkeletonBlock height={116} width="49%" radius={16} />
          <SkeletonBlock height={116} width="49%" radius={16} />
        </View>

        <SkeletonBlock width={82} height={11} radius={6} />
        <SkeletonBlock height={270} radius={16} />

        <SkeletonBlock width={142} height={11} radius={6} />

        <View style={{ flexDirection: "row", gap: 10 }}>
          <SkeletonBlock height={112} width="49%" radius={16} />
          <SkeletonBlock height={112} width="49%" radius={16} />
        </View>

        <SkeletonBlock height={210} radius={16} />

        <View
          style={{
            height: 250,
            padding: 16,
            borderRadius: 16,
            backgroundColor: "#EAF0F7",
          }}
        >
          <SkeletonBlock width={126} height={17} radius={8} />
          <SkeletonBlock width={176} height={11} radius={6} />

          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 6,
              paddingTop: 22,
            }}
          >
            {[28, 44, 62, 38, 78, 96, 58, 112, 84, 52, 70, 40].map(
              (height, index) => (
                <View
                  key={index}
                  style={{
                    flex: 1,
                    height,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                    backgroundColor: "#C9D8E8",
                  }}
                />
              ),
            )}
          </View>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

/*
 * The web's own rules, to the letter.
 *
 * Two of them were wrong here. A zero was printed as "0s", which is not a
 * response time -- nothing is answered in no time; it is what the average of
 * an empty set collapses to, and the web calls that no data. And an exact
 * three hours read "3h 0m" where the web says "3h", which is the same figure
 * wearing more digits.
 */
function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "—";

  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;

  const minutes = Math.floor(rounded / 60);
  if (minutes < 60) {
    const remainder = rounded % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatHour(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) return "12 AM";
  if (normalized === 12) return "12 PM";
  return normalized < 12 ? `${normalized} AM` : `${normalized - 12} PM`;
}

function BusyHoursChart({ rows }: { rows: BusyHourRow[] }) {
  const values = Array.from({ length: 24 }, (_, hour) => {
    const match = rows.find((row) => Number(row.hour) === hour);
    return match ? Math.max(0, Number(match.conversations) || 0) : 0;
  });
  const peakCount = Math.max(...values, 0);
  const peakHour = peakCount > 0 ? values.indexOf(peakCount) : null;

  return (
    <Card>
      <View style={{ padding: 16 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ fontSize: 17, fontWeight: "800", color: colors.ink }}>
              Busiest hours
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.muted }}>
              When customers first message
            </Text>
          </View>

          {peakHour !== null ? (
            <View
              style={{
                alignItems: "flex-end",
                paddingHorizontal: 11,
                paddingVertical: 7,
                borderRadius: 12,
                backgroundColor: colors.pale,
              }}
            >
              <Text style={{ fontSize: 11, color: colors.muted }}>Peak</Text>
              <Text style={{ fontSize: 14, fontWeight: "800", color: colors.blue }}>
                {formatHour(peakHour)}
              </Text>
            </View>
          ) : null}
        </View>

        {peakHour === null ? (
          <View
            style={{
              marginTop: 16,
              paddingVertical: 28,
              alignItems: "center",
              borderRadius: 14,
              backgroundColor: colors.background,
            }}
          >
            <Ionicons name="bar-chart-outline" size={26} color={colors.muted} />
            <Text style={{ marginTop: 8, fontSize: 13, color: colors.muted }}>
              No first-message activity in this period.
            </Text>
          </View>
        ) : (
          <>
            <View style={{ height: 148, marginTop: 18, position: "relative" }}>
              {[0, 1, 2].map((line) => (
                <View
                  key={line}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: line * 56,
                    height: 1,
                    backgroundColor: colors.border,
                  }}
                />
              ))}

              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 3,
                  paddingTop: 4,
                }}
              >
                {values.map((value, hour) => {
                  const peak = hour === peakHour;
                  const height =
                    value === 0
                      ? 3
                      : Math.max(8, Math.round((value / peakCount) * 132));

                  return (
                    <View
                      key={hour}
                      accessible
                      accessibilityLabel={`${formatHour(hour)}: ${value} first ${value === 1 ? "message" : "messages"}`}
                      style={{ flex: 1, height: 136, justifyContent: "flex-end" }}
                    >
                      <View
                        style={{
                          height,
                          minWidth: 4,
                          borderTopLeftRadius: 4,
                          borderTopRightRadius: 4,
                          backgroundColor: peak ? colors.blue : "#B8D1FF",
                        }}
                      />
                    </View>
                  );
                })}
              </View>
            </View>

            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 8,
              }}
            >
              {["12 AM", "6 AM", "12 PM", "6 PM", "12 AM"].map(
                (label, index) => (
                  <Text
                    key={`${label}-${index}`}
                    style={{ fontSize: 10.5, color: colors.muted }}
                  >
                    {label}
                  </Text>
                ),
              )}
            </View>

            <Text
              style={{
                marginTop: 14,
                fontSize: 13,
                lineHeight: 19,
                color: colors.ink,
              }}
            >
              <Text style={{ fontWeight: "800", color: colors.blue }}>
                {formatHour(peakHour)}
              </Text>{" "}
              is the peak with {peakCount} first {peakCount === 1 ? "message" : "messages"}.
            </Text>
          </>
        )}
      </View>
    </Card>
  );
}

/*
 * One row per Page, not one per channel.
 *
 * The endpoint keys its rows by account AND source type, so a Facebook Page
 * that takes both DMs and comments came back as two rows with the same name --
 * the same shop listed twice, its traffic split across two lines that had to
 * be added up by eye. Grouping by name puts the question and the answer on one
 * row: this Page got this many messages and this many comments.
 */
type PageRow = {
  name: string;
  platform: string;
  messages: number;
  comments: number;
  chats: number;
  waiting: number;
  firstReplySeconds: number | null;
  answered: number;
};

function byPage(channels: ChannelRow[]): PageRow[] {
  const pages = new Map<string, PageRow & { weighted: number }>();

  for (const channel of channels) {
    const name = channel.accountName || "Unnamed";
    const page = pages.get(name) ?? {
      name,
      platform: channel.platform,
      messages: 0,
      comments: 0,
      chats: 0,
      waiting: 0,
      firstReplySeconds: null,
      answered: 0,
      weighted: 0,
    };

    if (channel.sourceType === "comment") {
      page.comments += channel.incomingMessages;
    } else {
      page.messages += channel.incomingMessages;
      /* A Page's platform is whatever its DMs arrive on. */
      page.platform = channel.platform;
    }

    page.chats += channel.conversations;
    page.waiting += channel.unanswered;

    /*
     * Weighted by how many conversations each row actually answered, so a
     * comment row with two replies cannot drag a Page's average as hard as a
     * DM row with two hundred.
     */
    if (channel.avgFirstResponseSeconds !== null && channel.answered > 0) {
      page.weighted += channel.avgFirstResponseSeconds * channel.answered;
      page.answered += channel.answered;
    }

    pages.set(name, page);
  }

  return [...pages.values()]
    .map(({ weighted, ...page }) => ({
      ...page,
      firstReplySeconds: page.answered > 0 ? weighted / page.answered : null,
    }))
    .sort((a, b) => b.messages + b.comments - (a.messages + a.comments));
}

function pageAppearance(platform: string): {
  label: string;
  icon: IconName;
  tone: string;
} {
  if (platform === "telegram") {
    return { label: "Telegram", icon: "paper-plane", tone: "#0D9488" };
  }

  if (platform === "facebook") {
    return { label: "Facebook Page", icon: "logo-facebook", tone: "#2563EB" };
  }

  return { label: platform || "Other", icon: "globe-outline", tone: colors.muted };
}

function Tally({
  icon,
  tone,
  value,
  label,
}: {
  icon: IconName;
  tone: string;
  value: number;
  label: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        gap: 3,
        paddingHorizontal: 10,
        paddingVertical: 9,
        borderRadius: 12,
        backgroundColor: colors.background,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Ionicons name={icon} size={12} color={tone} />
        <Text style={{ fontSize: 10.5, color: colors.muted }}>{label}</Text>
      </View>

      <Text style={{ fontSize: 17, fontWeight: "800", color: colors.ink }}>
        {value}
      </Text>
    </View>
  );
}

function ChannelPerformance({
  channels,
  periodLabel,
}: {
  channels: ChannelRow[];
  periodLabel: string;
}) {
  const pages = byPage(channels);
  const top = pages[0] ?? null;

  const totalTraffic = Math.max(
    1,
    pages.reduce((sum, page) => sum + page.messages + page.comments, 0),
  );

  return (
    <View style={{ gap: 10 }}>
      {!top ? (
        <Card>
          <View style={{ alignItems: "center", padding: 28 }}>
            <Ionicons name="git-network-outline" size={27} color={colors.muted} />
            <Text style={{ marginTop: 8, fontSize: 13, color: colors.muted }}>
              No page activity in this period.
            </Text>
          </View>
        </Card>
      ) : (
        <View
          style={{
            padding: 16,
            gap: 14,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: "#B8D1FF",
            backgroundColor: "#EDF4FF",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "white",
              }}
            >
              <Ionicons name="trophy" size={21} color="#D79400" />
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={{ fontSize: 11.5, fontWeight: "700", color: colors.blue }}
              >
                {periodLabel === "Today"
                  ? "Busiest page today"
                  : `Busiest page · ${periodLabel}`}
              </Text>

              <Text
                numberOfLines={1}
                style={{ fontSize: 17, fontWeight: "800", color: colors.ink }}
              >
                {top.name}
              </Text>

              <Text style={{ fontSize: 11.5, color: colors.muted }}>
                {pageAppearance(top.platform).label}
              </Text>
            </View>

            <View style={{ alignItems: "flex-end" }}>
              <Text
                style={{ fontSize: 26, fontWeight: "800", color: colors.blue }}
              >
                {top.messages + top.comments}
              </Text>
              <Text style={{ fontSize: 10.5, color: colors.muted }}>
                received
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Tally
              icon="mail"
              tone="#2563EB"
              value={top.messages}
              label="Messages"
            />
            <Tally
              icon="chatbubble-ellipses"
              tone="#EB6834"
              value={top.comments}
              label="Comments"
            />
            <View
              style={{
                flex: 1,
                gap: 3,
                paddingHorizontal: 10,
                paddingVertical: 9,
                borderRadius: 12,
                backgroundColor: colors.background,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                <Ionicons name="timer-outline" size={12} color={colors.muted} />
                <Text style={{ fontSize: 10.5, color: colors.muted }}>
                  First reply
                </Text>
              </View>

              <Text
                style={{ fontSize: 17, fontWeight: "800", color: colors.ink }}
              >
                {formatDuration(top.firstReplySeconds)}
              </Text>
            </View>
          </View>
        </View>
      )}

      {pages.length > 0 ? (
        <Card>
          {pages.map((page, index) => {
            const appearance = pageAppearance(page.platform);
            const traffic = page.messages + page.comments;
            const share = Math.round((traffic / totalTraffic) * 100);

            return (
              <View key={page.name}>
                {index > 0 ? (
                  <View style={{ height: 1, backgroundColor: colors.border }} />
                ) : null}

                <View style={{ padding: 14, gap: 10 }}>
                  <View
                    style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 13,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: `${appearance.tone}18`,
                      }}
                    >
                      <Ionicons
                        name={appearance.icon}
                        size={18}
                        color={appearance.tone}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 14.5,
                          fontWeight: "800",
                          color: colors.ink,
                        }}
                      >
                        {page.name}
                      </Text>
                      <Text style={{ fontSize: 11.5, color: colors.muted }}>
                        {appearance.label} · {share}% of everything received
                      </Text>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text
                        style={{ fontSize: 18, fontWeight: "800", color: colors.ink }}
                      >
                        {traffic}
                      </Text>
                      <Text style={{ fontSize: 10.5, color: colors.muted }}>
                        received
                      </Text>
                    </View>
                  </View>

                  {/*
                    The split that matters: how much of this Page's traffic was
                    somebody writing in, and how much was somebody commenting
                    under a post. They are answered by different people in most
                    shops, and they were being added together.
                  */}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Tally
                      icon="mail"
                      tone="#2563EB"
                      value={page.messages}
                      label="Messages"
                    />
                    <Tally
                      icon="chatbubble-ellipses"
                      tone="#EB6834"
                      value={page.comments}
                      label="Comments"
                    />
                    <Tally
                      icon="chatbubbles-outline"
                      tone={colors.muted}
                      value={page.chats}
                      label="Conversations"
                    />
                  </View>

                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <Text style={{ fontSize: 11.5, color: colors.muted }}>
                      First reply {formatDuration(page.firstReplySeconds)}
                    </Text>

                    <Text
                      style={{
                        fontSize: 11.5,
                        color: page.waiting > 0 ? colors.red : "#26875C",
                      }}
                    >
                      {page.waiting > 0
                        ? `${page.waiting} waiting`
                        : "All answered"}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}
    </View>
  );
}

export default function Analytics() {
  const { workspace } = useInbox();

  const [period, setPeriod] =
    useState<(typeof PERIODS)[number]["key"]>("today");
  const [data, setData] = useState<Overview>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /*
   * The server buckets by local day, and without an offset it would use UTC
   * -- which in Cambodia moves everything before 07:00 into the previous day.
   * The same value the web sends.
   */
  const offset = -new Date().getTimezoneOffset();

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    const query = `period=${period}&tzOffsetMinutes=${offset}`;

    try {
      /*
       * These are the same analytics sources used by the web. Channel
       * performance has its own endpoint because it includes response and SLA
       * figures for every connected account, not only a channel total.
       */
      const [conversations, agents, customers, workload, channelReport] =
        await Promise.all([
          api<{
            analytics?: {
              summary?: Partial<ConversationSummary>;
              busyHours?: BusyHourRow[];
            };
          }>(
            `/api/analytics/conversations?${query}&slaMinutes=${SLA_MINUTES}`,
            workspace.businessId,
          ),
          api<{ analytics?: { summary?: Partial<AgentSummary> } }>(
            `/api/analytics/agents?${query}&slaMinutes=${SLA_MINUTES}`,
            workspace.businessId,
          ),
          api<{ analytics?: { summary?: Partial<CustomerSummary> } }>(
            `/api/analytics/customers?${query}`,
            workspace.businessId,
          ),
          api<{ members?: WorkloadMember[] }>(
            "/api/team/workload",
            workspace.businessId,
          ),
          api<{
            summary?: Partial<ChannelSummary>;
            channels?: ChannelRow[];
          }>(
            `/api/analytics/channels?${query}&slaMinutes=${SLA_MINUTES}`,
            workspace.businessId,
          ),
        ]);

      const channelRows = channelReport.channels ?? [];

      setData({
        conversations: {
          ...EMPTY.conversations,
          ...(conversations.analytics?.summary ?? {}),
        },
        agents: { ...EMPTY.agents, ...(agents.analytics?.summary ?? {}) },
        customers: {
          ...EMPTY.customers,
          ...(customers.analytics?.summary ?? {}),
        },
        /*
         * Each channel row contains only conversations created in the chosen
         * period. Summing those rows makes this card obey the date filter;
         * team/workload is an all-time current queue and caused the old count
         * to stay unchanged when Today switched to 7 or 30 days.
         */
        unassigned: channelRows.reduce(
          (total, channel) => total + Math.max(0, channel.unassigned || 0),
          0,
        ),
        overdueReminders: (workload.members ?? []).reduce(
          (total, member) => total + (member.overdueReminders ?? 0),
          0,
        ),
        busyHours: conversations.analytics?.busyHours ?? [],
        channels: channelRows,
        channelSummary: {
          ...EMPTY.channelSummary,
          ...(channelReport.summary ?? {}),
        },
      });

      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load the dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspace?.businessId, period, offset]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const { conversations, agents, customers } = data;
  const periodLabel =
    PERIODS.find((option) => option.key === period)?.label ?? "Today";
  const unassignedHelper =
    period === "today"
      ? "Created today"
      : period === "yesterday"
        ? "Created yesterday"
        : `Created in ${periodLabel.toLowerCase()}`;

  return (
    <TabScreen
      /*
       * Named for the tab it lives under, not for the web page it mirrors --
       * a screen titled "Dashboard" beneath a tab labelled "Analytics" makes
       * somebody wonder which one they are looking at.
       */
      title="Analytics"
      loading={loading}
      loadingFallback={<AnalyticsSkeleton />}
      error={error}
      onRefresh={load}
    >
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="calendar-outline" size={16} color={colors.blue} />
          <Text style={{ flex: 1, fontSize: 13, fontWeight: "700", color: colors.ink }}>
            Date range
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{periodLabel}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {PERIODS.map((option) => {
            const active = option.key === period;

            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setPeriod(option.key)}
                style={{
                  minHeight: 38,
                  justifyContent: "center",
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: active ? colors.blue : "white",
                  borderWidth: 1,
                  borderColor: active ? colors.blue : colors.border,
                }}
              >
                <Text
                  style={{
                    color: active ? "white" : colors.muted,
                    fontWeight: "700",
                    fontSize: 13,
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <Heading>Needs attention</Heading>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Attention
          icon="person-remove-outline"
          tone="#C77700"
          label="Unassigned"
          value={data.unassigned}
          helper={unassignedHelper}
        />

        <Attention
          icon="time-outline"
          tone={colors.red}
          label="Waiting > SLA"
          value={conversations.waitingOverSla}
          helper={`Over ${SLA_MINUTES} min`}
        />

        <Attention
          icon="mail-unread-outline"
          tone="#6D4AFF"
          label="Unread"
          value={conversations.currentUnread}
          helper="New messages"
        />

        <Attention
          icon="alarm-outline"
          tone={colors.red}
          label="Overdue"
          value={data.overdueReminders}
          helper="Past due follow-ups"
        />
      </View>

      <Heading>At a glance</Heading>

      <Card>
        <Glance
          icon="chatbubbles-outline"
          label="Conversations"
          value={String(conversations.receivedConversations)}
          helper={`${conversations.resolvedConversations} resolved`}
        />

        <View style={{ height: 1, backgroundColor: colors.border }} />

        {/*
          The total, and not the incoming/outgoing split it used to carry.
          Which direction a message went is a fact about the transport; what
          anybody standing at this screen wants is how much came through and
          which Page it came through.
        */}
        <Glance
          icon="mail-outline"
          label="Messages"
          value={String(conversations.totalMessages)}
          helper={`across ${conversations.receivedConversations} conversations`}
        />

        <View style={{ height: 1, backgroundColor: colors.border }} />

        <Glance
          icon="arrow-undo-outline"
          label="First responses"
          value={
            agents.attributedFirstResponses > 0
              ? String(agents.attributedFirstResponses)
              : "—"
          }
          helper={
            agents.attributedFirstResponses > 0
              ? `${formatDuration(agents.avgFirstResponseSeconds)} · Target ${SLA_MINUTES}m`
              : "No data yet"
          }
        />

        <View style={{ height: 1, backgroundColor: colors.border }} />

        <Glance
          icon="checkmark-circle-outline"
          label="SLA met"
          value={agents.slaRate === null ? "—" : `${agents.slaRate}%`}
          helper={
            agents.slaRate === null
              ? "No data yet"
              : `${agents.slaMet} met · ${agents.slaMissed} missed`
          }
        />

        <View style={{ height: 1, backgroundColor: colors.border }} />

        <Glance
          icon="people-outline"
          label="New customers"
          value={String(customers.newCustomers)}
          helper={`${customers.returningCustomers} returning`}
        />
      </Card>

      <Heading>Channel performance</Heading>

      <ChannelPerformance
        channels={data.channels}
        periodLabel={periodLabel}
      />

      <BusyHoursChart rows={data.busyHours} />

      <Text
        style={[styles.muted, { fontSize: 12, paddingHorizontal: 2, lineHeight: 18 }]}
      >
        Channel and busiest-hour figures follow the selected date range. The
        hourly chart uses the local hour when each conversation first received
        a customer message. Unassigned also follows the selected range; unread,
        SLA and overdue counters describe the Inbox right now.
      </Text>
    </TabScreen>
  );
}
