import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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
import { useLanguage } from "../../lib/language-provider";
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
 * Inviting is here too. It is the one thing on this screen that is urgent --
 * somebody starts on Monday and needs an inbox on Monday -- and it is an
 * email address and a choice of two roles, which is a phone-sized question.
 * The invitation goes to their email, so nothing is granted from this screen
 * that the person cannot decline.
 *
 * Disconnecting is here too, and it is the half that is urgent: a page handed
 * to the wrong workspace, or a bot somebody has to stop right now, cannot wait
 * for whoever has the laptop. It is a real release, not a hidden row -- the
 * Page is unsubscribed from TENH's webhook at Meta, the bot's webhook is
 * deleted at Telegram, and the stored token is dropped. Nothing keeps
 * listening afterwards.
 *
 * Connecting one back up is still on the web: it is an OAuth round trip that
 * would hand somebody to a browser mid-flow anyway.
 */

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string | null;
};

type Channel = {
  id: string;
  businessId: string;
  platform: "facebook" | "telegram";
  name: string;
  username: string | null;
};

export default function People() {
  const insets = useSafeAreaInsets();
  const { workspace, canManageRooms } = useInbox();
  const { t } = useLanguage();

  const [members, setMembers] = useState<Member[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [canInvite, setCanInvite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"agent" | "owner">("agent");
  const [sending, setSending] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [releasing, setReleasing] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    try {
      const [team, connected, invited] = await Promise.all([
        api<{ members: Member[] }>("/api/team/members", workspace.businessId),
        api<{ channels: Channel[] }>(
          "/api/inbox/channels",
          workspace.businessId,
        ),
        /*
         * Only an owner may see or send these, and the endpoint says so by
         * answering with an empty list rather than an error -- so a failure
         * here is a real failure and stays quiet either way.
         */
        api<{ canManage?: boolean; invitations?: Invitation[] }>(
          "/api/team/invitations",
          workspace.businessId,
        ).catch(() => ({ canManage: false, invitations: [] })),
      ]);

      setMembers(team.members ?? []);
      setInvitations(invited.invitations ?? []);
      setCanInvite(invited.canManage === true);

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

  async function invite() {
    if (!workspace) return;

    const address = email.trim().toLowerCase();

    if (!address.includes("@") || address.length < 5) {
      setInviteError(
        t("Enter the email address to invite.", "បញ្ចូលអ៊ីមែលដែលចង់អញ្ជើញ។"),
      );
      return;
    }

    setSending(true);
    setInviteError("");

    try {
      await api("/api/team/invitations", workspace.businessId, {
        method: "POST",
        body: { email: address, role },
      });

      setEmail("");
      setInviting(false);
      await load();
    } catch (sendError) {
      setInviteError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to send that invitation.",
      );
    } finally {
      setSending(false);
    }
  }

  async function act(invitation: Invitation, action: "resend" | "cancel") {
    if (!workspace) return;

    try {
      await api("/api/team/invitations/" + invitation.id, workspace.businessId, {
        method: "PATCH",
        body: { action },
      });

      await load();
    } catch (actError) {
      setError(
        actError instanceof Error
          ? actError.message
          : "Unable to update that invitation.",
      );
    }
  }

  /*
   * Two taps, and the first one spells out what stops. "Disconnect" on its own
   * reads like hiding a row; what actually happens is that messages to that
   * Page or bot stop reaching this workspace, and nobody finds out until a
   * customer is ignored for a day.
   */
  function confirmDisconnect(channel: Channel) {
    const telegram = channel.platform === "telegram";

    Alert.alert(
      t("Disconnect " + channel.name + "?", "ផ្តាច់ " + channel.name + "?"),
      t(
        telegram
          ? "TENH deletes the bot's webhook at Telegram and forgets its token. New messages to the bot stop arriving here. Reconnecting means pasting the bot token again."
          : "TENH unsubscribes from the Page at Meta and forgets its token. New messages and comments stop arriving here. Reconnecting means signing in to Facebook again.",
        telegram
          ? "TENH នឹងលុប webhook របស់បូតនៅ Telegram។ សារថ្មីនឹងឈប់មកដល់ទីនេះ។"
          : "TENH នឹងផ្តាច់ការតភ្ជាប់ជាមួយ Page នៅ Meta។ សារ និងមតិថ្មីនឹងឈប់មកដល់ទីនេះ។",
      ),
      [
        { text: t("Keep connected", "រក្សាការតភ្ជាប់"), style: "cancel" },
        {
          text: t("Disconnect", "ផ្តាច់"),
          style: "destructive",
          onPress: () => void disconnect(channel),
        },
      ],
    );
  }

  async function disconnect(channel: Channel) {
    if (!workspace) return;

    setReleasing(channel.id);
    setError("");

    try {
      /*
       * Each platform releases its own way -- Meta wants the webhook
       * subscription deleted, Telegram wants deleteWebhook -- and both
       * endpoints do that before they touch the row, so a failure at the
       * platform leaves the channel connected here rather than orphaned.
       */
      if (channel.platform === "telegram") {
        await api(
          "/api/telegram/connection?connectionId=" +
            encodeURIComponent(channel.id),
          workspace.businessId,
          { method: "DELETE" },
        );
      } else {
        await api(
          "/api/facebook/connections/" +
            encodeURIComponent(channel.id) +
            "/disconnect",
          workspace.businessId,
          { method: "POST" },
        );
      }

      await load();
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "Unable to disconnect that channel.",
      );
    } finally {
      setReleasing(null);
    }
  }

  function confirmCancel(invitation: Invitation) {
    Alert.alert(
      t("Cancel this invitation?", "បោះបង់ការអញ្ជើញនេះ?"),
      t(
        invitation.email + " will not be able to join with it.",
        invitation.email + " នឹងមិនអាចចូលរួមដោយប្រើវាទេ។",
      ),
      [
        { text: t("Keep", "រក្សាទុក"), style: "cancel" },
        {
          text: t("Cancel invitation", "បោះបង់"),
          style: "destructive",
          onPress: () => void act(invitation, "cancel"),
        },
      ],
    );
  }

  return (
    <SettingsScreen
      title={t("People and channels", "មនុស្ស និងឆានែល")}
      /*
        Counted only once there is something to count. A header that says
        "0 on the team" while the team is still arriving is a wrong answer,
        and it is the one thing on this screen that is not a grey bar.
      */
      detail={
        loading
          ? t("Loading…", "កំពុងផ្ទុក…")
          : t(
              members.length + " on the team · " + channels.length + " connected",
              "ក្រុម " + members.length + " · ភ្ជាប់ " + channels.length,
            )
      }
      loading={loading}
      error={error}
      onRetry={() => void load()}
      skeleton={[4, 2]}
      footer={
        canInvite ? (
          <View
            style={{
              padding: 14,
              paddingBottom: insets.bottom + 14,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              backgroundColor: "white",
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("Invite somebody", "អញ្ជើញនរណាម្នាក់")}
              onPress={() => {
                setInviteError("");
                setInviting(true);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 14,
                borderRadius: 14,
                backgroundColor: pressed ? "#0A6FA8" : colors.blue,
              })}
            >
              <Ionicons name="person-add-outline" size={17} color="white" />

              <Text style={{ color: "white", fontSize: 15, fontWeight: "700" }}>
                {t("Invite somebody", "អញ្ជើញនរណាម្នាក់")}
              </Text>
            </Pressable>
          </View>
        ) : null
      }
    >
      <SettingsGroup
        title={t("People · " + members.length, "មនុស្ស · " + members.length)}
      >
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

      <SettingsGroup
        title={t("Channels · " + channels.length, "ឆានែល · " + channels.length)}
      >
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

              {/*
                Owner or admin, which is the test the disconnect endpoints
                apply. Gating this on the invitation permission instead would
                hide it from an admin the API would have let through.
              */}
              {canManageRooms ? (
                releasing === channel.id ? (
                  <ActivityIndicator color={colors.red} />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(
                      "Disconnect " + channel.name,
                      "ផ្តាច់ " + channel.name,
                    )}
                    onPress={() => confirmDisconnect(channel)}
                    hitSlop={10}
                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                  >
                    <Ionicons
                      name="unlink-outline"
                      size={19}
                      color={colors.red}
                    />
                  </Pressable>
                )
              ) : null}
            </View>
          ))
        )}
      </SettingsGroup>

      {invitations.length > 0 ? (
        <SettingsGroup
          title={t(
            "Invited · " + invitations.length,
            "បានអញ្ជើញ · " + invitations.length,
          )}
        >
          {invitations.map((invitation, index) => (
            <View
              key={invitation.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
              }}
            >
              <Ionicons name="mail-outline" size={19} color={colors.muted} />

              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 14.5, fontWeight: "600", color: colors.ink }}
                >
                  {invitation.email}
                </Text>
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  {t("Waiting · ", "កំពុងរង់ចាំ · ") + invitation.role}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Send again", "ផ្ញើម្តងទៀត")}
                onPress={() => void act(invitation, "resend")}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <Ionicons name="refresh-outline" size={19} color={colors.blue} />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Cancel invitation", "បោះបង់ការអញ្ជើញ")}
                onPress={() => confirmCancel(invitation)}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={19}
                  color={colors.red}
                />
              </Pressable>
            </View>
          ))}
        </SettingsGroup>
      ) : null}

      <Text
        style={[styles.muted, { fontSize: 12, paddingHorizontal: 2, lineHeight: 18 }]}
      >
        {t(
          "Connecting or reconnecting a page is on the web — it is an OAuth round trip through Facebook.",
          "ការភ្ជាប់ទំព័រ គឺនៅលើគេហទំព័រ។",
        )}
      </Text>

      <Modal
        visible={inviting}
        animationType="slide"
        transparent
        onRequestClose={() => setInviting(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(16,34,56,0.35)" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setInviting(false)} />

          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              paddingBottom: insets.bottom + 14,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                padding: 14,
              }}
            >
              <Text style={[styles.heading, { flex: 1, fontSize: 17 }]}>
                {t("Invite somebody", "អញ្ជើញនរណាម្នាក់")}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Close", "បិទ")}
                onPress={() => setInviting(false)}
                hitSlop={10}
              >
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 14, paddingTop: 0, gap: 14 }}
            >
              {inviteError ? (
                <Text
                  accessibilityRole="alert"
                  style={{ color: colors.red, fontSize: 13, lineHeight: 19 }}
                >
                  {inviteError}
                </Text>
              ) : null}

              <TextInput
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  setInviteError("");
                }}
                placeholder="name@example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={{
                  height: 48,
                  paddingHorizontal: 13,
                  borderRadius: 13,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: "white",
                  fontSize: 15,
                  color: colors.ink,
                }}
              />

              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["agent", "owner"] as const).map((option) => {
                  const on = role === option;

                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => setRole(option)}
                      style={({ pressed }) => ({
                        flex: 1,
                        alignItems: "center",
                        paddingVertical: 12,
                        borderRadius: 13,
                        borderWidth: 1,
                        borderColor: on ? colors.blue : colors.border,
                        backgroundColor: on
                          ? colors.pale
                          : pressed
                            ? colors.pale
                            : "white",
                      })}
                    >
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: on ? "800" : "600",
                          color: on ? colors.blue : colors.muted,
                        }}
                      >
                        {option === "agent"
                          ? t("Agent", "ភ្នាក់ងារ")
                          : t("Owner", "ម្ចាស់")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.muted, { fontSize: 12.5, lineHeight: 18 }]}>
                {t(
                  "TENH emails them a link. Nothing changes on this workspace until they accept it.",
                  "TENH ផ្ញើតំណតាមអ៊ីមែល។ គ្មានអ្វីផ្លាស់ប្តូរទេ រហូតដល់គេទទួលយក។",
                )}
              </Text>

              <Pressable
                accessibilityRole="button"
                disabled={sending}
                onPress={() => void invite()}
                style={({ pressed }) => ({
                  alignItems: "center",
                  justifyContent: "center",
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: pressed ? "#0A6FA8" : colors.blue,
                  opacity: sending ? 0.6 : 1,
                })}
              >
                {sending ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text
                    style={{ color: "white", fontSize: 15, fontWeight: "700" }}
                  >
                    {t("Send invitation", "ផ្ញើការអញ្ជើញ")}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SettingsScreen>
  );
}
