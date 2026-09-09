import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Empty, colors, styles } from "../components/ui";
import { AuthProvider, useAuth } from "../lib/auth/provider";
import { DisplayProvider } from "../lib/display-provider";
import { InboxProvider } from "../lib/inbox-provider";
import { configured } from "../lib/supabase/client";

/*
 * Nothing works without the three EXPO_PUBLIC_ values, and the failure without
 * this is a blank screen or a request to https://unconfigured.supabase.co --
 * neither of which tells anyone what to do. Said once, here, rather than
 * letting every screen discover it separately.
 */
function Unconfigured() {
  return (
    <View style={styles.screen}>
      <Empty
        icon="settings-outline"
        title="TENH is not configured"
        detail="Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY and EXPO_PUBLIC_TENH_API_URL in mobile/.env, then restart Expo. See .env.example."
      />
    </View>
  );
}

/*
 * Held here until the stored session has been read back out of SecureStore.
 * Rendering the stack first would flash the sign-in screen at somebody who is
 * already signed in, every cold start.
 */
function Gate() {
  const { ready, error } = useAuth();

  if (!ready) {
    return (
      <View
        style={[
          styles.screen,
          { alignItems: "center", justifyContent: "center", gap: 12 },
        ]}
      >
        <ActivityIndicator color={colors.blue} size="large" />
        <Text style={styles.muted}>Restoring your session…</Text>
      </View>
    );
  }

  return (
    <>
      {error ? (
        <View style={{ backgroundColor: "#FFF1EF", padding: 10 }}>
          <Text style={{ color: colors.red, fontSize: 13 }}>{error}</Text>
        </View>
      ) : null}

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />

      {configured ? (
        <AuthProvider>
          <DisplayProvider>
            <InboxProvider>
              <Gate />
            </InboxProvider>
          </DisplayProvider>
        </AuthProvider>
      ) : (
        <Unconfigured />
      )}
    </SafeAreaProvider>
  );
}
