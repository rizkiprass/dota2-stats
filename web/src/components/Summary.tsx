import type { CSSProperties } from "react";
import { Tile, Icon, PlayerAvatar, PlayerName, useCountUp } from "./ui";
import { fmtDuration, fmtInt, fmtNum, fmtPct } from "../lib/format";
import { heroCropUrl, heroPortraitUrl } from "../lib/heroes";
import { playerTopHero } from "../lib/derived";
import type { Stats } from "../types/stats";

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

export function Summary({ stats }: { stats: Stats }) {
  return (
    <section className="section" id="summary">
      <div className="spotlight">
        <SpotLightHero stats={stats} />
        <PlayerOfTheLobby stats={stats} />
      </div>
      <MostToxicPlayer stats={stats} />
      <div className="bento">
        <MatchesCard stats={stats} />
        <SplitCard stats={stats} />
        <GlanceCard stats={stats} />
      </div>
    </section>
  );
}
