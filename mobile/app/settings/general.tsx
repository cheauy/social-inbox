import { Ionicons } from "@expo/vector-icons";
import { Linking, Pressable, Switch, Text, View } from "react-native";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { colors, styles } from "../../components/ui";
import { useLanguage } from "../../lib/language-provider";
import { SOUNDS, useNotificationSound } from "../../lib/notification-sound";

/*
 * General: the sound a new message makes.
 *
 * The workspace's own name, time zone and contact details are the other half
 * of this page on the web and stay there -- they are typed once when the
 * workspace is set up and changed almost never, and every one of them is a
 * text field an owner wants a keyboard for.
 */

const WEB = process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com";

export default function General() {
  const { t } = useLanguage();
  const { sound, enabled, setSound, setEnabled, play } = useNotificationSound();

  return (
    <SettingsScreen
      title={t("General", "ទូទៅ")}
      detail={t("Sound for new messages", "សំឡេងសម្រាប់សារថ្មី")}
    >
      <SettingsGroup title={t("Notifications", "ការជូនដំណឹង")}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
          }}
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
            <Ionicons
              name={enabled ? "volume-high-outline" : "volume-mute-outline"}
              size={17}
              color={colors.blue}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}>
              {t("Play a sound", "បើកសំឡេង")}
            </Text>
            <Text style={[styles.muted, { fontSize: 12.5 }]}>
              {t(
                "When a customer writes while you have TENH open.",
                "ពេលអតិថិជនផ្ញើសារខណៈអ្នកកំពុងបើក TENH។",
              )}
            </Text>
          </View>

          <Switch
            value={enabled}
            onValueChange={(on) => void setEnabled(on)}
            trackColor={{ true: colors.blue, false: colors.border }}
            thumbColor="white"
          />
        </View>
      </SettingsGroup>

      <SettingsGroup title={t("Notification sound", "សំឡេងជូនដំណឹង")}>
        {SOUNDS.map((option, index) => {
          const active = option.id === sound;

          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              /*
                Choosing plays it. Picking an alert tone you cannot hear is
                picking a name, and the names here are numbers.
              */
              onPress={() => {
                void setSound(option.id);
                play(option.id);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 13,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
                backgroundColor: pressed ? colors.pale : "transparent",
                opacity: enabled ? 1 : 0.5,
              })}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: active ? colors.blue : colors.pale,
                }}
              >
                <Ionicons
                  name="play"
                  size={15}
                  color={active ? "white" : colors.blue}
                />
              </View>

              <Text
                style={{
                  flex: 1,
                  fontSize: 15,
                  color: colors.ink,
                  fontWeight: active ? "800" : "500",
                }}
              >
                {t(option.label, option.km)}
              </Text>

              {active ? (
                <Ionicons name="checkmark" size={19} color={colors.blue} />
              ) : null}
            </Pressable>
          );
        })}
      </SettingsGroup>

      <Text
        style={[styles.muted, { fontSize: 12, paddingHorizontal: 2, lineHeight: 18 }]}
      >
        {t(
          "Six of the web's own sounds, by the same numbers. The workspace name, time zone and contact details are on the web.",
          "សំឡេងទាំងប្រាំមួយដូចនៅលើគេហទំព័រ ដោយប្រើលេខដូចគ្នា។ ឈ្មោះ​កន្លែងធ្វើការ ល្វែងម៉ោង និងព័ត៌មានទំនាក់ទំនង នៅលើគេហទំព័រ។",
        )}
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={() => void Linking.openURL(`${WEB}/dashboard/settings/general`)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingVertical: 14,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: pressed ? colors.pale : "white",
        })}
      >
        <Ionicons name="open-outline" size={16} color={colors.blue} />

        <Text style={{ color: colors.blue, fontSize: 14.5, fontWeight: "700" }}>
          {t("Workspace details on the web", "ព័ត៌មានកន្លែងធ្វើការនៅលើគេហទំព័រ")}
        </Text>
      </Pressable>
    </SettingsScreen>
  );
}
