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
  /** Conservative 95% win-rate estimate used for the proven win-rate ranking. */
  win_rate_confidence?: number;
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
  /** Picks by side; present from schema 1.2 onward. */
  radiant_picks?: number;
  dire_picks?: number;
  /** Matches in which both sides picked this hero. */
  contested?: number;
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
  win_rate_confidence?: number;
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
    behavior?: number;
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
  ping_bursts_per_match?: number;
  chat_messages?: number;
  chat_messages_per_match?: number;
  disconnects?: number;
  abandons?: number;
  disconnects_or_abandons_per_match?: number;
  /** Comparative replay-activity proxy, not an official Dota behavior score. */
  disruptive_score?: number;
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

export interface RoleRecord {
  id: string;
  player_name: string | null;
  role: "support" | "offlane" | "carry";
  matches: number;
  wins: number;
  win_rate: number;
  score: number;
  kill_participation: number;
  gpm: number;
  xpm: number;
  last_hits: number;
  hero_damage_per_minute: number;
  tower_damage_per_minute: number;
  stuns_per_minute: number;
  vision: number;
  assists: number;
  role_confidence: number;
  score_breakdown?: RoleScoreBreakdown[];
}

export interface RoleScoreBreakdown {
  key: string;
  label: string;
  value: number;
  normalized: number;
  weight: number;
  contribution: number;
  unit: string;
}

export interface RoleScoringMetric {
  key: string;
  label: string;
  weight: number;
  unit: string;
}

export interface RoleScoring {
  description: string;
  minimum_matches: number;
  eligible_players: number;
  method: string;
  metrics: RoleScoringMetric[];
}

/**
 * Bounded newest-match teaser carried by stats.json, so the dashboard can show
 * recent activity without fetching the per-match payload.
 */
export interface RecentMatchPlayer {
  /** Canonical identity; null for anonymous players. */
  account_id: string | null;
  /** Display-only label from the parser; never an identifier. */
  player_name: string | null;
}

export interface RecentMatch {
  match_id: string;
  start_time: number | null;
  duration: number;
  radiant_win: boolean;
  radiant_kills: number;
  dire_kills: number;
  /** Hero ids per side, in the parser's order. Present from schema 1.4 onward. */
  radiant_heroes?: Array<number | string>;
  dire_heroes?: Array<number | string>;
  /**
   * Player identity per side, index-aligned with the hero arrays above.
   * Present from schema 1.5 onward; absent payloads render hero-only portraits.
   */
  radiant_players?: RecentMatchPlayer[];
  dire_players?: RecentMatchPlayer[];
}

export interface Stats {
  summary: Summary;
  players: Record<string, PlayerRecord>;
  heroes: Record<string, HeroRecord>;
  player_heroes: Record<string, Record<string, PlayerHeroRecord>>;
  teammates: Record<string, TeammateRecord>;
  head_to_head: Record<string, HeadToHeadRecord>;
  leaderboards: Record<string, LeaderboardEntry[]>;
  /** Present from schema 1.3 onward; absent payloads must still render. */
  recent_matches?: RecentMatch[];
  /** Newest-first, bounded W/L outcomes per player; present from schema 1.7 onward. */
  player_recent_results?: Record<string, Array<"W" | "L">>;
  behavior?: BehaviorStats;
  /** Role-specific rankings generated from replay telemetry. */
  role_rankings?: Record<string, RoleRecord[]>;
  role_scoring?: Record<string, RoleScoring>;
  metadata: Metadata;
}
