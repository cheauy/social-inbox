import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  Empty,
  ErrorNotice,
  IconButton,
  colors,
  styles,
} from "../../../components/ui";
import { api } from "../../../lib/api/client";
import { useInbox } from "../../../lib/inbox-provider";

/*
 * What a group is, and who is in it.
 *
 * The web keeps this in a details rail beside the thread. A phone has no room
 * beside anything, so it is a screen you reach by tapping the group's name --
 * which is where people press when they want to know who can read this.
 *
 * Everything here is the server's to allow: only an owner or admin can change
 * membership or delete a group, and General cannot be changed at all. The
 * screen offers what the caller can actually do rather than showing controls
 * that come back refused.
 */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          paddingLeft: 4,
          fontSize: 11,
          fontWeight: "800",
          letterSpacing: 0.7,
          textTransform: "uppercase",
          color: colors.muted,
        }}
      >
        {title}
      </Text>

      <View
        style={{
          backgroundColor: "white",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

export default function RoomDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { workspace, rooms, roster, canManageRooms, refreshRooms } = useInbox();

  const room = useMemo(
    () => rooms.find((item) => item.id === id) ?? null,
    [rooms, id],
  );

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const memberIds = useMemo(
    () => new Set(room?.member_ids ?? []),
    [room?.member_ids],
  );

  /*
   * General has everybody in it by definition and the server rejects any
   * attempt to change that, so it is read-only here too.
   */
  const editable = canManageRooms && Boolean(room) && !room?.is_general;

  async function setMembers(nextIds: string[]) {
    if (!id || !workspace || busy) {
      return;
    }

    setBusy("members");
    setError("");

    try {
      await api(
        `/api/team-chat/rooms/${encodeURIComponent(id)}/members`,
        workspace.businessId,
        { method: "PUT", body: { memberIds: nextIds } },
      );

      await refreshRooms();
    } catch (memberError) {
      setError(
        memberError instanceof Error
          ? memberError.message
          : "Unable to change who is in this group.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function toggleMute() {
    if (!id || !workspace || busy || !room) {
      return;
    }

    setBusy("mute");
    setError("");

    try {
      await api(
        `/api/team-chat/rooms/${encodeURIComponent(id)}/mute`,
        workspace.businessId,
        { method: "PATCH", body: { muted: !room.is_muted } },
      );

      await refreshRooms();
    } catch (muteError) {
      setError(
        muteError instanceof Error
          ? muteError.message
          : "Unable to change notifications for this group.",
      );
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert(
      `Delete ${room?.name?.trim() || "this group"}?`,
      "Every message in it goes with it, for everybody. This cannot be undone.",
      [
        { text: "Keep it", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void remove() },
      ],
    );
  }

  async function remove() {
    if (!id || !workspace) {
      return;
    }

    setBusy("delete");
    setError("");

    try {
      await api(
        `/api/team-chat/rooms/${encodeURIComponent(id)}`,
        workspace.businessId,
        { method: "DELETE" },
      );

      await refreshRooms();

      // Back past the room itself, which no longer exists.
      router.dismissAll?.();
      router.replace("/(tabs)/group-chat");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete this group.",
      );

      setBusy(null);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.row}>
          <IconButton
            icon="chevron-back"
            label="Back to the group"
            onPress={() => router.back()}
          />

          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.heading}>
              {room?.name?.trim() || "Group"}
            </Text>
            <Text style={[styles.muted, { fontSize: 12.5 }]}>
              Group details
            </Text>
          </View>
        </View>
      </View>

      <ErrorNotice message={error} onRetry={() => void refreshRooms()} />

      {!room ? (
        <Empty
          icon="people-outline"
          title="Group not found"
          detail="It may have been deleted, or you may no longer be a member."
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
          <View
            style={{
              alignItems: "center",
              gap: 8,
              paddingVertical: 18,
              backgroundColor: "white",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View
              style={{
                width: 62,
                height: 62,
                borderRadius: 20,
                backgroundColor: colors.pale,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="people" size={30} color={colors.blue} />
            </View>

            <Text style={[styles.heading, { fontSize: 20 }]}>
              {room.name?.trim() || "General"}
            </Text>

            <Text
              style={[
                styles.muted,
                { textAlign: "center", paddingHorizontal: 24, lineHeight: 20 },
              ]}
            >
              {room.description?.trim() ||
                (room.is_general
                  ? "Everybody in this workspace."
                  : "No description.")}
            </Text>

            <Text style={[styles.muted, { fontSize: 12.5 }]}>
              {room.member_count} member{room.member_count === 1 ? "" : "s"}
            </Text>
          </View>

          <Section title="Notifications">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: room.is_muted }}
              disabled={busy === "mute"}
              onPress={() => void toggleMute()}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 14,
                backgroundColor: pressed ? colors.pale : "transparent",
              })}
            >
              <Ionicons
                name={room.is_muted ? "notifications-off" : "notifications"}
                size={19}
                color={room.is_muted ? colors.muted : colors.blue}
              />

              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}>
                  {room.is_muted ? "Muted" : "Notifications on"}
                </Text>
                <Text style={[styles.muted, { fontSize: 12.5 }]}>
                  A direct mention still comes through either way.
                </Text>
              </View>

              {busy === "mute" ? <ActivityIndicator color={colors.blue} /> : null}
            </Pressable>
          </Section>

          <Section title={editable ? "Members — tap to add or remove" : "Members"}>
            {roster.map((member, index) => {
              const inRoom = room.is_general || memberIds.has(member.id);

              return (
                <Pressable
                  key={member.id}
                  accessibilityRole={editable ? "button" : "text"}
                  accessibilityState={{ selected: inRoom }}
                  disabled={!editable || busy === "members"}
                  onPress={() =>
                    void setMembers(
                      inRoom
                        ? [...memberIds].filter((one) => one !== member.id)
                        : [...memberIds, member.id],
                    )
                  }
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colors.border,
                    backgroundColor:
                      pressed && editable ? colors.pale : "transparent",
                    opacity: inRoom ? 1 : 0.55,
                  })}
                >
                  <Avatar
                    name={member.full_name}
                    uri={member.profile_picture_url}
                    size={38}
                  />

                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.ink,
                        fontSize: 15,
                        fontWeight: "600",
                      }}
                    >
                      {member.full_name || member.email}
                    </Text>
                    <Text style={[styles.muted, { fontSize: 12 }]}>
                      {member.role}
                    </Text>
                  </View>

                  {inRoom ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color={colors.blue}
                    />
                  ) : editable ? (
                    <Ionicons
                      name="add-circle-outline"
                      size={20}
                      color={colors.muted}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </Section>

          {editable ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy === "delete"}
              onPress={confirmDelete}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 15,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.red,
                backgroundColor: pressed ? "#FFF1EF" : "white",
              })}
            >
              {busy === "delete" ? (
                <ActivityIndicator color={colors.red} />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                  <Text
                    style={{ color: colors.red, fontSize: 15, fontWeight: "700" }}
                  >
                    Delete this group
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
