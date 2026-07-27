import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/providers/AuthProvider";
import { fetchClubs } from "@/services/db";
import type { Club } from "@/types/models";

/**
 * The signed-in golfer's club bag, ordered longest carry first. Shares a single
 * React Query cache entry (`["clubs", userId]`) so the round screen and the bag
 * editor stay in sync without prop drilling or an extra provider.
 */
export function useClubs(): {
  clubs: Club[];
  isLoading: boolean;
  isError: boolean;
} {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: ["clubs", userId],
    queryFn: () => fetchClubs(userId as string),
    enabled: userId != null,
  });

  return {
    clubs: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
