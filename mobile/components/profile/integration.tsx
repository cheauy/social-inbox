import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { SettingsGroup } from "../settings-screen";
import { SlidePanel } from "../slide-panel";
import { PlatformMark, colors, styles } from "../ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import { useLanguage } from "../../lib/language-provider";

/*
 * What this workspace is connected to, and whether any of it has stopped
 * working.
 *
 * A Facebook page whose token has expired keeps looking connected everywhere
 * else in the app -- the conversations are still there, the sends just start
 * failing -- so the one screen that lists the pages is the right place to say
 * so plainly and loudly.
 *
 * Connecting or reconnecting is on the web: both are an OAuth round trip
 * through Facebook, and starting one here would hand somebody to a browser
 * mid-flow anyway.
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

export function IntegrationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspace } = useInbox();
  const { t } = useLanguage();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [attention, setAttention] = useState<AttentionPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    try {
      const [connected, health] = await Promise.all([
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
        (connected.channels ?? []).filter(
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
            arrive, but replies to them will fail until the connection is
            renewed on the web.
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
            No Facebook page is connected to this workspace.
          </Text>
        ) : (
          messenger.map((channel, index) => {
            const unhealthy = attention.some(
              (page) => page.name === channel.name,
            );

            return (
              <View
                key={channel.id}
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
                <PlatformMark platform="messenger" size={30} />

                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}
                  >
                    {channel.name}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: unhealthy ? colors.red : "#2FA36B",
                      fontWeight: "700",
                    }}
                  >
                    {unhealthy
                      ? t("Needs reconnecting", "ត្រូវភ្ជាប់ឡើងវិញ")
                      : t("Connected", "បានភ្ជាប់")}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </SettingsGroup>

      <SettingsGroup title={"Telegram · " + telegram.length}>
        {telegram.length === 0 ? (
          <Text
            style={[styles.muted, { fontSize: 13, padding: 16, textAlign: "center" }]}
          >
            No Telegram bot is connected to this workspace.
          </Text>
        ) : (
          telegram.map((channel, index) => (
            <View
              key={channel.id}
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
              <PlatformMark platform="telegram" size={30} />

              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}
                >
                  {channel.name}
                </Text>
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  {channel.username ? `@${channel.username}` : "Telegram bot"}
                </Text>
              </View>
            </View>
          ))
        )}
      </SettingsGroup>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Manage connections on the web"
        onPress={() =>
          void Linking.openURL(`${WEB}/dashboard/integrations`)
        }
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
          {t("Connect or reconnect on the web", "ភ្ជាប់នៅលើគេហទំព័រ")}
        </Text>
      </Pressable>
    </SlidePanel>
  );
}
