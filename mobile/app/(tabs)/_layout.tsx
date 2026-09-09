import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { View } from "react-native";

import { colors } from "../../components/ui";
import { useLanguage } from "../../lib/language-provider";
import { useInbox } from "../../lib/inbox-provider";

/*
 * A count on the Inbox tab, so unread work is visible from any tab.
 *
 * Drawn as a dot rather than a number past 99, because the tab bar has five
 * items on a phone and a four-digit badge pushes the labels around.
 */
function Dot() {
  return (
    <View
      style={{
        position: "absolute",
        top: -2,
        right: -10,
        minWidth: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.blue,
      }}
    />
  );
}

function InboxBadge() {
  const { conversations } = useInbox();

  const unread = conversations.reduce(
    (total, conversation) =>
      total + ((conversation.unread_count ?? 0) > 0 ? 1 : 0),
    0,
  );

  return unread === 0 ? null : <Dot />;
}

/*
 * The same dot on Group Chat. The server has already decided what counts --
 * unread in a room you follow, mentions only in one you have muted -- so the
 * tab just draws whatever total it sends.
 */
function RoomsBadge() {
  const { roomsBadge } = useInbox();

  return roomsBadge === 0 ? null : <Dot />;
}

function TabIcon({
  name,
  color,
  badge,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  // What Tabs hands the callback is a ColorValue, not a string, and Ionicons
  // takes the same union -- so borrow its type rather than narrowing.
  color: React.ComponentProps<typeof Ionicons>["color"];
  badge?: "inbox" | "rooms";
}) {
  return (
    <View>
      <Ionicons name={name} size={23} color={color} />
      {badge === "inbox" ? <InboxBadge /> : null}
      {badge === "rooms" ? <RoomsBadge /> : null}
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useLanguage();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: "white",
          borderTopColor: colors.border,
        },
        /*
         * Five labels have to fit across a phone, so they are small and the
         * icons carry most of the recognition. Labels stay rather than going
         * icon-only: "Notifications" and "Settings" are not guessable from an
         * icon alone.
         */
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("Inbox", "ប្រអប់សារ"),
          tabBarIcon: ({ color }) => (
            <TabIcon name="chatbubbles" color={color} badge="inbox" />
          ),
        }}
      />

      <Tabs.Screen
        name="group-chat"
        options={{
          title: t("Group Chat", "ឆាតក្រុម"),
          tabBarIcon: ({ color }) => (
            <TabIcon name="people" color={color} badge="rooms" />
          ),
        }}
      />

      <Tabs.Screen
        name="analytics"
        options={{
          title: t("Analytics", "ស្ថិតិ"),
          tabBarIcon: ({ color }) => (
            <TabIcon name="stats-chart" color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="notifications"
        options={{
          title: t("Notifications", "ការជូនដំណឹង"),
          tabBarIcon: ({ color }) => (
            <TabIcon name="notifications" color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: t("Settings", "ការកំណត់"),
          tabBarIcon: ({ color }) => (
            <TabIcon name="settings-sharp" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
