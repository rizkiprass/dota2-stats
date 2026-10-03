import type { CSSProperties } from "react";
import { Bar } from "./ui";
import { fmtInt, fmtPct } from "../lib/format";
import { heroCropUrl } from "../lib/heroes";
import type { Stats } from "../types/stats";

const TINTS = ["--av1", "--av2", "--av3", "--av4", "--av5", "--av6"];

export function Heroes({ stats }: { stats: Stats }) {
  const heroes = [...Object.values(stats.heroes)];
  heroes.sort((a, b) => b.picks - a.picks || b.win_rate - a.win_rate);
  return (
    <section className="section">
      <h2 className="section-title">Heroes</h2>
      <div className="card hero-card">
        {heroes.length === 0 ? (
          <div className="empty-state">
            <strong>No hero data yet</strong>
            <span>Hero picks will appear here after matches are aggregated.</span>
          </div>
        ) : (
          <div className="hero-grid">
            {heroes.map((hero, i) => {
              const url = heroCropUrl(hero.hero_id);
              const name = hero.hero_name ?? `Hero ${hero.hero_id}`;
              const style = { "--tile-accent": `var(${TINTS[i % TINTS.length]})` } as CSSProperties;
              return (
                <div className="hero-tile" key={hero.hero_id} style={style}>
                  <div className="ht-img">
                    {url ? <img src={url} alt={name} loading="lazy" decoding="async" /> : null}
                  </div>
                  <div className="ht-body">
                    <div className="ht-name" title={name}>
                      {name}
                    </div>
                    <div className="ht-stats">
                      <span>{fmtInt(hero.picks)} picks</span>
                      <span>{fmtPct(hero.win_rate)}</span>
                    </div>
                    <Bar pct={Number(hero.win_rate) || 0} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
