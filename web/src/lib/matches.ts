import type { MatchPlayerRecord, MatchRecord, MatchesPayload } from "../types/stats";

/**
 * Pure helpers over the lazy `matches.json` payload. Everything here degrades
 * to empty when the payload is missing: a deployment that has not published
 * per-match data yet must still render every page.
 */

/** Newest first. The payload already arrives ordered; this is defensive. */
export function orderedMatches(payload: MatchesPayload | undefined): MatchRecord[] {
  return (payload?.matches ?? []).slice().sort((a, b) => (b.start_time ?? 0) - (a.start_time ?? 0));
}

function pickPlayer(match: MatchRecord, accountId: string): MatchPlayerRecord | undefined {
  return match.players.find((player) => player.account_id === accountId);
}

/** One row of the recent-match list: the relevant players plus the outcome. */
export interface MatchRow {
  match: MatchRecord;
  players: MatchPlayerRecord[];
  win: boolean;
}

function row(match: MatchRecord, players: MatchPlayerRecord[]): MatchRow {
  return { match, players, win: players[0]?.win ?? match.radiant_win };
}

export function playerMatchRows(payload: MatchesPayload | undefined, accountId: string): MatchRow[] {
  const rows: MatchRow[] = [];
  for (const match of orderedMatches(payload)) {
    const player = pickPlayer(match, accountId);
    if (player) rows.push(row(match, [player]));
  }
  return rows;
}

export function heroMatchRows(payload: MatchesPayload | undefined, heroId: number | string): MatchRow[] {
  const key = String(heroId);
  const rows: MatchRow[] = [];
  for (const match of orderedMatches(payload)) {
    for (const player of match.players) {
      if (String(player.hero_id) === key) rows.push(row(match, [player]));
    }
  }
  return rows;
}

/** Matches both players were on the same side. */
export function duoMatchRows(payload: MatchesPayload | undefined, a: string, b: string): MatchRow[] {
  const rows: MatchRow[] = [];
  for (const match of orderedMatches(payload)) {
    const first = pickPlayer(match, a);
    const second = pickPlayer(match, b);
    if (first && second && first.team === second.team) rows.push(row(match, [first, second]));
  }
  return rows;
}

/** Matches the two players faced each other. */
export function rivalryMatchRows(payload: MatchesPayload | undefined, a: string, b: string): MatchRow[] {
  const rows: MatchRow[] = [];
  for (const match of orderedMatches(payload)) {
    const first = pickPlayer(match, a);
    const second = pickPlayer(match, b);
    if (first && second && first.team !== second.team) rows.push(row(match, [first, second]));
  }
  return rows;
}

export interface MatchHistory {
  total: number;
  wins: number;
  losses: number;
  /** Consecutive result run at the top of the list (most recent first). */
  streak: { win: boolean; length: number } | null;
  firstPlayed: number | null;
  lastPlayed: number | null;
}

export function summarize(rows: MatchRow[]): MatchHistory {
  const wins = rows.filter((r) => r.win).length;
  let streak: MatchHistory["streak"] = null;
  if (rows.length) {
    const { win } = rows[0];
    let length = 0;
    for (const r of rows) {
      if (r.win !== win) break;
      length += 1;
    }
    streak = { win, length };
  }
  const times = rows.map((r) => r.match.start_time).filter((value): value is number => typeof value === "number");
  return {
    total: rows.length,
    wins,
    losses: rows.length - wins,
    streak,
    firstPlayed: times.length ? Math.min(...times) : null,
    lastPlayed: times.length ? Math.max(...times) : null,
  };
}

export interface HeroCombo {
  heroIds: Array<number | string>;
  labels: string[];
  matches: number;
  wins: number;
}

/** Hero pairings a duo played together, most frequent first. */
export function duoHeroCombos(rows: MatchRow[], limit = 4): HeroCombo[] {
  const combos = new Map<string, HeroCombo>();
  for (const entry of rows) {
    if (entry.players.length < 2) continue;
    const sorted = entry.players
      .slice()
      .sort((a, b) => String(a.hero_id).localeCompare(String(b.hero_id)));
    const key = sorted.map((player) => String(player.hero_id)).join("+");
    const existing = combos.get(key) ?? {
      heroIds: sorted.map((player) => player.hero_id),
      labels: sorted.map((player) => player.hero_name ?? `Hero ${player.hero_id}`),
      matches: 0,
      wins: 0,
    };
    existing.matches += 1;
    existing.wins += entry.win ? 1 : 0;
    combos.set(key, existing);
  }
  return [...combos.values()]
    .sort((a, b) => b.matches - a.matches || b.wins - a.wins)
    .slice(0, limit);
}
