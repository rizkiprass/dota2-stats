import { useEffect } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Avatar, Badge, Icon, PlayerName, type IconName } from "./ui";
import { fmtDuration, fmtInt, fmtNum, fmtPct } from "../lib/format";
import { heroName } from "../lib/derived";
import { groupPurchases, itemImageUrl, itemLabel } from "../lib/items";
import { useDashboard } from "../lib/dashboard-context";
import { useMatches } from "../lib/api";
import { formatDayLabel, formatTime } from "../lib/match-calendar";
import type { MatchPlayerRecord, MatchRecord } from "../types/stats";

interface TeamStats {
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
}

function total(players: MatchPlayerRecord[], field: "kills" | "deaths" | "assists"): number {
  return players.reduce((sum, player) => sum + (Number(player[field]) || 0), 0);
}

function kda(player: Pick<MatchPlayerRecord, "kills" | "deaths" | "assists">): number {
  return ((Number(player.kills) || 0) + (Number(player.assists) || 0)) / Math.max(Number(player.deaths) || 0, 1);
}

function teamStats(players: MatchPlayerRecord[]): TeamStats {
  const kills = total(players, "kills");
  const deaths = total(players, "deaths");
  const assists = total(players, "assists");
  return { kills, deaths, assists, kda: (kills + assists) / Math.max(deaths, 1) };
}

function leader(players: MatchPlayerRecord[], metric: (player: MatchPlayerRecord) => number): MatchPlayerRecord {
  return players.reduce((best, player) => (metric(player) > metric(best) ? player : best));
}

export function MatchDetail() {
  const { matchId } = useParams({ from: "/matches/$matchId" });
  const { data, isPending, isError } = useMatches();
  const match = data?.matches.find((entry) => entry.match_id === matchId);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => window.cancelAnimationFrame(frame);
  }, [matchId]);

  return (
    <main className="wrap">
      <div className="mh-page match-detail-page">
        <Link to="/matches" className="back-link">← Back to match history</Link>
        {isPending ? <div className="card"><p className="dp-empty">Loading match details…</p></div> : null}
        {!isPending && (isError || !data) ? (
          <div className="card"><div className="empty-state"><strong>Match details aren’t published yet</strong><span>The per-match payload is needed to open an individual lobby.</span></div></div>
        ) : null}
        {!isPending && data && !match ? (
          <div className="card"><div className="empty-state"><strong>Match not found</strong><span>This lobby may be older than the published match-history limit.</span></div></div>
        ) : null}
        {match ? <MatchDetailContent match={match} /> : null}
      </div>
    </main>
  );
}

function PlayerItems({ items }: { items: MatchPlayerRecord["items"] }) {
  const purchases = groupPurchases(items);
  if (purchases.length === 0) return null;
  return (
    <div className="match-detail-items" aria-label="Purchased items">
      {purchases.map(({ item, count, firstTime }) => {
        const label = itemLabel(item);
        const minute = Math.floor(firstTime / 60);
        return (
          <span className="match-item" key={item} title={`${label} · ${minute < 0 ? "pre-game" : `${minute}m`}${count > 1 ? ` · bought ×${count}` : ""}`}>
            <img
              src={itemImageUrl(item)}
              alt={label}
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.display = "none";
                event.currentTarget.nextElementSibling?.removeAttribute("hidden");
              }}
            />
            <small className="match-item-fallback" hidden>{label}</small>
            {count > 1 ? <b>×{count}</b> : null}
          </span>
        );
      })}
    </div>
  );
}

function MatchDetailContent({ match }: { match: MatchRecord }) {
  const { stats } = useDashboard();
  const radiant = match.players.filter((player) => player.team === "radiant");
  const dire = match.players.filter((player) => player.team === "dire");
  const radiantStats = teamStats(radiant);
  const direStats = teamStats(dire);
  const totalKills = radiantStats.kills + direStats.kills;
  const minutes = Math.max(match.duration / 60, 1);
  const awards = [
    { label: "Most kills", icon: "swords" as IconName, player: leader(match.players, (player) => Number(player.kills) || 0), value: (player: MatchPlayerRecord) => `${fmtInt(player.kills)} kills` },
    { label: "Most assists", icon: "users" as IconName, player: leader(match.players, (player) => Number(player.assists) || 0), value: (player: MatchPlayerRecord) => `${fmtInt(player.assists)} assists` },
    { label: "Best KDA", icon: "sparkles" as IconName, player: leader(match.players, kda), value: (player: MatchPlayerRecord) => `${fmtNum(kda(player))} KDA` },
    { label: "Fewest deaths", icon: "shield" as IconName, player: leader(match.players, (player) => -(Number(player.deaths) || 0)), value: (player: MatchPlayerRecord) => `${fmtInt(player.deaths)} deaths` },
  ];
  const comparisons = [
    { label: "Kills", radiant: radiantStats.kills, dire: direStats.kills, format: fmtInt },
    { label: "Deaths", radiant: radiantStats.deaths, dire: direStats.deaths, format: fmtInt },
    { label: "Assists", radiant: radiantStats.assists, dire: direStats.assists, format: fmtInt },
    { label: "Team KDA", radiant: radiantStats.kda, dire: direStats.kda, format: fmtNum },
  ];

  return (
    <>
      <div className="board-head match-detail-title">
        <h1 className="board-title">{formatDayLabel(match.start_time)}</h1>
        <p className="board-blurb">{formatTime(match.start_time)} · {fmtDuration(match.duration)} · Match #{match.match_id}</p>
      </div>

      <section className={`match-detail-hero winner-${match.radiant_win ? "r" : "d"}`} aria-label={`Radiant ${radiantStats.kills}, Dire ${direStats.kills}. ${match.radiant_win ? "Radiant" : "Dire"} won.`}>
        <div className="match-hero-team r"><span>Radiant</span><strong>{fmtInt(radiantStats.kills)}</strong></div>
        <div className="match-hero-center"><Badge label={match.radiant_win ? "Radiant victory" : "Dire victory"} tone={match.radiant_win ? "b1" : "b2"} /><span className="match-hero-vs">VS</span><span className="match-hero-meta">{fmtDuration(match.duration)} · {fmtInt(totalKills)} total kills</span></div>
        <div className="match-hero-team d"><span>Dire</span><strong>{fmtInt(direStats.kills)}</strong></div>
      </section>

      <section className="match-detail-overview" aria-label="Match statistics">
        <div className="match-detail-kpi"><span>Total kills</span><strong>{fmtInt(totalKills)}</strong></div>
        <div className="match-detail-kpi"><span>Match pace</span><strong>{fmtNum(totalKills / minutes, 1)} <small>kills/min</small></strong></div>
        <div className="match-detail-kpi"><span>Duration</span><strong>{fmtDuration(match.duration)}</strong></div>
      </section>

      <article className="match-detail-card">
        <section className="match-detail-comparison" aria-labelledby="team-comparison-title">
          <div className="match-detail-section-heading"><h2 id="team-comparison-title" className="match-detail-section-title">Team comparison</h2><span>Radiant <i aria-hidden="true">vs</i> Dire</span></div>
          <div className="match-detail-comparison-bars">
            {comparisons.map((comparison) => {
              const max = Math.max(comparison.radiant, comparison.dire, 1);
              return (
                <div className="match-detail-comparison-row" key={comparison.label}>
                  <div className="match-detail-comparison-side r"><strong>{comparison.format(comparison.radiant)}</strong><span><i style={{ width: `${(comparison.radiant / max) * 100}%` }} /></span></div>
                  <span className="match-detail-measure">{comparison.label}</span>
                  <div className="match-detail-comparison-side d"><span><i style={{ width: `${(comparison.dire / max) * 100}%` }} /></span><strong>{comparison.format(comparison.dire)}</strong></div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="match-detail-awards" aria-labelledby="match-awards-title">
          <h2 id="match-awards-title" className="match-detail-section-title">Match awards</h2>
          <div className="match-detail-award-list">
            {awards.map((award) => {
              const hero = award.player.hero_name ?? heroName(stats, award.player.hero_id);
              return (
                <div className="match-detail-award" key={award.label}>
                  <span className="match-detail-award-icon"><Icon name={award.icon} /></span>
                  <Avatar heroId={Number(award.player.hero_id) || null} name={hero} />
                  <span><b>{award.label}</b><strong>{award.player.player_name ?? hero}</strong><small>{hero} · {award.value(award.player)}</small></span>
                </div>
              );
            })}
          </div>
        </section>

        <h2 className="match-detail-section-title match-detail-scoreboard-title">Scoreboard</h2>
        <div className="match-detail-lineups">
          <DetailLineup label="Radiant" side="r" players={radiant} stats={radiantStats} />
          <DetailLineup label="Dire" side="d" players={dire} stats={direStats} />
        </div>
      </article>
    </>
  );

  function DetailLineup({ label, side, players, stats: sideStats }: { label: "Radiant" | "Dire"; side: "r" | "d"; players: MatchPlayerRecord[]; stats: TeamStats }) {
    return (
      <section className={`match-detail-side ${side}`}>
        <h2 className={`match-detail-side-title ${side}`}><i className={`mc-dot ${side}`} aria-hidden="true" />{label}</h2>
        {players.map((player, index) => {
          const hero = player.hero_name ?? heroName(stats, player.hero_id);
          return (
            <div className="dp-hero-row match-detail-player" key={`${player.account_id ?? "anon"}-${index}`}>
              <Avatar heroId={Number(player.hero_id) || null} name={hero} />
              <div className="dp-hero-info"><div className="h-name">{player.account_id ? <PlayerName id={player.account_id} /> : player.player_name ?? "Anonymous"}</div><div className="h-sub">{hero}</div></div>
              <div className="match-detail-player-metrics"><span><b>K/D/A</b>{fmtInt(player.kills)}/{fmtInt(player.deaths)}/{fmtInt(player.assists)}</span><span><b>KDA</b>{fmtNum(kda(player))}</span><span><b>Kill</b>{fmtPct(((Number(player.kills) || 0) / Math.max(sideStats.kills, 1)) * 100)}</span><span><b>Assist</b>{fmtPct(((Number(player.assists) || 0) / Math.max(sideStats.assists, 1)) * 100)}</span></div>
              <PlayerItems items={player.items} />
            </div>
          );
        })}
      </section>
    );
  }
}
