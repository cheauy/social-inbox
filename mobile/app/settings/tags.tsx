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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OrderMark, SwipeRow } from "../../components/swipe-row";
import { Sheet, TagChip, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";

/*
 * The tags this workspace can put on a customer.
 *
 * Adding one is the settings change an agent most often wants mid-shift --
 * a new promotion, a new courier, a problem worth marking -- and it is small
 * enough to do properly on a phone, which most of Settings is not.
 *
 * Retired tags are behind their own tab rather than greyed out in the same
 * list. A tag is taken out of use far more often than it is deleted -- the
 * customers carrying it keep it, and the history stays readable -- so the
 * disabled ones are a real set worth finding, not clutter to scroll past.
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
 * The web's own swatches, offered first: tag colour carries meaning across a
 * team, and eight shared ones beat everybody inventing their own green. A
 * workspace whose brand is not in the set can still type a hex, which is what
 * the API takes anyway.
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
  const insets = useSafeAreaInsets();
  const { workspace, canManageRooms } = useInbox();

  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const [editing, setEditing] = useState<Tag | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [order, setOrder] = useState("0");
  const [tab, setTab] = useState<"active" | "disabled">("active");
  const [swiped, setSwiped] = useState<string | null>(null);

  const open = creating || editing !== null;

  const active = tags.filter((tag) => tag.is_active);
  const disabled = tags.filter((tag) => !tag.is_active);
  const shown = tab === "active" ? active : disabled;

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
    /* Next in line, so a new tag lands at the end rather than on top. */
    setOrder(String(tags.length));
  }

  function startEdit(tag: Tag) {
    setCreating(false);
    setEditing(tag);
    setName(tag.name);
    setColor(tag.color || SWATCHES[0]);
    setOrder(String(tag.sort_index ?? 0));
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

    /* A blank or nonsense order is the end of the list, not NaN. */
    const parsed = Number.parseInt(order, 10);
    const sortIndex = Number.isFinite(parsed) && parsed >= 0 ? parsed : tags.length;

    try {
      if (editing) {
        await api(
          `/api/tags/${encodeURIComponent(editing.id)}`,
          workspace.businessId,
          {
            method: "PATCH",
            body: { name: trimmed, color, sortIndex },
          },
        );
      } else {
        await api("/api/tags", workspace.businessId, {
          method: "POST",
          body: { name: trimmed, color, sortIndex },
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

  /*
   * Taking a tag out of use, which is what people actually want nine times in
   * ten: the customers carrying it keep it and the history still reads, but
   * nobody can put it on anybody new.
   */
  async function setActive(tag: Tag, active: boolean) {
    if (!workspace || busy) return;

    setBusy(tag.id);
    setError("");

    try {
      await api(
        `/api/tags/${encodeURIComponent(tag.id)}`,
        workspace.businessId,
        { method: "PATCH", body: { isActive: active } },
      );

      await load();
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Unable to change that tag.",
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
      skeleton={[6]}
      error={error}
      onRetry={() => void load()}
      /*
        Pinned to the bottom rather than sitting above the list, matching
        Quick replies: the button is reachable with a thumb, and it stays put
        while the list it adds to scrolls under it.
      */
      footer={
        canManageRooms ? (
          <View
            style={{
              padding: 14,
              paddingBottom: insets.bottom + 14,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: "white",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New tag"
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
          </View>
        ) : null
      }
    >
      {/*
        Two tabs with their counts, so "how many tags do we actually use" is
        answered by looking rather than by counting greyed-out rows.
      */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["active", "disabled"] as const).map((option) => {
          const on = tab === option;
          const count =
            option === "active" ? active.length : disabled.length;

          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                setTab(option);
                setSwiped(null);
              }}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                paddingVertical: 11,
                borderRadius: 13,
                borderWidth: 1,
                borderColor: on ? colors.blue : colors.border,
                backgroundColor: on
                  ? colors.pale
                  : pressed
                    ? colors.pale
                    : "white",
              })}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: on ? "800" : "600",
                  color: on ? colors.blue : colors.muted,
                }}
              >
                {option === "active" ? "Active" : "Disabled"}
              </Text>

              <View
                style={{
                  minWidth: 22,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 999,
                  backgroundColor: on ? colors.blue : colors.border,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "800",
                    color: on ? "white" : colors.muted,
                    textAlign: "center",
                  }}
                >
                  {count}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <SettingsGroup>
        {shown.length === 0 ? (
          <View style={{ padding: 28, alignItems: "center", gap: 6 }}>
            <Ionicons name="pricetags-outline" size={26} color={colors.muted} />

            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>
              {tab === "active" ? "No tags yet" : "Nothing disabled"}
            </Text>

            <Text style={[styles.muted, { fontSize: 13, textAlign: "center" }]}>
              {tab === "active"
                ? "A tag is how a customer gets marked as VIP, or paying on delivery, or anything else your team needs to see at a glance."
                : "Tags you take out of use appear here. The customers carrying them keep them."}
            </Text>
          </View>
        ) : (
          shown.map((tag, index) => {
            const row = (
              <Pressable
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
                    pressed && canManageRooms ? colors.pale : "white",
                })}
              >
                <OrderMark index={tag.sort_index ?? index} />

                <View style={{ flex: 1 }}>
                  <TagChip name={tag.name} color={tag.color} showCheck={false} />
                </View>

                {busy === tag.id ? (
                  <ActivityIndicator color={colors.blue} />
                ) : canManageRooms ? (
                  <Ionicons
                    name="chevron-forward"
                    size={17}
                    color={colors.muted}
                  />
                ) : null}
              </Pressable>
            );

            if (!canManageRooms) {
              return <View key={tag.id}>{row}</View>;
            }

            return (
              <SwipeRow
                key={tag.id}
                id={tag.id}
                openId={swiped}
                onOpen={setSwiped}
                actions={[
                  {
                    icon: tag.is_active ? "eye-off-outline" : "eye-outline",
                    label: tag.is_active ? "Disable" : "Enable",
                    tone: tag.is_active ? "#C77700" : "#2FA36B",
                    onPress: () => void setActive(tag, !tag.is_active),
                  },
                  {
                    icon: "trash-outline",
                    label: "Delete",
                    tone: colors.red,
                    onPress: () => confirmDelete(tag),
                  },
                ]}
              >
                {row}
              </SwipeRow>
            );
          })
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
        detail="Colour carries meaning across the team. Pick one, or type your own."
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

            {/*
              Both states, because a tag is worn two ways -- filled where a
              customer has it, outlined where they do not -- and a colour that
              reads in one can vanish in the other.
            */}
            <View style={{ gap: 8 }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "800",
                  letterSpacing: 0.7,
                  textTransform: "uppercase",
                  color: colors.muted,
                }}
              >
                Live preview
              </Text>

              <View style={{ flexDirection: "row", gap: 14 }}>
                <View style={{ alignItems: "center", gap: 4 }}>
                  <TagChip name={name.trim() || "Preview"} color={color} />
                  <Text style={[styles.muted, { fontSize: 11.5 }]}>Applied</Text>
                </View>

                <View style={{ alignItems: "center", gap: 4 }}>
                  <TagChip
                    name={name.trim() || "Preview"}
                    color={color}
                    selected={false}
                  />
                  <Text style={[styles.muted, { fontSize: 11.5 }]}>
                    Not applied
                  </Text>
                </View>
              </View>
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

            {/*
              Anything the eight do not cover. Validated here as well as at the
              API, so a half-typed hex does not turn the preview black while
              somebody is still typing it.
            */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: color,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              />

              <TextInput
                value={color}
                onChangeText={(value) => {
                  const next = value.startsWith("#") ? value : `#${value}`;
                  if (/^#[0-9a-fA-F]{0,6}$/.test(next)) {
                    setColor(next.toUpperCase());
                  }
                }}
                placeholder="#0089CC"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={7}
                editable={busy === null}
                style={[styles.input, { flex: 1 }]}
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "800",
                  letterSpacing: 0.7,
                  textTransform: "uppercase",
                  color: colors.muted,
                }}
              >
                Order
              </Text>

              <TextInput
                value={order}
                onChangeText={(value) =>
                  setOrder(value.replace(/[^0-9]/g, ""))
                }
                placeholder="0"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={4}
                editable={busy === null}
                style={styles.input}
              />

              <Text style={[styles.muted, { fontSize: 12, lineHeight: 17 }]}>
                Lower comes first, everywhere a tag is listed.
              </Text>
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
