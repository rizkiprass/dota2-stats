import { fmtDate, fmtInt } from "../lib/format";
import type { Stats } from "../types/stats";

export function Header({ stats }: { stats: Stats }) {
  const meta = stats.metadata;
  return (
    <header className="site-header">
      <div className="wrap header-inner">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3v6a6 6 0 0 0 12 0V3" />
            <path d="M12 15v6" />
            <path d="M8 21h8" />
            <path d="M6 3H3m15 0h3" />
          </svg>
        </div>
        <div>
          <h1>Dota&nbsp;2 Lobby Stats</h1>
          <p className="subtitle">
            {fmtInt(meta.source_match_count)} matches · last built {fmtDate(meta.generated_at)}
          </p>
        </div>
      </div>
    </header>
  );
}
