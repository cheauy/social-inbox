import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import {
  SettingsGroup,
  SettingsScreen,
} from "../../components/settings-screen";
import {
  Avatar,
  PlatformMark,
  colors,
  styles,
} from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import type { Member } from "../../lib/types";

/*
 * Who is on the team, and which pages are connected.
 *
 * Two lists rather than two screens: on the web they are separate pages
 * because there is room for the tables that go with them -- inviting, role
 * changes, reconnecting a page. None of that fits here, and the question a
 * phone actually gets asked is the simple one: who is on this workspace and
 * what is it connected to.
 *
 * Read-only on purpose. Inviting somebody, changing a role or reconnecting a
 * Facebook page all take a flow this screen would only half-carry, so the
 * settings list sends those to the web instead of starting them here.
 */

type Channel = {
  id: string;
  businessId: string;
  platform: "facebook" | "telegram";
  name: string;
  username: string | null;
};

export default function People() {
  const { workspace } = useInbox();

  const [members, setMembers] = useState<Member[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    try {
      const [team, connected] = await Promise.all([
        api<{ members: Member[] }>("/api/team/members", workspace.businessId),
        api<{ channels: Channel[] }>(
          "/api/inbox/channels",
          workspace.businessId,
        ),
      ]);

      setMembers(team.members ?? []);

      /*
       * Only this workspace's channels. The endpoint answers for every
       * workspace the member can reach, and listing another one here would
       * name a page this workspace has nothing to do with.
       */
      setChannels(
        (connected.channels ?? []).filter(
          (channel) => channel.businessId === workspace.businessId,
        ),
      );

      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load the team.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspace?.businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  return (
    <SettingsScreen
      title="People and channels"
      detail={`${members.length} on the team · ${channels.length} connected`}
      loading={loading}
      error={error}
      onRetry={() => void load()}
    >
      <SettingsGroup title={`People · ${members.length}`}>
        {members.map((member, index) => (
          <View
            key={member.id}
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
            <Avatar
              name={member.full_name}
              uri={member.profile_picture_url}
              size={38}
            />

            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}
              >
                {member.full_name || member.email}
              </Text>
              <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
                {member.email}
              </Text>
            </View>

            <View
              style={{
                paddingHorizontal: 9,
                paddingVertical: 4,
                borderRadius: 999,
                backgroundColor: colors.pale,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "800",
                  color: colors.blue,
                  textTransform: "capitalize",
                }}
              >
                {member.role}
              </Text>
            </View>
          </View>
        ))}
      </SettingsGroup>

      <SettingsGroup title={`Channels · ${channels.length}`}>
        {channels.length === 0 ? (
          <View style={{ padding: 24, alignItems: "center", gap: 6 }}>
            <Ionicons name="link-outline" size={24} color={colors.muted} />

            <Text style={[styles.muted, { fontSize: 13, textAlign: "center" }]}>
              No Facebook page or Telegram bot is connected to this workspace
              yet. Connecting one is on the web.
            </Text>
          </View>
        ) : (
          channels.map((channel, index) => (
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
              <PlatformMark
                platform={
                  channel.platform === "telegram" ? "telegram" : "messenger"
                }
                size={30}
              />

              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 15, fontWeight: "600", color: colors.ink }}
                >
                  {channel.name}
                </Text>
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  {channel.username
                    ? `@${channel.username}`
                    : channel.platform === "telegram"
                      ? "Telegram"
                      : "Messenger"}
                </Text>
              </View>
            </View>
          ))
        )}
      </SettingsGroup>

      <Text style={[styles.muted, { fontSize: 12, paddingHorizontal: 2, lineHeight: 18 }]}>
        Inviting somebody, changing a role and connecting a page are on the web
        — each takes a flow this screen would only half-carry.
      </Text>
    </SettingsScreen>
  );
}
