import { useRouter } from "expo-router";
import { ReactNode, useEffect, useState } from "react";
import { Animated, ScrollView, Text, View } from "react-native";
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
  skeleton,
  children,
}: {
  title: string;
  detail: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  footer?: ReactNode;
  /* Rows per group, so the wait is the shape of the answer. */
  skeleton?: number[];
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
        <SettingsSkeleton groups={skeleton} />
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


/*
 * The wait, drawn as the thing being waited for.
 *
 * Every one of these screens showed a spinner in the middle of an empty
 * page: it says something is happening and nothing about what, and when the
 * content arrives the whole page jumps. The bars below are the cards these
 * screens actually draw -- a heading, then rows with a mark and two lines --
 * so the answer lands where the wait already was.
 *
 * Rows per group is a prop because the screens differ: four connected pages
 * is not the same shape as two form fields, and a skeleton that promises
 * eight rows before showing two is its own small lie.
 */
export function SettingsSkeleton({ groups = [3, 4] }: { groups?: number[] }) {
  const insets = useSafeAreaInsets();
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
    <Animated.View
      /*
       * Not announced. A screen reader saying "loading, loading, loading" as
       * the bars pulse is worse than the silence the spinner left behind --
       * the header already carries the title somebody is waiting on.
       */
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        padding: 16,
        paddingBottom: 16 + insets.bottom,
        gap: 16,
        opacity: pulse,
      }}
    >
      {groups.map((rows, group) => (
        <View key={group} style={{ gap: 8 }}>
          <Bar width={group === 0 ? 96 : 128} height={11} radius={6} />

          <View
            style={{
              backgroundColor: "white",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            {Array.from({ length: rows }, (_, row) => (
              <View
                key={row}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 14,
                  borderTopWidth: row === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <Bar width={34} height={34} radius={11} />

                <View style={{ flex: 1, gap: 7 }}>
                  {/*
                    Uneven, because real rows are. A column of identical bars
                    reads as a table nobody is going to get.
                  */}
                  <Bar width={row % 3 === 0 ? "62%" : "45%"} height={12} />
                  <Bar width={row % 2 === 0 ? "82%" : "70%"} height={10} />
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

function Bar({
  width = "100%",
  height,
  radius = 7,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
}) {
  return (
    <View
      style={{ width, height, borderRadius: radius, backgroundColor: "#DDE7F2" }}
    />
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
