import type { Stats } from "../types/stats";

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${import.meta.env.BASE_URL}stats.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Stats;
}
