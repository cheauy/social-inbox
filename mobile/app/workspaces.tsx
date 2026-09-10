import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, ErrorNotice, colors, styles } from "../components/ui";
import { useAuth } from "../lib/auth/provider";
import { useInbox } from "../lib/inbox-provider";
import { useLanguage } from "../lib/language-provider";
import type { Workspace } from "../lib/types";

/*
 * Choosing a workspace, as its own screen rather than a state of the Inbox.
 *
 * It was rendered inside the Inbox tab, which meant the tab bar sat under a
 * question you have to answer before any of those tabs mean anything --
 * Analytics for which workspace? -- and the Inbox's own search and filters
 * sat above it, filtering a list of conversations that had not been chosen
 * yet. A screen with one question on it and nothing else to press is easier
 * to answer.
 *
 * It stays reachable afterwards: the Inbox's own switcher and the back
 * gesture both come here, so somebody who works across two shops is one
 * gesture from the other one.
 */

const WEB = process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com";

/*
 * A workspace has no logo anywhere in TENH -- there is no field for one -- so
 * this builds one from the name: its initials on a colour hashed from that
 * name. Stable is the whole point. "Demo Online Shop" is the same green on
 * every device, every launch, so after a day nobody reads the list any more,
 * they reach for the green one.
 */
const MARKS = [
  { tint: "#0089CC", wash: "#E3F3FB" },
  { tint: "#2FA36B", wash: "#E7F6EE" },
  { tint: "#C77700", wash: "#FBF0E0" },
  { tint: "#6D4AFF", wash: "#EDE9FF" },
  { tint: "#B43232", wash: "#FBEAEA" },
  { tint: "#0F7C8A", wash: "#E2F2F4" },
];

function markFor(name: string) {
  let hash = 0;

  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100000;
  }

  return MARKS[hash % MARKS.length];
}

/* Two letters when the name gives two words, one when it does not. */
function initials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .trim()
    .split(/\s+/);

  if (words.length === 0 || !words[0]) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function Workspaces() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { t } = useLanguage();

  const {
    workspaces,
    workspace,
    loading,
    error,
    selectWorkspace,
    loadWorkspaces,
  } = useInbox();

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  /*
   * Only the ones that can be opened.
   *
   * An expired workspace used to sit in this list greyed out, saying "renew
   * on the web" -- a row that cannot be tapped, on a device that cannot renew
   * it, padding the one list somebody has to get through before they can read
   * a message.
   */
  const open = workspaces.filter((one) => one.subscriptionOperational);
  const expired = workspaces.length - open.length;

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? open.filter((one) => one.businessName.toLowerCase().includes(needle))
    : open;

  async function choose(next: Workspace) {
    if (busy) return;

    setBusy(next.businessId);

    try {
      await selectWorkspace(next);
      /*
       * Pushed, not replaced: the back gesture comes back here, which is what
       * somebody switching between two shops all day expects.
       */
      router.push("/(tabs)");
    } catch {
      // selectWorkspace reports through the provider's own error line.
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {/*
          The brand, first.

          This screen is the first thing after signing in, and it used to open
          on a bare question -- "Choose a workspace" -- with no sign of which
          app was asking. The logo, the name and what the app is for go on the
          top row with the one button; the question moves to a second row,
          where it reads as the heading of the list under it rather than as
          the title of the app.
        */}
        <View style={styles.row}>
          <Image
            source={require("../assets/tenh-logo.png")}
            style={{ width: 34, height: 34, borderRadius: 9 }}
            resizeMode="contain"
          />

          <View style={{ flex: 1, marginLeft: 10, gap: 1 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 16, fontWeight: "800", color: colors.ink }}
            >
              TENH Chat
            </Text>

            <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
              {t("Customer messaging", "ការផ្ញើសារអតិថិជន")}
            </Text>
          </View>

          {/*
            The only button here. Everything else on this screen answers the
            question; this is the way out of it when the answer is "none of
            these" -- which is a purchase, and a purchase is on the web.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Buy a subscription", "ទិញការជាវ")}
            onPress={() =>
              void Linking.openURL(`${WEB}/dashboard/settings/subscription`)
            }
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? "#0A6FA8" : colors.blue,
            })}
          >
            <Ionicons name="add" size={22} color="white" />
          </Pressable>
        </View>

        <View style={{ marginTop: 14, gap: 2 }}>
          <Text style={[styles.title, { fontSize: 22 }]}>
            {t("Choose a workspace", "ជ្រើសកន្លែងធ្វើការ")}
          </Text>

          {/*
            Silent when there is nothing to count and something went wrong:
            "0 workspaces are ready" under an Unauthorized banner reads as a
            second, wrong explanation for the same thing.
          */}
          {open.length > 0 || !error ? (
            <Text style={styles.muted} numberOfLines={1}>
              {open.length === 1
                ? t("One workspace is ready", "មានកន្លែងធ្វើការមួយ")
                : t(
                    open.length + " workspaces are ready",
                    "មានកន្លែងធ្វើការ " + open.length,
                  )}
            </Text>
          ) : null}
        </View>

        {/*
          Search, and nothing beside it. The Inbox's filters were sitting on
          this screen filtering conversations from a workspace nobody had
          picked yet.
        */}
        {open.length > 1 ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              marginTop: 10,
              paddingHorizontal: 13,
              height: 44,
              borderRadius: 14,
              backgroundColor: colors.background,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="search" size={17} color={colors.muted} />

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("Search workspace", "ស្វែងរកកន្លែងធ្វើការ")}
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              style={{ flex: 1, fontSize: 15, color: colors.ink }}
            />

            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Clear", "សម្អាត")}
                onPress={() => setQuery("")}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={17} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <ErrorNotice message={error} onRetry={() => void loadWorkspaces()} />

      {loading && workspaces.length === 0 ? (
        <View style={{ padding: 40 }}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : shown.length === 0 ? (
        <Empty
          icon="briefcase-outline"
          title={
            needle
              ? t("Nothing matches", "រកមិនឃើញ")
              : expired > 0
                ? t("No workspace with a live plan", "គ្មានកន្លែងធ្វើការដែលមានគម្រោង")
                : t("No workspace available", "គ្មានកន្លែងធ្វើការ")
          }
          detail={
            needle
              ? t(
                  "No workspace here is called that.",
                  "គ្មានកន្លែងធ្វើការឈ្មោះនេះទេ។",
                )
              : expired > 0
                ? t(
                    "Every workspace you belong to has an expired subscription. Renewing is on the web, and the button above starts it.",
                    "កន្លែងធ្វើការទាំងអស់អស់សុពលភាព។ សូមបន្តនៅលើគេហទំព័រ។",
                  )
                : t(
                    "This account is not an active member of any workspace.",
                    "គណនីនេះមិនមែនជាសមាជិកសកម្មនៃកន្លែងធ្វើការណាមួយទេ។",
                  )
          }
        />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(item) => item.businessId}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 16,
            gap: 12,
          }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const mark = markFor(item.businessName);
            const current = item.businessId === workspace?.businessId;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(
                  "Open " + item.businessName,
                  "បើក " + item.businessName,
                )}
                disabled={busy !== null}
                onPress={() => void choose(item)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    padding: 14,
                    borderColor: current ? colors.blue : colors.border,
                    backgroundColor: pressed ? colors.pale : "white",
                    opacity: busy && busy !== item.businessId ? 0.5 : 1,
                  },
                ]}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 13 }}
                >
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 15,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: mark.wash,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: "800",
                        color: mark.tint,
                      }}
                    >
                      {initials(item.businessName)}
                    </Text>
                  </View>

                  <View style={{ flex: 1, gap: 5 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 16.5,
                        fontWeight: "700",
                        color: colors.ink,
                      }}
                    >
                      {item.businessName}
                    </Text>

                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Chip
                        icon={
                          item.role === "owner"
                            ? "ribbon-outline"
                            : item.role === "admin"
                              ? "key-outline"
                              : "person-outline"
                        }
                        label={item.role}
                      />

                      {current ? (
                        <Chip icon="checkmark" label={t("Open now", "កំពុងបើក")} />
                      ) : null}
                    </View>
                  </View>

                  {busy === item.businessId ? (
                    <ActivityIndicator color={colors.blue} />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={colors.muted}
                    />
                  )}
                </View>
              </Pressable>
            );
          }}
          ListFooterComponent={
            expired > 0 && !needle ? (
              <Text
                style={[
                  styles.muted,
                  { fontSize: 12, paddingHorizontal: 4, lineHeight: 18 },
                ]}
              >
                {t(
                  expired +
                    (expired === 1
                      ? " workspace has an expired plan and is not listed."
                      : " workspaces have expired plans and are not listed.") +
                    " Renewing is on the web.",
                  "កន្លែងធ្វើការ " + expired + " អស់សុពលភាព ហើយមិនបានបង្ហាញទេ។",
                )}
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

function Chip({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: colors.pale,
      }}
    >
      <Ionicons name={icon} size={11} color={colors.blue} />

      <Text
        style={{
          fontSize: 11,
          fontWeight: "800",
          color: colors.blue,
          textTransform: "capitalize",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
