import { useRef } from "react";
import { Animated, Easing } from "react-native";

/**
 * The app's standard press-down feedback for pressables that aren't already
 * TeeButton/TeeCard (which do their own spring squash): a quick, subtle
 * scale-down that eases out rather than springing, per the motion spec —
 * 0.97 over 140ms. Kept as one hook so every call site (modal close buttons,
 * the group-round choice rows, …) animates identically instead of each
 * re-typing the same Animated.timing call.
 */
export function usePressScale(toValue: number = 0.97) {
  const scale = useRef(new Animated.Value(1)).current;

  const animate = (value: number): void => {
    Animated.timing(scale, {
      toValue: value,
      duration: 140,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  };

  return {
    scale,
    onPressIn: () => animate(toValue),
    onPressOut: () => animate(1),
  };
}
