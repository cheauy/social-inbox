import { Ionicons } from "@expo/vector-icons";
import { Image, Pressable, Text, View } from "react-native";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { colors, styles } from "../../components/ui";
import { CHAT_BACKGROUNDS, useDisplay } from "../../lib/display-provider";
import { LANGUAGES, useLanguage } from "../../lib/language-provider";

/*
 * Display: the chat background, and the language.
 *
 * Both are per-device on the web too -- they live in that browser's storage,
 * not on the workspace -- so the phone keeps its own, in the same place it
 * keeps the session. The five backgrounds are the web's five, by the same
 * ids, so a background chosen on a laptop is a background you recognise here.
 */

export default function Display() {
  const { background, setBackground } = useDisplay();
  const { language, setLanguage, t } = useLanguage();

  return (
    <SettingsScreen
      title={t("Display", "ការបង្ហាញ")}
      detail={t("How this phone shows TENH", "របៀបដែលទូរស័ព្ទនេះបង្ហាញ TENH")}
    >
      <SettingsGroup title={t("Chat background", "ផ្ទៃខាងក្រោយឆាត")}>
        {CHAT_BACKGROUNDS.map((option, index) => {
          const active = option.id === background;

          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => void setBackground(option.id)}
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
              <Image
                source={{ uri: option.uri }}
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
          const active = option.id === language;

          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => void setLanguage(option.id)}
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
