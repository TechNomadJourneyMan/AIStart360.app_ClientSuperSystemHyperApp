"""Base class for runtime agents.

Every runtime agent (Discovery, Crawl, Extraction, Classification, Trend, Alert,
Summarization) implements `handle(job)`. Workers (Arq) call `await agent.run(job)`
which adds telemetry, error handling, idempotency, and event emission.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from app.core.logging import get_logger


@dataclass(slots=True)
class AgentJob:
    """A unit of work for an agent. `idempotency_key` is required for safe retries."""

    id: str
    idempotency_key: str
    payload: dict[str, Any] = field(default_factory=dict)
    attempt: int = 1
    enqueued_at: float = field(default_factory=time.time)


@dataclass(slots=True)
class AgentResult:
    ok: bool
    output: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    error: str | None = None
    took_ms: int = 0


class BaseAgent(ABC):
    name: str                           # e.g. 'discovery', 'crawl', 'extraction'
    task_topic: str                     # Redis stream name
    concurrency: int = 1

    def __init__(self) -> None:
        self.log = get_logger(f"agent.{self.name}")

    @abstractmethod
    async def handle(self, job: AgentJob) -> AgentResult:
        """Domain logic — must be idempotent on job.idempotency_key."""

    async def run(self, job: AgentJob) -> AgentResult:
        started = time.perf_counter()
        self.log.info("job_start", job_id=job.id, attempt=job.attempt,
                       idempotency_key=job.idempotency_key)
        try:
            result = await self.handle(job)
        except Exception as exc:  # noqa: BLE001
            took = int((time.perf_counter() - started) * 1000)
            self.log.exception("job_failed", job_id=job.id, took_ms=took)
            return AgentResult(ok=False, error=str(exc), took_ms=took)

        result.took_ms = int((time.perf_counter() - started) * 1000)
        self.log.info(
            "job_done",
            job_id=job.id,
            ok=result.ok,
            took_ms=result.took_ms,
            events=len(result.events),
        )
        return result

    async def emit(self, event_type: str, payload: dict[str, Any]) -> None:
        """Append a domain event (outbox pattern) for downstream consumers."""
        # Real impl wires through app.events.outbox.publish; here we just log
        # so the contract is testable without infra. Filled by data-layer agent.
        self.log.info("event_emit", type=event_type, payload_keys=list(payload.keys()))
