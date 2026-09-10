import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, ErrorNotice, colors, styles } from "../components/ui";
import { useAuth } from "../lib/auth/provider";
import { signInWithProvider, type OAuthProvider } from "../lib/auth/oauth";
import { supabase } from "../lib/supabase/client";

export default function SignIn() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

  /*
   * Signing in and creating an account, on one screen.
   *
   * They ask for almost the same things and lead to the same place, and a
   * second screen behind a link is a screen somebody has to find. The tabs
   * keep both a tap away, and the form below them grows a name field rather
   * than being replaced.
   */
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const working = busy || provider !== null;

  /*
   * Straight to the workspace chooser, not the Inbox.
   *
   * Landing on the Inbox meant the app quietly reopened whichever workspace
   * was last used -- fine for reopening the app, wrong right after signing
   * in, when the first question is which shop you are here for. It also left
   * nothing underneath the Inbox, so the back gesture had nowhere to go; now
   * the chooser is the screen the Inbox sits on top of.
   */
  if (session) {
    return <Redirect href="/workspaces" />;
  }

  function change(next: "sign-in" | "register") {
    setMode(next);
    setError("");
    setNotice("");
  }

  async function withProvider(chosen: OAuthProvider) {
    if (working) return;

    setProvider(chosen);
    setError("");
    setNotice("");

    try {
      await signInWithProvider(chosen);
      // The session arrives through onAuthStateChange and the redirect above
      // fires on the next render.
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not finish signing in. Please try again.",
      );
    } finally {
      setProvider(null);
    }
  }

  async function submit() {
    const address = email.trim();

    if (!address || !password) {
      setError("Enter your email address and password.");
      return;
    }

    if (mode === "register" && !name.trim()) {
      setError("Enter your name so your team knows who you are.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (mode === "register") {
        /*
         * The same call the website's registration makes, with the same
         * metadata: full_name is what the app and the web both read for who
         * you are, and it is only writable at sign-up without a second round
         * trip.
         */
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: address,
          password,
          options: { data: { full_name: name.trim() } },
        });

        if (signUpError) {
          setError(signUpError.message);
          return;
        }

        setPassword("");

        /*
         * A confirmed session comes straight back when the project does not
         * require email confirmation; otherwise there is a mail to open, and
         * saying so is the whole message -- an account that exists but cannot
         * be used yet looks broken without it.
         */
        if (!data.session) {
          setMode("sign-in");
          setNotice(
            `Account created. Open the confirmation link sent to ${address}, then sign in.`,
          );
        }

        return;
      }

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

      setPassword("");
    } catch {
      setError("Could not reach TENH. Check your connection and try again.");
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
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 32,
          gap: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", gap: 10 }}>
          <Image
            source={require("../assets/tenh-logo.png")}
            style={{ width: 72, height: 72, borderRadius: 20 }}
            resizeMode="contain"
          />

          <Text style={[styles.title, { fontSize: 24 }]}>TENH Chat</Text>

          <Text style={[styles.muted, { textAlign: "center" }]}>
            {mode === "sign-in"
              ? "Sign in to manage your customer conversations."
              : "Create an account and start a free trial."}
          </Text>
        </View>

        {/*
          The two providers first, above the form.

          Most people here signed up on the website with one of these, and a
          Google button under a password field reads as a fallback rather than
          the way they already have an account.
        */}
        <View style={{ gap: 10 }}>
          <Social
            icon="logo-google"
            tint="#DB4437"
            label="Continue with Google"
            busy={provider === "google"}
            disabled={working}
            onPress={() => void withProvider("google")}
          />

          <Social
            icon="logo-facebook"
            tint="#1877F2"
            label="Continue with Facebook"
            busy={provider === "facebook"}
            disabled={working}
            onPress={() => void withProvider("facebook")}
          />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          <Text style={[styles.muted, { fontSize: 12 }]}>or with email</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        </View>

        <View
          style={{
            flexDirection: "row",
            padding: 4,
            borderRadius: 14,
            backgroundColor: colors.background,
          }}
        >
          {(["sign-in", "register"] as const).map((one) => (
            <Pressable
              key={one}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === one }}
              disabled={working}
              onPress={() => change(one)}
              style={{
                flex: 1,
                height: 38,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: mode === one ? "white" : "transparent",
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "800",
                  color: mode === one ? colors.ink : colors.muted,
                }}
              >
                {one === "sign-in" ? "Sign in" : "Register"}
              </Text>
            </Pressable>
          ))}
        </View>

        <ErrorNotice message={error} />

        {notice ? (
          <View
            style={{
              padding: 12,
              borderRadius: 12,
              backgroundColor: colors.pale,
            }}
          >
            <Text style={{ fontSize: 13, color: colors.ink, lineHeight: 19 }}>
              {notice}
            </Text>
          </View>
        ) : null}

        <View style={{ gap: 12 }}>
          {mode === "register" ? (
            <View style={{ gap: 6 }}>
              <Text style={styles.muted}>Your name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                style={styles.input}
                placeholder="Sokha Chan"
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
                autoComplete="name"
                editable={!working}
                returnKeyType="next"
              />
            </View>
          ) : null}

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
              editable={!working}
              returnKeyType="next"
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.muted}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              style={styles.input}
              placeholder={
                mode === "register" ? "At least 8 characters" : "Your password"
              }
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              editable={!working}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
          </View>

          <Button
            title={mode === "register" ? "Create account" : "Sign in"}
            busy={busy}
            disabled={working}
            onPress={() => void submit()}
          />
        </View>

        <Text style={[styles.muted, { fontSize: 12, lineHeight: 18 }]}>
          Signing in stores your session encrypted on this device only.
          {mode === "sign-in"
            ? " Resetting a password is on the TENH website."
            : " Creating an account means agreeing to the TENH terms of service."}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/*
 * A provider button. Outlined rather than filled with the brand's own colour:
 * two solid brand buttons above a solid blue Sign in makes three things
 * shouting, and the icon already says which is which.
 */
function Social({
  icon,
  tint,
  label,
  busy,
  disabled,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  tint: string;
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 50,
        borderRadius: 14,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: disabled && !busy ? 0.5 : 1,
        backgroundColor: pressed ? colors.background : "white",
      })}
    >
      {busy ? (
        <ActivityIndicator color={tint} />
      ) : (
        <Ionicons name={icon} size={19} color={tint} />
      )}

      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}
