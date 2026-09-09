import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { Avatar, IconName, colors, styles } from "../../components/ui";
import { useAuth } from "../../lib/auth/provider";
import { useInbox } from "../../lib/inbox-provider";

/*
 * Everything about you and the workspace you are in, behind the card at the
 * top of Settings.
 *
 * Those three were scattered before: your own details nowhere, the plan on a
 * tab of its own along the bottom, and the connected pages only visible as
 * marks on an avatar. They belong together because they answer one question
 * -- who am I here, and what is this workspace -- and none of them is worth a
 * fifth of a tab bar.
 */

const ROWS: {
  icon: IconName;
  label: string;
  detail: string;
  route: string;
}[] = [
  {
    icon: "person-outline",
    label: "Information",
    detail: "Your account and this workspace.",
    route: "/settings/information",
  },
  {
    icon: "card-outline",
    label: "Subscription",
    detail: "The plan, when it renews, and what it allows.",
    route: "/settings/subscription",
  },
  {
    icon: "link-outline",
    label: "Integration",
    detail: "Facebook pages and Telegram bots.",
    route: "/settings/integration",
  },
];

export default function Profile() {
  const router = useRouter();
  const { session } = useAuth();
  const { member, workspace } = useInbox();

  return (
    <SettingsScreen title="Profile" detail={workspace?.businessName ?? "TENH"}>
      <View
        style={{
          alignItems: "center",
          gap: 8,
          paddingVertical: 22,
          borderRadius: 16,
          backgroundColor: "white",
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Avatar
          name={member?.full_name}
          uri={member?.profile_picture_url}
          size={72}
        />

        <Text style={[styles.heading, { fontSize: 20 }]}>
          {member?.full_name ?? "You"}
        </Text>

        <Text style={[styles.muted, { fontSize: 13 }]}>
          {member?.email ?? session?.user.email}
        </Text>

        <View
          style={{
            paddingHorizontal: 11,
            paddingVertical: 5,
            borderRadius: 999,
            backgroundColor: colors.pale,
          }}
        >
          <Text
            style={{
              fontSize: 11.5,
              fontWeight: "800",
              color: colors.blue,
              textTransform: "capitalize",
            }}
          >
            {member?.role ?? "member"}
          </Text>
        </View>
      </View>

      <SettingsGroup>
        {ROWS.map((row, index) => (
          <Pressable
            key={row.label}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            onPress={() => router.push(row.route as never)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 13,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colors.border,
              backgroundColor: pressed ? colors.pale : "transparent",
            })}
          >
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.pale,
              }}
            >
              <Ionicons name={row.icon} size={17} color={colors.blue} />
            </View>

            <View style={{ flex: 1 }}>
              <Text
                style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}
              >
                {row.label}
              </Text>
              <Text style={[styles.muted, { fontSize: 12.5 }]}>
                {row.detail}
              </Text>
            </View>

            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
      </SettingsGroup>
    </SettingsScreen>
  );
}
