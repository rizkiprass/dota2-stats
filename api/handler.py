"""Upload API Lambda for the Dota 2 lobby stats dashboard.

Exposed through an API Gateway HTTP API (proxy integration, ``$default``
route). The dashboard is a public static site, so this function is the only
place that decides whether a replay may be uploaded at all:

* ``POST /replays``       — validate the shared upload password, reject a
                            duplicate match, then hand back a presigned S3 POST
                            for ``raw/<match_id>.dem``. The browser uploads the
                            replay straight to S3; it never flows through here.
* ``GET  /replays/{id}``  — report ``uploaded`` / ``processing`` / ``parsed`` /
                            ``failed`` so the dialog can show progress.
* ``GET  /token-check``   — cheap password check so the dialog can give instant
                            feedback after the player types the password.

Duplicate protection is layered:

1. this function rejects when ``raw/<match_id>.dem`` or
   ``parsed/<match_id>.json`` already exists (HTTP 409); and
2. the parser Lambda skips a replay whose parsed object already exists, so a
   re-triggered S3 event cannot re-process a duplicate either.

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


def _duplicate(match_id: str) -> dict[str, Any] | None:
    """The duplicate record for a match id, checked strongest signal first."""
    for stage, key in (
        ("parsed", f"{PARSED_PREFIX}{match_id}.json"),
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

    if method == "GET" and path.startswith("/replays/"):
        match_id = path[len("/replays/"):].strip("/")
        return _match_status(event, match_id)

    return _error(event, 404, "not_found", f"No route for {method} {path}.")
