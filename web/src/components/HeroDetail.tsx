import { useMemo } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Avatar, Badge, Bar, Pager, PlayerAvatar, PlayerName, usePagination } from "./ui";
import { useDashboard } from "../lib/dashboard-context";
import { useMatches } from "../lib/api";
import { heroName, playerName } from "../lib/derived";
import { heroUsers } from "../lib/leaderboard";
import { heroMatchRows, summarize } from "../lib/matches";
import { durationSplits, heroOverview, itemUsage, sideSplits, type WinSplit } from "../lib/hero-detail";
import { itemImageUrl, itemLabel } from "../lib/items";
import { fmtCount, fmtDuration, fmtEpochDate, fmtInt, fmtNum, fmtPct } from "../lib/format";

const APPEARANCES_PER_PAGE = 10;

export function HeroDetail() {
  const { stats } = useDashboard();
  const { heroId } = useParams({ from: "/hero/$heroId" });
  return (
    <main className="wrap">
      <div className="player-page">
        <Link to="/" className="back-link">
          ← Back to dashboard
        </Link>
        {stats.heroes?.[heroId] ? <HeroDetailContent heroId={heroId} /> : <p className="dp-empty">Hero {heroId} not found.</p>}
      </div>
    </main>
  );
}

function SplitRows({ splits }: { splits: WinSplit[] }) {
  return (
    <div className="board-focus-rows">
      {splits.map((entry) => (
        <div className="dp-rank-row" key={entry.label}>
          <div className="dp-rank-label">{entry.label}</div>
          <Bar pct={entry.winRate} gold={entry.winRate >= 50} />
          <div className="dp-rank-pos">
            <span className="v">{entry.games ? fmtPct(entry.winRate) : "—"}</span>
            <span className="r">{fmtCount(entry.games, "game")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function HeroDetailContent({ heroId }: { heroId: string }) {
  const { stats } = useDashboard();
  const overview = heroOverview(stats, heroId);
  const matchesQuery = useMatches();
  const rows = useMemo(() => heroMatchRows(matchesQuery.data, heroId), [matchesQuery.data, heroId]);
  const history = useMemo(() => summarize(rows), [rows]);
  const items = useMemo(() => itemUsage(rows), [rows]);
  const sides = useMemo(() => sideSplits(rows), [rows]);
  const lengths = useMemo(() => durationSplits(rows), [rows]);
  const appearances = usePagination(rows, APPEARANCES_PER_PAGE);
  if (!overview) return null;

  const { hero } = overview;
  const name = heroName(stats, heroId);
  const users = heroUsers(stats, heroId);

  return (
    <>
      <div className="dp-head">
        <Avatar heroId={hero.hero_id} name={name} size="lg" />
        <div>
          <h1 className="dp-name">{name}</h1>
          <div className="dp-id">Picked by {fmtCount(users.length, "player")}</div>
        </div>
      </div>

      <div className="board-badges">
        {overview.pickRank ? <Badge tone="b1" label={`Pick rank #${overview.pickRank}`} /> : null}
        {overview.winRateRank ? (
          <Badge tone="b3" label={`Win rate rank #${overview.winRateRank} of ${overview.rankedTotal}`} />
        ) : null}
      </div>

      <section className="dp-section">
        <h2 className="dp-title">Overview</h2>
        <div className="dp-kpis">
          <div className="dp-kpi">
            <div className="k-label">Pick rate</div>
            <div className="k-value">{fmtPct(overview.pickRate)}</div>
          </div>
          <div className="dp-kpi">
            <div className="k-label">Win rate</div>
            <div className="k-value">{fmtPct(hero.win_rate)}</div>
          </div>
          <div className="dp-kpi">
            <div className="k-label">Picks</div>
            <div className="k-value">{fmtInt(hero.picks)}</div>
          </div>
          <div className="dp-kpi">
            <div className="k-label">Record</div>
            <div className="k-value">
              {fmtInt(hero.wins)}W–{fmtInt(hero.losses)}L
            </div>
          </div>
          <div className="dp-kpi">
            <div className="k-label">Avg KDA</div>
            <div className="k-value">{fmtNum(overview.avgKda)}</div>
          </div>
          <div className="dp-kpi">
            <div className="k-label">Radiant / Dire picks</div>
            <div className="k-value">
              {hero.radiant_picks === undefined ? "—" : `${fmtInt(hero.radiant_picks)} / ${fmtInt(hero.dire_picks)}`}
            </div>
          </div>
          {hero.contested !== undefined ? (
            <div className="dp-kpi">
              <div className="k-label">Contested</div>
              <div className="k-value">{fmtInt(hero.contested)}</div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="dp-section">
        <h2 className="dp-title">Used by</h2>
        {users.length === 0 ? (
          <p className="dp-empty">No player has picked this hero yet.</p>
        ) : (
          <div className="board-focus-rows">
            {users.map((user) => (
              <div className="dp-hero-row" key={user.playerId}>
                <PlayerAvatar id={user.playerId} />
                <div className="dp-hero-info">
                  <PlayerName id={user.playerId} className="h-name" />
                  <div className="h-sub">
                    {fmtCount(user.matches, "match")} · {fmtInt(user.wins)}W–{fmtInt(user.losses)}L · {fmtNum(user.kda)} KDA
                  </div>
                  <Bar pct={Number(user.win_rate) || 0} gold={Number(user.win_rate) >= 50} />
                </div>
                <div className={`dp-hero-val ${Number(user.win_rate) >= 50 ? "win" : "loss"}`}>{fmtPct(user.win_rate)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {matchesQuery.isPending ? (
        <section className="dp-section">
          <p className="dp-empty">Loading match history...</p>
        </section>
      ) : null}
      {!matchesQuery.isPending && !matchesQuery.data ? (
        <section className="dp-section">
          <p className="dp-empty">Per-match history is not published for this deployment yet.</p>
        </section>
      ) : null}

      {rows.length > 0 ? (
        <>
          <section className="dp-section">
            <h2 className="dp-title">Win rate by side</h2>
            <SplitRows splits={sides} />
          </section>

          <section className="dp-section">
            <h2 className="dp-title">Win rate by game length</h2>
            <SplitRows splits={lengths} />
          </section>

          {items.length > 0 ? (
            <section className="dp-section">
              <h2 className="dp-title">Most built items</h2>
              <div className="board-focus-rows">
                {items.map((entry) => (
                  <div className="dp-hero-row" key={entry.item}>
                    <img className="hd-item" src={itemImageUrl(entry.item)} alt="" loading="lazy" decoding="async" />
                    <div className="dp-hero-info">
                      <div className="h-name">{itemLabel(entry.item)}</div>
                      <div className="h-sub">
                        {fmtPct(entry.usage)} of games · {fmtCount(entry.games, "game")}
                      </div>
                      <Bar pct={entry.usage} />
                    </div>
                    <div className={`dp-hero-val ${entry.winRate >= 50 ? "win" : "loss"}`}>{fmtPct(entry.winRate)}</div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="dp-section profile-history">
            <h2 className="dp-title">Recent appearances</h2>
            <div className="board-badges">
              <Badge label={fmtCount(history.total, "published match", "published matches")} />
              <Badge label={`${fmtInt(history.wins)}W–${fmtInt(history.losses)}L`} />
            </div>
            <div className="match-list">
              {appearances.pageItems.map((entry) => {
                const played = entry.players[0];
                const who = played.account_id ? playerName(stats, played.account_id) : played.player_name ?? "Anonymous";
                return (
                  <Link
                    to="/matches/$matchId"
                    params={{ matchId: entry.match.match_id }}
                    className="match-row"
                    key={`${entry.match.match_id}-${played.account_id ?? who}`}
                  >
                    <span className="match-date">{fmtEpochDate(entry.match.start_time)}</span>
                    <Avatar heroId={hero.hero_id} name={name} size="sm" />
                    <div className="match-main">
                      <span className="match-title">{who}</span>
                      <span className="match-sub">
                        {fmtDuration(entry.match.duration)} · #{entry.match.match_id}
                      </span>
                    </div>
                    <span className="match-kda">
                      {fmtInt(played.kills)} / {fmtInt(played.deaths)} / {fmtInt(played.assists)}
                    </span>
                    <span className={`match-result ${entry.win ? "win" : "loss"}`}>{entry.win ? "W" : "L"}</span>
                  </Link>
                );
              })}
            </div>
            <Pager {...appearances} label="Recent appearances pages" />
          </section>
        </>
      ) : null}
    </>
  );
}
