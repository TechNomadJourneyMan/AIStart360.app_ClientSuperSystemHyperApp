#!/usr/bin/env python3
"""Fetch current OpenRouter prices and diff against our registry.

Run weekly via cron or manually:
    python scripts/check_model_prices.py
"""

from __future__ import annotations

import sys
from typing import Any

import httpx


OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


def fetch_openrouter() -> list[dict[str, Any]]:
    resp = httpx.get(OPENROUTER_MODELS_URL, timeout=20)
    resp.raise_for_status()
    return resp.json().get("data", [])


def main() -> int:
    try:
        from app.ai.registry import MODEL_CATALOG  # type: ignore[attr-defined]
    except Exception as e:  # noqa: BLE001
        print(f"warn: cannot import MODEL_CATALOG yet ({e}); printing raw OpenRouter only")
        MODEL_CATALOG = {}

    models = fetch_openrouter()
    print(f"OpenRouter returned {len(models)} models")

    diffs: list[str] = []
    for m in models:
        name = m["id"]
        if name not in MODEL_CATALOG:
            continue
        pricing = m.get("pricing", {})
        cur_in = float(pricing.get("prompt", 0)) * 1_000_000
        cur_out = float(pricing.get("completion", 0)) * 1_000_000
        ours = MODEL_CATALOG[name]
        if abs(cur_in - ours.get("price_in_per_m", 0)) > 0.01 or abs(cur_out - ours.get("price_out_per_m", 0)) > 0.01:
            diffs.append(f"  {name}: ${cur_in:.3f}/M in, ${cur_out:.3f}/M out (ours: ${ours.get('price_in_per_m')} / ${ours.get('price_out_per_m')})")

    if diffs:
        print("Price drift detected:")
        for line in diffs:
            print(line)
        return 1
    print("No drift.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
