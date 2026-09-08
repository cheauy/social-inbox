import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { View } from "react-native";

import { colors } from "../../components/ui";
import { useInbox } from "../../lib/inbox-provider";

/*
 * A count on the Inbox tab, so unread work is visible from any tab.
 *
 * Drawn as a dot rather than a number past 99, because the tab bar has five
 * items on a phone and a four-digit badge pushes the labels around.
 */
function InboxBadge() {
  const { conversations } = useInbox();

  const unread = conversations.reduce(
    (total, conversation) =>
      total + ((conversation.unread_count ?? 0) > 0 ? 1 : 0),
    0,
  );

  if (unread === 0) {
    return null;
  }

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

function TabIcon({
  name,
  color,
  badge = false,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  // What Tabs hands the callback is a ColorValue, not a string, and Ionicons
  // takes the same union -- so borrow its type rather than narrowing.
  color: React.ComponentProps<typeof Ionicons>["color"];
  badge?: boolean;
}) {
  return (
    <View>
      <Ionicons name={name} size={23} color={color} />
      {badge ? <InboxBadge /> : null}
    </View>
  );
}

export default function TabsLayout() {
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
         * icon-only: "Subscription" and "Settings" are not guessable from an
         * icon alone.
         */
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Inbox",
          tabBarIcon: ({ color }) => (
            <TabIcon name="chatbubbles" color={color} badge />
          ),
        }}
      />

      <Tabs.Screen
        name="group-chat"
        options={{
          title: "Group Chat",
          tabBarIcon: ({ color }) => (
            <TabIcon name="people" color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="analytics"
        options={{
          title: "Analytics",
          tabBarIcon: ({ color }) => (
            <TabIcon name="stats-chart" color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="subscription"
        options={{
          title: "Subscription",
          tabBarIcon: ({ color }) => (
            <TabIcon name="card" color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <TabIcon name="settings-sharp" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
