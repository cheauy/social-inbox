import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { MessengerSource } from "../../lib/facebook/messenger-source";
import { AuthImage } from "./auth-image";
import { colors } from "./ui";

export function MessengerSourceCard({ source, onOpenImage, onOpenPost }: { source: MessengerSource; onOpenImage: (url: string) => void; onOpenPost: (url: string) => void }) {
  const [ratio, setRatio] = useState(1);
  return <View style={{ width: "60%", alignSelf: "flex-start", marginHorizontal: 14, marginVertical: 8, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: "white" }}>
    <Text style={{ color: colors.blue, fontWeight: "700", marginBottom: 10 }}>{source.kind === "ad" ? "Message from an ad" : "Message from a post"}</Text>
    {source.image_url ? <Pressable accessibilityRole="button" accessibilityLabel="View source photo" onPress={() => onOpenImage(source.image_url!)}>
      <AuthImage key={source.image_url} uri={source.image_url} resizeMode="contain" onLoad={({ width, height }) => { if (width > 0 && height > 0) setRatio(Math.max(0.5, Math.min(2, width / height))); }} style={{ width: "100%", aspectRatio: ratio / 0.6, borderRadius: 10 }} />
    </Pressable> : null}
    {source.title ? <Text numberOfLines={3} style={{ color: colors.ink, marginVertical: 8 }}>{source.title}</Text> : null}
    {source.post_id ? <Text selectable style={{ color: colors.muted, fontSize: 12 }}>Post ID: {source.post_id}</Text> : null}
    {source.ad_id ? <Text selectable style={{ color: colors.muted, fontSize: 12 }}>Ad ID: {source.ad_id}</Text> : null}
    {source.post_url ? <Pressable accessibilityRole="link" onPress={() => onOpenPost(source.post_url!)} style={{ paddingVertical: 10 }}><Text style={{ color: colors.blue }}>View post ↗</Text></Pressable> : null}
  </View>;
}
