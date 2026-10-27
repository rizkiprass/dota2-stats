import type { LeaderboardEntry, Stats } from "../types/stats";
import { bestDuoFor, heroName, playerName, playerTopHero, rivalriesFor, type DuoRef } from "./derived";
import { fmtInt, fmtNum, fmtPct } from "./format";

export type CategoryFamily = "player" | "hero" | "duo" | "rivalry";

/** The sample-size field the "minimum" filter acts on. */
export type SampleField = "matches" | "picks";

/** Which standard column carries the category's own metric. */
export type MetricKey = "matches" | "win_rate" | "kills" | "kda" | "assists" | "picks";

export interface CategorySpec {
  title: string;
  blurb: string;
  family: CategoryFamily;
  metric: (entry: LeaderboardEntry) => number;
  /** Ranking metric when it differs from the displayed primary metric. */
  rankingMetric?: (entry: LeaderboardEntry) => number;
  format: (value: number) => string;
  metricKey: MetricKey;
  /** Short label for the metric column and the summary strip. */
  shortLabel: string;
  /** Percentage metrics render as a gold pill, matching the dashboard cards. */
  pill?: boolean;
  sample: SampleField;
  /** Column kept visible on narrow screens. Defaults to the metric column. */
  primaryColumn?: string;
}

export const CATEGORIES: Record<string, CategorySpec> = {
  most_matches: {
    title: "Most Matches",
    blurb: "Every player who has been in a lobby, ranked by games played.",
    family: "player",
    metric: (e) => Number(e.matches) || 0,
    format: (v) => fmtInt(Math.round(v)),
    metricKey: "matches",
    shortLabel: "Matches",
    sample: "matches",
  },
  highest_win_rate: {
    title: "Best proven win rate",
    blurb: "Players ranked by a confidence-adjusted win rate, so more matches make a result more reliable.",
    family: "player",
    metric: (e) => Number(e.win_rate) || 0,
    rankingMetric: (e) => Number(e.win_rate_confidence ?? e.win_rate) || 0,
    format: fmtPct,
    metricKey: "win_rate",
    shortLabel: "Win rate",
    pill: true,
    sample: "matches",
  },
  most_kills: {
    title: "Most Kills",
    blurb: "Total kills across every recorded lobby.",
    family: "player",
    metric: (e) => Number(e.kills) || 0,
    format: (v) => fmtInt(Math.round(v)),
    metricKey: "kills",
    shortLabel: "Kills",
    sample: "matches",
  },
  best_kda: {
    title: "Best KDA",
    blurb: "Kill–death–assist ratio, the lobby's efficiency ranking.",
    family: "player",
    metric: (e) => Number(e.kda) || 0,
    format: (v) => fmtNum(v),
    metricKey: "kda",
    shortLabel: "KDA",
    sample: "matches",
  },
  most_assists: {
    title: "Most Assists",
    blurb: "Total assists across every recorded lobby.",
    family: "player",
    metric: (e) => Number(e.assists) || 0,
    format: (v) => fmtInt(Math.round(v)),
    metricKey: "assists",
    shortLabel: "Assists",
    sample: "matches",
  },
  most_picked_hero: {
    title: "Most Picked Hero",
    blurb: "Heroes ranked by how often the group picked them.",
    family: "hero",
    metric: (e) => Number(e.picks) || 0,
    format: (v) => fmtInt(Math.round(v)),
    metricKey: "picks",
    shortLabel: "Picks",
    sample: "picks",
  },
  best_hero_win_rate: {
    title: "Best Hero Win Rate",
    blurb: "Heroes ranked by the share of their appearances that were wins.",
    family: "hero",
    metric: (e) => Number(e.win_rate) || 0,
    format: fmtPct,
    metricKey: "win_rate",
    shortLabel: "Win rate",
    pill: true,
    sample: "picks",
  },
  best_duo_win_rate: {
    title: "Best Duo Win Rate",
    blurb: "Every pairing ranked by how often they win on the same side.",
    family: "duo",
    metric: (e) => Number(e.win_rate) || 0,
    format: fmtPct,
    metricKey: "win_rate",
    shortLabel: "Win rate",
    pill: true,
    sample: "matches",
  },
  most_played_duo: {
    title: "Most Played Duo",
    blurb: "Every pairing ranked by how often they queued together.",
    family: "duo",
    metric: (e) => Number(e.matches) || 0,
    format: (v) => fmtInt(Math.round(v)),
    metricKey: "matches",
    shortLabel: "Matches",
    sample: "matches",
  },
  most_played_rivalry: {
    title: "Most Played Rivalry",
    blurb: "Head-to-head records, ranked by how often the two faced each other.",
    family: "rivalry",
    metric: (e) => Number(e.matches) || 0,
    format: (v) => fmtInt(Math.round(v)),
    metricKey: "matches",
    shortLabel: "Matches",
    sample: "matches",
    // The head-to-head score is the story here, not the meeting count.
    primaryColumn: "h2h",
  },
};

export function categorySpec(category: string): CategorySpec | null {
  return CATEGORIES[category] ?? null;
}

/* ------------------------------------------------------------------ */
/* Ranked populations                                                  */
/* ------------------------------------------------------------------ */

function playerEntries(stats: Stats): LeaderboardEntry[] {
  return Object.entries(stats.players || {}).map(([id, player]) => ({
    id,
    player_name: player.player_name,
    matches: player.matches,
    wins: player.wins,
    losses: player.losses,
    win_rate: player.win_rate,
    win_rate_confidence: player.win_rate_confidence,
    kills: player.kills,
    deaths: player.deaths,
    assists: player.assists,
    kda: player.kda,
  }));
}

function heroEntries(stats: Stats): LeaderboardEntry[] {
  return Object.entries(stats.heroes || {}).map(([id, hero]) => ({
    id,
    hero_id: hero.hero_id,
    hero_name: hero.hero_name,
    picks: hero.picks,
    wins: hero.wins,
    losses: hero.losses,
    win_rate: hero.win_rate,
  }));
}

function duoEntries(stats: Stats): LeaderboardEntry[] {
  return Object.entries(stats.teammates || {}).map(([id, duo]) => ({
    id,
    player_a: duo.player_a,
    player_b: duo.player_b,
    matches: duo.matches,
    wins: duo.wins,
    losses: duo.losses,
    win_rate: duo.win_rate,
  }));
}

function rivalryEntries(stats: Stats): LeaderboardEntry[] {
  return Object.entries(stats.head_to_head || {}).map(([id, h2h]) => ({
    id,
    player_a: h2h.player_a,
    player_b: h2h.player_b,
    matches: h2h.matches,
    wins: Math.max(h2h.player_a_wins, h2h.player_b_wins),
    losses: Math.min(h2h.player_a_wins, h2h.player_b_wins),
    player_a_wins: h2h.player_a_wins,
    player_b_wins: h2h.player_b_wins,
    player_a_win_rate: h2h.player_a_win_rate,
    player_b_win_rate: h2h.player_b_win_rate,
  }));
}

/**
 * The full ranked population for a category, built from the raw aggregates.
 * Dashboard cards read the pre-capped `leaderboards` slice; detail pages need
 * everyone, so they re-rank from `players` / `heroes` / `teammates` / `head_to_head`.
 */
export function buildRanked(stats: Stats, category: string): LeaderboardEntry[] {
  const spec = CATEGORIES[category];
  if (!spec) return [];
  const rows =
    spec.family === "player"
      ? playerEntries(stats)
      : spec.family === "hero"
        ? heroEntries(stats)
        : spec.family === "duo"
          ? duoEntries(stats)
          : rivalryEntries(stats);
  const rankingMetric = spec.rankingMetric ?? spec.metric;
  return rows.sort((a, b) => rankingMetric(b) - rankingMetric(a) || a.id.localeCompare(b.id));
}

export function sampleOf(entry: LeaderboardEntry, spec: CategorySpec): number {
  return spec.sample === "picks" ? Number(entry.picks) || 0 : Number(entry.matches) || 0;
}

export function pairPlayers(entry: LeaderboardEntry): [string, string] | null {
  if (entry.player_a !== undefined && entry.player_b !== undefined) {
    return [entry.player_a, entry.player_b];
  }
  return null;
}

export function entryName(stats: Stats, entry: LeaderboardEntry): string {
  if (entry.hero_id !== undefined) return entry.hero_name ?? heroName(stats, entry.hero_id);
  const pair = pairPlayers(entry);
  if (pair) return `${playerName(stats, pair[0])} & ${playerName(stats, pair[1])}`;
  return playerName(stats, entry.id);
}

export function entrySearchText(stats: Stats, entry: LeaderboardEntry): string {
  const pair = pairPlayers(entry);
  if (pair) return `${playerName(stats, pair[0])} ${playerName(stats, pair[1])}`.toLowerCase();
  if (entry.hero_id !== undefined) return entryName(stats, entry).toLowerCase();
  return playerName(stats, entry.id).toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Extra blocks                                                        */
/* ------------------------------------------------------------------ */

export interface DuoCoverage {
  playerId: string;
  playerMatches: number;
  share: number;
}

/** How much of each partner's own match history was played in this pairing. */
export function duoCoverage(stats: Stats, entry: LeaderboardEntry): DuoCoverage[] {
  const pair = pairPlayers(entry);
  if (!pair) return [];
  const together = Number(entry.matches) || 0;
  return pair.map((playerId) => {
    const playerMatches = Number(stats.players?.[playerId]?.matches) || 0;
    return {
      playerId,
      playerMatches,
      share: playerMatches > 0 ? (together / playerMatches) * 100 : 0,
    };
  });
}

/** Every partner a player has queued with, best win rate first. */
export function partnershipsFor(stats: Stats, playerId: string): LeaderboardEntry[] {
  return duoEntries(stats)
    .filter((entry) => entry.player_a === playerId || entry.player_b === playerId)
    .sort((a, b) => Number(b.win_rate) - Number(a.win_rate) || Number(b.matches) - Number(a.matches));
}

export interface HeroUser {
  playerId: string;
  matches: number;
  wins: number;
  losses: number;
  win_rate: number;
  kda: number;
}

/** Reverse lookup: who played this hero, and how they did. */
export function heroUsers(stats: Stats, heroId: number | string): HeroUser[] {
  const key = String(heroId);
  const users: HeroUser[] = [];
  for (const [playerId, heroes] of Object.entries(stats.player_heroes || {})) {
    const record = heroes[key];
    if (!record) continue;
    users.push({
      playerId,
      matches: record.matches,
      wins: record.wins,
      losses: record.losses,
      win_rate: record.win_rate,
      kda: record.kda,
    });
  }
  return users.sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate);
}

export interface PlayerHighlights {
  topHeroId: number | null;
  topHeroMatches: number;
  bestDuo: DuoRef | null;
  toughestRival: DuoRef | null;
}

/** Compact profile for a selected player row: signature hero, best duo, worst matchup. */
export function playerHighlights(stats: Stats, playerId: string): PlayerHighlights {
  const topHeroId = playerTopHero(stats, playerId);
  const topHeroMatches =
    topHeroId === null ? 0 : Number(stats.player_heroes?.[playerId]?.[String(topHeroId)]?.matches) || 0;

  const duos = bestDuoFor(stats, playerId);
  const rivals = rivalriesFor(stats, playerId);
  const eligible = rivals.filter((rival) => rival.matches >= 3);
  const pool = eligible.length ? eligible : rivals;
  const toughestRival = pool.slice().sort((a, b) => a.win_rate - b.win_rate)[0] ?? null;

  return {
    topHeroId,
    topHeroMatches,
    bestDuo: duos.best ?? duos.most,
    toughestRival,
  };
}
