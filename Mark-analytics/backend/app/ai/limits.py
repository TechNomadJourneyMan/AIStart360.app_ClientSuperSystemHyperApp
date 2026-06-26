"""Rate limiters per provider and per task. Uses aiolimiter (token bucket).

Hard ceilings:
  - per-provider: protects us from hitting provider 429s
  - per-task: protects from runaway loops calling the same task

Soft ceilings: AI_DAILY_COST_CEILING_USD — checked separately in router.run().
"""

from __future__ import annotations

from collections import defaultdict

from aiolimiter import AsyncLimiter

from app.ai.types import Provider, Task

# Conservative defaults — tune from observed traffic.
_PROVIDER_RPM: dict[Provider, int] = {
    Provider.GOOGLE_AI_STUDIO: 1500,         # matches Flash free-tier RPM
    Provider.OPENROUTER: 600,
    Provider.LOCAL: 100_000,
    Provider.MOCK: 100_000,
}

_TASK_RPM: dict[Task, int] = defaultdict(lambda: 600)
_TASK_RPM[Task.GRAPH_REASONING] = 50          # premium model, low rate
_TASK_RPM[Task.INVESTMENT_THESIS] = 30
_TASK_RPM[Task.ANOMALY_EXPLANATION] = 60

# Module-global limiters
_provider_limiters: dict[Provider, AsyncLimiter] = {
    p: AsyncLimiter(rpm, 60) for p, rpm in _PROVIDER_RPM.items()
}
_task_limiters: dict[Task, AsyncLimiter] = {}


def provider_limiter(p: Provider) -> AsyncLimiter:
    return _provider_limiters[p]


def task_limiter(t: Task) -> AsyncLimiter:
    if t not in _task_limiters:
        _task_limiters[t] = AsyncLimiter(_TASK_RPM[t], 60)
    return _task_limiters[t]
