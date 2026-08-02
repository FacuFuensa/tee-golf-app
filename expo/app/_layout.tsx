import {
  Newsreader_400Regular,
  Newsreader_600SemiBold,
  Newsreader_700Bold,
  useFonts,
} from "@expo-google-fonts/newsreader";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { Colors } from "@/constants/theme";
import { ActiveRoundProvider } from "@/providers/ActiveRoundProvider";
import { AuthProvider, useAuth } from "@/providers/AuthProvider";
import { BlockedPlayersProvider } from "@/providers/BlockedPlayersProvider";
import { SettingsProvider } from "@/providers/SettingsProvider";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function useProtectedRoute(enabled: boolean): void {
  const { isLoading, session, profile } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    // Wait for the root navigator to finish mounting (navigationState.key)
    // before issuing a redirect — otherwise expo-router drops the action with
    // "was not handled by any navigator".
    if (!enabled || isLoading || !navigationState?.key) return;
    const root = segments[0];
    const inAuth = root === "sign-in";
    const inOnboarding = root === "onboarding";

    if (!session && !inAuth) {
      router.replace("/sign-in");
    } else if (session && !profile && !inOnboarding) {
      router.replace("/onboarding");
    } else if (session && profile && (inAuth || inOnboarding || root === undefined)) {
      router.replace("/(tabs)/courses");
    }
  }, [enabled, isLoading, session, profile, segments, router, navigationState?.key]);
}

function RootNav({ ready }: { ready: boolean }) {
  // Keep the navigator mounted at all times — the native splash covers the
  // initial load. Unmounting the Stack on every auth toggle is what caused
  // redirects to fire before the navigator was ready.
  useProtectedRoute(ready);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: "fade",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="course/new" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="course/browse" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="round/[id]" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="history/[roundId]" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="bag" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}

function Gate() {
  const { isLoading } = useAuth();
  const [fontsLoaded, fontError] = useFonts({
    Newsreader_400Regular,
    Newsreader_600SemiBold,
    Newsreader_700Bold,
  });

  const ready = (fontsLoaded || fontError !== null) && !isLoading;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  return (
    <>
      <StatusBar style="dark" />
      <RootNav ready={ready} />
    </>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={styles.flex}>
        <SettingsProvider>
          <AuthProvider>
            <BlockedPlayersProvider>
              <ActiveRoundProvider>
                <Gate />
              </ActiveRoundProvider>
            </BlockedPlayersProvider>
          </AuthProvider>
        </SettingsProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
});
