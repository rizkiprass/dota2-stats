import { fmtCount, fmtInt, fmtNum } from "../lib/format";
import { playerName } from "../lib/derived";
import type { BehaviorPlayerRecord, Stats } from "../types/stats";
import { Bar, PlayerAvatar, PlayerName } from "./ui";

type ActivityMetric = {
  id: string;
  title: string;
  value: (record: BehaviorPlayerRecord) => number;
  format: (value: number) => string;
};

const ACTIVITY_METRICS: ActivityMetric[] = [
  {
    id: "orders_per_minute",
    title: "Highest order rate",
    value: (record) => record.orders_per_minute ?? 0,
    format: (value) => `${fmtNum(value, 1)} / min`,
  },
  {
    id: "pings_per_match",
    title: "Most pings per match",
    value: (record) => record.pings_per_match ?? 0,
    format: (value) => fmtNum(value, 1),
  },
  {
    id: "wards_per_match",
    title: "Most wards per match",
    value: (record) => record.wards_per_match ?? 0,
    format: (value) => fmtNum(value, 1),
  },
  {
    id: "runes_per_match",
    title: "Most runes per match",
    value: (record) => record.runes_per_match ?? 0,
    format: (value) => fmtNum(value, 1),
  },
];

export function ActivityLeaderboards({ stats }: { stats: Stats }) {
  const players = Object.entries(stats.behavior?.players ?? {})
    .filter(([, record]) => record.matches >= 3);
  if (!players.length) return null;

  return (
    <section className="section" id="activity">
      <h2 className="section-title">Lobby activity</h2>
      <p className="card-sub activity-caption">
        Activity averages include players with at least 3 recorded matches. Orders per minute are replay unit orders, not official APM.
      </p>
      <div className="board-grid activity-board-grid">
        {ACTIVITY_METRICS.map((metric) => {
          const ranked = players
            .map(([id, record]) => ({ id, record, value: metric.value(record) }))
            .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
            .slice(0, 5);
          const max = Math.max(...ranked.map((entry) => entry.value), 1);
          return (
            <div className="lb" key={metric.id}>
              <h3>{metric.title}</h3>
              {ranked.length === 0 ? <div className="empty">No qualifying entries yet.</div> : ranked.map((entry, index) => (
                <div className="lb-row" key={entry.id}>
                  <div className={`lb-rank${index < 3 ? ` medal medal-${index + 1}` : ""}`}>{index + 1}</div>
                  <PlayerAvatar id={entry.id} />
                  <div className="lb-main">
                    <div className="lb-name"><PlayerName id={entry.id} /></div>
                    <div className="card-sub">{fmtCount(entry.record.matches, "match")}</div>
                    <Bar pct={(entry.value / max) * 100} gold={metric.id.includes("pings")} />
                  </div>
                  <div className="lb-val">{metric.format(entry.value)}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActivityKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="dp-kpi">
      <div className="k-label">{label}</div>
      <div className="k-value">{value}</div>
    </div>
  );
}

export function PlayerActivity({ stats, playerId }: { stats: Stats; playerId: string }) {
  const record = stats.behavior?.players[playerId];
  if (!record) return null;

  const totalWards = (record.wards_obs ?? 0) + (record.wards_sen ?? 0);
  const chatwheelUses = Object.values(record.chatwheel ?? {}).reduce((sum, count) => sum + count, 0);
  const pauseLabel = `${fmtInt(record.pauses_initiated)} · ${fmtInt(record.pause_seconds)}s`;

  return (
    <section className="dp-section" aria-label={`${playerName(stats, playerId)} activity statistics`}>
      <h2 className="dp-title">Lobby activity</h2>
      <p className="dp-empty">
        Averages use {fmtCount(record.matches, "recorded match", "recorded matches")}. Order rate counts replay unit orders; it is not official APM.
      </p>
      <div className="dp-kpis">
        <ActivityKpi label="Orders / min" value={fmtNum(record.orders_per_minute, 1)} />
        <ActivityKpi label="Pings / match" value={fmtNum(record.pings_per_match, 1)} />
        <ActivityKpi label="Wards / match" value={fmtNum(record.wards_per_match ?? (totalWards / Math.max(record.matches, 1)), 1)} />
        <ActivityKpi label="Runes / match" value={fmtNum(record.runes_per_match ?? ((record.runes ?? 0) / Math.max(record.matches, 1)), 1)} />
        <ActivityKpi label="Chat wheel uses" value={fmtInt(chatwheelUses)} />
        <ActivityKpi label="Pauses · time" value={pauseLabel} />
      </div>
      <p className="dp-empty">Chat text is not displayed; only replay activity counts are included.</p>
    </section>
  );
}
