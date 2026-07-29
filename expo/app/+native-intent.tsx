/**
 * expo-router's hook for incoming system URLs (deep links, auth callbacks).
 *
 * This previously returned "/" for EVERY link, silently discarding the path and
 * its parameters — which would have swallowed Supabase auth callbacks and any
 * future group-round invite link. Returning the path unchanged restores
 * expo-router's normal resolution; unknown paths still fall through to the
 * +not-found screen on their own.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return path;
}
