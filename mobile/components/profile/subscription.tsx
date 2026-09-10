import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Stat, useWorkspaceResource } from "../screen";
import { SettingsGroup } from "../settings-screen";
import { SlidePanel } from "../slide-panel";
import { Empty, colors, styles } from "../ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";

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

/*
 * A workspace as /api/workspaces describes it, which is the only place that
 * answers for workspaces other than the one you are in.
 */
type WorkspaceRow = {
  businessId: string;
  businessName: string;
  ownerName: string;
  role: string;
  usage: { members: number; channels: number };
  subscription: Subscription | null;
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

export function SubscriptionPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, loading, error, reload } = useWorkspaceResource<Response>(
    "/api/subscription/current",
  );

  const { workspace, settingsRevision } = useInbox();

  /*
   * The plan you are on, when this workspace is not the one paying for it.
   *
   * /api/subscription/current answers for the workspace you are in and
   * nothing else, so an agent invited onto somebody's plan saw "no
   * subscription" and no way to find out whose plan they were working under
   * or when it runs out. The workspace list carries every membership with its
   * subscription attached, which is exactly that question answered.
   */
  const [joined, setJoined] = useState<WorkspaceRow | null>(null);

  const findJoined = useCallback(async () => {
    if (!workspace) return;

    try {
      const rows = await api<{ workspaces: WorkspaceRow[] }>(
        "/api/workspaces",
        workspace.businessId,
      );

      const others = (rows.workspaces ?? []).filter(
        (row) =>
          row.subscription !== null &&
          row.businessId !== workspace.businessId,
      );

      /*
       * A live plan first. Somebody on four workspaces is usually working
       * under one that is paid and three that lapsed years ago, and showing
       * the lapsed one would answer the question wrongly while looking
       * perfectly confident about it.
       */
      setJoined(
        others.find(
          (row) =>
            row.subscription?.status === "active" ||
            row.subscription?.status === "trialing",
        ) ??
          others[0] ??
          null,
      );
    } catch {
      /* The panel already says there is no plan here; that stays true. */
    }
  }, [workspace?.businessId, settingsRevision]);

  useEffect(() => {
    void findJoined();
  }, [findJoined]);

  const own = data?.subscription ?? null;

  /* This workspace's own plan first; the one you joined only if it has none. */
  const subscription = own ?? joined?.subscription ?? null;
  const usage = own ? data?.usage : joined?.usage;

  const live =
    subscription?.status === "active" ||
    subscription?.status === "trialing";

  const ends =
    subscription?.status === "trialing"
      ? (subscription.trial_ends_at ?? subscription.current_period_end)
      : (subscription?.current_period_end ?? null);

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title="Subscription"
      detail={
        own
          ? "The plan this workspace is on"
          : joined
            ? "The plan you joined"
            : "No plan on this workspace"
      }
      loading={loading}
      error={error}
      onRetry={reload}
      skeleton={[3, 2]}
    >
      {!subscription ? (
        <Empty
          icon="card-outline"
          title="No subscription yet"
          detail="Neither this workspace nor any you have joined is on a managed plan. Open TENH on the web to buy one."
        />
      ) : (
        <>
          {!own && joined ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                padding: 13,
                borderRadius: 14,
                backgroundColor: colors.pale,
              }}
            >
              <Ionicons
                name="people-outline"
                size={18}
                color={colors.blue}
              />

              <Text
                style={[styles.muted, { flex: 1, fontSize: 12.5, lineHeight: 18 }]}
              >
                {`${workspace?.businessName ?? "This workspace"} has no plan of its own. You are on ${joined.businessName}'s, as ${joined.role}.`}
              </Text>
            </View>
          ) : null}

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
    </SlidePanel>
  );
}
