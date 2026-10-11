import type { HeroRecord, Stats } from "../types/stats";

/**
 * Per-hero accent tints. Shared with the hero grid so a donut slice is always
 * the same color as the tile for that hero.
 */
export const HERO_TINTS = ["--av1", "--av2", "--av3", "--av4", "--av5", "--av6"] as const;

export function heroTint(index: number): string {
  return HERO_TINTS[index % HERO_TINTS.length];
}

/** The one hero ordering the section uses, so the grid and the chart cannot drift. */
export function sortedHeroes(stats: Stats): HeroRecord[] {
  return [...Object.values(stats.heroes ?? {})].sort(
    (a, b) => b.picks - a.picks || b.win_rate - a.win_rate || a.hero_id - b.hero_id,
  );
}

export function heroLabel(hero: HeroRecord): string {
  return hero.hero_name ?? `Hero ${hero.hero_id}`;
}

export interface HeroPickShare {
  key: string;
  name: string;
  picks: number;
  share: number;
  tint: string;
  /** True for the grouped tail slice. */
  isOther: boolean;
  /** How many heroes the slice stands for (1 for a named hero). */
  heroCount: number;
}

export interface PickShares {
  shares: HeroPickShare[];
  others: HeroPickShare | null;
  totalPicks: number;
}

/** How many named slices a share chart may show before the tail is grouped. */
export const SHARE_SLICES = 5;

/**
 * Pick share as at most `limit` named heroes plus one grouped tail, so the
 * chart never renders more arcs than it can label.
 */
export function pickShares(stats: Stats, limit = SHARE_SLICES): PickShares {
  const heroes = sortedHeroes(stats);
  const totalPicks = heroes.reduce((sum, hero) => sum + hero.picks, 0);

  const toShare = (picks: number) => (totalPicks > 0 ? (picks / totalPicks) * 100 : 0);

  const shares: HeroPickShare[] = heroes.slice(0, limit).map((hero, index) => ({
    key: String(hero.hero_id),
    name: heroLabel(hero),
    picks: hero.picks,
    share: toShare(hero.picks),
    tint: heroTint(index),
    isOther: false,
    heroCount: 1,
  }));

  const tail = heroes.slice(limit);
  const tailPicks = tail.reduce((sum, hero) => sum + hero.picks, 0);
  const others: HeroPickShare | null = tail.length
    ? {
        key: "others",
        name: "Other heroes",
        picks: tailPicks,
        share: toShare(tailPicks),
        tint: "--muted",
        isOther: true,
        heroCount: tail.length,
      }
    : null;

  return { shares, others, totalPicks };
}

export interface HeroDiversity {
  distinct: number;
  totalPicks: number;
  picksPerHero: number;
}

export function heroDiversity(stats: Stats): HeroDiversity {
  const heroes = sortedHeroes(stats);
  const totalPicks = heroes.reduce((sum, hero) => sum + hero.picks, 0);
  return {
    distinct: heroes.length,
    totalPicks,
    picksPerHero: heroes.length ? totalPicks / heroes.length : 0,
  };
}

/** Heroes both sides picked in the same match, most contested first. */
export function contestedHeroes(stats: Stats): HeroRecord[] {
  return sortedHeroes(stats)
    .filter((hero) => (hero.contested ?? 0) > 0)
    .sort((a, b) => (b.contested ?? 0) - (a.contested ?? 0) || b.picks - a.picks);
}
