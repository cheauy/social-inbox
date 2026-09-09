import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Animated, PanResponder, Pressable, Text, View } from "react-native";

import { IconName, colors } from "./ui";

/*
 * A row whose actions live off the right-hand edge until you pull them in.
 *
 * These lists had a delete button sitting on every row, which is the one
 * action you least want under a thumb: the row is a tap target, the button is
 * six millimetres from it, and the cost of a miss is a tag the whole team was
 * using. Hiding them behind a deliberate sideways drag makes the destructive
 * thing take a gesture nobody makes by accident, and gives the row back to the
 * tap that opens it.
 *
 * PanResponder rather than a gesture library: the app has no Reanimated babel
 * plugin, and adding one for a drawer this small would mean a native rebuild.
 */

export type SwipeAction = {
  icon: IconName;
  label: string;
  tone: string;
  onPress: () => void;
};

const WIDTH = 84;

/* Far enough that a scroll-adjacent wobble never opens it. */
const OPEN_AFTER = 40;

export function SwipeRow({
  actions,
  openId,
  id,
  onOpen,
  children,
}: {
  actions: SwipeAction[];
  /* Only one row is open at a time -- two open rows is two half-read lists. */
  openId: string | null;
  id: string;
  onOpen: (id: string | null) => void;
  children: React.ReactNode;
}) {
  const reveal = WIDTH * actions.length;
  const slide = useRef(new Animated.Value(0)).current;
  const open = openId === id;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: open ? -reveal : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  }, [open, reveal, slide]);

  const drag = useRef(
    PanResponder.create({
      /*
       * Claimed only for a clearly horizontal drag, and only leftwards from a
       * closed row: the list scrolls vertically, and a responder that took
       * every touch would make it unusable.
       */
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 8 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,

      onPanResponderMove: (_event, gesture) => {
        const from = openId === id ? -reveal : 0;
        slide.setValue(Math.min(0, Math.max(-reveal, from + gesture.dx)));
      },

      onPanResponderRelease: (_event, gesture) => {
        const wasOpen = openId === id;
        const shouldOpen = wasOpen
          ? gesture.dx < OPEN_AFTER
          : gesture.dx < -OPEN_AFTER;

        onOpen(shouldOpen ? id : null);

        Animated.spring(slide, {
          toValue: shouldOpen ? -reveal : 0,
          useNativeDriver: true,
          bounciness: 0,
          speed: 18,
        }).start();
      },
    }),
  ).current;

  return (
    <View>
      {/*
        Behind the row, so the buttons are already there as it moves rather
        than appearing when it stops.
      */}
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          flexDirection: "row",
        }}
      >
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => {
              onOpen(null);
              action.onPress();
            }}
            style={({ pressed }) => ({
              width: WIDTH,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              backgroundColor: action.tone,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name={action.icon} size={19} color="white" />

            <Text
              numberOfLines={1}
              style={{ color: "white", fontSize: 11, fontWeight: "700" }}
            >
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Animated.View
        {...drag.panHandlers}
        style={{
          backgroundColor: "white",
          transform: [{ translateX: slide }],
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

/*
 * The number a row sorts by, in front of the thing it sorts. Without it the
 * order is a fact you can only discover by comparing two screens.
 */
export function OrderMark({ index }: { index: number }) {
  return (
    <View
      style={{
        minWidth: 26,
        height: 26,
        paddingHorizontal: 6,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.pale,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "800", color: colors.muted }}>
        {index}
      </Text>
    </View>
  );
}
