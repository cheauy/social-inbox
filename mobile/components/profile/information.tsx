import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { SettingsGroup } from "../settings-screen";
import { SlidePanel } from "../slide-panel";
import { IconName, colors, styles } from "../ui";
import { api } from "../../lib/api/client";
import { useAuth } from "../../lib/auth/provider";
import { useAccount } from "../../lib/account";
import { useInbox } from "../../lib/inbox-provider";
import { useLanguage } from "../../lib/language-provider";
import { supabase } from "../../lib/supabase/client";

/*
 * Your account, and the workspace you are looking at.
 *
 * Three of these can be changed from here: the name on your account, the name
 * this workspace's team sees, and -- if you own or administer it -- the
 * workspace's own name. Everything else is either derived (how many rooms,
 * how many people) or a flow with verification in it, like an email address
 * or a password, which stays where the verification lives.
 */

/* A row that turns into a field, saves, and turns back. */
function EditableRow({
  icon,
  label,
  value,
  placeholder,
  first,
  onSave,
}: {
  icon: IconName;
  label: string;
  value: string;
  placeholder: string;
  first?: boolean;
  onSave: (next: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  async function save() {
    const next = draft.trim();

    if (!next || busy) return;

    setBusy(true);
    setError("");

    try {
      const failure = await onSave(next);

      if (failure) {
        setError(failure);
        return;
      }

      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || "not set"}. Change it.`}
        onPress={() => setEditing(true)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 13,
          borderTopWidth: first ? 0 : 1,
          borderTopColor: colors.border,
          backgroundColor: pressed ? colors.pale : "transparent",
        })}
      >
        <Ionicons name={icon} size={17} color={colors.muted} />

        <Text style={{ flex: 1, fontSize: 13, color: colors.muted }}>
          {label}
        </Text>

        <Text
          numberOfLines={1}
          style={{
            flexShrink: 1,
            maxWidth: "52%",
            fontSize: 14.5,
            fontWeight: "600",
            color: value ? colors.ink : colors.muted,
            textAlign: "right",
          }}
        >
          {value || "—"}
        </Text>

        <Ionicons name="pencil" size={14} color={colors.muted} />
      </Pressable>
    );
  }

  return (
    <View
      style={{
        gap: 9,
        paddingHorizontal: 14,
        paddingVertical: 13,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name={icon} size={15} color={colors.muted} />

        <Text style={{ fontSize: 12.5, color: colors.muted }}>{label}</Text>
      </View>

      <TextInput
        value={draft}
        onChangeText={setDraft}
        autoFocus
        editable={!busy}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, { fontSize: 15, paddingVertical: 10 }]}
      />

      {error ? (
        <Text style={{ fontSize: 12.5, color: colors.red }}>{error}</Text>
      ) : null}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          disabled={busy || !draft.trim()}
          onPress={() => void save()}
          style={({ pressed }) => ({
            paddingHorizontal: 16,
            paddingVertical: 9,
            borderRadius: 10,
            opacity: draft.trim() ? 1 : 0.45,
            backgroundColor: pressed ? "#0072AB" : colors.blue,
          })}
        >
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: "white", fontSize: 13.5, fontWeight: "800" }}>
              Save
            </Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            setDraft(value);
            setError("");
            setEditing(false);
          }}
          style={{ paddingHorizontal: 14, paddingVertical: 9 }}
        >
          <Text style={{ color: colors.muted, fontSize: 13.5, fontWeight: "700" }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  first,
}: {
  icon: IconName;
  label: string;
  value: string;
  first?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 13,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      <Ionicons name={icon} size={17} color={colors.muted} />

      <Text style={{ flex: 1, fontSize: 13, color: colors.muted }}>
        {label}
      </Text>

      <Text
        numberOfLines={1}
        style={{
          flexShrink: 1,
          maxWidth: "58%",
          fontSize: 14.5,
          fontWeight: "600",
          color: colors.ink,
          textAlign: "right",
        }}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

export function InformationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth();
  const { member, workspace, workspaces, rooms, roster, loadWorkspaces, refresh } =
    useInbox();
  const { t } = useLanguage();
  const account = useAccount();

  /* Renaming the workspace is the owner's call, and the server says so too. */
  const canRenameWorkspace =
    member?.role === "owner" || member?.role === "admin";

  /*
   * The account's own name, changed the same way the website changes it: the
   * value lives in the auth user's metadata, so it follows this person to
   * every workspace and every device rather than to this one shop.
   */
  async function saveAccountName(next: string) {
    const { error } = await supabase.auth.updateUser({
      data: { full_name: next },
    });

    return error ? error.message : null;
  }

  /*
   * The name the team sees. A separate row on team_members, and separate on
   * purpose: a shop invites "sales2@", the person turns out to be Dara, and
   * every assignment and mention in the workspace has been saying sales2@
   * ever since.
   */
  async function saveMemberName(next: string) {
    try {
      await api("/api/team/members", workspace?.businessId, {
        method: "PATCH",
        body: { fullName: next },
      });

      await refresh();

      return null;
    } catch (saveError) {
      return saveError instanceof Error
        ? saveError.message
        : "Unable to save that name.";
    }
  }

  async function saveWorkspaceName(next: string) {
    try {
      await api("/api/workspaces", workspace?.businessId, {
        method: "PATCH",
        body: { businessName: next },
      });

      await loadWorkspaces();

      return null;
    } catch (saveError) {
      return saveError instanceof Error
        ? saveError.message
        : "Unable to rename this workspace.";
    }
  }

  // "agent" reads like a typo next to every other value on the screen.
  const role = member?.role
    ? member.role[0].toUpperCase() + member.role.slice(1)
    : "";

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title={t("Information", "ព័ត៌មាន")}
      detail={t("Your account and workspace", "គណនី និងកន្លែងធ្វើការ")}
    >
      <SettingsGroup title={t("You", "អ្នក")}>
        <EditableRow
          first
          icon="person-outline"
          label={t("Name", "ឈ្មោះ")}
          value={account.name ?? ""}
          placeholder={t("Your name", "ឈ្មោះរបស់អ្នក")}
          onSave={saveAccountName}
        />
        <Row
          icon="mail-outline"
          label={t("Email", "អ៊ីមែល")}
          value={account.email ?? ""}
        />
        {account.phone ? (
          <Row
            icon="call-outline"
            label={t("Phone", "ទូរស័ព្ទ")}
            value={account.phone}
          />
        ) : null}
        <Row
          icon="ribbon-outline"
          label={t("Role here", "តួនាទីនៅទីនេះ")}
          value={role}
        />

        {/*
          Always, now that it can be changed. It used to appear only when it
          differed from the account name, which meant the one row that could
          fix a wrong name was invisible until somebody had already noticed
          the name was wrong.
        */}
        <EditableRow
          icon="people-circle-outline"
          label={t("Shown to the team as", "ក្រុមមើលឃើញជា")}
          value={member?.full_name ?? ""}
          placeholder={t("Name your team sees", "ឈ្មោះដែលក្រុមមើលឃើញ")}
          onSave={saveMemberName}
        />
      </SettingsGroup>

      <SettingsGroup title={t("Workspace", "កន្លែងធ្វើការ")}>
        {canRenameWorkspace ? (
          <EditableRow
            first
            icon="business-outline"
            label={t("Name", "ឈ្មោះ")}
            value={workspace?.businessName ?? ""}
            placeholder={t("Workspace name", "ឈ្មោះកន្លែងធ្វើការ")}
            onSave={saveWorkspaceName}
          />
        ) : (
          <Row
            first
            icon="business-outline"
            label={t("Name", "ឈ្មោះ")}
            value={workspace?.businessName ?? ""}
          />
        )}
        <Row
          icon="people-outline"
          label={t("Team", "ក្រុម")}
          value={
            roster.length > 0
              ? t(
                  roster.length + (roster.length === 1 ? " person" : " people"),
                  roster.length + " នាក់",
                )
              : "—"
          }
        />
        <Row
          icon="chatbubbles-outline"
          label={t("Team rooms", "បន្ទប់ក្រុម")}
          value={rooms.length > 0 ? String(rooms.length) : "—"}
        />
        <Row
          icon="albums-outline"
          label={t("Workspaces you can reach", "កន្លែងធ្វើការដែលអ្នកចូលបាន")}
          value={String(workspaces.length)}
        />
      </SettingsGroup>

      <Text
        style={[styles.muted, { fontSize: 12, paddingHorizontal: 2, lineHeight: 18 }]}
      >
        {t(
          "Your email and picture come from your account and change on the web, under Profile information. Your password is under Login and security, on this phone.",
          "អ៊ីមែល និងរូបភាព ប្តូរនៅលើគេហទំព័រ។ ពាក្យសម្ងាត់ស្ថិតក្រោម ការចូល និងសុវត្ថិភាព នៅលើទូរស័ព្ទនេះ។",
        )}
      </Text>
    </SlidePanel>
  );
}
