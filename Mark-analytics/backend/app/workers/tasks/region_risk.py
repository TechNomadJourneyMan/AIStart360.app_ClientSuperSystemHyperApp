"""Arq task: refresh the `region_risk_index` materialized view.

Cron-scheduled nightly (see `app.workers.main.WorkerSettings.cron_jobs`).
The actual SQL lives in `app.services.region_risk.refresh_mv`.
"""

from __future__ import annotations

import time
from typing import Any

from app.db.session import async_session_factory
from app.services.region_risk import refresh_mv


async def refresh_region_risk_index(ctx: dict[str, Any]) -> dict[str, Any]:
    start = time.monotonic()
    async with async_session_factory() as session:
        await refresh_mv(session)
    elapsed_ms = int((time.monotonic() - start) * 1000)
    return {"ok": True, "elapsed_ms": elapsed_ms}
