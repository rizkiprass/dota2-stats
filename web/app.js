"use strict";

// Dota 2 Lobby Stats – vanilla static dashboard.
// Fetches ./stats.json (published into this website bucket by the aggregator)
// and renders a card-based summary, leaderboards, and detail tables.
// Hero artwork comes from the Dota CDN via web/heroes.js.

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

// The hero a player has played most often (used as their portrait).
function playerTopHero(id) {
  const heroRecords = STATS?.player_heroes?.[id];
  if (!heroRecords) return null;
  let bestId = null;
  let bestMatches = -1;
  for (const [heroId, record] of Object.entries(heroRecords)) {
    if ((record.matches || 0) > bestMatches) {
      bestMatches = record.matches || 0;
      bestId = Number(heroId);
    }
  }
  return bestId;
}

function initials(name) {
  const text = String(name ?? "").trim();
  if (!text) return "?";
  return text.replace(/[^A-Za-z0-9]+/g, " ").trim().charAt(0).toUpperCase() || "?";
}

// Deterministic avatar tint from one of the tokenized accent hues.
const AVATAR_TINTS = ["--av1", "--av2", "--av3", "--av4", "--av5", "--av6"];
function tintFor(seed) {
  let hash = 0;
  const text = String(seed ?? "");
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return `var(${AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length]})`;
}

function avatarElement({ heroId = null, name = "", cls = "" } = {}) {
  const el = document.createElement("span");
  el.className = "avatar" + (cls ? ` ${cls}` : "");
  const url = typeof heroCropUrl === "function" ? heroCropUrl(heroId) : null;
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = name || "hero";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => showInitial(el, name), { once: true });
    el.appendChild(img);
  } else {
    showInitial(el, name);
  }
  return el;
}

function showInitial(el, name) {
  el.replaceChildren(document.createTextNode(initials(name)));
  el.classList.add("initial");
  el.style.setProperty("--av", tintFor(name));
}

function playerAvatar(id, cls = "") {
  return avatarElement({ heroId: playerTopHero(id), name: playerName(id), cls });
}

// Avatar + name + optional subtext, used in table/leaderboard rows.
// The name is a button so it can open the player detail drawer.
function playerCell(id, sub = null) {
  const wrap = document.createElement("span");
  wrap.className = "pcell";
  wrap.appendChild(attachPlayer(playerAvatar(id), id));
  const info = document.createElement("span");
  info.className = "pinfo";
  info.appendChild(playerButton(id, playerName(id), "pname"));
  if (sub) {
    const small = document.createElement("span");
    small.className = "psub";
    small.textContent = sub;
    info.appendChild(small);
  }
  wrap.appendChild(info);
  return wrap;
}

// A button that opens a player's detail drawer.
function playerButton(id, text, className) {
  const button = el("button", className ? `${className} player-link` : "player-link", text);
  button.type = "button";
  button.dataset.player = id;
  button.title = `View ${playerName(id)}'s details`;
  return button;
}

// Make any node open a player's drawer when clicked (event delegation target).
function attachPlayer(node, id) {
  if (id === null || id === undefined) return node;
  node.dataset.player = id;
  node.classList.add("player-link");
  node.title = `View ${playerName(id)}'s details`;
  return node;
}

// A pair of overlapping avatars (teammates / rivals).
function avatarPair(a, b) {
  const wrap = document.createElement("span");
  wrap.className = "avatar-pair";
  wrap.append(playerAvatar(a), playerAvatar(b));
  return wrap;
}

/* ---------------- inline icons ---------------- */

const ICON_PATHS = {
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  users:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5v-1a5 5 0 0 1 5-5h1a5 5 0 0 1 5 5v1"/>' +
    '<path d="M16 4.6a3.2 3.2 0 0 1 0 6.1"/><path d="M17.4 13.6a5 5 0 0 1 3.1 4.6v1.3"/>',
  sparkles:
    '<path d="M12 3.5 13.6 8l4.5 1.6-4.5 1.6L12 15.7l-1.6-4.5L5.9 9.6 10.4 8z"/>' +
    '<path d="M18.5 15.2l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>',
  clock: '<circle cx="12" cy="12" r="8.3"/><path d="M12 7.6V12l3 2"/>',
  scale:
    '<path d="M12 3.5v17"/><path d="M6 7h12"/><path d="M5.5 7 3 13h5z"/><path d="M18.5 7 21 13h-5z"/>',
  check: '<path d="m5 12.6 4.2 4.2L19 7"/>',
};

function iconNode(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = ICON_PATHS[name] || "";
  return svg;
}

function tileNode(icon, variant = "") {
  const tile = document.createElement("div");
  tile.className = "tile" + (variant ? ` ${variant}` : "");
  tile.appendChild(iconNode(icon));
  return tile;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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

/* ---------------- summary ---------------- */

// Strip of the most-picked heroes, echoing the reference's stat-tile row.
function renderHeroTiles() {
  const heroes = Object.values(STATS.heroes || {});
  if (heroes.length === 0) return null;
  heroes.sort((a, b) => b.picks - a.picks || b.win_rate - a.win_rate);
  const top = heroes.slice(0, 6);
  const maxPicks = Math.max(...top.map((h) => h.picks), 1);
  const tints = ["--av1", "--av2", "--av3", "--av4", "--av1", "--av3"];

  const row = el("div", "tiles-row");
  top.forEach((hero, i) => {
    const cell = el("div", "stat-tile");
    cell.title = `${hero.hero_name} · ${fmtInt(hero.picks)} picks · ${fmtPct(hero.win_rate)} win rate`;

    cell.appendChild(el("div", "st-val", fmtInt(hero.picks)));

    const bar = el("div", "st-bar");
    const fill = el("i");
    fill.style.width = `${Math.round((hero.picks / maxPicks) * 100)}%`;
    bar.appendChild(fill);
    cell.appendChild(bar);

    const img = el("div", "st-img");
    img.style.setProperty("--tile-accent", `var(${tints[i % tints.length]})`);
    const url = typeof heroCropUrl === "function" ? heroCropUrl(hero.hero_id) : null;
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = hero.hero_name;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => { image.remove(); }, { once: true });
      img.appendChild(image);
    }
    cell.appendChild(img);
    row.appendChild(cell);
  });
  return row;
}

function renderMatchesCard(s) {
  const card = el("div", "card kpi");
  const head = el("div", "card-head");
  const left = el("div");
  left.append(
    el("div", "kpi-label", "Matches Parsed"),
    el("div", "kpi-value", fmtInt(s.total_matches)),
    el("div", "kpi-sub", `across ${fmtInt(s.total_players)} players · ${fmtInt(s.total_hero_picks)} hero picks`),
  );
  head.append(left, tileNode("layers", "green"));
  card.appendChild(head);
  const tiles = renderHeroTiles();
  if (tiles) card.appendChild(tiles);
  return card;
}

function renderSplitCard(s) {
  const radiant = Number(s.radiant_win_rate) || 0;
  const dire = Number(s.dire_win_rate) || 0;
  const card = el("div", "card kpi split-card");

  const head = el("div", "card-head");
  const left = el("div");
  const lead = radiant >= dire ? "Radiant" : "Dire";
  left.append(
    el("div", "kpi-label", "Radiant vs Dire"),
    el("div", "kpi-value", fmtPct(radiant)),
    el("div", "kpi-sub", `${fmtInt(s.radiant_wins)} Radiant wins · ${fmtInt(s.dire_wins)} Dire wins`),
  );
  head.append(left, tileNode("scale", "gold"));
  card.appendChild(head);

  const bar = el("div", "splitbar");
  const r = el("i", "r");
  r.style.width = `${radiant}%`;
  const d = el("i", "d");
  d.style.width = `${dire}%`;
  bar.append(r, d);
  card.appendChild(bar);

  const legend = el("div", "legend");
  const lgR = el("div", "lg");
  lgR.append(el("span", "dot r"), el("b", null, fmtPct(radiant)), el("span", null, `Radiant · ${fmtInt(s.radiant_wins)}`));
  const lgD = el("div", "lg right");
  lgD.append(el("span", null, `Dire · ${fmtInt(s.dire_wins)}`), el("b", null, fmtPct(dire)), el("span", "dot d"));
  legend.append(lgR, lgD);
  card.appendChild(legend);

  const gap = Math.abs(radiant - dire);
  const delta = el("div", "delta" + (gap < 1 ? " neutral" : ""));
  const icon = el("span", "delta-icon");
  icon.appendChild(iconNode("check"));
  let text;
  if (gap < 1) text = "Win rates are evenly split";
  else text = `${lead} favoured by ${fmtNum(gap, 1)} pts over even`;
  delta.append(icon, el("span", null, text));
  card.appendChild(delta);
  return card;
}

function renderGlanceCard(s) {
  const card = el("div", "card kpi");
  const head = el("div", "card-head");
  head.append(el("div", "card-title", "At a glance"), tileNode("users"));
  card.appendChild(head);

  const rows = el("div", "stat-rows");
  const entries = [
    ["users", "Total Players", fmtInt(s.total_players)],
    ["sparkles", "Total Hero Picks", fmtInt(s.total_hero_picks)],
    ["clock", "Average Duration", fmtDuration(s.average_duration_seconds)],
  ];
  for (const [icon, label, value] of entries) {
    const row = el("div", "stat-row");
    row.append(tileNode(icon, "sm"), el("div", "sr-label", label), el("div", "sr-value", value));
    rows.appendChild(row);
  }
  card.appendChild(rows);
  return card;
}

function renderSummary() {
  const s = STATS.summary;
  const frag = document.createDocumentFragment();
  frag.append(renderMatchesCard(s), renderSplitCard(s), renderGlanceCard(s));
  $("summary").replaceChildren(frag);
  $("summary-section").hidden = false;
}

/* ---------------- leaderboards ---------------- */

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

// Value shown on the right + numeric metric that sizes the progress bar.
const LEADERBOARD_VALUE = {
  most_matches: { value: (e) => fmtInt(e.matches), metric: (e) => e.matches },
  highest_win_rate: { value: (e) => fmtPct(e.win_rate), metric: (e) => e.win_rate, pill: true },
  most_kills: { value: (e) => fmtInt(e.kills), metric: (e) => e.kills },
  best_kda: { value: (e) => fmtNum(e.kda), metric: (e) => e.kda },
  most_assists: { value: (e) => fmtInt(e.assists), metric: (e) => e.assists },
  most_picked_hero: { value: (e) => fmtInt(e.picks), metric: (e) => e.picks },
  best_hero_win_rate: { value: (e) => fmtPct(e.win_rate), metric: (e) => e.win_rate, pill: true },
  best_duo_win_rate: { value: (e) => fmtPct(e.win_rate), metric: (e) => e.win_rate, pill: true },
  most_played_duo: { value: (e) => fmtInt(e.matches), metric: (e) => e.matches },
  most_played_rivalry: { value: (e) => fmtInt(e.matches), metric: (e) => e.matches },
};

function leaderboardRow(category, entry, maxMetric, gold) {
  const row = el("div", "lb-row");
  const rank = el("div", "lb-rank", "–");
  row.appendChild(rank);

  let avatar;
  let name;
  let sub = null;
  let primaryId = null;
  if (entry.player_id !== undefined && entry.hero_id !== undefined) {
    primaryId = entry.player_id;
    avatar = playerAvatar(primaryId);
    name = playerName(primaryId);
    sub = heroName(entry.hero_id);
  } else if (entry.player_a !== undefined && entry.player_b !== undefined) {
    primaryId = entry.player_a;
    avatar = avatarPair(entry.player_a, entry.player_b);
    name = playerName(entry.player_a);
    sub = `${category === "best_duo_win_rate" || category === "most_played_duo" ? "with" : "vs"} ${playerName(entry.player_b)}`;
  } else if (entry.hero_id !== undefined && entry.player_id === undefined) {
    avatar = avatarElement({ heroId: entry.hero_id, name: entry.hero_name || "hero" });
    name = entry.hero_name || `Hero ${entry.hero_id}`;
  } else {
    primaryId = entry.id;
    avatar = playerAvatar(entry.id);
    name = playerName(entry.id);
  }
  if (primaryId !== null) attachPlayer(avatar, primaryId);
  row.appendChild(avatar);

  const main = el("div", "lb-main");
  const nameEl = el("div", "lb-name");
  if (primaryId !== null) nameEl.appendChild(playerButton(primaryId, name, ""));
  else nameEl.textContent = name;
  if (sub) nameEl.appendChild(el("span", "sub", ` · ${sub}`));
  main.appendChild(nameEl);

  const metric = Number(LEADERBOARD_VALUE[category]?.metric(entry) ?? 0);
  // Win-rate bars are relative to 100; volume bars relative to the leader.
  const scale = category.includes("win_rate") ? 100 : maxMetric;
  const bar = el("div", "bar" + (gold ? " gold" : ""));
  const fill = el("i");
  fill.style.width = `${Math.max(2, Math.min(100, (metric / (scale || 1)) * 100))}%`;
  bar.appendChild(fill);
  main.appendChild(bar);
  row.appendChild(main);

  const spec = LEADERBOARD_VALUE[category];
  const value = el("div", "lb-val", spec ? spec.value(entry) : fmtNum(metric));
  if (spec?.pill) {
    value.replaceChildren(el("span", "pill-value", spec.value(entry)));
  }
  row.appendChild(value);
  return row;
}

function renderLeaderboards() {
  const boards = STATS.leaderboards || {};
  const frag = document.createDocumentFragment();

  for (const [category, entries] of Object.entries(boards)) {
    const card = el("div", "lb");
    card.appendChild(el("h3", null, LEADERBOARD_TITLES[category] || category));

    if (!entries || entries.length === 0) {
      card.appendChild(el("p", "empty", "No data yet."));
    } else {
      const shown = entries.slice(0, 5);
      const maxMetric = Math.max(...shown.map((e) => Number(LEADERBOARD_VALUE[category]?.metric(e) ?? 0)), 1);
      const gold = category.includes("win_rate");
      shown.forEach((entry, i) => {
        const row = leaderboardRow(category, entry, maxMetric, gold);
        const rank = row.querySelector(".lb-rank");
        rank.textContent = String(i + 1);
        if (i === 0) rank.classList.add("top");
        card.appendChild(row);
      });
    }
    frag.appendChild(card);
  }

  $("leaderboards").replaceChildren(frag);
  $("leaderboards-section").hidden = false;
}

/* ---------------- detail sections ---------------- */

function renderPlayers() {
  const rows = Object.entries(STATS.players).map(([id, rec]) => ({ id, ...rec }));
  rows.sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate || b.kills - a.kills);
  renderTable(
    $("players"),
    [
      { label: "Player", render: (r) => playerCell(r.id, `${fmtInt(r.matches)} matches`) },
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
  const heroes = Object.values(STATS.heroes);
  heroes.sort((a, b) => b.picks - a.picks || b.win_rate - a.win_rate);
  const tints = ["--av1", "--av2", "--av3", "--av4", "--av5", "--av6"];

  const grid = el("div", "hero-grid");
  heroes.forEach((hero, i) => {
    const tile = el("div", "hero-tile");
    tile.style.setProperty("--tile-accent", `var(${tints[i % tints.length]})`);

    const img = el("div", "ht-img");
    const url = typeof heroCropUrl === "function" ? heroCropUrl(hero.hero_id) : null;
    if (url) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = hero.hero_name || `Hero ${hero.hero_id}`;
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => { image.remove(); }, { once: true });
      img.appendChild(image);
    }
    tile.appendChild(img);

    const body = el("div", "ht-body");
    body.appendChild(el("div", "ht-name", hero.hero_name || `Hero ${hero.hero_id}`));
    const stats = el("div", "ht-stats");
    stats.append(el("span", null, `${fmtInt(hero.picks)} picks`), el("span", null, fmtPct(hero.win_rate)));
    body.appendChild(stats);
    const bar = el("div", "bar");
    const fill = el("i");
    fill.style.width = `${Math.max(2, Math.min(100, Number(hero.win_rate) || 0))}%`;
    bar.appendChild(fill);
    body.appendChild(bar);
    tile.appendChild(body);
    grid.appendChild(tile);
  });

  $("heroes").replaceChildren(grid);
  $("heroes-section").hidden = false;
}

function renderTeammates() {
  const rows = Object.values(STATS.teammates);
  rows.sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate);
  renderTable(
    $("teammates"),
    [
      { label: "Pair", render: (r) => playerCell(r.player_a, `${fmtInt(r.matches)} matches · with ${playerName(r.player_b)}`) },
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
      { label: "Rival", render: (r) => playerCell(r.player_a, `vs ${playerName(r.player_b)}`) },
      { label: "Matches", key: "matches", num: true },
      {
        label: "A win %",
        render: (r) => {
          const span = el("span", Number(r.player_a_win_rate) >= 50 ? "win" : "loss");
          span.textContent = fmtPct(r.player_a_win_rate);
          return span;
        },
        num: true,
      },
      {
        label: "B win %",
        render: (r) => {
          const span = el("span", Number(r.player_b_win_rate) >= 50 ? "win" : "loss");
          span.textContent = fmtPct(r.player_b_win_rate);
          return span;
        },
        num: true,
      },
    ],
    rows,
  );
  $("h2h-section").hidden = false;
}

/* ---------------- player detail drawer ---------------- */

const NS = "http://www.w3.org/2000/svg";

let drawerOpen = false;
let lastFocused = null;

function playerIdFromHash() {
  const match = decodeURIComponent(location.hash || "").match(/player=([^&]+)/);
  return match ? match[1] : null;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function lobbyIds() {
  return Object.keys(STATS?.players || {});
}

function metricValues(metric) {
  return lobbyIds().map((id) => Number(STATS.players[id][metric]) || 0);
}

// Rank of a value (1 = best); ties share the best position.
function rankOf(metric, value) {
  const sorted = metricValues(metric).sort((a, b) => b - a);
  const index = sorted.findIndex((v) => v <= value);
  return { rank: index < 0 ? sorted.length : index + 1, total: sorted.length };
}

function heroPoolSize(id) {
  return Object.keys(STATS?.player_heroes?.[id] || {}).length;
}

function bestDuoFor(id) {
  const duos = Object.values(STATS.teammates || {})
    .filter((t) => t.player_a === id || t.player_b === id)
    .map((t) => ({
      other: t.player_a === id ? t.player_b : t.player_a,
      matches: t.matches,
      win_rate: t.win_rate,
    }));
  const eligible = duos.filter((d) => d.matches >= 3);
  const pool = eligible.length ? eligible : duos;
  const best = pool.slice().sort((a, b) => b.win_rate - a.win_rate || b.matches - a.matches)[0] || null;
  const most = duos.slice().sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate)[0] || null;
  return { best, most };
}

function rivalriesFor(id) {
  return Object.values(STATS.head_to_head || {})
    .filter((h) => h.player_a === id || h.player_b === id)
    .map((h) => ({
      other: h.player_a === id ? h.player_b : h.player_a,
      matches: h.matches,
      win_rate: h.player_a === id ? h.player_a_win_rate : h.player_b_win_rate,
    }));
}

function computeBadges(id, player) {
  const badges = [];
  const maxMatches = Math.max(...lobbyIds().map((pid) => Number(STATS.players[pid].matches) || 0), 0);
  if (maxMatches > 0 && Number(player.matches) >= maxMatches) badges.push(["Veteran", "b2"]);
  if (Number(player.kda) >= 4) badges.push(["Sharpshooter", "b1"]);
  if (Number(player.win_rate) >= 60) badges.push(["Rock Solid", "b3"]);
  const duo = bestDuoFor(id).best;
  if (duo && duo.win_rate >= 60) badges.push(["Duo King", "b2"]);
  if (heroPoolSize(id) >= 8) badges.push(["Hero Pool Master", "b1"]);
  const rivals = rivalriesFor(id).filter((r) => r.matches >= 3);
  if (rivals.length && Math.min(...rivals.map((r) => r.win_rate)) <= 30) badges.push(["Nemesis", "b3"]);
  return badges;
}

function buildBar(pct, gold = false) {
  const bar = el("div", "bar" + (gold ? " gold" : ""));
  const fill = el("i");
  fill.style.width = `${Math.max(2, Math.min(100, pct || 0))}%`;
  bar.appendChild(fill);
  return bar;
}

function dpSection(title) {
  const section = el("section", "dp-section");
  if (title) section.appendChild(el("h4", "dp-title", title));
  return section;
}

// Hexagon radar: player polygon over the lobby-average polygon.
function renderRadar(axes) {
  const width = 320;
  const height = 262;
  const cx = 160;
  const cy = 136;
  const radius = 86;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Player compared with the lobby average");

  const count = axes.length;
  const point = (i, r) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };
  const polygon = (radii) => {
    const poly = document.createElementNS(NS, "polygon");
    poly.setAttribute("points", radii.map((r, i) => point(i, r).join(",")).join(" "));
    return poly;
  };

  for (const level of [0.25, 0.5, 0.75, 1]) {
    const ring = polygon(axes.map(() => radius * level));
    ring.style.fill = "none";
    ring.style.stroke = "var(--border-strong)";
    ring.style.strokeWidth = "1";
    svg.appendChild(ring);
  }
  axes.forEach((_, i) => {
    const [x, y] = point(i, radius);
    const spoke = document.createElementNS(NS, "line");
    spoke.setAttribute("x1", cx);
    spoke.setAttribute("y1", cy);
    spoke.setAttribute("x2", x);
    spoke.setAttribute("y2", y);
    spoke.style.stroke = "var(--border)";
    svg.appendChild(spoke);
  });

  const avg = polygon(axes.map((a) => radius * Math.max(a.avgNorm, 0.02)));
  avg.style.fill = "var(--panel-3)";
  avg.style.fillOpacity = "0.75";
  avg.style.stroke = "var(--border-strong)";
  svg.appendChild(avg);

  const me = polygon(axes.map((a) => radius * Math.max(a.norm, 0)));
  me.style.fill = "var(--accent-soft)";
  me.style.stroke = "var(--accent)";
  me.style.strokeWidth = "2";
  svg.appendChild(me);

  axes.forEach((axis, i) => {
    const [x, y] = point(i, radius + 18);
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", x);
    text.setAttribute("y", y);
    text.setAttribute("text-anchor", Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end");
    text.setAttribute("dominant-baseline", "middle");
    text.style.fill = "var(--muted)";
    text.style.fontSize = "10.5px";
    text.textContent = axis.label;
    svg.appendChild(text);
  });
  return svg;
}

function renderPlayerDrawer(id) {
  const player = STATS.players[id];
  const frag = document.createDocumentFragment();

  // identity
  const head = el("div", "dp-head");
  const headInfo = el("div");
  const name = el("h3", "dp-name", playerName(id));
  name.id = "drawer-name";
  headInfo.append(name, el("div", "dp-id", `Account ${id}`));
  head.append(avatarElement({ heroId: playerTopHero(id), name: playerName(id), cls: "lg" }), headInfo);
  frag.appendChild(head);

  const badges = computeBadges(id, player);
  if (badges.length) {
    const wrap = el("div", "dp-badges");
    for (const [label, tone] of badges) wrap.appendChild(el("span", `badge ${tone}`, label));
    frag.appendChild(wrap);
  }

  const summary = el("div", "dp-summary");
  summary.append(
    el("span", "big", fmtPct(player.win_rate)),
    el("span", "sub", `${fmtInt(player.matches)} matches · ${fmtInt(player.wins)}W–${fmtInt(player.losses)}L`),
  );
  frag.appendChild(summary);

  // performance KPIs
  const totalKills = metricValues("kills").reduce((sum, value) => sum + value, 0);
  const killsShare = totalKills ? (Number(player.kills) / totalKills) * 100 : 0;
  const kpiSection = dpSection("Performance");
  const kpis = el("div", "dp-kpis");
  const kpiData = [
    ["Matches", fmtInt(player.matches)],
    ["Win Rate", fmtPct(player.win_rate)],
    ["KDA", fmtNum(player.kda)],
    ["Avg K / D / A", `${fmtNum(player.avg_kills, 1)} / ${fmtNum(player.avg_deaths, 1)} / ${fmtNum(player.avg_assists, 1)}`],
    ["Total K / D / A", `${fmtInt(player.kills)} / ${fmtInt(player.deaths)} / ${fmtInt(player.assists)}`],
    ["Kill share", fmtPct(killsShare)],
  ];
  for (const [label, value] of kpiData) {
    const cell = el("div", "dp-kpi");
    cell.append(el("div", "k-label", label), el("div", "k-value", value));
    kpis.appendChild(cell);
  }
  kpiSection.appendChild(kpis);
  frag.appendChild(kpiSection);

  // lobby ranking
  const rankSection = dpSection("Lobby ranking");
  const rankSpecs = [
    ["Win Rate", "win_rate", fmtPct],
    ["KDA", "kda", (v) => fmtNum(v)],
    ["Kills", "kills", fmtInt],
    ["Assists", "assists", fmtInt],
    ["Matches", "matches", fmtInt],
  ];
  for (const [label, key, fmt] of rankSpecs) {
    const value = Number(player[key]) || 0;
    const { rank, total } = rankOf(key, value);
    const max = Math.max(...metricValues(key), 1);
    const pos = el("div", "dp-rank-pos");
    pos.append(el("span", "v", fmt(value)), el("span", "r", `#${rank} of ${total}`));
    const row = el("div", "dp-rank-row");
    row.append(el("div", "dp-rank-label", label), buildBar((value / max) * 100), pos);
    rankSection.appendChild(row);
  }
  frag.appendChild(rankSection);

  // radar versus lobby average
  const heroPools = lobbyIds().map((pid) => heroPoolSize(pid));
  const axisData = [
    ["Win Rate", Number(player.win_rate) || 0, average(metricValues("win_rate")), 100],
    ["KDA", Number(player.kda) || 0, average(metricValues("kda")), Math.max(...metricValues("kda"), 0)],
    ["Kills", Number(player.kills) || 0, average(metricValues("kills")), Math.max(...metricValues("kills"), 0)],
    ["Assists", Number(player.assists) || 0, average(metricValues("assists")), Math.max(...metricValues("assists"), 0)],
    ["Matches", Number(player.matches) || 0, average(metricValues("matches")), Math.max(...metricValues("matches"), 0)],
    ["Hero Pool", heroPoolSize(id), average(heroPools), Math.max(...heroPools, 0)],
  ];
  const axes = axisData.map(([label, value, avg, max]) => ({
    label,
    norm: max > 0 ? Math.max(0, Math.min(1, value / max)) : 0,
    avgNorm: max > 0 ? Math.max(0, Math.min(1, avg / max)) : 0,
  }));
  const radarSection = dpSection("Versus lobby average");
  const radarWrap = el("div", "dp-radar");
  radarWrap.appendChild(renderRadar(axes));
  const legend = el("div", "dp-legend");
  const meLg = el("span");
  meLg.append(el("span", "sw me"), document.createTextNode(playerName(id)));
  const avgLg = el("span");
  avgLg.append(el("span", "sw avg"), document.createTextNode("Lobby average"));
  legend.append(meLg, avgLg);
  radarSection.append(radarWrap, legend);
  frag.appendChild(radarSection);

  // hero pool
  const heroRecs = Object.entries(STATS.player_heroes?.[id] || {})
    .map(([heroId, rec]) => ({ heroId: Number(heroId), ...rec }))
    .sort((a, b) => b.matches - a.matches || b.win_rate - a.win_rate);
  const poolSection = dpSection("Hero pool");
  poolSection.appendChild(el("p", "dp-empty", `${heroRecs.length} hero${heroRecs.length === 1 ? "" : "es"} played`));
  if (heroRecs.length) {
    for (const rec of heroRecs.slice(0, 5)) {
      const row = el("div", "dp-hero-row");
      row.appendChild(avatarElement({ heroId: rec.heroId, name: heroName(rec.heroId) }));
      const info = el("div", "dp-hero-info");
      info.append(
        el("div", "h-name", heroName(rec.heroId)),
        el("div", "h-sub", `${fmtInt(rec.matches)} matches · ${fmtInt(rec.wins)}W–${fmtInt(rec.losses)}L`),
        buildBar(Number(rec.win_rate) || 0, Number(rec.win_rate) >= 50),
      );
      row.append(info, el("div", "dp-hero-val", fmtPct(rec.win_rate)));
      poolSection.appendChild(row);
    }
  } else {
    poolSection.appendChild(el("p", "dp-empty", "No hero data yet."));
  }
  const qualified = heroRecs.filter((rec) => rec.matches >= 3);
  if (qualified.length) {
    const best = qualified.slice().sort((a, b) => b.win_rate - a.win_rate)[0];
    const worst = qualified.slice().sort((a, b) => a.win_rate - b.win_rate)[0];
    const chips = el("div", "dp-badges");
    chips.appendChild(el("span", "badge b3", `Best: ${heroName(best.heroId)} · ${fmtPct(best.win_rate)}`));
    if (worst.heroId !== best.heroId) {
      chips.appendChild(el("span", "badge", `Toughest: ${heroName(worst.heroId)} · ${fmtPct(worst.win_rate)}`));
    }
    poolSection.appendChild(chips);
  }
  frag.appendChild(poolSection);

  // teammates & rivals
  const duo = bestDuoFor(id);
  const rivals = rivalriesFor(id);
  const nemesis = rivals.filter((r) => r.matches >= 3).sort((a, b) => a.win_rate - b.win_rate)[0] || null;
  const mostRival = rivals.slice().sort((a, b) => b.matches - a.matches)[0] || null;
  const socialSection = dpSection("Teammates & rivals");
  const socialRows = [];
  if (duo.best) socialRows.push([duo.best.other, "Best duo", duo.best]);
  if (duo.most && (!duo.best || duo.most.other !== duo.best.other)) socialRows.push([duo.most.other, "Most played with", duo.most]);
  if (nemesis) socialRows.push([nemesis.other, "Nemesis", nemesis]);
  if (mostRival && (!nemesis || mostRival.other !== nemesis.other)) socialRows.push([mostRival.other, "Most faced", mostRival]);
  if (socialRows.length) {
    for (const [other, label, rec] of socialRows) {
      const row = el("div", "dp-social-row");
      row.appendChild(attachPlayer(playerAvatar(other), other));
      const info = el("div", "dp-social-label");
      info.append(
        el("span", "s-name", playerName(other)),
        el("span", "s-sub", `${label} · ${fmtInt(rec.matches)} matches`),
      );
      row.append(info, el("div", "dp-hero-val" + (rec.win_rate >= 50 ? " win" : " loss"), fmtPct(rec.win_rate)));
      socialSection.appendChild(row);
    }
  } else {
    socialSection.appendChild(el("p", "dp-empty", "No teammate or rival data yet."));
  }
  frag.appendChild(socialSection);

  $("drawer-body").replaceChildren(frag);
}

function openPlayerDrawer(id, trigger) {
  if (!STATS?.players?.[id]) return;
  lastFocused = trigger instanceof HTMLElement ? trigger : document.activeElement;
  renderPlayerDrawer(id);
  $("player-drawer").classList.add("open");
  $("drawer-backdrop").classList.add("open");
  document.body.classList.add("drawer-open");
  drawerOpen = true;
  const closeBtn = $("drawer-close");
  if (closeBtn) closeBtn.focus();
  if (playerIdFromHash() !== id) {
    history.replaceState(null, "", `#player=${encodeURIComponent(id)}`);
  }
}

function closePlayerDrawer() {
  if (!drawerOpen) return;
  drawerOpen = false;
  $("player-drawer").classList.remove("open");
  $("drawer-backdrop").classList.remove("open");
  document.body.classList.remove("drawer-open");
  if (playerIdFromHash()) {
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (lastFocused instanceof HTMLElement && document.contains(lastFocused)) lastFocused.focus();
}

function initDrawer() {
  $("drawer-close").addEventListener("click", closePlayerDrawer);
  $("drawer-backdrop").addEventListener("click", closePlayerDrawer);
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-player]");
    if (!trigger) return;
    event.preventDefault();
    openPlayerDrawer(trigger.dataset.player, trigger);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawerOpen) closePlayerDrawer();
  });
  window.addEventListener("hashchange", () => {
    const id = playerIdFromHash();
    if (id && STATS?.players?.[id]) openPlayerDrawer(id);
    else if (drawerOpen) closePlayerDrawer();
  });
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
    initDrawer();
    const initial = playerIdFromHash();
    if (initial) openPlayerDrawer(initial);
  } catch (error) {
    $("status").textContent =
      `Could not load stats.json (${error.message}). Make sure the aggregator has published it.`;
  }
}

boot();
