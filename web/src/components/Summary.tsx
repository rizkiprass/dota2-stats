import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { Tile, Icon, PlayerAvatar, PlayerName, useCountUp } from "./ui";
import { fmtDuration, fmtInt, fmtNum, fmtPct } from "../lib/format";
import { heroCropUrl, heroPortraitUrl } from "../lib/heroes";
import { playerTopHero } from "../lib/derived";
import type { RoleRecord, Stats } from "../types/stats";

const TINTS = ["--av1", "--av2", "--av3", "--av4", "--av1", "--av3"];

function HeroTiles({ stats }: { stats: Stats }) {
  const heroes = Object.values(stats.heroes || {});
  if (!heroes.length) return null;
  const top = [...heroes].sort((a, b) => b.picks - a.picks || b.win_rate - a.win_rate).slice(0, 6);
  const maxPicks = Math.max(...top.map((h) => h.picks), 1);
  return (
    <div className="tiles-row">
      {top.map((hero, i) => {
        const url = heroCropUrl(hero.hero_id);
        const style = { "--tile-accent": `var(${TINTS[i % TINTS.length]})` } as CSSProperties;
        return (
          <div
            className="stat-tile"
            key={hero.hero_id}
            title={`${hero.hero_name} · ${fmtInt(hero.picks)} picks · ${fmtPct(hero.win_rate)} win rate`}
          >
            <div className="st-val">{fmtInt(hero.picks)}</div>
            <div className="st-bar">
              <i style={{ width: `${Math.round((hero.picks / maxPicks) * 100)}%` }} />
            </div>
            <div className="st-img" style={style}>
              {url ? <img src={url} alt={hero.hero_name ?? ""} loading="lazy" decoding="async" /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchesCard({ stats }: { stats: Stats }) {
  const s = stats.summary;
  const totalMatches = useCountUp(s.total_matches);
  return (
    <div className="card kpi">
      <div className="card-head">
        <div>
          <div className="kpi-label">Matches Parsed</div>
          <div className="kpi-value">{fmtInt(Math.round(totalMatches))}</div>
          <div className="kpi-sub">
            across {fmtInt(s.total_players)} players · {fmtInt(s.total_hero_picks)} hero picks
          </div>
        </div>
        <Tile icon="layers" variant="green" />
      </div>
      <HeroTiles stats={stats} />
    </div>
  );
}

function SplitCard({ stats }: { stats: Stats }) {
  const s = stats.summary;
  const radiant = Number(s.radiant_win_rate) || 0;
  const dire = Number(s.dire_win_rate) || 0;
  const animatedRadiant = useCountUp(radiant);
  const animatedDire = useCountUp(dire);
  const radiantWins = useCountUp(s.radiant_wins);
  const direWins = useCountUp(s.dire_wins);
  const lead = radiant >= dire ? "Radiant" : "Dire";
  const gap = Math.abs(radiant - dire);
  return (
    <div className="card kpi split-card">
      <div className="card-head">
        <div>
          <div className="kpi-label">Radiant vs Dire</div>
          <div className="kpi-value">{fmtPct(animatedRadiant)}</div>
          <div className="kpi-sub">
            {fmtInt(Math.round(radiantWins))} Radiant wins · {fmtInt(Math.round(direWins))} Dire wins
          </div>
        </div>
        <Tile icon="scale" variant="gold" />
      </div>
      <div className="splitbar">
        <i className="r" style={{ width: `${radiant}%` }} />
        <i className="d" style={{ width: `${dire}%` }} />
      </div>
      <div className="legend">
        <div className="lg">
          <span className="dot r" />
          <b>{fmtPct(animatedRadiant)}</b>
          <span>Radiant · {fmtInt(Math.round(radiantWins))}</span>
        </div>
        <div className="lg right">
          <span>Dire · {fmtInt(Math.round(direWins))}</span>
          <b>{fmtPct(animatedDire)}</b>
          <span className="dot d" />
        </div>
      </div>
      <div className={`delta${gap < 1 ? " neutral" : ""}`}>
        <span className="delta-icon">
          <Icon name="check" />
        </span>
        <span>{gap < 1 ? "Win rates are evenly split" : `${lead} favoured by ${fmtNum(gap, 1)} pts over even`}</span>
      </div>
    </div>
  );
}

function GlanceCard({ stats }: { stats: Stats }) {
  const s = stats.summary;
  const totalPlayers = useCountUp(s.total_players);
  const totalHeroPicks = useCountUp(s.total_hero_picks);
  const rows: Array<["users" | "sparkles" | "clock", string, string]> = [
    ["users", "Total Players", fmtInt(Math.round(totalPlayers))],
    ["sparkles", "Total Hero Picks", fmtInt(Math.round(totalHeroPicks))],
    ["clock", "Average Duration", fmtDuration(s.average_duration_seconds)],
  ];
  return (
    <div className="card kpi">
      <div className="card-head">
        <div className="kpi-label">At a glance</div>
        <Tile icon="users" />
      </div>
      <div className="stat-rows">
        {rows.map(([icon, label, value]) => (
          <div className="stat-row" key={label}>
            <Tile icon={icon} variant="sm" />
            <div className="sr-label">{label}</div>
            <div className="sr-value">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpotLightHero({ stats }: { stats: Stats }) {
  const heroes = Object.values(stats.heroes || {});
  const hero = heroes.length ? [...heroes].sort((a, b) => b.picks - a.picks || b.win_rate - a.win_rate)[0] : null;
  const art = hero ? heroPortraitUrl(hero.hero_id) ?? heroCropUrl(hero.hero_id) : null;
  const picks = useCountUp(hero?.picks ?? 0);
  const winRate = useCountUp(hero ? Number(hero.win_rate) || 0 : 0);
  if (!hero) return null;
  return (
    <div className="card spotlight-card">
      {art ? <div className="spotlight-art" style={{ backgroundImage: `url(${art})` }} aria-hidden="true" /> : null}
      <div className="spotlight-body">
        <p className="spotlight-eyebrow">Most picked hero</p>
        <h3 className="spotlight-name">{hero.hero_name ?? `Hero ${hero.hero_id}`}</h3>
        <div className="spotlight-stats">
          <div className="spotlight-stat">
            <span className="sv">{fmtInt(Math.round(picks))}</span>
            <span className="sl">picks</span>
          </div>
          <div className="spotlight-stat">
            <span className="sv">{fmtPct(winRate)}</span>
            <span className="sl">win rate</span>
          </div>
          <div className="spotlight-stat">
            <span className="sv">{fmtInt(hero.wins)}–{fmtInt(hero.losses)}</span>
            <span className="sl">W–L</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerOfTheLobby({ stats }: { stats: Stats }) {
  const players = Object.entries(stats.players).map(([id, record]) => ({ id, ...record }));
  const eligible = players.filter((player) => player.matches >= 2);
  const pool = eligible.length ? eligible : players;
  const mvp = pool.length ? [...pool].sort((a, b) => b.kda - a.kda || b.win_rate - a.win_rate)[0] : null;
  const kda = useCountUp(mvp ? Number(mvp.kda) || 0 : 0);
  const winRate = useCountUp(mvp ? Number(mvp.win_rate) || 0 : 0);
  const matches = useCountUp(mvp?.matches ?? 0);
  if (!mvp) return null;
  return (
    <div className="card mvp-card">
      <p className="spotlight-eyebrow">Player of the lobby</p>
      <div className="mvp-head">
        <PlayerAvatar id={mvp.id} size="lg" />
        <div className="mvp-who">
          <PlayerName id={mvp.id} className="mvp-name" />
          <span className="mvp-sub">{fmtInt(mvp.matches)} matches · {fmtInt(mvp.kills)} K / {fmtInt(mvp.deaths)} D / {fmtInt(mvp.assists)} A</span>
        </div>
      </div>
      <div className="mvp-body">
        <div className="mvp-stat">
          <div className="mv">{fmtNum(kda)}</div>
          <div className="ml">KDA</div>
        </div>
        <div className="mvp-stat">
          <div className="mv">{fmtPct(winRate)}</div>
          <div className="ml">win rate</div>
        </div>
        <div className="mvp-stat">
          <div className="mv">{fmtInt(Math.round(matches))}</div>
          <div className="ml">matches</div>
        </div>
      </div>
    </div>
  );
}

function MostToxicPlayer({ stats }: { stats: Stats }) {
  const candidates = Object.entries(stats.behavior?.players ?? {})
    .filter(([, record]) => record.matches >= 3 && (record.disruptive_score ?? 0) > 0)
    .map(([id, record]) => ({ id, ...record }));
  const player = candidates.sort((a, b) =>
    (b.disruptive_score ?? 0) - (a.disruptive_score ?? 0)
    || (b.chat_messages ?? 0) - (a.chat_messages ?? 0)
    || a.id.localeCompare(b.id),
  )[0];
  const score = useCountUp(player?.disruptive_score ?? 0);
  if (!player) return null;
  const rank = candidates.findIndex((candidate) => candidate.id === player.id) + 1;
  const topHero = playerTopHero(stats, player.id);
  const art = heroPortraitUrl(topHero);
  const maxChat = Math.max(...candidates.map((candidate) => candidate.chat_messages_per_match ?? 0), 1);
  const maxBursts = Math.max(...candidates.map((candidate) => candidate.ping_bursts_per_match ?? 0), 1);
  const maxDisconnects = Math.max(...candidates.map((candidate) => candidate.disconnects_or_abandons_per_match ?? 0), 1);
  const breakdown = [
    { label: "Chat activity", weight: 35, value: player.chat_messages_per_match ?? 0, max: maxChat, tone: "chat" },
    { label: "Repeated ping bursts", weight: 25, value: player.ping_bursts_per_match ?? 0, max: maxBursts, tone: "pings" },
    { label: "Disconnects or abandons", weight: 40, value: player.disconnects_or_abandons_per_match ?? 0, max: maxDisconnects, tone: "disconnects" },
  ];
  return (
    <article className="card toxic-feature">
      <header className="toxic-header">
        <div>
          <p className="toxic-kicker">Replay activity spotlight</p>
          <h2>Most <span>toxic</span> player</h2>
          <p>Based on chat, repeated ping bursts, and disconnect or abandon activity.</p>
        </div>
        <div className="toxic-disclaimer">Not an official Dota Behavior Score.</div>
      </header>

      <div className="toxic-main">
        <div className={`toxic-identity${art ? "" : " no-art"}`}>
          {art ? <div className="toxic-art" style={{ backgroundImage: `url(${art})` }} aria-hidden="true" /> : null}
          <div className="toxic-player">
            <PlayerAvatar id={player.id} size="lg" />
            <div>
              <PlayerName id={player.id} className="toxic-player-name" />
              <span>{fmtInt(player.matches)} recorded matches</span>
              <small>via replay activity proxy</small>
            </div>
          </div>
          <div className="toxic-tags">
            <span>Highest activity index</span>
            {(player.chat_messages_per_match ?? 0) > 0 ? <span>Chat activity</span> : null}
            {(player.ping_bursts_per_match ?? 0) > 0 ? <span>Ping bursts</span> : null}
          </div>
        </div>

        <div className="toxic-score-panel">
          <div className="toxic-score-top">
            <span>Overall toxicity index</span>
            <strong>{fmtNum(score)} / 100</strong>
          </div>
          <div className="toxic-gauge" aria-label={`${fmtNum(player.disruptive_score ?? 0)} out of 100 relative activity index`}>
            <i style={{ width: `${Math.max(2, Math.min(100, player.disruptive_score ?? 0))}%` }} />
          </div>
          <div className="toxic-score-meta">
            <span>Relative activity index</span>
            <b>#{rank} of {fmtInt(candidates.length)} qualifying players</b>
          </div>
        </div>
      </div>

      <div className="toxic-breakdown">
        <div className="toxic-breakdown-list">
          <h3>Activity breakdown</h3>
          {breakdown.map((item) => (
            <div className="toxic-breakdown-row" key={item.label}>
              <span>{item.label}</span>
              <div className={`toxic-breakdown-bar ${item.tone}`}><i style={{ width: `${Math.max(4, (item.value / item.max) * 100)}%` }} /></div>
              <b>{item.weight}%</b>
            </div>
          ))}
        </div>
        <p>Relative to this lobby: 35% chat, 25% repeated ping bursts, and 40% disconnects or abandons per match.</p>
      </div>
    </article>
  );
}

function HighestWinRatePlayer({ stats }: { stats: Stats }) {
  const [sort, setSort] = useState("desc");
  const minimumMatches = stats.metadata.thresholds?.players ?? 5;
  const candidates = Object.entries(stats.players)
    .map(([id, record]) => ({ id, ...record }))
    .filter((player) => player.matches >= minimumMatches)
    .sort((a, b) =>
      (b.win_rate_confidence ?? b.win_rate) - (a.win_rate_confidence ?? a.win_rate)
      || b.matches - a.matches
      || a.id.localeCompare(b.id),
    );
  const player = candidates[0];
  const winRate = useCountUp(player?.win_rate ?? 0);
  const provenScore = useCountUp(player?.win_rate_confidence ?? player?.win_rate ?? 0);
  if (!player) return null;
  const totalCandidateWins = candidates.reduce((total, candidate) => total + candidate.wins, 0);
  const totalCandidateMatches = candidates.reduce((total, candidate) => total + candidate.matches, 0);
  const lobbyAverage = totalCandidateMatches ? (totalCandidateWins / totalCandidateMatches) * 100 : 0;
  const recentResults = stats.player_recent_results?.[player.id] ?? [];
  const art = heroPortraitUrl(playerTopHero(stats, player.id));
  const ranked = candidates.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const rankingValue = (candidate: typeof candidates[number]) => candidate.win_rate_confidence ?? candidate.win_rate;
  const rows = (sort === "asc" ? [...ranked].sort((a, b) => rankingValue(a) - rankingValue(b) || a.rank - b.rank) : ranked).slice(0, 5);
  return (
    <article className="card winrate-feature" aria-labelledby="winrate-heading">
      <header className="winrate-header">
        <div>
          <p className="winrate-kicker"><Icon name="trophy" /> Lobby Leader</p>
          <h2 id="winrate-heading">
            <Link to="/leaderboard/$category" params={{ category: "highest_win_rate" }} className="winrate-detail-link" aria-label="Best proven win rate">
              <span>Best <span>proven win rate</span></span>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </Link>
          </h2>
          <p className="winrate-context">Ranks strong records, not just perfect starts · minimum {fmtInt(minimumMatches)} matches</p>
          <Link to="/leaderboard/$category" params={{ category: "highest_win_rate" }} className="winrate-explainer-link">
            How is this ranked?
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </Link>
        </div>
          <span className="winrate-sample">{fmtInt(player.matches)} matches</span>
      </header>
      <div className="winrate-leader">
        {art ? <div className="winrate-art" style={{ backgroundImage: `url(${art})` }} aria-hidden="true" /> : null}
        <span className="winrate-first">#1</span>
        <PlayerAvatar id={player.id} size="lg" />
        <div className="winrate-identity">
          <PlayerName id={player.id} className="winrate-player-name" />
          <p className="winrate-record"><span>{fmtInt(player.wins)} wins</span> · <span>{fmtInt(player.losses)} losses</span></p>
          {recentResults.length ? (
            <div className="winrate-results" aria-label={`${recentResults.join(", ")} in the most recent matches`}>
              {recentResults.map((result, index) => <span className={result === "W" ? "win" : "loss"} key={`${result}-${index}`}>{result}</span>)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="winrate-stats">
        <section className="winrate-metric" aria-label="Match Win Rate">
          <h3><Icon name="trophy" /> Match win rate</h3>
        <div className="winrate-score">
          <strong>{fmtPct(winRate)}</strong>
          <span>{fmtInt(player.wins)} / {fmtInt(player.matches)} wins</span>
        </div>
        <div className="winrate-gauge" aria-label={`${fmtPct(player.win_rate)} win rate`}>
          <i style={{ width: `${Math.max(0, Math.min(100, player.win_rate))}%` }} />
        </div>
        <span className="winrate-average">Proven score {fmtPct(provenScore)} · lobby avg {fmtPct(lobbyAverage)}</span>
        </section>
        <section className="qualifying-feature" aria-label="Qualifying Players">
        <h3><Icon name="users" /> Qualifying Players</h3>
        <strong>{fmtInt(candidates.length)}</strong>
        <span>qualifying players</span>
        <b><span>#1</span> of {fmtInt(candidates.length)}</b>
        </section>
      </div>
      <section className="winrate-ranking" aria-labelledby="winrate-ranking-heading">
        <header className="winrate-ranking-header">
          <h3 id="winrate-ranking-heading"><Icon name="layers" /> Player Win Rate Ranking</h3>
          <select className="board-select" aria-label="Sort player win rate" value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="desc">Proven score (high to low)</option>
            <option value="asc">Proven score (low to high)</option>
          </select>
        </header>
        <ol className="winrate-ranking-list">
          {rows.map((candidate) => (
            <li className={`winrate-ranking-row${candidate.rank === 1 ? " is-leader" : ""}`} key={candidate.id}>
              <span className="winrate-rank">#{candidate.rank}</span>
              <PlayerAvatar id={candidate.id} />
              <div className="winrate-row-player">
                <PlayerName id={candidate.id} />
                <p className="winrate-record"><span>{fmtInt(candidate.wins)} wins</span> · <span>{fmtInt(candidate.losses)} losses</span></p>
              </div>
              <div className="winrate-results" aria-label="Recent match results">
                {(stats.player_recent_results?.[candidate.id] ?? []).slice(0, 5).map((result, index) => <span className={result === "W" ? "win" : "loss"} key={index}>{result}</span>)}
              </div>
              <strong className="winrate-row-value">{fmtPct(candidate.win_rate)}</strong>
              <div className="winrate-gauge" aria-label={`${fmtPct(candidate.win_rate)} win rate`}><i style={{ width: `${Math.max(0, Math.min(100, candidate.win_rate))}%` }} /></div>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

type RoleKey = "support" | "offlane" | "carry";

type RoleCardConfig = {
  key: RoleKey;
  title: string;
  icon: "shield" | "swords" | "trophy";
  tone: string;
  metric: (record: RoleRecord) => string[];
};

const ROLE_CARDS: RoleCardConfig[] = [
  { key: "support", title: "Best support", icon: "shield", tone: "support", metric: (record) => [`Vision ${fmtNum(record.vision, 1)}`, `KP ${fmtNum(record.kill_participation * 100, 1)}%`] },
  { key: "offlane", title: "Best offlane", icon: "swords", tone: "offlane", metric: (record) => [`Hero dmg ${fmtNum(record.hero_damage_per_minute, 0)}/m`, `Stuns ${fmtNum(record.stuns_per_minute, 2)}/m`] },
  { key: "carry", title: "Best carry", icon: "trophy", tone: "carry", metric: (record) => [`GPM ${fmtInt(record.gpm)}`, `Tower ${fmtNum(record.tower_damage_per_minute, 0)}/m`] },
];

function roleValue(record: RoleRecord, key: string): string {
  const value = record.score_breakdown?.find((metric) => metric.key === key);
  if (!value) return "—";
  if (key === "kill_participation" || key === "win_rate") return `${fmtNum(value.value * (key === "kill_participation" ? 100 : 1), 1)}%`;
  if (key === "gpm") return `${fmtInt(value.value)} GPM`;
  if (key === "vision" || key === "assists" || key === "last_hits") return `${fmtNum(value.value, 1)} ${value.unit}`;
  return `${fmtNum(value.value, 2)} ${value.unit}`;
}

function RoleDetailModal({ role, stats, onClose }: { role: RoleCardConfig; stats: Stats; onClose: () => void }) {
  const ranking = stats.role_rankings?.[role.key] ?? [];
  const leader = ranking[0];
  const scoring = stats.role_scoring?.[role.key];

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

  if (!leader) return null;
  const breakdown = leader.score_breakdown ?? [];

  return (
    <div className="role-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`role-modal ${role.tone}`} role="dialog" aria-modal="true" aria-labelledby="role-modal-title">
        <header className="role-modal-header">
          <div>
            <p><Icon name={role.icon} /> Role scoring detail</p>
            <h2 id="role-modal-title">{role.title}</h2>
            <span>{scoring?.method ?? "Lobby-relative weighted score"}</span>
          </div>
          <button type="button" className="role-modal-close" onClick={onClose} aria-label="Close role scoring detail"><Icon name="close" /></button>
        </header>

        <div className="role-modal-leader">
          <PlayerAvatar id={leader.id} size="lg" />
          <div>
            <PlayerName id={leader.id} className="role-modal-name" />
            <p>{fmtInt(leader.matches)} role matches · {fmtPct(leader.win_rate)} win rate</p>
          </div>
          <strong>{fmtNum(leader.score, 0)}<small>/100</small></strong>
        </div>

        <div className="role-modal-why">
          <strong>Why this player is best</strong>
          <p>{scoring?.description ?? "This player has the highest weighted role score among qualifying players in this lobby."}</p>
          <span>{scoring?.eligible_players ?? ranking.length} qualifying players · minimum {scoring?.minimum_matches ?? 2} matches</span>
        </div>

        <section className="role-modal-section" aria-labelledby="role-breakdown-title">
          <div className="role-modal-section-head">
            <h3 id="role-breakdown-title">Score breakdown</h3>
            <span>Each metric is normalized against the best qualifying value.</span>
          </div>
          {breakdown.length ? (
            <div className="role-breakdown-list">
              {breakdown.map((metric) => (
                <div className="role-breakdown-row" key={metric.key}>
                  <div className="role-breakdown-label"><strong>{metric.label}</strong><span>{metric.weight}% weight</span></div>
                  <div className="role-breakdown-track"><i style={{ width: `${Math.max(2, Math.min(100, metric.normalized))}%` }} /></div>
                  <div className="role-breakdown-value"><b>{roleValue(leader, metric.key)}</b><span>+{fmtNum(metric.contribution, 1)} pts</span></div>
                </div>
              ))}
            </div>
          ) : (
            <p className="role-modal-empty">Detailed breakdown is unavailable in this older stats payload.</p>
          )}
        </section>

        <section className="role-modal-section role-modal-method" aria-labelledby="role-method-title">
          <div className="role-modal-section-head"><h3 id="role-method-title">How role assignment works</h3></div>
          <p>Early-game position votes identify the lane. At the 10-minute farm snapshot, the higher-farm player in a lane pair is treated as the core and the other player as support.</p>
          <div className="role-method-tags"><span>{leader.role} heuristic</span><span>{fmtNum(leader.role_confidence * 100, 0)}% lane confidence</span><span>Replay telemetry</span></div>
          <small>It is not an official Dota 2 role or Valve performance score.</small>
        </section>

        {ranking.length > 1 ? (
          <section className="role-modal-section role-modal-runners" aria-labelledby="role-runners-title">
            <div className="role-modal-section-head"><h3 id="role-runners-title">Other qualifying players</h3></div>
            {ranking.slice(0, 3).map((candidate, index) => (
              <div className={`role-runner${index === 0 ? " leader" : ""}`} key={candidate.id}>
                <span>#{index + 1}</span><PlayerName id={candidate.id} /><b>{fmtNum(candidate.score, 0)} / 100</b>
              </div>
            ))}
          </section>
        ) : null}
      </section>
    </div>
  );
}

function RoleLeaders({ stats }: { stats: Stats }) {
  const [selectedRole, setSelectedRole] = useState<RoleKey | null>(null);
  return (
    <>
      <div className="role-highlights">
      {ROLE_CARDS.map((role) => {
        const leader = stats.role_rankings?.[role.key]?.[0];
        const art = leader ? heroPortraitUrl(playerTopHero(stats, leader.id)) : null;
        const open = () => { if (leader) setSelectedRole(role.key); };
        return (
          <article
            className={`card role-card ${role.tone}${leader ? " is-clickable" : ""}`}
            key={role.key}
            role={leader ? "button" : undefined}
            tabIndex={leader ? 0 : undefined}
            aria-label={leader ? `View ${role.title} scoring details` : undefined}
            onClick={(event) => { if (!(event.target as HTMLElement).closest("a,button")) open(); }}
            onKeyDown={(event) => { if (leader && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); open(); } }}
          >
            <header className="role-card-header">
              <div>
                <p><Icon name={role.icon} /> Role spotlight</p>
                <h2>{role.title}<svg className="role-card-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg></h2>
              </div>
              <span className="role-card-score">{leader ? `${fmtNum(leader.score, 0)} / 100` : "—"}</span>
            </header>
            {leader ? (
              <>
                <div className="role-card-leader">
                  {art ? <div className="role-card-art" style={{ backgroundImage: `url(${art})` }} aria-hidden="true" /> : null}
                  <PlayerAvatar id={leader.id} size="lg" />
                  <div>
                    <PlayerName id={leader.id} className="role-card-name" />
                    <span>{fmtInt(leader.matches)} role matches · {fmtPct(leader.win_rate)} win rate</span>
                  </div>
                </div>
                <div className="role-card-metrics">
                  {role.metric(leader).map((metric) => <span key={metric}>{metric}</span>)}
                </div>
              </>
            ) : (
              <div className="role-card-empty">Waiting for enriched replay data</div>
            )}
            <footer>{leader ? "Click for scoring details" : "Waiting for enriched replay data"}</footer>
          </article>
        );
      })}
      </div>
      {selectedRole ? <RoleDetailModal role={ROLE_CARDS.find((role) => role.key === selectedRole) ?? ROLE_CARDS[0]} stats={stats} onClose={() => setSelectedRole(null)} /> : null}
    </>
  );
}

export function Summary({ stats }: { stats: Stats }) {
  return (
    <section className="section" id="summary">
      <div className="spotlight">
        <SpotLightHero stats={stats} />
        <PlayerOfTheLobby stats={stats} />
      </div>
      <div className="summary-highlights">
        <MostToxicPlayer stats={stats} />
        <HighestWinRatePlayer stats={stats} />
      </div>
      <RoleLeaders stats={stats} />
      <div className="bento">
        <MatchesCard stats={stats} />
        <SplitCard stats={stats} />
        <GlanceCard stats={stats} />
      </div>
    </section>
  );
}
