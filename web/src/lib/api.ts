import { useQuery } from "@tanstack/react-query";
import type { MatchesPayload, Stats } from "../types/stats";

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${import.meta.env.BASE_URL}stats.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Stats;
}

export async function fetchMatches(): Promise<MatchesPayload> {
  const res = await fetch(`${import.meta.env.BASE_URL}matches.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as MatchesPayload;
}

/**
 * The per-match payload is optional: a deployment may not publish it yet, and
 * only the detail pages need it, so it is fetched lazily and never retried into
 * a blocking error state.
 */
export function useMatches() {
  return useQuery({ queryKey: ["matches"], queryFn: fetchMatches, retry: false, staleTime: 60_000 });
}
