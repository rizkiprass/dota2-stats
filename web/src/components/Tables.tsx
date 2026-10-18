import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PlayerCell } from "./ui";
import { fmtInt, fmtNum, fmtPct } from "../lib/format";
import { playerName } from "../lib/derived";
import type { PlayerRecord, Stats } from "../types/stats";

interface Column<T> {
  label: string;
  num?: boolean;
  render: (row: T) => ReactNode;
}

function Table<T>({ columns, rows, className = "" }: { columns: Array<Column<T>>; rows: T[]; className?: string }) {
  return (
    <div className={`card table-card ${className}`}>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.label} className={col.num ? "num" : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="table-empty" colSpan={columns.length}>
                <strong>No records yet</strong>
                <span>There’s no data to show in this section yet.</span>
              </td>
            </tr>
          ) : rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.label} className={col.num ? "num" : undefined}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PlayerRow = { id: string } & PlayerRecord;

export function Players({ stats }: { stats: Stats }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const all = useMemo<PlayerRow[]>(
    () => Object.entries(stats.players).map(([id, rec]) => ({ id, ...rec })),
    [stats.players],
  );

  const trimmed = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const filtered = trimmed
      ? all.filter(
          (row) =>
            (row.player_name ?? "").toLowerCase().includes(trimmed) ||
            row.id.toLowerCase().includes(trimmed),
        )
      : all;
    return [...filtered].sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate || b.kills - a.kills);
  }, [all, trimmed]);

  return (
    <section className="section" id="players">
      <div className="section-head">
        <h2 className="section-title">Players</h2>
        <div className="table-search">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search players"
            aria-label="Search players by name or account id"
          />
          <kbd aria-hidden="true">/</kbd>
        </div>
      </div>
      {trimmed ? (
        <p className="search-count">
          {fmtInt(rows.length)} of {fmtInt(all.length)} players
        </p>
      ) : null}
      <Table
        rows={rows}
        className="player-table"
        columns={[
          { label: "Player", render: (r) => <PlayerCell id={r.id} sub={`${fmtInt(r.matches)} matches`} /> },
          { label: "W", num: true, render: (r) => r.wins },
          { label: "L", num: true, render: (r) => r.losses },
          { label: "Win %", num: true, render: (r) => fmtPct(r.win_rate) },
          { label: "Kills", num: true, render: (r) => r.kills },
          { label: "Deaths", num: true, render: (r) => r.deaths },
          { label: "Assists", num: true, render: (r) => r.assists },
          { label: "KDA", num: true, render: (r) => fmtNum(r.kda) },
        ]}
      />
    </section>
  );
}

export function Teammates({ stats }: { stats: Stats }) {
  const rows = Object.values(stats.teammates);
  rows.sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate);
  return (
    <section className="section">
      <h2 className="section-title">Teammate Pairs</h2>
      <Table
        rows={rows}
        columns={[
          {
            label: "Pair",
            render: (r) => (
              <PlayerCell
                id={r.player_a}
                sub={`${fmtInt(r.matches)} matches · with ${playerName(stats, r.player_b)}`}
              />
            ),
          },
          { label: "W", num: true, render: (r) => r.wins },
          { label: "L", num: true, render: (r) => r.losses },
          { label: "Win %", num: true, render: (r) => fmtPct(r.win_rate) },
        ]}
      />
    </section>
  );
}

export function HeadToHead({ stats }: { stats: Stats }) {
  const rows = Object.values(stats.head_to_head);
  rows.sort((a, b) => b.matches - a.matches || b.player_a_win_rate - a.player_a_win_rate);
  return (
    <section className="section">
      <h2 className="section-title">Head-to-Head</h2>
      <Table
        rows={rows}
        columns={[
          { label: "Rival", render: (r) => <PlayerCell id={r.player_a} sub={`vs ${playerName(stats, r.player_b)}`} /> },
          { label: "Matches", num: true, render: (r) => r.matches },
          {
            label: "A win %",
            num: true,
            render: (r) => <span className={r.player_a_win_rate >= 50 ? "win" : "loss"}>{fmtPct(r.player_a_win_rate)}</span>,
          },
          {
            label: "B win %",
            num: true,
            render: (r) => <span className={r.player_b_win_rate >= 50 ? "win" : "loss"}>{fmtPct(r.player_b_win_rate)}</span>,
          },
        ]}
      />
    </section>
  );
}
