import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { Sheet, TagChip, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";

/*
 * The tags this workspace can put on a customer.
 *
 * Adding one is the settings change an agent most often wants mid-shift --
 * a new promotion, a new courier, a problem worth marking -- and it is small
 * enough to do properly on a phone, which most of Settings is not.
 */

type Tag = {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  is_active: boolean;
  sort_index: number;
};

/*
 * The web's own swatches. Tag colour carries meaning across a team, so the
 * phone offers the same set rather than a colour wheel that would let one
 * person invent a green nobody else has.
 */
const SWATCHES = [
  "#0089CC",
  "#2FA36B",
  "#00C24E",
  "#C77700",
  "#F0603C",
  "#B43232",
  "#6D4AFF",
  "#64748B",
];

export default function Tags() {
  const { workspace, canManageRooms } = useInbox();

  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [editing, setEditing] = useState<Tag | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);

  const open = creating || editing !== null;

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    try {
      const data = await api<{ tags: Tag[] }>(
        "/api/tags",
        workspace.businessId,
      );

      setTags(data.tags ?? []);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load tags.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspace?.businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  function startCreate() {
    setEditing(null);
    setCreating(true);
    setName("");
    setColor(SWATCHES[0]);
  }

  function startEdit(tag: Tag) {
    setCreating(false);
    setEditing(tag);
    setName(tag.name);
    setColor(tag.color || SWATCHES[0]);
  }

  function close() {
    setCreating(false);
    setEditing(null);
  }

  async function save() {
    const trimmed = name.trim();

    if (!workspace || !trimmed || busy) {
      return;
    }

    setBusy("save");
    setError("");

    try {
      if (editing) {
        await api(
          `/api/tags/${encodeURIComponent(editing.id)}`,
          workspace.businessId,
          { method: "PATCH", body: { name: trimmed, color } },
        );
      } else {
        await api("/api/tags", workspace.businessId, {
          method: "POST",
          body: { name: trimmed, color },
        });
      }

      close();
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save that tag.",
      );
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete(tag: Tag) {
    Alert.alert(
      `Delete ${tag.name}?`,
      "It comes off every customer that carries it. This cannot be undone.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void remove(tag),
        },
      ],
    );
  }

  async function remove(tag: Tag) {
    if (!workspace || busy) {
      return;
    }

    setBusy(tag.id);
    setError("");

    try {
      await api(
        `/api/tags/${encodeURIComponent(tag.id)}`,
        workspace.businessId,
        { method: "DELETE" },
      );

      close();
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete that tag.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsScreen
      title="Tags"
      detail={`${tags.length} tag${tags.length === 1 ? "" : "s"} on this workspace`}
      loading={loading}
      error={error}
      onRetry={() => void load()}
    >
      {canManageRooms ? (
        <Pressable
          accessibilityRole="button"
          onPress={startCreate}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: pressed ? "#0072AB" : colors.blue,
          })}
        >
          <Ionicons name="add" size={18} color="white" />

          <Text style={{ color: "white", fontSize: 15, fontWeight: "700" }}>
            New tag
          </Text>
        </Pressable>
      ) : null}

      <SettingsGroup>
        {tags.length === 0 ? (
          <View style={{ padding: 28, alignItems: "center", gap: 6 }}>
            <Ionicons name="pricetags-outline" size={26} color={colors.muted} />

            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
              No tags yet
            </Text>

            <Text style={[styles.muted, { fontSize: 13, textAlign: "center" }]}>
              A tag is how a customer gets marked as VIP, or paying on delivery,
              or anything else your team needs to see at a glance.
            </Text>
          </View>
        ) : (
          tags.map((tag, index) => (
            <Pressable
              key={tag.id}
              accessibilityRole={canManageRooms ? "button" : "text"}
              accessibilityLabel={
                canManageRooms ? `Edit the ${tag.name} tag` : tag.name
              }
              disabled={!canManageRooms}
              onPress={() => startEdit(tag)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
                backgroundColor:
                  pressed && canManageRooms ? colors.pale : "transparent",
                opacity: tag.is_active ? 1 : 0.5,
              })}
            >
              <TagChip name={tag.name} color={tag.color} showCheck={false} />

              <View style={{ flex: 1 }}>
                {tag.is_active ? null : (
                  <Text style={[styles.muted, { fontSize: 12 }]}>Inactive</Text>
                )}
              </View>

              {canManageRooms ? (
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color={colors.muted}
                />
              ) : null}
            </Pressable>
          ))
        )}
      </SettingsGroup>

      {canManageRooms ? null : (
        <Text style={[styles.muted, { fontSize: 12, paddingHorizontal: 2 }]}>
          Only an owner or an admin can change tags. You can put any of these on
          a customer from their panel in the Inbox.
        </Text>
      )}

      <Sheet
        open={open}
        title={editing ? "Edit tag" : "New tag"}
        detail="Colour carries meaning across the team, so pick from the set."
        onClose={close}
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={{ paddingHorizontal: 18, gap: 14 }}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Tag name"
              placeholderTextColor={colors.muted}
              maxLength={40}
              autoFocus
              editable={busy === null}
              style={styles.input}
            />

            <View style={{ alignItems: "flex-start" }}>
              <TagChip name={name.trim() || "Preview"} color={color} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {SWATCHES.map((swatch) => (
                <Pressable
                  key={swatch}
                  accessibilityRole="button"
                  accessibilityLabel={`Use the colour ${swatch}`}
                  accessibilityState={{ selected: swatch === color }}
                  onPress={() => setColor(swatch)}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: swatch,
                    borderWidth: swatch === color ? 3 : 0,
                    borderColor: colors.ink,
                  }}
                >
                  {swatch === color ? (
                    <Ionicons name="checkmark" size={18} color="white" />
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            gap: 10,
            padding: 16,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          {editing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete the ${editing.name} tag`}
              disabled={busy !== null}
              onPress={() => confirmDelete(editing)}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 14,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.red,
                backgroundColor: pressed ? "#FFF1EF" : "white",
              })}
            >
              {busy === editing.id ? (
                <ActivityIndicator color={colors.red} />
              ) : (
                <Ionicons name="trash-outline" size={18} color={colors.red} />
              )}
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={name.trim().length === 0 || busy !== null}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.button,
              {
                flex: 1,
                opacity:
                  name.trim().length === 0 || busy !== null
                    ? 0.4
                    : pressed
                      ? 0.8
                      : 1,
              },
            ]}
          >
            {busy === "save" ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
                {editing ? "Save" : "Create tag"}
              </Text>
            )}
          </Pressable>
        </View>
      </Sheet>
    </SettingsScreen>
  );
}
