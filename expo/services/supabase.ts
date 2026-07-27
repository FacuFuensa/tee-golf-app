import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabaseConfig";

/**
 * Single shared Supabase client (the RN equivalent of the requested
 * SupabaseManager singleton). Sessions persist in AsyncStorage so the user
 * stays signed in between launches.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Keep the auth token fresh only while the app is in the foreground.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

// On web, Supabase auto-refreshes the auth token whenever the browser tab
// regains visibility. In the preview that fires often, and a transient
// network blip surfaces as an *unhandled* `TypeError: Failed to fetch`
// rejection (Supabase retries and self-recovers anyway). Nothing in the app
// awaits this background refresh, so we quietly swallow that specific
// rejection to avoid tripping the dev error overlay. All app-driven requests
// are caught by React Query / their own callers, so real errors still surface.
if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? "");
    if (message.includes("Failed to fetch")) {
      event.preventDefault();
    }
  });
}
