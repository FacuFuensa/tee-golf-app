import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

const enabled = Platform.OS !== "web";

export function tapLight(): void {
  if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export function tapMedium(): void {
  if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function tapHeavy(): void {
  if (enabled) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
}

export function notifySuccess(): void {
  if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

export function notifyWarning(): void {
  if (enabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
}

export function selectionChanged(): void {
  if (enabled) void Haptics.selectionAsync();
}
