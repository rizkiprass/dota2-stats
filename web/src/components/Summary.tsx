import type { CSSProperties } from "react";
import { Tile, Icon, useCountUp } from "./ui";
import { fmtDuration, fmtInt, fmtNum, fmtPct } from "../lib/format";
import { heroCropUrl } from "../lib/heroes";
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
        <div className="card-title">At a glance</div>
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

export function Summary({ stats }: { stats: Stats }) {
  return (
    <section className="section">
      <div className="bento">
        <MatchesCard stats={stats} />
        <SplitCard stats={stats} />
        <GlanceCard stats={stats} />
      </div>
    </section>
  );
}
