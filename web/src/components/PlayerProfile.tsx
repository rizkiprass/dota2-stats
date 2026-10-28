import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Avatar, Badge, Bar, Icon, PlayerAvatar, PlayerName } from "./ui";
import { ActivityRadar } from "./ActivityRadar";
import { useMatches } from "../lib/api";
import { fmtCount, fmtDuration, fmtEpochDate, fmtInt, fmtNum, fmtPct } from "../lib/format";
import { playerMatchRows, summarize } from "../lib/matches";
import {
  average,
  bestDuoFor,
  computeBadges,
  heroName,
  heroPoolSize,
  lobbyIds,
  metricValues,
  playerName,
  playerTopHero,
  rankOf,
  rivalriesFor,
  type DuoRef,
  type PlayerMetric,
  type RadarAxis,
} from "../lib/derived";
import { useDashboard } from "../lib/dashboard-context";
import { PlayerActivity } from "./Behavior";
import { heroPortraitUrl } from "../lib/heroes";

export function PlayerProfile() {
  const { stats } = useDashboard();
  const { playerId: id } = useParams({ from: "/player/$playerId" });
  return (
    <main className="wrap">
      <div className="player-page">
        <Link to="/" className="back-link">
          ← Back to dashboard
        </Link>
        {stats.players[id] ? (
          <PlayerProfileContent id={id} />
        ) : (
          <p className="dp-empty">Player {id} not found.</p>
        )}
      </div>
    </main>
  );
}

type HeroRec = { heroId: number; matches: number; wins: number; losses: number; win_rate: number };

function HeroCard({ rec, name, signature }: { rec: HeroRec; name: string; signature: boolean }) {
  const url = heroPortraitUrl(rec.heroId);
  return (
    <div className="hero-card">
      {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : null}
      <div className="hc-body">
        <div className="hc-top">
          <span className="h-name">{name}</span>
          <span className={`hp-val ${Number(rec.win_rate) >= 50 ? "win" : "loss"}`}>{fmtPct(rec.win_rate)}</span>
        </div>
        <div className="h-sub" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>
            {fmtCount(rec.matches, "match")} · {fmtInt(rec.wins)}W–{fmtInt(rec.losses)}L
          </span>
          {signature ? <span className="hc-signature">Signature Hero</span> : null}
        </div>
      </div>
    </div>
  );
}

function HeroPoolDialog({
  heroes,
  onClose,
}: {
  heroes: Array<{ rec: HeroRec; name: string; signature: boolean }>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="role-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="role-modal hero-pool-dialog" role="dialog" aria-modal="true" aria-labelledby="hero-pool-title">
        <header className="role-modal-header">
          <div>
            <h2 id="hero-pool-title">All heroes played</h2>
            <span>{heroes.length} heroes</span>
          </div>
          <button type="button" className="role-modal-close" onClick={onClose} aria-label="Close hero pool"><Icon name="close" /></button>
        </header>
        <div className="hero-pool-grid">
          {heroes.map(({ rec, name, signature }) => (
            <HeroCard key={rec.heroId} rec={rec} name={name} signature={signature} />
          ))}
        </div>
      </section>
    </div>
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function PlayerProfileContent({ id }: { id: string }) {
  const { stats } = useDashboard();
  const player = stats.players[id];
  const matchesQuery = useMatches();
  const recentMatches = useMemo(() => playerMatchRows(matchesQuery.data, id), [matchesQuery.data, id]);
  const recentSummary = useMemo(() => summarize(recentMatches), [recentMatches]);
  const badges = computeBadges(stats, id);
  const [showAllHeroes, setShowAllHeroes] = useState(false);

  const totalKills = metricValues(stats, "kills").reduce((sum, value) => sum + value, 0);
  const killsShare = totalKills ? (Number(player.kills) / totalKills) * 100 : 0;

  const heroRecs = Object.entries(stats.player_heroes?.[id] || {})
    .map(([heroId, rec]) => ({ heroId: Number(heroId), ...rec }))
    .sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate);
  const qualified = heroRecs.filter((rec) => rec.matches >= 3);
  const bestHero = qualified.slice().sort((a, b) => b.win_rate - a.win_rate)[0];
  const worstHero = qualified.slice().sort((a, b) => a.win_rate - b.win_rate)[0];

  const duo = bestDuoFor(stats, id);
  const rivals = rivalriesFor(stats, id);
  const nemesis = rivals.filter((r) => r.matches >= 3).sort((a, b) => a.win_rate - b.win_rate)[0] ?? null;
  const mostRival = rivals.slice().sort((a, b) => b.matches - a.matches)[0] ?? null;

  const heroPools = lobbyIds(stats).map((pid) => heroPoolSize(stats, pid));
  const axisData: Array<[string, number, number, number]> = [
    ["Win Rate", Number(player.win_rate) || 0, average(metricValues(stats, "win_rate")), 100],
    ["KDA", Number(player.kda) || 0, average(metricValues(stats, "kda")), Math.max(...metricValues(stats, "kda"), 0)],
    ["Kills", Number(player.kills) || 0, average(metricValues(stats, "kills")), Math.max(...metricValues(stats, "kills"), 0)],
    ["Assists", Number(player.assists) || 0, average(metricValues(stats, "assists")), Math.max(...metricValues(stats, "assists"), 0)],
    ["Matches", Number(player.matches) || 0, average(metricValues(stats, "matches")), Math.max(...metricValues(stats, "matches"), 0)],
    ["Hero Pool", heroPoolSize(stats, id), average(heroPools), Math.max(...heroPools, 0)],
  ];
  const axes: RadarAxis[] = axisData.map(([label, value, avg, max]) => ({
    label,
    norm: max > 0 ? clamp01(value / max) : 0,
    avgNorm: max > 0 ? clamp01(avg / max) : 0,
  }));

  const rankSpecs: Array<[string, PlayerMetric, (v: number) => string]> = [
    ["Win Rate", "win_rate", fmtPct],
    ["KDA", "kda", (v) => fmtNum(v)],
    ["Kills", "kills", fmtInt],
    ["Assists", "assists", fmtInt],
    ["Matches", "matches", fmtInt],
  ];

  const socialRows: Array<{ other: string; label: string; rec: DuoRef }> = [];
  if (duo.best) socialRows.push({ other: duo.best.other, label: "Best duo", rec: duo.best });
  if (duo.most && (!duo.best || duo.most.other !== duo.best.other)) {
    socialRows.push({ other: duo.most.other, label: "Most played with", rec: duo.most });
  }
  if (nemesis) socialRows.push({ other: nemesis.other, label: "Nemesis", rec: nemesis });
  if (mostRival && (!nemesis || mostRival.other !== nemesis.other)) {
    socialRows.push({ other: mostRival.other, label: "Most faced", rec: mostRival });
  }

  const kpiData: Array<[string, string]> = [
    ["Matches", fmtInt(player.matches)],
    ["Win Rate", fmtPct(player.win_rate)],
    ["KDA", fmtNum(player.kda)],
    ["Avg K / D / A", `${fmtNum(player.avg_kills, 1)} / ${fmtNum(player.avg_deaths, 1)} / ${fmtNum(player.avg_assists, 1)}`],
    ["Total K / D / A", `${fmtInt(player.kills)} / ${fmtInt(player.deaths)} / ${fmtInt(player.assists)}`],
    ["Kill share", fmtPct(killsShare)],
  ];

  return (
    <>
      <div className="dp-head">
        <Avatar heroId={playerTopHero(stats, id)} name={playerName(stats, id)} size="lg" />
        <div>
          <h1 className="dp-name">{playerName(stats, id)}</h1>
          <div className="dp-id">Account {id}</div>
        </div>
      </div>

      {badges.length > 0 && (
        <div className="dp-badges">
          {badges.map(([label, tone, description]) => (
            <Badge key={label} label={label} tone={tone} description={description} />
          ))}
        </div>
      )}

      <div className="dp-summary">
        <span className="big">{fmtPct(player.win_rate)}</span>
        <span className="sub">
          {fmtCount(player.matches, "match")} · {fmtInt(player.wins)}W–{fmtInt(player.losses)}L
        </span>
      </div>

      <section className="dp-section">
        <h2 className="dp-title">Performance</h2>
        <div className="dp-kpis">
          {kpiData.map(([label, value]) => (
            <div className="dp-kpi" key={label}>
              <div className="k-label">{label}</div>
              <div className="k-value">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <PlayerActivity stats={stats} playerId={id} />

      <section className="dp-section">
        <h2 className="dp-title">Lobby ranking</h2>
        {rankSpecs.map(([label, key, fmt]) => {
          const value = Number(player[key]) || 0;
          const { rank, total } = rankOf(stats, key, value);
          const max = Math.max(...metricValues(stats, key), 1);
          return (
            <div className="dp-rank-row" key={key}>
              <div className="dp-rank-label">{label}</div>
              <Bar pct={(value / max) * 100} />
              <div className="dp-rank-pos">
                <span className="v">{fmt(value)}</span>
                <span className="r">
                  #{rank} of {total}
                </span>
              </div>
            </div>
          );
        })}
      </section>

      <section className="dp-section">
        <h2 className="dp-title">Versus lobby average</h2>
        <ActivityRadar axes={axes} playerLabel={playerName(stats, id)} />
        <div className="dp-legend">
          <span>
            <span className="sw me" />
            {playerName(stats, id)}
          </span>
          <span>
            <span className="sw avg" />
            Lobby average
          </span>
        </div>
      </section>

      <section className="dp-section">
        <h2 className="dp-title">Hero pool</h2>
        <p className="dp-empty">
          {heroRecs.length} hero{heroRecs.length === 1 ? "" : "es"} played
        </p>
        {heroRecs.length === 0 ? (
          <p className="dp-empty">No hero data yet.</p>
        ) : (
          <div className="hero-pool-grid">
            {heroRecs.slice(0, 5).map((rec) => (
              <HeroCard key={rec.heroId} rec={rec} name={heroName(stats, rec.heroId)} signature={rec.heroId === heroRecs[0]?.heroId} />
            ))}
          </div>
        )}
        {heroRecs.length > 5 && (
          <button type="button" className="hero-pool-more" onClick={() => setShowAllHeroes(true)}>
            Show all {heroRecs.length} heroes
          </button>
        )}
        {showAllHeroes && (
          <HeroPoolDialog
            heroes={heroRecs.map((rec) => ({ rec, name: heroName(stats, rec.heroId), signature: rec.heroId === heroRecs[0]?.heroId }))}
            onClose={() => setShowAllHeroes(false)}
          />
        )}
        {qualified.length > 0 && (
          <div className="dp-badges">
            <Badge tone="b3" label={`Best: ${heroName(stats, bestHero.heroId)} · ${fmtPct(bestHero.win_rate)}`} />
            {worstHero.heroId !== bestHero.heroId && (
              <Badge label={`Toughest: ${heroName(stats, worstHero.heroId)} · ${fmtPct(worstHero.win_rate)}`} />
            )}
          </div>
        )}
      </section>

      <section className="dp-section">
        <h2 className="dp-title">Teammates &amp; rivals</h2>
        {socialRows.length === 0 ? (
          <p className="dp-empty">No teammate or rival data yet.</p>
        ) : (
          socialRows.map(({ other, label, rec }) => (
            <div className="dp-social-row" key={`${label}-${other}`}>
              <PlayerAvatar id={other} />
              <div className="dp-social-label">
                <PlayerName id={other} className="s-name" />
                <span className="s-sub">
                  {label} · {fmtInt(rec.matches)} matches · {fmtInt(rec.wins)}W–{fmtInt(rec.losses)}L
                </span>
              </div>
              <div className={`dp-hero-val ${rec.win_rate >= 50 ? "win" : "loss"}`}>{fmtPct(rec.win_rate)}</div>
            </div>
          ))
        )}
      </section>

      <section className="dp-section profile-history">
        <h2 className="dp-title">Recent matches</h2>
        {matchesQuery.isPending ? <p className="dp-empty">Loading match history...</p> : null}
        {!matchesQuery.isPending && !matchesQuery.data ? (
          <p className="dp-empty">Per-match history is not published for this deployment yet.</p>
        ) : null}
        {!matchesQuery.isPending && matchesQuery.data && recentMatches.length === 0 ? (
          <p className="dp-empty">No published matches for this player yet.</p>
        ) : null}
        {recentMatches.length > 0 ? (
          <>
            <div className="board-badges">
              <Badge label={fmtCount(recentSummary.total, "published match")} />
              <Badge label={`${fmtInt(recentSummary.wins)}W–${fmtInt(recentSummary.losses)}L`} />
            </div>
            <div className="match-list">
              {recentMatches.slice(0, 10).map((entry) => {
                const match = entry.match;
                const played = entry.players[0];
                const hero = heroName(stats, played.hero_id);
                return (
                  <Link to="/matches/$matchId" params={{ matchId: match.match_id }} className="match-row" key={match.match_id}>
                    <span className="match-date">{fmtEpochDate(match.start_time)}</span>
                    <Avatar heroId={Number(played.hero_id) || null} name={hero} size="sm" />
                    <div className="match-main">
                      <span className="match-title">{hero}</span>
                      <span className="match-sub">{fmtDuration(match.duration)} · #{match.match_id}</span>
                    </div>
                    <span className="match-kda">{fmtInt(played.kills)} / {fmtInt(played.deaths)} / {fmtInt(played.assists)}</span>
                    <span className={`match-result ${entry.win ? "win" : "loss"}`}>{entry.win ? "W" : "L"}</span>
                  </Link>
                );
              })}
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}
