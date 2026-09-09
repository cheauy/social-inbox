import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import { IconName, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";

/*
 * Tell TENH something is broken, from the phone it broke on.
 *
 * The categories are the server's -- it rejects anything else -- and the
 * limits are its limits, so a subject that is going to be trimmed at 140
 * characters is stopped at 140 here rather than silently cut after sending.
 *
 * Attachments are on the web. The endpoint takes them through a separate
 * upload-and-confirm exchange, and a screenshot is the one thing somebody
 * reporting a problem from a phone already has -- so it is worth doing, just
 * not as an afterthought to this.
 */

const CATEGORIES: { key: string; label: string; icon: IconName }[] = [
  { key: "technical", label: "Something is broken", icon: "bug-outline" },
  { key: "facebook", label: "Facebook or Telegram", icon: "link-outline" },
  { key: "billing", label: "Billing or payment", icon: "card-outline" },
  { key: "account", label: "My account", icon: "person-outline" },
  { key: "other", label: "Something else", icon: "ellipsis-horizontal-outline" },
];

export default function Report() {
  const { workspace } = useInbox();

  const [category, setCategory] = useState("technical");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const ready = subject.trim().length > 0 && message.trim().length > 0;

  async function send() {
    if (!workspace || !ready || sending) {
      return;
    }

    setSending(true);
    setError("");

    try {
      await api("/api/customer-reports", workspace.businessId, {
        method: "POST",
        body: {
          category,
          subject: subject.trim(),
          message: message.trim(),
        },
      });

      setSubject("");
      setMessage("");

      Alert.alert(
        "Sent to TENH",
        "You will get a notification here when somebody picks it up.",
      );
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to send that report.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <SettingsScreen
      title="Report a problem"
      detail="Goes straight to the TENH team"
      error={error}
    >
      <SettingsGroup title="What is it about">
        {CATEGORIES.map((option, index) => {
          const active = option.key === category;

          return (
            <Pressable
              key={option.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setCategory(option.key)}
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
              <Ionicons
                name={option.icon}
                size={18}
                color={active ? colors.blue : colors.muted}
              />

              <Text
                style={{
                  flex: 1,
                  fontSize: 15,
                  color: colors.ink,
                  fontWeight: active ? "800" : "500",
                }}
              >
                {option.label}
              </Text>

              {active ? (
                <Ionicons name="checkmark" size={18} color={colors.blue} />
              ) : null}
            </Pressable>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="What happened">
        <View style={{ padding: 14, gap: 12 }}>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="One line: what went wrong"
            placeholderTextColor={colors.muted}
            maxLength={140}
            editable={!sending}
            style={styles.input}
          />

          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="What were you doing, and what did you expect instead? The more exact, the faster this gets fixed."
            placeholderTextColor={colors.muted}
            maxLength={5000}
            multiline
            editable={!sending}
            style={[styles.input, { minHeight: 140, textAlignVertical: "top" }]}
          />

          <Text style={[styles.muted, { fontSize: 12 }]}>
            {message.trim().length}/5000 · Screenshots can be attached on the
            web.
          </Text>
        </View>
      </SettingsGroup>

      <Pressable
        accessibilityRole="button"
        disabled={!ready || sending}
        onPress={() => void send()}
        style={({ pressed }) => [
          styles.button,
          { opacity: !ready || sending ? 0.4 : pressed ? 0.8 : 1 },
        ]}
      >
        {sending ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={{ color: "white", fontSize: 16, fontWeight: "700" }}>
            Send to TENH
          </Text>
        )}
      </Pressable>
    </SettingsScreen>
  );
}
