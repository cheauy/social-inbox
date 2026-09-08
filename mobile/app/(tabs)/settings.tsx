import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  Button,
  ErrorNotice,
  colors,
  styles,
} from "../../components/ui";
import { useAuth } from "../../lib/auth/provider";
import { useInbox } from "../../lib/inbox-provider";
import { supabase } from "../../lib/supabase/client";
import type { Workspace } from "../../lib/types";

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

  const {
    member,
    workspace,
    workspaces,
    error,
    live,
    selectWorkspace,
    loadWorkspaces,
  } = useInbox();

  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");

  async function switchTo(next: Workspace) {
    if (next.businessId === workspace?.businessId || busy) {
      return;
    }

    setBusy(true);
    setLocalError("");

    try {
      await selectWorkspace(next);
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
      "Sign out?",
      "You will need your email and password to sign back in.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => void signOut(),
        },
      ],
    );
  }

  async function signOut() {
    setBusy(true);
    setLocalError("");

    try {
      const { error: signOutError } = await supabase.auth.signOut();

      if (signOutError) {
        setLocalError(signOutError.message);
      }

      // The session going null is what moves the app back to sign-in; the
      // providers clear their own state from that.
    } catch {
      setLocalError("Could not sign out. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.muted}>
          {member?.email ?? session?.user.email ?? "Signed in"}
        </Text>
      </View>

      <ErrorNotice
        message={localError || error}
        onRetry={() => void loadWorkspaces()}
      />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View style={styles.card}>
          <View style={styles.row}>
            <Avatar
              name={member?.full_name ?? session?.user.email}
              uri={member?.profile_picture_url}
            />

            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.heading} numberOfLines={1}>
                {member?.full_name ?? "TENH user"}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {member?.role ?? "—"}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Workspace</Text>

          <Text style={[styles.muted, { marginTop: 2, marginBottom: 10 }]}>
            Everything in the app is scoped to the one selected here.
          </Text>

          {workspaces.length === 0 ? (
            <Text style={styles.muted}>No workspaces available.</Text>
          ) : (
            workspaces.map((item) => {
              const selected = item.businessId === workspace?.businessId;
              const usable = item.subscriptionOperational;

              return (
                <Pressable
                  key={item.businessId}
                  accessibilityRole="button"
                  disabled={!usable || busy}
                  onPress={() => void switchTo(item)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingVertical: 11,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    opacity: !usable ? 0.5 : pressed ? 0.6 : 1,
                  })}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.ink,
                        fontSize: 15,
                        fontWeight: selected ? "800" : "500",
                      }}
                      numberOfLines={1}
                    >
                      {item.businessName}
                    </Text>

                    {!usable ? (
                      <Text style={[styles.muted, { fontSize: 12 }]}>
                        Subscription expired
                      </Text>
                    ) : null}
                  </View>

                  {selected ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={21}
                      color={colors.blue}
                    />
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Live updates</Text>

          <View style={[styles.row, { marginTop: 8 }]}>
            <View
              style={{
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: live ? "#2FA36B" : colors.border,
              }}
            />

            <Text style={[styles.muted, { flex: 1 }]}>
              {live
                ? "Connected — new messages arrive on their own."
                : "Offline — pull down on a list to refresh."}
            </Text>
          </View>
        </View>

        <Button
          title="Sign out"
          secondary
          busy={busy}
          onPress={confirmSignOut}
        />

        <Text
          style={[
            styles.muted,
            { fontSize: 12, textAlign: "center", lineHeight: 18 },
          ]}
        >
          Account settings, billing and team management are on the web at
          app.tenhchat.com.
        </Text>
      </ScrollView>
    </View>
  );
}
