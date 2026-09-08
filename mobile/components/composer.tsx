import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
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

import { IconName, Sheet, colors, styles } from "./ui";

/*
 * The reply box, and everything that can be sent from it.
 *
 * It was an attach button, a quick-reply button and a text field. Sending a
 * photo took two taps through a sheet that offered two things, there was no
 * way to send a voice note back to a customer who had just sent one, and no
 * way to send an address -- which in Phnom Penh is how half of deliveries get
 * arranged.
 */

export type Pending = {
  key: string;
  uri: string;
  name: string;
  mimeType: string;
  kind: "image" | "video" | "file" | "audio";
};

function clock(millis: number) {
  const whole = Math.floor(millis / 1000);

  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** One row in the attach sheet. */
function Choice({
  icon,
  label,
  detail,
  onPress,
}: {
  icon: IconName;
  label: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
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

      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}

/*
 * The height everything in the row shares.
 *
 * The buttons and the reply field were different heights sitting on a
 * flex-end baseline, so the icons hung slightly below the pill they were
 * meant to line up with. One number, used by all of them.
 */
const ROW = 44;

/** A round button in the composer row, the same height as the field. */
function Round({
  icon,
  label,
  disabled,
  tone,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  tone?: string;
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
      <Ionicons name={icon} size={23} color={tone ?? colors.blue} />
    </Pressable>
  );
}

export function Composer({
  draft,
  onDraftChange,
  pending,
  onRemovePending,
  sending,
  bottomInset,
  onPickImages,
  onPickVideo,
  onPickFile,
  onSendLocation,
  onQuickReplies,
  onVoice,
  onSend,
}: {
  draft: string;
  onDraftChange: (next: string) => void;
  pending: Pending[];
  onRemovePending: (key: string) => void;
  sending: boolean;
  bottomInset: number;
  onPickImages: () => void;
  onPickVideo: () => void;
  onPickFile: () => void;
  onSendLocation: () => void;
  onQuickReplies: () => void;
  onVoice: (uri: string, millis: number) => void;
  onSend: () => void;
}) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder, 250);

  const hasSomething = draft.trim().length > 0 || pending.length > 0;

  /*
   * The send button is present whenever there is something to send, sending
   * included -- it holds the spinner. Disabling it is what stops a second
   * tap, not removing it, which would make the row jump at the worst moment.
   */
  const canSend = hasSomething;

  /*
   * Tap to start, tap to stop. Not hold-to-talk: an agent recording a reply is
   * usually reading the customer's message at the same time, and a gesture
   * that ends the moment a thumb lifts loses the recording every time they
   * scroll back to check something.
   */
  async function toggleRecording() {
    if (recording.isRecording) {
      setFinishing(true);

      try {
        await recorder.stop();

        const uri = recorder.uri;
        const millis = recording.durationMillis;

        // Under a second is a mis-tap, not a message.
        if (uri && millis >= 1000) {
          onVoice(uri, millis);
        }
      } finally {
        setFinishing(false);
      }

      return;
    }

    const { granted } = await requestRecordingPermissionsAsync();

    if (!granted) {
      return;
    }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function cancelRecording() {
    if (!recording.isRecording) {
      return;
    }

    setFinishing(true);

    try {
      // Stopped and thrown away: stop() is the only way to release the
      // hardware, so a cancel is a stop whose file is never used.
      await recorder.stop();
    } finally {
      setFinishing(false);
    }
  }

  return (
    <>
      {/*
        What is queued to go with the next send. Attachments are staged rather
        than sent on pick, so a quick reply's text and its picture leave
        together and a wrong file can be taken back off.
      */}
      {/*
        What is queued to go with the next send.

        A photo shows itself. It was a pill reading IMG_20260908_114233.jpg,
        which tells an agent nothing about which photo they picked and takes
        the width of three of them to say it. Files keep their name, because
        for a file the name is the whole of what it is.
      */}
      {pending.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10 }}
          style={{ maxHeight: 76, backgroundColor: "white" }}
        >
          {pending.map((file) => {
            const visual = file.kind === "image" || file.kind === "video";

            return (
              <View key={file.key}>
                {visual ? (
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

                    {file.kind === "video" ? (
                      <View
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          top: 0,
                          bottom: 0,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: "rgba(16,34,56,0.25)",
                        }}
                      >
                        <Ionicons name="play" size={20} color="white" />
                      </View>
                    ) : null}
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
                  accessibilityLabel={`Remove ${
                    file.kind === "image"
                      ? "this photo"
                      : file.kind === "video"
                        ? "this video"
                        : file.name
                  }`}
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
          gap: 0,
          paddingHorizontal: 6,
          paddingTop: 8,
          paddingBottom: 8 + bottomInset,
          backgroundColor: "white",
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        {recording.isRecording || finishing ? (
          /*
           * Recording takes the whole row. Half a composer with a timer in it
           * invites somebody to keep typing into a field that will not be
           * sent, and the two controls that matter are throw it away and
           * keep it.
           */
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingLeft: 6,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discard this recording"
              disabled={finishing}
              onPress={() => void cancelRecording()}
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

            <Text
              style={{
                flex: 1,
                fontSize: 15,
                fontWeight: "700",
                color: colors.ink,
                fontVariant: ["tabular-nums"],
              }}
            >
              {clock(recording.durationMillis)}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop recording and attach it"
              disabled={finishing}
              onPress={() => void toggleRecording()}
              style={[styles.button, { minWidth: 52, paddingHorizontal: 16 }]}
            >
              {finishing ? (
                <ActivityIndicator color="white" />
              ) : (
                <Ionicons name="checkmark" size={20} color="white" />
              )}
            </Pressable>
          </View>
        ) : (
          <>
            {/*
              Attach and quick replies together on the left: both put
              something into the box rather than sending it, and an agent
              reaching for a saved greeting was crossing the whole composer
              to find it.
            */}
            <Round
              icon="attach-outline"
              label="Attach a photo, video, file or location"
              disabled={sending}
              onPress={() => setAttachOpen(true)}
            />

            <Round
              icon="chatbox-ellipses-outline"
              label="Quick replies"
              disabled={sending}
              onPress={onQuickReplies}
            />

            {/*
              The field, with the microphone inside it.

              It sat outside as a fourth icon, which is a lot of chrome around
              a box you are meant to type in. Inside on the right is where a
              phone keyboard has taught everybody to look for it, and it gives
              the field the width back.
            */}
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
                placeholder="Write a reply…"
                placeholderTextColor={colors.muted}
                multiline
                editable={!sending}
              />

              {/*
                Swapped for the send button rather than shown beside it. Both
                at once is two ways to end the same message, and the one you
                want is never in doubt: if there are words in the box you are
                sending them.
              */}
              {canSend ? null : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Record a voice message"
                  disabled={sending}
                  onPress={() => void toggleRecording()}
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

            {/*
              Only there when there is something to send, which is what gives
              the field its full width the rest of the time.
            */}
            {canSend ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
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
                  <MaterialCommunityIcons name="send" size={20} color="white" />
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
        <Choice
          icon="images-outline"
          label="Photos"
          detail="Pick as many as you like."
          onPress={() => {
            setAttachOpen(false);
            onPickImages();
          }}
        />

        <Choice
          icon="videocam-outline"
          label="Video"
          detail="One clip from this phone."
          onPress={() => {
            setAttachOpen(false);
            onPickVideo();
          }}
        />

        <Choice
          icon="document-outline"
          label="File"
          detail="A document, PDF or anything else."
          onPress={() => {
            setAttachOpen(false);
            onPickFile();
          }}
        />

        <Choice
          icon="location-outline"
          label="Send location"
          detail="Where this phone is now."
          onPress={() => {
            setAttachOpen(false);
            onSendLocation();
          }}
        />
      </Sheet>
    </>
  );
}
