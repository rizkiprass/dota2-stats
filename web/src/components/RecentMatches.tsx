import { Link } from "@tanstack/react-router";
import { fmtDuration, fmtInt } from "../lib/format";
import { formatDayLabel, formatTime } from "../lib/match-calendar";
import { useDashboard } from "../lib/dashboard-context";

/**
 * A bounded teaser of the newest lobbies, rendered straight from stats.json so
 * the dashboard never fetches the per-match payload. The full calendar and the
 * 5-vs-5 lineups live on /matches.
 */
export function RecentMatches() {
  const { stats } = useDashboard();
  const recent = stats.recent_matches ?? [];
  // An older payload has no teaser at all: show nothing rather than an empty shell.
  if (recent.length === 0) return null;

  return (
    <section className="section" id="recent">
      <div className="card recent-card">
        <div className="recent-head">
          <h2 className="section-title">Recent matches</h2>
          <Link to="/matches" className="recent-link">
            All matches
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        <ul className="recent-list">
          {recent.map((match) => {
            const radiantKills = Number(match.radiant_kills) || 0;
            const direKills = Number(match.dire_kills) || 0;
            const totalKills = radiantKills + direKills;
            const radiantShare = totalKills > 0 ? (radiantKills / totalKills) * 100 : 50;
            return (
              <li className="recent-row" key={match.match_id}>
                <span className="recent-when">
                  <span className="recent-date">{formatDayLabel(match.start_time)}</span>
                  <span className="recent-meta">
                    {formatTime(match.start_time)} · {fmtDuration(match.duration)}
                  </span>
                </span>
                <span className="recent-verdict">
                  <span className={`badge${match.radiant_win ? " b1" : " b2"}`}>
                    {match.radiant_win ? "Radiant win" : "Dire win"}
                  </span>
                  <span className="splitbar" aria-hidden="true">
                    <i className="r" style={{ width: `${radiantShare}%` }} />
                    <i className="d" style={{ width: `${100 - radiantShare}%` }} />
                  </span>
                  <span className="recent-score">
                    {fmtInt(radiantKills)}–{fmtInt(direKills)}
                    <span className="recent-score-label"> kills</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
