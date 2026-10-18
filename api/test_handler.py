"""Unit tests for the on-demand match recap endpoint.

Run from the repository root:

    python -m unittest api.test_handler
"""

from __future__ import annotations

import io
import json
import os
import sys
import types
import unittest

os.environ.setdefault("REPLAY_BUCKET", "test-bucket")
os.environ.setdefault("UPLOAD_TOKEN", "secret")
os.environ.setdefault("OPENCODE_API_KEY", "test-key")
os.environ.setdefault("RECAP_PROMPT_VERSION", "1")

if "botocore" not in sys.modules:
    botocore = types.ModuleType("botocore")
    exceptions = types.ModuleType("botocore.exceptions")

    class ClientError(Exception):
        def __init__(self, error_response, operation_name):
            super().__init__(error_response)
            self.response = error_response
            self.operation_name = operation_name

    exceptions.ClientError = ClientError
    botocore.exceptions = exceptions
    sys.modules["botocore"] = botocore
    sys.modules["botocore.exceptions"] = exceptions

if "boto3" not in sys.modules:
    boto3 = types.ModuleType("boto3")
    boto3.client = lambda *args, **kwargs: types.SimpleNamespace()  # type: ignore[attr-defined]
    sys.modules["boto3"] = boto3

from botocore.exceptions import ClientError  # noqa: E402

import api.handler as handler  # noqa: E402


class FakeBody(io.BytesIO):
    pass


class FakeS3:
    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject")
        return {"Body": FakeBody(self.objects[Key])}

    def put_object(self, Bucket, Key, Body, **kwargs):
        self.objects[Key] = Body if isinstance(Body, bytes) else Body.encode()


def _event(method: str, path: str, token: str = "secret") -> dict:
    return {
        "rawPath": path,
        "headers": {"x-upload-token": token},
        "requestContext": {"http": {"method": method, "path": path}},
    }


def _parsed() -> dict:
    return {
        "match_id": "42",
        "duration": 1800,
        "radiant_win": True,
        "players": [
            {
                "player_name": "Alpha",
                "team": "radiant",
                "role": "carry",
                "kills": 10,
                "deaths": 2,
                "assists": 8,
                "steam_id": "76561198000000000",
                "account_id": "123",
                "hero_damage": 20000,
                "behavior": {"chat_messages": 4},
            },
            {"player_name": "Beta", "team": "dire", "role": "support", "kills": 1, "deaths": 9, "assists": 12},
        ],
    }


def _model_json(**overrides) -> str:
    payload = {
        "summary": "Radiant won through Alpha's impact. Dire could not answer the fights.",
        "turning_point": "Alpha's kill participation decided the mid game.",
        "radiant_insight": "Alpha converted a large hero damage lead.",
        "dire_insight": "Beta contributed assists but died often.",
        "mvp": {"player_name": "Alpha", "reason": "Most kills and hero damage."},
    }
    payload.update(overrides)
    return json.dumps(payload)


class RecapTests(unittest.TestCase):
    def setUp(self):
        self.s3 = FakeS3()
        handler.s3 = self.s3
        handler._API_KEY_CACHE = None
        os.environ["OPENCODE_API_KEY"] = "test-key"
        self.calls = []

        def fake_call(compact):
            self.calls.append(compact)
            return 200, {
                "model": "glm-5.3-flash-free",
                "choices": [{"message": {"content": _model_json()}}],
                "usage": {"prompt_tokens": 11, "completion_tokens": 22, "total_tokens": 33},
            }

        self._original_call = handler._call_opencode
        handler._call_opencode = fake_call

    def tearDown(self):
        handler._call_opencode = self._original_call

    def test_compact_match_omits_identifiers_and_chat(self):
        compact = handler._compact_match(_parsed())
        encoded = json.dumps(compact)
        self.assertNotIn("steam_id", encoded)
        self.assertNotIn("account_id", encoded)
        self.assertNotIn("chat", encoded)
        self.assertEqual(compact["players"][0]["player_name"], "Alpha")

    def test_get_missing_recap(self):
        response = handler.lambda_handler(_event("GET", "/replays/42/recap"), None)
        self.assertEqual(response["statusCode"], 404)
        self.assertEqual(self.calls, [])

    def test_post_caches_recap_without_exposing_usage(self):
        self.s3.objects["parsed/42.json"] = json.dumps(_parsed()).encode()
        response = handler.lambda_handler(_event("POST", "/replays/42/recap"), None)
        self.assertEqual(response["statusCode"], 201)
        body = json.loads(response["body"])
        self.assertFalse(body["cached"])
        self.assertNotIn("usage", body)
        self.assertEqual(body["recap"]["mvp"]["player_name"], "Alpha")
        self.assertIn("not a full visual replay analysis", body["recap"]["disclaimer"])
        stored = json.loads(self.s3.objects["recaps/42/v1.json"])
        self.assertEqual(stored["usage"]["total_tokens"], 33)
        self.assertNotIn("steam_id", json.dumps(self.calls[0]))

    def test_cache_hit_skips_model(self):
        self.s3.objects["recaps/42/v1.json"] = json.dumps(
            {"match_id": "42", "model": "cached-model", "prompt_version": "1", "recap": {"summary": "Saved."}}
        ).encode()
        response = handler.lambda_handler(_event("POST", "/replays/42/recap"), None)
        self.assertEqual(response["statusCode"], 200)
        self.assertTrue(json.loads(response["body"])["cached"])
        self.assertEqual(self.calls, [])

    def test_invalid_output_is_not_cached(self):
        self.s3.objects["parsed/42.json"] = json.dumps(_parsed()).encode()
        handler._call_opencode = lambda compact: (200, {"choices": [{"message": {"content": "{"}}]})
        response = handler.lambda_handler(_event("POST", "/replays/42/recap"), None)
        self.assertEqual(response["statusCode"], 502)
        self.assertNotIn("recaps/42/v1.json", self.s3.objects)

    def test_hallucinated_mvp_is_dropped(self):
        self.s3.objects["parsed/42.json"] = json.dumps(_parsed()).encode()
        handler._call_opencode = lambda compact: (
            200,
            {"choices": [{"message": {"content": _model_json(mvp={"player_name": "Invoker", "reason": "Invented."})}}]},
        )
        response = handler.lambda_handler(_event("POST", "/replays/42/recap"), None)
        recap = json.loads(response["body"])["recap"]
        self.assertNotIn("mvp", recap)
        self.assertIn("recaps/42/v1.json", self.s3.objects)

    def test_missing_key_does_not_call_model(self):
        self.s3.objects["parsed/42.json"] = json.dumps(_parsed()).encode()
        os.environ["OPENCODE_API_KEY"] = ""
        os.environ["OPENCODE_API_KEY_PARAMETER"] = ""
        response = handler.lambda_handler(_event("POST", "/replays/42/recap"), None)
        self.assertEqual(response["statusCode"], 503)
        self.assertEqual(self.calls, [])

    def test_unauthorized(self):
        response = handler.lambda_handler(_event("POST", "/replays/42/recap", token="nope"), None)
        self.assertEqual(response["statusCode"], 401)


if __name__ == "__main__":
    unittest.main()
