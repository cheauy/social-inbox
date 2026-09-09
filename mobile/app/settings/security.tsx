import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Switch,
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
import { useLanguage } from "../../lib/language-provider";

/*
 * Login and security: your password, your recovery address, and every device
 * holding a session.
 *
 * This row opened a browser before, and the reason given was that a page
 * asking for a password is not something this app should show. That was the
 * wrong line to draw. The app should never ask for a password to *get in* --
 * the session already lives in the keychain, and a sign-in form inside an app
 * is how credentials get phished. Changing your own password, having already
 * proved who you are, is a different act, and the device you carry is where
 * you notice you need to do it.
 *
 * The list underneath is the one that matters after a lost phone, and reading
 * it on the phone you still have is exactly the right place: every session on
 * your account, and a way to end them.
 */

type Session = {
  id: string;
  isCurrent: boolean;
  browser: string;
  operatingSystem: string;
  deviceType: string;
  label: string;
  ip: string | null;
  lastActiveAt: string | null;
};

/* The four the API can answer with -- "phone", not "mobile". */
const DEVICE_ICON: Record<string, IconName> = {
  phone: "phone-portrait-outline",
  tablet: "tablet-portrait-outline",
  desktop: "desktop-outline",
  unknown: "help-circle-outline",
};

const when = (value: string | null) => {
  if (!value) return "—";

  const at = new Date(value);

  if (!Number.isFinite(at.getTime())) return "—";

  return (
    at.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    ", " +
    at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  );
};

export default function Security() {
  const { workspace } = useInbox();
  const { t } = useLanguage();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [supported, setSupported] = useState(true);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [changing, setChanging] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordDone, setPasswordDone] = useState(false);

  const [recoveryDraft, setRecoveryDraft] = useState("");
  const [savingRecovery, setSavingRecovery] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState("");

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    try {
      const [devices, address] = await Promise.all([
        api<{ supported?: boolean; sessions?: Session[] }>(
          "/api/settings/sessions",
          workspace.businessId,
        ).catch(() => ({ supported: false, sessions: [] })),

        api<{ recoveryEmail?: string | null }>(
          "/api/account/recovery-email",
          workspace.businessId,
        ).catch(() => ({ recoveryEmail: null })),
      ]);

      setSessions(devices.sessions ?? []);
      setSupported(devices.supported !== false);
      setRecovery(address.recoveryEmail ?? null);
      setRecoveryDraft(address.recoveryEmail ?? "");
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load your security settings.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspace?.businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function changePassword() {
    if (!workspace) return;

    if (!current || !next) {
      setPasswordError(
        t(
          "Both your current password and the new one are needed.",
          "ត្រូវការទាំងពាក្យសម្ងាត់បច្ចុប្បន្ន និងពាក្យសម្ងាត់ថ្មី។",
        ),
      );
      return;
    }

    setChanging(true);
    setPasswordError("");
    setPasswordDone(false);

    try {
      await api("/api/account/password", workspace.businessId, {
        method: "POST",
        body: {
          currentPassword: current,
          newPassword: next,
          signOutOtherSessions: signOutOthers,
        },
      });

      setCurrent("");
      setNext("");
      setPasswordDone(true);
      await load();
    } catch (changeError) {
      setPasswordError(
        changeError instanceof Error
          ? changeError.message
          : "Unable to change your password.",
      );
    } finally {
      setChanging(false);
    }
  }

  async function saveRecovery() {
    if (!workspace) return;

    setSavingRecovery(true);
    setRecoveryNotice("");

    try {
      await api("/api/account/recovery-email", workspace.businessId, {
        method: "POST",
        body: { recoveryEmail: recoveryDraft.trim() || null },
      });

      setRecovery(recoveryDraft.trim() || null);
      setRecoveryNotice(t("Saved.", "បានរក្សាទុក។"));
    } catch (saveError) {
      setRecoveryNotice(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save that address.",
      );
    } finally {
      setSavingRecovery(false);
    }
  }

  function confirmRevoke(session: Session) {
    Alert.alert(
      t("Sign this device out?", "ចាកចេញពីឧបករណ៍នេះ?"),
      t(
        session.label + " will have to sign in again.",
        session.label + " នឹងត្រូវចូលម្តងទៀត។",
      ),
      [
        { text: t("Cancel", "បោះបង់"), style: "cancel" },
        {
          text: t("Sign out", "ចាកចេញ"),
          style: "destructive",
          onPress: () => void revoke(session),
        },
      ],
    );
  }

  async function revoke(session: Session) {
    if (!workspace) return;

    try {
      await api("/api/settings/sessions/revoke", workspace.businessId, {
        method: "POST",
        body: { scope: "session", sessionId: session.id },
      });

      await load();
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Unable to end that session.",
      );
    }
  }

  return (
    <SettingsScreen
      title={t("Login and security", "ការចូល និងសុវត្ថិភាព")}
      detail={t("Password, recovery and devices", "ពាក្យសម្ងាត់ និងឧបករណ៍")}
      loading={loading}
      error={error}
      onRetry={() => void load()}
    >
      <SettingsGroup title={t("Change password", "ប្តូរពាក្យសម្ងាត់")}>
        <View style={{ padding: 14, gap: 12 }}>
          {passwordError ? (
            <Text
              accessibilityRole="alert"
              style={{ color: colors.red, fontSize: 13, lineHeight: 19 }}
            >
              {passwordError}
            </Text>
          ) : null}

          {passwordDone ? (
            <Text style={{ color: "#2FA36B", fontSize: 13, lineHeight: 19 }}>
              {t(
                "Your password has been changed.",
                "ពាក្យសម្ងាត់របស់អ្នកត្រូវបានប្តូរ។",
              )}
            </Text>
          ) : null}

          <Secret
            label={t("Current password", "ពាក្យសម្ងាត់បច្ចុប្បន្ន")}
            value={current}
            onChange={setCurrent}
          />

          <Secret
            label={t("New password", "ពាក្យសម្ងាត់ថ្មី")}
            value={next}
            onChange={setNext}
          />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.ink }}>
                {t("Sign out other devices", "ចាកចេញពីឧបករណ៍ផ្សេង")}
              </Text>
              <Text style={[styles.muted, { fontSize: 12, lineHeight: 17 }]}>
                {t(
                  "The usual reason to change a password is that somebody else may know it.",
                  "ហេតុផលធម្មតាក្នុងការប្តូរពាក្យសម្ងាត់ គឺដោយសារអ្នកផ្សេងអាចដឹងវា។",
                )}
              </Text>
            </View>

            <Switch
              value={signOutOthers}
              onValueChange={setSignOutOthers}
              trackColor={{ true: colors.blue, false: colors.border }}
              thumbColor="white"
            />
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={changing}
            onPress={() => void changePassword()}
            style={({ pressed }) => ({
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 13,
              borderRadius: 13,
              backgroundColor: pressed ? "#0A6FA8" : colors.blue,
              opacity: changing ? 0.6 : 1,
            })}
          >
            {changing ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontSize: 15, fontWeight: "700" }}>
                {t("Change password", "ប្តូរពាក្យសម្ងាត់")}
              </Text>
            )}
          </Pressable>
        </View>
      </SettingsGroup>

      <SettingsGroup title={t("Recovery email", "អ៊ីមែលសង្គ្រោះ")}>
        <View style={{ padding: 14, gap: 10 }}>
          <Text style={[styles.muted, { fontSize: 12.5, lineHeight: 18 }]}>
            {t(
              "Where TENH writes if you are locked out. A second address, not the one you sign in with.",
              "កន្លែងដែល TENH ផ្ញើទៅ បើអ្នកចូលមិនបាន។ ជាអាសយដ្ឋានទីពីរ មិនមែនអាសយដ្ឋានចូលទេ។",
            )}
          </Text>

          <TextInput
            value={recoveryDraft}
            onChangeText={(value) => {
              setRecoveryDraft(value);
              setRecoveryNotice("");
            }}
            placeholder={recovery ?? "name@example.com"}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{
              height: 46,
              paddingHorizontal: 13,
              borderRadius: 13,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: "white",
              fontSize: 15,
              color: colors.ink,
            }}
          />

          {recoveryNotice ? (
            <Text style={[styles.muted, { fontSize: 12.5 }]}>
              {recoveryNotice}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={savingRecovery || recoveryDraft.trim() === (recovery ?? "")}
            onPress={() => void saveRecovery()}
            style={({ pressed }) => ({
              alignItems: "center",
              paddingVertical: 12,
              borderRadius: 13,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.pale : "white",
              opacity:
                savingRecovery || recoveryDraft.trim() === (recovery ?? "")
                  ? 0.5
                  : 1,
            })}
          >
            <Text
              style={{ color: colors.blue, fontSize: 14.5, fontWeight: "700" }}
            >
              {t("Save recovery email", "រក្សាទុកអ៊ីមែលសង្គ្រោះ")}
            </Text>
          </Pressable>
        </View>
      </SettingsGroup>

      <SettingsGroup
        title={t(
          "Devices signed in · " + sessions.length,
          "ឧបករណ៍ដែលបានចូល · " + sessions.length,
        )}
      >
        {!supported || sessions.length === 0 ? (
          <Text
            style={[
              styles.muted,
              { fontSize: 13, padding: 16, textAlign: "center", lineHeight: 19 },
            ]}
          >
            {t(
              "TENH cannot list your other devices on this workspace. Changing your password with the switch above still ends every other session.",
              "TENH មិនអាចបង្ហាញឧបករណ៍ផ្សេងទេ។ ការប្តូរពាក្យសម្ងាត់ខាងលើនៅតែបញ្ចប់វគ្គផ្សេងទាំងអស់។",
            )}
          </Text>
        ) : (
          sessions.map((session, index) => (
            <View
              key={session.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
              }}
            >
              <Ionicons
                name={DEVICE_ICON[session.deviceType] ?? DEVICE_ICON.unknown}
                size={19}
                color={session.isCurrent ? colors.blue : colors.muted}
              />

              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 14.5, fontWeight: "600", color: colors.ink }}
                >
                  {session.label}
                </Text>
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  {session.isCurrent
                    ? t("This phone", "ទូរស័ព្ទនេះ")
                    : when(session.lastActiveAt)}
                  {session.ip ? " · " + session.ip : ""}
                </Text>
              </View>

              {session.isCurrent ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    "Sign out " + session.label,
                    "ចាកចេញ " + session.label,
                  )}
                  onPress={() => confirmRevoke(session)}
                  hitSlop={10}
                  style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                >
                  <Ionicons name="log-out-outline" size={19} color={colors.red} />
                </Pressable>
              )}
            </View>
          ))
        )}
      </SettingsGroup>
    </SettingsScreen>
  );
}

function Secret({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);

  return (
    <View style={{ gap: 6 }}>
      <Text
        style={{
          paddingLeft: 4,
          fontSize: 11,
          fontWeight: "800",
          letterSpacing: 0.7,
          textTransform: "uppercase",
          color: colors.muted,
        }}
      >
        {label}
      </Text>

      <View style={{ justifyContent: "center" }}>
        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={!shown}
          autoCapitalize="none"
          autoCorrect={false}
          /*
            Off, so a password never reaches the keyboard's learned words or a
            suggestion strip somebody else can see.
          */
          autoComplete="off"
          textContentType="password"
          style={{
            height: 46,
            paddingLeft: 13,
            paddingRight: 44,
            borderRadius: 13,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: "white",
            fontSize: 15,
            color: colors.ink,
          }}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={shown ? "Hide" : "Show"}
          onPress={() => setShown((on) => !on)}
          hitSlop={8}
          style={{ position: "absolute", right: 12 }}
        >
          <Ionicons
            name={shown ? "eye-off-outline" : "eye-outline"}
            size={19}
            color={colors.muted}
          />
        </Pressable>
      </View>
    </View>
  );
}
