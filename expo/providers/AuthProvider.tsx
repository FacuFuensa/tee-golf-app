import createContextHook from "@nkzw/create-context-hook";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createProfile, deleteMyAccount, deleteMyData, fetchProfile } from "@/services/db";
import { supabase } from "@/services/supabase";
import { isSupabaseConfigured } from "@/services/supabaseConfig";
import type { Profile } from "@/types/models";

const CONFIG_MESSAGE =
  "Add your Supabase URL and anon key in services/supabaseConfig.ts to sign in.";

interface AuthResult {
  error: string | null;
}

interface SignUpResult extends AuthResult {
  needsConfirmation: boolean;
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Something went wrong. Please try again.";
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState<boolean>(true);
  const [profileLoading, setProfileLoading] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setInitializing(false);
      })
      .catch(() => {
        if (active) setInitializing(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      // Keep this callback synchronous — defer any async work to effects.
      setSession(next);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id ?? null;

  // Whenever the signed-in user changes (sign out, or switching accounts),
  // wipe the React Query cache so one account's courses, rounds, and stats
  // never bleed into another. The previous user's data lives only in Supabase.
  const prevUserId = useRef<string | null>(userId);
  useEffect(() => {
    if (prevUserId.current !== userId) {
      prevUserId.current = userId;
      queryClient.clear();
    }
  }, [userId, queryClient]);

  useEffect(() => {
    let active = true;
    if (!userId || !isSupabaseConfigured) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    fetchProfile(userId)
      .then((p) => {
        if (active) setProfile(p);
      })
      .catch((error) => {
        console.log("[auth] profile load failed:", messageFrom(error));
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return { error: CONFIG_MESSAGE };
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error ? error.message : null };
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    if (!isSupabaseConfigured) return { error: CONFIG_MESSAGE, needsConfirmation: false };
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) return { error: error.message, needsConfirmation: false };
    return { error: null, needsConfirmation: data.session === null };
  }, []);

  const saveProfile = useCallback(
    async (displayName: string): Promise<AuthResult> => {
      if (!userId) return { error: "You're not signed in." };
      try {
        const created = await createProfile(userId, displayName.trim());
        setProfile(created);
        return { error: null };
      } catch (error) {
        return { error: messageFrom(error) };
      }
    },
    [userId]
  );

  const signOut = useCallback(async (): Promise<void> => {
    await supabase.auth.signOut();
    setProfile(null);
    queryClient.clear();
  }, [queryClient]);

  const clearMyData = useCallback(async (): Promise<AuthResult> => {
    if (!userId) return { error: "You're not signed in." };
    try {
      await deleteMyData();
      return { error: null };
    } catch (error) {
      return { error: messageFrom(error) };
    }
  }, [userId]);

  const deleteAccount = useCallback(async (): Promise<AuthResult> => {
    if (!userId) return { error: "You're not signed in." };
    try {
      await deleteMyAccount();
      await supabase.auth.signOut();
      setProfile(null);
      return { error: null };
    } catch (error) {
      return { error: messageFrom(error) };
    }
  }, [userId]);

  const isLoading = initializing || (userId !== null && profile === null && profileLoading);
  const user: User | null = session?.user ?? null;

  return useMemo(
    () => ({
      session,
      user,
      profile,
      isLoading,
      isConfigured: isSupabaseConfigured,
      signIn,
      signUp,
      saveProfile,
      signOut,
      clearMyData,
      deleteAccount,
    }),
    [
      session,
      user,
      profile,
      isLoading,
      signIn,
      signUp,
      saveProfile,
      signOut,
      clearMyData,
      deleteAccount,
    ]
  );
});
