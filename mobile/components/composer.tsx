import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
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
  PanResponder,
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
  onClearAll,
  attachmentsDisabled = false,
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
  onClearAll: () => void;
  attachmentsDisabled?: boolean;
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
   * Hold the microphone to record; let go to send; drag away to throw it away.
   *
   * It used to be tap to start and tap again to stop, which is two deliberate
   * acts for one message and leaves the app recording if the second tap never
   * comes -- an agent who got distracted mid-thread came back to a four-minute
   * take of their own office. Holding is the gesture everybody already has
   * from Messenger and Telegram, and it cannot be left running: the recording
   * ends when the thumb does.
   *
   * Dragging away before letting go cancels. Left towards the bin or upwards,
   * either one, because a thumb on the right edge of a phone travels those two
   * ways easily and neither is a direction you move by accident while holding
   * still.
   */
  const CANCEL_DISTANCE = 70;

  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const holding = useRef(false);


  async function startRecording() {
    const { granted } = await requestRecordingPermissionsAsync();

    if (!granted || !holding.current) {
      return;
    }

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

    /* Let go during the permission round trip: nothing to record any more. */
    if (!holding.current) {
      return;
    }

    recorder.record();
  }

  async function finishRecording(keep: boolean) {
    armedRef.current = false;

    if (!recorder.isRecording) {
      setArmed(false);
      return;
    }

    setFinishing(true);

    try {
      // Stopped either way: stop() is the only thing that releases the
      // hardware, so a cancel is a stop whose file is never used.
      await recorder.stop();

      const uri = recorder.uri;
      const millis = recording.durationMillis;

      // Under a second is a slip of the thumb, not a message.
      if (keep && uri && millis >= 1000) {
        onVoice(uri, millis);
      }
    } finally {
      setFinishing(false);
      setArmed(false);
    }
  }

  /*
   * The handlers, through a ref that is rewritten every render.
   *
   * A PanResponder is created once and holds the closures it was created
   * with, so the version of finishRecording it captured would be the first
   * render's -- reading a duration of nought for every take and discarding
   * all of them as slips of the thumb.
   */
  const act = useRef({ start: startRecording, finish: finishRecording });
  act.current = { start: startRecording, finish: finishRecording };

  const hold = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: () => {
        holding.current = true;
        armedRef.current = false;
        setArmed(false);
        void act.current.start();
      },

      onPanResponderMove: (
        _event: unknown,
        gesture: { dx: number; dy: number },
      ) => {
        const next =
          gesture.dx < -CANCEL_DISTANCE || gesture.dy < -CANCEL_DISTANCE;

        if (next !== armedRef.current) {
          armedRef.current = next;
          setArmed(next);
        }
      },

      onPanResponderRelease: () => {
        holding.current = false;
        void act.current.finish(!armedRef.current);
      },

      /*
       * A responder can be taken away mid-gesture -- a system dialog, a call.
       * Treated as a cancel rather than a send: a recording nobody chose to
       * end is not one they meant to deliver.
       */
      onPanResponderTerminate: () => {
        holding.current = false;
        void act.current.finish(false);
      },
    }),
  ).current;

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
      {/*
        Take it all back.
        A quick reply drops words and up to ten pictures into the composer in
        one tap, and undoing that was ten taps -- one per attachment -- with
        the text still to select and delete. One button, and only while there
        is something to clear.
      */}
      {pending.length > 0 || draft.trim().length > 0 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            paddingTop: 8,
            backgroundColor: "white",
          }}
        >
          <Text style={{ flex: 1, fontSize: 12, color: colors.muted }}>
            {pending.length > 0
              ? `${pending.length} ${pending.length === 1 ? "attachment" : "attachments"} ready`
              : "Draft"}
          </Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear the reply and its attachments"
            disabled={sending}
            onPress={onClearAll}
            hitSlop={8}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 999,
              opacity: sending ? 0.4 : 1,
              backgroundColor: pressed ? colors.pale : "transparent",
            })}
          >
            <Ionicons name="close-circle-outline" size={14} color={colors.red} />

            <Text
              style={{ fontSize: 12, fontWeight: "800", color: colors.red }}
            >
              Clear all
            </Text>
          </Pressable>
        </View>
      ) : null}

      {pending.length > 0 ? (
        <ScrollView
          keyboardDismissMode="on-drag"
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10 }}
          style={{ maxHeight: 76, backgroundColor: "white" }}
        >
          {pending
            .filter((file) => file.kind !== "audio")
            .map((file) => {
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
          position: "relative",
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
            {/*
              The bin lights up as the thumb approaches it, so the state the
              gesture is in is visible without reading the words: red bin and
              "Release to cancel" means letting go throws it away.
            */}
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: armed ? "#FBEAEA" : "transparent",
              }}
            >
              <Ionicons
                name={armed ? "trash" : "trash-outline"}
                size={21}
                color={armed ? colors.red : colors.muted}
              />
            </View>

            {!armed ? (
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  backgroundColor: colors.red,
                }}
              />
            ) : null}

            <Text
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: armed ? colors.red : colors.ink,
                fontVariant: ["tabular-nums"],
              }}
            >
              {clock(recording.durationMillis)}
            </Text>

            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                textAlign: "right",
                fontSize: 12.5,
                color: armed ? colors.red : colors.muted,
              }}
            >
              {finishing
                ? "Finishing…"
                : armed
                  ? "Release to cancel"
                  : "Slide away to cancel · release to send"}
            </Text>

            {finishing ? <ActivityIndicator color={colors.blue} /> : null}
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
              disabled={sending || attachmentsDisabled}
              onPress={() => setAttachOpen(true)}
            />

            {/*
              A bolt in a speech bubble, at the same weight as the paperclip
              beside it. The message-with-a-bolt glyph was drawn heavier and
              a couple of points larger than everything else on the row, so it
              read as the loudest control in a composer where the send button
              is meant to be.
            */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quick replies"
              disabled={sending}
              onPress={onQuickReplies}
              style={({ pressed }) => ({
                width: ROW,
                height: ROW,
                borderRadius: ROW / 2,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? colors.pale : "transparent",
                opacity: sending ? 0.35 : 1,
              })}
            >
              <Ionicons name="flash-outline" size={21} color={colors.blue} />
            </Pressable>

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
                /*
                 * Still writable while the last one is going.
                 *
                 * A send takes a round trip and an upload can take several
                 * seconds; locking the box for that long stops somebody
                 * writing the next sentence while the customer is still
                 * reading the first. The send button is what guards against
                 * a double send, not the keyboard.
                 */
                editable
              />

              {/*
                Swapped for the send button rather than shown beside it. Both
                at once is two ways to end the same message, and the one you
                want is never in doubt: if there are words in the box you are
                sending them.
              */}
              {canSend ? null : (
                <View
                  accessibilityRole="button"
                  accessibilityLabel="Hold to record a voice message, slide away to cancel"
                  accessibilityHint="Double tap and hold, then release to send"
                  {...(sending || attachmentsDisabled ? {} : hold.panHandlers)}
                  style={{
                    width: 36,
                    height: ROW - 2,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: sending || attachmentsDisabled ? 0.35 : 1,
                  }}
                >
                  <Ionicons name="mic-outline" size={22} color={colors.blue} />
                </View>
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

        {/*
          The hold zone, over the microphone and mounted whatever the row is
          showing.

          The gesture has to outlive the layout it started in: the moment
          recording begins this row swaps the composer for the timer, and a
          responder whose view has just been unmounted is terminated -- which
          would cancel every recording a fraction of a second after it began.
          This sits above both layouts in the same place, so the thumb never
          leaves the view that is listening to it.
        */}
        {(!canSend || recording.isRecording || finishing) &&
        !sending &&
        !attachmentsDisabled ? (
          <View
            {...hold.panHandlers}
            style={{
              position: "absolute",
              right: 4,
              top: 0,
              bottom: 0,
              width: 58,
            }}
          />
        ) : null}
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
