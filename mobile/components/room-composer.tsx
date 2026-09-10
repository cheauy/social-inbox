import { Ionicons } from "@expo/vector-icons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { Avatar, IconName, Sheet, colors, styles } from "./ui";
import type { Member } from "../lib/types";

/*
 * The reply box for a team room.
 *
 * Close cousin of the customer composer and deliberately not the same
 * component: a room has no quick replies and no location, and it has the one
 * thing the customer thread cannot have -- mentions, which are the whole
 * reason a busy room stays readable. Sharing one component would have meant
 * four props switching halves of it off.
 */

export type RoomPending = {
  key: string;
  uri: string;
  name: string;
  mimeType: string;
  kind: "image" | "video" | "file" | "audio";
  byteSize?: number;
};

const ROW = 44;

function clock(millis: number) {
  const whole = Math.floor(millis / 1000);

  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function Round({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: ROW,
        height: ROW,
        borderRadius: ROW / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.pale : "transparent",
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Ionicons name={icon} size={23} color={colors.blue} />
    </Pressable>
  );
}

export function RoomComposer({
  roomName,
  draft,
  onDraftChange,
  pending,
  onRemovePending,
  roster,
  sending,
  bottomInset,
  onPickImages,
  onPickVideo,
  onPickFile,
  onVoice,
  onMention,
  onSend,
}: {
  roomName: string;
  draft: string;
  onDraftChange: (next: string) => void;
  pending: RoomPending[];
  onRemovePending: (key: string) => void;
  roster: Member[];
  sending: boolean;
  bottomInset: number;
  onPickImages: () => void;
  onPickVideo: () => void;
  onPickFile: () => void;
  onVoice: (uri: string, millis: number) => void;
  onMention: (name: string, memberId: string | null) => void;
  onSend: () => void;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [cancelRecording, setCancelRecording] = useState(false);
  const holdingRef = useRef(false);
  const recordingStartedRef = useRef(false);
  const cancelRef = useRef(false);
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 250);

  const canSend = draft.trim().length > 0 || pending.length > 0;

  async function beginHoldingVoice() {
    if (sending || finishing || canSend) return;
    holdingRef.current = true;
    cancelRef.current = false;
    setCancelRecording(false);
    const { granted } = await requestRecordingPermissionsAsync();

    if (!granted || !holdingRef.current) return;

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

    /*
     * A recorder that has already been prepared rejects being prepared again,
     * and it stays prepared after a take -- so the second voice note of a
     * session threw where the first worked. Two composers can be mounted at
     * once as well, one per screen in the stack, and they share the hardware.
     * Preparing is best-effort; if it was already ready, recording is exactly
     * what we wanted anyway.
     */
    try {
      await recorder.prepareToRecordAsync();
    } catch {
      // Already prepared. Nothing to do but record.
    }

    if (!holdingRef.current) return;
    recorder.record();
    recordingStartedRef.current = true;
  }

  async function finishHoldingVoice(forceDiscard = false) {
    holdingRef.current = false;
    if (!recordingStartedRef.current || finishing) return;

    recordingStartedRef.current = false;
    setFinishing(true);

    try {
      await recorder.stop();
      const uri = recorder.uri;
      const millis = recording.durationMillis;

      if (!forceDiscard && !cancelRef.current && uri && millis >= 350) {
        onVoice(uri, millis);
      }
    } finally {
      cancelRef.current = false;
      setCancelRecording(false);
      setFinishing(false);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    }
  }

  function trackVoiceDrag(pageX: number, pageY: number) {
    const origin = pressOriginRef.current;
    if (!origin || !holdingRef.current) return;
    const outside = Math.abs(pageX - origin.x) > 72 || Math.abs(pageY - origin.y) > 72;
    cancelRef.current = outside;
    setCancelRecording(outside);
  }

  return (
    <>
      {pending.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            gap: 8,
            paddingHorizontal: 12,
            paddingTop: 10,
          }}
          style={{ maxHeight: 76, backgroundColor: "white" }}
        >
          {pending.map((file) => {
            const visual = file.kind === "image" || file.kind === "video";

            return (
              <View key={file.key}>
                {file.kind === "video" ? (
                  <View style={{ width: 58, height: 58, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#102238" }}>
                    <Ionicons name="play" size={21} color="white" />
                  </View>
                ) : visual ? (
                  <View
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 12,
                      overflow: "hidden",
                      backgroundColor: colors.border,
                    }}
                  >
                    <Image
                      source={{ uri: file.uri }}
                      style={{ width: 58, height: 58 }}
                      resizeMode="cover"
                    />
                  </View>
                ) : (
                  <View
                    style={{
                      height: 58,
                      maxWidth: 170,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      backgroundColor: colors.pale,
                    }}
                  >
                    <Ionicons
                      name={file.kind === "audio" ? "mic" : "document"}
                      size={17}
                      color={colors.blue}
                    />

                    <Text
                      numberOfLines={2}
                      style={{
                        flexShrink: 1,
                        color: colors.ink,
                        fontSize: 12,
                        fontWeight: "600",
                      }}
                    >
                      {file.name}
                    </Text>
                  </View>
                )}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${file.name}`}
                  disabled={sending}
                  hitSlop={8}
                  onPress={() => onRemovePending(file.key)}
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
                    borderWidth: 2,
                    borderColor: "white",
                  }}
                >
                  <Ionicons name="close" size={12} color="white" />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          paddingHorizontal: 6,
          paddingTop: 8,
          paddingBottom: 8 + bottomInset,
          backgroundColor: "white",
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        {recording.isRecording || finishing ? (
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingLeft: 10,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard this recording"
              disabled={finishing}
              onPress={() => {
                cancelRef.current = true;
                void finishHoldingVoice(true);
              }}
              hitSlop={8}
            >
              <Ionicons name="trash-outline" size={22} color={colors.red} />
            </Pressable>

            <View
              style={{
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: colors.red,
              }}
            />

            <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: cancelRecording ? colors.red : colors.ink,
                fontVariant: ["tabular-nums"],
              }}
            >
              {clock(recording.durationMillis)}
            </Text>
            <Text style={{ marginTop: 2, color: cancelRecording ? colors.red : colors.muted, fontSize: 11.5 }}>{cancelRecording ? "Release to discard" : "Release to send · slide away to cancel"}</Text>
            </View>
            {finishing ? <ActivityIndicator color={colors.blue} /> : <Ionicons name={cancelRecording ? "close-circle" : "send"} size={22} color={cancelRecording ? colors.red : colors.blue} />}
          </View>
        ) : (
          <>
            <Round
              icon="attach-outline"
              label="Attach a photo, video or file"
              disabled={sending}
              onPress={() => setAttachOpen(true)}
            />

            <Round
              icon="at-outline"
              label="Mention someone"
              disabled={sending}
              onPress={() => setMentionOpen(true)}
            />

            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "flex-end",
                minHeight: ROW,
                marginHorizontal: 4,
                paddingRight: 4,
                borderRadius: ROW / 2,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: "white",
              }}
            >
              <TextInput
                value={draft}
                onChangeText={onDraftChange}
                style={{
                  flex: 1,
                  maxHeight: 120,
                  minHeight: ROW,
                  paddingTop: 11,
                  paddingBottom: 11,
                  paddingLeft: 16,
                  fontSize: 16,
                  color: colors.ink,
                }}
                placeholder={`Message ${roomName}…`}
                placeholderTextColor={colors.muted}
                multiline
                editable={!sending}
              />

              {canSend ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Record a voice message"
                  disabled={sending}
                  onPressIn={(event) => {
                    pressOriginRef.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
                    void beginHoldingVoice();
                  }}
                  onTouchMove={(event) => trackVoiceDrag(event.nativeEvent.pageX, event.nativeEvent.pageY)}
                  onPressOut={() => void finishHoldingVoice()}
                  hitSlop={6}
                  style={({ pressed }) => ({
                    width: 36,
                    height: ROW - 2,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: sending ? 0.35 : pressed ? 0.5 : 1,
                  })}
                >
                  <Ionicons name="mic-outline" size={22} color={colors.blue} />
                </Pressable>
              )}
            </View>

            {canSend ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send to the room"
                disabled={sending}
                onPress={onSend}
                style={({ pressed }) => ({
                  width: ROW,
                  height: ROW,
                  borderRadius: ROW / 2,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: colors.blue,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                {sending ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Ionicons name="send" size={19} color="white" />
                )}
              </Pressable>
            ) : null}
          </>
        )}
      </View>

      <Sheet
        open={attachOpen}
        title="Attach"
        detail="Added to the box, sent with your next message."
        onClose={() => setAttachOpen(false)}
      >
        {(
          [
            ["images-outline", "Photos", "Pick as many as you like.", onPickImages],
            ["videocam-outline", "Video", "One clip from this phone.", onPickVideo],
            ["document-outline", "File", "A document, PDF or anything else.", onPickFile],
          ] as const
        ).map(([icon, label, detail, run]) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            onPress={() => {
              setAttachOpen(false);
              run();
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              paddingHorizontal: 18,
              paddingVertical: 13,
              backgroundColor: pressed ? colors.pale : "transparent",
            })}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.pale,
              }}
            >
              <Ionicons name={icon} size={20} color={colors.blue} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>
                {label}
              </Text>
              <Text style={[styles.muted, { fontSize: 12.5 }]}>{detail}</Text>
            </View>
          </Pressable>
        ))}
      </Sheet>

      <Sheet
        open={mentionOpen}
        title="Mention"
        detail="They get a notification even if they have muted this room."
        onClose={() => setMentionOpen(false)}
      >
        <ScrollView>
          {/*
            Everyone first, because it is the one most likely to be wanted and
            the one hardest to find by scrolling a roster.
          */}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setMentionOpen(false);
              onMention("everyone", null);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 18,
              paddingVertical: 13,
              backgroundColor: pressed ? colors.pale : "transparent",
            })}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.pale,
              }}
            >
              <Ionicons name="megaphone-outline" size={19} color={colors.blue} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: "700" }}>
                @everyone
              </Text>
              <Text style={[styles.muted, { fontSize: 12.5 }]}>
                Notifies every member of this room.
              </Text>
            </View>
          </Pressable>

          {roster.map((member) => (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              onPress={() => {
                setMentionOpen(false);
                onMention(member.full_name || member.email, member.id);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 18,
                paddingVertical: 12,
                backgroundColor: pressed ? colors.pale : "transparent",
              })}
            >
              <Avatar
                name={member.full_name}
                uri={member.profile_picture_url}
                size={38}
              />

              <View style={{ flex: 1 }}>
                <Text
                  style={{ color: colors.ink, fontSize: 15, fontWeight: "600" }}
                >
                  {member.full_name || member.email}
                </Text>
                <Text style={[styles.muted, { fontSize: 12 }]}>
                  {member.role}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}
