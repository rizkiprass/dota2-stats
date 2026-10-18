"""Tests for match-level replay metadata normalization."""

from __future__ import annotations

import json
import unittest

from parser import normalize
from parser.normalize import normalize_events


def _event(event_type: str, payload: dict) -> str:
    return json.dumps({"type": event_type, "key": json.dumps(payload)})


class LobbyTypeNormalizationTests(unittest.TestCase):
    def test_extracts_lobby_type_from_match_info(self):
        raw = "\n".join(
            [
                _event("match_info", {"lobbyType_": 1}),
                _event(
                    "epilogue",
                    {
                        "gameInfo_": {
                            "dota_": {
                                "matchId_": 123,
                                "gameMode_": 23,
                                "gameWinner_": 2,
                                "endTime_": 2000,
                            }
                        },
                        "playbackTime_": 500,
                    },
                ),
            ]
        )

        match = normalize_events(raw, "fallback")

        self.assertEqual(match["match_id"], "123")
        self.assertEqual(match["game_mode"], 23)
        self.assertEqual(match["lobby_type"], 1)

    def test_missing_match_info_leaves_lobby_type_unknown(self):
        raw = _event(
            "epilogue",
            {
                "gameInfo_": {
                    "dota_": {
                        "matchId_": 456,
                        "gameMode_": 23,
                        "gameWinner_": 3,
                        "endTime_": 3000,
                    }
                },
                "playbackTime_": 600,
            },
        )

        match = normalize_events(raw, "fallback")

        self.assertIsNone(match["lobby_type"])


class BehaviorNormalizationTests(unittest.TestCase):
    def test_counts_ping_bursts_without_retaining_chat_content(self):
        behavior = normalize._finalize_behavior({
            "chat_messages": 4,
            "pings": [1.0, 2.0, 5.0, 20.0, 26.0, 27.0],
            "chatwheel": {"71": 2},
            "disconnects": 1,
            "abandons": 0,
        })

        self.assertEqual(behavior["chat_messages"], 4)
        self.assertEqual(behavior["pings"], 6)
        self.assertEqual(behavior["ping_bursts"], 1)
        self.assertEqual(behavior["chatwheel"], {"71": 2})
        self.assertEqual(behavior["disconnects"], 1)


if __name__ == "__main__":
    unittest.main()
