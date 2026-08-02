import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import { Colors, Radius, Spacing, cardShadow, hairline } from "@/constants/theme";

const ENTER_MS = 220;
const EXIT_MS = 150;
// Ease-out: fast start, gentle settle. Used for both directions — exits are
// just shorter, not a different curve — so nothing in the motion ever feels
// like it's arriving or leaving at a constant speed.
const EASE_OUT = Easing.out(Easing.cubic);

interface TeeModalProps {
  /** Same meaning as RN Modal's own `visible`; this component owns the fade/scale around it. */
  visible: boolean;
  onClose: () => void;
  /** False disables backdrop-tap and hardware-back dismissal, e.g. while a mutation is in flight. */
  dismissable?: boolean;
  children: React.ReactNode;
  /** Card width cap in points — the card still shrinks to its content below this. */
  maxWidth?: number;
  style?: ViewStyle;
}

/**
 * Subscribes to the OS "Reduce Motion" setting. Reduced motion means
 * gentler, not none: the scale is dropped but the opacity fade stays, so the
 * modal still visibly announces itself.
 */
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (live) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}

/**
 * The app's one centered-popup-card modal — a scrim plus a card that scales
 * and fades in from its own centre, never anchored to an edge. Shared by the
 * club editor, "start a round" and "join a group" so the treatment (and the
 * keyboard handling) only exists once.
 */
export function TeeModal({
  visible,
  onClose,
  dismissable = true,
  children,
  maxWidth = 420,
  style,
}: TeeModalProps) {
  // RN's <Modal> has no exit transition of its own — it's just gone the
  // instant `visible` flips. Keeping it mounted through our own (shorter)
  // exit animation, and only dropping it once that finishes, is what makes
  // the close feel like a modal closing instead of a light switch.
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: ENTER_MS,
        easing: EASE_OUT,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: EXIT_MS,
        easing: EASE_OUT,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, progress]);

  if (!mounted) return null;

  const close = (): void => {
    if (dismissable) onClose();
  };

  // Never scale from/to 0 — only ever between 0.95 and 1, per the motion
  // spec. Reduced motion drops the scale entirely and keeps just the fade.
  const scale = reduceMotion
    ? 1
    : progress.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });

  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Animated.View>
      {/* pointerEvents="box-none" on these two wrappers: only the card itself
          should catch touches, everything else must fall through to the
          backdrop Pressable above so a tap beside the card still dismisses. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.avoider}
        pointerEvents="box-none"
      >
        <View style={styles.centerer} pointerEvents="box-none">
          <Animated.View
            style={[styles.card, { maxWidth, opacity: progress, transform: [{ scale }] }, style]}
          >
            {children}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.scrim },
  // flex:1 on both the avoider and the centerer is what lets the "padding"
  // KeyboardAvoidingView behaviour actually work here: it grows its own
  // bottom padding to match the keyboard height, which shrinks this flex
  // column's content box, which re-centers the card higher — the card
  // shifts because the container it's centered in got shorter, not because
  // anything reaches in and repositions the card directly.
  avoider: { flex: 1 },
  centerer: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xl },
  card: {
    width: "100%",
    backgroundColor: Colors.background,
    borderRadius: Radius.xl,
    borderWidth: hairline,
    borderColor: Colors.border,
    padding: Spacing.xl,
    ...cardShadow,
  },
});
