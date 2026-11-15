"""Deterministic player-profile metrics computed from parsed replay JSON.

Pure module: no S3, no HTTP, no clock, no randomness. The same inputs always
produce the same output, which is what makes the source hash a reliable cache
key and lets the analysis worker skip the model when nothing changed.

Design rules this module exists to enforce:

1. **A missing value is never zero.** Every mean tracks how many matches
   actually contributed the field, and a metric with no contributing sample is
   published as unavailable rather than as `0`. Zeroing an absent signal is how
   a support player ends up scored for not farming and a player with no ward
   telemetry ends up accused of playing blind.
2. **Only signals the replay really carries are derived here.** Ward *counts*
   exist; ward *positions* do not. Team minute snapshots exist; per-player
   minute snapshots exist from schema 8 only. A tower destroyed names a
   structure, never a killer. Nothing here infers the difference.
3. **Everything is versioned.** `METRICS_VERSION` and the parser schema floor
   are part of the payload, so an analysis can always be traced to the formulas
   that produced it and deliberately invalidated later.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

# Bumped whenever a formula or the set of published signals changes, so cached
# analyses generated under old rules can be invalidated on purpose.
METRICS_VERSION = "1.0.0"

# Parsed replays below this schema cannot support the profile analysis at all.
# Schema 6 introduced the timeline; schema 8 added the per-player minute series
# that makes early-game farm per player derivable instead of team-only.
MIN_PARSER_SCHEMA = 6
PLAYER_SNAPSHOT_SCHEMA = 8

# Only the newest matches feed the analysis, and never more than this.
WINDOW_MATCHES = 20
# Below this many eligible matches the window is too small to characterise a
# player, and the caller must answer INSUFFICIENT_DATA without calling a model.
MIN_ELIGIBLE_MATCHES = 5
# Between these two bounds the analysis is allowed but must carry an explicit
# small-sample warning; above it the sample is treated as ordinary. This is kept
# above MIN_TREND_MATCHES on purpose: a window can be big enough for the trend
# arithmetic to be published while still being too thin to read as a pattern, and
# the warning has to say both things rather than forbid the direction outright.
STRONG_SAMPLE_MATCHES = 10
# A first-half/second-half split needs enough matches on both sides before a
# direction means anything, so trends stay unpublished below this window size.
MIN_TREND_MATCHES = 6

# Game phases used to bucket deaths and early farm. Boundaries are in seconds
# from match start and are part of the published payload, so a change here is a
# visible formula change rather than a silent reinterpretation of history.
PHASES: tuple[tuple[str, int, int], ...] = (
    ("early", 0, 600),
    ("mid", 601, 1500),
    ("late", 1501, 10 ** 9),
)
EARLY_FARM_SECONDS = 600

# The parser's role label is a heuristic. Below this confidence the profile
# stays role-neutral rather than grading a player against a role baseline the
# replay did not actually establish.
#
# 0.6 is chosen from the published distribution, not by taste. Mean
# role_confidence across the 26 lobby players ranges 0.79-0.90 for carry,
# 0.70-0.89 for offlane, and only 0.59-0.77 for support: low confidence is a
# property of how the heuristic reads support games, not a signal about any one
# player. Raising this bar to something like 0.75 would strip the benchmark from
# every support in the dataset while leaving every carry untouched, which is a
# cohort-wide penalty masquerading as a quality gate. At 0.6 it excludes the
# genuinely uncertain labels and keeps the cohort comparable.
ROLE_CONFIDENCE_THRESHOLD = 0.6

# A direction needs more than a coin flip behind it. A 50% swing in win rate
# across a 3-versus-3 split is ordinary variance, whereas the same arithmetic
# on 5-versus-5 is worth describing, so binary outcomes demand a deeper sample
# than continuous per-match averages do.
TREND_MIN_MATCHES_PER_SIDE = 3
TREND_MIN_MATCHES_PER_SIDE_BY_KEY = {"win_rate": 5}

# The aggregator only builds role records for these three (`aggregator.py`:
# `if role in {"support", "offlane", "carry"}`). A mid laner or an unknown role
# therefore has no lobby-relative ranking to be quoted, and saying so is more
# honest than reporting an absent player as merely unranked.
RANKED_ROLES = ("carry", "offlane", "support")

# Scoreboard fields read straight from the parsed player object. Kept as one
# tuple so the metric set cannot drift from what the payload publishes.
COUNTER_FIELDS = (
    "kills",
    "deaths",
    "assists",
    "last_hits",
    "denies",
    "hero_damage",
    "tower_damage",
    "networth",
    "gold",
    "xp",
    "stuns",
    "obs_placed",
    "sen_placed",
    "towers_killed",
    "roshans_killed",
    "rune_pickups",
    "creeps_stacked",
)


def _number(value: Any) -> float | None:
    """Accept real numbers only. Never coerce `None`, text, or bool to a count."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return numerator / denominator


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _whole(value: float | None) -> int | None:
    """Round to a count. Distinct from `_round(value, 0)`, which returns a float."""
    return None if value is None else int(round(value))


def _canonical(value: Any) -> str:
    """Stable serialization for hashing: sorted keys, fixed separators.

    Python's default float repr is already round-trip stable, and every number
    published here is rounded first, so two equivalent payloads built in
    different orders hash the same while a changed metric does not.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _phase_of(seconds: float) -> str | None:
    for name, start, end in PHASES:
        if start <= seconds <= end:
            return name
    return None


def recent_match_ids(matches: dict[str, Any], account_id: str, limit: int = WINDOW_MATCHES) -> dict[str, Any]:
    """Newest-first match ids this player appears in, for loading the window.

    The published match index is the starting point because it already carries
    per-player identity and only holds matches the aggregator accepted, so this
    does not have to re-read the whole history. Ordering is by `start_time`
    explicitly rather than by array position or match id, since neither of those
    is guaranteed to be chronological, and a match id is not a clock.

    Duplicate match ids are refused rather than averaged: the same match reaching
    the window twice would double-count one game and silently shift every mean.
    """
    rows: list[tuple[float, str]] = []
    missing_time = 0
    for entry in (matches or {}).get("matches") or []:
        if not isinstance(entry, dict):
            continue
        match_id = entry.get("match_id")
        if match_id is None:
            continue
        players = entry.get("players")
        if not isinstance(players, list):
            continue
        if not any(isinstance(p, dict) and str(p.get("account_id") or "").strip() == account_id for p in players):
            continue
        start = _number(entry.get("start_time"))
        if start is None:
            # Keep the match but sort it as oldest: excluding it would hide
            # evidence, while trusting it as recent would invent recency.
            missing_time += 1
            start = float("-inf")
        rows.append((start, str(match_id)))

    rows.sort(key=lambda item: (-item[0], item[1]))
    ordered: list[str] = []
    seen: set[str] = set()
    duplicates = 0
    for _, match_id in rows:
        if match_id in seen:
            duplicates += 1
            continue
        seen.add(match_id)
        ordered.append(match_id)

    return {
        "match_ids": ordered[:limit],
        "candidate_matches": len(ordered),
        "excluded_duplicates": duplicates,
        "missing_start_time": missing_time,
        "truncated": len(ordered) > limit,
    }


def is_eligible(parsed: Any, account_id: str) -> bool:
    """True when this parsed object can be counted as one match for this player.

    Fail-closed like the aggregator: a match whose lobby type is missing or
    unreadable is not eligible, so a parser regression cannot quietly pull
    public matchmaking replays into a private-lobby profile.
    """
    if not isinstance(parsed, dict):
        return False
    if parsed.get("lobby_type") != 1:
        return False
    try:
        if int(parsed.get("schema_version") or 0) < MIN_PARSER_SCHEMA:
            return False
    except (TypeError, ValueError):
        return False
    return player_entry(parsed, account_id) is not None


def player_index_for(parsed: dict[str, Any], account_id: str) -> int | None:
    """Index of this player inside the match, or None when they are absent.

    Identity is `account_id` only, never `player_name`: names are display
    labels and the real dataset already contains players named `4` and `;`.
    """
    entry = player_entry(parsed, account_id)
    if entry is None:
        return None
    players = parsed.get("players") or []
    for index, player in enumerate(players):
        if player is entry:
            return index
    return None


def player_entry(parsed: dict[str, Any], account_id: str) -> dict[str, Any] | None:
    players = parsed.get("players")
    if not isinstance(players, list):
        return None
    for player in players:
        if isinstance(player, dict) and str(player.get("account_id") or "").strip() == account_id:
            return player
    return None


def _has_player_snapshots(parsed: dict[str, Any]) -> bool:
    """Whether this match can support per-player early-farm metrics at all."""
    try:
        current = int(parsed.get("schema_version") or 0) >= PLAYER_SNAPSHOT_SCHEMA
    except (TypeError, ValueError):
        current = False
    timeline = parsed.get("timeline")
    return current and isinstance(timeline, dict) and isinstance(timeline.get("player_snapshots"), list)


def _snapshot_at(parsed: dict[str, Any], player_index: int, seconds: int, metric: str) -> float | None:
    """The latest reported value at or before `seconds`, never an extrapolation.

    A player with no snapshot at or before the mark yields None rather than
    being read off a later minute, so "last hits at 10 minutes" stays a
    measurement of the first ten minutes.
    """
    best_time: int | None = None
    best_value: float | None = None
    for entry in (parsed.get("timeline") or {}).get("player_snapshots") or []:
        if not isinstance(entry, dict) or entry.get("player_index") != player_index:
            continue
        moment = _number(entry.get("time"))
        value = _number(entry.get(metric))
        if moment is None or value is None or moment > seconds:
            continue
        if best_time is None or moment >= best_time:
            best_time, best_value = int(moment), value
    return best_value


def _unique_hero(parsed: dict[str, Any], hero_id: Any) -> bool:
    """Whether the hero identifies exactly one player in this match.

    Combat-log deaths name a hero unit, not a slot. With two of the same hero
    the attribution is genuinely ambiguous, so those matches contribute no
    death timing instead of guessing which one died.
    """
    players = parsed.get("players") or []
    matches = [player for player in players if isinstance(player, dict) and player.get("hero_id") == hero_id]
    return len(matches) == 1


def _death_phases(
    parsed: dict[str, Any],
    hero_id: Any,
    slug: str | None,
    scoreboard_deaths: float | None,
    heroes: dict[str, str],
) -> dict[str, Any]:
    """Bucket this hero's deaths into game phases, or explain why it cannot be done.

    Combat-log deaths name a hero unit rather than a slot, so attribution rests
    on two things being true: the hero is unique in the match, and the number of
    events for it agrees with the scoreboard death count the parser already
    published. When either fails the block is reported as unavailable with the
    reason instead of being guessed at, because a phase distribution built on an
    unattributable death is worse than no distribution at all.
    """
    def unavailable(reason: str, **extra: Any) -> dict[str, Any]:
        return {"available": False, "reason": reason, **extra}

    if slug is None:
        return unavailable("unknown_hero")
    if not _unique_hero(parsed, hero_id):
        return unavailable("duplicate_hero")
    timeline = parsed.get("timeline")
    if not isinstance(timeline, dict) or not isinstance(timeline.get("events"), list):
        return unavailable("no_timeline")

    target = f"npc_dota_hero_{slug}"
    counted = {name: 0 for name, _, _ in PHASES}
    matched = 0
    unplaced = 0
    for event in timeline["events"]:
        if not isinstance(event, dict) or event.get("type") != "hero_death" or event.get("target") != target:
            continue
        moment = _number(event.get("time"))
        phase = _phase_of(moment) if moment is not None else None
        if phase is None:
            unplaced += 1
            continue
        counted[phase] += 1
        matched += 1

    if unplaced:
        return unavailable("unplaced_events", events=matched + unplaced)
    if scoreboard_deaths is None:
        return unavailable("no_scoreboard_deaths", events=matched)
    if matched != scoreboard_deaths:
        # The event stream and the scoreboard disagree, so the phase split cannot
        # be trusted to describe the same set of deaths the record counts.
        return unavailable("count_mismatch", events=matched, scoreboard=int(scoreboard_deaths))
    return {"available": True, "total": matched, "phases": counted}


def match_metrics(parsed: dict[str, Any], account_id: str, heroes: dict[str, str]) -> dict[str, Any] | None:
    """One match reduced to the per-player signals the profile analysis reads."""
    if not is_eligible(parsed, account_id):
        return None
    player = player_entry(parsed, account_id)
    index = player_index_for(parsed, account_id)
    if player is None or index is None:
        return None

    duration = _number(parsed.get("duration"))
    # Mirrors the aggregator's own normalization (`aggregator.py`, the
    # `max(duration / 60.0, 1.0)` in _add_role_observation). Reproducing a
    # different formula here would let the profile and the published
    # leaderboard disagree about one player's per-minute rate for the same match,
    # and the analysis would then contradict the page it sits on.
    minutes = max(duration / 60.0, 1.0) if duration is not None else None

    counts = {field: _number(player.get(field)) for field in COUNTER_FIELDS}
    wins = player.get("win")

    metrics: dict[str, Any] = {
        "match_id": str(parsed.get("match_id")),
        "start_time": _number(parsed.get("start_time")),
        "duration_seconds": duration,
        "hero_id": player.get("hero_id"),
        "team": player.get("team"),
        "outcome": None if not isinstance(wins, bool) else ("win" if wins else "loss"),
        "role": player.get("role"),
        "lane": player.get("lane"),
        "role_confidence": _round(_number(player.get("role_confidence"))),
        "schema_version": parsed.get("schema_version"),
    }

    kills, deaths, assists = counts["kills"], counts["deaths"], counts["assists"]
    metrics["kills"], metrics["deaths"], metrics["assists"] = kills, deaths, assists
    # A zero-death match is a real outcome, not a missing value. Keep the raw
    # count and publish the ratio with the same floor the aggregator uses, so
    # the profile and the leaderboard can never disagree about one player's KDA.
    if kills is not None and deaths is not None and assists is not None:
        metrics["kda_ratio"] = _round((kills + assists) / max(deaths, 1.0))

    for field, key in (("gold", "gpm"), ("xp", "xpm"), ("hero_damage", "hero_damage_per_minute"),
                       ("tower_damage", "tower_damage_per_minute"), ("stuns", "stuns_per_minute")):
        metrics[key] = _round(_ratio(counts[field], minutes)) if minutes else None

    metrics["last_hits"] = counts["last_hits"]
    metrics["denies"] = counts["denies"]
    metrics["networth"] = counts["networth"]
    metrics["vision_wards"] = (
        None if counts["obs_placed"] is None and counts["sen_placed"] is None
        else (counts["obs_placed"] or 0) + (counts["sen_placed"] or 0)
    )
    metrics["towers_killed"] = counts["towers_killed"]
    metrics["roshans_killed"] = counts["roshans_killed"]
    metrics["rune_pickups"] = counts["rune_pickups"]
    metrics["creeps_stacked"] = counts["creeps_stacked"]

    # kill_participation is precomputed by the parser and is already None when
    # the team scored no kills, which is exactly the unknown case.
    participation = _number(player.get("kill_participation"))
    metrics["kill_participation"] = _round(participation)
    metrics["teamfight_participation"] = _round(_number(player.get("teamfight_participation")))

    if _has_player_snapshots(parsed):
        metrics["last_hits_at_10m"] = _whole(_snapshot_at(parsed, index, EARLY_FARM_SECONDS, "lh"))
        metrics["networth_at_10m"] = _whole(_snapshot_at(parsed, index, EARLY_FARM_SECONDS, "networth"))
        metrics["xp_at_10m"] = _whole(_snapshot_at(parsed, index, EARLY_FARM_SECONDS, "xp"))
    else:
        # Schema 6 and 7 only publish team minute sums, so there is nothing to
        # read for one player and these stay unavailable rather than estimated.
        metrics["last_hits_at_10m"] = None
        metrics["networth_at_10m"] = None
        metrics["xp_at_10m"] = None

    hero_id = player.get("hero_id")
    slug = heroes.get(str(hero_id)) if hero_id is not None else None
    metrics["deaths_by_phase"] = _death_phases(parsed, hero_id, slug, counts["deaths"], heroes)

    return metrics


# Window aggregates published to the model. Each is the mean across the matches
# that reported it, so a partially covered field narrows its own sample instead
# of being padded with zeros.
WINDOW_MEANS = (
    "kda_ratio", "kills", "deaths", "assists", "gpm", "xpm", "last_hits", "denies",
    "hero_damage_per_minute", "tower_damage_per_minute", "stuns_per_minute",
    "vision_wards", "kill_participation", "teamfight_participation", "networth",
    "towers_killed", "roshans_killed", "rune_pickups", "creeps_stacked",
    "last_hits_at_10m", "networth_at_10m", "xp_at_10m", "duration_seconds", "role_confidence",
)

# Trends are only published for signals where a direction is meaningful and the
# sample can plausibly support one.
TREND_KEYS = (
    "win_rate", "kda_ratio", "deaths", "gpm", "xpm", "last_hits",
    "hero_damage_per_minute", "tower_damage_per_minute", "vision_wards",
    "kill_participation", "last_hits_at_10m", "networth_at_10m",
)

# Means the replay publishes as a 0-1 share but a reader expects as a percent.
# One tuple drives both the window aggregate and the trend comparison, so the two
# can never disagree about the unit of the same metric: quoting a 0.68 share
# beside a 68.8 percent figure for one player reads as a contradiction even
# though both numbers are correct.
PERCENT_MEANS = ("kill_participation", "teamfight_participation", "role_confidence")


def _mean_of(rows: list[dict[str, Any]], key: str) -> tuple[float | None, int]:
    values = [row[key] for row in rows if isinstance(row.get(key), (int, float))]
    if not values:
        return None, 0
    return sum(values) / len(values), len(values)


def _deaths_by_phase(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Sum the phase buckets across the matches where attribution held.

    Matches where attribution failed are counted out loud in `excluded`, so a
    reader can see how much of the window actually supports the distribution
    rather than assuming it covers all of it.
    """
    usable = [row for row in rows if (row.get("deaths_by_phase") or {}).get("available")]
    if not usable:
        reasons: dict[str, int] = {}
        for row in rows:
            block = row.get("deaths_by_phase") or {}
            reason = block.get("reason") or "no_timeline"
            reasons[reason] = reasons.get(reason, 0) + 1
        return {"available": False, "matches": 0, "excluded": len(rows),
                "excluded_reasons": dict(sorted(reasons.items())) or None}

    total = 0
    per_phase = {name: 0 for name, _, _ in PHASES}
    excluded_reasons: dict[str, int] = {}
    for row in rows:
        block = row.get("deaths_by_phase") or {}
        if not block.get("available"):
            reason = block.get("reason") or "no_timeline"
            excluded_reasons[reason] = excluded_reasons.get(reason, 0) + 1
            continue
        total += int(block.get("total") or 0)
        for name, count in (block.get("phases") or {}).items():
            if name in per_phase and isinstance(count, (int, float)):
                per_phase[name] += int(count)
    return {
        "available": True,
        "matches": len(usable),
        "excluded": len(rows) - len(usable),
        "excluded_reasons": dict(sorted(excluded_reasons.items())) or None,
        "total_deaths": total,
        "per_match": _round(total / len(usable), 1),
        "phases": {
            name: {"deaths": per_phase[name], "share": _round(100.0 * per_phase[name] / total, 1) if total else None}
            for name, _, _ in PHASES
        },
    }


def aggregate_window(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Reduce a newest-first window of match metrics into one compact block."""
    matches = len(rows)
    outcomes = [row["outcome"] for row in rows if row.get("outcome") in ("win", "loss")]
    wins = sum(1 for outcome in outcomes if outcome == "win")

    metrics: dict[str, Any] = {}
    if outcomes:
        metrics["win_rate"] = {"value": _round(100.0 * wins / len(outcomes), 1), "unit": "percent",
                               "sample_size": len(outcomes)}

    for key in WINDOW_MEANS:
        mean, samples = _mean_of(rows, key)
        if samples:
            scale = 100.0 if key in PERCENT_MEANS else 1.0
            metrics[key] = {"value": _round(mean * scale, 1), "sample_size": samples,
                            **({"unit": "percent"} if scale != 1.0 else {})}

    return {
        "matches_in_window": matches,
        "metrics": metrics,
        "deaths_by_phase": _deaths_by_phase(rows),
        "unavailable": sorted(key for key in WINDOW_MEANS if key not in metrics),
    }


def trend_window(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Compare the older half of the window with the newer half.

    `rows` is newest-first, so the *older* half is the tail and the *newer* half
    is the head. A two-match split would present ordinary noise as a direction,
    so each metric needs its own minimum per side, and the counts are published
    with every change so a reader can weigh it. Directions that do not clear
    their bar are named in `suppressed` rather than quietly omitted: the absence
    of a trend is itself information the model should not be tempted to fill in.
    """
    if len(rows) < MIN_TREND_MATCHES:
        return {"available": False, "reason": f"needs_at_least_{MIN_TREND_MATCHES}_matches",
                "matches": len(rows)}

    half = len(rows) // 2
    newer, older = rows[:half], rows[-half:]
    trends: dict[str, Any] = {}
    suppressed: dict[str, int] = {}

    def withhold(key: str, needed: int, have: int) -> None:
        suppressed[key] = needed - have

    outcomes_newer = [row["outcome"] for row in newer if row.get("outcome") in ("win", "loss")]
    outcomes_older = [row["outcome"] for row in older if row.get("outcome") in ("win", "loss")]
    need = TREND_MIN_MATCHES_PER_SIDE_BY_KEY.get("win_rate", TREND_MIN_MATCHES_PER_SIDE)
    if outcomes_newer and outcomes_older:
        if min(len(outcomes_newer), len(outcomes_older)) < need:
            withhold("win_rate", need, min(len(outcomes_newer), len(outcomes_older)))
        else:
            new_rate = 100.0 * sum(1 for outcome in outcomes_newer if outcome == "win") / len(outcomes_newer)
            old_rate = 100.0 * sum(1 for outcome in outcomes_older if outcome == "win") / len(outcomes_older)
            trends["win_rate"] = {
                "older": _round(old_rate, 1), "newer": _round(new_rate, 1),
                "change": _round(new_rate - old_rate, 1), "unit": "percent",
                "older_matches": len(outcomes_older), "newer_matches": len(outcomes_newer),
            }

    for key in TREND_KEYS:
        if key == "win_rate":
            continue
        old_mean, old_n = _mean_of(older, key)
        new_mean, new_n = _mean_of(newer, key)
        if old_mean is None or new_mean is None:
            continue
        need = TREND_MIN_MATCHES_PER_SIDE_BY_KEY.get(key, TREND_MIN_MATCHES_PER_SIDE)
        if min(old_n, new_n) < need:
            withhold(key, need, min(old_n, new_n))
            continue
        scale = 100.0 if key in PERCENT_MEANS else 1.0
        trends[key] = {
            "older": _round(old_mean * scale, 1), "newer": _round(new_mean * scale, 1),
            "change": _round((new_mean - old_mean) * scale, 1),
            "older_matches": old_n, "newer_matches": new_n,
            **({"unit": "percent"} if scale != 1.0 else {}),
        }

    return {
        "available": bool(trends),
        "older_half_matches": len(older),
        "newer_half_matches": len(newer),
        "changes": trends,
        "suppressed": [{"key": key, "short_matches_by": short}
                       for key, short in sorted(suppressed.items())] or None,
    }


def role_context(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Which role the window actually supports, and how strongly.

    A player who split across three roles cannot be graded against one role's
    baseline, so the dominant role only counts when it holds a clear majority
    and the parser was confident. Otherwise the profile stays role-neutral.
    """
    tally: dict[str, int] = {}
    for row in rows:
        role = row.get("role")
        if isinstance(role, str) and role not in ("unknown", ""):
            tally[role] = tally.get(role, 0) + 1
    if not tally:
        return {"value": None, "confidence": "no_role_data", "dominant_share": None}
    dominant, count = max(tally.items(), key=lambda item: (item[1], item[0]))
    share = count / len(rows)
    mean_confidence, samples = _mean_of(rows, "role_confidence")
    context = {
        "value": dominant,
        "dominant_share": _round(100.0 * share, 1),
        "roles_seen": dict(sorted(tally.items())),
        "mean_role_confidence": _round(mean_confidence, 2) if samples else None,
    }
    if share < 0.6 or (samples and mean_confidence is not None
                       and mean_confidence < ROLE_CONFIDENCE_THRESHOLD):
        # Either the player genuinely splits roles or the replay was not sure
        # which role this was; neither supports grading against one baseline.
        return {**context, "confidence": "low"}
    return {**context, "confidence": "sufficient"}


def build_profile_metrics(
    account_id: str,
    rows: list[dict[str, Any]],
    stats: dict[str, Any],
) -> dict[str, Any]:
    """Assemble the full analytical payload the model is allowed to reason over.

    `rows` must already be filtered to this player, ordered newest-first, and
    trimmed to the window. Benchmark figures are taken from the published
    aggregates rather than recomputed here, so one number has one owner.
    """
    rows = [row for row in rows if row]
    role = role_context(rows)
    window = aggregate_window(rows)
    trends = trend_window(rows)

    # The hash covers the analytical inputs, not the match ids: two different
    # sets of matches that produce identical metrics would still hash apart,
    # because every metric was computed from those matches. `match_ids` is
    # published alongside it purely as provenance a reader can verify.
    match_ids = [row["match_id"] for row in rows]
    analytical = {
        "metrics_version": METRICS_VERSION,
        "player_id": account_id,
        "window": {"type": "recent_matches", "requested": WINDOW_MATCHES, "eligible": len(rows)},
        "role": role,
        "metrics": window["metrics"],
        "deaths_by_phase": window["deaths_by_phase"],
        "trends": trends,
        "benchmark": benchmark_for(stats, account_id, role),
        "lifetime": lifetime_reference(stats, account_id),
        "hero_pool": hero_reference(stats, account_id),
    }
    payload = {
        "schema_version": "1.0",
        "metrics_version": METRICS_VERSION,
        "player_id": account_id,
        "window": analytical["window"],
        "source": {
            "match_ids": match_ids,
            "source_hash": "sha256:" + hashlib.sha256(_canonical(analytical).encode()).hexdigest(),
        },
        "role": role,
        "metrics": window["metrics"],
        "unavailable_metrics": window["unavailable"],
        "deaths_by_phase": window["deaths_by_phase"],
        "trends": trends,
        "benchmark": analytical["benchmark"],
        "lifetime": analytical["lifetime"],
        "hero_pool": analytical["hero_pool"],
        "sample": _sample_note(len(rows)),
        "insufficient": len(rows) < MIN_ELIGIBLE_MATCHES,
    }
    return payload


def _sample_note(matches: int) -> dict[str, Any] | None:
    """How much of the window was actually available, and how firmly it can speak.

    The model is told the sample size in the payload rather than left to infer
    it from the prose: an eight-match recent window is a different kind of
    evidence than a nineteen-match one, and an analysis that reads as though it
    surveyed a career is a defect regardless of whether the numbers are right.
    """
    if matches < MIN_ELIGIBLE_MATCHES:
        return {"tier": "insufficient", "matches": matches,
                "note": f"Fewer than {MIN_ELIGIBLE_MATCHES} eligible matches: no analysis is produced."}
    if matches < STRONG_SAMPLE_MATCHES:
        return {"tier": "small", "matches": matches,
                "note": (f"Only {matches} eligible matches were available. Describe these numbers as the "
                         "observed record for this sample, not as an established pattern. Describe a "
                         "direction only where the trends block publishes one, and quote its match counts "
                         "when you do.")}
    return {"tier": "adequate", "matches": matches, "note": None}


def benchmark_for(stats: dict[str, Any], account_id: str, role: dict[str, Any]) -> dict[str, Any]:
    """The lobby-relative role standing already published by the aggregator.

    Reused rather than recomputed. Its own metadata declares the method, so the
    model is told explicitly that this is a ranking within this lobby dataset
    and not a percentile over any wider population.
    """
    rankings = stats.get("role_rankings") or {}
    scoring = stats.get("role_scoring") or {}
    value = role.get("value")
    out: dict[str, Any] = {
        "kind": "lobby_relative_role_ranking",
        "scope_note": "Rankings are relative to this private-lobby dataset only, not to any wider player base.",
    }
    if not value or role.get("confidence") != "sufficient":
        out["available"] = False
        out["reason"] = "role_not_confident"
        return out
    if value not in RANKED_ROLES:
        out["available"] = False
        out["reason"] = "role_not_ranked"
        out["ranked_roles"] = list(RANKED_ROLES)
        return out
    entries = rankings.get(value) or []
    position = next((index for index, item in enumerate(entries) if str(item.get("id")) == account_id), None)
    if position is None:
        out["available"] = False
        out["reason"] = "player_not_in_role_rankings"
        out["eligible_players"] = len(entries)
        return out
    item = entries[position]
    out.update({
        "available": True,
        "role": value,
        "rank": position + 1,
        "ranked_players": len(entries),
        "score": item.get("score"),
        "method": (scoring.get(value) or {}).get("method"),
        "minimum_matches": (scoring.get(value) or {}).get("minimum_matches"),
        "eligible_players": (scoring.get(value) or {}).get("eligible_players"),
        "metrics": [
            {"key": part.get("key"), "label": part.get("label"), "value": part.get("value"),
             "normalized": part.get("normalized"), "weight": part.get("weight"), "unit": part.get("unit")}
            for part in item.get("score_breakdown") or []
        ],
    })
    return out


def lifetime_reference(stats: dict[str, Any], account_id: str) -> dict[str, Any]:
    """All-history player aggregates, quoted from stats.json without recomputing.

    Giving the model the lifetime figures next to the recent window lets it tell
    a genuine change from ordinary match-to-match noise. The published win-rate
    lower bound travels with the raw rate on purpose: it is the aggregator's own
    statement of how much that rate is supported by its sample, and quoting the
    percentage without it would invite stronger claims than the data holds.
    """
    entry = (stats.get("players") or {}).get(account_id)
    if not isinstance(entry, dict):
        return {"available": False, "reason": "no_lifetime_record"}
    return {
        "available": True,
        "matches": entry.get("matches"),
        "wins": entry.get("wins"),
        "losses": entry.get("losses"),
        "win_rate": entry.get("win_rate"),
        "win_rate_lower_bound": entry.get("win_rate_confidence"),
        "kda": entry.get("kda"),
        "avg_kills": entry.get("avg_kills"),
        "avg_deaths": entry.get("avg_deaths"),
        "avg_assists": entry.get("avg_assists"),
    }


def hero_reference(stats: dict[str, Any], account_id: str, limit: int = 5) -> list[dict[str, Any]]:
    """This player's most-played heroes, from the published player-hero records.

    Only the aggregate columns are copied out. The stored records repeat the
    player's display name, which is not an identifier and has no business being
    in a provider request.
    """
    records = (stats.get("player_heroes") or {}).get(account_id) or {}
    names = stats.get("heroes") or {}
    rows: list[dict[str, Any]] = []
    for hero_id, record in records.items():
        if not isinstance(record, dict):
            continue
        hero = names.get(str(hero_id))
        row = {
            "hero_id": hero_id,
            "hero_name": hero.get("hero_name") if isinstance(hero, dict) else None,
            "matches": record.get("matches"),
            "win_rate": record.get("win_rate"),
            "kda": record.get("kda"),
        }
        rows.append(row)
    rows.sort(key=lambda row: (-(row.get("matches") or 0), str(row["hero_id"])))
    return rows[:limit]
