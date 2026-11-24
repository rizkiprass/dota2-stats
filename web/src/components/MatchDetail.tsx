import { useEffect, useState, useMemo } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Avatar, Badge, HeroLink, Icon, PlayerName, type IconName } from "./ui";
import { fmtCell, fmtDuration, fmtInt, fmtK, fmtNum } from "../lib/format";
import { heroName } from "../lib/derived";
import { heroPortraitUrl } from "../lib/heroes";
import { itemImageUrl, itemLabel } from "../lib/items";
import { useDashboard } from "../lib/dashboard-context";
import { useMatches } from "../lib/api";
import { formatDayLabel, formatTime } from "../lib/match-calendar";
import type { MatchPlayerRecord, MatchRecord } from "../types/stats";
import { MatchAnalysis } from "./MatchAnalysis";

interface TeamStats {
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  damage: {
    hero: number;
    building: number;
  }
}

type NumericField = "kills" | "deaths" | "assists" | "net_worth" | "last_hits" | "denies" | "hero_damage" | "tower_damage";

function total(players: MatchPlayerRecord[], field: NumericField): number {
  return players.reduce((sum, player) => sum + (Number(player[field]) || 0), 0);
}

/** Team column total, or null when no player has the figure (older replays). */
function totalOrNull(players: MatchPlayerRecord[], field: NumericField): number | null {
  return players.some((player) => typeof player[field] === "number") ? total(players, field) : null;
}

function kda(player: Pick<MatchPlayerRecord, "kills" | "deaths" | "assists">): number {
  return ((Number(player.kills) || 0) + (Number(player.assists) || 0)) / Math.max(Number(player.deaths) || 0, 1);
}

function teamStats(players: MatchPlayerRecord[]): TeamStats {
  const kills = total(players, "kills");
  const deaths = total(players, "deaths");
  const assists = total(players, "assists");
  return {
    kills, deaths, assists,
    kda: (kills + assists) / Math.max(deaths, 1),
    damage: {
      hero: total(players, 'hero_damage'),
      building: total(players, 'tower_damage'),
    }
  };
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

function ItemSlot({ item, neutral = false }: { item: string | null | undefined; neutral?: boolean }) {
  const kind = neutral ? "match-item match-item-neutral" : "match-item";
  if (!item) return <span className={`${kind} match-item-empty`} aria-hidden="true" />;
  const label = itemLabel(item);
  return (
    <span className={kind} title={neutral ? `${label} · neutral` : label}>
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
    </span>
  );
}

/** Wide hero portrait for scoreboard rows; falls back to the round avatar when the art is missing. */
function HeroPortrait({ heroId, name }: { heroId: number | string | null | undefined; name: string }) {
  const url = heroPortraitUrl(heroId);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return <Avatar heroId={Number(heroId) || null} name={name} />;
  return <img className="match-hero-portrait" src={url} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function PlayerItems({ items, neutral }: { items: MatchPlayerRecord["final_items"]; neutral: MatchPlayerRecord["neutral_item"] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="match-detail-items" aria-label="Final items">
      {Array.from({ length: 6 }, (_, index) => <ItemSlot item={items[index]} key={index} />)}
      <ItemSlot item={neutral} neutral />
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

  // console.log({ radiantStats, direStats })
  const comparisons = [
    { label: "Kills", radiant: radiantStats.kills, dire: direStats.kills, format: fmtInt },
    { label: "Deaths", radiant: radiantStats.deaths, dire: direStats.deaths, format: fmtInt },
    { label: "Assists", radiant: radiantStats.assists, dire: direStats.assists, format: fmtInt },
    { label: "Team KDA", radiant: radiantStats.kda, dire: direStats.kda, format: fmtNum },
    { label: "Damage", radiant: radiantStats.damage.hero, dire: direStats.damage.hero, format: fmtInt }
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

      <MatchAnalysis key={match.match_id} matchId={match.match_id} radiantWin={match.radiant_win} />

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
            {awards.map((award) => <DetailAward2 key={award.label} award={award} match={match} />)}
          </div>
        </section>

        <h2 className="match-detail-section-title match-detail-scoreboard-title">Scoreboard</h2>
        <div className="match-detail-lineups">
          <DetailLineup label="Radiant" side="r" players={radiant} teamStats={radiantStats} won={match.radiant_win} stats={stats} />
          <DetailLineup label="Dire" side="d" players={dire} teamStats={direStats} won={!match.radiant_win} stats={stats} />
        </div>
      </article>
    </>
  );
}

interface MatchAward {
  label: string
  description?: string;
  icon?: IconName
  player(match: MatchRecord): MatchPlayerRecord
  value(player: MatchPlayerRecord): string
}

const awards: MatchAward[] = [
  {
    label: "Reaper",
    description: "Most Kills",
    // icon: "swords",
    player: match => leader(match.players, (player) => Number(player.kills) || 0),
    value: (player: MatchPlayerRecord) => `${fmtInt(player.kills)} kills`
  },
  {
    label: "Wingman",
    description: "Most Assists",
    // icon: "users",
    player: match => leader(match.players, (player) => Number(player.assists) || 0),
    value: (player: MatchPlayerRecord) => `${fmtInt(player.assists)} assists`
  },
  {
    label: "Untouchable",
    description: "Most KDA",
    // icon: "sparkles",
    player: match => leader(match.players, kda),
    value: (player: MatchPlayerRecord) => `${fmtNum(kda(player))} KDA`
  },
  {
    label: "Survivor",
    description: "Fewest Deaths",
    // icon: "shield",
    player: match => leader(match.players, (player) => -(Number(player.deaths) || 0)),
    value: (player: MatchPlayerRecord) => `${fmtInt(player.deaths)} deaths`
  },
  {
    label: "Wrecking Ball",
    description: "Most Hero DMG",
    player: match => leader(match.players, p => p.hero_damage || 0),
    value: (player: MatchPlayerRecord) => `${fmtInt(player.hero_damage)} damage`
  },
  {
    label: "The Richest",
    description: "Most Networth",
    player: match => leader(match.players, p => p.net_worth || 0),
    value: p => `${fmtK(p.net_worth)} Networth`
  }
]

function DetailAward2({ award, match }: { award: MatchAward; match: MatchRecord }) {
  const { stats } = useDashboard();
  const player = useMemo(() => award.player(match), [award, match]);
  const hero = useMemo(() => player.hero_name ?? heroName(stats, player.hero_id), [stats, player.hero_name, player.hero_id]);
  const portrait = heroPortraitUrl(player.hero_id);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [portrait]);

  return (
    <div className="match-award-card" title={award.description}>
      {portrait && !failed ? (
        <img className="match-award-bg" src={portrait} alt="" aria-hidden="true" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : null}
      <div className="match-award-body">
        <b>{award.icon ? <Icon name={award.icon} /> : null}{award.label}</b>
        <strong>{player.player_name ?? hero}</strong>
        <small>
          {/*<HeroLink id={player.hero_id} name={hero}>{hero}</HeroLink> ·*/}
          {award.value(player)}
        </small>
      </div>
    </div>
  );
}

function DetailLineup({ label, side, players, teamStats: sideStats, won, stats }: { label: "Radiant" | "Dire"; side: "r" | "d"; players: MatchPlayerRecord[]; teamStats: TeamStats; won: boolean; stats: ReturnType<typeof useDashboard>["stats"] }) {
  return (
    <section className={`match-detail-side ${side}`}>
      <h2 className={`match-detail-side-title ${side} `}><i className={`mc-dot ${side}`} aria-hidden="true" />{label}{won ? <Badge label="Victory" tone={side === "r" ? "b1" : "b2"} /> : null}</h2>
      <div className="match-detail-table-wrap">
        <table className="match-detail-table">
          <thead>
            <tr>
              <th scope="col" rowSpan={2} className="col-hero">Hero</th>
              <th scope="col" rowSpan={2} className="col-player">Player</th>
              <th scope="col" rowSpan={2}>K</th>
              <th scope="col" rowSpan={2}>D</th>
              <th scope="col" rowSpan={2}>A</th>
              <th scope="col" rowSpan={2} title="Net worth">NET</th>
              <th scope="col" rowSpan={2} title="Last hits">LH</th>
              <th scope="col" rowSpan={2} title="Denies">DN</th>
              <th scope="colgroup" colSpan={2} className="col-group">DMG</th>
              <th scope="col" rowSpan={2} className="col-items">Items</th>
            </tr>
            <tr>
              <th scope="col" className="col-sub" title="Hero damage">HERO</th>
              <th scope="col" className="col-sub" title="Building damage">BLD</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player, index) => {
              const hero = player.hero_name ?? heroName(stats, player.hero_id);
              return (
                <tr key={`${player.account_id ?? "anon"} -${index}`}>
                  <td className="col-hero"><HeroLink id={player.hero_id} name={hero}><HeroPortrait heroId={player.hero_id} name={hero} /></HeroLink></td>
                  <td className="col-player"><div className="h-name">{player.account_id ? <PlayerName id={player.account_id} /> : player.player_name ?? "Anonymous"}</div><div className="h-sub"><HeroLink id={player.hero_id} name={hero}>{hero}</HeroLink></div></td>
                  <td>{fmtInt(player.kills)}</td>
                  <td>{fmtInt(player.deaths)}</td>
                  <td>{fmtInt(player.assists)}</td>
                  <td>
                    <span title={`${total(players, "net_worth") || 0} NET`}>
                      {fmtK(player.net_worth)}
                    </span>
                  </td>
                  <td>{fmtCell(player.last_hits)}</td>
                  <td>{fmtCell(player.denies)}</td>
                  <td>
                    <span title={`Damage done to hero - ${total(players, "hero_damage") || 0}`}>
                      {fmtK(player.hero_damage)}
                    </span>
                  </td>
                  <td>
                    <span title={`Damage done to building ${total(players, "tower_damage") || 0}`}>
                      {fmtK(player.tower_damage)}
                    </span>
                  </td>
                  <td className="col-items"><PlayerItems items={player.final_items} neutral={player.neutral_item} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2} className="col-player">Team total</th>
              <td>{fmtInt(sideStats.kills)}</td>
              <td>{fmtInt(sideStats.deaths)}</td>
              <td>{fmtInt(sideStats.assists)}</td>
              <td>{fmtK(totalOrNull(players, "net_worth"))}</td>
              <td>{fmtCell(totalOrNull(players, "last_hits"))}</td>
              <td>{fmtCell(totalOrNull(players, "denies"))}</td>
              <td>{fmtK(totalOrNull(players, "hero_damage"))}</td>
              <td>{fmtK(totalOrNull(players, "tower_damage"))}</td>
              <td className="col-items" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
