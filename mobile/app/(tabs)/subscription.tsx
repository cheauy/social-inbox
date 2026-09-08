import { Text, View } from "react-native";

import { Stat, TabScreen, useWorkspaceResource } from "../../components/screen";
import { Empty, colors, styles } from "../../components/ui";

type Subscription = {
  status: string;
  plan_code: string | null;
  billing_cycle: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  member_limit: number | null;
  channel_limit: number | null;
};

type Response = {
  subscription: Subscription | null;
  usage: { members: number; channels: number };
};

const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

/** Limits can be null on legacy workspaces, which means no limit rather than zero. */
const usageOf = (used: number, limit: number | null) =>
  limit === null ? `${used}` : `${used} of ${limit}`;

export default function SubscriptionTab() {
  const { data, loading, error, reload } = useWorkspaceResource<Response>(
    "/api/subscription/current",
  );

  const subscription = data?.subscription ?? null;
  const usage = data?.usage;

  const live =
    subscription?.status === "active" ||
    subscription?.status === "trialing";

  const ends =
    subscription?.status === "trialing"
      ? (subscription.trial_ends_at ?? subscription.current_period_end)
      : (subscription?.current_period_end ?? null);

  return (
    <TabScreen
      title="Subscription"
      loading={loading}
      error={error}
      onRefresh={reload}
    >
      {!subscription ? (
        <Empty
          icon="card-outline"
          title="No subscription on this workspace"
          detail="This workspace is not on a managed plan. Open TENH on the web to buy one."
        />
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heading}>
                  {subscription.plan_code
                    ? subscription.plan_code.replace(/^./, (c) =>
                        c.toUpperCase(),
                      )
                    : "Plan"}
                </Text>

                <Text style={styles.muted}>
                  {subscription.billing_cycle ?? "—"}
                </Text>
              </View>

              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: live ? "#E7F6EE" : "#FFF1EF",
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "800",
                    textTransform: "uppercase",
                    color: live ? "#2FA36B" : colors.red,
                  }}
                >
                  {subscription.status}
                </Text>
              </View>
            </View>

            <Stat
              label={
                subscription.status === "trialing"
                  ? "Trial ends"
                  : "Period ends"
              }
              value={date(ends)}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>Usage</Text>

            <Stat
              label="Channels"
              value={usageOf(usage?.channels ?? 0, subscription.channel_limit)}
            />
            <Stat
              label="Team members"
              value={usageOf(usage?.members ?? 0, subscription.member_limit)}
            />
          </View>

          <Text style={[styles.muted, { fontSize: 12, paddingHorizontal: 2 }]}>
            Buying, renewing and changing a plan are on the web. TENH bills in
            advance, so access continues until the date above.
          </Text>
        </>
      )}
    </TabScreen>
  );
}
