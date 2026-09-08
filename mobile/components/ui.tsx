import React from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { InboxConversation } from "../lib/types";

export const colors = { blue: "#0089CC", ink: "#102238", muted: "#6D7E91", border: "#E3EAF2", pale: "#EAF7FF", background: "#F6F8FC", red: "#B43232" };
export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export function IconButton({ icon, label, onPress, disabled = false }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.icon, { opacity: disabled ? 0.35 : pressed ? 0.55 : 1 }]}><Ionicons name={icon} size={23} color={colors.blue} /></Pressable>;
}
export function Button({ title, onPress, busy = false, secondary = false, disabled = false }: { title: string; onPress: () => void; busy?: boolean; secondary?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, secondary && { backgroundColor: colors.pale }, { opacity: disabled || pressed ? 0.55 : 1 }]}>{busy ? <ActivityIndicator color={secondary ? colors.blue : "white"} /> : <Text style={{ fontWeight: "700", color: secondary ? colors.blue : "white", fontSize: 16 }}>{title}</Text>}</Pressable>;
}
export function Avatar({ name, uri, size = 48 }: { name?: string | null; uri?: string | null; size?: number }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [uri]);
  return uri && !failed ? <Image source={{ uri }} onError={() => setFailed(true)} style={{ width: size, height: size, borderRadius: size / 2 }} /> : <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.pale, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.blue, fontWeight: "700", fontSize: size * 0.36 }}>{Array.from(name?.trim() || "?")[0]}</Text></View>;
}
export const channel = (c: InboxConversation) => c.social_account?.platform === "telegram" ? "Telegram" : c.source_type === "comment" ? "Facebook Comments" : "Messenger";
export function ChannelBadge({ conversation }: { conversation: InboxConversation }) {
  const label = channel(conversation);
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Ionicons name={label === "Telegram" ? "paper-plane" : label === "Messenger" ? "chatbubble-ellipses" : "logo-facebook"} size={12} color={colors.blue} /><Text style={{ fontSize: 11, color: colors.muted }}>{label}</Text></View>;
}
export function Empty({ title, detail, icon = "chatbubbles-outline" }: { title: string; detail: string; icon?: IconName }) {
  return <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name={icon} size={34} color={colors.blue} /></View><Text style={styles.heading}>{title}</Text><Text style={[styles.muted, { textAlign: "center", lineHeight: 22 }]}>{detail}</Text></View>;
}
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) { return message ? <View accessibilityRole="alert" style={styles.error}><Text style={{ color: colors.red, flex: 1, lineHeight: 20 }}>{message}</Text>{onRetry && <Pressable accessibilityRole="button" onPress={onRetry} style={{ padding: 8 }}><Text style={{ color: colors.red, fontWeight: "700" }}>Retry</Text></Pressable>}</View> : null; }
export const time = (value?: string | null) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: "white", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.ink, fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  heading: { color: colors.ink, fontSize: 18, fontWeight: "700" },
  muted: { color: colors.muted, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  card: { backgroundColor: "white", borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 18 },
  input: { backgroundColor: "white", borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: colors.ink, fontSize: 16 },
  button: { minHeight: 50, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: colors.blue, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  icon: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  empty: { paddingHorizontal: 32, paddingVertical: 60, alignItems: "center", gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.pale, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  error: { backgroundColor: "#FFF1EF", padding: 12, margin: 12, borderRadius: 12, flexDirection: "row", alignItems: "center" },
});
