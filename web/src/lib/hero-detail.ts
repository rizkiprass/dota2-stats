import type { MatchRow } from "./matches";
import type { HeroRecord, Stats } from "../types/stats";

/** Heroes need this many picks before a rank means anything. */
export const RANK_MIN_PICKS = 3;

export interface HeroOverview {
  hero: HeroRecord;
  /** Share of lobby matches in which the hero was picked (either side). */
  pickRate: number;
  pickRank: number | null;
  winRateRank: number | null;
  rankedTotal: number;
  avgKda: number | null;
  kills: number;
  deaths: number;
  assists: number;
}

function rankIn(sorted: HeroRecord[], heroId: number): number | null {
  const index = sorted.findIndex((hero) => hero.hero_id === heroId);
  return index < 0 ? null : index + 1;
}

export function heroOverview(stats: Stats, heroId: number | string): HeroOverview | null {
  const hero = stats.heroes?.[String(heroId)];
  if (!hero) return null;

  const all = Object.values(stats.heroes);
  const byPicks = all.slice().sort((a, b) => b.picks - a.picks || b.win_rate - a.win_rate);
  const ranked = all
    .filter((entry) => entry.picks >= RANK_MIN_PICKS)
    .sort((a, b) => b.win_rate - a.win_rate || b.picks - a.picks);

  let kills = 0;
  let deaths = 0;
  let assists = 0;
  for (const heroes of Object.values(stats.player_heroes ?? {})) {
    const record = heroes[String(heroId)];
    if (!record) continue;
    kills += record.kills;
    deaths += record.deaths;
    assists += record.assists;
  }

  const total = stats.summary.total_matches;
  return {
    hero,
    pickRate: total > 0 ? (hero.picks / total) * 100 : 0,
    pickRank: rankIn(byPicks, hero.hero_id),
    winRateRank: hero.picks >= RANK_MIN_PICKS ? rankIn(ranked, hero.hero_id) : null,
    rankedTotal: ranked.length,
    avgKda: hero.picks > 0 ? (kills + assists) / Math.max(deaths, 1) : null,
    kills,
    deaths,
    assists,
  };
}

export interface WinSplit {
  label: string;
  games: number;
  wins: number;
  winRate: number;
}

function split(label: string, rows: MatchRow[]): WinSplit {
  const wins = rows.filter((row) => row.win).length;
  return { label, games: rows.length, wins, winRate: rows.length ? (wins / rows.length) * 100 : 0 };
}

/** Radiant vs Dire, from real match rows. */
export function sideSplits(rows: MatchRow[]): WinSplit[] {
  return [
    split("Radiant", rows.filter((row) => row.players[0]?.team === "radiant")),
    split("Dire", rows.filter((row) => row.players[0]?.team === "dire")),
  ];
}

const DURATION_BUCKETS: Array<{ label: string; max: number }> = [
  { label: "Under 30 min", max: 30 * 60 },
  { label: "30-40 min", max: 40 * 60 },
  { label: "40+ min", max: Infinity },
];

export function durationSplits(rows: MatchRow[]): WinSplit[] {
  let previous = 0;
  return DURATION_BUCKETS.map(({ label, max }) => {
    const min = previous;
    previous = max;
    return split(
      label,
      rows.filter((row) => row.match.duration >= min && row.match.duration < max),
    );
  });
}

export interface ItemUsage {
  item: string;
  games: number;
  wins: number;
  /** Share of this hero's appearances that finished with the item. */
  usage: number;
  winRate: number;
}

/** Most common final-inventory items across the hero's published matches. */
export function itemUsage(rows: MatchRow[], limit = 6): ItemUsage[] {
  const counts = new Map<string, { games: number; wins: number }>();
  let withItems = 0;
  for (const row of rows) {
    const player = row.players[0];
    const items = (player?.final_items ?? []).filter((item): item is string => Boolean(item));
    if (!items.length) continue;
    withItems += 1;
    for (const item of new Set(items)) {
      const entry = counts.get(item) ?? { games: 0, wins: 0 };
      entry.games += 1;
      entry.wins += row.win ? 1 : 0;
      counts.set(item, entry);
    }
  }
  return [...counts.entries()]
    .map(([item, { games, wins }]) => ({
      item,
      games,
      wins,
      usage: withItems ? (games / withItems) * 100 : 0,
      winRate: games ? (wins / games) * 100 : 0,
    }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate || a.item.localeCompare(b.item))
    .slice(0, limit);
}
