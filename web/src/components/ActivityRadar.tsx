import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar as RechartsRadar,
  RadarChart,
} from "recharts";
import { cssVar } from "../lib/theme";
import type { RadarAxis } from "../lib/derived";

// Player vs lobby-average radar, rendered with Recharts.
export function ActivityRadar({ axes, playerLabel }: { axes: RadarAxis[]; playerLabel: string }) {
  const data = axes.map((axis) => ({
    axis: axis.label,
    player: Math.round(axis.norm * 1000) / 10,
    average: Math.round(axis.avgNorm * 1000) / 10,
  }));

  const accent = cssVar("--color-accent", "#2f80ed");
  const line = cssVar("--color-line-strong", "rgba(255,255,255,0.12)");
  const panel3 = cssVar("--color-panel-3", "#2c2c33");
  const muted = cssVar("--color-muted", "#9b9ba3");

  return (
    <div className="dp-radar">
      <RadarChart width={360} height={300} outerRadius="72%" data={data}>
        <PolarGrid stroke={line} />
        <PolarAngleAxis dataKey="axis" tick={{ fill: muted, fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <RechartsRadar name={playerLabel} dataKey="player" stroke={accent} fill={accent} fillOpacity={0.28} />
        <RechartsRadar name="Lobby average" dataKey="average" stroke={line} fill={panel3} fillOpacity={0.6} />
      </RadarChart>
    </div>
  );
}
