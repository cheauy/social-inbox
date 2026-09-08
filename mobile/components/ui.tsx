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

/*
 * Which platform mark a row wears. Kept beside `channel` above so the badge
 * and the label can never disagree about what a conversation is.
 */
export type Platform = "telegram" | "comment" | "messenger";
export const platformOf = (c: InboxConversation): Platform =>
  c.social_account?.platform === "telegram" ? "telegram" : c.source_type === "comment" ? "comment" : "messenger";
/*
 * The real Messenger and Telegram marks, the same ones the website uses,
 * downscaled from 1254px to 96px -- at the size this badge draws them the
 * originals were 788KB each of detail nobody can see.
 *
 * Facebook comments keep the glyph: there is no facebook.png in the web
 * assets either, where that mark is drawn inline as SVG.
 */
const PLATFORM_MARK: Record<
  Platform,
  { logo?: number; icon?: IconName; tint: string }
> = {
  telegram: { logo: require("../assets/channels/telegram.png"), tint: "#2AABEE" },
  messenger: { logo: require("../assets/channels/messenger.png"), tint: "#0084FF" },
  comment: { icon: "logo-facebook", tint: "#1877F2" },
};

/*
 * An avatar wearing the channel it arrived on.
 *
 * The list mixes Messenger, Facebook comments and Telegram, and the row's own
 * text does not say which until you read the label -- so the mark rides on the
 * avatar where the eye already is. Ringed in white so it stays legible against
 * a photo as well as against the initial's flat background.
 */
export function ChannelAvatar({ conversation, size = 48 }: { conversation: InboxConversation; size?: number }) {
  const mark = PLATFORM_MARK[platformOf(conversation)];
  const badge = Math.round(size * 0.42);
  return (
    <View>
      <Avatar name={conversation.contact?.full_name} uri={conversation.contact?.profile_picture_url} size={size} />
      <View style={{ position: "absolute", right: -1, bottom: -1, width: badge, height: badge, borderRadius: badge / 2, backgroundColor: mark.logo ? "white" : mark.tint, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "white", overflow: "hidden" }}>
        {mark.logo ? (
          <Image source={mark.logo} style={{ width: badge, height: badge }} resizeMode="cover" />
        ) : (
          <Ionicons name={mark.icon} size={badge * 0.58} color="white" />
        )}
      </View>
    </View>
  );
}
/*
 * The channel in words, with no mark of its own.
 *
 * It had one, and in a list row that put the same symbol twice on the same
 * line -- once on the avatar and again beside the label a few pixels away.
 * The avatar carries the picture; this carries the name.
 */
export function ChannelBadge({ conversation }: { conversation: InboxConversation }) {
  return <Text style={{ fontSize: 11, color: colors.muted }}>{channel(conversation)}</Text>;
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
