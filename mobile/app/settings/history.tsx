import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { Avatar, IconName, colors, relativeTime, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";

/*
 * Who changed what, and when.
 *
 * The same activity feed the web's Change history shows, paged the same way.
 * It is the screen somebody opens when a conversation is not where they left
 * it, so it is worth having on the phone they are holding at the time.
 */

type Activity = {
  id: string;
  activity_type: string;
  title: string | null;
  description: string | null;
  customer_name: string | null;
  actor_name: string | null;
  actor_profile_picture_url: string | null;
  created_at: string | null;
};

const PAGE_SIZE = 25;

/* The web tints these by kind; the phone uses the same idea with icons. */
const ICONS: Record<string, IconName> = {
  status_changed: "swap-horizontal-outline",
  assignment_changed: "person-outline",
  tag_added: "pricetag-outline",
  tag_removed: "pricetag-outline",
  customer_updated: "create-outline",
  conversation_pinned: "pin-outline",
  note_added: "document-text-outline",
};

export default function History() {
  const { workspace } = useInbox();

  const [items, setItems] = useState<Activity[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (nextPage: number) => {
      if (!workspace) {
        setLoading(false);
        return;
      }

      try {
        const data = await api<{
          activities: Activity[];
          pagination: { total: number };
        }>(
          `/api/settings/history?page=${nextPage}&pageSize=${PAGE_SIZE}`,
          workspace.businessId,
        );

        setItems((current) =>
          nextPage === 1
            ? (data.activities ?? [])
            : [...current, ...(data.activities ?? [])],
        );

        setTotal(data.pagination?.total ?? 0);
        setPage(nextPage);
        setError("");
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load the change history.",
        );
      } finally {
        setLoading(false);
        setMore(false);
      }
    },
    [workspace?.businessId],
  );

  useEffect(() => {
    setLoading(true);
    void load(1);
  }, [load]);

  return (
    <SettingsScreen
      title="Change history"
      detail={total > 0 ? `${total} changes recorded` : "Who changed what"}
      loading={loading}
      error={error}
      onRetry={() => void load(1)}
    >
      {items.length === 0 ? (
        <SettingsGroup>
          <View style={{ padding: 28, alignItems: "center", gap: 6 }}>
            <Ionicons name="time-outline" size={26} color={colors.muted} />

            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
              Nothing recorded yet
            </Text>

            <Text style={[styles.muted, { fontSize: 13, textAlign: "center" }]}>
              Status changes, assignments and tag edits appear here as your team
              makes them.
            </Text>
          </View>
        </SettingsGroup>
      ) : (
        <SettingsGroup>
          {items.map((item, index) => (
            <View
              key={item.id}
              style={{
                flexDirection: "row",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 13,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
              }}
            >
              {item.actor_profile_picture_url || item.actor_name ? (
                <Avatar
                  name={item.actor_name}
                  uri={item.actor_profile_picture_url}
                  size={34}
                />
              ) : (
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
                  <Ionicons
                    name={ICONS[item.activity_type] ?? "ellipse-outline"}
                    size={16}
                    color={colors.blue}
                  />
                </View>
              )}

              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}>
                  {item.title ?? item.activity_type.replace(/_/g, " ")}
                </Text>

                {item.description ? (
                  <Text numberOfLines={3} style={[styles.muted, { fontSize: 13 }]}>
                    {item.description}
                  </Text>
                ) : null}

                <Text style={[styles.muted, { fontSize: 11.5 }]}>
                  {[item.actor_name, item.customer_name]
                    .filter(Boolean)
                    .join(" · ")}
                  {item.actor_name || item.customer_name ? " · " : ""}
                  {relativeTime(item.created_at)}
                </Text>
              </View>
            </View>
          ))}
        </SettingsGroup>
      )}

      {items.length > 0 && items.length < total ? (
        <Pressable
          accessibilityRole="button"
          disabled={more}
          onPress={() => {
            setMore(true);
            void load(page + 1);
          }}
          style={({ pressed }) => ({
            alignItems: "center",
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: pressed ? colors.border : colors.pale,
          })}
        >
          {more ? (
            <ActivityIndicator color={colors.blue} />
          ) : (
            <Text style={{ color: colors.blue, fontSize: 14, fontWeight: "700" }}>
              Load {Math.min(PAGE_SIZE, total - items.length)} more
            </Text>
          )}
        </Pressable>
      ) : null}
    </SettingsScreen>
  );
}
