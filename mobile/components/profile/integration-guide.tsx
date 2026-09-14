import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { IconName, PlatformMark, Sheet, colors } from "../ui";

const guides = [
  { name: "Messenger / Facebook Page", platform: "messenger", steps: [["Connect Facebook Page", "Open Add Connection and choose Messenger."], ["Authorize with Facebook", "Grant access to the Pages, messages and comments you choose."], ["Select Pages", "Choose the Facebook Pages for this workspace."], ["Sync messages and comments", "Return to Tenh Chat to see the connected Pages in your Inbox."]] },
  { name: "Telegram Bot", platform: "telegram", steps: [["Create or choose a Telegram bot", "Create a bot in @BotFather or use your business bot."], ["Copy the Bot Token", "Copy the private token from BotFather. Keep it private."], ["Paste the token into Tenh Chat", "Choose Telegram in Add Connection, paste the token and connect."], ["Activate Inbox", "Tenh Chat verifies the bot and enables incoming messages."]] },
  ...["Instagram", "WhatsApp", "TikTok"].map(name => ({ name, platform: "soon", steps: [["Coming soon", "This channel is planned. Connections are not available yet."]] })),
];
export function IntegrationGuide({ onClose }: { onClose: () => void }) {
  const [width, setWidth] = useState(300);
  const [page, setPage] = useState(0);
  const pager = useRef<ScrollView>(null);
  const go = (index: number) => { setPage(index); pager.current?.scrollTo({ x: index * width, animated: true }); };
  return <Sheet open floating heightPercent={80} title="Connection details" detail="Swipe to learn how to connect each channel." onClose={onClose}>
    <View style={{ flex: 1 }} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={event => setPage(Math.min(guides.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)))}>
        {guides.map(guide => <ScrollView key={guide.name} style={{ width }} contentContainerStyle={{ padding: 18, gap: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {guide.platform === "soon" ? <Ionicons name={({ Instagram: "logo-instagram", WhatsApp: "logo-whatsapp", TikTok: "logo-tiktok" } as Record<string, IconName>)[guide.name]} size={28} color={colors.blue} /> : <PlatformMark platform={guide.platform as "messenger" | "telegram"} size={30} />}
            <Text style={{ fontSize: 18, color: colors.ink, fontWeight: "700", flex: 1 }}>{guide.name}</Text>
          </View>
          {guide.steps.map(([title, detail], index) => <View key={title} style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.pale, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.blue, fontWeight: "700" }}>{index + 1}</Text></View>
            <View style={{ flex: 1, gap: 6 }}><Text style={{ color: colors.ink, fontWeight: "700", fontSize: 15 }}>{title}</Text><Text style={{ color: colors.muted, lineHeight: 21 }}>{detail}</Text></View>
          </View>)}
        </ScrollView>)}
      </ScrollView>
    </View>
    <View style={{ padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Pressable disabled={page === 0} onPress={() => go(page - 1)} style={{ padding: 8, opacity: page === 0 ? 0.3 : 1 }}><Text style={{ color: colors.blue }}>Back</Text></Pressable>
      <Text style={{ color: colors.muted }}>{page + 1} / {guides.length}</Text>
      <Pressable onPress={() => page === guides.length - 1 ? onClose() : go(page + 1)} style={{ padding: 8 }}><Text style={{ color: colors.blue, fontWeight: "700" }}>{page === guides.length - 1 ? "Done" : "Next"}</Text></Pressable>
    </View>
  </Sheet>;
}
