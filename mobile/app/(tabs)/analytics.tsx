import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Stat, TabScreen, useWorkspaceResource } from "../../components/screen";
import { Empty, colors, styles } from "../../components/ui";

type Summary = {
  receivedConversations: number;
  resolvedConversations: number;
  resolutionRate: number | null;
  currentOpen: number;
  currentPending: number;
  currentResolved: number;
  currentClosed: number;
  currentSpam: number;
  currentUnread: number;
  currentUnassigned: number;
};

type Response = {
  periodLabel: string;
  analytics: { summary: Summary } | null;
};

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
] as const;

export default function Analytics() {
  const [period, setPeriod] =
    useState<(typeof PERIODS)[number]["key"]>("7d");

  /*
   * The server buckets by local day, and without an offset it would use UTC
   * -- which in Cambodia moves everything before 07:00 into the previous day.
   * The same value the web sends.
   */
  const offset = -new Date().getTimezoneOffset();

  const { data, loading, error, reload } = useWorkspaceResource<Response>(
    `/api/analytics/conversations?period=${period}&tzOffsetMinutes=${offset}`,
  );

  const summary = data?.analytics?.summary ?? null;

  return (
    <TabScreen
      title="Analytics"
      loading={loading}
      error={error}
      onRefresh={reload}
    >
      <View style={{ flexDirection: "row", gap: 8 }}>
        {PERIODS.map((option) => {
          const active = option.key === period;

          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
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
      </View>

      {!summary ? (
        <Empty
          icon="stats-chart-outline"
          title="No analytics yet"
          detail="Once this workspace has conversations in the selected period, the numbers appear here."
        />
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.heading}>
              {data?.periodLabel ?? "This period"}
            </Text>

            <Stat
              label="Conversations received"
              value={summary.receivedConversations}
              tone="strong"
            />
            <Stat
              label="Resolved"
              value={summary.resolvedConversations}
            />
            <Stat
              label="Resolution rate"
              value={
                summary.resolutionRate === null
                  ? "—"
                  : `${Math.round(summary.resolutionRate * 100)}%`
              }
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>Right now</Text>

            <Stat label="Open" value={summary.currentOpen} />
            <Stat label="Pending" value={summary.currentPending} />
            <Stat label="Resolved" value={summary.currentResolved} />
            <Stat label="Closed" value={summary.currentClosed} />
            <Stat label="Spam" value={summary.currentSpam} tone="muted" />
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>Needs attention</Text>

            <Stat label="Unread" value={summary.currentUnread} tone="strong" />
            <Stat label="Unassigned" value={summary.currentUnassigned} />
          </View>
        </>
      )}
    </TabScreen>
  );
}
