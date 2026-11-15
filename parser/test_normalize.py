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
    def test_timeline_aggregates_complete_teams_and_excludes_chat_and_illusions(self):
        events = []
        for slot in range(10):
            events.append({"type": "player_slot", "key": str(slot), "value": slot if slot < 5 else 128 + slot - 5})
            events.append({"type": "interval", "slot": slot, "time": 60, "hero_id": slot + 1, "unit": "CDOTA_Unit_Hero_Axe", "networth": 1000 + slot})
        events.extend([
            {"type": "DOTA_COMBATLOG_DEATH", "time": 61, "targethero": True, "targetillusion": False, "targetname": "npc_dota_hero_axe"},
            {"type": "DOTA_COMBATLOG_DEATH", "time": 62, "targethero": True, "targetillusion": True},
            {"type": "DOTA_COMBATLOG_TEAM_BUILDING_KILL", "time": 65, "targetname": "npc_dota_goodguys_tower1_mid"},
            {"type": "chat", "slot": 0, "key": "private message"},
        ])
        result = normalize_events("\n".join(map(json.dumps, events)), "123")
        self.assertEqual(result["timeline"]["snapshots"][0]["radiant"]["networth"], 5010)
        self.assertEqual(result["timeline"]["snapshots"][0]["dire"]["networth"], 5035)
        self.assertEqual([event["type"] for event in result["timeline"]["events"]], ["hero_death", "building_destroyed"])
        self.assertNotIn("private message", json.dumps(result))

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


class PlayerSnapshotNormalizationTests(unittest.TestCase):
    """Schema 8 keeps the per-player minute series that the team reduction sums.

    The series is additive: `timeline.snapshots` and `timeline.events` must stay
    exactly as schema 7 published them, and a replay gap must never be turned
    into a measured zero.
    """

    @staticmethod
    def _slots() -> list[str]:
        return [
            json.dumps({
                "type": "player_slot",
                "key": str(slot),
                "value": slot if slot < 5 else 128 + slot - 5,
            })
            for slot in range(10)
        ]

    @staticmethod
    def _intervals(minute: int, slots, networth: int = 1000) -> list[str]:
        """One complete interval event per slot, so a slot offset identifies it."""
        return [
            json.dumps({
                "type": "interval",
                "slot": slot,
                "time": minute,
                "hero_id": slot + 1,
                "unit": "CDOTA_Unit_Hero_Axe",
                "networth": networth + slot,
                "xp": 100 + slot,
                "lh": 10 + slot,
                "hero_damage": 200 + slot,
                "tower_damage": 5,
            })
            for slot in slots
        ]

    def _normalize(self, events: list[str]) -> dict:
        return normalize_events("\n".join(events), "123")

    def _series(self, result: dict, minute: int) -> list[dict]:
        return [entry for entry in result["timeline"]["player_snapshots"] if entry["time"] == minute]

    def test_player_index_matches_the_player_order(self):
        result = self._normalize(self._slots() + self._intervals(60, range(10)))
        series = self._series(result, 60)

        self.assertEqual(len(series), 10)
        self.assertEqual({entry["player_index"] for entry in series}, set(range(10)))
        # players and player_slots are both built from sorted slots, so index i
        # describes players[i]; networth was seeded as 1000 + slot.
        for entry in series:
            self.assertEqual(entry["networth"], 1000 + entry["player_index"])
            self.assertEqual(result["players"][entry["player_index"]]["networth"], entry["networth"])

    def test_team_snapshot_still_equals_the_sum_of_the_player_series(self):
        result = self._normalize(self._slots() + self._intervals(60, range(10)))
        team = result["timeline"]["snapshots"][0]
        entries = {entry["player_index"]: entry for entry in self._series(result, 60)}

        for team_name, indices in (("radiant", range(0, 5)), ("dire", range(5, 10))):
            for metric in normalize.SNAPSHOT_METRICS:
                self.assertEqual(team[team_name][metric], sum(entries[index][metric] for index in indices))

    def test_missing_slot_minute_yields_no_entry_instead_of_zero(self):
        # Slot 3 reports nothing at minute 120.
        result = self._normalize(
            self._slots()
            + self._intervals(60, range(10))
            + self._intervals(120, [0, 1, 2, 4, 5, 6, 7, 8, 9])
        )
        series = self._series(result, 120)

        self.assertEqual(len(series), 9)
        self.assertNotIn(3, {entry["player_index"] for entry in series})
        self.assertEqual([entry["time"] for entry in result["timeline"]["player_snapshots"] if entry["player_index"] == 3], [60])
        # The same gap drops the incomplete radiant team snapshot, so the two
        # views stay independent instead of one masking the other.
        self.assertEqual([snapshot["time"] for snapshot in result["timeline"]["snapshots"]], [60])

    def test_non_numeric_metric_is_dropped_not_zero_filled(self):
        events = self._slots() + [
            json.dumps({
                "type": "interval",
                "slot": 0,
                "time": 60,
                "hero_id": 1,
                "unit": "CDOTA_Unit_Hero_Axe",
                "networth": 1000,
                "xp": None,
                "lh": "n/a",
                "hero_damage": 200,
                "tower_damage": 5,
            })
        ] + self._intervals(60, range(1, 10))
        entry = next(item for item in self._series(self._normalize(events), 60) if item["player_index"] == 0)

        self.assertNotIn("xp", entry)
        self.assertNotIn("lh", entry)
        self.assertEqual(entry["networth"], 1000)
        self.assertEqual(entry["hero_damage"], 200)

    def test_series_is_time_ordered_regardless_of_event_order(self):
        result = self._normalize(
            self._slots() + self._intervals(120, range(10)) + self._intervals(60, range(10))
        )
        times = [entry["time"] for entry in result["timeline"]["player_snapshots"]]

        self.assertEqual(times, [60] * 10 + [120] * 10)

    def test_zero_minute_is_kept_as_game_start(self):
        result = self._normalize(self._slots() + self._intervals(0, range(10)))

        self.assertEqual({entry["time"] for entry in result["timeline"]["player_snapshots"]}, {0})

    def test_duplicate_heroes_keep_separate_series(self):
        # Every slot fields the same hero, so hero identity cannot separate them
        # and the explicit player_index must.
        result = self._normalize(self._slots() + self._intervals(60, range(10), networth=700))
        series = self._series(result, 60)

        self.assertEqual(len(series), 10)
        self.assertEqual(len({entry["player_index"] for entry in series}), 10)
        self.assertTrue(all(entry["networth"] == 700 + entry["player_index"] for entry in series))

    def test_absent_minute_telemetry_yields_empty_series(self):
        result = self._normalize(self._slots())

        self.assertEqual(result["timeline"]["player_snapshots"], [])
        self.assertEqual(result["timeline"]["snapshots"], [])


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
                json.dumps({"type": "DOTA_COMBATLOG_PURCHASE", "targetname": "npc_dota_hero_antimage", "valuename": "item_branches"}),
                purchase("npc_dota_hero_antimage", "item_blink", 0),
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
            [{"item": "tango", "time": -30}, {"item": "blink", "time": 0}, {"item": "power_treads", "time": 600}, {"item": "branches", "time": None}],
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
