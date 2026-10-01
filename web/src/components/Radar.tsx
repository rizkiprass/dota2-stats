export interface RadarAxis {
  label: string;
  norm: number;
  avgNorm: number;
}

// Hexagon radar: the player polygon over the lobby-average polygon.
export function Radar({ axes }: { axes: RadarAxis[] }) {
  const width = 320;
  const height = 262;
  const cx = 160;
  const cy = 136;
  const radius = 86;
  const count = axes.length;

  const point = (i: number, r: number): [number, number] => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };
  const points = (radii: number[]) => radii.map((r, i) => point(i, r).join(",")).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Player compared with the lobby average">
      {[0.25, 0.5, 0.75, 1].map((level) => (
        <polygon
          key={level}
          points={points(axes.map(() => radius * level))}
          style={{ fill: "none", stroke: "var(--border-strong)", strokeWidth: 1 }}
        />
      ))}
      {axes.map((_, i) => {
        const [x, y] = point(i, radius);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} style={{ stroke: "var(--border)" }} />;
      })}
      <polygon
        points={points(axes.map((a) => radius * Math.max(a.avgNorm, 0.02)))}
        style={{ fill: "var(--panel-3)", fillOpacity: 0.75, stroke: "var(--border-strong)" }}
      />
      <polygon
        points={points(axes.map((a) => radius * Math.max(a.norm, 0)))}
        style={{ fill: "var(--accent-soft)", stroke: "var(--accent)", strokeWidth: 2 }}
      />
      {axes.map((axis, i) => {
        const [x, y] = point(i, radius + 18);
        const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
        return (
          <text
            key={axis.label}
            x={x}
            y={y}
            textAnchor={anchor}
            dominantBaseline="middle"
            style={{ fill: "var(--muted)", fontSize: 10.5 }}
          >
            {axis.label}
          </text>
        );
      })}
    </svg>
  );
}
