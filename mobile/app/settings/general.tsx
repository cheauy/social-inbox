import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  SaveBar,
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { colors, styles } from "../../components/ui";
import { useLanguage } from "../../lib/language-provider";
import {
  DEFAULT_SOUND,
  SOUNDS,
  SoundId,
  useNotificationSound,
} from "../../lib/notification-sound";

/*
 * General: the sound a new message makes.
 *
 * Held as a draft and applied on Save. Tapping a sound plays it -- that is
 * the only way to know what you are choosing -- but auditioning six tones is
 * not the same as picking one, and a screen that saved on every tap would
 * leave you on whichever you happened to hear last.
 */

export default function General() {
  const { t } = useLanguage();
  const { sound, enabled, setSound, setEnabled, play } = useNotificationSound();

  const insets = useSafeAreaInsets();

  const [draftSound, setDraftSound] = useState<SoundId>(sound);
  const [draftEnabled, setDraftEnabled] = useState(enabled);

  const dirty = draftSound !== sound || draftEnabled !== enabled;
  const isDefault = draftSound === DEFAULT_SOUND && draftEnabled;

  async function save() {
    await setSound(draftSound);
    await setEnabled(draftEnabled);
  }

  async function reset() {
    setDraftSound(DEFAULT_SOUND);
    setDraftEnabled(true);
    await setSound(DEFAULT_SOUND);
    await setEnabled(true);
  }

  return (
    <SettingsScreen
      title={t("General", "ទូទៅ")}
      detail={t("Sound for new messages", "សំឡេងសម្រាប់សារថ្មី")}
      footer={
        <SaveBar
          dirty={dirty}
          canReset={!isDefault || dirty}
          onSave={() => void save()}
          onReset={() => void reset()}
        />
      }
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
              name={draftEnabled ? "volume-high-outline" : "volume-mute-outline"}
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
            value={draftEnabled}
            onValueChange={setDraftEnabled}
            trackColor={{ true: colors.blue, false: colors.border }}
            thumbColor="white"
          />
        </View>
      </SettingsGroup>

      <SettingsGroup title={t("Notification sound", "សំឡេងជូនដំណឹង")}>
        {SOUNDS.map((option, index) => {
          const active = option.id === draftSound;

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
                setDraftSound(option.id);
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
                opacity: draftEnabled ? 1 : 0.5,
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
          "Six of the web's own sounds, by the same numbers.",
          "សំឡេងទាំងប្រាំមួយដូចនៅលើគេហទំព័រ ដោយប្រើលេខដូចគ្នា។",
        )}
      </Text>

      <View style={{ height: insets.bottom }} />
    </SettingsScreen>
  );
}
