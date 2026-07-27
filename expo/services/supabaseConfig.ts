/**
 * Supabase credentials.
 *
 * Paste your project's values below (replace the two placeholders), OR provide
 * them as env vars in `expo/.env`:
 *   EXPO_PUBLIC_SUPABASE_URL=...
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
 *
 * Find both in Supabase → Project Settings → API
 * (Project URL + the "anon" / public key — never the service_role key).
 */
const PLACEHOLDER_URL = "https://YOUR-PROJECT.supabase.co";
const PLACEHOLDER_KEY = "YOUR-ANON-KEY";

export const SUPABASE_URL: string =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  "https://ilrkgprannppoyjibnrw.supabase.co";

export const SUPABASE_ANON_KEY: string =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlscmtncHJhbm5wcG95amlibnJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNjE5MjgsImV4cCI6MjA5NzYzNzkyOH0.9JM4yG2E-ulil5obq5Xb_ADHdafQGO_vrxNKyN1jiqI";

/** True once real credentials are in place — used to show a friendly setup notice. */
export const isSupabaseConfigured: boolean =
  SUPABASE_URL.length > 0 &&
  SUPABASE_ANON_KEY.length > 0 &&
  SUPABASE_URL !== PLACEHOLDER_URL &&
  SUPABASE_ANON_KEY !== PLACEHOLDER_KEY &&
  SUPABASE_URL.startsWith("http");
