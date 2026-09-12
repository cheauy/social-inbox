import { AuthImage } from "../../components/auth-image";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";

import {
  SaveBar,
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { colors, styles } from "../../components/ui";
import {
  CHAT_BACKGROUNDS,
  ChatBackgroundId,
  DEFAULT_BACKGROUND,
  useDisplay,
} from "../../lib/display-provider";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LanguageId,
  useLanguage,
} from "../../lib/language-provider";

/*
 * Display: the chat background, and the language.
 *
 * Both are per-device on the web too -- they live in that browser's storage,
 * not on the workspace -- so the phone keeps its own, in the same place it
 * keeps the session. The five backgrounds are the web's five, by the same
 * ids, so a background chosen on a laptop is a background you recognise here.
 *
 * Held as a draft and applied on Save, like the web's own display page. The
 * language especially: switching it the instant a row is touched turns the
 * screen you are standing on into a language you may have tapped by mistake,
 * and the way back is now written in it.
 */

export default function Display() {
  const { background, setBackground } = useDisplay();
  const { language, setLanguage, t } = useLanguage();

  const [draftBackground, setDraftBackground] =
    useState<ChatBackgroundId>(background);
  const [draftLanguage, setDraftLanguage] = useState<LanguageId>(language);

  const dirty = draftBackground !== background || draftLanguage !== language;

  const isDefault =
    draftBackground === DEFAULT_BACKGROUND && draftLanguage === DEFAULT_LANGUAGE;

  async function save() {
    await setBackground(draftBackground);
    await setLanguage(draftLanguage);
  }

  async function reset() {
    setDraftBackground(DEFAULT_BACKGROUND);
    setDraftLanguage(DEFAULT_LANGUAGE);
    await setBackground(DEFAULT_BACKGROUND);
    await setLanguage(DEFAULT_LANGUAGE);
  }

  return (
    <SettingsScreen
      title={t("Display", "ការបង្ហាញ")}
      detail={t("How this phone shows TENH", "របៀបដែលទូរស័ព្ទនេះបង្ហាញ TENH")}
      footer={
        <SaveBar
          dirty={dirty}
          canReset={!isDefault || dirty}
          onSave={() => void save()}
          onReset={() => void reset()}
        />
      }
    >
      <SettingsGroup title={t("Chat background", "ផ្ទៃខាងក្រោយឆាត")}>
        {CHAT_BACKGROUNDS.map((option, index) => {
          const active = option.id === draftBackground;

          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => setDraftBackground(option.id)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
                backgroundColor: pressed ? colors.pale : "transparent",
              })}
            >
              {/*
                The wallpaper itself, at the size a bubble sits on. A name
                like "Theme 3" tells nobody what they are choosing.
              */}
              <AuthImage
                uri={option.uri}
                resizeMode="cover"
                style={{
                  width: 46,
                  height: 36,
                  borderRadius: 9,
                  backgroundColor: colors.pale,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              />

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

      <SettingsGroup title={t("Language", "ភាសា")}>
        {LANGUAGES.map((option, index) => {
          const active = option.id === draftLanguage;

          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => setDraftLanguage(option.id)}
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
                <Ionicons name="language-outline" size={17} color={colors.blue} />
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 15,
                    color: colors.ink,
                    fontWeight: active ? "800" : "600",
                  }}
                >
                  {option.native}
                </Text>
                <Text style={[styles.muted, { fontSize: 12.5 }]}>
                  {option.detail}
                </Text>
              </View>

              {active ? (
                <Ionicons name="checkmark" size={19} color={colors.blue} />
              ) : null}
            </Pressable>
          );
        })}
      </SettingsGroup>
    </SettingsScreen>
  );
}
