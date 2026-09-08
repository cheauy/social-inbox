import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { TabScreen, useWorkspaceResource } from "../../components/screen";
import { Empty, colors, styles } from "../../components/ui";

type Room = {
  id: string;
  name: string | null;
  is_general?: boolean;
  badge_count?: number;
  mention_count?: number;
  is_muted?: boolean;
  member_count?: number;
};

type Response = { rooms: Room[] };

export default function GroupChat() {
  const { data, loading, error, reload } =
    useWorkspaceResource<Response>("/api/team-chat/rooms");

  const rooms = data?.rooms ?? [];

  return (
    <TabScreen
      title="Group Chat"
      loading={loading}
      error={error}
      onRefresh={reload}
    >
      {rooms.length === 0 ? (
        <Empty
          icon="people-outline"
          title="No rooms yet"
          detail="Team rooms created on the web appear here."
        />
      ) : (
        rooms.map((room) => {
          const badge = room.badge_count ?? 0;
          const mentions = room.mention_count ?? 0;

          return (
            <View key={room.id} style={styles.card}>
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={styles.row}>
                    <Text style={styles.heading} numberOfLines={1}>
                      {room.name?.trim() || "General"}
                    </Text>

                    {room.is_muted ? (
                      <Ionicons
                        name="notifications-off"
                        size={14}
                        color={colors.muted}
                      />
                    ) : null}
                  </View>

                  <Text style={styles.muted}>
                    {room.member_count === undefined
                      ? "Team room"
                      : `${room.member_count} member${room.member_count === 1 ? "" : "s"}`}
                  </Text>
                </View>

                {/*
                  A mention is shown apart from the unread count because muting
                  a busy room still lets a direct @you through -- that is the
                  rule the server applies, and collapsing the two would hide it.
                */}
                {mentions > 0 ? (
                  <View
                    style={{
                      paddingHorizontal: 9,
                      paddingVertical: 3,
                      borderRadius: 999,
                      backgroundColor: "#B43232",
                    }}
                  >
                    <Text
                      style={{
                        color: "white",
                        fontSize: 11,
                        fontWeight: "800",
                      }}
                    >
                      @{mentions}
                    </Text>
                  </View>
                ) : null}

                {badge > 0 ? (
                  <View
                    style={{
                      minWidth: 24,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 999,
                      backgroundColor: colors.blue,
                    }}
                  >
                    <Text
                      style={{
                        color: "white",
                        fontSize: 11,
                        fontWeight: "800",
                        textAlign: "center",
                      }}
                    >
                      {badge > 99 ? "99+" : badge}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })
      )}

      {rooms.length > 0 ? (
        <Text style={[styles.muted, { fontSize: 12, paddingHorizontal: 2 }]}>
          Reading and posting in rooms is on the web for now. This shows what
          is waiting.
        </Text>
      ) : null}
    </TabScreen>
  );
}
