import { useFocusEffect } from "expo-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, ErrorNotice, colors, styles } from "./ui";
import { api } from "../lib/api/client";
import { useInbox } from "../lib/inbox-provider";

/*
 * The shell every tab except Inbox shares.
 *
 * All four load one workspace-scoped GET and draw it, so the header, the
 * "pick a workspace first" state, the spinner, the error line and pull to
 * refresh live here once. Written as a hook plus a wrapper rather than a
 * render prop so each screen keeps its own typed data.
 *
 * Nothing renders until a workspace is chosen: without one there is no
 * business id to scope the request to, and every one of these endpoints would
 * answer 403. Saying so beats four different empty states.
 */
export function useWorkspaceResource<T>(path: string | null) {
  const { workspace, revision } = useInbox();

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!workspace || !path) {
      setLoading(false);
      return;
    }

    try {
      setData(await api<T>(path, workspace.businessId));
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load this page.",
      );
    } finally {
      setLoading(false);
    }
  }, [path, workspace?.businessId]);

  // revision ticks when Realtime reports a change in this workspace.
  useEffect(() => {
    void load();
  }, [load, revision]);

  /*
   * And again whenever the tab comes back into view.
   *
   * A tab screen stays mounted while you are elsewhere in the app, so
   * everything on it was frozen at whatever it said when you last looked --
   * a room still showing its unread badge after you had read it, a mute you
   * had just turned on. Reloading on focus costs one request at the moment
   * somebody is looking at the answer.
   *
   * The first focus is skipped: it lands with the mount, and loading the
   * same thing twice on open is the one case this must not cause.
   */
  const focusedOnce = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }

      void load();
    }, [load]),
  );

  return { data, loading, error, reload: load, workspace };
}

export function TabScreen({
  title,
  loading,
  loadingFallback,
  error,
  onRefresh,
  children,
}: {
  title: string;
  loading: boolean;
  loadingFallback?: ReactNode;
  error: string;
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { workspace } = useInbox();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);

    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.muted}>
          {workspace?.businessName ?? "No workspace selected"}
        </Text>
      </View>

      <ErrorNotice message={error} onRetry={() => void refresh()} />

      {!workspace ? (
        <Empty
          icon="briefcase-outline"
          title="Choose a workspace"
          detail="Open the Inbox tab and pick a workspace. Everything else is scoped to it."
        />
      ) : loading ? (
        loadingFallback ?? (
          <View style={{ padding: 40 }}>
            <ActivityIndicator color={colors.blue} />
          </View>
        )
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.blue}
            />
          }
        >
          {children}
        </ScrollView>
      )}
    </View>
  );
}

/** One label-and-value line inside a card. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "muted" | "strong";
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 7,
      }}
    >
      <Text style={[styles.muted, { flex: 1 }]}>{label}</Text>

      <Text
        style={{
          color: tone === "muted" ? colors.muted : colors.ink,
          fontSize: tone === "strong" ? 20 : 15,
          fontWeight: tone === "strong" ? "800" : "600",
        }}
      >
        {value}
      </Text>
    </View>
  );
}
