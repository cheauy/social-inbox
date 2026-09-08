import { Redirect } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, ErrorNotice, colors, styles } from "../components/ui";
import { useAuth } from "../lib/auth/provider";
import { supabase } from "../lib/supabase/client";

export default function SignIn() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (session) {
    return <Redirect href="/" />;
  }

  async function signIn() {
    const address = email.trim();

    if (!address || !password) {
      setError("Enter your email address and password.");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const { error: signInError } =
        await supabase.auth.signInWithPassword({
          email: address,
          password,
        });

      /*
       * Supabase's own message is shown rather than a rewritten one. "Invalid
       * login credentials" and "Email not confirmed" need different actions
       * from the person reading them, and collapsing both into "Sign in
       * failed" hides which one happened.
       */
      if (signInError) {
        setError(signInError.message);
        return;
      }

      // The session lands through onAuthStateChange, and the redirect above
      // fires on the next render. Nothing to navigate to by hand.
      setPassword("");
    } catch {
      setError(
        "Could not reach TENH. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          paddingTop: insets.top + 48,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 6 }}>
          <Text style={styles.title}>Tenh Chat</Text>
          <Text style={styles.muted}>
            Sign in to manage your customer conversations.
          </Text>
        </View>

        <ErrorNotice message={error} />

        <View style={{ gap: 12 }}>
          <View style={{ gap: 6 }}>
            <Text style={styles.muted}>Email address</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              editable={!busy}
              returnKeyType="next"
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.muted}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              style={styles.input}
              placeholder="Your password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              editable={!busy}
              returnKeyType="go"
              onSubmitEditing={() => void signIn()}
            />
          </View>

          <Button
            title="Sign in"
            busy={busy}
            onPress={() => void signIn()}
          />
        </View>

        <Text style={[styles.muted, { fontSize: 12, lineHeight: 18 }]}>
          Signing in stores your session encrypted on this device only. Use the
          TENH website to create an account or reset a password.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
