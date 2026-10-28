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


class ReplayTelemetryNormalizationTests(unittest.TestCase):
    def test_persists_latest_telemetry_and_schema_version(self):
        raw = "\n".join(
            [
                json.dumps({"type": "player_slot", "key": "0", "value": 0}),
                json.dumps({
                    "type": "interval",
                    "slot": 0,
                    "time": 300,
                    "hero_id": 1,
                    "unit": "CDOTA_Unit_Hero_AntiMage",
                    "kills": 4,
                    "deaths": 2,
                    "assists": 8,
                    "gold": 9000,
                    "xp": 10000,
                    "lh": 120,
                    "denies": 8,
                    "networth": 11000,
                    "hero_damage": 24000,
                    "tower_damage": 900,
                    "stuns": 12.5,
                    "obs_placed": 3,
                    "sen_placed": 2,
                    "x": 1200,
                    "y": 3000,
                }),
                _event(
                    "epilogue",
                    {
                        "gameInfo_": {"dota_": {"matchId_": 789, "gameWinner_": 2, "endTime_": 500}},
                        "playbackTime_": 300,
                    },
                ),
            ]
        )

        match = normalize_events(raw, "fallback")
        player = match["players"][0]

        self.assertEqual(match["schema_version"], normalize.SCHEMA_VERSION)
        self.assertEqual(player["hero_damage"], 24000)
        self.assertEqual(player["last_hits"], 120)
        self.assertEqual(player["obs_placed"], 3)
        self.assertIn(player["role"], {"carry", "support", "offlane", "unknown", "mid"})


class ItemPurchaseNormalizationTests(unittest.TestCase):
    def test_attaches_chronological_purchases_to_the_matching_player(self):
        def interval(slot: int, unit: str, hero_id: int) -> str:
            return json.dumps({"type": "interval", "slot": slot, "time": 300, "hero_id": hero_id, "unit": unit})

        def purchase(hero: str, item: str, time: int) -> str:
            return json.dumps({"type": "DOTA_COMBATLOG_PURCHASE", "time": time, "targetname": hero, "valuename": item})

        raw = "\n".join(
            [
                json.dumps({"type": "player_slot", "key": "0", "value": 0}),
                json.dumps({"type": "player_slot", "key": "1", "value": 128}),
                interval(0, "CDOTA_Unit_Hero_AntiMage", 1),
                interval(1, "CDOTA_Unit_Hero_Zuus", 22),
                purchase("npc_dota_hero_antimage", "item_power_treads", 600),
                purchase("npc_dota_hero_antimage", "item_tango", -30),
                purchase("npc_dota_hero_zuus", "item_blink", 900),
                purchase("npc_dota_hero_antimage", "modifier_not_an_item", 10),
                _event(
                    "epilogue",
                    {"gameInfo_": {"dota_": {"matchId_": 5, "gameWinner_": 2, "endTime_": 500}}, "playbackTime_": 300},
                ),
            ]
        )

        players = {player["hero_id"]: player for player in normalize_events(raw, "fallback")["players"]}

        self.assertEqual(
            players[1]["items"],
            [{"item": "tango", "time": -30}, {"item": "power_treads", "time": 600}],
        )
        self.assertEqual(players[22]["items"], [{"item": "blink", "time": 900}])


class FinalInventoryNormalizationTests(unittest.TestCase):
    def _normalize(self, match_info_players):
        def interval(slot: int, unit: str, hero_id: int) -> str:
            return json.dumps({"type": "interval", "slot": slot, "time": 300, "hero_id": hero_id, "unit": unit})

        events = [
            json.dumps({"type": "player_slot", "key": "0", "value": 0}),
            json.dumps({"type": "player_slot", "key": "1", "value": 128}),
            interval(0, "CDOTA_Unit_Hero_AntiMage", 1),
            interval(1, "CDOTA_Unit_Hero_Zuus", 22),
            _event("epilogue", {"gameInfo_": {"dota_": {"matchId_": 5, "gameWinner_": 2, "endTime_": 500}}, "playbackTime_": 300}),
        ]
        if match_info_players is not None:
            events.append(_event("match_info", {"lobbyType_": 1, "players_": match_info_players}))
        players = normalize_events("\n".join(events), "fallback")["players"]
        return {player["hero_id"]: player for player in players}

    def test_decodes_main_slots_and_neutral_by_player_slot(self):
        players = self._normalize(
            [
                {"playerSlot_": 128, "item0_": 116, "item1_": 0, "item2_": 147, "item3_": 0, "item4_": 0, "item5_": 249, "item6_": 48, "item9_": 1864},
                {"playerSlot_": 0, "item0_": 139, "item1_": 0, "item2_": 0, "item3_": 0, "item4_": 0, "item5_": 0, "item9_": 0},
            ]
        )

        self.assertEqual(players[22]["final_items"], ["black_king_bar", None, "manta", None, None, "silver_edge"])
        self.assertEqual(players[22]["neutral_item"], "conjurers_catalyst")
        self.assertEqual(players[1]["final_items"], ["butterfly", None, None, None, None, None])
        self.assertIsNone(players[1]["neutral_item"])

    def test_unknown_item_id_becomes_empty_slot(self):
        players = self._normalize([{"playerSlot_": 0, "item0_": 99999999, "item1_": 116}])

        self.assertEqual(players[1]["final_items"][:2], [None, "black_king_bar"])

    def test_missing_match_info_leaves_inventory_empty(self):
        players = self._normalize(None)

        self.assertEqual(players[1]["final_items"], [])
        self.assertIsNone(players[1]["neutral_item"])


if __name__ == "__main__":
    unittest.main()
