import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { Avatar, Empty, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import { useLanguage } from "../../lib/language-provider";

/*
 * Who is allowed to do what, edited here instead of on the web.
 *
 * The row used to open a browser, on the grounds that a permission matrix is
 * a desktop shape -- and the web's is: thirty-odd permissions by every member
 * at once. That is the part that does not fit a phone, not the decision. A
 * phone can ask the same question one person at a time, which is how it gets
 * asked anyway: somebody joins, or somebody should not have been able to
 * delete that, and you change one person.
 *
 * So: pick a member, then set their permissions. Same endpoint, same catalog,
 * same "reset to the role's defaults" the web offers.
 */

type Level = "none" | "view" | "manage";
type Value = Level | boolean;

type Definition = {
  key: string;
  kind: "level" | "toggle";
  label: string;
  description: string;
  locked?: boolean;
  levels?: Level[];
};

type Group = {
  key: string;
  title: string;
  description: string;
  permissions: Definition[];
};

type MemberPermissions = Record<string, Value>;

type PermissionMember = {
  id: string;
  role: string;
  isActive: boolean;
  isOwner: boolean;
  fullName: string | null;
  email: string | null;
  profilePictureUrl: string | null;
  hasOverrides: boolean;
  permissions: MemberPermissions;
};

type Response = {
  canManage?: boolean;
  groups?: Group[];
  members?: PermissionMember[];
};

const LEVELS: Level[] = ["none", "view", "manage"];

const TONE: Record<string, string> = {
  none: colors.red,
  view: "#C77700",
  manage: "#2FA36B",
};

export default function Roles() {
  const insets = useSafeAreaInsets();
  const { workspace } = useInbox();
  const { t } = useLanguage();

  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<PermissionMember[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemberPermissions>({});

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    try {
      const data = await api<Response>(
        "/api/team/permissions",
        workspace.businessId,
      );

      setGroups(data.groups ?? []);
      setMembers(data.members ?? []);
      setCanManage(data.canManage === true);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load roles and permissions.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspace?.businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const definitions = useMemo(
    () => groups.flatMap((group) => group.permissions),
    [groups],
  );

  const selected = useMemo(
    () => members.find((member) => member.id === selectedId) ?? null,
    [members, selectedId],
  );

  const dirty = useMemo(() => {
    if (!selected) return false;

    return definitions.some(
      (definition) =>
        !definition.locked &&
        draft[definition.key] !== selected.permissions[definition.key],
    );
  }, [definitions, draft, selected]);

  function choose(member: PermissionMember) {
    setSelectedId(member.id);
    setDraft({ ...member.permissions });
    setSaved(false);
    setError("");
  }

  async function save(reset = false) {
    if (!selected || !workspace) return;

    setSaving(true);
    setError("");
    setSaved(false);

    try {
      const result = await api<{ permissions?: MemberPermissions }>(
        "/api/team/permissions",
        workspace.businessId,
        {
          method: "PUT",
          body: {
            memberId: selected.id,
            permissions: draft,
            reset,
          },
        },
      );

      const next = result.permissions ?? draft;

      setMembers((current) =>
        current.map((member) =>
          member.id === selected.id
            ? { ...member, permissions: next, hasOverrides: !reset }
            : member,
        ),
      );

      setDraft(next);
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save those permissions.",
      );
    } finally {
      setSaving(false);
    }
  }

  /* The owner's permissions are fixed, so they are shown but not editable. */
  const editable = members.filter((member) => member.isActive && !member.isOwner);
  const owners = members.filter((member) => member.isActive && member.isOwner);

  return (
    <SettingsScreen
      title={t("Roles and permissions", "តួនាទី និងសិទ្ធិ")}
      detail={
        selected
          ? (selected.fullName ?? selected.email ?? selected.role)
          : t("Pick somebody to change", "ជ្រើសអ្នកដែលចង់កែ")
      }
      loading={loading}
      error={error}
      onRetry={() => void load()}
      footer={
        selected && canManage ? (
          <View
            style={{
              flexDirection: "row",
              gap: 10,
              padding: 14,
              paddingBottom: insets.bottom + 14,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: "white",
            }}
          >
            <Pressable
              accessibilityRole="button"
              disabled={saving || !selected.hasOverrides}
              onPress={() => void save(true)}
              style={({ pressed }) => ({
                paddingHorizontal: 16,
                paddingVertical: 13,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: pressed ? colors.pale : "white",
                opacity: selected.hasOverrides ? 1 : 0.45,
              })}
            >
              <Text
                style={{ color: colors.ink, fontSize: 14.5, fontWeight: "700" }}
              >
                {t("Reset", "កំណត់ឡើងវិញ")}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={saving || !dirty}
              onPress={() => void save()}
              style={({ pressed }) => ({
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 13,
                borderRadius: 14,
                backgroundColor: pressed ? "#0A6FA8" : colors.blue,
                opacity: dirty && !saving ? 1 : 0.5,
              })}
            >
              {saving ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text
                  style={{ color: "white", fontSize: 15, fontWeight: "700" }}
                >
                  {saved && !dirty
                    ? t("Saved", "បានរក្សាទុក")
                    : t("Save changes", "រក្សាទុកការផ្លាស់ប្តូរ")}
                </Text>
              )}
            </Pressable>
          </View>
        ) : null
      }
    >
      {editable.length === 0 && owners.length === 0 ? (
        <Empty
          icon="key-outline"
          title={t("Nobody to show", "គ្មានអ្នកបង្ហាញ")}
          detail={t(
            "This workspace has no other active members yet.",
            "កន្លែងធ្វើការនេះមិនទាន់មានសមាជិកសកម្មផ្សេងទៀតទេ។",
          )}
        />
      ) : null}

      <SettingsGroup title={t("Team", "ក្រុម")}>
        {[...owners, ...editable].map((member, index) => {
          const active = member.id === selectedId;

          return (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              disabled={member.isOwner}
              onPress={() => choose(member)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
                backgroundColor: active
                  ? colors.pale
                  : pressed
                    ? colors.pale
                    : "transparent",
                opacity: member.isOwner ? 0.6 : 1,
              })}
            >
              <Avatar
                name={member.fullName ?? member.email ?? "?"}
                uri={member.profilePictureUrl}
                size={38}
              />

              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}
                >
                  {member.fullName ?? member.email ?? member.role}
                </Text>
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  {member.isOwner
                    ? t("Owner — always full access", "ម្ចាស់ — សិទ្ធិពេញលេញ")
                    : member.hasOverrides
                      ? t(
                          member.role + " · changed",
                          member.role + " · បានកែ",
                        )
                      : t(
                          member.role + " · role defaults",
                          member.role + " · តាមតួនាទី",
                        )}
                </Text>
              </View>

              {active ? (
                <Ionicons name="checkmark" size={19} color={colors.blue} />
              ) : member.isOwner ? (
                <Ionicons name="lock-closed" size={15} color={colors.muted} />
              ) : (
                <Ionicons
                  name="chevron-forward"
                  size={17}
                  color={colors.muted}
                />
              )}
            </Pressable>
          );
        })}
      </SettingsGroup>

      {!canManage ? (
        <Text
          style={[styles.muted, { fontSize: 12, paddingHorizontal: 2, lineHeight: 18 }]}
        >
          {t(
            "You can see these but not change them. Changing what somebody is allowed to do needs manage access to roles and permissions.",
            "អ្នកអាចមើលបាន ប៉ុន្តែមិនអាចកែបានទេ។ ការកែសិទ្ធិត្រូវការសិទ្ធិគ្រប់គ្រងលើតួនាទី និងសិទ្ធិ។",
          )}
        </Text>
      ) : null}

      {selected
        ? groups.map((group) => (
            <SettingsGroup key={group.key} title={group.title}>
              {group.permissions.map((definition, index) => {
                const value = draft[definition.key];

                return (
                  <View
                    key={definition.key}
                    style={{
                      gap: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.border,
                      opacity: definition.locked || !canManage ? 0.55 : 1,
                    }}
                  >
                    <View>
                      <Text
                        style={{
                          fontSize: 14.5,
                          fontWeight: "600",
                          color: colors.ink,
                        }}
                      >
                        {definition.label}
                      </Text>
                      <Text
                        style={[styles.muted, { fontSize: 12, lineHeight: 17 }]}
                      >
                        {definition.description}
                      </Text>
                    </View>

                    {/*
                      A segmented row rather than a dropdown: three choices fit
                      across a phone, and the one in force should be legible
                      without opening anything.
                    */}
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      {(definition.kind === "toggle"
                        ? ([false, true] as const)
                        : ((definition.levels ?? LEVELS) as Level[])
                      ).map((option) => {
                        const on = value === option;

                        const label =
                          option === true
                            ? t("Allowed", "អនុញ្ញាត")
                            : option === false
                              ? t("Not allowed", "មិនអនុញ្ញាត")
                              : option === "none"
                                ? t("None", "គ្មាន")
                                : option === "view"
                                  ? t("View", "មើល")
                                  : t("Manage", "គ្រប់គ្រង");

                        const tone =
                          option === true
                            ? TONE.manage
                            : option === false
                              ? TONE.none
                              : TONE[option];

                        return (
                          <Pressable
                            key={String(option)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            disabled={definition.locked || !canManage}
                            onPress={() => {
                              setSaved(false);
                              setDraft((current) => ({
                                ...current,
                                [definition.key]: option,
                              }));
                            }}
                            style={({ pressed }) => ({
                              flex: 1,
                              alignItems: "center",
                              paddingVertical: 9,
                              borderRadius: 11,
                              borderWidth: 1,
                              borderColor: on ? tone : colors.border,
                              backgroundColor: on
                                ? tone + "1A"
                                : pressed
                                  ? colors.pale
                                  : "white",
                            })}
                          >
                            <Text
                              style={{
                                fontSize: 12.5,
                                fontWeight: on ? "800" : "600",
                                color: on ? tone : colors.muted,
                              }}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </SettingsGroup>
          ))
        : null}
    </SettingsScreen>
  );
}
