"""Tests for the deterministic player-profile metrics behind the AI analysis.

These functions are the evidence layer for every generated profile, so the tests
concentrate on the ways an analysis can be wrong without raising an error:
a missing value becoming zero, an old match being read as recent, a death
attributed to the wrong player, or a direction claimed from three matches.
"""

from __future__ import annotations

import copy
import unittest

from ai import profile_metrics as pm

ACCOUNT = "100000001"
OTHER = "200000002"

# Slugs taken verbatim from web/src/lib/hero-slugs.json, the same map the
# analysis worker uses to turn a hero id into a combat-log unit name.
HEROES = {
    "1": "antimage",
    "2": "axe",
    "3": "bane",
    "4": "bloodseeker",
    "5": "crystal_maiden",
    "6": "drow_ranger",
    "7": "earthshaker",
    "8": "juggernaut",
    "9": "mirana",
    "10": "morphling",
}

RADIANT_HEROES = (2, 1, 3, 4, 5)
DIRE_HEROES = (6, 7, 8, 9, 10)


def _player(account_id: str, hero_id: int, team: str = "radiant", **overrides) -> dict:
    player = {
        "account_id": account_id,
        "player_name": "Someone",
        "hero_id": hero_id,
        "team": team,
        "win": True,
        "kills": 6,
        "deaths": 4,
        "assists": 9,
        "last_hits": 180,
        "denies": 8,
        "networth": 15000,
        "gold": 16000,
        "xp": 19000,
        "hero_damage": 21000,
        "tower_damage": 1200,
        "stuns": 35.0,
        "obs_placed": 6,
        "sen_placed": 3,
        "towers_killed": 1,
        "roshans_killed": 0,
        "rune_pickups": 4,
        "creeps_stacked": 7,
        "kill_participation": 0.6,
        "teamfight_participation": 0.8,
        "role": "carry",
        "lane": "safelane",
        "role_confidence": 0.85,
    }
    player.update(overrides)
    return player


def _roster(hero_id: int = 2, account: str = ACCOUNT, **target_overrides) -> list[dict]:
    """Five radiant plus five dire, all on distinct heroes, target first."""
    radiant = [_player(account, hero_id, "radiant", **target_overrides)]
    radiant += [_player(f"radiant-{index}", hero, "radiant")
                for index, hero in enumerate(RADIANT_HEROES[1:], start=1)]
    dire = [_player(f"dire-{index}", hero, "dire", win=False)
            for index, hero in enumerate(DIRE_HEROES)]
    return radiant + dire


def _snapshots(minutes: int, value: int, *, metric: str = "lh", player_index: int = 0) -> list[dict]:
    """A per-player series with one reading per whole minute, as schema 8 emits."""
    return [
        {"time": minute * 60, "player_index": player_index, metric: value,
         "networth": value * 100, "xp": value * 50}
        for minute in range(minutes + 1)
    ]


def _death_events(target: str, counts: dict[int, int]) -> list[dict]:
    """hero_death events at the given minutes, using the match's own hero names."""
    return [
        {"type": "hero_death", "time": second, "target": target}
        for second, count in sorted(counts.items())
        for _ in range(count)
    ]


def _match(
    match_id: str = "1",
    start_time: int = 1000,
    *,
    duration: int | None = 1800,
    schema_version: int = pm.PLAYER_SNAPSHOT_SCHEMA,
    lobby_type: int | None = 1,
    players: list[dict] | None = None,
    snapshots: list[dict] | None = None,
    events: list[dict] | None = None,
    **overrides,
) -> dict:
    """A complete parsed object. Match fields here, player fields in `players`."""
    match = {
        "schema_version": schema_version,
        "match_id": match_id,
        "start_time": start_time,
        "duration": duration,
        "lobby_type": lobby_type,
        "radiant_win": True,
        "timeline": {"snapshots": [], "player_snapshots": snapshots or [], "events": events or []},
        "players": _roster() if players is None else players,
    }
    match.update(overrides)
    return match


def _match_metrics(**kwargs) -> dict:
    """Metrics for the fixture's target player in one call."""
    return pm.match_metrics(_match(**kwargs), ACCOUNT, HEROES)


class RecentMatchIdTests(unittest.TestCase):
    def test_orders_by_start_time_not_array_position(self):
        matches = {
            "matches": [
                {"match_id": "old", "start_time": 1000, "players": [{"account_id": ACCOUNT}]},
                {"match_id": "newest", "start_time": 3000, "players": [{"account_id": ACCOUNT}]},
                {"match_id": "middle", "start_time": 2000, "players": [{"account_id": ACCOUNT}]},
            ]
        }

        selected = pm.recent_match_ids(matches, ACCOUNT)

        self.assertEqual(selected["match_ids"], ["newest", "middle", "old"])
        self.assertFalse(selected["truncated"])

    def test_match_id_order_is_not_treated_as_chronological(self):
        # Ascending ids with descending times: trusting id order would invert this.
        matches = {"matches": [
            {"match_id": "111", "start_time": 2000, "players": [{"account_id": ACCOUNT}]},
            {"match_id": "222", "start_time": 1000, "players": [{"account_id": ACCOUNT}]},
        ]}

        self.assertEqual(pm.recent_match_ids(matches, ACCOUNT)["match_ids"], ["111", "222"])

    def test_limits_to_the_window_and_reports_truncation(self):
        matches = {"matches": [
            {"match_id": str(index), "start_time": index, "players": [{"account_id": ACCOUNT}]}
            for index in range(30)
        ]}

        selected = pm.recent_match_ids(matches, ACCOUNT)

        self.assertEqual(len(selected["match_ids"]), pm.WINDOW_MATCHES)
        self.assertEqual(selected["match_ids"][0], "29")
        self.assertEqual(selected["candidate_matches"], 30)
        self.assertTrue(selected["truncated"])

    def test_duplicate_match_ids_are_refused_not_double_counted(self):
        matches = {"matches": [
            {"match_id": "500", "start_time": 2000, "players": [{"account_id": ACCOUNT}]},
            {"match_id": "500", "start_time": 2000, "players": [{"account_id": ACCOUNT}]},
            {"match_id": "400", "start_time": 1000, "players": [{"account_id": ACCOUNT}]},
        ]}

        selected = pm.recent_match_ids(matches, ACCOUNT)

        self.assertEqual(selected["match_ids"], ["500", "400"])
        self.assertEqual(selected["excluded_duplicates"], 1)

    def test_missing_start_time_is_kept_but_sorted_as_oldest(self):
        matches = {"matches": [
            {"match_id": "no_time", "start_time": None, "players": [{"account_id": ACCOUNT}]},
            {"match_id": "dated", "start_time": 500, "players": [{"account_id": ACCOUNT}]},
        ]}

        selected = pm.recent_match_ids(matches, ACCOUNT)

        self.assertEqual(selected["match_ids"], ["dated", "no_time"])
        self.assertEqual(selected["missing_start_time"], 1)

    def test_other_players_matches_are_excluded(self):
        matches = {"matches": [
            {"match_id": "mine", "start_time": 200, "players": [{"account_id": ACCOUNT}]},
            {"match_id": "theirs", "start_time": 300, "players": [{"account_id": OTHER}]},
            {"match_id": "anonymous", "start_time": 400, "players": [{"account_id": None}]},
        ]}

        self.assertEqual(pm.recent_match_ids(matches, ACCOUNT)["match_ids"], ["mine"])

    def test_account_id_is_matched_as_text(self):
        # Identity is a string across every payload; a numeric index must not
        # silently fail to join.
        matches = {"matches": [{"match_id": "1", "start_time": 1, "players": [{"account_id": 100000001}]}]}

        self.assertEqual(pm.recent_match_ids(matches, ACCOUNT)["match_ids"], ["1"])

    def test_empty_and_malformed_index_is_survivable(self):
        for payload in ({}, {"matches": None}, {"matches": ["not a match"]}, None):
            with self.subTest(payload=payload):
                selected = pm.recent_match_ids(payload, ACCOUNT)
                self.assertEqual(selected["match_ids"], [])


class EligibilityTests(unittest.TestCase):
    def test_private_lobby_gate_fails_closed(self):
        for lobby_type in (None, 0, 2, 23, "1"):
            with self.subTest(lobby_type=lobby_type):
                self.assertFalse(pm.is_eligible(_match(lobby_type=lobby_type), ACCOUNT))

    def test_old_parser_schema_is_ineligible(self):
        self.assertFalse(pm.is_eligible(_match(schema_version=5), ACCOUNT))
        self.assertTrue(pm.is_eligible(_match(schema_version=6), ACCOUNT))

    def test_unreadable_schema_is_ineligible(self):
        for value in (None, "seven", {}, float("nan")):
            with self.subTest(value=value):
                self.assertFalse(pm.is_eligible(_match(schema_version=value), ACCOUNT))

    def test_absent_player_is_ineligible(self):
        self.assertFalse(pm.is_eligible(_match(), OTHER))

    def test_non_dict_and_missing_players_are_ineligible(self):
        self.assertFalse(pm.is_eligible(None, ACCOUNT))
        self.assertFalse(pm.is_eligible("json", ACCOUNT))
        self.assertFalse(pm.is_eligible(42, ACCOUNT))
        self.assertFalse(pm.is_eligible({"match_id": "1", "lobby_type": 1, "schema_version": 8}, ACCOUNT))

    def test_player_index_tracks_array_position(self):
        match = _match()

        self.assertEqual(pm.player_index_for(match, ACCOUNT), 0)
        self.assertEqual(pm.player_index_for(match, "dire-0"), 5)
        self.assertIsNone(pm.player_index_for(match, "absent"))

    def test_identity_never_falls_back_to_player_name(self):
        # Real replays contain players named "4" and ";". Two entries can share
        # a display name, so matching on it would merge different people.
        match = _match(players=[_player(ACCOUNT, 2, player_name="4"), _player(OTHER, 1, player_name="4")])

        self.assertEqual(pm.player_entry(match, OTHER)["account_id"], OTHER)
        self.assertIsNone(pm.player_entry(match, "4"))


class MatchMetricsTests(unittest.TestCase):
    def test_normalizes_by_match_duration(self):
        metrics = _match_metrics(duration=1800)

        self.assertEqual(metrics["gpm"], 533.33)  # 16000 gold / 30 minutes
        self.assertEqual(metrics["xpm"], 633.33)
        self.assertEqual(metrics["hero_damage_per_minute"], 700.0)
        self.assertEqual(metrics["duration_seconds"], 1800)

    def test_degenerate_duration_uses_the_aggregators_own_floor(self):
        # validate_match only requires duration to be numeric, so a zero-length
        # match can reach the aggregates. The aggregator floors the divisor at one
        # minute; matching it exactly keeps the profile from contradicting the
        # leaderboard published from the same match.
        for duration in (0, -60):
            with self.subTest(duration=duration):
                minutes = max(duration / 60.0, 1.0)
                expected = round(16000 / minutes, 2)

                self.assertEqual(_match_metrics(duration=duration)["gpm"], expected)
                self.assertEqual(_match_metrics(duration=duration)["xpm"], round(19000 / minutes, 2))

    def test_unreadable_duration_leaves_rates_unknown(self):
        self.assertIsNone(_match_metrics(duration=None)["gpm"])
        self.assertIsNone(_match_metrics(duration="later")["gpm"])

    def test_absent_field_is_none_not_zero(self):
        # Each source field maps to the metric key this module actually publishes,
        # so an absent value has to surface as unknown in its output name.
        published = {
            "last_hits": "last_hits",
            "denies": "denies",
            "gold": "gpm",
            "xp": "xpm",
            "hero_damage": "hero_damage_per_minute",
            "tower_damage": "tower_damage_per_minute",
            "stuns": "stuns_per_minute",
            "networth": "networth",
            "kill_participation": "kill_participation",
            "teamfight_participation": "teamfight_participation",
        }
        players = _roster()
        for source, key in published.items():
            players[0][source] = None

            metrics = pm.match_metrics(_match(players=players), ACCOUNT, HEROES)

            self.assertIsNone(metrics[key], f"{source} -> {key}")

    def test_ward_counts_missing_entirely_are_none_not_zero(self):
        players = _roster()
        players[0]["obs_placed"] = None
        players[0]["sen_placed"] = None

        metrics = pm.match_metrics(_match(players=players), ACCOUNT, HEROES)

        self.assertIsNone(metrics["vision_wards"])

    def test_partial_ward_counts_still_sum_the_known_half(self):
        players = _roster()
        players[0]["obs_placed"] = 4
        players[0]["sen_placed"] = None

        metrics = pm.match_metrics(_match(players=players), ACCOUNT, HEROES)

        self.assertEqual(metrics["vision_wards"], 4)

    def test_zero_death_policy_matches_the_aggregator(self):
        # The published KDA floors deaths at 1 rather than treating the match as
        # void, so the profile has to agree with the leaderboard exactly.
        metrics = _match_metrics(players=_roster(kills=9, deaths=0, assists=3))

        self.assertEqual(metrics["deaths"], 0)
        self.assertEqual(metrics["kda_ratio"], 12.0)

    def test_outcome_is_only_win_or_loss(self):
        self.assertEqual(_match_metrics(players=_roster(win=False))["outcome"], "loss")
        self.assertIsNone(_match_metrics(players=_roster(win=None))["outcome"])
        self.assertIsNone(_match_metrics(players=_roster(win=1))["outcome"])

    def test_schema_without_player_snapshots_yields_none_not_an_estimate(self):
        metrics = _match_metrics(schema_version=7, snapshots=_snapshots(10, 55))

        self.assertIsNone(metrics["last_hits_at_10m"])
        self.assertIsNone(metrics["networth_at_10m"])
        self.assertIsNone(metrics["xp_at_10m"])

    def test_reads_the_early_farm_mark_from_snapshots(self):
        metrics = _match_metrics(snapshots=_snapshots(20, 55))

        self.assertEqual(metrics["last_hits_at_10m"], 55)
        self.assertIsInstance(metrics["last_hits_at_10m"], int)

    def test_early_farm_uses_the_latest_value_at_or_before_the_mark(self):
        # No entry exactly at ten minutes: the 9-minute reading is the answer,
        # and the 11-minute reading must never be pulled backwards.
        metrics = _match_metrics(snapshots=[
            {"time": 540, "player_index": 0, "lh": 40, "networth": 4000, "xp": 3000},
            {"time": 660, "player_index": 0, "lh": 52, "networth": 5200, "xp": 4000},
        ])

        self.assertEqual(metrics["last_hits_at_10m"], 40)

    def test_early_farm_includes_a_reading_exactly_at_the_mark(self):
        metrics = _match_metrics(snapshots=[{"time": 600, "player_index": 0, "lh": 47}])

        self.assertEqual(metrics["last_hits_at_10m"], 47)

    def test_player_with_no_snapshots_gets_none_instead_of_a_teammate_value(self):
        metrics = _match_metrics(snapshots=_snapshots(10, 61, player_index=3))

        self.assertIsNone(metrics["last_hits_at_10m"])

    def test_snapshot_series_is_read_per_player_not_by_array_offset(self):
        # A teammate's larger farm must not leak across just because the
        # entries arrived in a different order or share the same minute.
        metrics = _match_metrics(snapshots=[
            {"time": 600, "player_index": 7, "lh": 99},
            {"time": 600, "player_index": 0, "lh": 31},
        ])

        self.assertEqual(metrics["last_hits_at_10m"], 31)

    def test_malformed_snapshot_entries_are_ignored(self):
        metrics = _match_metrics(snapshots=[
            "not an entry",
            {"time": None, "player_index": 0, "lh": 9},
            {"time": 600, "player_index": 0, "lh": "n/a"},
            {"time": 600, "player_index": 0, "lh": 28},
        ])

        self.assertEqual(metrics["last_hits_at_10m"], 28)


class DeathPhaseTests(unittest.TestCase):
    TARGET = "npc_dota_hero_axe"

    def _metrics(self, counts, *, extra=None, scoreboard=None, players=None, **kwargs):
        events = _death_events(self.TARGET, counts) + (extra or [])
        players = players or _roster(deaths=None if scoreboard is None else scoreboard)
        if scoreboard is None:
            players[0]["deaths"] = sum(counts.values())
        match = _match(players=players, events=events, **kwargs)
        return pm.match_metrics(match, ACCOUNT, HEROES)["deaths_by_phase"]

    def test_counts_deaths_per_phase(self):
        block = self._metrics({60: 2, 900: 3, 1800: 1})

        self.assertTrue(block["available"])
        self.assertEqual(block["total"], 6)
        self.assertEqual(block["phases"], {"early": 2, "mid": 3, "late": 1})

    def test_zero_death_match_is_reported_as_zero_not_missing(self):
        block = self._metrics({})

        self.assertTrue(block["available"])
        self.assertEqual(block["total"], 0)

    def test_duplicate_hero_suppresses_attribution(self):
        # Combat-log deaths name a hero, not a slot, so two players sharing this
        # hero makes the split genuinely unknowable.
        players = _roster()
        players[1]["hero_id"] = players[0]["hero_id"]

        block = self._metrics({60: 1, 900: 2}, players=players)

        self.assertFalse(block["available"])
        self.assertEqual(block["reason"], "duplicate_hero")

    def test_event_and_scoreboard_disagreement_suppresses_attribution(self):
        block = self._metrics({60: 1, 900: 2}, scoreboard=9)

        self.assertFalse(block["available"])
        self.assertEqual(block["reason"], "count_mismatch")
        self.assertEqual((block["events"], block["scoreboard"]), (3, 9))

    def test_other_heroes_deaths_do_not_disturb_this_players_count(self):
        block = self._metrics({60: 2}, extra=[
            {"type": "hero_death", "time": 120, "target": "npc_dota_hero_drow_ranger"},
            {"type": "building_destroyed", "time": 300, "target": "npc_dota_badguys_tower1_mid"},
        ])

        self.assertTrue(block["available"])
        self.assertEqual(block["total"], 2)

    def test_unplaceable_event_time_suppresses_attribution(self):
        block = self._metrics({60: 1, 900: 1}, extra=[
            {"type": "hero_death", "time": None, "target": self.TARGET}
        ])

        self.assertFalse(block["available"])
        self.assertEqual(block["reason"], "unplaced_events")

    def test_unknown_hero_id_suppresses_attribution(self):
        players = _roster()
        players[0]["hero_id"] = 9999

        block = self._metrics({60: 1}, players=players)

        self.assertFalse(block["available"])
        self.assertEqual(block["reason"], "unknown_hero")

    def test_missing_timeline_suppresses_attribution(self):
        players = _roster()
        players[0]["deaths"] = 0

        block = pm.match_metrics(_match(players=players, timeline=None), ACCOUNT, HEROES)["deaths_by_phase"]

        self.assertFalse(block["available"])
        self.assertEqual(block["reason"], "no_timeline")


class PhaseBoundaryTests(unittest.TestCase):
    def test_phase_of_covers_every_second_without_overlap(self):
        seen = {pm._phase_of(second) for second in range(0, 4000, 7)}

        self.assertEqual(seen, {"early", "mid", "late"})
        self.assertEqual(pm._phase_of(0), "early")
        self.assertEqual(pm._phase_of(600), "early")
        self.assertEqual(pm._phase_of(601), "mid")
        self.assertEqual(pm._phase_of(1501), "late")

    def test_negative_time_is_not_placed(self):
        self.assertIsNone(pm._phase_of(-1))


class AggregateWindowTests(unittest.TestCase):
    def test_means_ignore_missing_values_and_publish_their_own_sample(self):
        rows = [
            {"outcome": "win", "gpm": 500.0, "last_hits_at_10m": 40},
            {"outcome": "loss", "gpm": 700.0, "last_hits_at_10m": None},
            {"outcome": "win", "gpm": None, "last_hits_at_10m": 60},
        ]

        window = pm.aggregate_window(rows)

        self.assertEqual(window["metrics"]["gpm"], {"value": 600.0, "sample_size": 2})
        self.assertEqual(window["metrics"]["last_hits_at_10m"], {"value": 50.0, "sample_size": 2})

    def test_metric_with_no_sample_is_listed_unavailable_not_zero(self):
        window = pm.aggregate_window([{"outcome": "win", "gpm": 500.0}])

        self.assertNotIn("vision_wards", window["metrics"])
        self.assertIn("vision_wards", window["unavailable"])

    def test_win_rate_ignores_unknown_outcomes(self):
        window = pm.aggregate_window([
            {"outcome": "win"}, {"outcome": "loss"}, {"outcome": None}, {"outcome": "draw"},
        ])

        self.assertEqual(window["metrics"]["win_rate"], {"value": 50.0, "unit": "percent", "sample_size": 2})

    def test_empty_window_has_no_metrics(self):
        window = pm.aggregate_window([])

        self.assertEqual(window["matches_in_window"], 0)
        self.assertEqual(window["metrics"], {})
        self.assertFalse(window["deaths_by_phase"]["available"])

    def test_participations_are_published_as_percentages(self):
        window = pm.aggregate_window([{"kill_participation": 0.62}, {"teamfight_participation": 0.88}])

        self.assertEqual(window["metrics"]["kill_participation"]["value"], 62.0)
        self.assertEqual(window["metrics"]["kill_participation"]["unit"], "percent")
        self.assertEqual(window["metrics"]["teamfight_participation"]["value"], 88.0)

    def test_deaths_by_phase_sums_only_attributable_matches(self):
        rows = [
            {"deaths_by_phase": {"available": True, "total": 3, "phases": {"early": 1, "mid": 2, "late": 0}}},
            {"deaths_by_phase": {"available": True, "total": 2, "phases": {"early": 0, "mid": 1, "late": 1}}},
            {"deaths_by_phase": {"available": False, "reason": "duplicate_hero"}},
        ]

        block = pm.aggregate_window(rows)["deaths_by_phase"]

        self.assertTrue(block["available"])
        self.assertEqual((block["matches"], block["excluded"], block["total_deaths"]), (2, 1, 5))
        self.assertEqual(block["excluded_reasons"], {"duplicate_hero": 1})
        self.assertEqual(block["phases"]["early"], {"deaths": 1, "share": 20.0})

    def test_deaths_by_phase_reports_why_nothing_is_usable(self):
        rows = [{"deaths_by_phase": {"available": False, "reason": "count_mismatch"}} for _ in range(3)]

        block = pm.aggregate_window(rows)["deaths_by_phase"]

        self.assertFalse(block["available"])
        self.assertEqual(block["excluded_reasons"], {"count_mismatch": 3})


class TrendWindowTests(unittest.TestCase):
    @staticmethod
    def _rows(newest_first):
        return [{"outcome": "win", "gpm": value} for value in newest_first]

    def test_newest_half_is_the_head_of_a_newest_first_window(self):
        # Farm rising over real time. Rows arrive newest-first, so the newer half
        # is the first entries; reading the array the wrong way round would
        # report improvement as decline.
        rows = self._rows([900.0, 850.0, 800.0, 500.0, 450.0, 400.0])

        trends = pm.trend_window(rows)

        self.assertEqual(trends["changes"]["gpm"]["newer"], 850.0)
        self.assertEqual(trends["changes"]["gpm"]["older"], 450.0)
        self.assertGreater(trends["changes"]["gpm"]["change"], 0)

    def test_short_window_publishes_no_direction(self):
        trends = pm.trend_window(self._rows([500.0, 600.0, 700.0]))

        self.assertFalse(trends["available"])
        self.assertIn("needs_at_least", trends["reason"])

    def test_win_rate_trend_needs_more_matches_than_a_average_metric(self):
        # Three per side: enough for a farm average, nowhere near enough to call
        # a win-rate direction.
        rows = [{"outcome": "loss", "gpm": 400.0} for _ in range(3)] + [
            {"outcome": "win", "gpm": 900.0} for _ in range(3)
        ]

        trends = pm.trend_window(rows)

        self.assertNotIn("win_rate", trends["changes"])
        self.assertIn("gpm", trends["changes"])
        self.assertEqual(trends["suppressed"][0]["key"], "win_rate")

    def test_win_rate_trend_appears_once_both_sides_are_deep_enough(self):
        # Newest-first, so the five wins at the head are the recent form and the
        # five losses at the tail are the older form.
        rows = [{"outcome": "win", "gpm": 900.0} for _ in range(5)] + [
            {"outcome": "loss", "gpm": 400.0} for _ in range(5)
        ]

        trends = pm.trend_window(rows)

        self.assertEqual(trends["changes"]["win_rate"]["older"], 0.0)
        self.assertEqual(trends["changes"]["win_rate"]["newer"], 100.0)
        self.assertEqual(trends["changes"]["win_rate"]["change"], 100.0)
        self.assertEqual(trends["changes"]["win_rate"]["older_matches"], 5)
        self.assertIsNone(trends["suppressed"])

    def test_metric_missing_from_one_side_yields_no_trend_for_that_metric(self):
        rows = [{"outcome": "win", "gpm": 500.0} for _ in range(3)] + [
            {"outcome": "win", "gpm": None, "xpm": 700.0} for _ in range(3)
        ]

        trends = pm.trend_window(rows)

        self.assertNotIn("gpm", trends["changes"])

    def test_trend_change_is_the_same_sign_as_newer_minus_older(self):
        rows = self._rows([100.0, 100.0, 100.0, 300.0, 300.0, 300.0])

        change = pm.trend_window(rows)["changes"]["gpm"]

        self.assertEqual(change["change"], -200.0)

    def test_a_share_metric_uses_one_unit_in_the_window_and_in_the_trend(self):
        # The replay stores kill participation as a 0-1 share. Publishing the
        # window mean as a percent while leaving the trend as a share would put
        # 68.8 and 0.68 in the same payload for one player, and the analysis
        # would then contradict itself without either number being wrong.
        rows = [{"outcome": "win", "kill_participation": 0.8} for _ in range(3)] + [
            {"outcome": "win", "kill_participation": 0.4} for _ in range(3)
        ]

        window = pm.aggregate_window(rows)["metrics"]["kill_participation"]
        trend = pm.trend_window(rows)["changes"]["kill_participation"]

        self.assertEqual(window["unit"], "percent")
        self.assertEqual(window["value"], 60.0)
        self.assertEqual(trend["unit"], "percent")
        self.assertEqual(trend["older"], 40.0)
        self.assertEqual(trend["newer"], 80.0)
        self.assertEqual(trend["change"], 40.0)

    def test_a_count_metric_is_not_scaled_as_a_share(self):
        rows = [{"outcome": "win", "gpm": 400.0} for _ in range(3)] + [
            {"outcome": "win", "gpm": 600.0} for _ in range(3)
        ]

        trend = pm.trend_window(rows)["changes"]["gpm"]

        self.assertNotIn("unit", trend)
        self.assertEqual(trend["newer"], 400.0)
        self.assertEqual(trend["older"], 600.0)
        self.assertEqual(trend["change"], -200.0)


class RoleContextTests(unittest.TestCase):
    def test_dominant_role_needs_a_majority_of_the_window(self):
        role = pm.role_context([{"role": "carry", "role_confidence": 0.9}] * 3 + [{"role": "support", "role_confidence": 0.9}] * 3)

        self.assertEqual(role["confidence"], "low")
        self.assertEqual(role["dominant_share"], 50.0)

    def test_low_parser_confidence_downgrades_an_else_clear_role(self):
        role = pm.role_context([{"role": "support", "role_confidence": 0.5}] * 6)

        self.assertEqual(role["value"], "support")
        self.assertEqual(role["confidence"], "low")

    def test_confident_single_role_is_sufficient(self):
        role = pm.role_context([{"role": "offlane", "role_confidence": 0.85}] * 6)

        self.assertEqual(role["confidence"], "sufficient")
        self.assertEqual(role["mean_role_confidence"], 0.85)

    def test_unknown_roles_are_not_counted_as_a_role(self):
        role = pm.role_context([{"role": "unknown", "role_confidence": 0.2}] * 4)

        self.assertEqual(role["confidence"], "no_role_data")
        self.assertIsNone(role["value"])

    def test_no_rows_is_not_a_role(self):
        self.assertEqual(pm.role_context([])["confidence"], "no_role_data")

    def test_roles_seen_is_reported_for_transparency(self):
        role = pm.role_context([{"role": "mid", "role_confidence": 0.9}] * 2 + [{"role": "carry", "role_confidence": 0.9}])

        self.assertEqual(role["roles_seen"], {"carry": 1, "mid": 2})


class BenchmarkTests(unittest.TestCase):
    STATS = {
        "role_rankings": {"support": [
            {"id": "aaa", "score": 91.2, "score_breakdown": [
                {"key": "vision", "label": "Vision contribution", "value": 20.1, "normalized": 100.0,
                 "weight": 30.0, "unit": "wards per match", "contribution": 30.0}
            ]},
            {"id": ACCOUNT, "score": 85.4, "score_breakdown": []},
        ]},
        "role_scoring": {"support": {"method": "Lobby-relative weighted score", "minimum_matches": 5,
                                     "eligible_players": 10}},
    }

    def test_reports_the_position_within_the_role(self):
        benchmark = pm.benchmark_for(self.STATS, ACCOUNT, {"value": "support", "confidence": "sufficient"})

        self.assertTrue(benchmark["available"])
        self.assertEqual((benchmark["rank"], benchmark["ranked_players"]), (2, 2))
        self.assertEqual(benchmark["eligible_players"], 10)
        self.assertIn("private-lobby dataset only", benchmark["scope_note"])

    def test_role_that_is_never_ranked_is_named_as_unranked(self):
        # The aggregator only builds records for carry/offlane/support, so a mid
        # laner has no baseline to be ranked against at all.
        benchmark = pm.benchmark_for(self.STATS, ACCOUNT, {"value": "mid", "confidence": "sufficient"})

        self.assertFalse(benchmark["available"])
        self.assertEqual(benchmark["reason"], "role_not_ranked")
        self.assertEqual(benchmark["ranked_roles"], list(pm.RANKED_ROLES))

    def test_uncertain_role_suppresses_the_benchmark(self):
        benchmark = pm.benchmark_for(self.STATS, ACCOUNT, {"value": "support", "confidence": "low"})

        self.assertFalse(benchmark["available"])
        self.assertEqual(benchmark["reason"], "role_not_confident")

    def test_eligible_player_absent_from_the_ranking_is_reported_plainly(self):
        benchmark = pm.benchmark_for(self.STATS, "unranked-player", {"value": "support", "confidence": "sufficient"})

        self.assertFalse(benchmark["available"])
        self.assertEqual(benchmark["reason"], "player_not_in_role_rankings")
        self.assertEqual(benchmark["eligible_players"], 2)

    def test_empty_stats_does_not_raise(self):
        benchmark = pm.benchmark_for({}, ACCOUNT, {"value": "support", "confidence": "sufficient"})

        self.assertFalse(benchmark["available"])

    def test_score_breakdown_is_copied_not_reinvented(self):
        stats = copy.deepcopy(self.STATS)
        stats["role_rankings"]["support"] = [
            {"id": ACCOUNT, "score": 91.2, "score_breakdown": [
                {"key": "vision", "label": "Vision contribution", "value": 20.1, "normalized": 100.0,
                 "weight": 30.0, "unit": "wards per match"}
            ]}
        ]

        metrics = pm.benchmark_for(stats, ACCOUNT, {"value": "support", "confidence": "sufficient"})["metrics"]

        self.assertEqual(metrics[0]["value"], 20.1)
        self.assertNotIn("contribution", metrics[0])


class LifetimeAndHeroTests(unittest.TestCase):
    STATS = {
        "players": {ACCOUNT: {"matches": 41, "wins": 27, "losses": 14, "win_rate": 65.85,
                              "win_rate_confidence": 50.55, "kda": 3.78, "avg_kills": 4.17,
                              "avg_deaths": 5.9, "avg_assists": 18.12, "player_name": "Display Name"}},
        "heroes": {"2": {"hero_name": "Axe"}, "44": {"hero_name": "Phantom Assassin"}},
        "player_heroes": {
            ACCOUNT: {
                "2": {"matches": 12, "win_rate": 58.3, "kda": 3.1, "player_name": "Display Name"},
                "44": {"matches": 3, "win_rate": 33.3, "kda": 2.0, "player_name": "Display Name"},
            }
        },
    }

    def test_lifetime_win_rate_carries_its_lower_bound(self):
        lifetime = pm.lifetime_reference(self.STATS, ACCOUNT)

        self.assertEqual(lifetime["win_rate"], 65.85)
        self.assertEqual(lifetime["win_rate_lower_bound"], 50.55)

    def test_display_name_is_not_passed_on(self):
        self.assertNotIn("player_name", pm.lifetime_reference(self.STATS, ACCOUNT))
        self.assertTrue(all("player_name" not in row for row in pm.hero_reference(self.STATS, ACCOUNT)))

    def test_missing_player_record_is_reported_not_fabricated(self):
        self.assertEqual(pm.lifetime_reference(self.STATS, "nobody"), {"available": False,
                                                                      "reason": "no_lifetime_record"})

    def test_hero_pool_is_limited_to_the_most_played(self):
        heroes = pm.hero_reference(self.STATS, ACCOUNT, limit=1)

        self.assertEqual(len(heroes), 1)
        self.assertEqual(heroes[0]["hero_name"], "Axe")

    def test_hero_pool_ordering_is_deterministic_when_usage_ties(self):
        stats = copy.deepcopy(self.STATS)
        stats["player_heroes"][ACCOUNT] = {
            "44": {"matches": 5, "win_rate": 40.0, "kda": 2.0},
            "2": {"matches": 5, "win_rate": 60.0, "kda": 3.0},
        }

        self.assertEqual([row["hero_id"] for row in pm.hero_reference(stats, ACCOUNT)], ["2", "44"])

    def test_unknown_hero_stays_without_a_name(self):
        heroes = pm.hero_reference(self.STATS, ACCOUNT)

        self.assertTrue(all(row["hero_name"] is not None for row in heroes))
        self.assertEqual(
            pm.hero_reference({"player_heroes": {ACCOUNT: {"999": {"matches": 1}}}}, ACCOUNT)[0]["hero_name"], None
        )


class ProfilePayloadTests(unittest.TestCase):
    def _rows(self, count: int, account: str = ACCOUNT) -> list[dict]:
        """A newest-first window of real fixture matches, farm drifting upward."""
        rows = []
        for index in range(count):
            match = _match(
                str(1000 + index),
                2000 - index * 100,
                players=_roster(account=account, kills=5 + index, last_hits=100 + index * 5),
                snapshots=[{"time": 600, "player_index": 0, "lh": 20 + index}],
            )
            row = pm.match_metrics(match, account, HEROES)
            if row:
                rows.append(row)
        return rows

    def test_payload_structure_and_flags(self):
        payload = pm.build_profile_metrics(ACCOUNT, self._rows(6), {})

        self.assertEqual(payload["schema_version"], "1.0")
        self.assertEqual(payload["metrics_version"], pm.METRICS_VERSION)
        self.assertFalse(payload["insufficient"])
        self.assertEqual(payload["sample"]["tier"], "small")
        self.assertEqual(payload["window"], {"type": "recent_matches", "requested": 20, "eligible": 6})

    def test_below_the_gate_is_marked_insufficient(self):
        payload = pm.build_profile_metrics(ACCOUNT, self._rows(4), {})

        self.assertTrue(payload["insufficient"])
        self.assertEqual(payload["sample"]["tier"], "insufficient")

    def test_a_full_sample_window_is_tiered_adequate(self):
        payload = pm.build_profile_metrics(ACCOUNT, self._rows(pm.STRONG_SAMPLE_MATCHES), {})

        self.assertEqual(payload["sample"]["tier"], "adequate")
        self.assertIsNone(payload["sample"]["note"])

    def test_small_sample_note_limits_trend_claims_to_published_ones(self):
        payload = pm.build_profile_metrics(ACCOUNT, self._rows(5), {})

        self.assertIn("Only 5 eligible matches", payload["sample"]["note"])
        # A direction is allowed only where the trends block publishes one, so the
        # note must not forbid it outright: at 6 matches the trends block is real
        # and a blanket ban would contradict the data sitting beside it.
        self.assertIn("only where the trends block publishes one", payload["sample"]["note"])
        self.assertNotIn("do not claim a trend", payload["sample"]["note"])

    def test_small_sample_note_agrees_with_the_trend_gate(self):
        # The smallest window that publishes a trend is still a small sample, so
        # the two rules have to be readable together without contradicting.
        payload = pm.build_profile_metrics(ACCOUNT, self._rows(pm.MIN_TREND_MATCHES), {})

        self.assertTrue(payload["trends"]["available"])
        self.assertEqual(payload["sample"]["tier"], "small")
        self.assertLess(pm.MIN_TREND_MATCHES, pm.STRONG_SAMPLE_MATCHES)

    def test_match_ids_are_published_in_newest_first_order(self):
        payload = pm.build_profile_metrics(ACCOUNT, self._rows(3), {})

        self.assertEqual(payload["source"]["match_ids"], ["1000", "1001", "1002"])

    def test_hash_is_stable_across_key_order(self):
        rows_a = self._rows(5)
        rows_b = copy.deepcopy(rows_a)
        for row in rows_b:
            row.update(list(row.items())[::-1])

        first = pm.build_profile_metrics(ACCOUNT, rows_a, {})
        second = pm.build_profile_metrics(ACCOUNT, rows_b, {})

        self.assertEqual(first["source"]["source_hash"], second["source"]["source_hash"])

    def test_hash_is_stable_across_repeated_builds(self):
        rows = self._rows(8)
        stats = {"role_rankings": {}, "role_scoring": {}, "players": {}}

        hashes = {pm.build_profile_metrics(ACCOUNT, copy.deepcopy(rows), stats)["source"]["source_hash"]
                  for _ in range(3)}

        self.assertEqual(len(hashes), 1)

    def test_a_new_match_changes_the_hash(self):
        stats = {"role_rankings": {}, "role_scoring": {}, "players": {}}

        five = pm.build_profile_metrics(ACCOUNT, self._rows(5), stats)["source"]["source_hash"]
        six = pm.build_profile_metrics(ACCOUNT, self._rows(6), stats)["source"]["source_hash"]

        self.assertNotEqual(five, six)

    def test_a_changed_value_changes_the_hash(self):
        rows = self._rows(6)
        stats = {}
        before = pm.build_profile_metrics(ACCOUNT, copy.deepcopy(rows), stats)["source"]["source_hash"]

        rows[2]["gpm"] = (rows[2]["gpm"] or 0) + 1
        after = pm.build_profile_metrics(ACCOUNT, rows, stats)["source"]["source_hash"]

        self.assertNotEqual(before, after)

    def test_a_different_player_changes_the_hash(self):
        rows = self._rows(6, account="someone-else")

        self.assertNotEqual(
            pm.build_profile_metrics("someone-else", rows, {})["source"]["source_hash"],
            pm.build_profile_metrics(ACCOUNT, self._rows(6), {})["source"]["source_hash"],
        )

    def test_bumping_the_metrics_version_changes_the_hash(self):
        rows = self._rows(6)
        before = pm.build_profile_metrics(ACCOUNT, copy.deepcopy(rows), {})["source"]["source_hash"]

        original = pm.METRICS_VERSION
        pm.METRICS_VERSION = "2.0.0"
        try:
            after = pm.build_profile_metrics(ACCOUNT, copy.deepcopy(rows), {})["source"]["source_hash"]
        finally:
            pm.METRICS_VERSION = original

        self.assertNotEqual(before, after)

    def test_empty_rows_do_not_raise_or_invent_metrics(self):
        payload = pm.build_profile_metrics(ACCOUNT, [], {})

        self.assertTrue(payload["insufficient"])
        self.assertEqual(payload["metrics"], {})
        self.assertEqual(payload["source"]["match_ids"], [])
        self.assertEqual(payload["sample"]["tier"], "insufficient")
        self.assertEqual(payload["sample"]["matches"], 0)

    def test_falsy_rows_are_dropped_before_aggregation(self):
        payload = pm.build_profile_metrics(ACCOUNT, self._rows(3) + [None], {})

        self.assertEqual(payload["window"]["eligible"], 3)

    def test_unavailable_metrics_are_listed_for_the_prompt_to_respect(self):
        # Schema 8 replay without any snapshot rows: early farm was never
        # measured, so it has to appear as unavailable rather than as zero.
        rows = self._rows(3)
        for row in rows:
            row["last_hits_at_10m"] = None

        payload = pm.build_profile_metrics(ACCOUNT, rows, {})

        self.assertIn("last_hits_at_10m", payload["unavailable_metrics"])


class NumericGuardTests(unittest.TestCase):
    def test_none_text_and_bool_are_never_counts(self):
        for value in (None, "", "12", True, False, [], {}):
            with self.subTest(value=value):
                self.assertIsNone(pm._number(value))

    def test_real_numbers_pass(self):
        self.assertEqual(pm._number(3), 3.0)
        self.assertEqual(pm._number(2.5), 2.5)

    def test_ratio_guards_against_zero_and_missing_denominators(self):
        self.assertIsNone(pm._ratio(10, 0))
        self.assertIsNone(pm._ratio(10, None))
        self.assertIsNone(pm._ratio(None, 10))
        self.assertEqual(pm._ratio(10, 5), 2.0)

    def test_whole_returns_an_int_not_a_float_string(self):
        self.assertEqual(pm._whole(46.7), 47)
        self.assertIsInstance(pm._whole(46.7), int)
        self.assertIsNone(pm._whole(None))


if __name__ == "__main__":
    unittest.main()
