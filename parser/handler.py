"""
AWS Lambda handler for the Dota 2 replay parsing MVP.

Triggered by S3 ObjectCreated events on `raw/<match_id>.dem`. Downloads the
replay, runs the bundled odota/parser Java CLI wrapper against it, normalizes
the output into the MVP match schema, and uploads the result to
`parsed/<match_id>.json`.

See dota_replay_mvp_plan.md (Section 9, 12) for the processing flow and
error handling requirements this implements.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import urllib.parse
from typing import Any

import boto3

from normalize import normalize_events

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3 = boto3.client("s3")

PARSER_JAR = os.environ.get("PARSER_JAR", "/opt/parser/parser.jar")
PARSER_TIMEOUT_SECONDS = int(os.environ.get("PARSER_TIMEOUT_SECONDS", "780"))
RAW_PREFIX = "raw/"
PARSED_PREFIX = "parsed/"
FAILED_PREFIX = "parse-failed/"
# Duplicate guard: when a parsed object already exists, skip the replay instead
# of parsing it again. The upload API already blocks duplicates, so this only
# catches a re-fired S3 event or a re-upload that bypassed the API.
SKIP_IF_ALREADY_PARSED = os.environ.get("SKIP_IF_ALREADY_PARSED", "true").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


class ReplayParseError(Exception):
    """Raised when the parser subprocess fails or produces no output."""


def _object_exists(bucket: str, key: str) -> bool:
    """Exact-key existence check via a prefix listing.

    ListObjectsV2 (not HeadObject) because the role grants only prefix-scoped
    ``s3:ListBucket``: HeadObject on a missing key would return 403, which is
    indistinguishable from a real denial.
    """
    response = s3.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
    return any(item["Key"] == key for item in response.get("Contents", []))


def _write_failure_marker(bucket: str, match_id: str, message: str) -> None:
    """Record why a parse failed so the upload dialog can report it.

    Best-effort: a failure to write the marker must never mask the original
    parse error.
    """
    body = json.dumps(
        {
            "match_id": match_id,
            "error": message,
            "failed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    ).encode("utf-8")
    try:
        s3.put_object(
            Bucket=bucket,
            Key=f"{FAILED_PREFIX}{match_id}.json",
            Body=body,
            ContentType="application/json",
        )
    except Exception:  # noqa: BLE001 - the parse error is already being reported
        logger.exception("Failed to write the parse-failure marker for %s", match_id)


def _match_id_from_key(key: str) -> str:
    filename = key.rsplit("/", 1)[-1]
    return filename[:-4] if filename.lower().endswith(".dem") else filename


def _log_event(**fields: Any) -> None:
    logger.info(json.dumps(fields, default=str))


def _run_parser(dem_path: str) -> str:
    """Invoke the Java parser against the downloaded replay file.

    Returns the raw line-delimited JSON stdout. Raises ReplayParseError on
    non-zero exit code or timeout.
    """
    cmd = ["java", "-cp", PARSER_JAR, "opendota.FileParse", dem_path]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=PARSER_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise ReplayParseError(f"parser timed out after {PARSER_TIMEOUT_SECONDS}s") from exc

    if result.returncode != 0:
        # Log a bounded amount of stderr to help diagnose without flooding logs.
        stderr_tail = (result.stderr or "")[-4000:]
        raise ReplayParseError(
            f"parser exited with code {result.returncode}: {stderr_tail}"
        )

    return result.stdout


def _process_record(bucket: str, key: str) -> dict:
    match_id = _match_id_from_key(key)
    dem_path = f"/tmp/{match_id}.dem"
    json_path = f"/tmp/{match_id}.json"
    parsed_key = f"{PARSED_PREFIX}{match_id}.json"

    if SKIP_IF_ALREADY_PARSED and _object_exists(bucket, parsed_key):
        logger.info("Skipping %s: %s already exists", key, parsed_key)
        _log_event(match_id=match_id, replay_file=key, skipped="already_parsed")
        return {"match_id": match_id, "success": True, "skipped": "already_parsed"}

    parse_start_time = time.time()
    replay_size = None
    parser_exit_code = 0
    output_size = None
    error_message = None

    try:
        s3.download_file(bucket, key, dem_path)
        replay_size = os.path.getsize(dem_path)

        raw_output = _run_parser(dem_path)
        match_json = normalize_events(raw_output, match_id)

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(match_json, f)
        output_size = os.path.getsize(json_path)

        s3.upload_file(json_path, bucket, parsed_key)

    except ReplayParseError as exc:
        parser_exit_code = 1
        error_message = str(exc)
        logger.error("Replay parsing failed for %s: %s", key, error_message)
        _write_failure_marker(bucket, match_id, error_message)
        # Per plan Section 12: keep the raw replay, do not delete/overwrite it,
        # log the failure, and allow manual reprocessing later.
    except Exception as exc:  # noqa: BLE001 - top level guard, we always want to log and continue
        parser_exit_code = 1
        error_message = f"unexpected error: {exc}"
        logger.exception("Unexpected error processing %s", key)
        _write_failure_marker(bucket, match_id, error_message)
    finally:
        parse_end_time = time.time()
        _log_event(
            match_id=match_id,
            replay_file=key,
            replay_size=replay_size,
            parse_start_time=parse_start_time,
            parse_end_time=parse_end_time,
            parse_duration=round(parse_end_time - parse_start_time, 3),
            parser_exit_code=parser_exit_code,
            output_size=output_size,
            error_message=error_message,
        )
        for path in (dem_path, json_path):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass

    return {
        "match_id": match_id,
        "success": error_message is None,
        "error_message": error_message,
    }


def lambda_handler(event: dict, context: Any) -> dict:
    results = []
    for record in event.get("Records", []):
        s3_info = record.get("s3", {})
        bucket = s3_info.get("bucket", {}).get("name")
        raw_key = s3_info.get("object", {}).get("key", "")
        key = urllib.parse.unquote_plus(raw_key)

        if not bucket or not key:
            logger.warning("Skipping record with missing bucket/key: %s", record)
            continue

        if not key.startswith(RAW_PREFIX) or not key.lower().endswith(".dem"):
            # Defensive check in case the trigger filter is ever loosened;
            # this also prevents accidentally reprocessing parsed/*.json.
            logger.info("Skipping non-replay object: %s", key)
            continue

        results.append(_process_record(bucket, key))

    return {"results": results}
