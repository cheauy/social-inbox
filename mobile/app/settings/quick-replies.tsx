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
  DEFAULT_CATEGORY,
  Draft,
  QuickReplyForm,
  emptyDraft,
} from "../../components/quick-reply-form";
import { Empty, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import { useLanguage } from "../../lib/language-provider";
import type { SavedReply } from "../../lib/types";

/*
 * Quick replies, written here rather than on the web.
 *
 * This row used to open a browser. Writing the reply is the half that belongs
 * on a phone: the sentence you keep retyping occurs to you while you are
 * typing it to somebody, and being handed to a browser at that moment means
 * it never gets saved. The picker in the composer reads the same list, so a
 * reply added here is usable in the next conversation.
 *
 * Images and video come too. The picture of the size chart is taken on this
 * phone; being told to find a laptop to attach it is how a quick reply ends
 * up as plain text nobody uses.
 */

export default function QuickReplies() {
  const insets = useSafeAreaInsets();
  const { workspace } = useInbox();
  const { t } = useLanguage();

  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [categories, setCategories] = useState<string[]>([DEFAULT_CATEGORY]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }

    try {
      const [data, drawers] = await Promise.all([
        api<{ savedReplies: SavedReply[] }>(
          "/api/saved-replies",
          workspace.businessId,
        ),
        api<{ categories: { name: string }[] }>(
          "/api/saved-reply-categories",
          workspace.businessId,
        ).catch(() => ({ categories: [] })),
      ]);

      const replies = data.savedReplies ?? [];

      setReplies(replies);

      /*
       * General first and always, then whatever has been made, then any
       * category a reply is already filed under that no longer exists as a
       * record -- otherwise editing that reply would silently move it.
       */
      setCategories([
        DEFAULT_CATEGORY,
        ...new Set(
          [
            ...(drawers.categories ?? []).map((one) => one.name),
            ...replies.map((one) => one.category ?? ""),
          ].filter((name) => name && name !== DEFAULT_CATEGORY),
        ),
      ]);

      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load quick replies.",
      );
    } finally {
      setLoading(false);
    }
  }, [workspace?.businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function save() {
    if (!draft || !workspace) return;

    const title = draft.title.trim();
    const messageText = draft.messageText.trim();

    if (!title || !messageText) {
      setFormError(
        t("A title and a message are both required.", "ត្រូវការចំណងជើង និងសារ។"),
      );
      return;
    }

    setSaving(true);
    setFormError("");

    try {
      await api(
        draft.id ? "/api/saved-replies/" + draft.id : "/api/saved-replies",
        workspace.businessId,
        {
          method: draft.id ? "PATCH" : "POST",
          body: {
            title,
            messageText,
            /*
             * Blank means none, not the empty string: an empty shortcut would
             * be stored as one and match everything the composer typed.
             */
            shortcut: draft.shortcut.trim() || null,
            category: draft.category.trim() || DEFAULT_CATEGORY,
            attachments: draft.attachments,
          },
        },
      );

      setDraft(null);
      await load();
    } catch (saveError) {
      setFormError(
        saveError instanceof Error
          ? saveError.message
          : t("Unable to save that.", "មិនអាចរក្សាទុកបានទេ។"),
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(reply: SavedReply) {
    Alert.alert(
      t("Delete this quick reply?", "លុបការឆ្លើយតបរហ័សនេះ?"),
      t(
        reply.title + " will be gone for everybody on the team.",
        reply.title + " នឹងបាត់សម្រាប់អ្នកទាំងអស់គ្នាក្នុងក្រុម។",
      ),
      [
        { text: t("Keep", "រក្សាទុក"), style: "cancel" },
        {
          text: t("Delete", "លុប"),
          style: "destructive",
          onPress: () => void remove(reply),
        },
      ],
    );
  }

  async function remove(reply: SavedReply) {
    if (!workspace) return;

    try {
      await api("/api/saved-replies/" + reply.id, workspace.businessId, {
        method: "DELETE",
      });

      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete that.",
      );
    }
  }

  return (
    <SettingsScreen
      title={t("Quick replies", "ការឆ្លើយតបរហ័ស")}
      detail={
        loading
          ? t("Loading…", "កំពុងផ្ទុក…")
          : t(replies.length + " saved", "រក្សាទុក " + replies.length)
      }
      loading={loading}
      error={error}
      onRetry={() => void load()}
      skeleton={[5]}
      footer={
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
            accessibilityLabel={t("Add a quick reply", "បន្ថែមការឆ្លើយតបរហ័ស")}
            onPress={() => {
              setFormError("");
              setDraft(emptyDraft());
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
            <Ionicons name="add" size={18} color="white" />

            <Text style={{ color: "white", fontSize: 15, fontWeight: "700" }}>
              {t("Add a quick reply", "បន្ថែមការឆ្លើយតបរហ័ស")}
            </Text>
          </Pressable>
        </View>
      }
    >
      {replies.length === 0 ? (
        <Empty
          icon="flash-outline"
          title={t("No quick replies yet", "មិនទាន់មានការឆ្លើយតបរហ័ស")}
          detail={t(
            "Save the sentences you type over and over, and they appear in the composer.",
            "រក្សាទុកឃ្លាដែលអ្នកវាយច្រើនដង នោះវានឹងបង្ហាញក្នុងប្រអប់សរសេរសារ។",
          )}
        />
      ) : (
        <SettingsGroup>
          {replies.map((reply, index) => (
            <Pressable
              key={reply.id}
              accessibilityRole="button"
              accessibilityLabel={t("Edit " + reply.title, "កែ " + reply.title)}
              onPress={() => {
                setFormError("");
                setDraft({
                  id: reply.id,
                  title: reply.title,
                  shortcut: reply.shortcut ?? "",
                  messageText: reply.message_text,
                  category: reply.category ?? DEFAULT_CATEGORY,
                  attachments: reply.attachments ?? [],
                });
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
                backgroundColor: pressed ? colors.pale : "transparent",
                opacity: reply.is_active ? 1 : 0.55,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      flexShrink: 1,
                      fontSize: 15,
                      fontWeight: "700",
                      color: colors.ink,
                    }}
                  >
                    {reply.title}
                  </Text>

                  {reply.shortcut ? (
                    <View
                      style={{
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        borderRadius: 6,
                        backgroundColor: colors.pale,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "700",
                          color: colors.blue,
                        }}
                      >
                        {/*
                          Some shortcuts were saved with their slash and some
                          without, so it is put back exactly once rather than
                          rendering "//delivery" for half the list.
                        */}
                        {"/" + reply.shortcut.replace(/^\/+/, "")}
                      </Text>
                    </View>
                  ) : null}

                  {reply.attachments?.length ? (
                    <View
                      style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
                    >
                      <Ionicons
                        name="image-outline"
                        size={14}
                        color={colors.muted}
                      />
                      <Text style={[styles.muted, { fontSize: 11 }]}>
                        {reply.attachments.length}
                      </Text>
                    </View>
                  ) : null}
                </View>

                <Text
                  numberOfLines={2}
                  style={[styles.muted, { fontSize: 12.5, lineHeight: 18 }]}
                >
                  {reply.message_text}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(
                  "Delete " + reply.title,
                  "លុប " + reply.title,
                )}
                onPress={() => confirmDelete(reply)}
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
              >
                <Ionicons name="trash-outline" size={19} color={colors.red} />
              </Pressable>
            </Pressable>
          ))}
        </SettingsGroup>
      )}

      <Modal
        visible={draft !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDraft(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(16,34,56,0.35)" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setDraft(null)} />

          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              paddingBottom: insets.bottom + 14,
              maxHeight: "88%",
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
                {draft?.id
                  ? t("Edit quick reply", "កែការឆ្លើយតបរហ័ស")
                  : t("New quick reply", "ការឆ្លើយតបរហ័សថ្មី")}
              </Text>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Close", "បិទ")}
                onPress={() => setDraft(null)}
                hitSlop={10}
              >
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>

            {draft ? (
              <QuickReplyForm
                draft={draft}
                categories={categories}
                businessId={workspace?.businessId ?? ""}
                saving={saving}
                error={formError}
                onChange={setDraft}
                onError={setFormError}
                onCategoryCreated={(name) =>
                  setCategories((current) =>
                    current.includes(name) ? current : [...current, name],
                  )
                }
                onSave={() => void save()}
              />
            ) : null}

          </View>
        </View>
      </Modal>
    </SettingsScreen>
  );
}
