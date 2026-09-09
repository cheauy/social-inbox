import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
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
 * Rows that this app can do open here. Rows that need a surface a phone
 * cannot give -- a font picker, a permission matrix -- say so and open the
 * web page rather than pretending. A row that lies about what it does is
 * worse than a row that sends you somewhere honest.
 */

type Row = {
  icon: IconName;
  label: string;
  detail: string;
  route?: string;
  web?: string;
  /* Owners and admins only, matching the web's own gating. */
  manage?: boolean;
};

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Workspace",
    rows: [
      {
        icon: "business-outline",
        label: "General",
        detail: "Workspace name, time zone and contact details.",
        web: "/dashboard/settings/general",
        manage: true,
      },
      {
        icon: "color-palette-outline",
        label: "Display",
        detail: "Language and chat background.",
        route: "/settings/display",
      },
    ],
  },
  {
    title: "Inbox",
    rows: [
      {
        icon: "pricetags-outline",
        label: "Tags",
        detail: "What you can label a customer with.",
        route: "/settings/tags",
      },
      {
        icon: "flash-outline",
        label: "Quick replies",
        detail: "Saved messages and their categories.",
        web: "/dashboard/settings/saved-replies",
      },
    ],
  },
  {
    title: "Access",
    rows: [
      {
        icon: "people-outline",
        label: "People and channels",
        detail: "Who is on the team and which pages are connected.",
        route: "/settings/people",
      },
      {
        icon: "key-outline",
        label: "Roles and permissions",
        detail: "What each role is allowed to do.",
        web: "/dashboard/settings/roles-permissions",
        manage: true,
      },
      {
        icon: "time-outline",
        label: "Change history",
        detail: "Who changed what, and when.",
        route: "/settings/history",
      },
    ],
  },
  {
    title: "Security",
    rows: [
      {
        icon: "lock-closed-outline",
        label: "Login and security",
        detail: "Password, and the devices signed in.",
        web: "/dashboard/settings/security",
      },
    ],
  },
  {
    title: "Help",
    rows: [
      {
        icon: "help-buoy-outline",
        label: "Report a problem",
        detail: "Send TENH something that is not working.",
        route: "/settings/report",
      },
    ],
  },
];

const WEB = process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com";

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
    canManageRooms,
    selectWorkspace,
    loadWorkspaces,
  } = useInbox();

  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [switcher, setSwitcher] = useState(false);

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  /*
   * canManageRooms is the owner-or-admin answer the team chat endpoint
   * already gives us, which is the same test the web applies to these rows.
   * Asking a second endpoint for the same fact would only give it a second
   * chance to disagree.
   */
  const canManage = canManageRooms;

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

  /*
   * Handed to the browser rather than shown in a web view. The app's session
   * lives in its own storage, not the browser's, so an in-app view would
   * present a sign-in page rather than the settings page -- and a page that
   * asks for a password is exactly what this app should not be showing.
   */
  function openOnWeb(path: string) {
    void Linking.openURL(`${WEB}${path}`);
  }

  function confirmSignOut() {
    /*
     * Confirmed, because signing out on a phone is one mis-tap away and
     * getting back in means typing a password on a small keyboard.
     */
    Alert.alert(
      "Sign out?",
      "You will need your email and password to sign back in.",
      [
        { text: "Stay signed in", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => void supabase.auth.signOut(),
        },
      ],
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {workspace?.businessName ?? "No workspace selected"}
        </Text>
      </View>

      <ErrorNotice
        message={localError || error}
        onRetry={() => void loadWorkspaces()}
      />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 14,
            borderRadius: 16,
            backgroundColor: "white",
            borderWidth: 1,
            borderColor: colors.border,
          }}
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
        </View>

        {workspaces.length > 1 ? (
          <Group title="Workspace in use">
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
                {workspace?.businessName ?? "Choose a workspace"}
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
                            : "Subscription expired — renew on the web"}
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

        {GROUPS.map((group) => {
          const rows = group.rows.filter((row) => !row.manage || canManage);

          if (rows.length === 0) {
            return null;
          }

          return (
            <Group key={group.title} title={group.title}>
              {rows.map((row, index) => (
                <Pressable
                  key={row.label}
                  accessibilityRole="button"
                  accessibilityLabel={
                    row.web
                      ? `${row.label}. Opens on the web.`
                      : row.label
                  }
                  onPress={() =>
                    row.route
                      ? router.push(row.route as never)
                      : openOnWeb(row.web as string)
                  }
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
                      {row.label}
                    </Text>
                    <Text style={[styles.muted, { fontSize: 12.5 }]}>
                      {row.detail}
                    </Text>
                  </View>

                  {/*
                    Marked, so nobody taps expecting to stay in the app. These
                    are the pages that need a width or a keyboard a phone does
                    not have.
                  */}
                  <Ionicons
                    name={row.web ? "open-outline" : "chevron-forward"}
                    size={row.web ? 15 : 18}
                    color={colors.muted}
                  />
                </Pressable>
              ))}
            </Group>
          );
        })}

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
            Sign out
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
