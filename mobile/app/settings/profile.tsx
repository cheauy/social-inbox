import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { InformationPanel } from "../../components/profile/information";
import { IntegrationPanel } from "../../components/profile/integration";
import { SubscriptionPanel } from "../../components/profile/subscription";
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
 *
 * Each one opens as a panel over this page rather than as a screen pushed on
 * top of it, the way the customer record does: you go in to look something
 * up, and a flick to the right puts it away.
 */

type Section = "information" | "subscription" | "integration";

const ROWS: {
  icon: IconName;
  label: string;
  detail: string;
  section: Section;
}[] = [
  {
    icon: "person-outline",
    label: "Information",
    detail: "Your account and this workspace.",
    section: "information",
  },
  {
    icon: "card-outline",
    label: "Subscription",
    detail: "The plan, when it renews, and what it allows.",
    section: "subscription",
  },
  {
    icon: "link-outline",
    label: "Integration",
    detail: "Facebook pages and Telegram bots.",
    section: "integration",
  },
];

/* Long enough for the panel to finish sliding out before it is torn down. */
const EXIT = 220;

export default function Profile() {
  const { session } = useAuth();
  const { member, workspace } = useInbox();

  /*
   * Two pieces of state, because they answer different questions: `section`
   * is what is mounted, `open` is whether it is on screen. Dropping the
   * section the moment Close is tapped would take the panel with it mid-
   * animation, and each of these fetches, so keeping all three mounted the
   * whole time would mean three requests on opening the wrong one.
   */
  const [section, setSection] = useState<Section | null>(null);
  const [open, setOpen] = useState(false);

  const exit = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (exit.current) clearTimeout(exit.current);
    },
    [],
  );

  const show = useCallback((next: Section) => {
    if (exit.current) clearTimeout(exit.current);
    setSection(next);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    exit.current = setTimeout(() => setSection(null), EXIT);
  }, []);

  return (
    <>
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
              onPress={() => show(row.section)}
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

      {section === "information" ? (
        <InformationPanel open={open} onClose={close} />
      ) : null}

      {section === "subscription" ? (
        <SubscriptionPanel open={open} onClose={close} />
      ) : null}

      {section === "integration" ? (
        <IntegrationPanel open={open} onClose={close} />
      ) : null}
    </>
  );
}
