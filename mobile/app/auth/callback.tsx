import { useEffect, useState } from "react";
import { Redirect, useLocalSearchParams, router } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Button, ErrorNotice, colors, styles } from "../../components/ui";
import { useAuth } from "../../lib/auth/provider";
import { completeAuthCode } from "../../lib/auth/oauth";

WebBrowser.maybeCompleteAuthSession();

export default function AuthCallback() {
  const { session } = useAuth();
  const params = useLocalSearchParams<{ code?: string; error_description?: string; error?: string }>();
  const [error, setError] = useState("");
  const code = typeof params.code === "string" ? params.code : "";
  const providerError = typeof params.error_description === "string" ? params.error_description
    : typeof params.error === "string" ? params.error : "";
  useEffect(() => {
    let active = true;
    if (code && !providerError) {
      completeAuthCode(code).catch(() => {
        if (active) setError("Could not finish sign-in. Open the confirmation link on the device where you registered, or return to sign in and try again.");
      });
    }
    return () => { active = false; };
  }, [code, providerError]);

  if (session) return <Redirect href="/workspaces" />;
  const message = providerError || error || (!code ? "This sign-in link is incomplete. Please sign in again." : "");
  return <View style={[styles.screen, { padding: 24, justifyContent: "center", gap: 20 }]}>
    <Text style={styles.title}>Tenh Chat</Text>
    {message ? <>
      <ErrorNotice message={message} />
      <Button title="Back to sign in" onPress={() => router.replace("/sign-in")} />
    </> : <>
      <ActivityIndicator color={colors.blue} />
      <Text style={styles.muted}>Finishing sign-in…</Text>
    </>}
  </View>;
}
