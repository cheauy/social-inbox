import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { IconName, colors, styles } from "../../components/ui";
import { useAuth } from "../../lib/auth/provider";
import { useInbox } from "../../lib/inbox-provider";

/*
 * Your account, and the workspace you are looking at.
 *
 * Read-only. Changing a name or a password is a flow with verification in it,
 * and the app deliberately never shows a password field -- so those stay on
 * the web and this says where they are rather than starting something it
 * cannot finish.
 */

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

export default function Information() {
  const { session } = useAuth();
  const { member, workspace, workspaces, rooms, roster } = useInbox();

  // "agent" reads like a typo next to every other value on the screen.
  const role = member?.role
    ? member.role[0].toUpperCase() + member.role.slice(1)
    : "";

  return (
    <SettingsScreen title="Information" detail="Your account and workspace">
      <SettingsGroup title="You">
        <Row
          first
          icon="person-outline"
          label="Name"
          value={member?.full_name ?? ""}
        />
        <Row
          icon="mail-outline"
          label="Email"
          value={member?.email ?? session?.user.email ?? ""}
        />
        <Row
          icon="ribbon-outline"
          label="Role here"
          value={role}
        />
      </SettingsGroup>

      <SettingsGroup title="Workspace">
        <Row
          first
          icon="business-outline"
          label="Name"
          value={workspace?.businessName ?? ""}
        />
        <Row
          icon="people-outline"
          label="Team"
          value={
            roster.length > 0
              ? `${roster.length} ${roster.length === 1 ? "person" : "people"}`
              : "—"
          }
        />
        <Row
          icon="chatbubbles-outline"
          label="Team rooms"
          value={rooms.length > 0 ? String(rooms.length) : "—"}
        />
        <Row
          icon="albums-outline"
          label="Workspaces you can reach"
          value={String(workspaces.length)}
        />
      </SettingsGroup>

      <Text
        style={[styles.muted, { fontSize: 12, paddingHorizontal: 2, lineHeight: 18 }]}
      >
        Changing your name or your password is on the web, under Login and
        security. Both need a verification step, and this app never shows a
        password field.
      </Text>
    </SettingsScreen>
  );
}
