import type { PlayerRecord, Stats } from "../types/stats";

export type PlayerMetric = "win_rate" | "kda" | "kills" | "assists" | "matches";

// One axis of the player-vs-lobby radar, normalized to 0..1.
export interface RadarAxis {
  label: string;
  norm: number;
  avgNorm: number;
}

export interface DuoRef {
  other: string;
  matches: number;
  wins: number;
  losses: number;
  win_rate: number;
}

export function playerName(stats: Stats, id: string): string {
  return stats.players[id]?.player_name || id;
}

export function heroName(stats: Stats, heroId: number | string): string {
  const key = String(heroId);
  return stats.heroes[key]?.hero_name || `Hero ${heroId}`;
}

export interface Duo {
  other: string;
  matches: number;
  win_rate: number;
}

// The hero a player has played most often (used as their portrait).
export function playerTopHero(stats: Stats, id: string): number | null {
  const records = stats.player_heroes?.[id];
  if (!records) return null;
  let bestId: number | null = null;
  let bestMatches = -1;
  for (const [heroId, record] of Object.entries(records)) {
    if ((record.matches || 0) > bestMatches) {
      bestMatches = record.matches || 0;
      bestId = Number(heroId);
    }
  }
  return bestId;
}

export function lobbyIds(stats: Stats): string[] {
  return Object.keys(stats.players || {});
}

export function metricValues(stats: Stats, metric: PlayerMetric): number[] {
  return lobbyIds(stats).map((id) => Number(stats.players[id][metric]) || 0);
}

export function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

// Rank of a value (1 = best); ties share the best position.
export function rankOf(stats: Stats, metric: PlayerMetric, value: number): { rank: number; total: number } {
  const sorted = metricValues(stats, metric).sort((a, b) => b - a);
  const index = sorted.findIndex((v) => v <= value);
  return { rank: index < 0 ? sorted.length : index + 1, total: sorted.length };
}

export function heroPoolSize(stats: Stats, id: string): number {
  return Object.keys(stats.player_heroes?.[id] || {}).length;
}

export function bestDuoFor(stats: Stats, id: string): { best: DuoRef | null; most: DuoRef | null } {
  const duos: DuoRef[] = Object.values(stats.teammates || {})
    .filter((t) => t.player_a === id || t.player_b === id)
    .map((t) => ({
      other: t.player_a === id ? t.player_b : t.player_a,
      matches: t.matches,
      wins: t.wins,
      losses: t.losses,
      win_rate: t.win_rate,
    }));
  const eligible = duos.filter((d) => d.matches >= 3);
  const pool = eligible.length ? eligible : duos;
  const best = pool.slice().sort((a, b) => b.win_rate - a.win_rate || b.matches - a.matches)[0] || null;
  const most = duos.slice().sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate)[0] || null;
  return { best, most };
}

export function rivalriesFor(stats: Stats, id: string): DuoRef[] {
  return Object.values(stats.head_to_head || {})
    .filter((h) => h.player_a === id || h.player_b === id)
    .map((h) => ({
      other: h.player_a === id ? h.player_b : h.player_a,
      matches: h.matches,
      wins: h.player_a === id ? h.player_a_wins : h.player_b_wins,
      losses: h.player_a === id ? h.player_b_wins : h.player_a_wins,
      win_rate: h.player_a === id ? h.player_a_win_rate : h.player_b_win_rate,
    }));
}

export type BadgeTone = "b1" | "b2" | "b3";

export function computeBadges(stats: Stats, id: string): Array<[string, BadgeTone]> {
  const player: PlayerRecord | undefined = stats.players[id];
  if (!player) return [];
  const badges: Array<[string, BadgeTone]> = [];
  const maxMatches = Math.max(...lobbyIds(stats).map((pid) => Number(stats.players[pid].matches) || 0), 0);
  if (maxMatches > 0 && Number(player.matches) >= maxMatches) badges.push(["Veteran", "b2"]);
  if (Number(player.kda) >= 4) badges.push(["Sharpshooter", "b1"]);
  if (Number(player.win_rate) >= 60) badges.push(["Rock Solid", "b3"]);
  const duo = bestDuoFor(stats, id).best;
  if (duo && duo.win_rate >= 60) badges.push(["Duo King", "b2"]);
  if (heroPoolSize(stats, id) >= 8) badges.push(["Hero Pool Master", "b1"]);
  const rivals = rivalriesFor(stats, id).filter((r) => r.matches >= 3);
  if (rivals.length && Math.min(...rivals.map((r) => r.win_rate)) <= 30) badges.push(["Nemesis", "b3"]);
  return badges;
}
