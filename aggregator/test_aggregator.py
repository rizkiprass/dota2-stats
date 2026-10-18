"""Unit tests for the private-lobby aggregation gate.

Run from the repository root:

    python -m unittest aggregator.test_aggregator

The aggregator imports boto3 at module load (and builds an S3 client), so a
minimal stub is installed before the import. The tests only exercise
``aggregate_matches``, which performs no S3 I/O.
"""

from __future__ import annotations

import sys
import types
import unittest

if "boto3" not in sys.modules:
    _boto3 = types.ModuleType("boto3")
    _boto3.client = lambda *args, **kwargs: types.SimpleNamespace()  # type: ignore[attr-defined]
    sys.modules["boto3"] = _boto3

import aggregator.aggregator as agg  # noqa: E402


def _match(match_id: str, lobby_type):
    players = []
    for index in range(10):
        team = "radiant" if index < 5 else "dire"
        players.append(
            {
                "account_id": str(1000 + index),
                "hero_id": 1 + index,
                "team": team,
                "kills": 1,
                "deaths": 1,
                "assists": 1,
                "win": team == "radiant",
            }
        )
    match = {
        "match_id": match_id,
        "duration": 1800,
        "radiant_win": True,
        "start_time": 1700000000,
        "players": players,
    }
    if lobby_type is not None:
        match["lobby_type"] = lobby_type
    return match


class LobbyGateTests(unittest.TestCase):
    def test_private_lobby_included(self):
        stats, counts, _ = agg.aggregate_matches([("parsed/1.json", _match("1", 1))])
        self.assertEqual(stats["summary"]["total_matches"], 1)
        self.assertEqual(counts["valid_matches"], 1)
        self.assertEqual(counts["excluded_non_lobby"], 0)

    def test_public_matchmaking_excluded(self):
        for lobby_type in (0, 7):
            with self.subTest(lobby_type=lobby_type):
                stats, counts, _ = agg.aggregate_matches(
                    [("parsed/1.json", _match("1", lobby_type))]
                )
                self.assertEqual(stats["summary"]["total_matches"], 0)
                self.assertEqual(counts["excluded_non_lobby"], 1)

    def test_numeric_string_lobby_type(self):
        stats, counts, _ = agg.aggregate_matches(
            [("parsed/1.json", _match("1", "0")), ("parsed/2.json", _match("2", "1"))]
        )
        self.assertEqual(stats["summary"]["total_matches"], 1)
        self.assertEqual(counts["excluded_non_lobby"], 1)

    def test_missing_lobby_type_fails_closed(self):
        stats, counts, _ = agg.aggregate_matches([("parsed/1.json", _match("1", None))])
        self.assertEqual(stats["summary"]["total_matches"], 0)
        self.assertEqual(counts["excluded_non_lobby"], 1)

    def test_mixed_dataset_keeps_only_lobbies(self):
        matches = [
            ("parsed/1.json", _match("1", 1)),
            ("parsed/2.json", _match("2", 0)),
            ("parsed/3.json", _match("3", 1)),
            ("parsed/4.json", _match("4", 7)),
        ]
        stats, counts, summaries = agg.aggregate_matches(matches)
        self.assertEqual(stats["summary"]["total_matches"], 2)
        self.assertEqual(counts["excluded_non_lobby"], 2)
        self.assertEqual({s["match_id"] for s in summaries}, {"1", "3"})


class BehaviorAggregationTests(unittest.TestCase):
    def test_publishes_count_only_activity_and_proxy_score(self):
        matches = []
        for match_id in ("1", "2", "3"):
            match = _match(match_id, 1)
            match["players"][0]["behavior"] = {
                "chat_messages": 6,
                "pings": 9,
                "ping_bursts": 2,
                "disconnects": 1,
                "abandons": 0,
                "chatwheel": {"71": 1},
            }
            matches.append((f"parsed/{match_id}.json", match))

        stats, _, _ = agg.aggregate_matches(matches)
        behavior = stats["behavior"]["players"]["1000"]

        self.assertEqual(behavior["matches"], 3)
        self.assertEqual(behavior["chat_messages"], 18)
        self.assertEqual(behavior["pings"], 27)
        self.assertEqual(behavior["ping_bursts"], 6)
        self.assertEqual(behavior["chatwheel"], {"71": 3})
        self.assertEqual(behavior["disruptive_score"], 100.0)


class PlayerRecentResultsTests(unittest.TestCase):
    def test_publishes_newest_four_outcomes_per_player(self):
        matches = []
        for match_id, start_time, win in [
            ("1", 100, True),
            ("2", 500, False),
            ("3", 300, True),
            ("4", 400, True),
            ("5", 200, False),
        ]:
            match = _match(match_id, 1)
            match["start_time"] = start_time
            match["players"][0]["win"] = win
            matches.append((f"parsed/{match_id}.json", match))

        stats, _, _ = agg.aggregate_matches(matches)

        self.assertEqual(stats["player_recent_results"]["1000"], ["L", "W", "W", "L"])


if __name__ == "__main__":
    unittest.main()
