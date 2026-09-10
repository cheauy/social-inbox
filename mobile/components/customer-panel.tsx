import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Avatar,
  Empty,
  IconName,
  STATUS_TONE,
  TagChip,
  colors,
  relativeTime,
  styles,
} from "./ui";
import type { ConversationStatus } from "../lib/types";
import { AuthImage } from "./auth-image";

/*
 * The customer, as a panel that slides in from the right.
 *
 * It was two bottom sheets. A sheet is the right shape for a short list of
 * choices and the wrong one for a record: the details, the state of the
 * conversation and everything you can do to it do not fit in the two thirds
 * of the screen a sheet is allowed, and scrolling a sheet fights the gesture
 * that dismisses it. The web keeps this in a right-hand rail; a phone has no
 * room for a rail beside the thread, so it arrives over it.
 */

const { width: SCREEN } = Dimensions.get("window");
const PANEL = Math.min(400, Math.round(SCREEN * 0.88));

/* How far the panel must be dragged before letting go closes it. */
const DISMISS_AFTER = PANEL * 0.3;

const FILL = {
  position: "absolute" as const,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

export type TeamMember = {
  id: string;
  full_name: string | null;
  role: string | null;
};

export type CustomerDetail = {
  customer: {
    id: string;
    fullName: string;
    profilePictureUrl: string | null;
    platformUserId: string | null;
    phone: string | null;
    address: string | null;
    customerNote: string | null;
    createdAt: string | null;
    lastActiveAt: string | null;
    tags: { id: string; name: string; color: string | null }[];
  };
};

export type EditableField = "phone" | "customerNote";

const STATUSES: { key: ConversationStatus; label: string; icon: IconName }[] = [
  { key: "open", label: "Open", icon: "ellipse-outline" },
  { key: "pending", label: "Pending", icon: "time-outline" },
  { key: "resolved", label: "Resolved", icon: "checkmark-circle-outline" },
  { key: "closed", label: "Closed", icon: "archive-outline" },
  { key: "spam", label: "Spam", icon: "alert-circle-outline" },
];

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
 * A reminder's time, chosen from four rather than typed.
 *
 * A follow-up in this app is almost always "later today" or "first thing
 * tomorrow" -- picking a minute for something that will be read as "soon" is
 * work for nothing, and a date picker on a phone is four taps before the
 * note has even been written.
 */
type WhenKey = "hour" | "evening" | "tomorrow" | "week";

const WHEN: { key: WhenKey; label: string; icon: IconName }[] = [
  { key: "hour", label: "In 1 hour", icon: "hourglass-outline" },
  { key: "evening", label: "In 3 hours", icon: "cafe-outline" },
  { key: "tomorrow", label: "Tomorrow 9am", icon: "sunny-outline" },
  { key: "week", label: "Next week", icon: "calendar-outline" },
];

function whenToStamp(key: WhenKey) {
  const when = new Date();

  if (key === "hour") {
    when.setHours(when.getHours() + 1);
  } else if (key === "evening") {
    when.setHours(when.getHours() + 3);
  } else if (key === "tomorrow") {
    when.setDate(when.getDate() + 1);
    when.setHours(9, 0, 0, 0);
  } else {
    when.setDate(when.getDate() + 7);
    when.setHours(9, 0, 0, 0);
  }

  return when.toISOString();
}

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

/* One event in a customer's history, as the timeline endpoint sends it. */
export type TimelineItem = {
  id: string;
  type: string;
  createdAt: string;
  title: string;
  detail: string | null;
  actorName: string | null;
};

/*
 * A titled group, drawn as a card on the panel's tinted ground.
 *
 * The sections used to be separated by hairlines on white, which left the
 * whole record as one long undifferentiated column -- the eye had nothing to
 * catch on and the headings did all the work. Cards give each group an edge,
 * and match how every other screen in the app is built.
 */
/*
 * A question in the middle of the screen.
 *
 * The panel is already a surface sliding over the thread; unfolding a form
 * inside it pushed the record it belongs to half a screen down and left two
 * things competing for the same column. A dialog sits above both, dims what
 * it interrupts, and has one way in and one way out.
 */
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

function FileLibrary({ files }: { files: CustomerFile[] }) {
  const [tab, setTab] = useState<LibraryTab>("media");

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
                      onPress={() => {
                        if (item.url) void Linking.openURL(item.url);
                      }}
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
                    onPress={() => {
                      if (item.url) void Linking.openURL(item.url);
                    }}
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
    </>
  );
}

function Dialog({
  open,
  title,
  detail,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  detail: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 20,
          backgroundColor: "rgba(16,34,56,0.45)",
        }}
      >
        {/* The backdrop closes it, and it is the whole screen behind the card. */}
        <Pressable
          accessibilityLabel={`Close ${title.toLowerCase()}`}
          onPress={onClose}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <View
          /* Stops a tap inside the card reaching the backdrop under it. */
          onStartShouldSetResponder={() => true}
          style={{
            width: "100%",
            maxWidth: 460,
            alignSelf: "center",
            borderRadius: 20,
            backgroundColor: "white",
            overflow: "hidden",
            elevation: 12,
            shadowColor: "#102238",
            shadowOpacity: 0.22,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 12,
              padding: 18,
              paddingBottom: 12,
            }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 17, fontWeight: "800", color: colors.ink }}>
                {title}
              </Text>

              {detail ? (
                <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.muted }}>
                  {detail}
                </Text>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              onPress={onClose}
            >
              <Ionicons name="close" size={21} color={colors.muted} />
            </Pressable>
          </View>

          {children}
        </View>
      </View>
    </Modal>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  /* A control that belongs to the whole group rather than to one row. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 4,
          minHeight: 18,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: "800",
            letterSpacing: 0.7,
            textTransform: "uppercase",
            color: colors.muted,
          }}
        >
          {title}
        </Text>

        {action}
      </View>

      <View
        style={{
          backgroundColor: "white",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: 14,
          paddingVertical: 4,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** A hairline between two rows of the same card. */
function Divider() {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: colors.border,
        marginHorizontal: -14,
      }}
    />
  );
}

/** A copy button that says it worked, then goes quiet again. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label}`}
      hitSlop={10}
      onPress={() => {
        void Clipboard.setStringAsync(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      <Ionicons
        name={done ? "checkmark" : "copy-outline"}
        size={14}
        color={done ? "#2FA36B" : colors.muted}
      />
    </Pressable>
  );
}

/*
 * A field you can read, copy and change without leaving the panel.
 *
 * Both of these are things an agent learns mid-conversation -- a customer
 * says their number out loud and it wants writing down before the next
 * message arrives. Sending them to the web for that is how a phone number
 * ends up only in the thread.
 */
/*
 * Phone and note: read, copy, or edit -- but one thing at a time.
 *
 * Each field used to own its own editor, which meant its own Save and its own
 * Cancel, so a card holding two facts showed two of each and it was never
 * clear which pair was about to act on what. The card is now either being
 * read or being edited: the pencil in the section header turns it over, both
 * fields become inputs, and one Save at the bottom writes whatever changed.
 *
 * The values are not tappable. A field that silently turns into an editor
 * when brushed is how a note gets rewritten by somebody who was only trying
 * to scroll.
 */
function Information({
  phone,
  note,
  busy,
  editing,
  onEditing,
  onSaveField,
}: {
  phone: string | null;
  note: string | null;
  busy: string | null;
  editing: boolean;
  onEditing: (next: boolean) => void;
  onSaveField: (field: EditableField, value: string) => Promise<boolean>;
}) {
  const [phoneDraft, setPhoneDraft] = useState(phone ?? "");
  const [noteDraft, setNoteDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);

  /* The drafts follow the record while it is being read, never while it is
     being written -- a realtime update mid-edit would wipe what was typed. */
  useEffect(() => {
    if (!editing) {
      setPhoneDraft(phone ?? "");
      setNoteDraft(note ?? "");
    }
  }, [phone, note, editing]);

  const dirty =
    phoneDraft.trim() !== (phone ?? "").trim() ||
    noteDraft.trim() !== (note ?? "").trim();

  async function save() {
    if (saving) return;

    setSaving(true);

    try {
      /*
       * Only what changed, and one at a time: each field is its own request
       * on the server, and sending an unchanged note back would overwrite
       * whatever somebody at the desk wrote in the meantime.
       */
      if (phoneDraft.trim() !== (phone ?? "").trim()) {
        if (!(await onSaveField("phone", phoneDraft.trim()))) return;
      }

      if (noteDraft.trim() !== (note ?? "").trim()) {
        if (!(await onSaveField("customerNote", noteDraft.trim()))) return;
      }

      onEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <>
        <InfoRow
          icon="call-outline"
          label="Phone"
          value={phone}
          empty="Not added"
        />

        <Divider />

        <InfoRow
          icon="document-text-outline"
          label="Note"
          value={note}
          empty="No customer note has been added."
        />
      </>
    );
  }

  return (
    <View style={{ paddingVertical: 14, gap: 14 }}>
      <View style={{ gap: 6 }}>
        <FieldLabel icon="call-outline" label="Phone" />

        <TextInput
          value={phoneDraft}
          onChangeText={setPhoneDraft}
          keyboardType="phone-pad"
          placeholder="Not added"
          placeholderTextColor={colors.muted}
          editable={!saving}
          style={[styles.input, { fontSize: 15, paddingVertical: 10 }]}
        />
      </View>

      <View style={{ gap: 6 }}>
        <FieldLabel icon="document-text-outline" label="Note" />

        <TextInput
          value={noteDraft}
          onChangeText={setNoteDraft}
          multiline
          placeholder="Anything worth remembering about this customer."
          placeholderTextColor={colors.muted}
          editable={!saving}
          style={[
            styles.input,
            {
              fontSize: 15,
              minHeight: 84,
              paddingTop: 10,
              textAlignVertical: "top",
            },
          ]}
        />
      </View>

      {/* One pair, for the card. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          disabled={saving || !dirty}
          onPress={() => void save()}
          style={({ pressed }) => ({
            flex: 1,
            alignItems: "center",
            paddingVertical: 12,
            borderRadius: 12,
            opacity: dirty ? 1 : 0.45,
            backgroundColor: pressed ? "#0072AB" : colors.blue,
          })}
        >
          {saving || Boolean(busy?.startsWith("field:")) ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={{ color: "white", fontSize: 14.5, fontWeight: "800" }}>
              Save
            </Text>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={() => {
            setPhoneDraft(phone ?? "");
            setNoteDraft(note ?? "");
            onEditing(false);
          }}
          style={({ pressed }) => ({
            paddingHorizontal: 18,
            paddingVertical: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: pressed ? colors.pale : "white",
          })}
        >
          <Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: "700" }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* A row that leads somewhere else: a list, or a decision. */
function OtherRow({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: IconName;
  label: string;
  tone?: string;
  onPress: () => void;
}) {
  const colour = tone ?? colors.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
        paddingVertical: 14,
        marginHorizontal: -14,
        paddingHorizontal: 14,
        backgroundColor: pressed ? colors.pale : "transparent",
      })}
    >
      <Ionicons name={icon} size={17} color={tone ?? colors.muted} />

      <Text style={{ flex: 1, fontSize: 14.5, color: colour, fontWeight: "600" }}>
        {label}
      </Text>

      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}

function FieldLabel({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Ionicons name={icon} size={13} color={colors.muted} />

      <Text style={{ fontSize: 12.5, color: colors.muted }}>{label}</Text>
    </View>
  );
}

/* A field being read, with its own copy button. */
function InfoRow({
  icon,
  label,
  value,
  empty,
}: {
  icon: IconName;
  label: string;
  value: string | null;
  empty: string;
}) {
  const text = value?.trim() ?? "";

  return (
    <View style={{ paddingVertical: 12, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={icon} size={13} color={colors.muted} />

        <Text style={{ fontSize: 12.5, color: colors.muted, flex: 1 }}>
          {label}
        </Text>

        {/* Only when there is something to copy. */}
        {text ? <CopyButton value={text} label={label} /> : null}
      </View>

      <Text
        style={{
          fontSize: 15,
          lineHeight: 21,
          color: text ? colors.ink : colors.muted,
        }}
      >
        {text || empty}
      </Text>
    </View>
  );
}

function ActionTile({
  icon,
  label,
  tint,
  active,
  busy,
  onPress,
}: {
  icon: IconName;
  label: string;
  tint?: string;
  active?: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  const colour = tint ?? (active ? colors.blue : colors.ink);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(active) }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: "center",
        gap: 5,
        paddingVertical: 10,
        borderRadius: 13,
        backgroundColor: active
          ? tint === colors.pin
            ? colors.pinWash
            : colors.pale
          : pressed
            ? colors.background
            : "transparent",
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.blue} />
      ) : (
        <Ionicons name={icon} size={20} color={colour} />
      )}

      <Text
        numberOfLines={1}
        style={{ fontSize: 10.5, fontWeight: "700", color: colour }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/*
 * One fact about the customer, on the tinted ground inside their card.
 *
 * Two of these side by side say more about a relationship than the same two
 * lines further down a record: how long they have been a customer, and
 * whether they were here this morning.
 */
function Fact({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        gap: 3,
        paddingHorizontal: 11,
        paddingVertical: 9,
        borderRadius: 12,
        backgroundColor: colors.background,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Ionicons name={icon} size={11} color={colors.muted} />

        <Text style={{ fontSize: 10.5, color: colors.muted }}>{label}</Text>
      </View>

      <Text
        numberOfLines={1}
        style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}
      >
        {value}
      </Text>
    </View>
  );
}

/* A date without the time: nobody needs the minute somebody became a customer. */
function since(value?: string | null) {
  if (!value) return "—";

  const at = new Date(value);

  return Number.isFinite(at.getTime())
    ? at.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
}

function ChoiceRow({
  icon,
  label,
  detail,
  active,
  busy,
  onPress,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  active: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 10,
        marginHorizontal: -10,
        borderRadius: 10,
        backgroundColor: pressed ? colors.pale : "transparent",
      })}
    >
      <Ionicons name={icon} size={17} color={active ? colors.blue : colors.muted} />

      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 14.5,
            color: colors.ink,
            fontWeight: active ? "800" : "500",
          }}
        >
          {label}
        </Text>

        {detail ? (
          <Text style={{ fontSize: 12, color: colors.muted }}>{detail}</Text>
        ) : null}
      </View>

      {busy ? (
        <ActivityIndicator color={colors.blue} />
      ) : active ? (
        <Ionicons name="checkmark" size={17} color={colors.blue} />
      ) : null}
    </Pressable>
  );
}

export function CustomerPanel({
  open,
  detail,
  loading,
  channelName,
  channelIcon,
  status,
  pinned,
  assignedTo,
  members,
  membersLoading,
  currentMemberId,
  busy,
  onStatus,
  onAssign,
  onPin,
  onUnread,
  onSaveField,
  onRemind,
  onHistory,
  onFiles,
  onClose,
  error,
}: {
  open: boolean;
  detail: CustomerDetail | null;
  loading: boolean;
  channelName: string | null;
  channelIcon: IconName;
  status: ConversationStatus | null;
  pinned: boolean;
  assignedTo: string | null;
  members: TeamMember[];
  membersLoading: boolean;
  currentMemberId: string | null;
  busy: string | null;
  onStatus: (next: ConversationStatus) => void;
  onAssign: (memberId: string | null) => void;
  onPin: () => void;
  onUnread: () => void;
  onSaveField: (field: EditableField, value: string) => Promise<boolean>;
  /* Both answered by the conversation screen, which owns the workspace the
     requests have to be made in. */
  onRemind: (note: string, remindAt: string) => Promise<boolean>;
  onHistory: () => Promise<TimelineItem[]>;
  onFiles: () => Promise<CustomerFile[]>;
  onClose: () => void;
  error: string;
}) {
  const insets = useSafeAreaInsets();

  const slide = useRef(new Animated.Value(PANEL)).current;
  const [mounted, setMounted] = useState(open);
  const [statusOpen, setStatusOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const [remindOpen, setRemindOpen] = useState(false);
  const [remindNote, setRemindNote] = useState("");
  const [remindWhen, setRemindWhen] = useState<WhenKey>("tomorrow");
  const [reminding, setReminding] = useState(false);
  const [reminded, setReminded] = useState("");

  const [infoEditing, setInfoEditing] = useState(false);

  const [filesOpen, setFilesOpen] = useState(false);
  const [files, setFiles] = useState<CustomerFile[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<TimelineItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function saveReminder() {
    const note = remindNote.trim();

    if (!note || reminding) return;

    setReminding(true);

    try {
      if (await onRemind(note, whenToStamp(remindWhen))) {
        setRemindNote("");
        setRemindOpen(false);
        setReminded(`Reminder set for ${WHEN.find((one) => one.key === remindWhen)?.label.toLowerCase()}.`);
      }
    } finally {
      setReminding(false);
    }
  }

  /*
   * Spam, with the question asked first.
   *
   * It moves the conversation to the Spam status, which is what the web's
   * spam view reads and what takes it out of everybody's Inbox. Confirmed
   * because it is the one status change that reads as an accusation, and an
   * accidental one is a customer nobody answers.
   */
  function reportSpam() {
    if (status === "spam") {
      Alert.alert(
        "Already marked as spam",
        "This conversation is already in the Spam view. Change its status to bring it back.",
      );

      return;
    }

    Alert.alert(
      "Report as spam?",
      "The conversation moves to Spam and leaves the Inbox. You can change its status again at any time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report spam",
          style: "destructive",
          onPress: () => onStatus("spam"),
        },
      ],
    );
  }

  async function openFiles() {
    setFilesOpen(true);

    if (files !== null || filesLoading) return;

    setFilesLoading(true);

    try {
      setFiles(await onFiles());
    } finally {
      setFilesLoading(false);
    }
  }

  async function openHistory() {
    const next = !historyOpen;

    setHistoryOpen(next);

    /* Loaded the first time it is opened and kept, because a timeline of a
       customer's whole history does not change while the panel is open. */
    if (!next || history !== null || historyLoading) return;

    setHistoryLoading(true);

    try {
      setHistory(await onHistory());
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setMounted(true);
    }

    Animated.timing(slide, {
      toValue: open ? 0 : PANEL,
      duration: open ? 220 : 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) {
        setMounted(false);
        setStatusOpen(false);
        setRemindOpen(false);
        setHistoryOpen(false);
        setFilesOpen(false);
        setInfoEditing(false);
        setReminded("");
        setAssignOpen(false);
      }
    });
  }, [open, slide]);

  /*
   * Drag the panel back off to the right. Claimed only for a horizontal drag:
   * the panel scrolls, and a responder that took every touch would make the
   * record unreadable.
   */
  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,

      onPanResponderMove: (_event, gesture) => {
        slide.setValue(Math.max(0, gesture.dx));
      },

      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx > DISMISS_AFTER || gesture.vx > 0.5) {
          onClose();
          return;
        }

        Animated.spring(slide, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
    }),
  ).current;

  if (!mounted) {
    return null;
  }

  const customer = detail?.customer ?? null;
  const statusLabel =
    STATUSES.find((option) => option.key === status)?.label ?? "Status";
  const statusIcon =
    STATUSES.find((option) => option.key === status)?.icon ?? "ellipse-outline";
  const assignedName =
    members.find((member) => member.id === assignedTo)?.full_name ?? null;

  return (
    <View style={FILL} pointerEvents="box-none">
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={{
          ...FILL,
          backgroundColor: "rgba(16,34,56,0.35)",
          opacity: slide.interpolate({
            inputRange: [0, PANEL],
            outputRange: [1, 0],
          }),
        }}
      >
        <Pressable
          accessibilityLabel="Close customer details"
          onPress={onClose}
          style={{ flex: 1 }}
        />
      </Animated.View>

      <Animated.View
        {...drag.panHandlers}
        /*
         * Claim any touch nothing inside wanted. The backdrop runs the full
         * width behind this, and Android hands an unclaimed touch to the view
         * below -- so tapping a gap between the cards was closing the panel.
         */
        onStartShouldSetResponder={() => true}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: PANEL,
          backgroundColor: colors.background,
          borderLeftWidth: 1,
          borderLeftColor: colors.border,
          transform: [{ translateX: slide }],
        }}
      >
        {/*
          A refusal from anything in here has to be readable in here. The
          thread has its own error line, and it sits behind this panel: an
          agent tapping Save watched nothing happen and had no way to learn
          that the server had turned it down.
        */}
        {error ? (
          <View
            accessibilityRole="alert"
            style={{
              backgroundColor: "#FFF1EF",
              paddingTop: insets.top + 10,
              paddingBottom: 10,
              paddingHorizontal: 18,
            }}
          >
            <Text style={{ color: colors.red, fontSize: 13, lineHeight: 19 }}>
              {error}
            </Text>
          </View>
        ) : null}

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingTop: error ? 14 : insets.top + 14,
            paddingBottom: insets.bottom + 28,
            paddingHorizontal: 14,
            gap: 16,
          }}
        >
          {loading && !customer ? (
            <View style={{ paddingVertical: 60 }}>
              <ActivityIndicator color={colors.blue} />
            </View>
          ) : !customer ? (
            <Empty
              icon="person-outline"
              title="No customer record"
              detail="This conversation is not linked to a customer yet. It will be as soon as the next message arrives."
            />
          ) : (
            <>
              {/*
                The customer, as a card that leads with who they are.

                It was an avatar, a name, a platform id and a page name at the
                same weight, so the line an agent never reads -- a
                seventeen-digit Facebook id -- sat directly under the one they
                always do. The name is the heading; the page is a chip beside
                the channel it came in on; the id is a row you can copy and
                otherwise ignore.
              */}
              <View
                style={{
                  padding: 16,
                  gap: 14,
                  borderRadius: 18,
                  backgroundColor: "white",
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <View style={{ flexDirection: "row", gap: 13 }}>
                  <Avatar
                    name={customer.fullName}
                    uri={customer.profilePictureUrl}
                    size={54}
                  />

                  <View style={{ flex: 1, gap: 6 }}>
                    <View
                      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                    >
                      <Text
                        numberOfLines={2}
                        style={{
                          flexShrink: 1,
                          fontSize: 18,
                          fontWeight: "800",
                          color: colors.ink,
                          lineHeight: 23,
                        }}
                      >
                        {customer.fullName}
                      </Text>

                      {/*
                        The name is the thing worth copying -- it goes into an
                        order, a delivery note, a search on the web. The
                        platform id below is TENH's own plumbing; copying it
                        was an offer nobody took up.
                      */}
                      <CopyButton value={customer.fullName} label="the name" />
                    </View>

                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        alignSelf: "flex-start",
                        gap: 5,
                        paddingHorizontal: 9,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: colors.pale,
                      }}
                    >
                      <Ionicons name={channelIcon} size={12} color={colors.blue} />

                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 11.5,
                          fontWeight: "700",
                          color: colors.blue,
                          maxWidth: 160,
                        }}
                      >
                        {channelName ?? "Unknown page"}
                      </Text>
                    </View>
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close customer details"
                    hitSlop={10}
                    onPress={onClose}
                  >
                    <Ionicons name="close" size={22} color={colors.muted} />
                  </Pressable>
                </View>

                {/*
                  Two facts about the relationship rather than about the
                  record: how long they have been a customer, and whether they
                  were here this morning or in March.
                */}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Fact
                    icon="calendar-outline"
                    label="Customer since"
                    value={since(customer.createdAt)}
                  />

                  <Fact
                    icon="pulse-outline"
                    label="Last active"
                    value={relativeTime(customer.lastActiveAt) || "—"}
                  />
                </View>

                {customer.platformUserId ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingTop: 2,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{ flex: 1, fontSize: 11.5, color: colors.muted }}
                    >
                      ID {customer.platformUserId}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/*
                Everything you can do, on one strip.

                Five actions in two rows of big cards took a third of the
                panel before a single fact about the customer appeared. As
                tiles on one row they still name themselves, and the record
                starts above the fold.
              */}
              <View
                style={{
                  flexDirection: "row",
                  padding: 6,
                  borderRadius: 18,
                  backgroundColor: "white",
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <ActionTile
                  icon={statusIcon}
                  label={statusLabel}
                  tint={STATUS_TONE[status ?? "open"]}
                  active={statusOpen}
                  busy={Boolean(busy?.startsWith("status:"))}
                  onPress={() => setStatusOpen((current) => !current)}
                />

                <ActionTile
                  icon={pinned ? "bookmark" : "bookmark-outline"}
                  label={pinned ? "Pinned" : "Pin"}
                  tint={pinned ? colors.pin : undefined}
                  active={pinned}
                  busy={busy === "pin"}
                  onPress={onPin}
                />

                <ActionTile
                  icon="mail-unread-outline"
                  label="Unread"
                  busy={busy === "unread"}
                  onPress={onUnread}
                />

                <ActionTile
                  icon="alarm-outline"
                  label="Remind"
                  busy={false}
                  onPress={() => {
                    setReminded("");
                    setRemindOpen(true);
                  }}
                />

                <ActionTile
                  icon="time-outline"
                  label="History"
                  busy={false}
                  onPress={() => void openHistory()}
                />
              </View>

              {statusOpen ? (
                <View
                  style={{
                    backgroundColor: "white",
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.border,
                    paddingHorizontal: 14,
                    paddingVertical: 4,
                  }}
                >
                  {STATUSES.map((option) => (
                    <ChoiceRow
                      key={option.key}
                      icon={option.icon}
                      label={option.label}
                      active={status === option.key}
                      busy={busy === `status:${option.key}`}
                      onPress={() => {
                        onStatus(option.key);
                        setStatusOpen(false);
                      }}
                    />
                  ))}
                </View>
              ) : null}

              {reminded ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 7,
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    borderRadius: 12,
                    backgroundColor: "#E7F6EE",
                  }}
                >
                  <Ionicons name="checkmark-circle" size={15} color="#26875C" />

                  <Text style={{ flex: 1, fontSize: 12.5, color: "#1F6B4A" }}>
                    {reminded}
                  </Text>
                </View>
              ) : null}

              <Section
                title={
                  customer.tags.length > 0
                    ? `Tags · ${customer.tags.length}`
                    : "Tags"
                }
              >
                <View style={{ paddingVertical: 13 }}>
                  {customer.tags.length === 0 ? (
                    <Text style={{ fontSize: 13.5, color: colors.muted }}>
                      No tags yet. The tag button in the thread header adds
                      them.
                    </Text>
                  ) : (
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                    >
                      {customer.tags.map((tag) => (
                        <TagChip
                          key={tag.id}
                          name={tag.name}
                          color={tag.color}
                          /* No tick: nothing here is being chosen. A check
                             belongs in the picker, where it says which tags
                             a tap would remove. */
                          showCheck={false}
                        />
                      ))}
                    </View>
                  )}
                </View>
              </Section>

              {/*
                One pencil, on the group rather than on every row.

                Each field carried its own pencil and its own copy button, so
                a card holding two facts held four controls -- and the copy
                buttons went unused, because a phone number on this screen is
                read aloud or dialled, not pasted. The pencil opens both
                fields at once; tapping a field still opens that one.
              */}
              {/*
                One pencil for the group, and one Save for the card. Every
                field used to carry a pencil, a copy button, a Save and a
                Cancel of its own -- eight controls for two facts.
              */}
              <Section
                title="Information"
                action={
                  infoEditing ? null : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Edit information"
                      hitSlop={10}
                      onPress={() => setInfoEditing(true)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
                    >
                      <Ionicons name="pencil" size={13} color={colors.blue} />

                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "800",
                          color: colors.blue,
                        }}
                      >
                        EDIT
                      </Text>
                    </Pressable>
                  )
                }
              >
                <Information
                  phone={customer.phone}
                  note={customer.customerNote}
                  busy={busy}
                  editing={infoEditing}
                  onEditing={setInfoEditing}
                  onSaveField={onSaveField}
                />
              </Section>

              <Section title="Assigned to">
                {/*
                  The assignee as a person rather than a value in a row: a
                  face and a name is what somebody is looking for when they
                  ask who has this, and "Unassigned" is a state worth seeing
                  as clearly as a name.
                */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Change who this is assigned to"
                  onPress={() => setAssignOpen((current) => !current)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 11,
                    paddingVertical: 13,
                    marginHorizontal: -14,
                    paddingHorizontal: 14,
                    backgroundColor: pressed ? colors.pale : "transparent",
                  })}
                >
                  {assignedTo ? (
                    <Avatar name={assignedName ?? "?"} size={34} />
                  ) : (
                    <View
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: colors.background,
                      }}
                    >
                      <Ionicons
                        name="person-outline"
                        size={16}
                        color={colors.muted}
                      />
                    </View>
                  )}

                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 15,
                        fontWeight: assignedTo ? "700" : "500",
                        color: assignedTo ? colors.ink : colors.muted,
                      }}
                    >
                      {assignedName ?? (assignedTo ? "Someone" : "Unassigned")}
                    </Text>

                    <Text style={{ fontSize: 12, color: colors.muted }}>
                      {assignedTo
                        ? "Tap to hand it to somebody else"
                        : "Nobody is looking after this yet"}
                    </Text>
                  </View>

                  <Ionicons
                    name={assignOpen ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.muted}
                  />
                </Pressable>

                {currentMemberId && assignedTo !== currentMemberId ? (
                  <>
                    <Divider />

                    <Pressable
                      accessibilityRole="button"
                      disabled={busy === `assign:${currentMemberId}`}
                      onPress={() => onAssign(currentMemberId)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 7,
                        paddingVertical: 13,
                        marginHorizontal: -14,
                        backgroundColor: pressed ? colors.pale : "transparent",
                      })}
                    >
                      {busy === `assign:${currentMemberId}` ? (
                        <ActivityIndicator color={colors.blue} />
                      ) : (
                        <>
                          <Ionicons
                            name="person-add-outline"
                            size={15}
                            color={colors.blue}
                          />

                          <Text
                            style={{
                              color: colors.blue,
                              fontSize: 14,
                              fontWeight: "800",
                            }}
                          >
                            Assign to me
                          </Text>
                        </>
                      )}
                    </Pressable>
                  </>
                ) : null}

                {assignOpen ? (
                  <>
                    <Divider />

                    <View style={{ paddingVertical: 4 }}>
                      {membersLoading ? (
                        <View style={{ paddingVertical: 14 }}>
                          <ActivityIndicator color={colors.blue} />
                        </View>
                      ) : (
                        <>
                          <ChoiceRow
                            icon="person-remove-outline"
                            label="Nobody"
                            active={!assignedTo}
                            busy={busy === "assign:none"}
                            onPress={() => onAssign(null)}
                          />

                          {members.map((member) => (
                            <ChoiceRow
                              key={member.id}
                              icon="person-outline"
                              label={member.full_name ?? "Team member"}
                              detail={member.role ?? undefined}
                              active={assignedTo === member.id}
                              busy={busy === `assign:${member.id}`}
                              onPress={() => onAssign(member.id)}
                            />
                          ))}
                        </>
                      )}
                    </View>
                  </>
                ) : null}
              </Section>

              {/*
                The two things that are neither a fact about the customer nor
                a thing you do to the thread: everything they have sent, and
                the way out when they should not have sent any of it. The web
                keeps them together under "Other" at the foot of the profile.
              */}
              <Section title="Other">
                <OtherRow
                  icon="folder-open-outline"
                  label="Files, documents & links"
                  onPress={() => void openFiles()}
                />

                <Divider />

                <OtherRow
                  icon="alert-circle-outline"
                  label="Report spam"
                  tone={colors.red}
                  onPress={reportSpam}
                />
              </Section>
            </>
          )}
        </ScrollView>

          {/*
            A reminder and a history, each in the middle of the screen rather
            than unfolded inside the record.

            Both used to push the panel's own content down: setting a
            reminder shoved Tags, Information and everything else half a
            screen away, and a history of thirty events buried the record it
            belonged to. They are separate questions with their own answer and
            their own way out, which is what a dialog is for.
          */}
          <Dialog
            open={remindOpen}
            title="Set a reminder"
            detail={detail ? `About ${detail.customer.fullName}` : ""}
            onClose={() => setRemindOpen(false)}
          >
            <View style={{ padding: 18, gap: 14 }}>
              <TextInput
                value={remindNote}
                onChangeText={setRemindNote}
                placeholder="What needs doing? e.g. Follow up on the size"
                placeholderTextColor={colors.muted}
                multiline
                editable={!reminding}
                style={[
                  styles.input,
                  { minHeight: 84, paddingTop: 12, textAlignVertical: "top" },
                ]}
              />

              <View style={{ gap: 8 }}>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "800",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    color: colors.muted,
                  }}
                >
                  Remind me
                </Text>

                {/*
                  Four times rather than a date picker. A follow-up here is
                  almost always later today or first thing tomorrow, and
                  picking a minute for something that will be read as "soon"
                  is four taps before the note is even written.
                */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {WHEN.map((option) => {
                    const active = option.key === remindWhen;

                    return (
                      <Pressable
                        key={option.key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setRemindWhen(option.key)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 12,
                          paddingVertical: 9,
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: active ? colors.blue : colors.border,
                          backgroundColor: active ? colors.pale : "white",
                        }}
                      >
                        <Ionicons
                          name={option.icon}
                          size={14}
                          color={active ? colors.blue : colors.muted}
                        />

                        <Text
                          style={{
                            fontSize: 13,
                            fontWeight: "700",
                            color: active ? colors.blue : colors.ink,
                          }}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/*
                The chip says "Tomorrow 9am"; this says which day that is.
                Cheap to draw and it removes the one doubt somebody has before
                pressing a button that promises to interrupt them later.
              */}
              <Text style={{ fontSize: 12.5, color: colors.muted }}>
                {stamp(whenToStamp(remindWhen))}
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row",
                gap: 10,
                padding: 18,
                paddingTop: 0,
              }}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() => setRemindOpen(false)}
                style={({ pressed }) => ({
                  paddingHorizontal: 18,
                  paddingVertical: 13,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.pale : "white",
                })}
              >
                <Text
                  style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink }}
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={reminding || !remindNote.trim()}
                onPress={() => void saveReminder()}
                style={({ pressed }) => ({
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  paddingVertical: 13,
                  borderRadius: 12,
                  opacity: remindNote.trim() ? 1 : 0.45,
                  backgroundColor: pressed ? "#0A6FA8" : colors.blue,
                })}
              >
                {reminding ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicons name="alarm" size={16} color="white" />

                    <Text
                      style={{ fontSize: 14.5, fontWeight: "800", color: "white" }}
                    >
                      Set reminder
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </Dialog>

          <Dialog
            open={filesOpen}
            title="Files, documents & links"
            detail={detail ? detail.customer.fullName : ""}
            onClose={() => setFilesOpen(false)}
          >
            {filesLoading ? (
              <View style={{ paddingVertical: 44 }}>
                <ActivityIndicator color={colors.blue} />
              </View>
            ) : (
              <FileLibrary files={files ?? []} />
            )}
          </Dialog>

          <Dialog
            open={historyOpen}
            title="Customer history"
            detail={detail ? detail.customer.fullName : ""}
            onClose={() => setHistoryOpen(false)}
          >
            {historyLoading ? (
              <View style={{ paddingVertical: 44 }}>
                <ActivityIndicator color={colors.blue} />
              </View>
            ) : !history || history.length === 0 ? (
              <View style={{ alignItems: "center", padding: 34, gap: 8 }}>
                <Ionicons name="time-outline" size={26} color={colors.muted} />

                <Text
                  style={{
                    fontSize: 13.5,
                    color: colors.muted,
                    textAlign: "center",
                  }}
                >
                  Nothing has happened to this customer yet.
                </Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 420 }}
                contentContainerStyle={{ padding: 18, paddingTop: 6 }}
              >
                {history.map((item, index) => (
                  <View key={item.id} style={{ flexDirection: "row", gap: 12 }}>
                    {/*
                      A rail down the left, so thirty events read as one
                      history rather than thirty separate rows.
                    */}
                    <View style={{ alignItems: "center", width: 16 }}>
                      <View
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          marginTop: 14,
                          borderWidth: 2.5,
                          borderColor: index === 0 ? colors.blue : colors.border,
                          backgroundColor: "white",
                        }}
                      />

                      {index < history.length - 1 ? (
                        <View
                          style={{
                            flex: 1,
                            width: 1.5,
                            marginTop: 2,
                            backgroundColor: colors.border,
                          }}
                        />
                      ) : null}
                    </View>

                    <View style={{ flex: 1, paddingVertical: 11, gap: 3 }}>
                      <Text
                        style={{
                          fontSize: 14,
                          fontWeight: "700",
                          color: colors.ink,
                        }}
                      >
                        {item.title}
                      </Text>

                      {item.detail ? (
                        <Text
                          style={{ fontSize: 12.5, color: colors.ink, opacity: 0.75 }}
                        >
                          {item.detail}
                        </Text>
                      ) : null}

                      <Text style={{ fontSize: 11.5, color: colors.muted }}>
                        {[stamp(item.createdAt), item.actorName]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </Dialog>
      </Animated.View>
    </View>
  );
}

/*
 * The button in the thread header that pulls the panel in.
 *
 * Three dots rather than a dock: the panel is everything else about this
 * conversation, and an overflow menu is the one control every phone user
 * already knows to press when they want the rest of it. The same control
 * whether you tap it or swipe the panel in from the right.
 */
export function PanelButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open the customer panel. Or swipe in from the right edge."
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.icon,
        { opacity: disabled ? 0.35 : pressed ? 0.55 : 1 },
      ]}
    >
      <Ionicons name="ellipsis-vertical" size={22} color={colors.blue} />
    </Pressable>
  );
}

/*
 * Swipe anywhere on the thread, right to left, to pull the panel in.
 *
 * Taken on the capture phase and only for a clear leftward drag, so a tap on
 * a bubble still reaches the bubble and a vertical scroll still scrolls. An
 * edge strip did this before and was 22 points wide -- discoverable by
 * accident at best, and it swallowed taps on the right side of every
 * outgoing message.
 */
export function useThreadSwipe(onOpen: () => void, enabled: boolean) {
  const opened = useRef(false);

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        gesture.dx < -24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,

      onPanResponderGrant: () => {
        opened.current = false;
      },

      onPanResponderMove: (_event, gesture) => {
        if (!opened.current && gesture.dx < -40) {
          opened.current = true;
          onOpenRef.current();
        }
      },
    }),
  ).current;

  // Kept in a ref so the responder, created once, always calls the current
  // handler rather than the one that existed on first render.
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  return enabled ? responder.panHandlers : {};
}
