import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  ErrorNotice,
  IconName,
  colors,
  styles,
} from "../../components/ui";
import { useAuth } from "../../lib/auth/provider";
import { useInbox } from "../../lib/inbox-provider";
import { useLanguage } from "../../lib/language-provider";
import { supabase } from "../../lib/supabase/client";
import type { Workspace } from "../../lib/types";

/*
 * Settings, grouped the way the web groups them.
 *
 * The tab was a workspace switcher and a sign-out button, so anybody wanting
 * to add a tag, read the change history or report a problem had to find a
 * laptop. The rows below are the web's own list in the web's own order --
 * Workspace, Inbox, Access, Security, Help -- so somebody who knows one knows
 * the other.
 *
 * Every row opens here now. Four of them used to hand you to a browser --
 * quick replies, permissions, the sound, your password -- on the grounds that
 * they were desktop shapes. Three of those were: a matrix of thirty
 * permissions by every member, a grid of fourteen sounds, a media library.
 * The decisions inside them are not. A phone can ask "what is this one person
 * allowed to do" and "which of these six" perfectly well, and being handed to
 * a browser is how those decisions stopped being made at all.
 */

type Row = {
  icon: IconName;
  label: string;
  km: string;
  detail: string;
  detailKm: string;
  route: string;
};

/*
 * Read from the app config rather than typed here, so the number on this
 * screen is the number that was built. A second copy in the source is a
 * second thing to forget on release day.
 */
const VERSION = Constants.expoConfig?.version ?? "";

const GROUPS: { title: string; km: string; rows: Row[] }[] = [
  {
    title: "Workspace",
    km: "កន្លែងធ្វើការ",
    rows: [
      {
        icon: "notifications-outline",
        label: "General",
        km: "ទូទៅ",
        detail: "The sound a new message makes.",
        detailKm: "សំឡេងពេលមានសារថ្មី។",
        route: "/settings/general",
      },
      {
        icon: "color-palette-outline",
        label: "Display",
        km: "ការបង្ហាញ",
        detail: "Language and chat background.",
        detailKm: "ភាសា និងផ្ទៃខាងក្រោយឆាត។",
        route: "/settings/display",
      },
    ],
  },
  {
    title: "Inbox",
    km: "ប្រអប់សារ",
    rows: [
      {
        icon: "pricetags-outline",
        label: "Tags",
        km: "ស្លាក",
        detail: "What you can label a customer with.",
        detailKm: "អ្វីដែលអ្នកអាចដាក់ស្លាកលើអតិថិជន។",
        route: "/settings/tags",
      },
      {
        icon: "flash-outline",
        label: "Quick replies",
        km: "ការឆ្លើយតបរហ័ស",
        detail: "Saved messages you can send in a tap.",
        detailKm: "សារដែលរក្សាទុក ផ្ញើបានក្នុងមួយប៉ះ។",
        route: "/settings/quick-replies",
      },
    ],
  },
  {
    title: "Access",
    km: "សិទ្ធិចូល",
    rows: [
      {
        icon: "people-outline",
        label: "People and channels",
        km: "មនុស្ស និងឆានែល",
        detail: "Who is on the team and which pages are connected.",
        detailKm: "នរណានៅក្នុងក្រុម និងទំព័រណាភ្ជាប់។",
        route: "/settings/people",
      },
      {
        icon: "key-outline",
        label: "Roles and permissions",
        km: "តួនាទី និងសិទ្ធិ",
        detail: "What each person is allowed to do.",
        detailKm: "អ្វីដែលម្នាក់ៗអាចធ្វើបាន។",
        route: "/settings/roles",
      },
      {
        icon: "time-outline",
        label: "Change history",
        km: "ប្រវត្តិផ្លាស់ប្តូរ",
        detail: "Who changed what, and when.",
        detailKm: "នរណាកែអ្វី និងពេលណា។",
        route: "/settings/history",
      },
    ],
  },
  {
    title: "Security",
    km: "សុវត្ថិភាព",
    rows: [
      {
        icon: "lock-closed-outline",
        label: "Login and security",
        km: "ការចូល និងសុវត្ថិភាព",
        detail: "Password, recovery and the devices signed in.",
        detailKm: "ពាក្យសម្ងាត់ ការសង្គ្រោះ និងឧបករណ៍។",
        route: "/settings/security",
      },
    ],
  },
  {
    title: "Help",
    km: "ជំនួយ",
    rows: [
      {
        icon: "help-buoy-outline",
        label: "Report a problem",
        km: "រាយការណ៍បញ្ហា",
        detail: "Send TENH something that is not working.",
        detailKm: "ផ្ញើបញ្ហាទៅ TENH។",
        route: "/settings/report",
      },
    ],
  },
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
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

export default function Settings() {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const {
    member,
    workspace,
    workspaces,
    error,
    selectWorkspace,
    loadWorkspaces,
  } = useInbox();
  const { t } = useLanguage();

  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [switcher, setSwitcher] = useState(false);

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  async function switchTo(next: Workspace) {
    if (next.businessId === workspace?.businessId || busy) {
      return;
    }

    setBusy(true);
    setLocalError("");

    try {
      await selectWorkspace(next);
      setSwitcher(false);
    } catch {
      // selectWorkspace reports through the provider's own error.
    } finally {
      setBusy(false);
    }
  }

  function confirmSignOut() {
    /*
     * Confirmed, because signing out on a phone is one mis-tap away and
     * getting back in means typing a password on a small keyboard.
     */
    Alert.alert(
      t("Sign out?", "ចាកចេញ?"),
      t(
        "You will need your email and password to sign back in.",
        "អ្នកនឹងត្រូវប្រើអ៊ីមែល និងពាក្យសម្ងាត់ដើម្បីចូលម្តងទៀត។",
      ),
      [
        { text: t("Stay signed in", "នៅជាប់"), style: "cancel" },
        {
          text: t("Sign out", "ចាកចេញ"),
          style: "destructive",
          onPress: () => void supabase.auth.signOut(),
        },
      ],
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("Settings", "ការកំណត់")}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {workspace?.businessName ?? t("No workspace selected", "មិនបានជ្រើសកន្លែងធ្វើការ")}
        </Text>
      </View>

      <ErrorNotice
        message={localError || error}
        onRetry={() => void loadWorkspaces()}
      />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        {/*
          The card is the way in to everything about you and this workspace --
          your details, the plan, what it is connected to. Those were in three
          different places, one of them a whole tab along the bottom.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your profile, subscription and integrations"
          onPress={() => router.push("/settings/profile")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 14,
            borderRadius: 16,
            backgroundColor: pressed ? colors.pale : "white",
            borderWidth: 1,
            borderColor: colors.border,
          })}
        >
          <Avatar
            name={member?.full_name}
            uri={member?.profile_picture_url}
            size={46}
          />

          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.heading} numberOfLines={1}>
              {member?.full_name ?? "You"}
            </Text>
            <Text style={[styles.muted, { fontSize: 12.5 }]} numberOfLines={1}>
              {member?.email ?? session.user.email} · {member?.role ?? "member"}
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>

        {workspaces.length > 1 ? (
          <Group title={t("Switch workspace", "ប្តូរកន្លែងធ្វើការ")}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSwitcher((open) => !open)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 14,
                backgroundColor: pressed ? colors.pale : "transparent",
              })}
            >
              <Ionicons name="briefcase-outline" size={19} color={colors.muted} />

              <Text
                style={{ flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink }}
                numberOfLines={1}
              >
                {workspace?.businessName ?? t("Choose a workspace", "ជ្រើសកន្លែងធ្វើការ")}
              </Text>

              {busy ? (
                <ActivityIndicator color={colors.blue} />
              ) : (
                <Ionicons
                  name={switcher ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={colors.muted}
                />
              )}
            </Pressable>

            {switcher
              ? workspaces.map((option) => {
                  const usable = option.subscriptionOperational;
                  const active = option.businessId === workspace?.businessId;

                  return (
                    <Pressable
                      key={option.businessId}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      disabled={!usable || busy}
                      onPress={() => void switchTo(option)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                        backgroundColor: pressed ? colors.pale : "transparent",
                        opacity: usable ? 1 : 0.5,
                      })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 14.5,
                            color: colors.ink,
                            fontWeight: active ? "800" : "500",
                          }}
                          numberOfLines={1}
                        >
                          {option.businessName}
                        </Text>

                        <Text style={[styles.muted, { fontSize: 12 }]}>
                          {usable
                            ? option.role
                            : t(
                                "Subscription expired — renew on the web",
                                "អស់សុពលភាព — សូមបន្តនៅលើគេហទំព័រ",
                              )}
                        </Text>
                      </View>

                      {active ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={colors.blue}
                        />
                      ) : null}
                    </Pressable>
                  );
                })
              : null}
          </Group>
        ) : null}

        {GROUPS.map((group) => (
          <Group key={group.title} title={t(group.title, group.km)}>
              {group.rows.map((row, index) => (
                <Pressable
                  key={row.label}
                  accessibilityRole="button"
                  accessibilityLabel={t(row.label, row.km)}
                  onPress={() => router.push(row.route as never)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 13,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colors.border,
                    backgroundColor: pressed ? colors.pale : "transparent",
                  })}
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
                    <Ionicons name={row.icon} size={17} color={colors.blue} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}
                    >
                      {t(row.label, row.km)}
                    </Text>
                    <Text style={[styles.muted, { fontSize: 12.5 }]}>
                      {t(row.detail, row.detailKm)}
                    </Text>
                  </View>

                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.muted}
                  />
                </Pressable>
              ))}
            </Group>
        ))}

        <Pressable
          accessibilityRole="button"
          onPress={confirmSignOut}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 15,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.red,
            backgroundColor: pressed ? "#FFF1EF" : "white",
          })}
        >
          <Ionicons name="log-out-outline" size={18} color={colors.red} />

          <Text style={{ color: colors.red, fontSize: 15, fontWeight: "700" }}>
            {t("Sign out", "ចាកចេញ")}
          </Text>
        </Pressable>

        {/*
          The version, where every app puts it: the last thing under the last
          button. It is the first question asked when somebody reports that
          something is broken, and "the one from the link you sent me" is not
          an answer anybody can act on.
        */}
        <Text
          style={[
            styles.muted,
            { fontSize: 12, textAlign: "center", paddingTop: 2 },
          ]}
        >
          {t("TENH Chat ", "TENH Chat ") + VERSION}
        </Text>
      </ScrollView>
    </View>
  );
}
