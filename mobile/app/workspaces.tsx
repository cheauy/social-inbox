import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Empty, ErrorNotice, colors, styles } from "../components/ui";
import { api } from "../lib/api/client";
import { useAuth } from "../lib/auth/provider";
import { useInbox } from "../lib/inbox-provider";
import { useLanguage } from "../lib/language-provider";
import type { Workspace } from "../lib/types";

/*
 * Choosing a workspace, as its own screen rather than a state of the Inbox.
 *
 * It was rendered inside the Inbox tab, which meant the tab bar sat under a
 * question you have to answer before any of those tabs mean anything --
 * Analytics for which workspace? -- and the Inbox's own search and filters
 * sat above it, filtering a list of conversations that had not been chosen
 * yet. A screen with one question on it and nothing else to press is easier
 * to answer.
 *
 * It stays reachable afterwards: the Inbox's own switcher and the back
 * gesture both come here, so somebody who works across two shops is one
 * gesture from the other one.
 */

/*
 * The mark a workspace wears.
 *
 * There is no logo to show: `businesses` has a name and nothing else, and no
 * channel carries a picture either, so nothing in TENH knows what any of
 * these shops look like. Initials were the stand-in, and they read as text to
 * be deciphered -- "DO", "TP" -- rather than a thing to point at.
 *
 * A glyph on a colour hashed from the name is the honest version: the same
 * shop is the same colour on every device and every launch, so after a day
 * nobody reads the list, they reach for the green one. When a workspace can
 * carry a real logo, it goes here and the glyph becomes the fallback.
 */
const MARKS = [
  { tint: "#0089CC", wash: "#E3F3FB" },
  { tint: "#2FA36B", wash: "#E7F6EE" },
  { tint: "#C77700", wash: "#FBF0E0" },
  { tint: "#6D4AFF", wash: "#EDE9FF" },
  { tint: "#B43232", wash: "#FBEAEA" },
  { tint: "#0F7C8A", wash: "#E2F2F4" },
];

function markFor(name: string) {
  let hash = 0;

  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100000;
  }

  return MARKS[hash % MARKS.length];
}

export default function Workspaces() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { t } = useLanguage();

  const {
    workspaces,
    workspace,
    loading,
    error,
    selectWorkspace,
    openWorkspaces,
    loadWorkspaces,
  } = useInbox();

  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  /*
   * Ticked workspaces, and nothing is ticked to start with.
   *
   * Merging is opt-in and stays opt-in: opening every shop somebody belongs
   * to by default would hand a five-shop agency one list of five shops'
   * customers and no way to tell whose message is whose. Tapping a row still
   * opens that one workspace on its own; the tick boxes and the bar at the
   * bottom are the way to ask for more than one.
   */
  const [picked, setPicked] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);

  /*
   * The first workspace, for somebody who registered on the phone.
   *
   * Registration creates the account; the workspace and its free trial are
   * provisioned server-side, and on the website that happens on the way back
   * from the confirmation link. Registering in the app skips that route
   * entirely, so a brand-new account used to arrive here and be told it
   * belongs to no workspace -- true, and a dead end. This asks the same
   * endpoint the website's callback asks.
   */
  async function startTrial() {
    if (starting) return;

    setStarting(true);

    try {
      await api("/api/onboarding/ensure-workspace", null, { method: "POST" });
      await loadWorkspaces();
    } catch {
      // loadWorkspaces reports on the provider's error line; the endpoint's
      // own refusal (an unconfirmed email) is shown there too.
    } finally {
      setStarting(false);
    }
  }

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  /*
   * Only the ones that can be opened.
   *
   * An expired workspace used to sit in this list greyed out, saying "renew
   * on the web" -- a row that cannot be tapped, on a device that cannot renew
   * it, padding the one list somebody has to get through before they can read
   * a message.
   */
  const open = workspaces.filter((one) => one.subscriptionOperational);
  const expired = workspaces.length - open.length;

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? open.filter((one) => one.businessName.toLowerCase().includes(needle))
    : open;

  function toggle(id: string) {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((one) => one !== id)
        : [...current, id],
    );
  }

  async function openMerged() {
    if (busy) return;

    const chosen = open.filter((one) => picked.includes(one.businessId));
    if (chosen.length === 0) return;

    setBusy(chosen[0].businessId);

    try {
      await openWorkspaces(chosen);
      router.push("/(tabs)");
    } catch {
      // The provider reports on its own error line.
    } finally {
      setBusy(null);
    }
  }

  async function choose(next: Workspace) {
    if (busy) return;

    setBusy(next.businessId);

    try {
      await selectWorkspace(next);
      /*
       * Pushed, not replaced: the back gesture comes back here, which is what
       * somebody switching between two shops all day expects.
       */
      router.push("/(tabs)");
    } catch {
      // selectWorkspace reports through the provider's own error line.
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        {/*
          The brand, first.

          This screen is the first thing after signing in, and it used to open
          on a bare question -- "Choose a workspace" -- with no sign of which
          app was asking. The logo, the name and what the app is for go on the
          top row with the one button; the question moves to a second row,
          where it reads as the heading of the list under it rather than as
          the title of the app.
        */}
        <View style={styles.row}>
          <Image
            source={require("../assets/tenh-logo.png")}
            style={{ width: 34, height: 34, borderRadius: 9 }}
            resizeMode="contain"
          />

          <View style={{ flex: 1, marginLeft: 10, gap: 1 }}>
            <Text
              numberOfLines={1}
              style={{ fontSize: 16, fontWeight: "800", color: colors.ink }}
            >
              TENH Chat
            </Text>

            <Text numberOfLines={1} style={[styles.muted, { fontSize: 12 }]}>
              {t("Customer messaging", "ការផ្ញើសារអតិថិជន")}
            </Text>
          </View>

          {/*
            The only button here. Everything else on this screen answers the
            question; this is the way out of it when the answer is "none of
            these" -- which is a purchase, and a purchase is on the web.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Buy a subscription", "ទិញការជាវ")}
            onPress={() => router.push("/settings/subscription")}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? "#0A6FA8" : colors.blue,
            })}
          >
            <Ionicons name="add" size={22} color="white" />
          </Pressable>
        </View>

        <View style={{ marginTop: 14, flexDirection: "row", alignItems: "flex-end" }}>
          <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.title, { fontSize: 22 }]}>
            {t("Choose a workspace", "ជ្រើសកន្លែងធ្វើការ")}
          </Text>

          {/*
            Silent when there is nothing to count and something went wrong:
            "0 workspaces are ready" under an Unauthorized banner reads as a
            second, wrong explanation for the same thing.
          */}
          {open.length > 0 || !error ? (
            <Text style={styles.muted} numberOfLines={1}>
              {open.length === 1
                ? t("One workspace is ready", "មានកន្លែងធ្វើការមួយ")
                : t(
                    open.length + " workspaces are ready",
                    "មានកន្លែងធ្វើការ " + open.length,
                  )}
            </Text>
          ) : null}
          </View>

          {/*
            Select all, once there is more than one thing to select. It reads
            as its own opposite when everything is already ticked, so the same
            button undoes the selection rather than needing a second one.
          */}
          {open.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setPicked(
                  picked.length === open.length
                    ? []
                    : open.map((one) => one.businessId),
                )
              }
              hitSlop={8}
              style={{ paddingVertical: 4, paddingLeft: 10 }}
            >
              <Text
                style={{ fontSize: 13, fontWeight: "800", color: colors.blue }}
              >
                {picked.length === open.length
                  ? t("Clear", "សម្អាត")
                  : t("Select all", "ជ្រើសទាំងអស់")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/*
          Search, and nothing beside it. The Inbox's filters were sitting on
          this screen filtering conversations from a workspace nobody had
          picked yet.
        */}
        {open.length > 1 ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 9,
              marginTop: 10,
              paddingHorizontal: 13,
              height: 44,
              borderRadius: 14,
              backgroundColor: colors.background,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="search" size={17} color={colors.muted} />

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("Search workspace", "ស្វែងរកកន្លែងធ្វើការ")}
              placeholderTextColor={colors.muted}
              autoCorrect={false}
              style={{ flex: 1, fontSize: 15, color: colors.ink }}
            />

            {query ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Clear", "សម្អាត")}
                onPress={() => setQuery("")}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={17} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <ErrorNotice message={error} onRetry={() => void loadWorkspaces()} />

      {loading && workspaces.length === 0 ? (
        <WorkspaceSkeleton />
      ) : shown.length === 0 ? (
        <View style={{ flex: 1 }}>
          <Empty
          icon="briefcase-outline"
          title={
            needle
              ? t("Nothing matches", "រកមិនឃើញ")
              : expired > 0
                ? t("No workspace with a live plan", "គ្មានកន្លែងធ្វើការដែលមានគម្រោង")
                : t("No workspace available", "គ្មានកន្លែងធ្វើការ")
          }
          detail={
            needle
              ? t(
                  "No workspace here is called that.",
                  "គ្មានកន្លែងធ្វើការឈ្មោះនេះទេ។",
                )
              : expired > 0
                ? t(
                    "Every workspace you belong to has an expired subscription. Use the button above to renew or buy a plan.",
                    "កន្លែងធ្វើការទាំងអស់អស់សុពលភាព។ ប្រើប៊ូតុងខាងលើដើម្បីបន្ត ឬទិញគម្រោង។",
                  )
                : t(
                    "This account is not an active member of any workspace.",
                    "គណនីនេះមិនមែនជាសមាជិកសកម្មនៃកន្លែងធ្វើការណាមួយទេ។",
                  )
          }
          />

          {workspaces.length === 0 && !error ? (
            <View style={{ paddingHorizontal: 24 }}>
              <Button
                title={t("Start my workspace", "បង្កើតកន្លែងធ្វើការ")}
                busy={starting}
                onPress={() => void startTrial()}
              />
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          keyboardDismissMode="on-drag"
          data={shown}
          keyExtractor={(item) => item.businessId}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 16,
            gap: 12,
          }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const mark = markFor(item.businessName);
            const current = item.businessId === workspace?.businessId;
            const chosen = picked.includes(item.businessId);

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(
                  "Open " + item.businessName,
                  "បើក " + item.businessName,
                )}
                disabled={busy !== null}
                onPress={() => void choose(item)}
                style={({ pressed }) => [
                  styles.card,
                  {
                    padding: 14,
                    borderColor: chosen || current ? colors.blue : colors.border,
                    backgroundColor: pressed ? colors.pale : "white",
                    opacity: busy && busy !== item.businessId ? 0.5 : 1,
                  },
                ]}
              >
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 13 }}
                >
                  {/*
                    The tick, with its own touch target. It is a separate
                    press from the row so one tap still opens one workspace --
                    what almost everybody wants -- and merging costs a
                    deliberate tap on the box.
                  */}
                  {open.length > 1 ? (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: chosen }}
                      accessibilityLabel={t(
                        "Merge " + item.businessName,
                        "បញ្ច៎ល " + item.businessName,
                      )}
                      onPress={() => toggle(item.businessId)}
                      hitSlop={10}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 8,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: chosen ? 0 : 1.5,
                        borderColor: colors.border,
                        backgroundColor: chosen ? colors.blue : "transparent",
                      }}
                    >
                      {chosen ? (
                        <Ionicons name="checkmark" size={15} color="white" />
                      ) : null}
                    </Pressable>
                  ) : null}

                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 15,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: mark.wash,
                    }}
                  >
                    <Ionicons
                      name="storefront"
                      size={23}
                      color={mark.tint}
                    />
                  </View>

                  <View style={{ flex: 1, gap: 5 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 16.5,
                        fontWeight: "700",
                        color: colors.ink,
                      }}
                    >
                      {item.businessName}
                    </Text>

                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Chip
                        icon={
                          item.role === "owner"
                            ? "ribbon-outline"
                            : item.role === "admin"
                              ? "key-outline"
                              : "person-outline"
                        }
                        label={item.role}
                      />

                      {current ? (
                        <Chip icon="checkmark" label={t("Open now", "កំពុងបើក")} />
                      ) : null}
                    </View>
                  </View>

                  {busy === item.businessId ? (
                    <ActivityIndicator color={colors.blue} />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={20}
                      color={colors.muted}
                    />
                  )}
                </View>
              </Pressable>
            );
          }}
          ListFooterComponent={
            expired > 0 && !needle ? (
              <Text
                style={[
                  styles.muted,
                  { fontSize: 12, paddingHorizontal: 4, lineHeight: 18 },
                ]}
              >
                {t(
                  expired +
                    (expired === 1
                      ? " workspace has an expired plan and is not listed."
                      : " workspaces have expired plans and are not listed.") +
                    " Open Subscription above to renew.",
                  "កន្លែងធ្វើការ " + expired + " អស់សុពលភាព ហើយមិនបានបង្ហាញទេ។",
                )}
              </Text>
            ) : null
          }
        />
      )}

      {/*
        The merge itself, as a bar rather than a button in the list: it acts
        on the whole selection, so it belongs where the selection can be seen,
        and it says how many it is about to open before it opens them.
      */}
      {picked.length > 0 ? (
        <View
          style={{
            padding: 12,
            paddingBottom: insets.bottom + 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            backgroundColor: "white",
          }}
        >
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => void openMerged()}
            style={({ pressed }) => ({
              height: 50,
              borderRadius: 15,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity: busy ? 0.7 : 1,
              backgroundColor: pressed ? "#0A6FA8" : colors.blue,
            })}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Ionicons name="layers-outline" size={18} color="white" />
            )}

            <Text style={{ fontSize: 15, fontWeight: "800", color: "white" }}>
              {picked.length === 1
                ? t("Open 1 workspace", "បើកកន្លែងធ្វើការ ១")
                : t(
                    "Open " + picked.length + " workspaces together",
                    "បើកកន្លែងធ្វើការ " + picked.length + " ជាមួយគ្នា",
                  )}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/*
 * The wait, drawn as the thing being waited for.
 *
 * This screen is the first thing after signing in and it opened on a spinner
 * in the middle of nothing, then jumped to a list. Three grey cards the shape
 * of the real ones say what is coming and leave the answer where the wait
 * was.
 */
function WorkspaceSkeleton() {
  const [pulse] = useState(() => new Animated.Value(0.45));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      /* Not announced: "loading, loading, loading" as the bars pulse is
         worse than the silence the spinner left behind. */
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ padding: 16, gap: 12, opacity: pulse }}
    >
      {[0, 1, 2].map((row) => (
        <View
          key={row}
          style={[
            styles.card,
            { padding: 14, flexDirection: "row", alignItems: "center", gap: 13 },
          ]}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 15,
              backgroundColor: colors.border,
            }}
          />

          <View style={{ flex: 1, gap: 8 }}>
            <View
              style={{
                width: row === 1 ? "52%" : "68%",
                height: 13,
                borderRadius: 7,
                backgroundColor: colors.border,
              }}
            />

            <View
              style={{
                width: 78,
                height: 19,
                borderRadius: 999,
                backgroundColor: colors.border,
              }}
            />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

function Chip({
  icon,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: colors.pale,
      }}
    >
      <Ionicons name={icon} size={11} color={colors.blue} />

      <Text
        style={{
          fontSize: 11,
          fontWeight: "800",
          color: colors.blue,
          textTransform: "capitalize",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
