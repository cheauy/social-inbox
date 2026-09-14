import { useState } from "react";
import { useRouter } from "expo-router";
import { Text, TextInput, View } from "react-native";
import { SettingsScreen } from "../../components/settings-screen";
import { Button, PlatformMark, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";

export default function TelegramConnect() {
  const router = useRouter();
  const { workspace, loadWorkspaces, permissions } = useInbox();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function connect() {
    if (!workspace || busy || !token.trim() || permissions.channels !== "manage") return;
    setBusy(true); setError("");
    try {
      await api("/api/telegram/connection", workspace.businessId, { method: "POST", body: { token: token.trim() } });
      setToken("");
      await loadWorkspaces();
      router.back();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to connect this bot."); }
    finally { setBusy(false); }
  }
  return <SettingsScreen title="Connect Telegram" detail="Connect your business bot to Tenh Chat." error={error}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><PlatformMark platform="telegram" size={40} /><Text style={styles.heading}>Telegram Bot</Text></View>
    {[["Create or choose a bot", "Open Telegram and message @BotFather. Send /newbot to create a bot, or /mybots to choose an existing bot."], ["Copy the Bot Token", "Copy the token from BotFather. Keep this token private."], ["Connect to Tenh Chat", "Paste the token below. Tenh Chat verifies the bot and enables incoming messages."]].map(([title, detail], index) => <View key={title} style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.pale }}><Text style={{ color: colors.blue, fontWeight: "700" }}>{index + 1}</Text></View>
      <View style={{ flex: 1, gap: 6 }}><Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>{title}</Text><Text style={{ color: colors.muted, lineHeight: 21 }}>{detail}</Text></View>
    </View>)}
    <Text style={{ color: colors.ink, fontWeight: "700" }}>Bot Token</Text>
    <TextInput accessibilityLabel="Bot Token" secureTextEntry value={token} onChangeText={setToken} placeholder="Paste your BotFather token" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} editable={!busy} style={styles.input} />
    <Button title="Connect bot" busy={busy} disabled={!token.trim() || busy || permissions.channels !== "manage"} onPress={() => void connect()} />
  </SettingsScreen>;
}
