"""One-shot CLI: refresh the `region_risk_index` MV.

Usage:

    python -m app.jobs.refresh_region_risk_index

Exits non-zero on failure so it's safe to chain in a CI seed pipeline.
"""

from __future__ import annotations

import asyncio
import sys
import time

from app.db.session import async_session_factory
from app.services.region_risk import refresh_mv


async def main() -> int:
    start = time.monotonic()
    async with async_session_factory() as session:
        await refresh_mv(session)
    elapsed_ms = int((time.monotonic() - start) * 1000)
    print(f"region_risk_index refreshed in {elapsed_ms} ms")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except Exception as exc:
        print(f"refresh failed: {exc}", file=sys.stderr)
        sys.exit(1)
