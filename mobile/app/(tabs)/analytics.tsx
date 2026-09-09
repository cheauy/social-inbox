import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

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
 * Today and Yesterday, because that is the range the Dashboard offers. The
 * longer views live in the web's own analytics pages, which this is not.
 */

type ConversationSummary = {
  receivedConversations: number;
  resolvedConversations: number;
  currentUnread: number;
  currentUnassigned: number;
  waitingOverSla: number;
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

type Overview = {
  conversations: ConversationSummary;
  agents: AgentSummary;
  customers: CustomerSummary;
  unassigned: number;
  overdueReminders: number;
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
] as const;

const EMPTY: Overview = {
  conversations: {
    receivedConversations: 0,
    resolvedConversations: 0,
    currentUnread: 0,
    currentUnassigned: 0,
    waitingOverSla: 0,
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
       * Four requests, in parallel, exactly as the Dashboard makes them. One
       * failing takes the whole view down rather than leaving three quarters
       * of a picture that reads as a real one.
       */
      const [conversations, agents, customers, workload] = await Promise.all([
        api<{ analytics?: { summary?: Partial<ConversationSummary> } }>(
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
        api<{ unassignedCount?: number; members?: WorkloadMember[] }>(
          "/api/team/workload",
          workspace.businessId,
        ),
      ]);

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
        unassigned: Math.max(0, workload.unassignedCount ?? 0),
        overdueReminders: (workload.members ?? []).reduce(
          (total, member) => total + (member.overdueReminders ?? 0),
          0,
        ),
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

  const responseTime = `${Math.max(
    0,
    Math.round(agents.avgFirstResponseSeconds / 60),
  )}m ${Math.max(0, Math.round(agents.avgFirstResponseSeconds % 60))}s`;

  return (
    <TabScreen
      /*
       * Named for the tab it lives under, not for the web page it mirrors --
       * a screen titled "Dashboard" beneath a tab labelled "Analytics" makes
       * somebody wonder which one they are looking at.
       */
      title="Analytics"
      loading={loading}
      error={error}
      onRefresh={load}
    >
      <View style={{ flexDirection: "row", gap: 8 }}>
        {PERIODS.map((option) => {
          const active = option.key === period;

          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setPeriod(option.key)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 999,
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

        {loading ? (
          <View style={{ justifyContent: "center", paddingLeft: 4 }}>
            <ActivityIndicator color={colors.blue} />
          </View>
        ) : null}
      </View>

      <Heading>Needs attention</Heading>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Attention
          icon="person-remove-outline"
          tone="#C77700"
          label="Unassigned"
          value={data.unassigned}
          helper="Needs owner"
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
              ? `${responseTime} · Target ${SLA_MINUTES}m`
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

      <Text
        style={[styles.muted, { fontSize: 12, paddingHorizontal: 2, lineHeight: 18 }]}
      >
        The same figures as the web Dashboard, for the same period. Note that
        Unassigned counts only open and pending conversations here, which is
        the Dashboard's rule -- the Inbox's Unassigned view counts them at any
        status, so the two differ on purpose. Channel, agent and customer
        breakdowns are on the web.
      </Text>
    </TabScreen>
  );
}
