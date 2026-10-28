"""Full-rebuild Dota 2 private-lobby statistics Lambda.

The function is invoked for a new ``parsed/*.json`` S3 object, but always
rebuilds the complete historical dashboard payload from every object under the
``parsed/`` prefix. Invalid objects and duplicate match IDs are logged and do
not prevent a new ``stats/stats.json`` from being published.

Only private-lobby matches are aggregated: a parsed match whose ``lobby_type``
is not in ``ALLOWED_LOBBY_TYPES`` (default ``1`` = Practice) is counted as
excluded, so a public matchmaking replay that slipped into ``parsed/`` never
reaches the dashboard.

Two objects are published from one rebuild:

* ``stats/stats.json`` — the aggregate dashboard payload. It carries
  ``metadata.thresholds`` and a bounded ``recent_matches`` teaser so the
  dashboard never needs the per-match payload.
* ``stats/matches.json`` — a capped, newest-first per-match list that detail
  pages fetch lazily, so the dashboard payload does not grow with history.
"""

from __future__ import annotations

import itertools
import json
import logging
import math
import os
import time
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

PARSED_PREFIX = "parsed/"
STATS_KEY = "stats/stats.json"
MATCHES_KEY = "stats/matches.json"
SCHEMA_VERSION = "1.9"

# Optional static-website mirror. When set, the same dashboard payload is also
# written here so the browser can fetch it same-origin (no CORS, no public data
# bucket). Failures are logged and never break the primary aggregation.
DASHBOARD_BUCKET = os.environ.get("DASHBOARD_BUCKET")
DASHBOARD_STATS_KEY = os.environ.get("DASHBOARD_STATS_KEY", "stats.json")
DASHBOARD_MATCHES_KEY = os.environ.get("DASHBOARD_MATCHES_KEY", "matches.json")
MIN_PLAYER_MATCHES = int(os.environ.get("MIN_PLAYER_MATCHES", "5"))
# Private-lobby gate. Only matches whose lobby_type is in this allowlist are
# aggregated; 1 = Practice (private lobby). Public matchmaking (0 = Normal,
# 7 = Ranked), Coop bots, Battle Cup, etc. are excluded. Missing or unreadable
# lobby_type is also excluded (fail-closed) so parser regressions cannot admit
# public matches into the private-lobby statistics.
ALLOWED_LOBBY_TYPES = {
    int(value)
    for value in os.environ.get("ALLOWED_LOBBY_TYPES", "1").split(",")
    if value.strip().lstrip("-").isdigit()
}
MIN_HERO_PICKS = int(os.environ.get("MIN_HERO_PICKS", "5"))
MIN_TEAMMATE_MATCHES = int(os.environ.get("MIN_TEAMMATE_MATCHES", "3"))
MIN_H2H_MATCHES = int(os.environ.get("MIN_H2H_MATCHES", "3"))
MIN_BEHAVIOR_MATCHES = int(os.environ.get("MIN_BEHAVIOR_MATCHES", "3"))
MIN_ROLE_MATCHES = int(os.environ.get("MIN_ROLE_MATCHES", "2"))
LEADERBOARD_LIMIT = int(os.environ.get("LEADERBOARD_LIMIT", "10"))
# Newest matches kept in the lazy per-match payload. The dashboard never reads
# history itself, so only detail pages feel this cap.
MATCHES_LIMIT = int(os.environ.get("MATCHES_LIMIT", "500"))
# Newest matches summarised into stats.json so the dashboard can show a recent
# teaser without fetching the per-match payload at all.
RECENT_MATCHES_LIMIT = int(os.environ.get("RECENT_MATCHES_LIMIT", "5"))
# Per-player outcome strips are carried in stats.json for compact dashboard
# highlights. This remains bounded regardless of total replay history.
PLAYER_RECENT_RESULTS_LIMIT = int(os.environ.get("PLAYER_RECENT_RESULTS_LIMIT", "4"))

# Static hero_id -> display-name table (source: OpenDota /api/heroes).
# Display-only: it never affects identity or aggregation math.
HERO_NAMES: dict[int, str] = {
    1: 'Anti-Mage',
    2: 'Axe',
    3: 'Bane',
    4: 'Bloodseeker',
    5: 'Crystal Maiden',
    6: 'Drow Ranger',
    7: 'Earthshaker',
    8: 'Juggernaut',
    9: 'Mirana',
    10: 'Morphling',
    11: 'Shadow Fiend',
    12: 'Phantom Lancer',
    13: 'Puck',
    14: 'Pudge',
    15: 'Razor',
    16: 'Sand King',
    17: 'Storm Spirit',
    18: 'Sven',
    19: 'Tiny',
    20: 'Vengeful Spirit',
    21: 'Windranger',
    22: 'Zeus',
    23: 'Kunkka',
    25: 'Lina',
    26: 'Lion',
    27: 'Shadow Shaman',
    28: 'Slardar',
    29: 'Tidehunter',
    30: 'Witch Doctor',
    31: 'Lich',
    32: 'Riki',
    33: 'Enigma',
    34: 'Tinker',
    35: 'Sniper',
    36: 'Necrophos',
    37: 'Warlock',
    38: 'Beastmaster',
    39: 'Queen of Pain',
    40: 'Venomancer',
    41: 'Faceless Void',
    42: 'Wraith King',
    43: 'Death Prophet',
    44: 'Phantom Assassin',
    45: 'Pugna',
    46: 'Templar Assassin',
    47: 'Viper',
    48: 'Luna',
    49: 'Dragon Knight',
    50: 'Dazzle',
    51: 'Clockwerk',
    52: 'Leshrac',
    53: "Nature's Prophet",
    54: 'Lifestealer',
    55: 'Dark Seer',
    56: 'Clinkz',
    57: 'Omniknight',
    58: 'Enchantress',
    59: 'Huskar',
    60: 'Night Stalker',
    61: 'Broodmother',
    62: 'Bounty Hunter',
    63: 'Weaver',
    64: 'Jakiro',
    65: 'Batrider',
    66: 'Chen',
    67: 'Spectre',
    68: 'Ancient Apparition',
    69: 'Doom',
    70: 'Ursa',
    71: 'Spirit Breaker',
    72: 'Gyrocopter',
    73: 'Alchemist',
    74: 'Invoker',
    75: 'Silencer',
    76: 'Outworld Destroyer',
    77: 'Lycan',
    78: 'Brewmaster',
    79: 'Shadow Demon',
    80: 'Lone Druid',
    81: 'Chaos Knight',
    82: 'Meepo',
    83: 'Treant Protector',
    84: 'Ogre Magi',
    85: 'Undying',
    86: 'Rubick',
    87: 'Disruptor',
    88: 'Nyx Assassin',
    89: 'Naga Siren',
    90: 'Keeper of the Light',
    91: 'Io',
    92: 'Visage',
    93: 'Slark',
    94: 'Medusa',
    95: 'Troll Warlord',
    96: 'Centaur Warrunner',
    97: 'Magnus',
    98: 'Timbersaw',
    99: 'Bristleback',
    100: 'Tusk',
    101: 'Skywrath Mage',
    102: 'Abaddon',
    103: 'Elder Titan',
    104: 'Legion Commander',
    105: 'Techies',
    106: 'Ember Spirit',
    107: 'Earth Spirit',
    108: 'Underlord',
    109: 'Terrorblade',
    110: 'Phoenix',
    111: 'Oracle',
    112: 'Winter Wyvern',
    113: 'Arc Warden',
    114: 'Monkey King',
    119: 'Dark Willow',
    120: 'Pangolier',
    121: 'Grimstroke',
    123: 'Hoodwink',
    126: 'Void Spirit',
    128: 'Snapfire',
    129: 'Mars',
    131: 'Ringmaster',
    135: 'Dawnbreaker',
    136: 'Marci',
    137: 'Primal Beast',
    138: 'Muerta',
    145: 'Kez',
    155: 'Largo',
}


class MatchValidationError(ValueError):
    """Raised when an input parsed-match object does not meet the contract."""


def _log_event(**fields: Any) -> None:
    logger.info(json.dumps(fields, default=str, sort_keys=True))


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _round(value: float) -> float:
    """Round dashboard-facing calculated values consistently."""
    return round(value, 2)


def _rate(numerator: int | float, denominator: int | float) -> float:
    return _round((numerator / denominator) * 100) if denominator else 0.0


def _wilson_lower_bound(wins: int, matches: int, z: float = 1.96) -> float:
    """Return a conservative 95% win-rate estimate on the dashboard scale.

    The Wilson lower bound naturally discounts tiny samples without imposing a
    hard cutoff: an undefeated player still has a 100% displayed win rate, but
    needs more games before outranking a sustained record.
    """
    if matches <= 0:
        return 0.0
    proportion = wins / matches
    z_squared = z * z
    denominator = 1 + z_squared / matches
    centre = proportion + z_squared / (2 * matches)
    spread = z * math.sqrt((proportion * (1 - proportion) + z_squared / (4 * matches)) / matches)
    return _round(((centre - spread) / denominator) * 100)


def _player_id(player: dict[str, Any]) -> str | None:
    """Return the canonical long-term identity; names are never identifiers."""
    account_id = player.get("account_id")
    if account_id is None:
        return None
    value = str(account_id).strip()
    return value or None


def _player_name(player: dict[str, Any]) -> str | None:
    """Display-only label from the parser; never used as an identifier."""
    name = player.get("player_name")
    return name.strip() if isinstance(name, str) and name.strip() else None


def _pair_key(player_a: str, player_b: str) -> tuple[str, str, str]:
    first, second = sorted((player_a, player_b))
    return f"{first}#{second}", first, second


def validate_match(match: Any) -> dict[str, Any]:
    """Validate the MVP input contract and return the typed match object."""
    if not isinstance(match, dict):
        raise MatchValidationError("match must be an object")
    if match.get("match_id") is None or not str(match["match_id"]).strip():
        raise MatchValidationError("match_id is required")
    players = match.get("players")
    if not isinstance(players, list):
        raise MatchValidationError("players must be a list")
    if len(players) != 10:
        raise MatchValidationError(f"player count must be 10, got {len(players)}")
    if not isinstance(match.get("radiant_win"), bool):
        raise MatchValidationError("radiant_win must be boolean")
    if not _is_number(match.get("duration")):
        raise MatchValidationError("duration must be numeric")

    for index, player in enumerate(players):
        if not isinstance(player, dict):
            raise MatchValidationError(f"player {index} must be an object")
        if player.get("hero_id") is None:
            raise MatchValidationError(f"player {index} hero_id is required")
        if player.get("team") not in {"radiant", "dire"}:
            raise MatchValidationError(f"player {index} team must be radiant or dire")
        for field in ("kills", "deaths", "assists"):
            if not _is_number(player.get(field)):
                raise MatchValidationError(f"player {index} {field} must be numeric")
        if not isinstance(player.get("win"), bool):
            raise MatchValidationError(f"player {index} win must be boolean")
    return match


def _lobby_type(match: dict[str, Any]) -> int | None:
    """Normalize ``lobby_type`` to an int, or ``None`` when absent/unreadable."""
    value = match.get("lobby_type")
    if _is_number(value):
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value)
    return None


def _is_private_lobby(match: dict[str, Any]) -> bool:
    """True when the match belongs in the private-lobby dataset.

    ``lobby_type`` is authoritative (1 = Practice/private lobby). Missing,
    unreadable, and non-allowlisted values (public matchmaking, ranked, bots)
    are rejected.
    """
    lobby_type = _lobby_type(match)
    return lobby_type is not None and lobby_type in ALLOWED_LOBBY_TYPES


def _new_record() -> dict[str, int]:
    return {"matches": 0, "wins": 0, "kills": 0, "deaths": 0, "assists": 0}


def _new_pair_record() -> dict[str, int]:
    return {"matches": 0, "wins": 0}


def _new_h2h_record() -> dict[str, int]:
    return {"matches": 0, "player_a_wins": 0, "player_b_wins": 0}


def _new_behavior_record() -> dict[str, Any]:
    return {
        "matches": 0,
        "chat_messages": 0,
        "pings": 0,
        "ping_bursts": 0,
        "disconnects": 0,
        "abandons": 0,
        "chatwheel": defaultdict(int),
    }


def _new_role_record() -> dict[str, Any]:
    return {
        "matches": 0,
        "wins": 0,
        "duration": 0.0,
        "kill_participation": 0.0,
        "gpm": 0.0,
        "xpm": 0.0,
        "last_hits": 0.0,
        "hero_damage_per_minute": 0.0,
        "tower_damage_per_minute": 0.0,
        "stuns_per_minute": 0.0,
        "vision": 0.0,
        "assists": 0.0,
        "role_confidence": 0.0,
    }


def _number(value: Any) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def _add_role_observation(record: dict[str, Any], player: dict[str, Any], duration: float) -> None:
    minutes = max(duration / 60.0, 1.0)
    record["matches"] += 1
    record["wins"] += int(player["win"])
    record["duration"] += duration
    record["kill_participation"] += _number(player.get("kill_participation"))
    record["gpm"] += _number(player.get("gold")) / minutes
    record["xpm"] += _number(player.get("xp")) / minutes
    record["last_hits"] += _number(player.get("last_hits"))
    record["hero_damage_per_minute"] += _number(player.get("hero_damage")) / minutes
    record["tower_damage_per_minute"] += _number(player.get("tower_damage")) / minutes
    record["stuns_per_minute"] += _number(player.get("stuns")) / minutes
    record["vision"] += _number(player.get("obs_placed")) + _number(player.get("sen_placed"))
    record["assists"] += _number(player.get("assists"))
    record["role_confidence"] += _number(player.get("role_confidence"))


ROLE_SCORING: dict[str, dict[str, Any]] = {
    "support": {
        "description": "Lobby-relative support impact from vision, participation, assists, disable, and wins.",
        "metrics": [
            ("vision", "Vision contribution", 0.30, "wards per match"),
            ("kill_participation", "Kill participation", 0.25, "%"),
            ("assists", "Assists", 0.20, "per match"),
            ("stuns_per_minute", "Disable", 0.15, "minutes"),
            ("win_rate", "Win rate", 0.10, "%"),
        ],
    },
    "offlane": {
        "description": "Lobby-relative offlane impact from fights, damage, objectives, disable, and wins.",
        "metrics": [
            ("kill_participation", "Kill participation", 0.25, "%"),
            ("hero_damage_per_minute", "Hero damage", 0.25, "per minute"),
            ("tower_damage_per_minute", "Tower damage", 0.20, "per minute"),
            ("stuns_per_minute", "Disable", 0.20, "minutes"),
            ("win_rate", "Win rate", 0.10, "%"),
        ],
    },
    "carry": {
        "description": "Lobby-relative carry impact from farm, hero damage, objectives, last hits, and wins.",
        "metrics": [
            ("gpm", "Gold per minute", 0.30, "GPM"),
            ("hero_damage_per_minute", "Hero damage", 0.25, "per minute"),
            ("tower_damage_per_minute", "Tower damage", 0.25, "per minute"),
            ("last_hits", "Last hits", 0.10, "per match"),
            ("win_rate", "Win rate", 0.10, "%"),
        ],
    },
}


def _finalize_role_records(
    records: dict[str, dict[str, dict[str, Any]]],
    player_names: dict[str, str],
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, int]]:
    """Publish role rankings using role-specific, lobby-relative metrics."""
    rankings: dict[str, list[dict[str, Any]]] = {}
    eligible_counts: dict[str, int] = {}
    for role, role_records in records.items():
        finalized: list[dict[str, Any]] = []
        for player_id, record in role_records.items():
            if record["matches"] < MIN_ROLE_MATCHES:
                continue
            matches = record["matches"]
            item = {
                "id": player_id,
                "player_name": player_names.get(player_id),
                "role": role,
                "matches": matches,
                "wins": record["wins"],
                "win_rate": _rate(record["wins"], matches),
                "kill_participation": _round(record["kill_participation"] / matches),
                "gpm": _round(record["gpm"] / matches),
                "xpm": _round(record["xpm"] / matches),
                "last_hits": _round(record["last_hits"] / matches),
                "hero_damage_per_minute": _round(record["hero_damage_per_minute"] / matches),
                "tower_damage_per_minute": _round(record["tower_damage_per_minute"] / matches),
                "stuns_per_minute": _round(record["stuns_per_minute"] / matches),
                "vision": _round(record["vision"] / matches),
                "assists": _round(record["assists"] / matches),
                "role_confidence": _round(record["role_confidence"] / matches),
            }
            finalized.append(item)
        metrics = ROLE_SCORING[role]["metrics"]
        maxima = {
            metric: max((item[metric] for item in finalized), default=0.0)
            for metric, _, _, _ in metrics
            if metric != "win_rate"
        }
        eligible_counts[role] = len(finalized)
        for item in finalized:
            score = 0.0
            breakdown = []
            for metric, label, weight, unit in metrics:
                maximum = 100.0 if metric == "win_rate" else maxima.get(metric, 0.0)
                normalized = ((item[metric] / maximum) if maximum else 0.0) * 100
                contribution = weight * normalized
                score += contribution
                breakdown.append({
                    "key": metric,
                    "label": label,
                    "value": item[metric],
                    "normalized": _round(normalized),
                    "weight": _round(weight * 100),
                    "contribution": _round(contribution),
                    "unit": unit,
                })
            item["score"] = _round(score)
            item["score_breakdown"] = breakdown
        rankings[role] = sorted(finalized, key=lambda item: (-item["score"], -item["matches"], item["id"]))[:LEADERBOARD_LIMIT]
    return rankings, eligible_counts


def _role_scoring_metadata(
    rankings: dict[str, list[dict[str, Any]]],
    eligible_counts: dict[str, int],
) -> dict[str, dict[str, Any]]:
    return {
        role: {
            "description": config["description"],
            "minimum_matches": MIN_ROLE_MATCHES,
            "eligible_players": eligible_counts.get(role, 0),
            "method": "Lobby-relative weighted score",
            "metrics": [
                {"key": key, "label": label, "weight": _round(weight * 100), "unit": unit}
                for key, label, weight, unit in config["metrics"]
            ],
        }
        for role, config in ROLE_SCORING.items()
    }


def _add_player_observation(record: dict[str, int], player: dict[str, Any]) -> None:
    record["matches"] += 1
    record["wins"] += int(player["win"])
    record["kills"] += player["kills"]
    record["deaths"] += player["deaths"]
    record["assists"] += player["assists"]


def _add_behavior_observation(record: dict[str, Any], player: dict[str, Any]) -> None:
    """Aggregate count-only replay activity; never retain raw chat content."""
    record["matches"] += 1
    behavior = player.get("behavior")
    if not isinstance(behavior, dict):
        return
    for field in ("chat_messages", "pings", "ping_bursts", "disconnects", "abandons"):
        value = behavior.get(field)
        if _is_number(value) and value > 0:
            record[field] += int(value)
    chatwheel = behavior.get("chatwheel")
    if isinstance(chatwheel, dict):
        for key, count in chatwheel.items():
            if _is_number(count) and count > 0:
                record["chatwheel"][str(key)] += int(count)


def _finalize_player_record(record: dict[str, int]) -> dict[str, Any]:
    matches = record["matches"]
    wins = record["wins"]
    return {
        "matches": matches,
        "wins": wins,
        "losses": matches - wins,
        "win_rate": _rate(wins, matches),
        # A 2–0 record is a perfect raw win rate, but it is not as reliable as
        # a 12–4 record. Publish the conservative lower bound used exclusively
        # to rank the player win-rate board; the raw percentage stays visible.
        "win_rate_confidence": _wilson_lower_bound(wins, matches),
        "kills": record["kills"],
        "deaths": record["deaths"],
        "assists": record["assists"],
        "avg_kills": _round(record["kills"] / matches) if matches else 0.0,
        "avg_deaths": _round(record["deaths"] / matches) if matches else 0.0,
        "avg_assists": _round(record["assists"] / matches) if matches else 0.0,
        "kda": _round((record["kills"] + record["assists"]) / max(record["deaths"], 1)),
    }


def _finalize_behavior_records(records: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Publish replay activity and its transparent, comparative proxy score."""
    finalized = {
        player_id: {
            "matches": record["matches"],
            "chat_messages": record["chat_messages"],
            "chat_messages_per_match": _round(record["chat_messages"] / record["matches"]) if record["matches"] else 0.0,
            "pings": record["pings"],
            "pings_per_match": _round(record["pings"] / record["matches"]) if record["matches"] else 0.0,
            "ping_bursts": record["ping_bursts"],
            "ping_bursts_per_match": _round(record["ping_bursts"] / record["matches"]) if record["matches"] else 0.0,
            "disconnects": record["disconnects"],
            "abandons": record["abandons"],
            "disconnects_or_abandons_per_match": _round((record["disconnects"] + record["abandons"]) / record["matches"]) if record["matches"] else 0.0,
            "chatwheel": dict(sorted(record["chatwheel"].items())),
        }
        for player_id, record in sorted(records.items())
    }
    eligible = [record for record in finalized.values() if record["matches"] >= MIN_BEHAVIOR_MATCHES]
    maxima = {
        metric: max((record[metric] for record in eligible), default=0.0)
        for metric in ("chat_messages_per_match", "ping_bursts_per_match", "disconnects_or_abandons_per_match")
    }
    for record in finalized.values():
        if record["matches"] < MIN_BEHAVIOR_MATCHES:
            record["disruptive_score"] = 0.0
            continue
        def normalized(metric: str) -> float:
            maximum = maxima[metric]
            return record[metric] / maximum if maximum else 0.0
        record["disruptive_score"] = _round(
            100 * (
                0.35 * normalized("chat_messages_per_match")
                + 0.25 * normalized("ping_bursts_per_match")
                + 0.40 * normalized("disconnects_or_abandons_per_match")
            )
        )
    return finalized


def _finalize_player_hero_record(record: dict[str, int]) -> dict[str, Any]:
    result = _finalize_player_record(record)
    del result["avg_kills"]
    del result["avg_deaths"]
    del result["avg_assists"]
    return result


def _normalize_hero_id(hero_id: Any) -> Any:
    """Hero ids are numeric in the payload; unknown shapes pass through."""
    text = str(hero_id)
    return int(text) if text.lstrip("-").isdigit() else hero_id


def _match_summary(match: dict[str, Any]) -> dict[str, Any]:
    """Counts-only per-match record for the lazy ``matches.json`` payload.

    Carries per-player figures only. It never includes chat text or raw log
    lines, matching the dashboard contract of counts without content.
    """
    players: list[dict[str, Any]] = []
    for player in match["players"]:
        hero_id = _normalize_hero_id(player["hero_id"])
        players.append({
            "account_id": _player_id(player),
            "player_name": _player_name(player),
            "hero_id": hero_id,
            "hero_name": HERO_NAMES.get(hero_id) if isinstance(hero_id, int) else None,
            "team": player["team"],
            "win": player["win"],
            "kills": player["kills"],
            "deaths": player["deaths"],
            "assists": player["assists"],
            "final_items": player.get("final_items") or [],
            "neutral_item": player.get("neutral_item"),
        })
    start_time = match.get("start_time")
    return {
        "match_id": str(match["match_id"]),
        "start_time": start_time if _is_number(start_time) else None,
        "duration": match["duration"],
        "radiant_win": match["radiant_win"],
        "players": players,
    }


def _match_order_key(item: dict[str, Any]) -> tuple[float, str]:
    """Newest first: by start time, then match id.

    Every newest-first consumer shares this one definition, so the dashboard
    teaser and the per-match payload can never disagree about what is newest.
    """
    start = item.get("start_time")
    return (float(start) if _is_number(start) else 0.0, item["match_id"])


def _team_kills(item: dict[str, Any], team: str) -> Any:
    return sum(player["kills"] for player in item["players"] if player["team"] == team)


def _team_heroes(item: dict[str, Any], team: str) -> list[Any]:
    """Hero ids for one side, in the order the parser listed them.

    The dashboard strip and the /matches lineup both read this order, so the two
    views can never disagree about who played what.
    """
    return [player["hero_id"] for player in item["players"] if player["team"] == team]


def _team_players(item: dict[str, Any], team: str) -> list[dict[str, Any]]:
    """Identity and display name for one side, in the parser's order.

    Index-aligned with ``_team_heroes``: both walk the same players list with
    the same team filter, so a name always pairs with the hero it fielded. An
    entry is emitted for every player, even without an account_id, so the
    alignment never shifts.
    """
    return [
        {"account_id": _player_id(player), "player_name": _player_name(player)}
        for player in item["players"]
        if player["team"] == team
    ]


def _recent_matches(summaries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bounded newest-match teaser carried by stats.json.

    The dashboard fetches only stats.json, so it must never grow with history:
    this is capped, while the full list lives in the per-match payload.
    """
    ordered = sorted(summaries, key=_match_order_key, reverse=True)[:RECENT_MATCHES_LIMIT]
    return [
        {
            "match_id": item["match_id"],
            "start_time": item.get("start_time"),
            "duration": item["duration"],
            "radiant_win": item["radiant_win"],
            "radiant_kills": _team_kills(item, "radiant"),
            "dire_kills": _team_kills(item, "dire"),
            # Hero ids only: names resolve from stats.heroes, and this keeps the
            # teaser small. The per-side player arrays below carry the display
            # identity, index-aligned with these hero ids.
            "radiant_heroes": _team_heroes(item, "radiant"),
            "dire_heroes": _team_heroes(item, "dire"),
            "radiant_players": _team_players(item, "radiant"),
            "dire_players": _team_players(item, "dire"),
        }
        for item in ordered
    ]


def _player_recent_results(summaries: list[dict[str, Any]]) -> dict[str, list[str]]:
    """Newest-first, bounded W/L histories derived from parsed match summaries."""
    results: defaultdict[str, list[str]] = defaultdict(list)
    for match in sorted(summaries, key=_match_order_key, reverse=True):
        for player in match["players"]:
            player_id = player.get("account_id")
            if player_id is None or len(results[player_id]) >= PLAYER_RECENT_RESULTS_LIMIT:
                continue
            results[player_id].append("W" if player["win"] else "L")
    return dict(sorted(results.items()))


def _matches_payload(summaries: list[dict[str, Any]], generated_at: str) -> dict[str, Any]:
    """Newest-first, capped per-match payload published next to stats.json."""
    ordered = sorted(summaries, key=_match_order_key, reverse=True)[:MATCHES_LIMIT]
    return {
        "generated_at": generated_at,
        "schema_version": SCHEMA_VERSION,
        "match_count": len(summaries),
        "matches": ordered,
    }


def _load_matches(bucket: str) -> tuple[list[tuple[str, dict[str, Any]]], int]:
    """Read all parsed JSON objects, returning valid matches and file count."""
    paginator = s3.get_paginator("list_objects_v2")
    matches: list[tuple[str, dict[str, Any]]] = []
    file_count = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=PARSED_PREFIX):
        for item in page.get("Contents", []):
            key = item["Key"]
            if key == PARSED_PREFIX or not key.lower().endswith(".json"):
                continue
            file_count += 1
            try:
                response = s3.get_object(Bucket=bucket, Key=key)
                payload = json.loads(response["Body"].read().decode("utf-8"))
                matches.append((key, validate_match(payload)))
            except (MatchValidationError, UnicodeDecodeError, json.JSONDecodeError) as exc:
                logger.warning("Skipping invalid parsed match %s: %s", key, exc)
            except Exception:  # noqa: BLE001 - one S3 object must not abort rebuilding history
                logger.exception("Skipping unreadable parsed match %s", key)
    return sorted(matches, key=lambda item: item[0]), file_count


def _leaderboard(entries: Iterable[dict[str, Any]], metric: str) -> list[dict[str, Any]]:
    """Rank deterministic payloads by a descending metric and stable ID tie-break."""
    return sorted(entries, key=lambda entry: (-entry[metric], entry["id"]))[:LEADERBOARD_LIMIT]


def _generate_leaderboards(
    players: dict[str, dict[str, Any]],
    heroes: dict[str, dict[str, Any]],
    player_heroes: dict[str, dict[str, dict[str, Any]]],
    teammates: dict[str, dict[str, Any]],
    head_to_head: dict[str, dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    eligible_players = [
        {"id": player_id, **record}
        for player_id, record in players.items()
        if record["matches"] >= MIN_PLAYER_MATCHES
    ]
    eligible_heroes = [
        {"id": hero_id, **record}
        for hero_id, record in heroes.items()
        if record["picks"] >= MIN_HERO_PICKS
    ]
    eligible_duos = [
        {"id": pair_id, **record}
        for pair_id, record in teammates.items()
        if record["matches"] >= MIN_TEAMMATE_MATCHES
    ]
    eligible_rivalries = [
        {"id": pair_id, **record}
        for pair_id, record in head_to_head.items()
        if record["matches"] >= MIN_H2H_MATCHES
    ]
    player_hero_entries = [
        {"id": f"{player_id}#{hero_id}", "player_id": player_id, "hero_id": int(hero_id), **record}
        for player_id, hero_records in player_heroes.items()
        for hero_id, record in hero_records.items()
        if record["matches"] >= MIN_HERO_PICKS
    ]
    return {
        "most_matches": _leaderboard(eligible_players, "matches"),
        "highest_win_rate": _leaderboard(eligible_players, "win_rate_confidence"),
        "most_kills": _leaderboard(eligible_players, "kills"),
        "best_kda": _leaderboard(eligible_players, "kda"),
        "most_assists": _leaderboard(eligible_players, "assists"),
        "most_picked_hero": _leaderboard(eligible_heroes, "picks"),
        "best_hero_win_rate": _leaderboard(player_hero_entries, "win_rate"),
        "best_duo_win_rate": _leaderboard(eligible_duos, "win_rate"),
        "most_played_duo": _leaderboard(eligible_duos, "matches"),
        "most_played_rivalry": _leaderboard(eligible_rivalries, "matches"),
    }


def aggregate_matches(
    matches: Iterable[tuple[str, dict[str, Any]]],
) -> tuple[dict[str, Any], dict[str, int], list[dict[str, Any]]]:
    """Aggregate validated objects into the dashboard schema without S3 I/O.

    Returns the dashboard stats, a counts summary for logging, and the
    per-match summaries that feed the lazy ``matches.json`` payload.
    """
    processed_match_ids: set[str] = set()
    players: defaultdict[str, dict[str, int]] = defaultdict(_new_record)
    player_names: dict[str, str] = {}
    heroes: defaultdict[str, dict[str, int]] = defaultdict(
        lambda: {"picks": 0, "wins": 0, "radiant_picks": 0, "dire_picks": 0, "contested": 0}
    )
    player_heroes: defaultdict[str, defaultdict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(_new_record))
    teammates: defaultdict[str, dict[str, int]] = defaultdict(_new_pair_record)
    head_to_head: defaultdict[str, dict[str, int]] = defaultdict(_new_h2h_record)
    behavior: defaultdict[str, dict[str, Any]] = defaultdict(_new_behavior_record)
    role_performance: defaultdict[str, defaultdict[str, dict[str, Any]]] = defaultdict(
        lambda: defaultdict(_new_role_record)
    )
    radiant_wins = 0
    total_duration = 0.0
    duplicate_count = 0
    excluded_lobby_count = 0
    valid_count = 0
    match_summaries: list[dict[str, Any]] = []

    for _, match in matches:
        match_id = str(match["match_id"])
        if match_id in processed_match_ids:
            duplicate_count += 1
            logger.warning("Skipping duplicate match_id %s", match_id)
            continue
        processed_match_ids.add(match_id)
        if not _is_private_lobby(match):
            # Public matchmaking leaked in (e.g. a Turbo replay uploaded from the
            # Dota replay folder). Kept in raw/parsed, excluded from statistics.
            excluded_lobby_count += 1
            logger.info(
                "Skipping non-lobby match %s (lobby_type=%s not in %s)",
                match_id,
                match.get("lobby_type"),
                sorted(ALLOWED_LOBBY_TYPES),
            )
            continue
        valid_count += 1
        match_summaries.append(_match_summary(match))
        total_duration += match["duration"]
        radiant_wins += int(match["radiant_win"])

        radiant: list[tuple[str, dict[str, Any]]] = []
        dire: list[tuple[str, dict[str, Any]]] = []
        # Tracked separately from the account-holder split below: a hero counts
        # toward a side even when the player has no account_id.
        radiant_heroes: set[str] = set()
        dire_heroes: set[str] = set()
        for player in match["players"]:
            hero_id = str(player["hero_id"])
            hero_record = heroes[hero_id]
            hero_record["picks"] += 1
            hero_record["wins"] += int(player["win"])
            on_radiant = player["team"] == "radiant"
            hero_record["radiant_picks" if on_radiant else "dire_picks"] += 1
            (radiant_heroes if on_radiant else dire_heroes).add(hero_id)
            player_id = _player_id(player)
            if player_id is None:
                continue
            name = player.get("player_name")
            if isinstance(name, str) and name.strip():
                # Display-only label; the latest match's name wins deterministically.
                player_names[player_id] = name.strip()
            _add_player_observation(players[player_id], player)
            _add_behavior_observation(behavior[player_id], player)
            _add_player_observation(player_heroes[player_id][hero_id], player)
            role = player.get("role")
            if role in {"support", "offlane", "carry"}:
                _add_role_observation(role_performance[role][player_id], player, match["duration"])
            (radiant if on_radiant else dire).append((player_id, player))

        # A contested hero is one BOTH sides picked in the same match. The count
        # is per match, not per pick.
        for hero_id in radiant_heroes & dire_heroes:
            heroes[hero_id]["contested"] += 1

        for team in (radiant, dire):
            for (first_id, first), (second_id, _) in itertools.combinations(team, 2):
                key, player_a, player_b = _pair_key(first_id, second_id)
                record = teammates[key]
                record["matches"] += 1
                record["wins"] += int(first["win"])

        for radiant_id, radiant_player in radiant:
            for dire_id, dire_player in dire:
                key, player_a, player_b = _pair_key(radiant_id, dire_id)
                record = head_to_head[key]
                record["matches"] += 1
                if player_a == radiant_id:
                    record["player_a_wins"] += int(radiant_player["win"])
                    record["player_b_wins"] += int(dire_player["win"])
                else:
                    record["player_a_wins"] += int(dire_player["win"])
                    record["player_b_wins"] += int(radiant_player["win"])

    finalized_players = {
        player_id: {**_finalize_player_record(record), "player_name": player_names.get(player_id)}
        for player_id, record in sorted(players.items())
    }
    finalized_heroes = {
        hero_id: {
            "hero_id": int(hero_id) if hero_id.lstrip("-").isdigit() else hero_id,
            "hero_name": HERO_NAMES.get(int(hero_id)) if hero_id.lstrip("-").isdigit() else None,
            "picks": record["picks"],
            "wins": record["wins"],
            "losses": record["picks"] - record["wins"],
            "win_rate": _rate(record["wins"], record["picks"]),
            "radiant_picks": record["radiant_picks"],
            "dire_picks": record["dire_picks"],
            "contested": record["contested"],
        }
        for hero_id, record in sorted(heroes.items(), key=lambda item: item[0])
    }
    finalized_player_heroes = {
        player_id: {
            hero_id: {**_finalize_player_hero_record(record), "player_name": player_names.get(player_id)}
            for hero_id, record in sorted(hero_records.items())
        }
        for player_id, hero_records in sorted(player_heroes.items())
    }
    finalized_teammates = {
        pair_id: {
            "player_a": pair_id.split("#", 1)[0], "player_b": pair_id.split("#", 1)[1],
            "matches": record["matches"], "wins": record["wins"], "losses": record["matches"] - record["wins"],
            "win_rate": _rate(record["wins"], record["matches"]),
        }
        for pair_id, record in sorted(teammates.items())
    }
    finalized_h2h = {
        pair_id: {
            "player_a": pair_id.split("#", 1)[0], "player_b": pair_id.split("#", 1)[1],
            "matches": record["matches"], "player_a_wins": record["player_a_wins"], "player_b_wins": record["player_b_wins"],
            "player_a_win_rate": _rate(record["player_a_wins"], record["matches"]),
            "player_b_win_rate": _rate(record["player_b_wins"], record["matches"]),
        }
        for pair_id, record in sorted(head_to_head.items())
    }
    finalized_behavior = _finalize_behavior_records(behavior)
    finalized_roles, role_eligible_counts = _finalize_role_records(role_performance, player_names)
    summary = {
        "total_matches": valid_count,
        "total_players": len(finalized_players),
        "total_hero_picks": sum(record["picks"] for record in heroes.values()),
        "average_duration_seconds": _round(total_duration / valid_count) if valid_count else 0.0,
        "radiant_wins": radiant_wins,
        "dire_wins": valid_count - radiant_wins,
        "radiant_win_rate": _rate(radiant_wins, valid_count),
        "dire_win_rate": _rate(valid_count - radiant_wins, valid_count),
    }
    stats = {
        "summary": summary,
        "players": finalized_players,
        "heroes": finalized_heroes,
        "player_heroes": finalized_player_heroes,
        "teammates": finalized_teammates,
        "head_to_head": finalized_h2h,
        "behavior": {"players": finalized_behavior},
        "role_rankings": finalized_roles,
        "role_scoring": _role_scoring_metadata(finalized_roles, role_eligible_counts),
        "leaderboards": _generate_leaderboards(finalized_players, finalized_heroes, finalized_player_heroes, finalized_teammates, finalized_h2h),
        "recent_matches": _recent_matches(match_summaries),
        "player_recent_results": _player_recent_results(match_summaries),
    }
    return stats, {
        "valid_matches": valid_count,
        "duplicate_matches": duplicate_count,
        "excluded_non_lobby": excluded_lobby_count,
        "unique_players": len(finalized_players),
        "unique_heroes": len(finalized_heroes),
        "teammate_pairs": len(finalized_teammates),
        "head_to_head_pairs": len(finalized_h2h),
        "match_summaries": len(match_summaries),
    }, match_summaries


def _encode(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _mirror_dashboard(key: str, body: bytes) -> None:
    """Copy an object into the static website bucket; never raise on failure."""
    if not DASHBOARD_BUCKET:
        return
    try:
        s3.put_object(Bucket=DASHBOARD_BUCKET, Key=key, Body=body, ContentType="application/json")
    except Exception:  # noqa: BLE001 - the data bucket remains the source of truth
        logger.exception("Failed to publish %s to %s", key, DASHBOARD_BUCKET)


def rebuild_statistics(bucket: str) -> dict[str, Any]:
    """Load history from S3, publish the stats and matches JSON, and return stats."""
    started_at = time.monotonic()
    _log_event(message="Aggregation started", bucket=bucket)
    matches, parsed_file_count = _load_matches(bucket)
    stats, counts, match_summaries = aggregate_matches(matches)
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    stats["metadata"] = {
        "generated_at": generated_at,
        "schema_version": SCHEMA_VERSION,
        "source_match_count": counts["valid_matches"],
        # Single source of truth for the leaderboard minimums, so clients do
        # not duplicate the environment-configured numbers.
        "thresholds": {
            "players": MIN_PLAYER_MATCHES,
            "heroes": MIN_HERO_PICKS,
            "teammates": MIN_TEAMMATE_MATCHES,
            "head_to_head": MIN_H2H_MATCHES,
            "behavior": MIN_BEHAVIOR_MATCHES,
            "leaderboard_limit": LEADERBOARD_LIMIT,
        },
    }
    payload = _encode(stats)
    s3.put_object(Bucket=bucket, Key=STATS_KEY, Body=payload, ContentType="application/json")
    _mirror_dashboard(DASHBOARD_STATS_KEY, payload)

    # The per-match payload is secondary: losing it must never cost the
    # aggregate, so its own failures are logged rather than raised.
    matches_bytes = b""
    matches_published = 0
    try:
        matches_payload = _matches_payload(match_summaries, generated_at)
        matches_bytes = _encode(matches_payload)
        matches_published = len(matches_payload["matches"])
        s3.put_object(Bucket=bucket, Key=MATCHES_KEY, Body=matches_bytes, ContentType="application/json")
        _mirror_dashboard(DASHBOARD_MATCHES_KEY, matches_bytes)
    except Exception:  # noqa: BLE001 - stats.json stays the source of truth
        logger.exception("Failed to publish the per-match payload")

    _log_event(
        message="Aggregation completed",
        parsed_files_found=parsed_file_count,
        invalid_matches=parsed_file_count - len(matches),
        duplicate_matches_skipped=counts["duplicate_matches"],
        non_lobby_matches_excluded=counts["excluded_non_lobby"],
        unique_players=counts["unique_players"],
        unique_heroes=counts["unique_heroes"],
        teammate_pairs=counts["teammate_pairs"],
        head_to_head_pairs=counts["head_to_head_pairs"],
        stats_json_bytes=len(payload),
        matches_published=matches_published,
        matches_json_bytes=len(matches_bytes),
        matches_limit=MATCHES_LIMIT,
        aggregation_duration_seconds=_round(time.monotonic() - started_at),
    )
    return stats


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Rebuild once per affected bucket, even when S3 batches records."""
    buckets = {
        record.get("s3", {}).get("bucket", {}).get("name")
        for record in event.get("Records", [])
        if urllib.parse.unquote_plus(record.get("s3", {}).get("object", {}).get("key", "")).startswith(PARSED_PREFIX)
    }
    buckets.discard(None)
    results = []
    for bucket in sorted(buckets):
        stats = rebuild_statistics(bucket)
        results.append({"bucket": bucket, "source_match_count": stats["metadata"]["source_match_count"]})
    return {"results": results}
