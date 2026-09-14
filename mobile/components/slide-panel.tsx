import { useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Dimensions,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsSkeleton } from "./settings-screen";
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
  skeleton,
  children,
  fullScreen = false,
  headerContent,
  onHelp,
}: {
  onHelp?: () => void;
  fullScreen?: boolean;
  headerContent?: React.ReactNode;
  open: boolean;
  onClose: () => void;
  title: string;
  detail: string;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  skeleton?: number[];
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const panelWidth = fullScreen ? SCREEN : PANEL;
  const closePanelRef = useRef(onClose);
  closePanelRef.current = onClose;

  const slide = useRef(new Animated.Value(panelWidth)).current;
  const [mounted, setMounted] = useState(open);

  // Keep this protection inside the shared panel, including its closing animation.
  useEffect(() => {
    if (!open && !mounted) return;
    navigation.setOptions({ gestureEnabled: false });
    return () => navigation.setOptions({ gestureEnabled: true });
  }, [navigation, open, mounted]);

  // Consume Android Back before the underlying profile route can pop.
  useEffect(() => {
    if (!open && !mounted) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (open) closePanelRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [open, mounted]);

  useEffect(() => {
    if (open) {
      setMounted(true);
    }

    Animated.timing(slide, {
      toValue: open ? 0 : panelWidth,
      duration: open ? 220 : 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) {
        setMounted(false);
      }
    });
  }, [open, slide, panelWidth]);

  /*
   * Claimed only for a clearly horizontal drag: the panel scrolls, and a
   * responder that took every touch would make it unreadable.
   */
  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        gesture.dx > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,

      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
      onPanResponderMove: (_event, gesture) => {
        slide.setValue(Math.max(0, gesture.dx));
      },

      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx > DISMISS_AFTER || gesture.vx > 0.5) {
          closePanelRef.current();
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
    <View style={FILL} pointerEvents="box-none" accessibilityViewIsModal onAccessibilityEscape={onClose}>
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={{
          ...FILL,
          backgroundColor: "rgba(16,34,56,0.35)",
          opacity: slide.interpolate({
            inputRange: [0, panelWidth],
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
          width: panelWidth,
          backgroundColor: colors.background,
          borderLeftWidth: 1,
          borderLeftColor: colors.border,
          transform: [{ translateX: slide }],
        }}
      >
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <View style={styles.row}>
            {fullScreen ? <IconButton icon="chevron-back" label={`Back from ${title}`} onPress={onClose} /> : null}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.heading}>
                {title}
              </Text>
              <Text numberOfLines={fullScreen ? 3 : 1} style={[styles.muted, { fontSize: 12.5 }]}>
                {detail}
              </Text>
            </View>

            {/*
              A close mark on the right, where the customer panel keeps its
              own. It was a chevron pointing off to the right at the head of
              the title, which read as "there is more this way" -- an arrow
              into the panel you are already inside -- rather than as the way
              out of it.
            */}
            {fullScreen ? (onHelp ? <IconButton icon="help-circle-outline" label={`${title} help`} onPress={onHelp} /> : null) : <IconButton
              icon="close"
              label={`Close ${title}`}
              onPress={onClose}
            />}
          </View>
          {headerContent}
        </View>

        <ErrorNotice message={error ?? ""} onRetry={onRetry} />

        {loading ? (
          <SettingsSkeleton groups={skeleton} />
        ) : (
          <ScrollView
          keyboardDismissMode="on-drag"
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
