#!/usr/bin/env python3
"""Regenerate web/src/lib/item-names.json (item key -> display name).

Source: odota/dotaconstants build/items.json, the same data parser/item_ids.py
is generated from. Re-run after a patch adds items:

    scripts/update-item-names.py
"""
import json
import urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/odota/dotaconstants/master/build/items.json"
OUT = Path(__file__).resolve().parent.parent / "web" / "src" / "lib" / "item-names.json"

with urllib.request.urlopen(URL, timeout=30) as response:
    items = json.load(response)

names = {key: item["dname"] for key, item in items.items() if item.get("dname")}
OUT.write_text(json.dumps(dict(sorted(names.items())), indent=0, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"wrote {len(names)} names to {OUT}")
