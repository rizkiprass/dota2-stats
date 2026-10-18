"""Upload API Lambda for the Dota 2 lobby stats dashboard.

Exposed through an API Gateway HTTP API (proxy integration, ``$default``
route). The dashboard is a public static site, so this function is the only
place that decides whether a replay may be uploaded at all:

* ``POST /replays``       — validate the shared upload password, reject a
                             current duplicate (but allow stale parsed schemas),
                             then hand back a presigned S3 POST for
                             ``raw/<match_id>.dem``. The browser uploads the
                             replay straight to S3; it never flows through here.
* ``GET  /replays/{id}``  — report ``uploaded`` / ``processing`` / ``parsed`` /
                             ``failed`` so the dialog can show progress.
* ``GET  /token-check``   — cheap password check so the dialog can give instant
                             feedback after the player types the password.
* ``GET  /replays/{id}/recap`` — return a cached AI recap, if one exists.
* ``POST /replays/{id}/recap`` — generate a recap once, then cache it in S3.

Duplicate protection is layered:

1. this function rejects current objects (HTTP 409), while allowing a replay
   whose parsed schema is older than the deployed parser; and
2. the parser Lambda skips only when the parsed schema is current, so a normal
   re-upload can refresh stale derived data.

The upload password is never baked into the frontend build. It is supplied by
the player once and stored in the browser, then sent in the
``X-Upload-Token`` header. See ``docs/architecture.md`` for the flow.
"""

from __future__ import annotations

import hmac
import json
import logging
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

BUCKET = os.environ["REPLAY_BUCKET"]
UPLOAD_TOKEN = os.environ.get("UPLOAD_TOKEN", "")
RAW_PREFIX = "raw/"
PARSED_PREFIX = "parsed/"
FAILED_PREFIX = "parse-failed/"
RECAP_PREFIX = "recaps/"
CURRENT_SCHEMA_VERSION = 3
DEFAULT_OPENCODE_API_BASE = "https://opencode.ai/inference/openai/v1"
RECAP_DISCLAIMER = (
    "This recap interprets parsed replay statistics. It is not a full visual replay analysis."
)
RECAP_PATH_RE = re.compile(r"^/replays/(\d+)/recap$")
_API_KEY_CACHE: str | None = None

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(512 * 1024 * 1024)))
PRESIGN_EXPIRES_SECONDS = int(os.environ.get("PRESIGN_EXPIRES_SECONDS", "300"))

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]

# Dota 2 names every replay after its match id: "<match_id>.dem".
MATCH_ID_RE = re.compile(r"^(\d+)\.dem$", re.IGNORECASE)


def _log_event(**fields: Any) -> None:
    logger.info(json.dumps(fields, default=str, sort_keys=True))


def _cors_headers(event: dict[str, Any]) -> dict[str, str]:
    request_origin = (event.get("headers") or {}).get("origin")
    if request_origin and request_origin in ALLOWED_ORIGINS:
        allow_origin = request_origin
    else:
        allow_origin = ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "*"
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
        "Access-Control-Allow-Headers": "content-type,x-upload-token",
        "Access-Control-Max-Age": "300",
        "Vary": "Origin",
    }


def _response(event: dict[str, Any], status: int, body: Any) -> dict[str, Any]:
    headers = {"Content-Type": "application/json", **_cors_headers(event)}
    return {
        "statusCode": status,
        "headers": headers,
        "body": "" if body is None else json.dumps(body, separators=(",", ":")),
    }


def _error(event: dict[str, Any], status: int, code: str, message: str, **extra: Any) -> dict[str, Any]:
    return _response(event, status, {"error": code, "message": message, **extra})


def _authorized(event: dict[str, Any]) -> bool:
    if not UPLOAD_TOKEN:
        # Fail closed: a missing server token must never accept an upload.
        return False
    supplied = (event.get("headers") or {}).get("x-upload-token", "")
    return hmac.compare_digest(supplied, UPLOAD_TOKEN)


def _match_id_from_filename(filename: str) -> str | None:
    match = MATCH_ID_RE.match(filename.strip())
    return match.group(1) if match else None


def _find(key: str) -> dict[str, Any] | None:
    """Return ``{last_modified, size}`` for an exact key, or ``None``.

    Uses ListObjectsV2 instead of HeadObject: with only prefix-scoped
    ``s3:ListBucket`` permission, HeadObject on a missing key returns 403
    (indistinguishable from a real denial), while a prefix listing returns an
    empty result. The listing also carries LastModified and Size.
    """
    response = s3.list_objects_v2(Bucket=BUCKET, Prefix=key, MaxKeys=1)
    for item in response.get("Contents", []):
        if item["Key"] == key:
            return {"last_modified": item["LastModified"], "size": item["Size"]}
    return None


def _parse_body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        import base64

        raw = base64.b64decode(raw).decode("utf-8")
    if not raw:
        return {}
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {}


def _parsed_schema_version(match_id: str) -> int:
    """Read the derived schema version so stale replays can be uploaded again."""
    try:
        response = s3.get_object(Bucket=BUCKET, Key=f"{PARSED_PREFIX}{match_id}.json")
        payload = json.loads(response["Body"].read().decode("utf-8"))
        value = payload.get("schema_version", 0)
        return int(value) if str(value).lstrip("-").isdigit() else 0
    except (ClientError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        return 0


def _duplicate(match_id: str) -> dict[str, Any] | None:
    """The duplicate record for a match id, checked strongest signal first."""
    parsed_key = f"{PARSED_PREFIX}{match_id}.json"
    parsed = _find(parsed_key)
    if parsed is not None and _parsed_schema_version(match_id) < CURRENT_SCHEMA_VERSION:
        # The raw replay remains the source of truth. Re-uploading it lets the
        # normal S3 event path regenerate a parsed payload after a schema bump.
        return None
    for stage, key in (
        ("parsed", parsed_key),
        ("raw", f"{RAW_PREFIX}{match_id}.dem"),
    ):
        found = _find(key)
        if found is not None:
            return {
                "stage": stage,
                "match_id": match_id,
                "key": key,
                "last_modified": found["last_modified"].isoformat(),
            }
    return None


def _create_upload(event: dict[str, Any]) -> dict[str, Any]:
    try:
        body = _parse_body(event)
    except (ValueError, UnicodeDecodeError):
        return _error(event, 400, "invalid_body", "Request body must be JSON.")

    filename = str(body.get("filename") or "")
    match_id = _match_id_from_filename(filename)
    if match_id is None:
        return _error(
            event,
            400,
            "invalid_filename",
            "Rename the file to <match_id>.dem (the Dota replay filename) before uploading.",
        )

    try:
        size = int(body.get("size") or 0)
    except (TypeError, ValueError):
        size = 0
    if size > MAX_UPLOAD_BYTES:
        return _error(
            event,
            413,
            "too_large",
            f"Replay is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.",
        )

    duplicate = _duplicate(match_id)
    if duplicate is not None:
        _log_event(message="Rejected duplicate replay", **duplicate)
        return _response(event, 409, {"duplicate": True, **duplicate})

    key = f"{RAW_PREFIX}{match_id}.dem"
    post = s3.generate_presigned_post(
        Bucket=BUCKET,
        Key=key,
        Fields={"x-amz-meta-match-id": match_id},
        Conditions=[
            ["content-length-range", 1, MAX_UPLOAD_BYTES],
            {"x-amz-meta-match-id": match_id},
        ],
        ExpiresIn=PRESIGN_EXPIRES_SECONDS,
    )
    _log_event(message="Issued upload ticket", match_id=match_id, declared_size=size)
    return _response(
        event,
        201,
        {
            "match_id": match_id,
            "key": key,
            "upload": post,
            "expires_in": PRESIGN_EXPIRES_SECONDS,
        },
    )


def _read_json(key: str) -> dict[str, Any] | None:
    try:
        response = s3.get_object(Bucket=BUCKET, Key=key)
    except ClientError:
        return None
    try:
        payload = json.loads(response["Body"].read().decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _match_status(event: dict[str, Any], match_id: str) -> dict[str, Any]:
    if not match_id.isdigit():
        return _error(event, 400, "invalid_match_id", "match id must be numeric.")

    parsed = _find(f"{PARSED_PREFIX}{match_id}.json")
    if parsed is not None:
        return _response(
            event,
            200,
            {
                "match_id": match_id,
                "status": "parsed",
                "parsed_at": parsed["last_modified"].isoformat(),
            },
        )

    failed = _read_json(f"{FAILED_PREFIX}{match_id}.json")
    if failed is not None:
        return _response(
            event,
            200,
            {
                "match_id": match_id,
                "status": "failed",
                "error": failed.get("error"),
                "failed_at": failed.get("failed_at"),
            },
        )

    raw = _find(f"{RAW_PREFIX}{match_id}.dem")
    if raw is not None:
        return _response(
            event,
            200,
            {
                "match_id": match_id,
                "status": "processing",
                "uploaded_at": raw["last_modified"].isoformat(),
            },
        )

    return _response(event, 200, {"match_id": match_id, "status": "unknown"})


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    http = event.get("requestContext", {}).get("http", {})
    method = (http.get("method") or event.get("httpMethod") or "GET").upper()
    path = event.get("rawPath") or http.get("path") or "/"

    if method == "OPTIONS":
        return _response(event, 204, None)

    if not _authorized(event):
        return _error(event, 401, "unauthorized", "Upload password is missing or incorrect.")

    if method == "POST" and path.rstrip("/") == "/replays":
        return _create_upload(event)

    if method == "GET" and path.rstrip("/") == "/token-check":
        return _response(event, 200, {"ok": True})

    recap_match = RECAP_PATH_RE.match(path.rstrip("/"))
    if recap_match and method in {"GET", "POST"}:
        return _match_recap(event, method, recap_match.group(1))

    if method == "GET" and path.startswith("/replays/"):
        match_id = path[len("/replays/"):].strip("/")
        return _match_status(event, match_id)

    return _error(event, 404, "not_found", f"No route for {method} {path}.")


def _prompt_version() -> str:
    value = os.environ.get("RECAP_PROMPT_VERSION", "1")
    return value if re.fullmatch(r"[A-Za-z0-9._-]{1,32}", value) else "1"


def _max_tokens() -> int:
    try:
        value = int(os.environ.get("RECAP_MAX_TOKENS", "400"))
    except ValueError:
        value = 400
    return min(max(value, 64), 500)


def _recap_key(match_id: str) -> str:
    return f"{RECAP_PREFIX}{match_id}/v{_prompt_version()}.json"


def _bounded_number(value: Any) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float):
        return round(value, 2)
    return value


def _compact_match(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Keep only facts the model needs. Never send identifiers or chat text."""
    players_in = payload.get("players")
    if not isinstance(players_in, list):
        return None
    fields = (
        "kills",
        "deaths",
        "assists",
        "last_hits",
        "denies",
        "networth",
        "hero_damage",
        "tower_damage",
        "stuns",
        "obs_placed",
        "sen_placed",
        "kill_participation",
        "creeps_stacked",
        "rune_pickups",
        "towers_killed",
    )
    players = []
    for index, player in enumerate(players_in[:10]):
        if not isinstance(player, dict):
            continue
        raw_name = player.get("player_name")
        name = " ".join(raw_name.split())[:32] if isinstance(raw_name, str) and raw_name.strip() else f"Anonymous {index + 1}"
        item: dict[str, Any] = {"player_name": name}
        if player.get("team") in {"radiant", "dire"}:
            item["team"] = player["team"]
        if player.get("role") in {"carry", "mid", "offlane", "support", "unknown"}:
            item["role"] = player["role"]
        for field in fields:
            number = _bounded_number(player.get(field))
            if number is not None:
                item[field] = number
        players.append(item)
    if not players:
        return None
    compact: dict[str, Any] = {"players": players}
    duration = _bounded_number(payload.get("duration"))
    if duration is not None:
        compact["duration_seconds"] = duration
    if isinstance(payload.get("radiant_win"), bool):
        compact["radiant_win"] = payload["radiant_win"]
    return compact


def _clean_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    text = "".join(ch if ch >= " " else " " for ch in value)
    text = " ".join(text.split())
    return text[:limit] if text else None


def _validated_recap(raw: dict[str, Any], player_names: set[str]) -> dict[str, Any] | None:
    fields = {
        "summary": 500,
        "turning_point": 280,
        "radiant_insight": 280,
        "dire_insight": 280,
    }
    recap: dict[str, Any] = {}
    for field, limit in fields.items():
        text = _clean_text(raw.get(field), limit)
        if text is None:
            return None
        recap[field] = text
    mvp = raw.get("mvp") if isinstance(raw.get("mvp"), dict) else {}
    name = _clean_text(mvp.get("player_name"), 32)
    canonical = {item.casefold(): item for item in player_names}
    if name and name.casefold() in canonical:
        recap["mvp"] = {
            "player_name": canonical[name.casefold()],
            "reason": _clean_text(mvp.get("reason"), 220) or "Highest impact in the provided statistics.",
        }
    recap["disclaimer"] = RECAP_DISCLAIMER
    return recap


def _opencode_api_key() -> str:
    global _API_KEY_CACHE
    if _API_KEY_CACHE:
        return _API_KEY_CACHE
    direct = os.environ.get("OPENCODE_API_KEY", "").strip()
    if direct:
        _API_KEY_CACHE = direct
        return direct
    name = os.environ.get("OPENCODE_API_KEY_PARAMETER", "").strip()
    if not name:
        return ""
    try:
        response = boto3.client("ssm").get_parameter(Name=name, WithDecryption=True)
        value = str(response.get("Parameter", {}).get("Value", "")).strip()
    except ClientError as exc:
        _log_event(
            message="OpenCode API key unavailable",
            error_code=exc.response.get("Error", {}).get("Code", "unknown"),
        )
        return ""
    if value:
        _API_KEY_CACHE = value
    return value


def _completion_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return ""
    message = choices[0].get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return ""


def _parse_model_json(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = re.sub(r"^```(?:json)?\s*", "", candidate)
        candidate = re.sub(r"\s*```$", "", candidate)
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("model output is not JSON")
        parsed = json.loads(candidate[start : end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("model output is not an object")
    return parsed


def _call_opencode(compact: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    api_key = _opencode_api_key()
    if not api_key:
        return 0, {}
    base = os.environ.get("OPENCODE_API_BASE", DEFAULT_OPENCODE_API_BASE).rstrip("/")
    if not base.startswith("https://"):
        raise ValueError("OpenCode API base must use HTTPS.")
    model = os.environ.get("OPENCODE_MODEL", "glm-5.3-flash-free")
    prompt = json.dumps(compact, separators=(",", ":"), sort_keys=True)
    if len(prompt) > 8000:
        raise ValueError("Match context is too large.")
    body = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": _max_tokens(),
        "messages": [
            {
                "role": "system",
                "content": (
                    "Write a factual Dota 2 private-lobby recap from the supplied JSON only. "
                    "Do not invent hero names, items, chat, or events that are not in the numbers. "
                    "Refer to players by player_name and role. Return JSON with keys summary, "
                    "turning_point, radiant_insight, dire_insight, and mvp. mvp is an object with "
                    "player_name and reason, and player_name must exactly match a supplied name. "
                    "summary is two sentences. Each insight is one sentence."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "match_recap",
                "strict": True,
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["summary", "turning_point", "radiant_insight", "dire_insight", "mvp"],
                    "properties": {
                        "summary": {"type": "string"},
                        "turning_point": {"type": "string"},
                        "radiant_insight": {"type": "string"},
                        "dire_insight": {"type": "string"},
                        "mvp": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["player_name", "reason"],
                            "properties": {
                                "player_name": {"type": "string"},
                                "reason": {"type": "string"},
                            },
                        },
                    },
                },
            },
        },
    }
    return _post_completion(f"{base}/chat/completions", api_key, body)


def _post_completion(url: str, api_key: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    encoded = json.dumps(body).encode()
    request = urllib.request.Request(
        url,
        data=encoded,
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=18) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = {"error": {"message": raw[:300]}}
        if exc.code == 400 and "response_format" in body:
            fallback = {key: value for key, value in body.items() if key != "response_format"}
            return _post_completion(url, api_key, fallback)
        return exc.code, parsed if isinstance(parsed, dict) else {}
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        _log_event(message="OpenCode request failed", error=type(exc).__name__)
        return 504, {}


def _public_recap(event: dict[str, Any], status: int, document: dict[str, Any], cached: bool) -> dict[str, Any]:
    return _response(
        event,
        status,
        {
            "match_id": document["match_id"],
            "cached": cached,
            "model": document.get("model"),
            "prompt_version": document.get("prompt_version"),
            "generated_at": document.get("generated_at"),
            "recap": document["recap"],
        },
    )


def _provider_error(event: dict[str, Any], status: int) -> dict[str, Any]:
    if status in {401, 403}:
        return _error(event, 502, "provider_auth", "The AI provider rejected the API key.")
    if status == 402:
        return _error(event, 402, "provider_credits", "OpenCode credits are exhausted.")
    if status == 429:
        return _error(event, 429, "rate_limited", "The model is rate limited. Try again shortly.")
    return _error(event, 502, "provider_error", "The AI provider could not generate a recap.")


def _match_recap(event: dict[str, Any], method: str, match_id: str) -> dict[str, Any]:
    key = _recap_key(match_id)
    cached = _read_json(key)
    if isinstance(cached, dict) and isinstance(cached.get("recap"), dict):
        return _public_recap(event, 200, cached, True)
    if method == "GET":
        return _error(event, 404, "recap_not_found", "No recap has been generated for this match.")
    if not _opencode_api_key():
        return _error(event, 503, "recap_unconfigured", "Match recap is not configured.")

    parsed = _read_json(f"{PARSED_PREFIX}{match_id}.json")
    if parsed is None:
        return _error(event, 404, "match_not_parsed", "This match has not been parsed yet.")
    compact = _compact_match(parsed)
    if compact is None:
        return _error(event, 422, "insufficient_data", "This match does not contain enough statistics.")

    status, payload = _call_opencode(compact)
    if status != 200:
        _log_event(message="OpenCode recap failed", match_id=match_id, status=status)
        return _provider_error(event, status or 502)
    try:
        raw_recap = _parse_model_json(_completion_text(payload))
    except (ValueError, json.JSONDecodeError):
        return _error(event, 502, "invalid_recap", "The model returned an unreadable recap.")
    names = {player["player_name"] for player in compact["players"]}
    recap = _validated_recap(raw_recap, names)
    if recap is None:
        return _error(event, 502, "invalid_recap", "The model returned an incomplete recap.")

    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
    document = {
        "match_id": match_id,
        "prompt_version": _prompt_version(),
        "model": payload.get("model") or os.environ.get("OPENCODE_MODEL", "glm-5.3-flash-free"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "recap": recap,
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "total_tokens": usage.get("total_tokens"),
        },
    }
    s3.put_object(
        Bucket=BUCKET,
        Key=key,
        Body=json.dumps(document, separators=(",", ":")).encode(),
        ContentType="application/json",
    )
    _log_event(
        message="Generated match recap",
        match_id=match_id,
        model=document["model"],
        prompt_tokens=usage.get("prompt_tokens"),
        completion_tokens=usage.get("completion_tokens"),
    )
    return _public_recap(event, 201, document, False)
