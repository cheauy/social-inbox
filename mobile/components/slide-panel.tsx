import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ErrorNotice, IconButton, colors, styles } from "./ui";

/*
 * A page that arrives over the one you were on, from the right.
 *
 * The customer record already worked this way and it is the better shape for
 * anything you open, read and dismiss: it keeps where you came from visible
 * behind it, and it goes away with the same flick that opened it rather than
 * making you find a back button. Profile's three sections are exactly that --
 * you go in to look something up, not to work -- so they use it too.
 *
 * The mechanics are copied from customer-panel rather than shared with it:
 * that panel owns editable fields, its own error band above the scroll and a
 * pile of dismiss-on-close state, and folding both into one component would
 * cost more in props than the sixty lines it saves.
 */

const { width: SCREEN } = Dimensions.get("window");

const PANEL = Math.min(400, Math.round(SCREEN * 0.88));

/* How far it must be dragged before letting go closes it. */
const DISMISS_AFTER = PANEL * 0.3;

const FILL = {
  position: "absolute" as const,
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
};

export function SlidePanel({
  open,
  onClose,
  title,
  detail,
  loading,
  error,
  onRetry,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  detail: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();

  const slide = useRef(new Animated.Value(PANEL)).current;
  const [mounted, setMounted] = useState(open);

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
      }
    });
  }, [open, slide]);

  /*
   * Claimed only for a clearly horizontal drag: the panel scrolls, and a
   * responder that took every touch would make it unreadable.
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
          accessibilityLabel={`Close ${title}`}
          onPress={onClose}
          style={{ flex: 1 }}
        />
      </Animated.View>

      <Animated.View
        {...drag.panHandlers}
        /*
         * The backdrop covers the whole screen, panel included, and Android
         * offers an unclaimed touch to the next view down -- so a tap on any
         * part of this panel that is not itself a button was landing on the
         * backdrop and dismissing it. Claiming what nothing else wanted stops
         * that; children still get first refusal, so buttons and the scroll
         * are unaffected.
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
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.row}>
            {/*
              Forward, not back: the button does what the swipe does, which is
              push the panel off to the right.
            */}
            <IconButton
              icon="chevron-forward"
              label={`Close ${title}`}
              onPress={onClose}
            />

            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.heading}>
                {title}
              </Text>
              <Text numberOfLines={1} style={[styles.muted, { fontSize: 12.5 }]}>
                {detail}
              </Text>
            </View>
          </View>
        </View>

        <ErrorNotice message={error ?? ""} onRetry={onRetry} />

        {loading ? (
          <View style={{ padding: 40 }}>
            <ActivityIndicator color={colors.blue} />
          </View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              padding: 14,
              paddingBottom: insets.bottom + 28,
              gap: 16,
            }}
          >
            {children}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}
