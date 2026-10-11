import { Avatar, Badge } from "./ui";
import { fmtCount, fmtInt, fmtNum, fmtPct } from "../lib/format";
import { useDashboard } from "../lib/dashboard-context";
import {
  contestedHeroes,
  heroDiversity,
  heroLabel,
  pickShares,
  type HeroPickShare,
} from "../lib/hero-distribution";

// Donut geometry: one stroked circle per slice. Dash lengths are computed from
// the circumference, so no arc path maths is needed.
const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SLICE_GAP = 1.6;

export function HeroDistribution() {
  const { stats } = useDashboard();
  const { shares, others, totalPicks } = pickShares(stats);
  const diversity = heroDiversity(stats);
  const contested = contestedHeroes(stats);

  if (totalPicks === 0) return null;

  const slices: HeroPickShare[] = others ? [...shares, others] : shares;

  let travelled = 0;
  const arcs = slices.map((slice) => {
    const span = (slice.share / 100) * CIRCUMFERENCE;
    const arc = { slice, length: Math.max(0, span - SLICE_GAP), offset: travelled };
    travelled += span;
    return arc;
  });

  const description = slices
    .map((slice) =>
      slice.isOther
        ? `${slice.heroCount} other heroes ${fmtPct(slice.share)}`
        : `${slice.name} ${fmtPct(slice.share)}`,
    )
    .join(", ");

  return (
    <div className="hero-dist">
      <div className="hd-chart">
        <div className="hd-donut">
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label={`Hero pick distribution across ${fmtInt(totalPicks)} picks: ${description}`}
          >
            <circle className="hd-track" cx="50" cy="50" r={RADIUS} />
            {arcs.map(({ slice, length, offset }) => (
              <circle
                key={slice.key}
                className="hd-slice"
                cx="50"
                cy="50"
                r={RADIUS}
                stroke={`var(${slice.tint})`}
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={-offset}
              />
            ))}
          </svg>
          <div className="hd-center" aria-hidden="true">
            <span className="hd-center-value">{fmtInt(totalPicks)}</span>
            <span className="hd-center-label">picks</span>
          </div>
        </div>
      </div>

      <div className="hd-detail">
        <div className="hd-shares">
          <ul className="hd-legend">
            {slices.map((slice) => (
              <li className="hd-legend-row" key={slice.key}>
                <span className="hd-swatch" style={{ background: `var(${slice.tint})` }} aria-hidden="true" />
                <span className="hd-legend-name">
                  {slice.isOther ? `${fmtInt(slice.heroCount)} other heroes` : slice.name}
                </span>
                <span className="hd-legend-val">
                  {fmtInt(slice.picks)} · {fmtPct(slice.share)}
                </span>
              </li>
            ))}
          </ul>

          <div className="hd-badges">
            <Badge label={`${fmtInt(diversity.distinct)} distinct heroes`} />
            <Badge label={`${fmtNum(diversity.picksPerHero, 1)} picks per hero`} />
          </div>
        </div>

        <div className="hd-contested-block">
          <h3 className="hd-subtitle">Contested heroes</h3>
          {contested.length === 0 ? (
            <p className="dp-empty">
              No hero has been picked by both teams in the same match yet.
            </p>
          ) : (
            <div className="hd-contested">
              {contested.slice(0, 4).map((hero) => {
                const name = heroLabel(hero);
                return (
                  <div className="dp-hero-row" key={hero.hero_id}>
                    <Avatar heroId={hero.hero_id} name={name} />
                    <div className="dp-hero-info">
                      <div className="h-name">{name}</div>
                      <div className="h-sub">
                        picked by both teams in {fmtCount(hero.contested, "match")}
                      </div>
                    </div>
                    <div className="dp-hero-val">{fmtInt(hero.contested)}×</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
