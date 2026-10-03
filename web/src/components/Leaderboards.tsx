import type { ReactNode } from "react";
import { Avatar, AvatarPair, Bar, PlayerAvatar, PlayerName, useCountUp } from "./ui";
import { fmtInt, fmtNum, fmtPct } from "../lib/format";
import { heroName, playerName } from "../lib/derived";
import { useDashboard } from "../lib/dashboard-context";
import type { LeaderboardEntry, Stats } from "../types/stats";

const TITLES: Record<string, string> = {
  most_matches: "Most Matches",
  highest_win_rate: "Highest Win Rate",
  most_kills: "Most Kills",
  best_kda: "Best KDA",
  most_assists: "Most Assists",
  most_picked_hero: "Most Picked Hero",
  best_hero_win_rate: "Best Hero Win Rate",
  best_duo_win_rate: "Best Duo Win Rate",
  most_played_duo: "Most Played Duo",
  most_played_rivalry: "Most Played Rivalry",
};

interface Spec {
  format: (value: number) => string;
  metric: (entry: LeaderboardEntry) => number;
  pill?: boolean;
}

const SPECS: Record<string, Spec> = {
  most_matches: { format: (value) => fmtInt(Math.round(value)), metric: (e) => e.matches ?? 0 },
  highest_win_rate: { format: fmtPct, metric: (e) => e.win_rate ?? 0, pill: true },
  most_kills: { format: (value) => fmtInt(Math.round(value)), metric: (e) => e.kills ?? 0 },
  best_kda: { format: fmtNum, metric: (e) => e.kda ?? 0 },
  most_assists: { format: (value) => fmtInt(Math.round(value)), metric: (e) => e.assists ?? 0 },
  most_picked_hero: { format: (value) => fmtInt(Math.round(value)), metric: (e) => e.picks ?? 0 },
  best_hero_win_rate: { format: fmtPct, metric: (e) => e.win_rate ?? 0, pill: true },
  best_duo_win_rate: { format: fmtPct, metric: (e) => e.win_rate ?? 0, pill: true },
  most_played_duo: { format: (value) => fmtInt(Math.round(value)), metric: (e) => e.matches ?? 0 },
  most_played_rivalry: { format: (value) => fmtInt(Math.round(value)), metric: (e) => e.matches ?? 0 },
};

function Row({
  category,
  entry,
  maxMetric,
  rank,
  gold,
}: {
  category: string;
  entry: LeaderboardEntry;
  maxMetric: number;
  rank: number;
  gold: boolean;
}) {
  const { stats } = useDashboard();

  let avatarNode: ReactNode;
  let nameNode: ReactNode;
  let sub: string | null = null;

  if (entry.player_id !== undefined && entry.hero_id !== undefined) {
    avatarNode = <PlayerAvatar id={entry.player_id} />;
    nameNode = <PlayerName id={entry.player_id} />;
    sub = heroName(stats, entry.hero_id);
  } else if (entry.player_a !== undefined && entry.player_b !== undefined) {
    avatarNode = <AvatarPair a={entry.player_a} b={entry.player_b} />;
    nameNode = <PlayerName id={entry.player_a} />;
    const prep = category === "best_duo_win_rate" || category === "most_played_duo" ? "with" : "vs";
    sub = `${prep} ${playerName(stats, entry.player_b)}`;
  } else if (entry.hero_id !== undefined) {
    const label = entry.hero_name ?? `Hero ${entry.hero_id}`;
    avatarNode = <Avatar heroId={entry.hero_id} name={label} />;
    nameNode = <>{label}</>;
  } else {
    avatarNode = <PlayerAvatar id={entry.id} />;
    nameNode = <PlayerName id={entry.id} />;
  }

  const spec = SPECS[category];
  const metric = spec ? Number(spec.metric(entry)) : 0;
  const animatedMetric = useCountUp(metric);
  const scale = category.includes("win_rate") ? 100 : maxMetric;
  const width = Math.max(2, Math.min(100, (metric / (scale || 1)) * 100));

  return (
    <div className="lb-row">
      <div className={`lb-rank${rank === 1 ? " top" : ""}`}>{rank}</div>
      {avatarNode}
      <div className="lb-main">
        <div className="lb-name">
          {nameNode}
          {sub ? <span className="sub"> · {sub}</span> : null}
        </div>
        <Bar pct={width} gold={gold} />
      </div>
      <div className="lb-val">
        {spec?.pill ? <span className="pill-value">{spec.format(animatedMetric)}</span> : spec?.format(animatedMetric)}
      </div>
    </div>
  );
}

export function Leaderboards({ stats }: { stats: Stats }) {
  const boards = stats.leaderboards || {};
  return (
    <section className="section">
      <h2 className="section-title">Leaderboards</h2>
      <div className="board-grid">
        {Object.entries(boards).map(([category, entries]) => {
          const gold = category.includes("win_rate");
          const shown = (entries || []).slice(0, 5);
          const maxMetric = Math.max(...shown.map((e) => Number(SPECS[category]?.metric(e) ?? 0)), 1);
          return (
            <div className="lb" key={category}>
              <h3>{TITLES[category] ?? category}</h3>
              {shown.length === 0 ? (
                <div className="empty-state">
                  <strong>No qualifying entries yet</strong>
                  <span>More match data will fill this leaderboard.</span>
                </div>
              ) : (
                shown.map((entry, i) => (
                  <Row
                    key={`${category}-${entry.id}-${i}`}
                    category={category}
                    entry={entry}
                    maxMetric={maxMetric}
                    rank={i + 1}
                    gold={gold}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
