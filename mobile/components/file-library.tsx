import { Ionicons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthImage } from "./auth-image";
import { IconName, colors, styles } from "./ui";
import { useMediaSource } from "../lib/media";

/*
 * Everything a conversation or a room has sent, in the shapes people look for
 * it in.
 *
 * Written for the customer panel and used by the team rooms as well, because
 * "where is that receipt" is the same question in both places and two answers
 * that look different are two things to learn.
 */

const FILL = {
  position: "absolute" as const,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

/*
 * Something this customer has sent or had saved against them.
 *
 * Two lists on the server -- files somebody saved to the record, and every
 * attachment that came through a conversation -- flattened into one here,
 * because "where is that receipt" is one question and the answer does not
 * depend on which of the two it happens to be.
 */
export type CustomerFile = {
  id: string;
  kind: "image" | "video" | "file" | "link";
  name: string;
  url: string | null;
  detail: string | null;
  createdAt: string;
  /* Stable across signed links, so a thumbnail is downloaded once. */
  cacheKey?: string;
};

/* A date and a time somebody can read. */
function stamp(value?: string | null) {
  if (!value) return "—";

  const at = new Date(value);

  return `${at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}, ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

/*
 * A photo or a clip, full screen, inside the app.
 *
 * Tapping one used to hand its URL to the phone's browser, which is a
 * different app, a loading bar, and often a login page for a link that was
 * signed for this session and nobody else -- to look at a picture that was
 * already downloaded. Documents and links still leave, because a PDF or a
 * shop's website is what a browser is for.
 */
function MediaViewer({
  item,
  onClose,
}: {
  item: CustomerFile | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={Boolean(item)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: "rgba(8,16,28,0.96)" }}>
        <Pressable
          accessibilityLabel="Close"
          onPress={onClose}
          style={{ ...FILL }}
        />

        {item?.kind === "video" && item.url ? (
          <ViewerVideo uri={item.url} />
        ) : item?.url ? (
          <AuthImage
            uri={item.url}
            cacheKey={item.cacheKey}
            resizeMode="contain"
            style={{ width: "100%", height: "100%" }}
          />
        ) : null}

        <View
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            top: insets.top + 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              color: "white",
              fontSize: 14,
              fontWeight: "700",
            }}
          >
            {item?.name ?? ""}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={12}
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(255,255,255,0.16)",
            }}
          >
            <Ionicons name="close" size={21} color="white" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ViewerVideo({ uri }: { uri: string }) {
  /*
   * Resolved the same way a picture is: an attachment proxied through TENH
   * needs the origin and the session cookie, or the player gets a 401 and
   * shows a black rectangle.
   */
  const resolve = useMediaSource();
  const player = useVideoPlayer(resolve(uri) ?? uri, (instance) => {
    instance.play();
  });

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
/*
 * Everything a customer has sent, in the three shapes people look for it in.
 *
 * One flat list meant a photo from March and a PDF from yesterday were the
 * same kind of row, and a picture reduced to its file name is a picture
 * nobody recognises. Media becomes a grid of the pictures themselves, grouped
 * by the month they arrived -- which is how somebody actually remembers
 * ("that was around August") -- and documents and links keep the list, where
 * the name is the thing you read.
 */
type LibraryTab = "media" | "files" | "links";

const TABS: { key: LibraryTab; label: string; icon: IconName }[] = [
  { key: "media", label: "Photos & videos", icon: "images-outline" },
  { key: "files", label: "Files", icon: "document-outline" },
  { key: "links", label: "Links", icon: "link-outline" },
];

function monthOf(value: string) {
  const at = new Date(value);

  if (!Number.isFinite(at.getTime())) return "Earlier";

  const now = new Date();

  return at.getFullYear() === now.getFullYear()
    ? at.toLocaleDateString(undefined, { month: "long" })
    : at.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function FileLibrary({ files }: { files: CustomerFile[] }) {
  const [tab, setTab] = useState<LibraryTab>("media");
  const [preview, setPreview] = useState<CustomerFile | null>(null);

  /*
   * A picture is looked at here; a document or a link is opened where it can
   * actually be read.
   */
  function open(item: CustomerFile) {
    if (!item.url) return;

    if (item.kind === "image" || item.kind === "video") {
      setPreview(item);
      return;
    }

    void Linking.openURL(item.url);
  }

  const media = files.filter(
    (file) => file.kind === "image" || file.kind === "video",
  );
  const documents = files.filter((file) => file.kind === "file");
  const links = files.filter((file) => file.kind === "link");

  const counts: Record<LibraryTab, number> = {
    media: media.length,
    files: documents.length,
    links: links.length,
  };

  const shown = tab === "media" ? media : tab === "files" ? documents : links;

  /* Months in the order they arrived, newest first, as the list already is. */
  const months: { name: string; items: CustomerFile[] }[] = [];

  for (const item of shown) {
    const name = monthOf(item.createdAt);
    const last = months[months.length - 1];

    if (last && last.name === name) {
      last.items.push(item);
    } else {
      months.push({ name, items: [item] });
    }
  }

  return (
    <>
      <View
        style={{
          flexDirection: "row",
          gap: 6,
          paddingHorizontal: 18,
          paddingBottom: 12,
        }}
      >
        {TABS.map((one) => {
          const active = one.key === tab;

          return (
            <Pressable
              key={one.key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(one.key)}
              style={{
                flex: 1,
                alignItems: "center",
                gap: 3,
                paddingVertical: 9,
                borderRadius: 12,
                backgroundColor: active ? colors.pale : colors.background,
              }}
            >
              <Ionicons
                name={one.icon}
                size={16}
                color={active ? colors.blue : colors.muted}
              />

              <Text
                numberOfLines={1}
                style={{
                  fontSize: 10.5,
                  fontWeight: "800",
                  color: active ? colors.blue : colors.muted,
                }}
              >
                {one.label}
              </Text>

              <Text style={{ fontSize: 10, color: colors.muted }}>
                {counts[one.key]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {shown.length === 0 ? (
        <View style={{ alignItems: "center", padding: 34, gap: 8 }}>
          <Ionicons
            name={TABS.find((one) => one.key === tab)?.icon ?? "folder-outline"}
            size={26}
            color={colors.muted}
          />

          <Text
            style={{ fontSize: 13.5, color: colors.muted, textAlign: "center" }}
          >
            {tab === "media"
              ? "No photos or videos from this customer yet."
              : tab === "files"
                ? "No documents have been sent or saved."
                : "No links have been saved for this customer."}
          </Text>
        </View>
      ) : (
        <ScrollView
          keyboardDismissMode="on-drag"
          style={{ maxHeight: 430 }}
          contentContainerStyle={{ paddingBottom: 14 }}
        >
          {months.map((month) => (
            <View key={month.name}>
              <Text
                style={{
                  paddingHorizontal: 18,
                  paddingTop: 10,
                  paddingBottom: 8,
                  fontSize: 13,
                  fontWeight: "800",
                  color: colors.ink,
                }}
              >
                {month.name}
              </Text>

              {tab === "media" ? (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 3,
                    paddingHorizontal: 15,
                  }}
                >
                  {month.items.map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Open ${item.name}`}
                      disabled={!item.url}
                      onPress={() => open(item)}
                      style={{
                        width: "32.4%",
                        aspectRatio: 1,
                        borderRadius: 8,
                        overflow: "hidden",
                        backgroundColor: colors.background,
                      }}
                    >
                      {item.url ? (
                        <AuthImage
                          uri={item.url}
                          cacheKey={item.cacheKey}
                          style={{ width: "100%", height: "100%" }}
                        />
                      ) : null}

                      {/*
                        A video says so on the tile. There is no frame to show
                        -- the payload carries a link, not a thumbnail -- so
                        the mark sits over whatever the tile has.
                      */}
                      {item.kind === "video" ? (
                        <View
                          style={{
                            ...FILL,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "rgba(16,34,56,0.28)",
                          }}
                        >
                          <Ionicons name="play-circle" size={26} color="white" />
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ) : (
                month.items.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.name}`}
                    disabled={!item.url}
                    onPress={() => open(item)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingHorizontal: 18,
                      paddingVertical: 11,
                      backgroundColor: pressed ? colors.pale : "transparent",
                    })}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: colors.background,
                      }}
                    >
                      <Ionicons
                        name={
                          item.kind === "link"
                            ? "link-outline"
                            : "document-text-outline"
                        }
                        size={18}
                        color={colors.blue}
                      />
                    </View>

                    <View style={{ flex: 1, gap: 2 }}>
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 14,
                          fontWeight: "700",
                          color: colors.ink,
                        }}
                      >
                        {item.name}
                      </Text>

                      <Text
                        numberOfLines={1}
                        style={{ fontSize: 11.5, color: colors.muted }}
                      >
                        {[item.detail, stamp(item.createdAt)]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>

                    {item.url ? (
                      <Ionicons
                        name="open-outline"
                        size={16}
                        color={colors.muted}
                      />
                    ) : null}
                  </Pressable>
                ))
              )}
            </View>
          ))}
        </ScrollView>
      )}

      <MediaViewer item={preview} onClose={() => setPreview(null)} />
    </>
  );
}

