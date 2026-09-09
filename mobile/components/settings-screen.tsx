import { useRouter } from "expo-router";
import { ReactNode } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, ErrorNotice, IconButton, colors, styles } from "./ui";
import { useInbox } from "../lib/inbox-provider";

/*
 * The shell every settings page shares: a back button, a title, the workspace
 * it belongs to, and the three states each of them has.
 *
 * Written once because five screens differ only in their contents, and a
 * settings page that laid its header out slightly differently to the last one
 * would be the first thing anybody noticed about it.
 */
export function SettingsScreen({
  title,
  detail,
  loading,
  error,
  onRetry,
  footer,
  children,
}: {
  title: string;
  detail: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { workspace } = useInbox();

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.row}>
          <IconButton
            icon="chevron-back"
            label="Back to settings"
            onPress={() => router.back()}
          />

          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.heading}>
              {title}
            </Text>
            <Text numberOfLines={1} style={[styles.muted, { fontSize: 12.5 }]}>
              {detail}
            </Text>
          </View>
        </View>
      </View>

      <ErrorNotice message={error ?? ""} onRetry={onRetry} />

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
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 16 + insets.bottom,
            gap: 16,
          }}
        >
          {children}
        </ScrollView>
      )}

      {footer}
    </View>
  );
}

/** A titled card, matching the grouping the settings list uses. */
export function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      {title ? (
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
      ) : null}

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
    </View>
  );
}
