// Types mirroring the aggregator's stats.json schema (aggregator/aggregator.py).

export interface Summary {
  total_matches: number;
  total_players: number;
  total_hero_picks: number;
  average_duration_seconds: number;
  radiant_wins: number;
  dire_wins: number;
  radiant_win_rate: number;
  dire_win_rate: number;
}

export interface PlayerRecord {
  player_name: string | null;
  matches: number;
  wins: number;
  losses: number;
  win_rate: number;
  kills: number;
  deaths: number;
  assists: number;
  avg_kills: number;
  avg_deaths: number;
  avg_assists: number;
  kda: number;
}

export interface HeroRecord {
  hero_id: number;
  hero_name: string | null;
  picks: number;
  wins: number;
  losses: number;
  win_rate: number;
}

export interface PlayerHeroRecord {
  player_name: string | null;
  matches: number;
  wins: number;
  losses: number;
  win_rate: number;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
}

export interface TeammateRecord {
  player_a: string;
  player_b: string;
  matches: number;
  wins: number;
  losses: number;
  win_rate: number;
}

export interface HeadToHeadRecord {
  player_a: string;
  player_b: string;
  matches: number;
  player_a_wins: number;
  player_b_wins: number;
  player_a_win_rate: number;
  player_b_win_rate: number;
}

// Leaderboard entries are a union keyed by category; fields are optional.
export interface LeaderboardEntry {
  id: string;
  player_name?: string | null;
  // player
  matches?: number;
  wins?: number;
  losses?: number;
  win_rate?: number;
  kills?: number;
  deaths?: number;
  assists?: number;
  kda?: number;
  // hero
  hero_id?: number;
  hero_name?: string | null;
  picks?: number;
  // player-hero
  player_id?: string;
  // pair (duo / rivalry)
  player_a?: string;
  player_b?: string;
  player_a_wins?: number;
  player_b_wins?: number;
  player_a_win_rate?: number;
  player_b_win_rate?: number;
}

export interface Metadata {
  generated_at: string;
  schema_version: string;
  source_match_count: number;
  /** Leaderboard minimums, published by the aggregator so clients never duplicate them. */
  thresholds?: {
    players: number;
    heroes: number;
    teammates: number;
    head_to_head: number;
    leaderboard_limit: number;
  };
}

/* ------------------------------------------------------------------ */
/* matches.json — the lazy per-match payload (newest first, capped)    */
/* ------------------------------------------------------------------ */

export interface MatchPlayerRecord {
  account_id: string | null;
  player_name: string | null;
  hero_id: number | string;
  hero_name: string | null;
  team: "radiant" | "dire";
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
}

export interface MatchRecord {
  match_id: string;
  /** Unix epoch seconds, or null when the parser had no start time. */
  start_time: number | null;
  duration: number;
  radiant_win: boolean;
  players: MatchPlayerRecord[];
}

export interface MatchesPayload {
  generated_at: string;
  schema_version: string;
  /** Total matches in history; `matches` holds at most the published cap. */
  match_count: number;
  matches: MatchRecord[];
}

// Aggregated, privacy-conscious replay activity metrics. Raw chat text is never
// part of this dashboard contract; only message counts are exposed.
export interface BehaviorPlayerRecord {
  matches: number;
  pings?: number;
  pings_per_match?: number;
  ping_bursts?: number;
  chat_messages?: number;
  chat_messages_per_match?: number;
  chatwheel?: Record<string, number>;
  orders?: number;
  orders_per_minute?: number;
  wards_obs?: number;
  wards_sen?: number;
  wards_per_match?: number;
  runes?: number;
  runes_per_match?: number;
  pauses_initiated?: number;
  pause_seconds?: number;
  hero_badge_xp?: number;
}

export interface BehaviorStats {
  players: Record<string, BehaviorPlayerRecord>;
}

export interface Stats {
  summary: Summary;
  players: Record<string, PlayerRecord>;
  heroes: Record<string, HeroRecord>;
  player_heroes: Record<string, Record<string, PlayerHeroRecord>>;
  teammates: Record<string, TeammateRecord>;
  head_to_head: Record<string, HeadToHeadRecord>;
  leaderboards: Record<string, LeaderboardEntry[]>;
  behavior?: BehaviorStats;
  metadata: Metadata;
}
