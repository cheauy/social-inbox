import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors, styles } from "./ui";
import { api, upload } from "../lib/api/client";
import { useLanguage } from "../lib/language-provider";
import type { SavedReplyAttachment } from "../../types/inbox";

/*
 * The body of the add/edit sheet: what the reply says, what it carries, and
 * which drawer it lives in.
 *
 * Media used to be web-only here, on the grounds that a private bucket and an
 * upload endpoint were too much for a phone. They are not -- the phone is
 * where the photo already is. The picture of the size chart is taken on the
 * phone, and being told to go and find a laptop to attach it is how a quick
 * reply ends up as plain text nobody uses.
 */

/* The server's own caps, so the form refuses before the upload does. */
const MAX_IMAGES = 10;
const MAX_VIDEOS = 1;
const MAX_BYTES = 20 * 1024 * 1024;

/*
 * Every workspace has this drawer whether or not anybody made it, so a reply
 * always has somewhere to be and the field is never blank on a new one.
 */
export const DEFAULT_CATEGORY = "General";

export type Draft = {
  id: string | null;
  title: string;
  shortcut: string;
  messageText: string;
  category: string;
  attachments: SavedReplyAttachment[];
  sortIndex: string;
};

export const emptyDraft = (): Draft => ({
  id: null,
  title: "",
  shortcut: "",
  messageText: "",
  category: DEFAULT_CATEGORY,
  attachments: [],
  sortIndex: "0",
});

export function QuickReplyForm({
  draft,
  categories,
  businessId,
  saving,
  error,
  onChange,
  onError,
  onCategoryCreated,
  onSave,
}: {
  draft: Draft;
  categories: string[];
  businessId: string;
  saving: boolean;
  error: string;
  onChange: (next: Draft) => void;
  onError: (message: string) => void;
  onCategoryCreated: (name: string) => void;
  onSave: () => void;
}) {
  const { t } = useLanguage();

  const [uploading, setUploading] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [naming, setNaming] = useState(false);

  const images = draft.attachments.filter((one) => one.kind === "image");
  const videos = draft.attachments.filter((one) => one.kind === "video");

  async function pick(kind: "image" | "video") {
    if (kind === "image" && images.length >= MAX_IMAGES) {
      onError(
        t(
          "Ten images is the most a quick reply can carry.",
          "រូបភាពច្រើនបំផុតគឺ ១០ សម្រាប់ការឆ្លើយតបមួយ។",
        ),
      );
      return;
    }

    if (kind === "video" && videos.length >= MAX_VIDEOS) {
      onError(
        t(
          "A quick reply carries one video. Neither Messenger nor Telegram sends video alongside anything else.",
          "ការឆ្លើយតបមួយអាចមានវីដេអូតែមួយ។",
        ),
      );
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      onError(
        t(
          "TENH needs access to your photos to attach one.",
          "TENH ត្រូវការសិទ្ធិចូលមើលរូបភាព ដើម្បីភ្ជាប់។",
        ),
      );
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === "image" ? ["images"] : ["videos"],
      /* Images can come in a batch; a reply only ever holds one video. */
      allowsMultipleSelection: kind === "image",
      selectionLimit: kind === "image" ? MAX_IMAGES - images.length : 1,
      quality: 0.85,
    });

    if (picked.canceled) return;

    setUploading(true);
    onError("");

    try {
      const uploaded: SavedReplyAttachment[] = [];

      for (const asset of picked.assets) {
        if ((asset.fileSize ?? 0) > MAX_BYTES) {
          onError(
            t(
              (asset.fileName ?? "That file") + " is larger than 20 MB.",
              "ឯកសារធំជាង 20 MB។",
            ),
          );
          continue;
        }

        const result = await upload<{ attachment: SavedReplyAttachment }>(
          "/api/saved-replies/media",
          businessId,
          {
            uri: asset.uri,
            mimeType:
              asset.mimeType ??
              (kind === "image" ? "image/jpeg" : "video/mp4"),
          },
        );

        /*
         * The local uri is kept as the preview. The bucket is private, and
         * asking for a signed url for a file we have open on this phone is a
         * round trip for a picture already on screen.
         */
        uploaded.push({ ...result.attachment, url: asset.uri });
      }

      if (uploaded.length > 0) {
        onChange({
          ...draft,
          attachments: [...draft.attachments, ...uploaded],
        });
      }
    } catch (uploadError) {
      onError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to attach that.",
      );
    } finally {
      setUploading(false);
    }
  }

  function remove(attachment: SavedReplyAttachment) {
    onChange({
      ...draft,
      attachments: draft.attachments.filter(
        (one) => one.path !== attachment.path,
      ),
    });
  }

  async function createCategory() {
    const name = newCategory.trim();

    if (!name) {
      setNaming(false);
      return;
    }

    try {
      await api("/api/saved-reply-categories", businessId, {
        method: "POST",
        body: { name },
      });

      onCategoryCreated(name);
      onChange({ ...draft, category: name });
      setNewCategory("");
      setNaming(false);
    } catch (createError) {
      onError(
        createError instanceof Error
          ? createError.message
          : "Unable to create that category.",
      );
    }
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 14, paddingTop: 0, gap: 16 }}
    >
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.red, fontSize: 13, lineHeight: 19 }}
        >
          {error}
        </Text>
      ) : null}

      <Field
        label={t("Title", "ចំណងជើង")}
        value={draft.title}
        placeholder={t("Delivery times", "ពេលវេលាដឹកជញ្ជូន")}
        onChange={(title) => onChange({ ...draft, title })}
      />

      <Field
        label={t("Reply content", "ខ្លឹមសារឆ្លើយតប")}
        value={draft.messageText}
        placeholder={t(
          "We deliver in Phnom Penh within 24 hours.",
          "យើងដឹកជញ្ជូននៅភ្នំពេញក្នុងរយៈពេល ២៤ ម៉ោង។",
        )}
        multiline
        onChange={(messageText) => onChange({ ...draft, messageText })}
      />

      {/* ---- attachments ---------------------------------------------- */}
      <View style={{ gap: 8 }}>
        <Label>
          {t("Images and video (optional)", "រូបភាព និងវីដេអូ (បើមាន)")}
        </Label>

        {draft.attachments.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
          >
            {draft.attachments.map((attachment) => (
              <View key={attachment.path}>
                {attachment.kind === "image" ? (
                  <Image
                    source={{ uri: attachment.url ?? undefined }}
                    style={{
                      width: 74,
                      height: 74,
                      borderRadius: 12,
                      backgroundColor: colors.pale,
                    }}
                  />
                ) : (
                  <View
                    style={{
                      width: 74,
                      height: 74,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: colors.pale,
                    }}
                  >
                    <Ionicons
                      name="videocam"
                      size={24}
                      color={colors.blue}
                    />
                  </View>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("Remove", "ដកចេញ")}
                  onPress={() => remove(attachment)}
                  hitSlop={8}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.ink,
                  }}
                >
                  <Ionicons name="close" size={14} color="white" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <View style={{ flexDirection: "row", gap: 8 }}>
          <AddButton
            icon="image-outline"
            label={t("Add images", "បន្ថែមរូបភាព")}
            disabled={uploading || images.length >= MAX_IMAGES}
            onPress={() => void pick("image")}
          />

          <AddButton
            icon="videocam-outline"
            label={t("Add video", "បន្ថែមវីដេអូ")}
            disabled={uploading || videos.length >= MAX_VIDEOS}
            onPress={() => void pick("video")}
          />
        </View>

        {uploading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator color={colors.blue} />
            <Text style={[styles.muted, { fontSize: 12.5 }]}>
              {t("Uploading…", "កំពុងបញ្ជូន…")}
            </Text>
          </View>
        ) : null}
      </View>

      {/* ---- category -------------------------------------------------- */}
      <View style={{ gap: 8 }}>
        <Label>{t("Category", "ប្រភេទ")}</Label>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {categories.map((name) => {
            const on = draft.category === name;

            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => onChange({ ...draft, category: name })}
                style={({ pressed }) => ({
                  paddingHorizontal: 13,
                  paddingVertical: 9,
                  borderRadius: 999,
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
                    fontSize: 13.5,
                    fontWeight: on ? "800" : "600",
                    color: on ? colors.blue : colors.muted,
                  }}
                >
                  {name}
                </Text>
              </Pressable>
            );
          })}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("New category", "ប្រភេទថ្មី")}
            onPress={() => setNaming(true)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 13,
              paddingVertical: 9,
              borderRadius: 999,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: colors.border,
              backgroundColor: pressed ? colors.pale : "white",
            })}
          >
            <Ionicons name="add" size={14} color={colors.blue} />

            <Text
              style={{ fontSize: 13.5, fontWeight: "700", color: colors.blue }}
            >
              {t("New", "ថ្មី")}
            </Text>
          </Pressable>
        </View>

        {naming ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              value={newCategory}
              onChangeText={setNewCategory}
              autoFocus
              placeholder={t("Shipping", "ការដឹកជញ្ជូន")}
              placeholderTextColor={colors.muted}
              onSubmitEditing={() => void createCategory()}
              style={{
                flex: 1,
                height: 44,
                paddingHorizontal: 13,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: "white",
                fontSize: 15,
                color: colors.ink,
              }}
            />

            <Pressable
              accessibilityRole="button"
              onPress={() => void createCategory()}
              style={({ pressed }) => ({
                justifyContent: "center",
                paddingHorizontal: 16,
                borderRadius: 12,
                backgroundColor: pressed ? "#0A6FA8" : colors.blue,
              })}
            >
              <Text
                style={{ color: "white", fontSize: 14, fontWeight: "700" }}
              >
                {t("Add", "បន្ថែម")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Field
        label={t("Shortcut (optional)", "ផ្លូវកាត់ (បើមាន)")}
        value={draft.shortcut}
        placeholder="delivery"
        onChange={(shortcut) => onChange({ ...draft, shortcut })}
      />

      <View style={{ gap: 6 }}>
        <Label>{t("Order", "លំដាប់")}</Label>

        <TextInput
          value={draft.sortIndex}
          onChangeText={(value) =>
            onChange({ ...draft, sortIndex: value.replace(/[^0-9]/g, "") })
          }
          placeholder="0"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
          maxLength={4}
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

        <Text style={[styles.muted, { fontSize: 12, lineHeight: 17 }]}>
          {t(
            "Lower comes first, in this list and in the composer.",
            "លេខតូចមកមុន ទាំងក្នុងបញ្ជីនេះ និងក្នុងប្រអប់សរសេរសារ។",
          )}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={saving || uploading}
        onPress={onSave}
        style={({ pressed }) => ({
          alignItems: "center",
          justifyContent: "center",
          paddingVertical: 14,
          borderRadius: 14,
          backgroundColor: pressed ? "#0A6FA8" : colors.blue,
          opacity: saving || uploading ? 0.6 : 1,
        })}
      >
        {saving ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={{ color: "white", fontSize: 15, fontWeight: "700" }}>
            {t("Save", "រក្សាទុក")}
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </Text>
  );
}

function AddButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "image-outline" | "videocam-outline";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingVertical: 12,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.pale : "white",
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <Ionicons name={icon} size={17} color={colors.blue} />

      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.blue }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  placeholder,
  multiline,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>

      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        style={{
          minHeight: multiline ? 110 : 46,
          paddingHorizontal: 13,
          paddingVertical: 12,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: "white",
          fontSize: 15,
          color: colors.ink,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}
