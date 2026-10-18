import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Avatar, AvatarPair, Bar, Badge, PlayerAvatar, PlayerName } from "./ui";
import { fmtCount, fmtDuration, fmtEpochDate, fmtInt, fmtNum, fmtPct } from "../lib/format";
import { heroName, playerName } from "../lib/derived";
import { useDashboard } from "../lib/dashboard-context";
import {
  duoHeroCombos,
  duoMatchRows,
  heroMatchRows,
  playerMatchRows,
  rivalryMatchRows,
  summarize,
  type MatchRow,
} from "../lib/matches";
import {
  CATEGORIES,
  buildRanked,
  duoCoverage,
  entryName,
  entrySearchText,
  pairPlayers,
  partnershipsFor,
  heroUsers,
  playerHighlights,
  sampleOf,
  type CategorySpec,
} from "../lib/leaderboard";
import type { LeaderboardEntry, MatchesPayload, Stats } from "../types/stats";

const MIN_SAMPLE_PRESETS = [1, 2, 3, 5, 10];

/** The aggregator's leaderboard minimum for the family behind this category. */
function defaultMinimum(stats: Stats, spec: CategorySpec): number {
  const thresholds = stats.metadata?.thresholds;
  if (!thresholds) return 1;
  switch (spec.family) {
    case "hero":
      return thresholds.heroes;
    case "duo":
      return thresholds.teammates;
    case "rivalry":
      return thresholds.head_to_head;
    default:
      return thresholds.players;
  }
}

export function LeaderboardDetail() {
  const { category } = useParams({ from: "/leaderboard/$category" });
  const spec = CATEGORIES[category];

  if (!spec) {
    return (
      <main className="wrap">
        <div className="board-page">
          <Link to="/" className="back-link">
            ← Back to dashboard
          </Link>
          <section className="card error-card" role="alert">
            <span className="error-mark" aria-hidden="true">
              !
            </span>
            <div className="error-content">
              <p className="error-eyebrow">Unknown leaderboard</p>
              <h1>“{category}” isn’t a leaderboard here</h1>
              <p className="error-message">Open a leaderboard from the dashboard instead.</p>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <div className="board-page">
        <Link to="/" className="back-link">
          ← Back to dashboard
        </Link>
        <BoardContent category={category} spec={spec} />
      </div>
    </main>
  );
}

function BoardContent({ category, spec }: { category: string; spec: CategorySpec }) {
  const { stats } = useDashboard();

  const all = useMemo(() => buildRanked(stats, category), [stats, category]);
  const sampleMax = Math.max(1, ...all.map((entry) => sampleOf(entry, spec)));

  // The aggregator publishes the leaderboard minimums; honour them so the
  // detail page agrees with the card the visitor came from, clamped to the
  // data actually present.
  const [minSample, setMinSample] = useState(() =>
    Math.min(Math.max(1, defaultMinimum(stats, spec)), sampleMax),
  );
  const [query, setQuery] = useState("");
  const [sortBySample, setSortBySample] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = all
      .filter((entry) => sampleOf(entry, spec) >= minSample)
      .filter((entry) => (needle ? entrySearchText(stats, entry).includes(needle) : true));
    return sortBySample
      ? filtered
          .slice()
          .sort(
            (a, b) => sampleOf(b, spec) - sampleOf(a, spec) || spec.metric(b) - spec.metric(a),
          )
      : filtered;
  }, [all, spec, stats, minSample, query, sortBySample]);

  const sampleOptions = MIN_SAMPLE_PRESETS.filter((value) => value <= sampleMax);
  const sampleLabel = spec.sample === "picks" ? "pick" : "match";

  const leader = rows[0] ?? null;
  const values = rows.map((entry) => spec.metric(entry));
  const metricAverage = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  const columnKeys = orderedColumns(spec);
  const primaryColumn = spec.primaryColumn ?? spec.metricKey;
  const columnClass = (key: string) =>
    `num ${key === primaryColumn ? "col-primary" : "col-secondary"}`;

  return (
    <>
      <div className="board-head">
        <p className="board-eyebrow">Leaderboard</p>
        <h1 className="board-title">{spec.title}</h1>
        <p className="board-blurb">{spec.blurb}</p>
      </div>

      <div className="dp-kpis board-kpis">
        <div className="dp-kpi">
          <div className="k-label">Ranked {spec.family === "hero" ? "heroes" : "entries"}</div>
          <div className="k-value">
            {fmtInt(rows.length)}
            {rows.length === all.length ? null : <span className="board-kpi-sub"> of {fmtInt(all.length)}</span>}
          </div>
        </div>
        <div className="dp-kpi">
          <div className="k-label">Average {spec.shortLabel.toLowerCase()}</div>
          <div className="k-value">{values.length ? spec.format(metricAverage) : "—"}</div>
        </div>
        <div className="dp-kpi">
          <div className="k-label">{insightLabel(spec)}</div>
          <div className="k-value board-kpi-text">{leader ? insightValue(leader, spec, stats) : "—"}</div>
        </div>
      </div>

      <div className="board-controls">
        <label className="board-field">
          <span className="board-field-label">Minimum {sampleLabel}s</span>
          <select
            className="board-select"
            value={minSample}
            onChange={(event) => setMinSample(Number(event.target.value))}
          >
            {sampleOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="table-search board-search">
          <input
            type="search"
            placeholder={`Search ${spec.family === "hero" ? "heroes" : "players"}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={`Search ${spec.title}`}
          />
        </label>

        <button
          type="button"
          className="board-toggle"
          aria-pressed={sortBySample}
          onClick={() => setSortBySample((value) => !value)}
        >
          Sort: {sortBySample ? `most ${sampleLabel}s` : spec.shortLabel.toLowerCase()}
        </button>
      </div>

      <p className="board-count" role="status">
        Showing {fmtInt(rows.length)} of {fmtInt(all.length)} · minimum{" "}
        {fmtCount(minSample, sampleLabel)}
      </p>

      {rows.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <strong>No entries match these filters</strong>
            <span>Lower the minimum {sampleLabel} count or clear the search.</span>
          </div>
        </div>
      ) : (
        <section className="card table-card board-table-card">
          <table className="board-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>{spec.family === "hero" ? "Hero" : spec.family === "rivalry" ? "Rivals" : spec.family === "duo" ? "Duo" : "Player"}</th>
                {columnKeys.map((key) => (
                  <th key={key} className={columnClass(key)}>
                    {columnLabel(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((entry, index) => (
                <tr key={entry.id}>
                  <td className={`num board-rank${index === 0 ? " board-rank-top" : ""}`}>{index + 1}</td>
                  <td>
                    <EntityCell stats={stats} entry={entry} family={spec.family} />
                  </td>
                  {columnKeys.map((key) => (
                    <td key={key} className={columnClass(key)}>
                      {cellValue(key, entry, spec)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

    </>
  );
}

/* ------------------------------------------------------------------ */
/* Table helpers                                                       */
/* ------------------------------------------------------------------ */

const FAMILY_COLUMNS: Record<CategorySpec["family"], string[]> = {
  player: ["matches", "record", "win_rate", "kda"],
  hero: ["picks", "record", "win_rate"],
  duo: ["matches", "record", "win_rate"],
  rivalry: ["matches", "h2h"],
};

/** The category metric leads the numeric columns; the rest keep a fixed order. */
function orderedColumns(spec: CategorySpec): string[] {
  const base = FAMILY_COLUMNS[spec.family];
  return [spec.metricKey, ...base.filter((key) => key !== spec.metricKey)];
}

const COLUMN_LABELS: Record<string, string> = {
  matches: "Matches",
  picks: "Picks",
  record: "W–L",
  win_rate: "Win rate",
  kda: "KDA",
  kills: "Kills",
  assists: "Assists",
  h2h: "Head-to-head",
};

function columnLabel(key: string): string {
  return COLUMN_LABELS[key] ?? key;
}

function cellValue(key: string, entry: LeaderboardEntry, spec: CategorySpec): ReactNode {
  if (key === spec.metricKey) {
    const value = spec.metric(entry);
    const formatted = spec.format(value);
    // Earned Gold: the gold pill marks a winning value, not an arbitrary row.
    return spec.pill && value >= 50 ? <span className="pill-value">{formatted}</span> : formatted;
  }
  switch (key) {
    case "matches":
      return fmtInt(entry.matches);
    case "picks":
      return fmtInt(entry.picks);
    case "record":
      return `${fmtInt(entry.wins)}–${fmtInt(entry.losses)}`;
    case "win_rate":
      return fmtPct(entry.win_rate);
    case "kda":
      return fmtNum(entry.kda);
    case "h2h":
      return <HeadToHeadSplit entry={entry} />;
    default:
      return "—";
  }
}

function HeadToHeadSplit({ entry }: { entry: LeaderboardEntry }) {
  const aWins = Number(entry.player_a_wins) || 0;
  const bWins = Number(entry.player_b_wins) || 0;
  const total = aWins + bWins;
  const aShare = total > 0 ? (aWins / total) * 100 : 50;
  return (
    <span className="h2h-cell">
      <span className="splitbar">
        <i className="r" style={{ width: `${aShare}%` }} />
        <i className="d" style={{ width: `${100 - aShare}%` }} />
      </span>
      <span className="h2h-score">
        {fmtInt(aWins)}–{fmtInt(bWins)}
      </span>
    </span>
  );
}

function EntityCell({
  stats,
  entry,
  family,
}: {
  stats: Stats;
  entry: LeaderboardEntry;
  family: CategorySpec["family"];
}) {
  if (entry.hero_id !== undefined) {
    const label = entry.hero_name ?? heroName(stats, entry.hero_id);
    return (
      <span className="pcell">
        <Avatar heroId={entry.hero_id} name={label} />
        <span className="pinfo">
          <span className="pname">{label}</span>
        </span>
      </span>
    );
  }

  const pair = pairPlayers(entry);
  if (pair) {
    const joiner = family === "rivalry" ? "vs" : "with";
    return (
      <span className="pcell pcell-pair">
        <AvatarPair a={pair[0]} b={pair[1]} />
        <span className="pinfo">
          <span className="pname">
            <PlayerName id={pair[0]} /> <span className="board-joiner">{joiner}</span>{" "}
            <PlayerName id={pair[1]} />
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className="pcell">
      <PlayerAvatar id={entry.id} />
      <span className="pinfo">
        <span className="pname">
          <PlayerName id={entry.id} />
        </span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Summary strip                                                       */
/* ------------------------------------------------------------------ */

function insightLabel(spec: CategorySpec): string {
  switch (spec.family) {
    case "hero":
      return "Most picked";
    case "duo":
      return spec.metricKey === "win_rate" ? "Best pair" : "Most played pair";
    case "rivalry":
      return "Most played rivalry";
    default:
      return "Leader";
  }
}

function insightValue(entry: LeaderboardEntry, spec: CategorySpec, stats: Stats): string {
  return `${entryName(stats, entry)} · ${spec.format(spec.metric(entry))}`;
}

/* ------------------------------------------------------------------ */
/* Focus panel — the family-specific "extra information"              */
/* ------------------------------------------------------------------ */

export function FocusPanel({
  spec,
  entry,
  rows,
  matches,
}: {
  spec: CategorySpec;
  entry: LeaderboardEntry;
  rows: LeaderboardEntry[];
  matches: MatchesState;
}) {
  const { stats } = useDashboard();
  const [focusId, setFocusId] = useState(entry.id);
  const focused = rows.find((row) => row.id === focusId) ?? entry;
  const heroId = Number(focused.hero_id ?? focused.id);
  const pair = pairPlayers(focused);

  return (
    <section className="dp-section">
      <div className="section-head">
        <h2 className="dp-title">Focus</h2>
        <label className="board-field">
          <span className="board-field-label">Showing details for</span>
          <select
            className="board-select"
            value={focused.id}
            onChange={(event) => setFocusId(event.target.value)}
          >
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {entryName(stats, row)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {spec.family === "player" ? <PlayerFocus playerId={focused.id} /> : null}
      {spec.family === "hero" ? <HeroFocus heroId={heroId} /> : null}
      {spec.family === "duo" ? <DuoFocus entry={focused} /> : null}
      {spec.family === "rivalry" ? <RivalryFocus entry={focused} /> : null}

      {spec.family === "player" ? (
        <MatchHistoryBlock
          state={matches}
          title="Recent matches"
          hint={`Every published match ${playerName(stats, focused.id)} played.`}
          joiner="+"
          build={(payload) => playerMatchRows(payload, focused.id)}
        />
      ) : null}

      {spec.family === "hero" ? (
        <MatchHistoryBlock
          state={matches}
          title="Recent appearances"
          hint={`Recent matches where ${heroName(stats, heroId)} was picked, newest first.`}
          joiner="+"
          showPicker
          withSummary={false}
          build={(payload) => heroMatchRows(payload, heroId)}
        />
      ) : null}

      {spec.family === "duo" && pair ? (
        <MatchHistoryBlock
          state={matches}
          title="Played together"
          hint="Matches the two shared a side, newest first."
          joiner="+"
          withCombos
          build={(payload) => duoMatchRows(payload, pair[0], pair[1])}
        />
      ) : null}

      {spec.family === "rivalry" && pair ? (
        <MatchHistoryBlock
          state={matches}
          title="Recent meetings"
          hint="Matches the two faced each other, newest first."
          joiner="vs"
          build={(payload) => rivalryMatchRows(payload, pair[0], pair[1])}
        />
      ) : null}

      {spec.family === "duo" ? <PartnershipsBlock /> : null}
    </section>
  );
}

function PlayerFocus({ playerId }: { playerId: string }) {
  const { stats } = useDashboard();
  const highlights = playerHighlights(stats, playerId);
  const player = stats.players[playerId];

  return (
    <div className="board-focus">
      <div className="dp-head">
        <PlayerAvatar id={playerId} size="lg" />
        <div>
          <h3 className="dp-name">{playerName(stats, playerId)}</h3>
          <div className="dp-id">
            {fmtCount(player?.matches, "match")} · {fmtInt(player?.wins)}W–{fmtInt(player?.losses)}L ·{" "}
            {fmtPct(player?.win_rate)} win rate
          </div>
        </div>
      </div>

      <div className="board-focus-rows">
        {highlights.topHeroId !== null ? (
          <div className="dp-hero-row">
            <Avatar heroId={highlights.topHeroId} name={heroName(stats, highlights.topHeroId)} />
            <div className="dp-hero-info">
              <div className="h-name">{heroName(stats, highlights.topHeroId)}</div>
              <div className="h-sub">Signature hero · {fmtCount(highlights.topHeroMatches, "match")}</div>
            </div>
            <div className="dp-hero-val">Top hero</div>
          </div>
        ) : null}

        {highlights.bestDuo ? (
          <div className="dp-social-row">
            <PlayerAvatar id={highlights.bestDuo.other} />
            <div className="dp-social-label">
              <span className="s-name">{playerName(stats, highlights.bestDuo.other)}</span>
              <span className="s-sub">
                Best duo · {fmtCount(highlights.bestDuo.matches, "match")}
              </span>
            </div>
            <div className={`dp-hero-val ${highlights.bestDuo.win_rate >= 50 ? "win" : "loss"}`}>
              {fmtPct(highlights.bestDuo.win_rate)}
            </div>
          </div>
        ) : null}

        {highlights.toughestRival ? (
          <div className="dp-social-row">
            <PlayerAvatar id={highlights.toughestRival.other} />
            <div className="dp-social-label">
              <span className="s-name">{playerName(stats, highlights.toughestRival.other)}</span>
              <span className="s-sub">
                Toughest rival · {fmtCount(highlights.toughestRival.matches, "match")}
              </span>
            </div>
            <div className={`dp-hero-val ${highlights.toughestRival.win_rate >= 50 ? "win" : "loss"}`}>
              {fmtPct(highlights.toughestRival.win_rate)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HeroFocus({ heroId }: { heroId: number }) {
  const { stats } = useDashboard();
  const users = heroUsers(stats, heroId);

  return (
    <div className="board-focus">
      <div className="dp-head">
        <Avatar heroId={heroId} name={heroName(stats, heroId)} size="lg" />
        <div>
          <h3 className="dp-name">{heroName(stats, heroId)}</h3>
          <div className="dp-id">
            Picked by {fmtCount(users.length, "player")}
          </div>
        </div>
      </div>

      {users.length === 0 ? (
        <p className="dp-empty">No player has picked this hero yet.</p>
      ) : (
        <div className="board-focus-rows">
          {users.map((user) => (
            <div className="dp-hero-row" key={user.playerId}>
              <PlayerAvatar id={user.playerId} />
              <div className="dp-hero-info">
                <div className="h-name">{playerName(stats, user.playerId)}</div>
                <div className="h-sub">
                  {fmtCount(user.matches, "match")} · {fmtInt(user.wins)}W–{fmtInt(user.losses)}L ·{" "}
                  {fmtNum(user.kda)} KDA
                </div>
                <Bar pct={Number(user.win_rate) || 0} gold={Number(user.win_rate) >= 50} />
              </div>
              <div className="dp-hero-val">{fmtPct(user.win_rate)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DuoFocus({ entry }: { entry: LeaderboardEntry }) {
  const { stats } = useDashboard();
  const coverage = duoCoverage(stats, entry);

  return (
    <div className="board-focus">
      <div className="dp-summary">
        <span className="big">{fmtPct(entry.win_rate)}</span>
        <span className="sub">
          {fmtCount(entry.matches, "match")} together · {fmtInt(entry.wins)}W–{fmtInt(entry.losses)}L
        </span>
      </div>

      <h3 className="board-focus-title">Togetherness</h3>
      <div className="board-focus-rows">
        {coverage.map((part) => (
          <div className="dp-rank-row" key={part.playerId}>
            <div className="dp-rank-label">{playerName(stats, part.playerId)}</div>
            <Bar pct={part.share} />
            <div className="dp-rank-pos">
              <span className="v">{fmtPct(part.share)}</span>
              <span className="r">
                {fmtInt(entry.matches)} of {fmtInt(part.playerMatches)}
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="dp-empty">
        The share of each player’s own matches that this pairing accounts for.
      </p>
    </div>
  );
}

function RivalryFocus({ entry }: { entry: LeaderboardEntry }) {
  const { stats } = useDashboard();
  const pair = pairPlayers(entry);
  if (!pair) return null;
  const [a, b] = pair;
  const aWins = Number(entry.player_a_wins) || 0;
  const bWins = Number(entry.player_b_wins) || 0;

  const details: Array<[string, string, string]> = [
    [a, fmtPct(entry.player_a_win_rate), `${fmtInt(aWins)} wins`],
    [b, fmtPct(entry.player_b_win_rate), `${fmtInt(bWins)} wins`],
  ];

  return (
    <div className="board-focus">
      <div className="dp-summary">
        <span className="big">
          {fmtInt(aWins)}–{fmtInt(bWins)}
        </span>
        <span className="sub">{fmtCount(entry.matches, "meeting")}</span>
      </div>

      <div className="board-focus-rows">
        {details.map(([id, rate, wins]) => (
          <div className="dp-social-row" key={id}>
            <PlayerAvatar id={id} />
            <div className="dp-social-label">
              <span className="s-name">{playerName(stats, id)}</span>
              <span className="s-sub">{wins}</span>
            </div>
            <div className="dp-hero-val">{rate}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PartnershipsBlock() {
  const { stats } = useDashboard();
  const players = Object.keys(stats.players || {});
  const [playerId, setPlayerId] = useState(players[0] ?? "");

  if (!playerId) return null;
  const partners = partnershipsFor(stats, playerId);
  const maxMatches = Math.max(1, ...partners.map((partner) => Number(partner.matches) || 0));
  return (
    <div className="board-focus board-partnerships">
      <div className="section-head">
        <h3 className="dp-title">Partnerships for</h3>
        <label className="board-field">
          <span className="board-field-label">Player</span>
          <select
            className="board-select"
            value={playerId}
            onChange={(event) => setPlayerId(event.target.value)}
          >
            {players.map((id) => (
              <option key={id} value={id}>
                {playerName(stats, id)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="dp-empty">
        Every player {playerName(stats, playerId)} has queued with, best win rate first.
      </p>

      {partners.length === 0 ? (
        <p className="dp-empty">No shared matches yet.</p>
      ) : (
        <div className="board-focus-rows">
          {partners.map((partner) => {
            const other = partner.player_a === playerId ? partner.player_b : partner.player_a;
            const otherId = other ?? "";
            return (
              <div className="dp-hero-row" key={partner.id}>
                <PlayerAvatar id={otherId} />
                <div className="dp-hero-info">
                  <div className="h-name">{playerName(stats, otherId)}</div>
                  <div className="h-sub">
                    {fmtCount(partner.matches, "match")} · {fmtInt(partner.wins)}W–
                    {fmtInt(partner.losses)}L
                  </div>
                  <Bar pct={((Number(partner.matches) || 0) / maxMatches) * 100} />
                </div>
                <div className="dp-hero-val">{fmtPct(partner.win_rate)}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="dp-badges">
        <Badge label={`${partners.length} partner${partners.length === 1 ? "" : "s"}`} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-match history — lazily fetched from matches.json                */
/* ------------------------------------------------------------------ */

interface MatchesState {
  data: MatchesPayload | undefined;
  pending: boolean;
  failed: boolean;
}

const VISIBLE_MATCHES = 10;

function MatchHistoryBlock({
  state,
  title,
  hint,
  joiner,
  build,
  showPicker = false,
  withSummary = true,
  withCombos = false,
}: {
  state: MatchesState;
  title: string;
  hint: string;
  joiner: string;
  build: (payload: MatchesPayload) => MatchRow[];
  showPicker?: boolean;
  withSummary?: boolean;
  withCombos?: boolean;
}) {
  const { stats } = useDashboard();
  const rows = useMemo(() => (state.data ? build(state.data) : []), [state.data, build]);
  const history = useMemo(() => summarize(rows), [rows]);
  const combos = useMemo(() => (withCombos ? duoHeroCombos(rows) : []), [withCombos, rows]);
  const visible = rows.slice(0, VISIBLE_MATCHES);
  const unavailable = state.failed || !state.data;

  return (
    <div className="board-history">
      <h3 className="board-focus-title">{title}</h3>

      {state.pending ? <p className="dp-empty">Loading match history…</p> : null}

      {!state.pending && rows.length === 0 ? (
        <p className="dp-empty">
          {unavailable
            ? "Per-match history isn’t published for this deployment yet. This page still reflects the aggregate."
            : "No published match for this selection yet."}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <>
          <p className="dp-empty">{hint}</p>

          {withSummary ? (
            <div className="board-badges">
              <Badge label={fmtCount(history.total, "published match")} />
              <Badge label={`${fmtInt(history.wins)}W–${fmtInt(history.losses)}L`} />
              {history.streak && history.streak.length > 1 ? (
                <Badge
                  tone={history.streak.win ? "b3" : undefined}
                  label={`${history.streak.length} straight ${history.streak.win ? "wins" : "losses"}`}
                />
              ) : null}
              {history.lastPlayed !== null ? (
                <Badge label={`Last ${fmtEpochDate(history.lastPlayed)}`} />
              ) : null}
              {history.firstPlayed !== null && history.firstPlayed !== history.lastPlayed ? (
                <Badge label={`First ${fmtEpochDate(history.firstPlayed)}`} />
              ) : null}
            </div>
          ) : null}

          <div className="match-list">
            {visible.map((entry, index) => (
              <MatchHistoryRow
                key={`${entry.match.match_id}-${entry.players[0]?.account_id ?? "anon"}-${index}`}
                entry={entry}
                joiner={joiner}
                showPicker={showPicker}
                stats={stats}
              />
            ))}
          </div>

          {rows.length > visible.length ? (
            <p className="dp-empty">
              Showing the {visible.length} most recent of {fmtCount(rows.length, "published match")}.
            </p>
          ) : null}

          {combos.length > 0 ? (
            <>
              <h4 className="board-focus-subtitle">Hero combos</h4>
              <div className="match-combos">
                {combos.map((combo) => (
                  <span className="match-combo" key={combo.heroIds.join("+")}>
                    {combo.heroIds.map((heroId, index) => (
                      <Avatar
                        key={`${heroId}-${index}`}
                        heroId={Number(heroId) || null}
                        name={combo.labels[index]}
                        size="sm"
                      />
                    ))}
                    <span className="match-combo-meta">
                      {combo.matches}× · {fmtPct((combo.wins / combo.matches) * 100)}
                    </span>
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MatchHistoryRow({
  entry,
  joiner,
  showPicker,
  stats,
}: {
  entry: MatchRow;
  joiner: string;
  showPicker: boolean;
  stats: Stats;
}) {
  const heroLabels = entry.players.map((player) => player.hero_name ?? heroName(stats, player.hero_id));
  const primary = entry.players[0];
  const picker = primary?.account_id ? playerName(stats, primary.account_id) : null;
  const sub = [fmtDuration(entry.match.duration), showPicker && picker ? picker : null, `#${entry.match.match_id}`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="match-row">
      <span className="match-date">{fmtEpochDate(entry.match.start_time)}</span>
      <span className="match-heroes">
        {entry.players.map((player, index) => (
          <Avatar
            key={`${player.account_id ?? "anon"}-${index}`}
            heroId={Number(player.hero_id) || null}
            name={heroLabels[index]}
            size="sm"
          />
        ))}
      </span>
      <span className="match-main">
        <span className="match-title">{heroLabels.join(` ${joiner} `)}</span>
        <span className="match-sub">{sub}</span>
      </span>
      <span className="match-kda">
        {fmtInt(primary?.kills)}/{fmtInt(primary?.deaths)}/{fmtInt(primary?.assists)}
      </span>
      <span className={`match-result ${entry.win ? "win" : "loss"}`}>{entry.win ? "W" : "L"}</span>
    </div>
  );
}
