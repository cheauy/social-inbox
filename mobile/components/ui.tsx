import React from "react";
import { ActivityIndicator, Image, Keyboard, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { InboxConversation } from "../lib/types";

export const colors = { blue: "#0089CC", ink: "#102238", muted: "#6D7E91", border: "#E3EAF2", pale: "#EAF7FF", background: "#F6F8FC", red: "#B43232",
  /*
   * Pinned. Red read as an alert -- something wrong with the conversation --
   * when all it means is somebody put it at the top on purpose. Amber is the
   * bookmark colour everywhere in the app: the row, the panel button and the
   * thread header all take it from here so they cannot drift apart.
   */
  pin: "#E8A317", pinWash: "#FFF6E0" };
export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export function IconButton({ icon, label, onPress, disabled = false, badge = 0 }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; badge?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.icon, { opacity: disabled ? 0.35 : pressed ? 0.55 : 1 }]}>
      <Ionicons name={icon} size={23} color={colors.blue} />

      {/*
        A count on the corner of the icon. Whether a customer is tagged at all
        is the thing an agent wants at a glance, and the tags themselves are a
        panel away -- so the button carries the number rather than making them
        open it to find out there are none.
      */}
      {badge > 0 ? (
        <View style={{ position: "absolute", top: 4, right: 2, minWidth: 16, height: 16, paddingHorizontal: 4, borderRadius: 8, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "white" }}>
          <Text style={{ color: "white", fontSize: 9.5, fontWeight: "800" }}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/*
 * The same tag chip used by the website: assigned tags are filled with their
 * colour and carry a white check, while available tags are outlined.
 *
 * A filled chip's label and dot are white, full stop. They used to be derived
 * from the fill for contrast, which put white on a green Buy and near-black
 * on the orange COD beside it -- one row of tags reading as two different
 * kinds of thing.
 */
export function TagChip({
  name,
  color,
  selected = true,
  compact = false,
  showCheck = true,
}: {
  name: string;
  color?: string | null;
  selected?: boolean;
  compact?: boolean;
  showCheck?: boolean;
}) {
  const tone = color || colors.blue;

  return (
    <View
      style={{
        maxWidth: compact ? 94 : 190,
        minHeight: compact ? 22 : 34,
        flexDirection: "row",
        alignItems: "center",
        gap: compact ? 4 : 6,
        paddingHorizontal: compact ? 8 : 11,
        paddingVertical: compact ? 2 : 6,
        borderRadius: compact ? 999 : 12,
        borderWidth: selected ? 0 : 2,
        borderColor: tone,
        backgroundColor: selected ? tone : "white",
      }}
    >
      {/*
        The dot, on both states. On a filled chip it is white: a small bright
        mark at the head of the label that says where one tag ends and the
        next begins, which a row of three touching pills badly needed.
      */}
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: selected ? "white" : tone,
        }}
      />

      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          color: selected ? "white" : colors.ink,
          fontSize: compact ? 11 : 12.5,
          fontWeight: "700",
        }}
      >
        {name}
      </Text>

      {selected && showCheck ? (
        <View
          style={{
            width: compact ? 14 : 17,
            height: compact ? 14 : 17,
            borderRadius: 9,
            backgroundColor: "white",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name="checkmark"
            size={compact ? 11 : 13}
            color={tone}
          />
        </View>
      ) : null}
    </View>
  );
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
 * The mark on its own, at whatever size is asked for.
 *
 * The same files the avatar badge wears, so a channel is the same picture
 * wherever it is named -- the picker, the header button, the row.
 */
export function PlatformMark({ platform, size = 22 }: { platform: Platform; size?: number }) {
  const mark = PLATFORM_MARK[platform];
  return mark.logo ? (
    <Image source={mark.logo} style={{ width: size, height: size, borderRadius: size / 2 }} resizeMode="cover" />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: mark.tint, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={mark.icon} size={Math.round(size * 0.62)} color="white" />
    </View>
  );
}
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
  // Keep the platform mark small and overlap the avatar edge, matching the
  // compact Messenger treatment used by the web Inbox.
  const badge = Math.max(16, Math.round(size * 0.36));
  return (
    <View style={{ width: size, height: size }}>
      <Avatar name={conversation.contact?.full_name} uri={conversation.contact?.profile_picture_url} size={size} />
      <View style={{ position: "absolute", right: -1, bottom: -1, width: badge, height: badge, borderRadius: badge / 2, backgroundColor: mark.logo ? "white" : mark.tint, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "white" }}>
        {mark.logo ? (
          <Image source={mark.logo} style={{ width: badge - 2, height: badge - 2 }} resizeMode="contain" />
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
/*
 * A bottom sheet: dimmed backdrop, rounded card, title and detail.
 *
 * Every panel the phone has room for arrives this way -- channels, filters,
 * quick replies, tags, the customer -- so the shell lives here and each one
 * only writes its own contents.
 */
export function Sheet({ open, title, detail, onClose, children, floating = false, fullHeight = false }: { open: boolean; title: string; detail: string; onClose: () => void; children: React.ReactNode; floating?: boolean; fullHeight?: boolean }) {
  const insets = useSafeAreaInsets();

  /*
   * The keyboard stays down, both while this is open and after it closes.
   *
   * Android hands focus back to whatever held it before a modal appeared. On
   * the Inbox that is the search box, so choosing a filter -- a tap that has
   * nothing to do with typing -- closed the sheet and then threw the keyboard
   * up over the list somebody had just filtered, looking for all the world
   * like the app had decided to search on their behalf.
   *
   * Dismissed twice on the way out because the focus is restored a frame or
   * two after the modal goes: one call lands before that and does nothing.
   */
  React.useEffect(() => {
    if (open) {
      Keyboard.dismiss();
      return;
    }

    const frame = requestAnimationFrame(() => Keyboard.dismiss());
    const later = setTimeout(() => Keyboard.dismiss(), 180);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
    };
  }, [open]);

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel={`Close ${title.toLowerCase()}`} onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(16,34,56,0.35)" }} />

      <View
        style={{
          backgroundColor: "white",
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          borderBottomLeftRadius: floating ? 20 : 0,
          borderBottomRightRadius: floating ? 20 : 0,
          marginHorizontal: floating ? 10 : 0,
          marginBottom: floating ? Math.max(insets.bottom, 10) : 0,
          paddingBottom: floating ? 10 : Math.max(insets.bottom, 28),
          height: fullHeight ? "94%" : undefined,
          maxHeight: fullHeight ? "94%" : floating ? "76%" : "82%",
          overflow: "hidden",
        }}
      >
        {floating ? (
          <View
            style={{
              alignSelf: "center",
              width: 38,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
              marginTop: 8,
            }}
          />
        ) : null}

        <View style={{ padding: 18, paddingBottom: 8 }}>
          <Text style={styles.heading}>{title}</Text>
          <Text style={styles.muted}>{detail}</Text>
        </View>

        {children}
      </View>
    </Modal>
  );
}
export function Empty({ title, detail, icon = "chatbubbles-outline" }: { title: string; detail: string; icon?: IconName }) {
  return <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name={icon} size={34} color={colors.blue} /></View><Text style={styles.heading}>{title}</Text><Text style={[styles.muted, { textAlign: "center", lineHeight: 22 }]}>{detail}</Text></View>;
}
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) { return message ? <View accessibilityRole="alert" style={styles.error}><Text style={{ color: colors.red, flex: 1, lineHeight: 20 }}>{message}</Text>{onRetry && <Pressable accessibilityRole="button" onPress={onRetry} style={{ padding: 8 }}><Text style={{ color: colors.red, fontWeight: "700" }}>Retry</Text></Pressable>}</View> : null; }
export const relativeTime = (value?: string | null) => {
  if (!value) return "";

  const date = new Date(value);
  const timestamp = date.getTime();

  if (!Number.isFinite(timestamp)) return "";

  const elapsed = Math.max(0, Date.now() - timestamp);
  const seconds = Math.floor(elapsed / 1000);

  if (seconds < 60) return "Now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};
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
