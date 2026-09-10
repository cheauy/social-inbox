import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Empty, ErrorNotice, Sheet, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import type { Member, TeamRoom } from "../../lib/types";
import { TEAM_ROOM_ICON_OPTIONS, TeamRoomIcon, type TeamRoomIconKey } from "../../components/team-room-icon";

/*
 * The rooms this workspace has, and a way to make another.
 *
 * The list comes from the provider rather than a fetch of its own: the tab
 * bar draws a badge from the same numbers and a room's header reads its name
 * and description out of it, so three screens would otherwise each be asking
 * the server the same question at different moments and disagreeing.
 */

function Badge({ count, mention }: { count: number; mention: boolean }) {
  if (count <= 0) {
    return null;
  }

  return (
    <View
      style={{
        minWidth: 24,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: mention ? colors.red : colors.blue,
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
        {count > 99 ? "99+" : count}
      </Text>
    </View>
  );
}

/*
 * Creating a group, which only an owner or an admin can do -- the server
 * refuses anyone else, so the button is not offered to them either.
 *
 * Members are picked here because a group with nobody in it is not a group,
 * and the web asks the same question at the same moment. The creator is
 * always in it; the server adds them whether or not they tick themselves.
 */
function CreateGroupSheet({
  open,
  roster,
  busy,
  onCreate,
  onClose,
}: {
  open: boolean;
  roster: Member[];
  busy: boolean;
  onCreate: (name: string, description: string, memberIds: string[], icon: TeamRoomIconKey) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [icon, setIcon] = useState<TeamRoomIconKey>("people");

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setPicked(new Set());
      setIcon("people");
    }
  }, [open]);

  return (
    <Sheet
      open={open}
      title="New group"
      detail="Everyone you add can read it from the beginning."
      onClose={onClose}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 18, gap: 12 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Group name"
            placeholderTextColor={colors.muted}
            maxLength={80}
            editable={!busy}
            style={styles.input}
          />

          <View style={{ gap: 9 }}>
            <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "700" }}>Group icon</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9 }}>
              {TEAM_ROOM_ICON_OPTIONS.map((option) => {
                const selected = icon === option.key;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected }}
                    onPress={() => setIcon(option.key)}
                    style={{ width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: selected ? colors.blue : colors.border, backgroundColor: selected ? colors.pale : "white" }}
                  >
                    <Ionicons name={option.icon} size={21} color={selected ? colors.blue : colors.muted} />
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="What is it for? (optional)"
            placeholderTextColor={colors.muted}
            maxLength={200}
            editable={!busy}
            style={styles.input}
          />
        </View>

        <Text
          style={{
            paddingHorizontal: 18,
            paddingTop: 18,
            paddingBottom: 4,
            fontSize: 11,
            fontWeight: "800",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: colors.muted,
          }}
        >
          Members
        </Text>

        {roster.map((member) => {
          const on = picked.has(member.id);

          return (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              disabled={busy}
              onPress={() =>
                setPicked((current) => {
                  const next = new Set(current);
                  if (on) next.delete(member.id);
                  else next.add(member.id);
                  return next;
                })
              }
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 18,
                paddingVertical: 12,
                backgroundColor: pressed ? colors.pale : "transparent",
              })}
            >
              <Ionicons
                name={on ? "checkbox" : "square-outline"}
                size={20}
                color={on ? colors.blue : colors.muted}
              />

              <View style={{ flex: 1 }}>
                <Text
                  style={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}
                >
                  {member.full_name || member.email}
                </Text>
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  {member.role}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View
        style={{
          padding: 16,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Pressable
          accessibilityRole="button"
          disabled={busy || name.trim().length === 0}
          onPress={() => onCreate(name.trim(), description.trim(), [...picked], icon)}
          style={({ pressed }) => [
            styles.button,
            {
              opacity:
                busy || name.trim().length === 0 ? 0.4 : pressed ? 0.8 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
              Create group
            </Text>
          )}
        </Pressable>
      </View>
    </Sheet>
  );
}

export default function GroupChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { workspace, rooms, roomsLoading, roomsBadge, roster, canManageRooms, refreshRooms } =
    useInbox();

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  async function create(
    name: string,
    description: string,
    memberIds: string[],
    icon: TeamRoomIconKey,
  ) {
    if (!workspace) {
      return;
    }

    setCreating(true);
    setError("");

    try {
      const data = await api<{ room: TeamRoom }>(
        "/api/team-chat/rooms",
        workspace.businessId,
        { method: "POST", body: { name, description, memberIds, icon } },
      );

      await refreshRooms();
      setCreateOpen(false);

      /*
       * Straight into it. Somebody who has just named a group and chosen who
       * is in it has something to say to them.
       */
      if (data.room?.id) {
        router.push({
          pathname: "/room/[id]",
          params: { id: data.room.id, name: data.room.name ?? "" },
        });
      }
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create that group.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Text style={styles.title}>Group Chat</Text>

              {/*
                The same total the tab bar draws, said in full here where
                there is room for a number.
              */}
              <Badge count={roomsBadge} mention={false} />
            </View>

            <Text style={styles.muted} numberOfLines={1}>
              {workspace?.businessName ?? "No workspace selected"}
            </Text>
          </View>

          {canManageRooms ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create a group"
              onPress={() => setCreateOpen(true)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 999,
                backgroundColor: pressed ? "#0072AB" : colors.blue,
              })}
            >
              <Ionicons name="add" size={17} color="white" />

              <Text
                style={{ color: "white", fontSize: 13, fontWeight: "700" }}
              >
                Create
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <ErrorNotice message={error} onRetry={() => void refreshRooms()} />

      {!workspace ? (
        <Empty
          icon="briefcase-outline"
          title="Choose a workspace"
          detail="Open the Inbox tab and pick a workspace. Everything else is scoped to it."
        />
      ) : roomsLoading ? (
        <View style={{ padding: 16, gap: 12 }} accessibilityLabel="Loading groups">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <View key={item} style={{ height: 78, borderRadius: 18, backgroundColor: item % 2 ? "#EDF2F7" : "#E7EEF6", opacity: 0.75 }} />
          ))}
        </View>
      ) : rooms.length === 0 ? (
        <Empty
          icon="people-outline"
          title="No rooms yet"
          detail={
            canManageRooms
              ? "Create one and add the people who need it."
              : "Team rooms an owner adds you to appear here."
          }
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, gap: 9 }}>
          {rooms.map((room) => (
            <Pressable
              key={room.id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${room.name?.trim() || "General"}`}
              onPress={() =>
                router.push({
                  pathname: "/room/[id]",
                  params: {
                    id: room.id,
                    name: room.name ?? "",
                    muted: room.is_muted ? "1" : "0",
                  },
                })
              }
              style={({ pressed }) => [
                styles.card,
                { opacity: pressed ? 0.72 : 1, borderRadius: 18, padding: 13, borderColor: room.badge_count > 0 ? "#B7DCF3" : colors.border, backgroundColor: room.badge_count > 0 ? "#F0F9FF" : "white" },
              ]}
            >
              <View style={styles.row}>
                <TeamRoomIcon icon={room.icon} size={48} />
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

                  <Text style={styles.muted} numberOfLines={1}>
                    {room.description?.trim() || "Internal team conversation"}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {room.member_count} member{room.member_count === 1 ? "" : "s"}
                  </Text>
                </View>

                {/*
                  A mention is shown apart from the unread count because
                  muting a busy room still lets a direct @you through -- that
                  is the rule the server applies, and collapsing the two would
                  hide it.
                */}
                {room.mention_count > 0 ? (
                  <Badge count={room.mention_count} mention />
                ) : null}

                <Badge count={room.badge_count} mention={false} />

                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.muted}
                />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <CreateGroupSheet
        open={createOpen}
        roster={roster}
        busy={creating}
        onCreate={(name, description, memberIds, icon) =>
          void create(name, description, memberIds, icon)
        }
        onClose={() => setCreateOpen(false)}
      />
    </View>
  );
}
