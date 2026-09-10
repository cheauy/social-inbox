import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { colors } from "./ui";
import type { TeamRoom } from "../lib/types";

export type TeamRoomIconKey = NonNullable<TeamRoom["icon"]>;

export const TEAM_ROOM_ICON_OPTIONS: Array<{
  key: TeamRoomIconKey;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}> = [
  { key: "people", label: "Team", icon: "people" },
  { key: "megaphone", label: "Announcements", icon: "megaphone" },
  { key: "briefcase", label: "Work", icon: "briefcase" },
  { key: "headset", label: "Support", icon: "headset" },
  { key: "cart", label: "Sales", icon: "cart" },
  { key: "rocket", label: "Launch", icon: "rocket" },
  { key: "heart", label: "Community", icon: "heart" },
  { key: "star", label: "Featured", icon: "star" },
];

export function TeamRoomIcon({ icon, size = 46 }: { icon?: TeamRoomIconKey; size?: number }) {
  const option = TEAM_ROOM_ICON_OPTIONS.find((item) => item.key === icon) ?? TEAM_ROOM_ICON_OPTIONS[0];

  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, alignItems: "center", justifyContent: "center", backgroundColor: colors.pale }}>
      <Ionicons name={option.icon} size={Math.round(size * 0.46)} color={colors.blue} />
    </View>
  );
}
