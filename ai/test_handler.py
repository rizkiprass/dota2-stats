import io
import json
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

from ai import handler


class ClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


class FakeS3:
    def __init__(self, match):
        self.objects = {"parsed/123.json": json.dumps(match).encode()}

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError("NoSuchKey")
        return {"Body": io.BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[Key] = Body


class FakeDynamo:
    def __init__(self):
        self.calls = 0

    def update_item(self, **kwargs):
        self.calls += 1
        if self.calls > 10:
            raise ClientError("ConditionalCheckFailedException")


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.raw = {"match_id": "123", "lobby_type": 1, "duration": 1000, "players": [{"account_id": "1", "hero_id": 25, "items": [{"item": "blink", "time": 123}], "behavior": {"chat": "private"}, "steam_id": "private"}]}
        self.s3, self.dynamo = FakeS3(self.raw), FakeDynamo()
        boto = types.ModuleType("boto3")
        boto.client = lambda service: {"s3": self.s3, "dynamodb": self.dynamo}[service]
        botocore = types.ModuleType("botocore")
        exceptions = types.ModuleType("botocore.exceptions")
        exceptions.ClientError = ClientError
        self.modules = patch.dict(sys.modules, {"boto3": boto, "botocore": botocore, "botocore.exceptions": exceptions})
        self.env = patch.dict(os.environ, {"REPLAY_BUCKET": "test", "OPENROUTER_API_KEY": "fake", "AI_RATE_TABLE": "test"})
        self.modules.start()
        self.env.start()
        self.addCleanup(self.modules.stop)
        self.addCleanup(self.env.stop)

    def call(self, action, body=None, match="123"):
        event = {"rawPath": f"/matches/{match}/{action}", "requestContext": {"http": {"method": "GET" if action == "details" else "POST", "sourceIp": "127.0.0.1"}}, "body": json.dumps(body or {})}
        result = handler.lambda_handler(event, None)
        return result["statusCode"], json.loads(result["body"])

    def test_private_fields_are_excluded_and_lobby_gate_fails_closed(self):
        status, result = self.call("details")
        self.assertEqual(status, 200)
        self.assertEqual(result["players"][0]["items"][0]["time"], 123)
        self.assertNotIn("private", json.dumps(result))
        self.raw["lobby_type"] = 0
        self.s3.objects["parsed/123.json"] = json.dumps(self.raw).encode()
        self.assertEqual(self.call("details")[0], 404)

    def test_analysis_cache_depends_on_data_and_bypasses_rate_limit(self):
        with patch.object(handler, "generate", return_value="A grounded answer") as generate:
            first = self.call("analysis", {"player_index": 0})
            second = self.call("analysis", {"player_index": 0})
            self.assertFalse(first[1]["cached"])
            self.assertTrue(second[1]["cached"])
            self.assertEqual(generate.call_count, 1)
            self.assertEqual(self.dynamo.calls, 1)
            self.raw["players"][0]["items"][0]["time"] = 456
            self.s3.objects["parsed/123.json"] = json.dumps(self.raw).encode()
            self.assertFalse(self.call("analysis", {"player_index": 0})[1]["cached"])
            self.assertEqual(generate.call_count, 2)

    def test_chat_validation_and_rate_limit(self):
        self.assertEqual(self.call("chat", {"question": "x" * 601})[0], 400)
        self.assertEqual(self.call("analysis", {"player_index": True})[0], 400)
        with patch.object(handler, "generate", return_value="answer") as generate:
            for _ in range(10):
                self.assertEqual(self.call("chat", {"question": "What happened?"})[0], 200)
            self.assertEqual(self.call("chat", {"question": "One more?"})[0], 429)
            self.assertEqual(generate.call_count, 10)

    def test_insight_is_validated_and_cached_per_match(self):
        item = {"category": "economy", "title": "Economy", "text": "Evidence", "time_seconds": 792}
        model = json.dumps({"summary": "Radiant won.", "winning_factors": [item], "losing_challenges": [item], "improvements": [item], "limitations": "No timeline."})
        with patch.object(handler, "generate", return_value=model) as generate:
            first = self.call("insight")
            second = self.call("insight")
            self.assertEqual(first[0], 200)
            self.assertEqual(first[1]["insight"]["summary"], "Radiant won.")
            self.assertEqual(first[1]["insight"]["winning_factors"][0]["time_seconds"], 792)
            self.assertTrue(second[1]["cached"])
            self.assertEqual(generate.call_count, 1)

    def test_invalid_insight_is_not_cached(self):
        with patch.object(handler, "generate", return_value='{"summary":"incomplete"}'):
            self.assertEqual(self.call("insight")[0], 503)
            self.assertFalse(any(key.startswith("ai-cache/") for key in self.s3.objects))

    def test_telemetry_traces_cache_and_does_not_capture_content(self):
        client = MagicMock()
        span = client.start_observation.return_value
        with patch.object(handler, "langfuse_client", return_value=client), patch.object(handler, "generate", return_value="private answer"):
            self.call("analysis", {"player_index": 0})
            self.call("analysis", {"player_index": 0})
        self.assertEqual(client.flush.call_count, 2)
        self.assertEqual(span.update.call_args.kwargs["metadata"]["cached"], True)
        self.assertNotIn("private answer", str(client.mock_calls))

    def test_generation_records_usage_without_prompt_or_answer(self):
        span = MagicMock()
        generation = span.start_observation.return_value
        response = MagicMock()
        response.__enter__.return_value = io.BytesIO(json.dumps({"choices": [{"message": {"content": "private answer"}}], "usage": {"prompt_tokens": 12, "completion_tokens": 3, "cost": 0.01}}).encode())
        token = handler._trace.set(span)
        self.addCleanup(handler._trace.reset, token)
        with patch.object(handler.urllib.request, "urlopen", return_value=response):
            self.assertEqual(handler.generate({"private": "replay"}, "private question", "key"), "private answer")
        self.assertEqual(generation.update.call_args.kwargs, {"output": {"response_received": True}, "usage_details": {"input": 12, "output": 3}, "cost_details": {"total": 0.01}})
        self.assertNotIn("private", str(span.mock_calls))
        generation.end.assert_called_once()

    def test_telemetry_failure_does_not_break_analysis(self):
        client = MagicMock()
        client.start_observation.side_effect = RuntimeError("offline")
        client.flush.side_effect = RuntimeError("offline")
        with patch.object(handler, "langfuse_client", return_value=client), patch.object(handler, "generate", return_value="answer"):
            self.assertEqual(self.call("chat", {"question": "What happened?"})[0], 200)

    def test_insight_trace_output_captures_validated_insight_when_enabled(self):
        item = {"category": "economy", "title": "Economy", "text": "Evidence", "time_seconds": 792}
        model = json.dumps({"summary": "Radiant won.", "winning_factors": [item], "losing_challenges": [item], "improvements": [item], "limitations": "No timeline."})
        client = MagicMock()
        span = client.start_observation.return_value
        with patch.dict(os.environ, {"LANGFUSE_CAPTURE_INSIGHT_OUTPUT": "true"}), patch.object(handler, "langfuse_client", return_value=client), patch.object(handler, "generate", return_value=model):
            first = self.call("insight")
            second = self.call("insight")
        self.assertEqual(first[0], 200)
        self.assertEqual(second[1]["cached"], True)
        for call in span.update.call_args_list:
            output = call.kwargs.get("output", {})
            if output.get("cached") in (False, True):
                self.assertEqual(output["insight"]["summary"], "Radiant won.")
        self.assertEqual(span.update.call_count, 2)

    def test_insight_trace_output_omits_content_by_default(self):
        item = {"category": "economy", "title": "Economy", "text": "Evidence", "time_seconds": 792}
        model = json.dumps({"summary": "Radiant won.", "winning_factors": [item], "losing_challenges": [item], "improvements": [item], "limitations": "No timeline."})
        client = MagicMock()
        span = client.start_observation.return_value
        with patch.dict(os.environ, {}, clear=False), patch.object(handler, "langfuse_client", return_value=client), patch.object(handler, "generate", return_value=model):
            os.environ.pop("LANGFUSE_CAPTURE_INSIGHT_OUTPUT", None)
            self.assertEqual(self.call("insight")[0], 200)
        output = span.update.call_args.kwargs["output"]
        self.assertNotIn("insight", output)
        self.assertNotIn("Radiant won.", str(span.update.call_args))

    def test_insight_output_limit_and_finish_reason(self):
        span = MagicMock()
        generation = span.start_observation.return_value
        response = MagicMock()
        response.__enter__.return_value = io.BytesIO(json.dumps({"choices": [{"finish_reason": "length", "message": {"content": "truncated"}}]}).encode())
        token = handler._trace.set(span)
        self.addCleanup(handler._trace.reset, token)
        with patch.object(handler.urllib.request, "urlopen", return_value=response) as urlopen:
            handler.generate({}, handler.INSIGHT_QUESTION, "key")
        payload = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(payload["max_tokens"], handler.MAX_INSIGHT_OUTPUT)
        generation.update.assert_any_call(metadata={"finish_reason": "length"})

    def test_invalid_json_records_validation_error(self):
        client = MagicMock()
        span = client.start_observation.return_value
        validation = span.start_observation.return_value
        with patch.object(handler, "langfuse_client", return_value=client), patch.object(handler, "generate", return_value='{"summary":"cut off') as generate:
            self.assertEqual(self.call("insight")[0], 503)
        # The invalid reply is validated, retried once, then rejected.
        self.assertEqual(generate.call_count, 2)
        self.assertEqual(validation.update.call_count, 2)
        validation.update.assert_called_with(level="ERROR", status_message="JSONDecodeError", output={"valid": False})
        self.assertEqual(validation.end.call_count, 2)
        self.assertFalse(any(key.startswith("ai-cache/") for key in self.s3.objects))

    def test_insight_retries_once_and_recovers(self):
        item = {"category": "economy", "title": "Economy", "text": "Evidence", "time_seconds": 792}
        good = json.dumps({"summary": "Radiant won.", "winning_factors": [item], "losing_challenges": [item], "improvements": [item], "limitations": "No timeline."})
        with patch.object(handler, "generate", side_effect=['{"summary":"cut off', good]) as generate:
            status, result = self.call("insight")
        self.assertEqual(status, 200)
        self.assertFalse(result["cached"])
        self.assertEqual(result["insight"]["summary"], "Radiant won.")
        self.assertEqual(generate.call_count, 2)
        self.assertTrue(any(key.startswith("ai-cache/") for key in self.s3.objects))

    def test_incomplete_insight_names_the_missing_section(self):
        with self.assertRaises(ValueError) as raised:
            handler.parse_insight(json.dumps({"summary": "S", "limitations": "L", "winning_factors": [], "losing_challenges": [], "improvements": []}))
        self.assertIn("winning_factors", str(raised.exception))

    def test_legacy_purchase_zero_is_unknown_but_timeline_zero_is_valid(self):
        self.raw["schema_version"] = 6
        self.raw["players"][0]["items"] = [{"item": "blink", "time": 0}]
        self.raw["timeline"] = {"snapshots": [{"time": 0}], "events": [{"type": "hero_death", "time": 0}]}
        result = handler.match_context(self.raw, "123")
        self.assertIsNone(result["players"][0]["items"][0]["time"])
        self.assertEqual(result["timeline"]["snapshots"][0]["time"], 0)
        self.raw["schema_version"] = 7
        self.assertEqual(handler.match_context(self.raw, "123")["players"][0]["items"][0]["time"], 0)

    def _team_match(self):
        return {
            "match_id": "123",
            "lobby_type": 1,
            "duration": 1800,
            "radiant_win": False,
            "players": [
                {"player_name": "R1", "team": "radiant", "hero_id": 109, "account_id": "111", "steam_id": "999", "role": "carry", "lane": "safelane", "kills": 0, "deaths": 6, "assists": 2, "last_hits": 193, "hero_damage": 15750, "tower_damage": 344, "networth": 21072, "towers_killed": 0, "roshans_killed": 0},
                {"player_name": "R2", "team": "radiant", "hero_id": 108, "kills": 3, "deaths": 5, "assists": 5, "last_hits": 201, "hero_damage": 46545, "tower_damage": 25, "networth": 28040, "towers_killed": 1, "roshans_killed": 0},
                {"player_name": "D1", "team": "dire", "hero_id": 36, "kills": 7, "deaths": 2, "assists": 7, "last_hits": 123, "hero_damage": 15246, "tower_damage": 4344, "networth": 28428, "towers_killed": 1, "roshans_killed": 0},
                {"player_name": "D2", "team": "dire", "hero_id": 12, "kills": 3, "deaths": 2, "assists": 6, "last_hits": 244, "hero_damage": 16481, "tower_damage": 14660, "networth": 35977, "towers_killed": 2, "roshans_killed": 2},
            ],
        }

    def test_match_facts_separate_team_totals_and_objectives(self):
        facts = handler.match_facts(handler.match_context(self._team_match(), "123"))
        self.assertEqual(facts["winner"], "dire")
        self.assertEqual(facts["team_totals"]["radiant"]["deaths"], 11)
        self.assertEqual(facts["team_totals"]["dire"]["deaths"], 4)
        self.assertEqual(facts["team_totals"]["radiant"]["hero_damage"], 62295)
        self.assertEqual(facts["team_totals"]["dire"]["hero_damage"], 31727)
        self.assertEqual(facts["team_totals"]["radiant"]["towers_killed"], 1)
        self.assertEqual(facts["team_totals"]["dire"]["towers_killed"], 3)
        self.assertEqual(facts["team_totals"]["dire"]["roshans_killed"], 2)
        self.assertEqual(facts["leaders"]["dire"]["hero_damage"]["player_name"], "D2")

    def test_match_facts_flags_missing_evidence(self):
        facts = handler.match_facts(handler.match_context(self._team_match(), "123"))
        availability = facts["data_availability"]
        self.assertFalse(availability["minute_snapshots"])
        self.assertFalse(availability["death_events"])
        self.assertFalse(availability["building_events"])
        self.assertFalse(availability["teamfight_timeline"])

    def test_match_facts_omits_partial_team_sums(self):
        match = self._team_match()
        del match["players"][0]["hero_damage"]
        facts = handler.match_facts(handler.match_context(match, "123"))
        self.assertNotIn("hero_damage", facts["team_totals"]["radiant"])

    def test_insight_context_includes_facts_without_recompute_fields(self):
        context = handler.insight_context(handler.match_context(self._team_match(), "123"))
        self.assertEqual(context["facts"]["team_totals"]["dire"]["towers_killed"], 3)
        self.assertIn("players", context)

    def test_evaluation_reference_carries_objectives_and_roles_but_no_identity(self):
        reference = handler.evaluation_reference(handler.match_context(self._team_match(), "123"))
        totals = reference["facts"]["team_totals"]
        self.assertEqual(totals["dire"]["towers_killed"], 3)
        self.assertEqual(totals["dire"]["roshans_killed"], 2)
        self.assertEqual(totals["radiant"]["deaths"], 11)
        self.assertTrue(reference["role_is_a_heuristic"])
        self.assertEqual(reference["players"][0]["role"], "carry")
        self.assertEqual(reference["players"][0]["lane"], "safelane")
        serialized = json.dumps(reference)
        self.assertNotIn("account_id", serialized)
        self.assertNotIn("steam_id", serialized)


if __name__ == "__main__":
    unittest.main()
