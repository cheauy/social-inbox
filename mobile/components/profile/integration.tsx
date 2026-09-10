import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { SettingsGroup } from "../settings-screen";
import { SlidePanel } from "../slide-panel";
import { IconName, PlatformMark, colors, styles } from "../ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import { useLanguage } from "../../lib/language-provider";

/*
 * What this workspace is connected to, and how to connect more.
 *
 * This screen used to be a list and a link: it named the connected pages and
 * sent anybody who wanted another one to the website. Half of that was
 * necessary and half of it was not.
 *
 * Facebook genuinely is a browser round trip -- Meta will only hand a Page
 * token to a browser that has completed its own login and permission screens,
 * and TENH's callback lands on the website afterwards. That opens in the
 * system's auth browser now rather than kicking somebody out to Chrome, and
 * the list reloads the moment it closes, so a Page connected there appears
 * here without anybody being told to pull down.
 *
 * A Telegram bot is not a round trip at all. It is a token from BotFather and
 * one POST, which this app can do as well as the website can -- so it does,
 * and connecting a bot no longer needs a computer.
 */

type Channel = {
  id: string;
  businessId: string;
  platform: "facebook" | "telegram";
  name: string;
  username: string | null;
};

type AttentionPage = { id: string; name: string; status: string };

const WEB = process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com";

/*
 * What TENH has said publicly is coming. Named here rather than invented:
 * these are the three the website's own integrations page and the marketing
 * site both list, and a fourth would be a promise nobody has made.
 */
const COMING: { key: string; name: string; icon: IconName; tone: string; detail: string }[] = [
  {
    key: "instagram",
    name: "Instagram",
    icon: "logo-instagram",
    tone: "#C13584",
    detail: "Direct messages and comments from your Instagram account.",
  },
  {
    key: "whatsapp",
    name: "WhatsApp",
    icon: "logo-whatsapp",
    tone: "#25D366",
    detail: "WhatsApp Business messages in the same Inbox.",
  },
  {
    key: "tiktok",
    name: "TikTok",
    icon: "logo-tiktok",
    tone: "#010101",
    detail: "Messages and comments from your TikTok account.",
  },
];

export function IntegrationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace, settingsRevision, loadWorkspaces } = useInbox();
  const { t } = useLanguage();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [attention, setAttention] = useState<AttentionPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [botOpen, setBotOpen] = useState(false);
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState("");

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    try {
      const [live, health] = await Promise.all([
        api<{ channels: Channel[] }>(
          "/api/inbox/channels",
          workspace.businessId,
        ),
        api<{ pages: AttentionPage[] }>(
          "/api/facebook/connection-attention",
          workspace.businessId,
        ).catch(() => ({ pages: [] })),
      ]);

      setChannels(
        (live.channels ?? []).filter(
          (channel) => channel.businessId === workspace.businessId,
        ),
      );

      setAttention(health.pages ?? []);
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load your connections.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspace?.businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const seenSettingsRevision = useRef(settingsRevision);
  useEffect(() => {
    if (seenSettingsRevision.current === settingsRevision) return;
    seenSettingsRevision.current = settingsRevision;
    void load();
  }, [settingsRevision, load]);

  /*
   * Facebook, in the system's auth browser.
   *
   * Meta hands a Page token only to a browser that has been through its login
   * and permission screens, and TENH's callback finishes on the website -- so
   * this cannot be a form in the app. What it can be is a browser that comes
   * back: openAuthSessionAsync returns when the tab closes, and the list
   * reloads then, so a Page connected in there is on this screen by the time
   * somebody looks at it.
   */
  async function connectFacebook() {
    try {
      await WebBrowser.openAuthSessionAsync(
        `${WEB}/dashboard/integrations?connect=facebook`,
        `${WEB}/dashboard/integrations`,
      );
    } catch {
      // Dismissed, or no browser -- the reload below is still the right move.
    }

    await load();
    await loadWorkspaces();
  }

  /*
   * A Telegram bot, without leaving the app.
   *
   * The token is verified by the server against Telegram's own getMe before
   * anything is stored, so a mistyped one comes back as a message rather than
   * a channel that exists and never receives anything.
   */
  async function connectTelegram() {
    const value = token.trim();

    if (!value || connecting || !workspace) return;

    setConnecting(true);
    setError("");
    setConnected("");

    try {
      const result = await api<{ message?: string }>(
        "/api/telegram/connection",
        workspace.businessId,
        { method: "POST", body: { token: value } },
      );

      setToken("");
      setBotOpen(false);
      setConnected(result.message ?? "Telegram bot connected.");
      await load();
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Unable to connect that bot.",
      );
    } finally {
      setConnecting(false);
    }
  }

  function confirmDisconnect(channel: Channel) {
    Alert.alert(
      `Disconnect ${channel.name}?`,
      channel.platform === "telegram"
        ? "The bot stops delivering to TENH. Its conversations stay, and reconnecting the same bot picks them up again."
        : "Messages from this Page stop arriving and replies to them will fail. Its conversations stay, and reconnecting the Page picks them up again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => void disconnect(channel),
        },
      ],
    );
  }

  async function disconnect(channel: Channel) {
    if (!workspace) return;

    setError("");

    try {
      /*
       * Two shapes, because the two routes are two shapes: Telegram takes the
       * connection id on the query string of a DELETE, Facebook takes a POST
       * to the account's own disconnect path. Both ids are the social account
       * row the Inbox already knows this channel by.
       */
      if (channel.platform === "telegram") {
        await api(
          `/api/telegram/connection?connectionId=${encodeURIComponent(channel.id)}`,
          workspace.businessId,
          { method: "DELETE" },
        );
      } else {
        await api(
          `/api/facebook/connections/${encodeURIComponent(channel.id)}/disconnect`,
          workspace.businessId,
          { method: "POST", body: {} },
        );
      }

      await load();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Unable to disconnect that channel.",
      );
    }
  }

  const messenger = channels.filter(
    (channel) => channel.platform !== "telegram",
  );
  const telegram = channels.filter(
    (channel) => channel.platform === "telegram",
  );

  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title={t("Integration", "ការតភ្ជាប់")}
      detail={
        loading
          ? t("Loading…", "កំពុងផ្ទុក…")
          : t(channels.length + " connected", "ភ្ជាប់ " + channels.length)
      }
      loading={loading}
      error={error}
      onRetry={() => void load()}
      skeleton={[3, 1]}
    >
      {attention.length > 0 ? (
        <View
          style={{
            padding: 14,
            gap: 6,
            borderRadius: 16,
            backgroundColor: "#FFF1EF",
            borderWidth: 1,
            borderColor: colors.red,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="alert-circle" size={18} color={colors.red} />

            <Text
              style={{ flex: 1, fontSize: 15, fontWeight: "700", color: colors.red }}
            >
              {t(
                attention.length === 1
                  ? "A page needs reconnecting"
                  : attention.length + " pages need reconnecting",
                "ទំព័រ " + attention.length + " ត្រូវការភ្ជាប់ឡើងវិញ",
              )}
            </Text>
          </View>

          <Text style={[styles.muted, { fontSize: 13, lineHeight: 19 }]}>
            {attention.map((page) => page.name).join(", ")} — messages still
            arrive, but replies to them will fail until the Page is connected
            again.
          </Text>
        </View>
      ) : null}

      {connected ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            padding: 12,
            borderRadius: 14,
            backgroundColor: "#E7F6EE",
          }}
        >
          <Ionicons name="checkmark-circle" size={16} color="#26875C" />

          <Text style={{ flex: 1, fontSize: 13, color: "#1F6B4A" }}>
            {connected}
          </Text>
        </View>
      ) : null}

      <SettingsGroup
        title={t(
          "Messenger and comments · " + messenger.length,
          "Messenger និងមតិ · " + messenger.length,
        )}
      >
        {messenger.length === 0 ? (
          <Text
            style={[styles.muted, { fontSize: 13, padding: 16, textAlign: "center" }]}
          >
            {t(
              "No Facebook page is connected to this workspace.",
              "គ្មានទំព័រ Facebook ត្រូវបានភ្ជាប់ទេ។",
            )}
          </Text>
        ) : (
          messenger.map((channel, index) => (
            <ChannelRow
              key={channel.id}
              first={index === 0}
              mark={<PlatformMark platform="messenger" size={30} />}
              name={channel.name}
              detail={
                attention.some((page) => page.name === channel.name)
                  ? t("Needs reconnecting", "ត្រូវភ្ជាប់ឡើងវិញ")
                  : t("Connected", "បានភ្ជាប់")
              }
              tone={
                attention.some((page) => page.name === channel.name)
                  ? colors.red
                  : "#2FA36B"
              }
              onDisconnect={() => confirmDisconnect(channel)}
            />
          ))
        )}

        <Connect
          icon="logo-facebook"
          tone="#1877F2"
          label={t("Connect a Facebook Page", "ភ្ជាប់ទំព័រ Facebook")}
          detail={t(
            "Opens Facebook to choose the Page and grant access.",
            "បើក Facebook ដើម្បីជ្រើសទំព័រ។",
          )}
          first={messenger.length === 0}
          onPress={() => void connectFacebook()}
        />
      </SettingsGroup>

      <SettingsGroup title={"Telegram · " + telegram.length}>
        {telegram.length === 0 ? (
          <Text
            style={[styles.muted, { fontSize: 13, padding: 16, textAlign: "center" }]}
          >
            {t(
              "No Telegram bot is connected to this workspace.",
              "គ្មានបូត Telegram ត្រូវបានភ្ជាប់ទេ។",
            )}
          </Text>
        ) : (
          telegram.map((channel, index) => (
            <ChannelRow
              key={channel.id}
              first={index === 0}
              mark={<PlatformMark platform="telegram" size={30} />}
              name={channel.name}
              detail={channel.username ? `@${channel.username}` : "Telegram bot"}
              tone={colors.muted}
              onDisconnect={() => confirmDisconnect(channel)}
            />
          ))
        )}

        {botOpen ? (
          <View
            style={{
              gap: 10,
              paddingHorizontal: 14,
              paddingVertical: 14,
              borderTopWidth: telegram.length === 0 ? 0 : 1,
              borderTopColor: colors.border,
            }}
          >
            {/*
              What to type, and where it comes from. Somebody who has never
              made a bot needs the three steps more than they need a field.
            */}
            <Text style={[styles.muted, { fontSize: 12.5, lineHeight: 18 }]}>
              {t(
                "Open Telegram, message @BotFather, send /newbot, then paste the token it gives you.",
                "បើក Telegram ផ្ញើទៅ @BotFather វាយ /newbot រួចដាក់ token នៅទីនេះ។",
              )}
            </Text>

            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="123456789:AAE..."
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!connecting}
              style={[styles.input, { fontSize: 14, paddingVertical: 11 }]}
            />

            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                accessibilityRole="button"
                disabled={connecting}
                onPress={() => {
                  setToken("");
                  setBotOpen(false);
                }}
                style={{ paddingHorizontal: 14, paddingVertical: 11 }}
              >
                <Text
                  style={{ color: colors.muted, fontSize: 14, fontWeight: "700" }}
                >
                  {t("Cancel", "បោះបង់")}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={connecting || !token.trim()}
                onPress={() => void connectTelegram()}
                style={({ pressed }) => ({
                  flex: 1,
                  alignItems: "center",
                  paddingVertical: 12,
                  borderRadius: 12,
                  opacity: token.trim() ? 1 : 0.45,
                  backgroundColor: pressed ? "#0A6FA8" : colors.blue,
                })}
              >
                {connecting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text
                    style={{ color: "white", fontSize: 14.5, fontWeight: "800" }}
                  >
                    {t("Connect bot", "ភ្ជាប់បូត")}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <Connect
            icon="paper-plane"
            tone="#2AABEE"
            label={t("Add a Telegram bot", "បន្ថែមបូត Telegram")}
            detail={t(
              "Paste the token BotFather gives you. No computer needed.",
              "ដាក់ token ពី BotFather។",
            )}
            first={telegram.length === 0}
            onPress={() => {
              setConnected("");
              setBotOpen(true);
            }}
          />
        )}
      </SettingsGroup>

      {/*
        What is coming, said once and greyed out.
        These are the three TENH already names on the website; a fourth here
        would be a promise nobody has made.
      */}
      <SettingsGroup title={t("Coming soon", "មកដល់ឆាប់ៗនេះ")}>
        {COMING.map((platform, index) => (
          <View
            key={platform.key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 13,
              borderTopWidth: index === 0 ? 0 : 1,
              borderTopColor: colors.border,
              opacity: 0.72,
            }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.background,
              }}
            >
              <Ionicons name={platform.icon} size={17} color={platform.tone} />
            </View>

            <View style={{ flex: 1 }}>
              <Text
                style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}
              >
                {platform.name}
              </Text>

              <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
                {platform.detail}
              </Text>
            </View>

            <View
              style={{
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: colors.background,
              }}
            >
              <Text
                style={{ fontSize: 10.5, fontWeight: "800", color: colors.muted }}
              >
                {t("Soon", "ឆាប់ៗ")}
              </Text>
            </View>
          </View>
        ))}
      </SettingsGroup>
    </SlidePanel>
  );
}

/* A connected page or bot, with the one thing you can do to it. */
function ChannelRow({
  mark,
  name,
  detail,
  tone,
  first,
  onDisconnect,
}: {
  mark: React.ReactNode;
  name: string;
  detail: string;
  tone: string;
  first: boolean;
  onDisconnect: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
      }}
    >
      {mark}

      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}
        >
          {name}
        </Text>

        <Text style={{ fontSize: 12, color: tone, fontWeight: "700" }}>
          {detail}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Disconnect ${name}`}
        hitSlop={8}
        onPress={onDisconnect}
        style={({ pressed }) => ({
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
          backgroundColor: pressed ? "#FBEAEA" : "transparent",
        })}
      >
        <Text style={{ fontSize: 12.5, fontWeight: "800", color: colors.red }}>
          Disconnect
        </Text>
      </Pressable>
    </View>
  );
}

/* The row that starts a connection. */
function Connect({
  icon,
  tone,
  label,
  detail,
  first,
  onPress,
}: {
  icon: IconName;
  tone: string;
  label: string;
  detail: string;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 13,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.border,
        backgroundColor: pressed ? colors.pale : "transparent",
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${tone}1A`,
        }}
      >
        <Ionicons name={icon} size={17} color={tone} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.blue }}>
          {label}
        </Text>

        <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
          {detail}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}
