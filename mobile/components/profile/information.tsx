import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { SettingsGroup } from "../settings-screen";
import { SlidePanel } from "../slide-panel";
import { IconName, colors, styles } from "../ui";
import { useAuth } from "../../lib/auth/provider";
import { useInbox } from "../../lib/inbox-provider";
import { useLanguage } from "../../lib/language-provider";

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

export function InformationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth();
  const { member, workspace, workspaces, rooms, roster } = useInbox();
  const { t } = useLanguage();

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
        <Row
          first
          icon="person-outline"
          label={t("Name", "ឈ្មោះ")}
          value={member?.full_name ?? ""}
        />
        <Row
          icon="mail-outline"
          label={t("Email", "អ៊ីមែល")}
          value={member?.email ?? session?.user.email ?? ""}
        />
        <Row
          icon="ribbon-outline"
          label={t("Role here", "តួនាទីនៅទីនេះ")}
          value={role}
        />
      </SettingsGroup>

      <SettingsGroup title={t("Workspace", "កន្លែងធ្វើការ")}>
        <Row
          first
          icon="business-outline"
          label={t("Name", "ឈ្មោះ")}
          value={workspace?.businessName ?? ""}
        />
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
          "Changing your name is on the web. Your password is under Login and security, on this phone.",
          "ការប្តូរឈ្មោះ គឺនៅលើគេហទំព័រ។ ពាក្យសម្ងាត់ស្ថិតក្រោម ការចូល និងសុវត្ថិភាព នៅលើទូរស័ព្ទនេះ។",
        )}
      </Text>
    </SlidePanel>
  );
}
