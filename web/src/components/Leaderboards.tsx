import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Avatar, AvatarPair, Bar, PlayerAvatar, PlayerName, useCountUp } from "./ui";
import { heroName, playerName } from "../lib/derived";
import { useDashboard } from "../lib/dashboard-context";
import { CATEGORIES } from "../lib/leaderboard";
import type { LeaderboardEntry, Stats } from "../types/stats";

const COLLAPSED_COUNT = 5;

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
    const prep = category.includes("duo") ? "with" : "vs";
    sub = `${prep} ${playerName(stats, entry.player_b)}`;
  } else if (entry.hero_id !== undefined) {
    const label = entry.hero_name ?? `Hero ${entry.hero_id}`;
    avatarNode = <Avatar heroId={entry.hero_id} name={label} />;
    nameNode = <>{label}</>;
  } else {
    avatarNode = <PlayerAvatar id={entry.id} />;
    nameNode = <PlayerName id={entry.id} />;
  }

  const spec = CATEGORIES[category];
  const metric = spec ? Number(spec.metric(entry)) : 0;
  const animatedMetric = useCountUp(metric);
  const scale = category.includes("win_rate") ? 100 : maxMetric;
  const width = Math.max(2, Math.min(100, (metric / (scale || 1)) * 100));

  return (
    <div className="lb-row">
      <div className={`lb-rank${rank <= 3 ? ` medal medal-${rank}` : ""}`}>{rank}</div>
      {avatarNode}
      <div className="lb-main">
        <div className="lb-name">
          {nameNode}
          {sub ? <span className="sub">{sub}</span> : null}
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
    <section className="section" id="leaderboards">
      <h2 className="section-title">Leaderboards</h2>
      <div className="board-grid">
        {Object.entries(boards).map(([category, entries]) => {
          const all = entries || [];
          const gold = category.includes("win_rate");
          const shown = all.slice(0, COLLAPSED_COUNT);
          const maxMetric = Math.max(...all.map((e) => Number(CATEGORIES[category]?.metric(e) ?? 0)), 1);
          const spec = CATEGORIES[category];
          const title = spec?.title ?? category;

          return (
            <div className="lb" key={category}>
              <h3 className="lb-hd">
                {all.length > 0 ? (
                  <Link
                    to="/leaderboard/$category"
                    params={{ category }}
                    className="lb-hd-link"
                    aria-label={`Open the ${title} leaderboard`}
                  >
                    <span className="lb-hd-title">{title}</span>
                    <svg className="lb-hd-arrow" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ) : (
                  <span className="lb-hd-title lb-hd-static">{title}</span>
                )}
              </h3>
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
