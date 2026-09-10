import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  Empty,
  ErrorNotice,
  IconName,
  Sheet,
  colors,
  relativeTime,
  styles,
} from "../../components/ui";
import { SwipeRow } from "../../components/swipe-row";
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
/*
 * A room's actions, held rather than dragged, and drawn where the finger is.
 *
 * The same card the Inbox opens on a message: two gestures for the same two
 * actions, because both are taught -- Messenger holds, Mail swipes -- and
 * somebody who reaches for one should not have to discover the other.
 */
const ROOM_MENU_WIDTH = 190;

function RoomMenu({
  held,
  onClose,
  onAction,
}: {
  held: { room: TeamRoom; at: { x: number; y: number } } | null;
  onClose: () => void;
  onAction: (room: TeamRoom, action: "mute" | "delete") => void;
}) {
  const screen = Dimensions.get("window");

  if (!held) return null;

  const { room, at } = held;

  const rows: { icon: IconName; label: string; tone?: string; run: () => void }[] =
    [
      {
        icon: room.is_muted
          ? "notifications-outline"
          : "notifications-off-outline",
        label: room.is_muted ? "Unmute" : "Mute",
        run: () => onAction(room, "mute"),
      },
    ];

  if (!room.is_general) {
    rows.push({
      icon: "trash-outline",
      label: "Delete",
      tone: colors.red,
      run: () => onAction(room, "delete"),
    });
  }

  const height = rows.length * 46 + 10;
  const below = at.y + 12;
  const top =
    below + height > screen.height - 24
      ? Math.max(24, at.y - height - 12)
      : below;

  const left = Math.min(
    Math.max(10, at.x - ROOM_MENU_WIDTH / 2),
    screen.width - ROOM_MENU_WIDTH - 10,
  );

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityLabel="Close room actions"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(16,34,56,0.18)" }}
      />

      <View
        style={{
          position: "absolute",
          top,
          left,
          width: ROOM_MENU_WIDTH,
          paddingVertical: 5,
          borderRadius: 16,
          backgroundColor: "white",
          elevation: 14,
          shadowColor: "#102238",
          shadowOpacity: 0.24,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        {rows.map((row, index) => (
          <Pressable
            key={row.label}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            onPress={row.run}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 13,
              paddingHorizontal: 16,
              height: 46,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colors.border,
              backgroundColor: pressed ? colors.pale : "transparent",
            })}
          >
            <Ionicons name={row.icon} size={19} color={row.tone ?? colors.ink} />

            <Text
              style={{
                flex: 1,
                fontSize: 15,
                fontWeight: "600",
                color: row.tone ?? colors.ink,
              }}
            >
              {row.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

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
      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
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
            <ScrollView keyboardDismissMode="on-drag" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9 }}>
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
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyRoom, setBusyRoom] = useState<string | null>(null);
  const [held, setHeld] = useState<{
    room: TeamRoom;
    at: { x: number; y: number };
  } | null>(null);

  /*
   * The faces to put on a room's row.
   *
   * The roster is the whole workspace, and a room carries the ids of its own
   * members -- General carries everybody's. Missing people simply do not draw:
   * a row is not worth failing over somebody who left this morning.
   */
  function faces(room: TeamRoom) {
    return roster.filter((member) => room.member_ids.includes(member.id));
  }

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rooms.filter((room) =>
        (room.name?.trim() || "General").toLowerCase().includes(needle),
      )
    : rooms;
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

  /*
   * A room's own actions: mute it, or -- if you may -- delete it.
   *
   * Archive is not here. Nothing in TENH archives a room: there is no column
   * for it and no endpoint, so a button would either lie or delete. Muting is
   * what "I do not want to hear from this" means today.
   */
  function roomActions(room: TeamRoom) {
    const actions = [
      {
        icon: (room.is_muted
          ? "notifications-outline"
          : "notifications-off-outline") as IconName,
        label: room.is_muted ? "Unmute" : "Mute",
        tone: colors.blue,
        onPress: () => {
          setOpenId(null);
          void runRoomAction(room, "mute");
        },
      },
    ];

    if (canManageRooms && !room.is_general) {
      actions.push({
        icon: "trash-outline" as IconName,
        label: "Delete",
        tone: colors.red,
        onPress: () => {
          setOpenId(null);
          void runRoomAction(room, "delete");
        },
      });
    }

    return actions;
  }

  async function runRoomAction(room: TeamRoom, action: "mute" | "delete") {
    if (!workspace || busyRoom) return;

    if (action === "delete") {
      Alert.alert(
        `Delete ${room.name?.trim() || "this room"}?`,
        "Everything said in it goes with it, for everybody. This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => void deleteRoom(room),
          },
        ],
      );

      return;
    }

    setBusyRoom(room.id);

    try {
      await api(`/api/team-chat/rooms/${room.id}/mute`, workspace.businessId, {
        method: "PATCH",
        body: { muted: !room.is_muted },
      });

      await refreshRooms();
    } catch (muteError) {
      setError(
        muteError instanceof Error
          ? muteError.message
          : "Unable to change that room.",
      );
    } finally {
      setBusyRoom(null);
    }
  }

  async function deleteRoom(room: TeamRoom) {
    if (!workspace) return;

    setBusyRoom(room.id);

    try {
      await api(`/api/team-chat/rooms/${room.id}`, workspace.businessId, {
        method: "DELETE",
      });

      await refreshRooms();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete that room.",
      );
    } finally {
      setBusyRoom(null);
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

        {/*
          Search, once there are enough rooms to lose one in. A workspace with
          three rooms does not need a box that tells you it has three rooms.
        */}
        {rooms.length > 3 ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              marginTop: 10,
              paddingHorizontal: 13,
              height: 44,
              borderRadius: 14,
              backgroundColor: colors.background,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="search" size={17} color={colors.muted} />

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search a group"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              style={{ flex: 1, fontSize: 15, color: colors.ink }}
            />

            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                onPress={() => setQuery("")}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={17} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
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
      ) : shown.length === 0 ? (
        <Empty
          icon="search-outline"
          title="Nothing matches"
          detail="No room here is called that."
        />
      ) : (
        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 14, gap: 9 }}
        >
          {shown.map((room) => (
            <View key={room.id} style={{ borderRadius: 18, overflow: "hidden" }}>
              {/*
                Mute and Delete off the right-hand edge, the same drag the
                tag, quick-reply and reminder lists use. A room is a tap
                target first; the things that change it should cost a
                deliberate gesture.
              */}
              <SwipeRow
                id={room.id}
                openId={openId}
                onOpen={setOpenId}
                actions={roomActions(room)}
              >
                <Pressable
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
                  onLongPress={(event) =>
                    setHeld({
                      room,
                      at: {
                        x: event.nativeEvent.pageX,
                        y: event.nativeEvent.pageY,
                      },
                    })
                  }
                  delayLongPress={280}
                  style={({ pressed }) => [
                    styles.card,
                    {
                      opacity: pressed ? 0.72 : 1,
                      borderRadius: 18,
                      padding: 13,
                      borderColor:
                        room.badge_count > 0 ? "#B7DCF3" : colors.border,
                      backgroundColor:
                        room.badge_count > 0 ? "#F0F9FF" : "white",
                    },
                  ]}
                >
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <TeamRoomIcon icon={room.icon} size={48} />

                    <View style={{ flex: 1, gap: 4 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <Text
                          style={[styles.heading, { flexShrink: 1 }]}
                          numberOfLines={1}
                        >
                          {room.name?.trim() || "General"}
                        </Text>

                        {room.is_muted ? (
                          <Ionicons
                            name="notifications-off"
                            size={14}
                            color={colors.muted}
                          />
                        ) : null}

                        {/*
                          When, at the end of the title line rather than beside
                          the message: it belongs to the room's last activity,
                          which is what the whole row is sorted and read by.
                        */}
                        <Text
                          style={{
                            marginLeft: "auto",
                            fontSize: 11.5,
                            color: colors.muted,
                          }}
                        >
                          {room.last_message
                            ? relativeTime(room.last_message.created_at)
                            : ""}
                        </Text>

                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={colors.muted}
                        />
                      </View>

                      <Text style={styles.muted} numberOfLines={1}>
                        {room.description?.trim() ||
                          "Internal team conversation"}
                      </Text>

                      {/*
                        Who is in here, as faces rather than a number. A room
                        is people, and three of them plus a count says more
                        about whether this is the room you meant than "4
                        members" ever did -- which is still there, in the
                        corner, for when it is the number you want.
                      */}
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                          marginTop: 2,
                        }}
                      >
                        <View style={{ flexDirection: "row" }}>
                          {faces(room)
                            .slice(0, 3)
                            .map((member, index) => (
                              <View
                                key={member.id}
                                style={{
                                  marginLeft: index === 0 ? 0 : -9,
                                  borderRadius: 13,
                                  borderWidth: 2,
                                  borderColor: "white",
                                }}
                              >
                                <Avatar
                                  name={member.full_name}
                                  uri={member.profile_picture_url}
                                  size={22}
                                />
                              </View>
                            ))}

                          {room.member_count > 3 ? (
                            <View
                              style={{
                                marginLeft: -9,
                                width: 26,
                                height: 26,
                                borderRadius: 13,
                                borderWidth: 2,
                                borderColor: "white",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: colors.background,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: "800",
                                  color: colors.muted,
                                }}
                              >
                                +{room.member_count - 3}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        <Text
                          style={{
                            marginLeft: "auto",
                            fontSize: 11.5,
                            color: colors.muted,
                          }}
                        >
                          {room.member_count} member
                          {room.member_count === 1 ? "" : "s"}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/*
                    What was last said in here, on its own line under a rule.

                    The row used to show the sentence somebody typed when they
                    made the room -- the same words every time you look. A room
                    list is read to find out what has happened since you were
                    last in it, so the newest message gets the line, its sender
                    gets the weight, and the unread count sits at the end of it
                    where the thing it counts is.
                  */}
                  {room.last_message ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 11,
                        paddingTop: 10,
                        borderTopWidth: 1,
                        borderTopColor: colors.border,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          flexShrink: 0,
                          maxWidth: 110,
                          fontSize: 13,
                          fontWeight: "800",
                          color: colors.ink,
                        }}
                      >
                        {room.last_message.sender_name}
                      </Text>

                      <Text
                        numberOfLines={1}
                        style={{ flex: 1, fontSize: 13, color: colors.muted }}
                      >
                        {room.last_message.text}
                      </Text>

                      {room.mention_count > 0 ? (
                        <Badge count={room.mention_count} mention />
                      ) : null}

                      <Badge count={room.badge_count} mention={false} />
                    </View>
                  ) : null}
                </Pressable>
              </SwipeRow>
            </View>
          ))}
        </ScrollView>
      )}

      {/*
        The same actions again, held rather than dragged. Both gestures exist
        because both are taught: Messenger holds, Mail swipes, and somebody
        who reaches for one should not have to learn the other.
      */}
      <RoomMenu
        held={held}
        onClose={() => setHeld(null)}
        onAction={(room: TeamRoom, action: "mute" | "delete") => {
          setHeld(null);
          runRoomAction(room, action);
        }}
      />

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
