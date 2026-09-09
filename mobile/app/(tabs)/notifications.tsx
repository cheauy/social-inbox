import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ChannelAvatar,
  Empty,
  colors,
  relativeTime,
  styles,
} from "../../components/ui";
import { useAuth } from "../../lib/auth/provider";
import { useInbox } from "../../lib/inbox-provider";

export default function Notifications() {
  const { session } = useAuth();
  const { workspace, conversations } = useInbox();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  const items = conversations
    .filter((conversation) => (conversation.unread_count ?? 0) > 0)
    .sort(
      (first, second) =>
        new Date(second.last_message_at ?? 0).getTime() -
        new Date(first.last_message_at ?? 0).getTime(),
    );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}> 
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.pale,
            }}
          >
            <Ionicons name="notifications" size={20} color={colors.blue} />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { fontSize: 24 }]}>Notifications</Text>
            <Text style={styles.muted} numberOfLines={1}>
              {workspace?.businessName ?? "Choose a workspace"}
            </Text>
          </View>

          {items.length > 0 ? (
            <View
              style={{
                minWidth: 30,
                paddingHorizontal: 9,
                paddingVertical: 5,
                borderRadius: 999,
                backgroundColor: colors.blue,
              }}
            >
              <Text
                style={{
                  color: "white",
                  fontSize: 12,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                {items.length > 99 ? "99+" : items.length}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {!workspace ? (
        <Empty
          icon="briefcase-outline"
          title="Choose a workspace"
          detail="Open Inbox and choose a workspace to see notifications."
        />
      ) : items.length === 0 ? (
        <Empty
          icon="notifications-outline"
          title="You're all caught up"
          detail="New unread customer conversations will appear here."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/conversation/[id]",
                  params: { id: item.id },
                })
              }
              style={({ pressed }) => ({
                flexDirection: "row",
                gap: 12,
                paddingHorizontal: 20,
                paddingVertical: 14,
                backgroundColor: pressed ? colors.pale : "white",
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              })}
            >
              <ChannelAvatar conversation={item} size={46} />

              <View style={{ flex: 1, gap: 4 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      flex: 1,
                      color: colors.ink,
                      fontSize: 15,
                      fontWeight: "800",
                    }}
                  >
                    {item.contact?.full_name ?? "Customer"}
                  </Text>

                  <Text style={{ color: colors.muted, fontSize: 12 }}>
                    {relativeTime(item.last_message_at)}
                  </Text>
                </View>

                <Text
                  numberOfLines={1}
                  style={{ color: colors.ink, fontSize: 14, fontWeight: "600" }}
                >
                  {item.last_message_text?.trim() || "New customer message"}
                </Text>

                <Text style={[styles.muted, { fontSize: 12 }]}> 
                  {item.unread_count} unread
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
