import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
  Sheet,
  colors,
  styles,
} from "../../../components/ui";
import { api } from "../../../lib/api/client";
import { useInbox } from "../../../lib/inbox-provider";
import type { Member } from "../../../lib/types";
import { TeamRoomIcon } from "../../../components/team-room-icon";

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
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      {action ? (
        <View
          style={{
            minHeight: 28,
            paddingHorizontal: 4,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "800",
              letterSpacing: 0.7,
              textTransform: "uppercase",
              color: colors.muted,
            }}
          >
            {title}
          </Text>

          {action}
        </View>
      ) : (
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
      )}

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

function AddMembersSheet({
  open,
  roster,
  currentIds,
  busy,
  onAdd,
  onClose,
}: {
  open: boolean;
  roster: Member[];
  currentIds: Set<string>;
  busy: boolean;
  onAdd: (memberIds: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) {
      setPicked(new Set());
    }
  }, [open]);

  const available = useMemo(
    () => roster.filter((member) => !currentIds.has(member.id)),
    [roster, currentIds],
  );

  return (
    <Sheet
      open={open}
      title="Add members"
      detail="Select people who are not in this group yet."
      onClose={onClose}
      floating
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        {available.length === 0 ? (
          <View style={{ paddingHorizontal: 18, paddingVertical: 28, alignItems: "center", gap: 8 }}>
            <Ionicons name="people-outline" size={28} color={colors.muted} />
            <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>
              Everyone is already in this group
            </Text>
          </View>
        ) : (
          available.map((member, index) => {
            const selected = picked.has(member.id);

            return (
              <Pressable
                key={member.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={busy}
                onPress={() =>
                  setPicked((current) => {
                    const next = new Set(current);
                    if (next.has(member.id)) next.delete(member.id);
                    else next.add(member.id);
                    return next;
                  })
                }
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 18,
                  paddingVertical: 13,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                  backgroundColor: pressed ? colors.pale : "transparent",
                })}
              >
                <Avatar
                  name={member.full_name}
                  uri={member.profile_picture_url}
                  size={40}
                />

                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}>
                    {member.full_name || member.email}
                  </Text>
                  <Text style={[styles.muted, { fontSize: 12 }]}>{member.role}</Text>
                </View>

                <Ionicons
                  name={selected ? "checkbox" : "square-outline"}
                  size={22}
                  color={selected ? colors.blue : colors.muted}
                />
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || picked.size === 0}
          onPress={() => onAdd([...picked])}
          style={({ pressed }) => [
            styles.button,
            { opacity: busy || picked.size === 0 ? 0.4 : pressed ? 0.8 : 1 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
              Add{picked.size > 0 ? ` ${picked.size}` : ""}
            </Text>
          )}
        </Pressable>
      </View>
    </Sheet>
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
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [localMemberIds, setLocalMemberIds] = useState<string[]>([]);

  useEffect(() => {
    if (!room) {
      setLocalMemberIds([]);
      return;
    }

    setLocalMemberIds(
      room.is_general ? roster.map((member) => member.id) : room.member_ids,
    );
  }, [room?.id, room?.member_ids, room?.is_general, roster]);

  const memberIds = useMemo(
    () => new Set(localMemberIds),
    [localMemberIds],
  );

  /*
   * General has everybody in it by definition and the server rejects any
   * attempt to change that, so it is read-only here too.
   */
  const editable = canManageRooms && Boolean(room) && !room?.is_general;

  const visibleMembers = useMemo(
    () =>
      room?.is_general
        ? roster
        : roster.filter((member) => memberIds.has(member.id)),
    [room?.is_general, roster, memberIds],
  );

  async function setMembers(nextIds: string[]) {
    if (!id || !workspace || busy) {
      return false;
    }

    const previousIds = localMemberIds;
    const normalized = [...new Set(nextIds)];

    // Update the group details immediately; the server remains authoritative
    // and rolls this back if it rejects the change.
    setLocalMemberIds(normalized);
    setBusy("members");
    setError("");

    try {
      await api(
        `/api/team-chat/rooms/${encodeURIComponent(id)}/members`,
        workspace.businessId,
        { method: "PUT", body: { memberIds: normalized } },
      );

      void refreshRooms();
      return true;
    } catch (memberError) {
      setLocalMemberIds(previousIds);
      setError(
        memberError instanceof Error
          ? memberError.message
          : "Unable to change who is in this group.",
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function addMembers(memberIdsToAdd: string[]) {
    const changed = await setMembers([
      ...new Set([...memberIds, ...memberIdsToAdd]),
    ]);

    if (changed) {
      setAddMembersOpen(false);
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
            <TeamRoomIcon icon={room.icon} size={62} />

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
              {localMemberIds.length} member{localMemberIds.length === 1 ? "" : "s"}
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

          <Section
            title="Members"
            action={
              editable ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add people to this group"
                  disabled={busy === "members"}
                  onPress={() => setAddMembersOpen(true)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: pressed ? "#E7F5FD" : colors.pale,
                    opacity: busy === "members" ? 0.5 : 1,
                  })}
                >
                  <Ionicons name="person-add-outline" size={16} color={colors.blue} />
                  <Text style={{ color: colors.blue, fontSize: 12.5, fontWeight: "800" }}>
                    Add person
                  </Text>
                </Pressable>
              ) : null
            }
          >
            {visibleMembers.map((member, index) => {
              return (
                <View
                  key={member.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: colors.border,
                    backgroundColor: "transparent",
                  }}
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

                  {editable ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${member.full_name || member.email} from this group`}
                      disabled={busy === "members"}
                      onPress={() =>
                        void setMembers(
                          [...memberIds].filter((one) => one !== member.id),
                        )
                      }
                      style={({ pressed }) => ({
                        paddingHorizontal: 8,
                        paddingVertical: 7,
                        borderRadius: 8,
                        backgroundColor: pressed ? "#FFF1EF" : "transparent",
                        opacity: busy === "members" ? 0.45 : 1,
                      })}
                    >
                      <Text style={{ color: colors.red, fontSize: 13, fontWeight: "800" }}>
                        Remove
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
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

      {room && editable ? (
        <AddMembersSheet
          open={addMembersOpen}
          roster={roster}
          currentIds={memberIds}
          busy={busy === "members"}
          onAdd={(ids) => void addMembers(ids)}
          onClose={() => {
            if (busy !== "members") setAddMembersOpen(false);
          }}
        />
      ) : null}
    </View>
  );
}
