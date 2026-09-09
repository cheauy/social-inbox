import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { colors, styles } from "../../components/ui";
import {
  CHAT_BACKGROUNDS,
  useDisplay,
} from "../../lib/display-provider";

/*
 * Display: the chat background, and the language.
 *
 * Both are per-device on the web too -- they live in that browser's storage,
 * not on the workspace -- so the phone keeps its own, in the same place it
 * keeps the session.
 *
 * The background is real and applies to the conversation thread as soon as it
 * is picked. The language is not offered yet, and the note below says so
 * rather than the screen carrying a Khmer option that changes nothing: every
 * string in this app is English, and a setting that quietly does nothing is
 * worse than an honest absence.
 */

export default function Display() {
  const { background, setBackground } = useDisplay();

  return (
    <SettingsScreen title="Display" detail="How this phone shows TENH">
      <SettingsGroup title="Chat background">
        {CHAT_BACKGROUNDS.map((option, index) => {
          const active = option.id === background;

          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
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
                The swatch is the colour itself, at the size a bubble sits on,
                because a name like "Warm" tells nobody what they are choosing.
              */}
              <View
                style={{
                  width: 44,
                  height: 34,
                  borderRadius: 9,
                  backgroundColor: option.color,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              />

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 15,
                    color: colors.ink,
                    fontWeight: active ? "800" : "500",
                  }}
                >
                  {option.label}
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

      <SettingsGroup title="Language">
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="language-outline" size={18} color={colors.muted} />

            <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink }}>
              English
            </Text>
          </View>

          <Text style={[styles.muted, { fontSize: 13, lineHeight: 19 }]}>
            The phone app is English only for now. Khmer will appear here when
            its screens are translated — until then there is nothing to switch
            between, and a switch that changed nothing would be worse than
            none. The web already offers both.
          </Text>
        </View>
      </SettingsGroup>
    </SettingsScreen>
  );
}
