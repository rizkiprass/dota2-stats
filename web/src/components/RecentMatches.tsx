import { Link } from "@tanstack/react-router";
import { Avatar } from "./ui";
import { fmtDuration, fmtInt } from "../lib/format";
import { heroName, playerName } from "../lib/derived";
import { formatDayLabel, formatTime } from "../lib/match-calendar";
import { useDashboard } from "../lib/dashboard-context";
import type { RecentMatchPlayer, Stats } from "../types/stats";

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
            const radiantHeroes = match.radiant_heroes ?? [];
            const direHeroes = match.dire_heroes ?? [];
            const showHeroes = radiantHeroes.length > 0 && direHeroes.length > 0;
            // The player arrays are index-aligned with the hero arrays; a payload
            // that predates them yields an empty side and falls back to hero-only
            // portraits rather than an empty shell.
            const radiant = sideEntries(stats, radiantHeroes, match.radiant_players);
            const dire = sideEntries(stats, direHeroes, match.dire_players);
            // One concise, group-level summary; each portrait below also names
            // its own player so the strip stays navigable by link.
            const sidesLabel = `Radiant: ${radiant
              .map((entry) => `${entry.hero}${entry.name ? ` (${entry.name})` : ""}`)
              .join(", ")}. Dire: ${dire
              .map((entry) => `${entry.hero}${entry.name ? ` (${entry.name})` : ""}`)
              .join(", ")}.`;

            return (
              <li className="recent-row" key={match.match_id}>
                <span className="recent-when">
                  <span className="recent-date">{formatDayLabel(match.start_time)}</span>
                  <span className="recent-meta">
                    {formatTime(match.start_time)} · {fmtDuration(match.duration)}
                  </span>
                  <Link to="/matches/$matchId" params={{ matchId: match.match_id }} className="recent-match-link">
                    View match
                  </Link>
                </span>

                {showHeroes ? (
                  <span className="recent-lineups" role="group" aria-label={sidesLabel}>
                    <RecentLineup label="Radiant" side="r" entries={radiant} />
                    <RecentLineup label="Dire" side="d" entries={dire} />
                  </span>
                ) : null}

                <span className="recent-verdict">
                  <span className={`badge${match.radiant_win ? " b1" : " b2"}`}>
                    {match.radiant_win ? "Radiant win" : "Dire win"}
                  </span>
                  <span className="recent-score" aria-label={`Radiant ${radiantKills} kills, Dire ${direKills} kills`}>
                    <span className={match.radiant_win ? "recent-score-side winner r" : "recent-score-side r"}>
                      <b>Radiant</b> {fmtInt(radiantKills)}
                    </span>
                    <span className={match.radiant_win ? "recent-score-side d" : "recent-score-side winner d"}>
                      <b>Dire</b> {fmtInt(direKills)}
                    </span>
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

interface PortraitEntry {
  key: string;
  heroId: number | null;
  hero: string;
  /** Resolved display name, or null when the player is unknown. */
  name: string | null;
  accountId: string | null;
}

/**
 * Pair each hero id with the player that fielded it. The player array is
 * index-aligned with the hero array; when it is missing or short the entry keeps
 * its hero and simply carries no player.
 */
function sideEntries(
  stats: Stats,
  heroIds: Array<number | string>,
  players: RecentMatchPlayer[] | undefined,
): PortraitEntry[] {
  return heroIds.map((heroId, index) => {
    const player = players?.[index];
    const accountId = player?.account_id ?? null;
    const resolved = accountId
      ? playerName(stats, accountId)
      : player?.player_name ?? null;
    // A name that is only the account id (no record) is no name at all.
    const name = resolved && resolved !== accountId ? resolved : null;
    return {
      key: accountId ?? String(heroId),
      heroId: Number(heroId) || null,
      hero: heroName(stats, heroId),
      name,
      accountId,
    };
  });
}

function RecentLineup({
  label,
  side,
  entries,
}: {
  label: "Radiant" | "Dire";
  side: "r" | "d";
  entries: PortraitEntry[];
}) {
  return (
    <span className={`recent-side ${side}`}>
      <span className="recent-side-label">
        <i className={`mc-dot ${side}`} aria-hidden="true" />
        {label}
      </span>
      <span className="recent-player-list">
        {entries.map((entry, index) => (
          <HeroPortrait key={`${side}-${entry.key}-${index}`} entry={entry} />
        ))}
      </span>
    </span>
  );
}

/**
 * A compact player tile keeps the player's identity visible and links known
 * accounts to their profile. Unknown players retain the hero as their label.
 */
function HeroPortrait({ entry }: { entry: PortraitEntry }) {
  const label = entry.name ?? entry.hero;
  const title = entry.name ? `${entry.name} — ${entry.hero}` : entry.hero;
  const content = (
    <>
      <Avatar heroId={entry.heroId} name={label} size="sm" />
      <span className="recent-player-name">{label}</span>
    </>
  );

  if (!entry.accountId) {
    return <span className="recent-hero-plain" title={title}>{content}</span>;
  }

  return (
    <Link
      to="/player/$playerId"
      params={{ playerId: entry.accountId }}
      className="recent-hero-link"
      title={title}
    >
      {content}
    </Link>
  );
}
