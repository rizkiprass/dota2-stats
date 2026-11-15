"""Tests for the on-demand AI player profile Lambda.

The routing tests concentrate on the two properties that make this feature safe
to run on a one-dollar-a-month provider budget: a request that cannot produce an
analysis must not reach the model, and a request whose evidence has not changed
must not reach it either. Everything else about the route is ordinary.

The grounding tests concentrate on the other failure mode, which is silent: an
answer that parses cleanly and reads well while resting on a number the data
never published, a metric the window could not produce, or a capability the
replay does not record. Those are checked per player, against that player's own
payload, because a figure that is grounded for one of them is invented for the
next.
"""

from __future__ import annotations

import io
import json
import os
import sys
import types
import unittest
import urllib.error
from unittest.mock import MagicMock, patch

from ai import profile_handler as ph
from ai import profile_metrics as pm
from ai.test_profile_metrics import ACCOUNT, HEROES, _death_events, _match, _player, _roster, _snapshots

UNKNOWN = "300000003"
DEATHS_PER_MATCH = {300: 1, 900: 2, 1700: 1}


class ClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


def _stats() -> dict:
    """stats.json reduced to the parts the profile analysis reads.

    The display name is deliberately present in every place the real file carries
    one, so the privacy test has something to catch.
    """
    return {
        "players": {
            ACCOUNT: {"name": "LeakMe", "matches": 12, "wins": 7, "losses": 5, "win_rate": 58.33,
                      "win_rate_confidence": 31.9, "kda": 3.4, "avg_kills": 6.0, "avg_deaths": 4.0,
                      "avg_assists": 9.0},
        },
        "role_rankings": {"carry": [
            {"id": ACCOUNT, "score": 71.5, "score_breakdown": [
                {"key": "farm", "label": "Farm", "value": 180.0, "normalized": 80.0,
                 "weight": 30.0, "unit": "per match"},
                {"key": "win_rate", "label": "Win rate", "value": 58.33, "normalized": 58.33,
                 "weight": 10.0, "unit": "%"},
            ]},
        ]},
        "role_scoring": {"carry": {"method": "Lobby-relative weighted score", "minimum_matches": 5,
                                   "eligible_players": 6}},
        "player_heroes": {ACCOUNT: {"2": {"matches": 8, "win_rate": 62.5, "kda": 3.2,
                                          "player_name": "LeakMe"}}},
        "heroes": {"2": {"hero_name": "Axe"}},
    }


def _index(count: int) -> dict:
    """matches.json: the published per-match index the window is selected from."""
    return {"matches": [
        {"match_id": str(number), "start_time": 1000 + number * 100, "duration": 1800, "radiant_win": True,
         "players": [{"account_id": ACCOUNT, "hero_id": 2, "hero_name": "Axe", "player_name": "LeakMe",
                      "team": "radiant", "win": True, "kills": 6, "deaths": 4, "assists": 9}]}
        for number in range(count)
    ]}


def _parsed(count: int, *, role_cycle: tuple[str, ...] | None = None,
            **match_kwargs) -> dict[str, dict]:
    """One parsed replay per match, with the fixture's own timeline by default.

    `match_kwargs` overrides the defaults rather than colliding with them, so a
    test can strip the death events or the snapshots without rebuilding the set.
    """
    payload = {}
    for number in range(count):
        kwargs: dict = {"snapshots": _snapshots(12, 20 + number),
                        "events": _death_events("npc_dota_hero_axe", DEATHS_PER_MATCH)}
        kwargs.update(match_kwargs)
        if role_cycle:
            # The target player's own role has to vary; the other nine slots are
            # never counted, so a mixed roster alone proves nothing.
            kwargs["players"] = _roster(account=ACCOUNT, role=role_cycle[number % len(role_cycle)])
        payload[str(number)] = _match(match_id=str(number), start_time=1000 + number * 100, **kwargs)
    return payload


class FakeS3:
    def __init__(self, stats=None, index=None, parsed=None):
        self.objects: dict[str, bytes] = {}
        if stats is not None:
            self.objects[ph.STATS_KEY] = json.dumps(stats).encode()
        if index is not None:
            self.objects[ph.MATCHES_KEY] = json.dumps(index).encode()
        for match_id, payload in (parsed or {}).items():
            self.objects[f"parsed/{match_id}.json"] = json.dumps(payload).encode()
        self.reads: list[str] = []
        self.puts: list[str] = []
        self.fail_writes = False

    def get_object(self, Bucket, Key):
        self.reads.append(Key)
        if Key not in self.objects:
            raise ClientError("NoSuchKey")
        return {"Body": io.BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, ContentType):
        if self.fail_writes:
            raise ClientError("AccessDenied")
        self.puts.append(Key)
        self.objects[Key] = Body

    def stored(self, key: str) -> dict:
        return json.loads(self.objects[key])


class FakeDynamo:
    def __init__(self):
        self.calls = 0

    def update_item(self, **kwargs):
        self.calls += 1
        if self.calls > 10:
            raise ClientError("ConditionalCheckFailedException")


def _rows(count: int, **match_kwargs) -> list[dict]:
    return [row for row in (pm.match_metrics(payload, ACCOUNT, HEROES)
                            for payload in _parsed(count, **match_kwargs).values()) if row]


def _metrics(count: int = 6, stats: dict | None = None, **match_kwargs) -> dict:
    return pm.build_profile_metrics(ACCOUNT, _rows(count, **match_kwargs),
                                    _stats() if stats is None else stats)


SPLIT_ROLES = ("carry", "support")


def _answer(context: dict, **overrides) -> str:
    """A valid answer whose every figure and citation comes from the payload.

    Built from the context rather than hardcoded so the grounding tests assert
    something about the checker instead of about one player's arithmetic.
    """
    metrics = context["metrics"]
    gpm, deaths = metrics["gpm"]["value"], metrics["deaths"]["value"]
    matches = context["window"]["eligible"]
    body = {
        "headline": f"A {gpm} GPM record across {matches} recent matches.",
        "strengths": [{"title": "Farm", "text": f"Averaged {gpm} gold per minute.", "metrics": ["gpm"]}],
        "focus_areas": [{"title": "Deaths", "text": f"Averaged {deaths} deaths per match.",
                         "metrics": ["deaths"]}],
        "role_read": {"text": "The inferred role is carry.", "metrics": ["role.confidence"]},
        "limitations": "Ward placement and map control are not recorded in this dataset.",
    }
    if context["trends"].get("available"):
        body["trend"] = {"direction": "stable", "text": "Little change between halves.",
                         "metrics": ["trends.gpm"]}
    body.update(overrides)
    return json.dumps(body)


def _flagged(context: dict, keys: list[str], text: str | None = None) -> str:
    """A structurally valid answer that cites evidence the payload does not hold."""
    answer = json.loads(_answer(context))
    answer["strengths"][0]["metrics"] = keys
    if text is not None:
        answer["strengths"][0]["text"] = text
    return json.dumps(answer)


class ProfileRouteTests(unittest.TestCase):
    MATCHES = 6

    def setUp(self):
        self.s3 = FakeS3(_stats(), _index(self.MATCHES), _parsed(self.MATCHES))
        self.dynamo = FakeDynamo()
        boto = types.ModuleType("boto3")
        boto.client = lambda service: {"s3": self.s3, "dynamodb": self.dynamo}[service]
        botocore = types.ModuleType("botocore")
        exceptions = types.ModuleType("botocore.exceptions")
        exceptions.ClientError = ClientError
        self.modules = patch.dict(sys.modules, {"boto3": boto, "botocore": botocore,
                                                "botocore.exceptions": exceptions})
        self.env = patch.dict(os.environ, {"REPLAY_BUCKET": "test", "OPENROUTER_API_KEY": "fake",
                                           "AI_RATE_TABLE": "test", "AI_PROFILE_ENABLED": "true",
                                           "ALLOWED_ORIGINS": "https://dls.rpras.my.id"}, clear=False)
        self.modules.start()
        self.env.start()
        self.addCleanup(self.modules.stop)
        self.addCleanup(self.env.stop)
        # One model call per generation, answering from the payload it was given.
        patcher = patch.object(ph, "generate", side_effect=lambda context, question, key, timeout=25:
                               _answer(context))
        self.generate = patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, method="POST", account=ACCOUNT, body=None, path=None):
        event = {"rawPath": path if path is not None else f"/players/{account}/profile",
                 "requestContext": {"http": {"method": method, "sourceIp": "127.0.0.1"}},
                 "headers": {}, "body": body if body is not None else ""}
        result = ph.lambda_handler(event, None)
        return result["statusCode"], json.loads(result["body"]), result["headers"]

    # ---- reads never reach the provider ----

    def test_get_without_a_stored_analysis_reports_not_generated(self):
        status, body, _ = self.call("GET")

        self.assertEqual(status, 404)
        self.assertEqual(body["status"], "not_generated")
        self.assertEqual(self.generate.call_count, 0)

    def test_get_reads_exactly_one_object_and_nothing_else(self):
        self.call("POST")
        self.s3.reads.clear()

        status, body, _ = self.call("GET")

        self.assertEqual(status, 200)
        self.assertTrue(body["cached"])
        # A page view must not recompute the window: that would re-read up to
        # twenty parsed replays on every visit for an answer that is already stored.
        self.assertEqual(self.s3.reads, [f"ai-cache/profile/{ACCOUNT}.json"])
        self.assertEqual(self.generate.call_count, 1)

    # ---- generation is paid for once per change of evidence ----

    def test_post_generates_and_stores_in_the_private_bucket(self):
        status, body, _ = self.call("POST")

        self.assertEqual(status, 200)
        self.assertFalse(body["cached"])
        self.assertFalse(body["regenerated"])
        self.assertTrue(body["stored"])
        self.assertEqual(self.s3.puts, [f"ai-cache/profile/{ACCOUNT}.json"])
        record = self.s3.stored(f"ai-cache/profile/{ACCOUNT}.json")
        self.assertEqual(record["profile"], body["profile"])
        self.assertEqual(record["metrics_version"], pm.METRICS_VERSION)
        self.assertEqual(record["prompt_version"], ph.PROMPT_VERSION)

    def test_unchanged_evidence_is_served_from_the_store(self):
        self.call("POST")
        self.generate.reset_mock()

        status, body, _ = self.call("POST")

        self.assertEqual(status, 200)
        self.assertTrue(body["cached"])
        self.assertFalse(body["regenerated"])
        self.assertEqual(self.generate.call_count, 0)
        self.assertEqual(self.dynamo.calls, 1)

    def test_a_new_match_invalidates_the_stored_analysis(self):
        self.call("POST")
        self.generate.reset_mock()
        extra = self.MATCHES
        self.s3.objects[ph.MATCHES_KEY] = json.dumps(_index(extra + 1)).encode()
        self.s3.objects[f"parsed/{extra}.json"] = json.dumps(
            _match(match_id=str(extra), start_time=1000 + extra * 100, snapshots=_snapshots(12, 26),
                   events=_death_events("npc_dota_hero_axe", DEATHS_PER_MATCH))).encode()

        status, body, _ = self.call("POST")

        self.assertEqual(status, 200)
        self.assertFalse(body["cached"])
        self.assertTrue(body["regenerated"])
        self.assertEqual(self.generate.call_count, 1)
        self.assertEqual(body["meta"]["matches_analyzed"], extra + 1)

    def test_force_regenerates_even_when_the_hash_matches(self):
        self.call("POST")
        self.generate.reset_mock()

        status, body, _ = self.call("POST", body=json.dumps({"force": True}))

        self.assertEqual(status, 200)
        self.assertFalse(body["cached"])
        self.assertTrue(body["regenerated"])
        self.assertEqual(self.generate.call_count, 1)

    def test_a_corrupt_stored_record_is_regenerated_not_returned(self):
        self.s3.objects[f"ai-cache/profile/{ACCOUNT}.json"] = b"{not json"

        status, body, _ = self.call("POST")

        self.assertEqual(status, 200)
        self.assertFalse(body["cached"])
        self.assertEqual(self.generate.call_count, 1)

    def test_a_stored_write_failure_still_returns_the_paid_for_answer(self):
        self.s3.fail_writes = True

        status, body, _ = self.call("POST")

        self.assertEqual(status, 200)
        self.assertFalse(body["stored"])
        self.assertIn("headline", body["profile"])

    # ---- a player who cannot be characterised costs nothing ----

    def test_a_short_window_is_answered_without_calling_the_model(self):
        short = 4
        self.s3 = FakeS3(_stats(), _index(short), _parsed(short))

        status, body, _ = self.call("POST")

        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "insufficient_data")
        self.assertEqual(body["matches_analyzed"], short)
        self.assertEqual(body["required_matches"], pm.MIN_ELIGIBLE_MATCHES)
        self.assertEqual(self.generate.call_count, 0)
        self.assertEqual(self.s3.puts, [])
        self.assertEqual(self.dynamo.calls, 0)

    def test_a_player_absent_from_the_aggregates_is_a_404(self):
        status, body, _ = self.call("POST", account=UNKNOWN)

        self.assertEqual(status, 404)
        self.assertEqual(body["status"], "unknown_player")
        self.assertEqual(self.generate.call_count, 0)

    def test_missing_aggregates_are_a_404_rather_than_a_crash(self):
        self.s3.objects.pop(ph.STATS_KEY)

        status, body, _ = self.call("POST")

        self.assertEqual(status, 404)
        self.assertEqual(body["status"], "unknown_player")

    def test_a_missing_parsed_replay_narrows_the_window_instead_of_failing(self):
        self.s3.objects.pop("parsed/5.json")

        status, body, _ = self.call("POST")

        self.assertEqual(status, 200)
        self.assertEqual(body["meta"]["matches_analyzed"], self.MATCHES - 1)

    # ---- route hygiene ----

    def test_the_kill_switch_disables_both_methods(self):
        os.environ["AI_PROFILE_ENABLED"] = "false"

        for method in ("GET", "POST"):
            status, body, _ = self.call(method)
            self.assertEqual(status, 503)
            self.assertIn("disabled", body["message"])
        self.assertEqual(self.generate.call_count, 0)

    def test_rate_limit_applies_to_generation_only(self):
        self.dynamo.calls = 10

        self.assertEqual(self.call("POST")[0], 429)
        self.assertEqual(self.generate.call_count, 0)
        # A stored answer costs nothing, so it is not rationed.
        self.s3.objects[f"ai-cache/profile/{ACCOUNT}.json"] = json.dumps(
            {"profile": {"headline": "stored"}, "meta": {"source_hash": "x"}}).encode()
        self.assertEqual(self.call("GET")[0], 200)

    def test_the_rate_limit_is_not_consulted_for_a_cache_hit(self):
        self.call("POST")
        self.dynamo.calls = 0

        self.call("POST")

        self.assertEqual(self.dynamo.calls, 0)

    def test_an_unroutable_request_is_rejected_before_any_work(self):
        self.assertEqual(self.call("POST", path="/players/abc/profile")[0], 404)
        self.assertEqual(self.call("POST", path="/players/1/analysis")[0], 404)
        self.assertEqual(self.call("DELETE")[0], 404)
        self.assertEqual(self.generate.call_count, 0)

    def test_preflight_is_answered_without_a_trace(self):
        event = {"rawPath": f"/players/{ACCOUNT}/profile", "headers": {"origin": "https://dls.rpras.my.id"},
                 "requestContext": {"http": {"method": "OPTIONS", "sourceIp": "127.0.0.1"}}, "body": ""}

        result = ph.lambda_handler(event, None)

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(result["headers"]["Access-Control-Allow-Methods"], "GET,POST,OPTIONS")
        self.assertEqual(self.generate.call_count, 0)
        self.assertEqual(self.s3.reads, [])

    def test_an_oversized_or_malformed_body_is_rejected(self):
        self.assertEqual(self.call("POST", body="x" * 4097)[0], 400)
        self.assertEqual(self.call("POST", body="{")[0], 400)
        self.assertEqual(self.call("POST", body="[1,2]")[0], 400)
        self.assertEqual(self.generate.call_count, 0)

    def test_a_provider_failure_is_reported_as_unavailable(self):
        self.generate.side_effect = urllib.error.HTTPError(
            "https://openrouter.ai", 402, "Payment Required", {}, io.BytesIO(b""))

        status, body, _ = self.call("POST")

        self.assertEqual(status, 503)
        self.assertIn("usage limit", body["message"])
        self.assertEqual(self.s3.puts, [])

    def test_an_unexpected_failure_does_not_leak_a_traceback(self):
        self.generate.side_effect = RuntimeError("boom")

        status, body, headers = self.call("POST")

        self.assertEqual(status, 503)
        self.assertNotIn("boom", body["message"])
        self.assertEqual(headers["Content-Type"], "application/json")

    def test_the_response_is_never_cached_by_a_proxy(self):
        _, _, headers = self.call("GET")

        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_the_generated_profile_is_not_exported_to_telemetry_by_default(self):
        client = MagicMock()
        with patch.object(ph, "langfuse_client", return_value=client):
            self.call("POST")

        payload = client.start_observation.return_value.update.call_args.kwargs
        self.assertNotIn("profile", payload["output"])
        self.assertNotIn("metrics_reference", payload["input"])
        self.assertTrue(payload["metadata"]["evaluation_target"])
        self.assertFalse(payload["metadata"]["cached"])

    def test_telemetry_capture_is_available_as_an_explicit_choice(self):
        os.environ["LANGFUSE_CAPTURE_PROFILE_OUTPUT"] = "true"
        client = MagicMock()
        with patch.object(ph, "langfuse_client", return_value=client):
            self.call("POST")

        payload = client.start_observation.return_value.update.call_args.kwargs
        self.assertIn("profile", payload["output"])
        self.assertIn("metrics_reference", payload["input"])
        # The exported evidence is the metrics payload, never a parsed replay.
        self.assertNotIn("player_snapshots", json.dumps(payload["input"]["metrics_reference"]))

    def test_a_cache_hit_is_not_marked_as_an_evaluation_target(self):
        self.call("POST")
        client = MagicMock()
        with patch.object(ph, "langfuse_client", return_value=client):
            self.call("POST")

        payload = client.start_observation.return_value.update.call_args.kwargs
        self.assertFalse(payload["metadata"]["evaluation_target"])
        self.assertTrue(payload["metadata"]["cached"])

    def test_a_stored_read_is_answered_without_a_trace(self):
        self.call("POST")
        client = MagicMock()
        with patch.object(ph, "langfuse_client", return_value=client):
            self.assertEqual(self.call("GET")[0], 200)

        client.start_observation.assert_not_called()

    def test_an_allowed_origin_is_echoed_and_any_other_is_not(self):
        for origin, expected in (("https://dls.rpras.my.id", "https://dls.rpras.my.id"),
                                 ("https://evil.example", None)):
            event = {"rawPath": f"/players/{ACCOUNT}/profile", "headers": {"origin": origin},
                     "requestContext": {"http": {"method": "GET", "sourceIp": "127.0.0.1"}}, "body": ""}
            headers = ph.lambda_handler(event, None)["headers"]
            self.assertEqual(headers.get("Access-Control-Allow-Origin"), expected)


class GroundingTests(unittest.TestCase):
    def setUp(self):
        self.metrics = _metrics()
        self.context = ph.profile_context(self.metrics)

    def check(self, answer: str, metrics: dict | None = None) -> list[str]:
        metrics = self.metrics if metrics is None else metrics
        return ph.unsupported_claims(ph.parse_profile(answer, metrics), metrics)

    def test_a_grounded_answer_scores_no_flags(self):
        self.assertEqual(self.check(_answer(self.context)), [])

    def test_an_unpublished_figure_is_flagged(self):
        answer = json.loads(_answer(self.context))
        answer["strengths"][0]["text"] = "Averaged 4242 gold per minute."

        self.assertIn("invented_figure", self.check(json.dumps(answer)))

    def test_a_published_ratio_may_be_quoted_as_a_percent(self):
        # The payload publishes kill participation as a percent, and the
        # benchmark publishes the same signal as a share; both readings have to
        # be accepted or a correct sentence is retried for nothing.
        self.assertIn("kill_participation", self.metrics["metrics"])
        answer = json.loads(_answer(self.context))
        answer["strengths"][0]["text"] = (
            f"Kill participation averaged {self.metrics['metrics']['kill_participation']['value']}%.")
        answer["strengths"][0]["metrics"] = ["kill_participation"]

        self.assertEqual(self.check(json.dumps(answer)), [])

    def test_figure_readings_accept_both_comma_conventions(self):
        self.assertIn(14206.0, ph.figure_readings("14,206"))
        self.assertIn(1.234, ph.figure_readings("1,234"))
        self.assertIn(1234.0, ph.figure_readings("1,234"))
        self.assertEqual(ph.figure_readings("57.1"), [57.1])

    def test_rounding_a_published_value_is_accepted(self):
        value = self.metrics["metrics"]["gpm"]["value"]
        self.assertFalse(ph.unsupported_figures(f"Averaged {round(value)} gold per minute.", self.metrics))
        self.assertTrue(ph.unsupported_figures(f"Averaged {round(value) + 900} gold per minute.", self.metrics))

    def test_percent_scaling_does_not_licence_a_hundredfold_invention(self):
        # A share of 0.72 is legitimately quoted as 72%. Scaling every published
        # figure in both directions would also licence 4242 wherever the payload
        # happens to carry 42.42, which is the invented score this exists to
        # catch, so the conversion is one-directional and bounded.
        metrics = {"metrics": {"gpm": {"value": 42.42, "sample_size": 6}}}

        self.assertFalse(ph.unsupported_figures("Averaged 42.42 gold per minute.", metrics))
        self.assertTrue(ph.unsupported_figures("Scored 4242 in the lobby rating.", metrics))

        share = {"metrics": {"kill_participation": {"value": 0.72, "unit": "share", "sample_size": 6}}}
        self.assertFalse(ph.unsupported_figures("Kill participation of 72%.", share))
        self.assertTrue(ph.unsupported_figures("Kill participation of 73%.", share))

    def test_a_thousands_grouped_figure_is_checked_at_full_magnitude(self):
        metrics = {"metrics": {"networth": {"value": 23419.2, "sample_size": 6}}}

        self.assertFalse(ph.unsupported_figures("Averaged 23,419 net worth.", metrics))
        self.assertFalse(ph.unsupported_figures("Averaged 23419 net worth.", metrics))
        self.assertTrue(ph.unsupported_figures("Averaged 23,419,000 net worth.", metrics))

    def test_structural_numbers_are_not_treated_as_inventions(self):
        # The phase boundaries are given to the model in seconds while a reader
        # says "ten minutes"; quoting them is not an invented figure.
        self.assertFalse(ph.unsupported_figures("Most deaths fell in the first 10 minutes and after 25.",
                                                self.metrics))

    def test_a_citation_the_payload_cannot_support_is_flagged(self):
        self.assertIn("unknown_metric_key", self.check(_flagged(self.context, ["mmr_estimate"])))

    def test_a_correct_citation_is_accepted(self):
        self.assertEqual(self.check(_flagged(self.context, ["gpm", "xpm"])), [])

    def test_an_empty_citation_is_rejected_structurally(self):
        with self.assertRaises(ValueError):
            ph.parse_profile(_flagged(self.context, []), self.metrics)

    def test_a_missing_block_is_rejected(self):
        for absent in ("headline", "limitations", "strengths", "focus_areas", "role_read"):
            answer = json.loads(_answer(self.context))
            answer.pop(absent)
            with self.assertRaises(ValueError, msg=absent):
                ph.parse_profile(json.dumps(answer), self.metrics)

    def test_an_empty_list_of_findings_is_rejected(self):
        answer = json.loads(_answer(self.context))
        answer["strengths"] = []

        with self.assertRaises(ValueError):
            ph.parse_profile(json.dumps(answer), self.metrics)

    def test_overlong_fields_are_truncated_rather_than_rejected(self):
        answer = json.loads(_answer(self.context))
        answer["headline"] = "h" * 400
        answer["strengths"][0]["title"] = "t" * 200
        answer["strengths"][0]["metrics"] = ["gpm"] * 40

        profile = ph.parse_profile(json.dumps(answer), self.metrics)

        self.assertEqual(len(profile["headline"]), 180)
        self.assertEqual(len(profile["strengths"][0]["title"]), 60)
        self.assertEqual(len(profile["strengths"][0]["metrics"]), 8)

    def test_more_than_three_findings_are_trimmed(self):
        answer = json.loads(_answer(self.context))
        answer["focus_areas"] = [dict(answer["focus_areas"][0]) for _ in range(6)]

        self.assertEqual(len(ph.parse_profile(json.dumps(answer), self.metrics)["focus_areas"]), 3)

    def test_a_code_fence_is_stripped(self):
        fenced = "```json\n" + _answer(self.context) + "\n```"

        self.assertIn("headline", ph.parse_profile(fenced, self.metrics))

    def test_a_non_object_answer_is_rejected(self):
        for text in ("[]", '"text"', "not json"):
            with self.assertRaises(Exception, msg=text):
                ph.parse_profile(text, self.metrics)

    # ---- a direction only exists where the window can carry one ----

    def test_a_trend_is_written_server_side_when_the_window_is_too_short(self):
        metrics = _metrics(pm.MIN_TREND_MATCHES - 1)
        context = ph.profile_context(metrics)
        self.assertFalse(metrics["trends"]["available"])
        self.assertNotIn('"trend"', ph.profile_question(metrics))

        answer = json.loads(_answer(context))
        answer.pop("trend", None)
        profile = ph.parse_profile(json.dumps(answer), metrics)

        self.assertEqual(profile["trend"]["direction"], "unknown")
        self.assertEqual(profile["trend"]["text"], ph.NO_TREND_TEXT)

    def test_a_model_trend_is_discarded_when_the_window_is_too_short(self):
        # The field is not requested, so a model that volunteers one anyway must
        # not have its wording published: that is the invention this prevents.
        metrics = _metrics(pm.MIN_TREND_MATCHES - 1)
        answer = json.loads(_answer(ph.profile_context(metrics)))
        answer["trend"] = {"direction": "improving", "text": "Farm is clearly rising.", "metrics": ["gpm"]}

        profile = ph.parse_profile(json.dumps(answer), metrics)

        self.assertEqual(profile["trend"]["direction"], "unknown")
        self.assertEqual(profile["trend"]["text"], ph.NO_TREND_TEXT)

    def test_an_invalid_trend_direction_is_rejected(self):
        answer = json.loads(_answer(self.context))
        answer["trend"]["direction"] = "up"

        with self.assertRaises(ValueError):
            ph.parse_profile(json.dumps(answer), self.metrics)

    def test_trend_wording_without_trend_data_is_flagged(self):
        metrics = _metrics(pm.MIN_TREND_MATCHES - 1)
        answer = json.loads(_answer(ph.profile_context(metrics)))
        answer.pop("trend", None)
        answer["strengths"][0]["text"] = "Farm is steadily improving across the window."

        self.assertIn("trend_without_data", self.check(json.dumps(answer), metrics))

    # ---- claims the replay cannot support ----

    def test_a_population_claim_is_flagged_but_a_lobby_rank_is_not(self):
        self.assertTrue(self.metrics["benchmark"]["available"])
        rank, field = self.metrics["benchmark"]["rank"], self.metrics["benchmark"]["ranked_players"]

        grounded = json.loads(_answer(self.context))
        grounded["strengths"][0]["text"] = f"Ranked {rank} of {field} carries in this lobby dataset."
        grounded["strengths"][0]["metrics"] = ["benchmark.rank"]
        self.assertEqual(self.check(json.dumps(grounded)), [])

        for claim in ("top 5% of all players", "a 90th percentile carry", "an Immortal-level record",
                      "MMR around 5000", "ranked in the Divine bracket"):
            inflated = json.loads(_answer(self.context))
            inflated["strengths"][0]["text"] = claim + "."
            self.assertIn("population", self.check(json.dumps(inflated)), claim)

    def test_vision_capability_wording_is_flagged_but_a_ward_count_is_not(self):
        count = self.metrics["metrics"]["vision_wards"]["value"]
        grounded = json.loads(_answer(self.context))
        grounded["strengths"][0]["text"] = f"Placed {count} wards per match on average."
        grounded["strengths"][0]["metrics"] = ["vision_wards"]
        self.assertEqual(self.check(json.dumps(grounded)), [])

        for claim in ("excellent ward placement", "strong map awareness", "good vision control",
                      "rotates well", "positions badly"):
            inflated = json.loads(_answer(self.context))
            inflated["strengths"][0]["text"] = claim + "."
            self.assertIn("vision_claim", self.check(json.dumps(inflated)), claim)

    def test_behaviour_and_motive_wording_is_flagged(self):
        for claim in ("toxic in chat after losses", "clearly tilted", "feeds intentionally",
                     "a lazy effort", "blames teammates"):
            answer = json.loads(_answer(self.context))
            answer["focus_areas"][0]["text"] = claim + "."
            self.assertIn("behaviour", self.check(json.dumps(answer)), claim)

    def test_causal_wording_is_flagged(self):
        for claim in ("wards allowed the team to take fights", "low farm led to the losses",
                      "thanks to strong stuns", "because of poor vision"):
            answer = json.loads(_answer(self.context))
            answer["strengths"][0]["text"] = claim + "."
            self.assertIn("causal", self.check(json.dumps(answer)), claim)

    def test_objective_specificity_is_flagged_but_a_published_count_is_not(self):
        # towers_killed is a real per-player scoreboard counter, so the count is
        # quotable; which structure fell and when is not in the replay at all.
        grounded = json.loads(_answer(self.context))
        grounded["strengths"][0]["text"] = f"Averaged {self.metrics['metrics']['towers_killed']['value']} towers."
        grounded["strengths"][0]["metrics"] = ["towers_killed"]
        self.assertEqual(self.check(json.dumps(grounded)), [])

        for claim in ("took the mid tower around 20 minutes", "pushed the safe lane",
                      "secured Roshan at 25 minutes", "destroyed the T3 first"):
            inflated = json.loads(_answer(self.context))
            inflated["strengths"][0]["text"] = claim + "."
            self.assertIn("objective_attribution", self.check(json.dumps(inflated)), claim)

    def test_persistence_wording_is_flagged(self):
        for claim in ("consistently out-farms the lobby", "always dies early", "dies in every match"):
            answer = json.loads(_answer(self.context))
            answer["strengths"][0]["text"] = claim + "."
            self.assertIn("persistence", self.check(json.dumps(answer)), claim)

    def test_phase_wording_is_flagged_only_when_death_timing_is_unattributable(self):
        answer = json.loads(_answer(self.context))
        answer["focus_areas"][0]["text"] = "Most deaths fell in the mid-game phase."
        answer["focus_areas"][0]["metrics"] = ["deaths_by_phase.mid"]
        self.assertEqual(self.check(json.dumps(answer)), [])

        unattributable = _metrics(6, events=[])
        self.assertFalse(unattributable["deaths_by_phase"]["available"])
        other = json.loads(_answer(ph.profile_context(unattributable)))
        other["focus_areas"][0]["text"] = "Most deaths fell in the mid-game phase."
        other["focus_areas"][0]["metrics"] = ["deaths"]

        self.assertIn("phase_without_data", self.check(json.dumps(other), unattributable))

    def test_role_certainty_is_flagged_and_sharpened_when_the_label_is_uncertain(self):
        # The role is a heuristic even when the window supports one, so the
        # certainty rule always fires; an uncertain label adds the sharper name so
        # the trace can tell the two cases apart.
        self.assertEqual(self.metrics["role"]["confidence"], "sufficient")
        confident = json.loads(_answer(self.context))
        confident["role_read"]["text"] = "This is a dedicated carry."
        flags = self.check(json.dumps(confident))
        self.assertIn("role_certainty", flags)
        self.assertNotIn("role_without_confidence", flags)

        split = _metrics(6, role_cycle=SPLIT_ROLES)
        self.assertEqual(split["role"]["confidence"], "low")
        self.assertEqual(split["role"]["dominant_share"], 50.0)
        uncertain = json.loads(_answer(ph.profile_context(split)))
        uncertain["role_read"]["text"] = "This is a dedicated carry."
        flags = self.check(json.dumps(uncertain), split)
        self.assertIn("role_certainty", flags)
        self.assertIn("role_without_confidence", flags)

    def test_the_limitations_note_may_name_the_evidence_that_is_missing(self):
        # Naming ward placement, chat and laning as unrecorded is the purpose of
        # that field; holding it to the capability rules would force vaguer prose.
        answer = json.loads(_answer(self.context))
        answer["limitations"] = ("Ward placement, chat and ping behaviour, and laning position are never "
                                 "recorded here, and no MMR or percentile comparison is possible.")

        self.assertEqual(self.check(json.dumps(answer)), [])

    def test_the_headline_is_held_to_every_rule(self):
        answer = json.loads(_answer(self.context))
        answer["headline"] = "A top 5% carry with excellent map awareness."

        flags = self.check(json.dumps(answer))
        self.assertIn("population", flags)
        self.assertIn("vision_claim", flags)

    def test_a_flag_is_reported_once_however_often_it_recurs(self):
        answer = json.loads(_answer(self.context))
        answer["strengths"][0]["text"] = "Strong ward placement and map awareness."
        answer["focus_areas"][0]["text"] = "Weak ward placement."

        self.assertEqual(self.check(json.dumps(answer)).count("vision_claim"), 1)

    def test_logs_carry_rule_and_key_names_but_never_the_prose(self):
        answer = json.loads(_answer(self.context))
        answer["strengths"][0]["text"] = "Zaphod Beeblebrox out-farms the lobby."
        answer["strengths"][0]["metrics"] = ["mmr_estimate"]

        with self.assertLogs(level="WARNING") as logs:
            self.check(json.dumps(answer))

        recorded = "".join(logs.output)
        self.assertNotIn("Zaphod", recorded)
        # A cited key name is vocabulary, not content, and is what makes a
        # grounding failure diagnosable from the trace alone.
        self.assertIn("mmr_estimate", recorded)


class EvidenceKeyTests(unittest.TestCase):
    def test_keys_track_what_the_window_could_produce(self):
        keys = ph.allowed_evidence_keys(_metrics())

        for expected in ("gpm", "deaths", "win_rate", "trends.gpm", "deaths_by_phase.mid",
                         "benchmark.rank", "benchmark.farm", "lifetime.win_rate", "hero_pool",
                         "role.confidence", "sample.matches"):
            self.assertIn(expected, keys, expected)

    def test_an_unavailable_block_contributes_no_citable_key(self):
        short = _metrics(pm.MIN_TREND_MATCHES - 1)
        keys = ph.allowed_evidence_keys(short)
        self.assertFalse(short["trends"]["available"])
        self.assertNotIn("trends.gpm", keys)

        unattributable = _metrics(6, events=[])
        keys = ph.allowed_evidence_keys(unattributable)
        self.assertFalse(unattributable["deaths_by_phase"]["available"])
        self.assertNotIn("deaths_by_phase", keys)
        self.assertNotIn("deaths_by_phase.mid", keys)

    def test_an_unranked_role_contributes_no_benchmark_key(self):
        unranked = _metrics(6, stats={**_stats(), "role_rankings": {}})
        keys = ph.allowed_evidence_keys(unranked)

        self.assertFalse(unranked["benchmark"]["available"])
        self.assertEqual(unranked["benchmark"]["reason"], "player_not_in_role_rankings")
        self.assertNotIn("benchmark.rank", keys)

    def test_a_player_without_a_lifetime_record_contributes_no_lifetime_key(self):
        orphan = _metrics(6, stats={**_stats(), "players": {}})

        self.assertFalse(orphan["lifetime"]["available"])
        self.assertNotIn("lifetime.win_rate", ph.allowed_evidence_keys(orphan))

    def test_an_unlabelled_role_contributes_no_role_key(self):
        blank = _metrics(6, players=[_player(ACCOUNT, 2, role=None) for _ in range(10)])

        self.assertIsNone(blank["role"]["value"])
        self.assertNotIn("role.confidence", ph.allowed_evidence_keys(blank))


class PromptTests(unittest.TestCase):
    def test_no_display_name_or_behaviour_data_reaches_the_provider(self):
        context = json.dumps(ph.profile_context(_metrics()))

        self.assertNotIn("LeakMe", context)
        for absent in ("chat_messages", "pings", "disconnects", "disruptive_score", "steam_id",
                       "player_name", "account_id"):
            self.assertNotIn(absent, context, absent)

    def test_raw_snapshot_series_never_reach_the_provider(self):
        # Per-player minute telemetry is an input to the metrics, not evidence for
        # the model: shipping it would put the payload far past the size the
        # existing match-analysis function already strains against.
        context = json.dumps(ph.profile_context(_metrics()))

        self.assertNotIn("player_snapshots", context)
        self.assertNotIn('"events"', context)
        self.assertLess(len(context) // 4, 3500)

    def test_the_cited_keys_are_handed_to_the_model(self):
        context = ph.profile_context(_metrics())

        self.assertEqual(sorted(context["evidence_keys"]), sorted(ph.allowed_evidence_keys(_metrics())))

    def test_the_question_asks_for_a_trend_only_when_one_exists(self):
        self.assertIn('"trend"', ph.profile_question(_metrics()))
        self.assertNotIn('"trend"', ph.profile_question(_metrics(pm.MIN_TREND_MATCHES - 1)))
        self.assertIn("evidence_keys", ph.profile_question(_metrics()))

    def test_the_feedback_names_the_violated_rules_only(self):
        feedback = ph.claim_feedback(["population", "causal"])

        self.assertIn("causal", feedback)
        self.assertIn("population", feedback)
        self.assertEqual(ph.claim_feedback([]), "")


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.metrics = _metrics()
        self.context = ph.profile_context(self.metrics)

    def test_an_invalid_answer_is_retried_once(self):
        answers = iter(["not json at all", _answer(self.context)])
        with patch.object(ph, "generate", side_effect=lambda *a, **k: next(answers)) as generate:
            profile = ph.generate_profile(self.metrics, "key")

        self.assertEqual(generate.call_count, 2)
        self.assertIn("headline", profile)

    def test_two_invalid_answers_raise(self):
        with patch.object(ph, "generate", return_value="not json") as generate:
            with self.assertRaises(ValueError):
                ph.generate_profile(self.metrics, "key")

        self.assertEqual(generate.call_count, 2)

    def test_the_retry_names_the_rules_that_were_violated(self):
        answers = iter([_flagged(self.context, ["mmr_estimate"]), _answer(self.context)])
        with patch.object(ph, "generate", side_effect=lambda *a, **k: next(answers)) as generate:
            ph.generate_profile(self.metrics, "key")

        self.assertIn("unknown_metric_key", generate.call_args[0][1])

    def test_the_least_flagged_valid_answer_wins(self):
        # A flag is one rule name however often it recurs, so the two answers have
        # to differ in kind: the first breaks two rules, the second only one.
        worse = _flagged(self.context, ["mmr_estimate"], "Toxic tilt cost these matches.")
        better = _flagged(self.context, ["mmr_estimate"])
        with patch.object(ph, "generate", side_effect=[worse, better]):
            profile = ph.generate_profile(self.metrics, "key")

        self.assertNotIn("Toxic", profile["strengths"][0]["text"])
        self.assertEqual(profile["strengths"][0]["metrics"], ["mmr_estimate"])

    def test_a_worse_second_answer_does_not_replace_a_better_first_one(self):
        better = _flagged(self.context, ["mmr_estimate"])
        worse = _flagged(self.context, ["mmr_estimate"], "Toxic tilt cost these matches.")
        with patch.object(ph, "generate", side_effect=[better, worse]):
            profile = ph.generate_profile(self.metrics, "key")

        self.assertNotIn("Toxic", profile["strengths"][0]["text"])
        self.assertEqual(profile["strengths"][0]["metrics"], ["mmr_estimate"])

    def test_a_clean_first_answer_is_not_retried(self):
        with patch.object(ph, "generate", return_value=_answer(self.context)) as generate:
            ph.generate_profile(self.metrics, "key")

        self.assertEqual(generate.call_count, 1)

    def test_the_retry_is_skipped_when_the_gateway_budget_is_gone(self):
        clock = [0.0]

        def fake_clock():
            clock[0] += ph.PROFILE_BUDGET_SECONDS
            return clock[0]

        with patch.object(ph, "_clock", fake_clock), \
                patch.object(ph, "generate", return_value=_flagged(self.context, ["mmr_estimate"])) as generate:
            profile = ph.generate_profile(self.metrics, "key")

        self.assertEqual(generate.call_count, 1)
        self.assertIn("headline", profile)

    def test_the_call_timeout_never_exceeds_the_remaining_budget(self):
        with patch.object(ph, "generate", return_value=_answer(self.context)) as generate:
            ph.generate_profile(self.metrics, "key")

        self.assertLessEqual(generate.call_args.kwargs["timeout"], ph.PROFILE_BUDGET_SECONDS)


class StoredMetaTests(unittest.TestCase):
    def test_confidence_is_derived_from_the_sample_not_from_the_model(self):
        self.assertEqual(ph.stored_analysis(_metrics(6))["sample_tier"], "small")
        self.assertEqual(ph.stored_analysis(_metrics(6))["confidence"], "low")
        self.assertEqual(ph.stored_analysis(_metrics(pm.STRONG_SAMPLE_MATCHES))["sample_tier"], "adequate")
        self.assertEqual(ph.stored_analysis(_metrics(pm.STRONG_SAMPLE_MATCHES))["confidence"], "medium")

    def test_an_insufficient_sample_is_never_labelled_confident(self):
        meta = ph.stored_analysis(_metrics(pm.MIN_ELIGIBLE_MATCHES - 1))

        self.assertEqual(meta["sample_tier"], "insufficient")
        self.assertEqual(meta["confidence"], "low")

    def test_the_source_hash_and_versions_travel_with_the_answer(self):
        metrics = _metrics()
        meta = ph.stored_analysis(metrics)

        self.assertEqual(meta["source_hash"], metrics["source"]["source_hash"])
        self.assertEqual(meta["metrics_version"], pm.METRICS_VERSION)
        self.assertEqual(meta["prompt_version"], ph.PROMPT_VERSION)
        self.assertEqual(meta["matches_analyzed"], len(metrics["source"]["match_ids"]))


class SafeJsonKeyTests(unittest.TestCase):
    def test_only_top_level_key_names_are_reported(self):
        self.assertEqual(ph.safe_json_keys('{"headline":"secret","trend":{}}'), "headline,trend")
        self.assertEqual(ph.safe_json_keys("[]"), "list")
        self.assertEqual(ph.safe_json_keys("```json\n{\"a\":1}\n```"), "a")
        self.assertEqual(ph.safe_json_keys("not json"), "unparseable")
        self.assertNotIn("secret", ph.safe_json_keys('{"headline":"secret"}'))


if __name__ == "__main__":
    unittest.main()
