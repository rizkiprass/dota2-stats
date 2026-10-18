import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Avatar, Badge, PlayerName } from "./ui";
import { fmtCount, fmtDuration, fmtInt } from "../lib/format";
import { heroName } from "../lib/derived";
import { useDashboard } from "../lib/dashboard-context";
import { useMatches } from "../lib/api";
import {
  addMonths,
  buildMonth,
  compareMonths,
  coverage,
  dayKey,
  formatDayLabel,
  formatTime,
  monthOf,
  weekdayHeadings,
  type CalendarDay,
  type MonthCursor,
} from "../lib/match-calendar";
import type { MatchPlayerRecord, MatchRecord, Stats } from "../types/stats";

export function MatchHistory() {
  const { stats } = useDashboard();
  const { data, isPending, isError } = useMatches();
  const today = useMemo(() => new Date(), []);

  // Open on the newest published month, not the current one: a group that last
  // played in September should not land on an empty October.
  const newest = data?.matches?.[0]?.start_time ?? null;
  const oldest = data?.matches?.length ? data.matches[data.matches.length - 1].start_time : null;
  const currentMonth = monthOf(today.getTime() * 1000, today);
  const earliestMonth = oldest === null ? null : monthOf(oldest, today);

  const [picked, setPicked] = useState<MonthCursor | null>(null);
  const cursor = picked ?? monthOf(newest, today);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const month = useMemo(() => buildMonth(data, cursor, today), [data, cursor, today]);
  const headings = useMemo(() => weekdayHeadings(), []);
  const cover = coverage(data);

  const canPrev = earliestMonth ? compareMonths(cursor, earliestMonth) > 0 : false;
  const canNext = compareMonths(cursor, currentMonth) < 0;

  const groups = useMemo(() => {
    if (selectedDay) {
      const day = month.weeks.flat().find((entry) => entry.key === selectedDay);
      return day ? [{ key: day.key, matches: day.matches }] : [];
    }
    const byDay = new Map<string, MatchRecord[]>();
    for (const match of month.matches) {
      const key = dayKey(match.start_time) ?? "unknown";
      const list = byDay.get(key);
      if (list) list.push(match);
      else byDay.set(key, [match]);
    }
    return [...byDay.entries()].map(([key, matches]) => ({ key, matches }));
  }, [selectedDay, month]);

  const unavailable = isError || !data;

  return (
    <main className="wrap">
      <div className="mh-page">
        <Link to="/" className="back-link">
          ← Back to dashboard
        </Link>

        <div className="board-head">
          <p className="board-eyebrow">Lobby</p>
          <h1 className="board-title">Match history</h1>
          <p className="board-blurb">
            Every published lobby, grouped by the day it was played in your own time zone.
          </p>
        </div>

        {isPending ? (
          <div className="card">
            <p className="dp-empty">Loading match history…</p>
          </div>
        ) : null}

        {!isPending && unavailable ? (
          <div className="card">
            <div className="empty-state">
              <strong>Per-match history isn’t published yet</strong>
              <span>
                The calendar needs the per-match payload. Aggregate statistics on the dashboard are
                unaffected.
              </span>
            </div>
          </div>
        ) : null}

        {!isPending && data && data.matches.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <strong>No matches recorded yet</strong>
              <span>Upload a replay and the lobby will appear here by date.</span>
            </div>
          </div>
        ) : null}

        {!isPending && data && data.matches.length > 0 ? (
          <div className="card mh-card">
            <div className="mh-month">
              <button
                type="button"
                className="board-toggle"
                onClick={() => setPicked(addMonths(cursor, -1))}
                disabled={!canPrev}
                aria-label="Previous month"
              >
                ← Prev
              </button>
              <h2 className="mh-month-label">{month.label}</h2>
              <button
                type="button"
                className="board-toggle"
                onClick={() => setPicked(addMonths(cursor, 1))}
                disabled={!canNext}
                aria-label="Next month"
              >
                Next →
              </button>
            </div>

            <div className="mh-grid">
              <div className="mh-calendar">
                <table className="cal" aria-label={`Matches in ${month.label}`}>
                  <thead>
                    <tr>
                      {headings.map((heading) => (
                        <th key={heading} scope="col">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {month.weeks.map((week) => (
                      <tr key={week[0].key}>
                        {week.map((day) => (
                          <td key={day.key}>
                            <DayCell
                              day={day}
                              selected={selectedDay === day.key}
                              onSelect={() =>
                                setSelectedDay((previous) => (previous === day.key ? null : day.key))
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mh-list">
                <div className="board-badges">
                  <Badge label={fmtCount(month.matches.length, "match")} />
                  <Badge label={`${fmtInt(month.activeDays)} active day${month.activeDays === 1 ? "" : "s"}`} />
                  <Badge label={`${fmtDuration(month.totalDuration)} played`} />
                </div>

                {selectedDay ? (
                  <div className="mh-filter">
                    <span>Showing one day</span>
                    <button type="button" className="board-toggle" onClick={() => setSelectedDay(null)}>
                      Show the month
                    </button>
                  </div>
                ) : null}

                {groups.length === 0 ? (
                  <p className="dp-empty">No matches recorded in this month.</p>
                ) : (
                  groups.map((group) => (
                    <section className="mh-group" key={group.key}>
                      <h3 className="mh-day">{formatDayLabel(group.matches[0].start_time)}</h3>
                      {group.matches.map((match) => (
                        <MatchCard key={match.match_id} match={match} stats={stats} />
                      ))}
                    </section>
                  ))
                )}
              </div>
            </div>

            {cover.truncated ? (
              <p className="mh-coverage">
                Showing the newest {fmtInt(data.matches.length)} of {fmtInt(data.match_count)} matches.
                The published payload is capped, so older days are missing from this calendar.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function DayCell({
  day,
  selected,
  onSelect,
}: {
  day: CalendarDay;
  selected: boolean;
  onSelect: () => void;
}) {
  const classes = [
    "cal-day",
    day.inMonth ? "" : "out",
    day.isToday ? "today" : "",
    day.matches.length > 0 ? "has-matches" : "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (day.matches.length === 0) {
    return (
      <span className={classes} aria-hidden={!day.inMonth}>
        <span className="cal-num">{day.inMonth ? day.day : ""}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      aria-pressed={selected}
      aria-label={`${day.day}, ${fmtCount(day.matches.length, "match")}`}
      onClick={onSelect}
    >
      <span className="cal-num">{day.day}</span>
      <span className="cal-count">{day.matches.length}</span>
    </button>
  );
}

function MatchCard({ match, stats }: { match: MatchRecord; stats: Stats }) {
  const [open, setOpen] = useState(false);

  const radiant = match.players.filter((player) => player.team === "radiant");
  const dire = match.players.filter((player) => player.team === "dire");
  const kills = (players: MatchPlayerRecord[]) =>
    players.reduce((sum, player) => sum + (Number(player.kills) || 0), 0);
  const radiantKills = kills(radiant);
  const direKills = kills(dire);
  const totalKills = radiantKills + direKills;
  const radiantShare = totalKills > 0 ? (radiantKills / totalKills) * 100 : 50;

  return (
    <article className="match-card">
      <button type="button" className="mc-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="mc-when">
          <span className="mc-meta">
            {formatTime(match.start_time)} · {fmtDuration(match.duration)}
          </span>
          <span className={`badge${match.radiant_win ? " b1" : " b2"}`}>
            {match.radiant_win ? "Radiant win" : "Dire win"}
          </span>
        </span>
        <span className="mc-verdict">
          <span className="splitbar" aria-hidden="true">
            <i className="r" style={{ width: `${radiantShare}%` }} />
            <i className="d" style={{ width: `${100 - radiantShare}%` }} />
          </span>
          <span className="mc-score">
            {fmtInt(radiantKills)}–{fmtInt(direKills)}
            <span className="mc-score-label"> kills</span>
          </span>
        </span>
        <span className="mc-hint">{open ? "Hide K/D/A" : "Show K/D/A"}</span>
      </button>
      <Link to="/matches/$matchId" params={{ matchId: match.match_id }} className="mc-details-link">
        View match details
      </Link>

      <div className="mc-lineups">
        <Lineup label="Radiant" side="r" players={radiant} stats={stats} showKda={open} />
        <Lineup label="Dire" side="d" players={dire} stats={stats} showKda={open} />
      </div>
    </article>
  );
}

function Lineup({
  label,
  side,
  players,
  stats,
  showKda,
}: {
  label: string;
  side: "r" | "d";
  players: MatchPlayerRecord[];
  stats: Stats;
  showKda: boolean;
}) {
  return (
    <div className="mc-side">
      <div className="mc-side-label">
        <span className={`mc-dot ${side}`} aria-hidden="true" />
        {label}
      </div>
      {players.map((player, index) => {
        const hero = player.hero_name ?? heroName(stats, player.hero_id);
        return (
          <div className="dp-hero-row" key={`${player.account_id ?? "anon"}-${index}`}>
            <Avatar heroId={Number(player.hero_id) || null} name={hero} />
            <div className="dp-hero-info">
              <div className="h-name">
                {player.account_id ? (
                  <PlayerName id={player.account_id} />
                ) : (
                  player.player_name ?? "Anonymous"
                )}
              </div>
              <div className="h-sub">{hero}</div>
            </div>
            {showKda ? (
              <div className="dp-hero-val">
                {fmtInt(player.kills)}/{fmtInt(player.deaths)}/{fmtInt(player.assists)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
