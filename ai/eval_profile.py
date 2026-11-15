"""Local-only evaluation harness for the player profile analysis. Never deployed.

The paid half of the evaluation set is the backfill itself: each generation lands
in Langfuse as a `player-profile` trace, and with
`langfuse_capture_profile_output = true` the trace also carries the answer and the
metrics payload it was judged against. This script is the unpaid half: it replays
recorded model answers through the same validators the Lambda uses, over a fixture
tree shaped exactly like the replay bucket, and reports the numbers the plan asks
for — schema pass rate, evidence-reference correctness, unsupported-claim rate and
context size — without calling a provider.

Usage, from the repository root:

    python3 ai/eval_profile.py /path/to/fixtures
    python3 ai/eval_profile.py /path/to/fixtures --answers /path/to/answers

`fixtures` must contain `stats.json`, `matches.json` and `parsed/<match_id>.json`,
i.e. a copy of the private bucket. `answers` must contain one file per player,
`<account_id>.json`, holding either the raw model text or `{"response": text}`.
Neither directory belongs in version control: the fixtures are private-lobby data
and the answers are judgements about named people.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _stub_botocore() -> None:
    """`collect_metrics` imports botocore only for ClientError; a laptop has none.

    The stub is enough for the read path: a missing key raises the same shape the
    Lambda's S3 client raises, so `NoSuchKey` handling is exercised for real.
    """
    import types

    if "botocore" in sys.modules:
        return

    class ClientError(Exception):
        def __init__(self, code: str):
            super().__init__(code)
            self.response = {"Error": {"Code": code}}

    exceptions = types.ModuleType("botocore.exceptions")
    exceptions.ClientError = ClientError
    botocore = types.ModuleType("botocore")
    botocore.exceptions = exceptions
    sys.modules["botocore"] = botocore
    sys.modules["botocore.exceptions"] = exceptions


_stub_botocore()

import profile_handler as ph  # noqa: E402


class FixtureS3:
    """The two methods `collect_metrics` uses, backed by a directory."""

    def __init__(self, root: Path):
        self.store: dict[str, bytes] = {
            ph.STATS_KEY: (root / "stats.json").read_bytes(),
            ph.MATCHES_KEY: (root / "matches.json").read_bytes(),
        }
        for path in sorted((root / "parsed").glob("*.json")):
            self.store[f"parsed/{path.stem}.json"] = path.read_bytes()

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if Key not in self.store:
            raise sys.modules["botocore.exceptions"].ClientError("NoSuchKey")
        return {"Body": _Body(self.store[Key])}


class _Body:
    def __init__(self, raw: bytes):
        self._raw = raw

    def read(self) -> bytes:
        return self._raw


def read_answer(path: Path) -> str:
    text = path.read_text()
    try:
        record = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(record, dict) and isinstance(record.get("response"), str):
        return record["response"]
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("fixtures", type=Path)
    parser.add_argument("--answers", type=Path, default=None)
    parser.add_argument("--players", default="", help="Comma-separated account ids; default: all")
    args = parser.parse_args()

    s3 = FixtureS3(args.fixtures)
    stats = json.loads((args.fixtures / "stats.json").read_text())
    wanted = {pid.strip() for pid in args.players.split(",") if pid.strip()}
    players = sorted(wanted or set(stats.get("players") or {}),
                     key=lambda pid: -((stats.get("players") or {}).get(pid) or {}).get("matches", 0))

    eligible = 0
    schema_pass = 0
    schema_fail = 0
    flagged_players = 0
    flag_counts: dict[str, int] = {}
    token_sizes: list[int] = []

    for account in players:
        metrics = ph.collect_metrics(s3, "fixtures", account)
        if metrics is None or metrics["insufficient"]:
            have = (metrics or {}).get("window", {}).get("eligible", 0)
            print(f"{account:<12} ineligible ({have} eligible matches)")
            continue
        eligible += 1
        context = ph.profile_context(metrics)
        tokens = len(json.dumps(context)) // 4
        token_sizes.append(tokens)
        role = (metrics.get("role") or {}).get("value") or "-"
        tier = (metrics.get("sample") or {}).get("tier")
        line = f"{account:<12} {role:<8} {tier:<8} {tokens:>5} tok  keys={len(ph.allowed_evidence_keys(metrics)):>2}"

        answer_path = args.answers / f"{account}.json" if args.answers else None
        if answer_path and answer_path.exists():
            text = read_answer(answer_path)
            try:
                profile = ph.parse_profile(text, metrics)
                schema_pass += 1
            except Exception as exc:  # noqa: BLE001 - the report is the point
                schema_fail += 1
                print(f"{line}  SCHEMA FAIL: {type(exc).__name__}: {exc}")
                continue
            flags = ph.unsupported_claims(profile, metrics)
            for flag in flags:
                flag_counts[flag] = flag_counts.get(flag, 0) + 1
            if flags:
                flagged_players += 1
            line += f"  flags={','.join(flags) if flags else 'none'}"
        print(line)

    print()
    print(f"players={len(players)} eligible={eligible}")
    if token_sizes:
        print(f"context tokens: min={min(token_sizes)} mean={sum(token_sizes) // len(token_sizes)} max={max(token_sizes)}")
    if args.answers:
        answered = schema_pass + schema_fail
        print(f"schema pass rate: {schema_pass}/{answered}"
              + (f" ({100 * schema_pass // answered}%)" if answered else ""))
        print(f"players with unsupported claims: {flagged_players}/{schema_pass}")
        if flag_counts:
            print("flag histogram: " + ", ".join(f"{k}={v}" for k, v in sorted(flag_counts.items())))
    else:
        print("no --answers directory given: inputs measured only; record answers from Langfuse or a backfill run to score them")
    return 0


if __name__ == "__main__":
    sys.exit(main())
