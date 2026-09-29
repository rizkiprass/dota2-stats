"use strict";

// Dota 2 Lobby Stats – vanilla static dashboard.
// Fetches ./stats.json (published into this website bucket by the aggregator)
// and renders summary cards, leaderboards, and detail tables.

const $ = (id) => document.getElementById(id);

let STATS = null;
let HERO_NAMES = {};

/* ---------------- formatting helpers ---------------- */

function fmtInt(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function fmtPct(value) {
  if (value === null || value === undefined) return "—";
  return `${fmtNum(value, 2)}%`;
}

function fmtDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.round(Number(seconds));
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/* ---------------- data helpers ---------------- */

function playerName(id) {
  const p = STATS?.players?.[id];
  return (p && p.player_name) || id;
}

function heroName(heroId) {
  const key = String(heroId);
  return HERO_NAMES[key] || STATS?.heroes?.[key]?.hero_name || `Hero ${heroId}`;
}

function playerLabel(id) {
  const span = document.createElement("span");
  span.className = "name";
  span.textContent = playerName(id);
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = id;
  span.appendChild(tag);
  return span;
}

/* ---------------- generic table renderer ---------------- */

function renderTable(container, columns, rows) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col.label;
    if (col.num) th.classList.add("num");
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      if (col.num) td.classList.add("num");
      const value = col.render ? col.render(row) : row[col.key];
      if (value instanceof Node) td.appendChild(value);
      else td.textContent = value ?? "—";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.replaceChildren(table);
}

/* ---------------- sections ---------------- */

function renderSummary() {
  const s = STATS.summary;
  const cards = [
    ["Total Matches", fmtInt(s.total_matches)],
    ["Total Players", fmtInt(s.total_players)],
    ["Total Hero Picks", fmtInt(s.total_hero_picks)],
    ["Average Duration", fmtDuration(s.average_duration_seconds)],
    ["Radiant Wins", `${fmtInt(s.radiant_wins)} · ${fmtPct(s.radiant_win_rate)}`, "radiant"],
    ["Dire Wins", `${fmtInt(s.dire_wins)} · ${fmtPct(s.dire_win_rate)}`, "dire"],
  ];
  const frag = document.createDocumentFragment();
  for (const [label, value, cls] of cards) {
    const card = document.createElement("div");
    card.className = "card";
    const l = document.createElement("div");
    l.className = "label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "value" + (cls ? ` ${cls}` : "");
    v.textContent = value;
    card.append(l, v);
    frag.appendChild(card);
  }
  $("summary").replaceChildren(frag);
  $("summary-section").hidden = false;
}

const LEADERBOARD_TITLES = {
  most_matches: "Most Matches",
  highest_win_rate: "Highest Win Rate",
  most_kills: "Most Kills",
  best_kda: "Best KDA",
  most_assists: "Most Assists",
  most_picked_hero: "Most Picked Hero",
  best_hero_win_rate: "Best Hero Win Rate",
  best_duo_win_rate: "Best Duo Win Rate",
  most_played_duo: "Most Played Duo",
  most_played_rivalry: "Most Played Rivalry",
};

// Which value column to show for each leaderboard category.
const LEADERBOARD_VALUE = {
  most_matches: { label: "Matches", render: (e) => fmtInt(e.matches) },
  highest_win_rate: { label: "Win %", render: (e) => fmtPct(e.win_rate) },
  most_kills: { label: "Kills", render: (e) => fmtInt(e.kills) },
  best_kda: { label: "KDA", render: (e) => fmtNum(e.kda) },
  most_assists: { label: "Assists", render: (e) => fmtInt(e.assists) },
  most_picked_hero: { label: "Picks", render: (e) => `${fmtInt(e.picks)} · ${fmtPct(e.win_rate)}` },
  best_hero_win_rate: { label: "Win %", render: (e) => `${fmtPct(e.win_rate)} · ${fmtInt(e.matches)} matches` },
  best_duo_win_rate: { label: "Win %", render: (e) => `${fmtPct(e.win_rate)} · ${fmtInt(e.matches)} matches` },
  most_played_duo: { label: "Matches", render: (e) => `${fmtInt(e.matches)} · ${fmtPct(e.win_rate)}` },
  most_played_rivalry: { label: "Matches", render: (e) => fmtInt(e.matches) },
};

function leaderboardEntryLabel(category, entry) {
  if (entry.player_id !== undefined && entry.hero_id !== undefined) {
    const span = document.createElement("span");
    span.append(playerLabel(entry.player_id), document.createTextNode(" · "));
    const hero = document.createElement("span");
    hero.className = "name";
    hero.textContent = heroName(entry.hero_id);
    span.appendChild(hero);
    return span;
  }
  if (entry.hero_id !== undefined) {
    const span = document.createElement("span");
    span.className = "name";
    span.textContent = heroName(entry.hero_id);
    return span;
  }
  if (entry.player_a !== undefined && entry.player_b !== undefined) {
    const span = document.createElement("span");
    span.append(playerLabel(entry.player_a), document.createTextNode(" vs "));
    span.appendChild(playerLabel(entry.player_b));
    return span;
  }
  return playerLabel(entry.id);
}

function renderLeaderboards() {
  const boards = STATS.leaderboards || {};
  const grid = document.createDocumentFragment();

  for (const [category, entries] of Object.entries(boards)) {
    const card = document.createElement("div");
    card.className = "lb";
    const h = document.createElement("h3");
    h.textContent = LEADERBOARD_TITLES[category] || category;
    card.appendChild(h);

    if (!entries || entries.length === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "No data yet.";
      card.appendChild(p);
    } else {
      const valueCol = LEADERBOARD_VALUE[category] || { label: "Value", render: (e) => fmtNum(e.value) };
      // Render into a dedicated host: renderTable() calls replaceChildren on its
      // container, and the card must keep its <h3> title.
      const tableHost = document.createElement("div");
      renderTable(
        tableHost,
        [
          { label: "#", render: () => "", num: true },
          { label: "Entry", render: (e) => leaderboardEntryLabel(category, e) },
          { label: valueCol.label, render: valueCol.render, num: true },
        ],
        entries.slice(0, 5),
      );
      card.appendChild(tableHost);
      // Fill the rank column after render (keeps renderTable generic).
      tableHost.querySelectorAll("tbody tr").forEach((tr, i) => {
        const td = tr.cells[0];
        if (td) td.textContent = String(i + 1);
      });
    }
    grid.appendChild(card);
  }

  $("leaderboards").replaceChildren(grid);
  $("leaderboards-section").hidden = false;
}

function renderPlayers() {
  const rows = Object.entries(STATS.players).map(([id, rec]) => ({ id, ...rec }));
  rows.sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate || b.kills - a.kills);
  renderTable(
    $("players"),
    [
      { label: "Player", render: (r) => playerLabel(r.id) },
      { label: "Matches", key: "matches", num: true },
      { label: "W", key: "wins", num: true },
      { label: "L", key: "losses", num: true },
      { label: "Win %", render: (r) => fmtPct(r.win_rate), num: true },
      { label: "Kills", key: "kills", num: true },
      { label: "Deaths", key: "deaths", num: true },
      { label: "Assists", key: "assists", num: true },
      { label: "KDA", render: (r) => fmtNum(r.kda), num: true },
    ],
    rows,
  );
  $("players-section").hidden = false;
}

function renderHeroes() {
  const rows = Object.values(STATS.heroes);
  rows.sort((a, b) => b.picks - a.picks || b.win_rate - a.win_rate);
  renderTable(
    $("heroes"),
    [
      { label: "Hero", render: (r) => r.hero_name || `Hero ${r.hero_id}` },
      { label: "Picks", key: "picks", num: true },
      { label: "W", key: "wins", num: true },
      { label: "L", key: "losses", num: true },
      { label: "Win %", render: (r) => fmtPct(r.win_rate), num: true },
    ],
    rows,
  );
  $("heroes-section").hidden = false;
}

function renderTeammates() {
  const rows = Object.values(STATS.teammates);
  rows.sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate);
  renderTable(
    $("teammates"),
    [
      { label: "Pair", render: (r) => {
        const span = document.createElement("span");
        span.append(playerLabel(r.player_a), document.createTextNode(" + "));
        span.appendChild(playerLabel(r.player_b));
        return span;
      } },
      { label: "Matches", key: "matches", num: true },
      { label: "W", key: "wins", num: true },
      { label: "L", key: "losses", num: true },
      { label: "Win %", render: (r) => fmtPct(r.win_rate), num: true },
    ],
    rows,
  );
  $("teammates-section").hidden = false;
}

function renderHeadToHead() {
  const rows = Object.values(STATS.head_to_head);
  rows.sort((a, b) => b.matches - a.matches || b.player_a_win_rate - a.player_a_win_rate);
  renderTable(
    $("h2h"),
    [
      { label: "Rival", render: (r) => {
        const span = document.createElement("span");
        span.append(playerLabel(r.player_a), document.createTextNode(" vs "));
        span.appendChild(playerLabel(r.player_b));
        return span;
      } },
      { label: "Matches", key: "matches", num: true },
      { label: "A wins", key: "player_a_wins", num: true },
      { label: "B wins", key: "player_b_wins", num: true },
      { label: "A win %", render: (r) => fmtPct(r.player_a_win_rate), num: true },
      { label: "B win %", render: (r) => fmtPct(r.player_b_win_rate), num: true },
    ],
    rows,
  );
  $("h2h-section").hidden = false;
}

/* ---------------- boot ---------------- */

function renderAll() {
  HERO_NAMES = Object.fromEntries(
    Object.entries(STATS.heroes || {}).map(([id, r]) => [id, r.hero_name]),
  );
  const meta = STATS.metadata || {};
  $("meta").textContent =
    `${fmtInt(meta.source_match_count)} matches · last built ${fmtDate(meta.generated_at)}`;
  $("footer").textContent =
    "Dota 2 private-lobby statistics · built from replays parsed and aggregated on AWS.";
  renderSummary();
  renderLeaderboards();
  renderPlayers();
  renderHeroes();
  renderTeammates();
  renderHeadToHead();
  $("status").hidden = true;
}

async function boot() {
  try {
    const res = await fetch("./stats.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    STATS = await res.json();
    renderAll();
  } catch (error) {
    $("status").textContent =
      `Could not load stats.json (${error.message}). Make sure the aggregator has published it.`;
  }
}

boot();
