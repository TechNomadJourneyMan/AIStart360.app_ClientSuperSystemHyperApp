"""AI Digest service — Track B.

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track B

This module is intentionally self-contained:

- `compute_due_subscriptions(now)` parses each subscription's cron
  (UTC-anchored, interpreted in the subscription's IANA timezone) and
  returns the ones whose next-fire time has passed since `last_run_at`.

- `build_digest(subscription)` pulls candidate items matching
  `filter_ref` and changed since `last_run_at`, ranks them with the
  formula from the spec, slices to the top 20, and returns a
  `DigestPayload`.

- `render_body_via_llm(payload, subscription)` calls the AI Gateway
  with a strict JSON schema; on parse failure it falls back to the
  deterministic Jinja template `templates/digest_fallback.md.j2`.

- `dispatch(subscription, body, items)` looks up the channel through
  a thin local `DigestDeliverer` protocol. Track C will register
  real Slack/Discord/Webhook deliverers; until then we use a
  log-only stub.

Track-F / Track-C coordination
------------------------------
- `filter_ref` is a string — we don't import `saved_lists` here. A
  pluggable resolver `set_filter_resolver(fn)` lets Track F wire in
  the real resolver later. Default: empty match (returns no items).
- `DigestDeliverer` is a local Protocol. Track C can register a real
  registry via `register_deliverer(kind, impl)`; default is a
  log-only stub that records what would have been sent.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol
from uuid import UUID

from croniter import croniter
from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from pydantic import BaseModel, Field
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import gateway
from app.ai.types import ChatMessage, GenerateRequest, Task
from app.core.errors import AIGatewayUnavailable
from app.core.logging import get_logger
from app.models.digest import (
    DigestRun,
    DigestRunStatus,
    DigestSubscription,
)

logger = get_logger("services.digest")

DEFAULT_TIMEZONE = "Asia/Almaty"
MAX_ITEMS = 20
PROMPT_VERSION = "digest-render-v1"


# ────────────────────────────────────────────────────────────────────
# Payload types
# ────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class DigestItem:
    """A single candidate row queued for ranking."""

    entity_id: str
    title: str
    summary: str
    url: str | None = None
    # Ranking inputs — see `score_item`.
    recency: float = 0.0
    size_bucket: float = 0.0
    change_significance: float = 0.0
    match_strength: float = 0.0
    # Computed.
    score: float = 0.0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class DigestPayload:
    subscription_id: UUID
    title: str
    items: list[DigestItem]
    generated_at: datetime
    body: str | None = None
    used_llm: bool = False


# ────────────────────────────────────────────────────────────────────
# Filter resolver — Track F coordination point
# ────────────────────────────────────────────────────────────────────


FilterResolver = Callable[
    [AsyncSession, str, datetime | None],
    Awaitable[Sequence[DigestItem]],
]


async def _empty_resolver(
    _session: AsyncSession, _filter_ref: str, _since: datetime | None
) -> Sequence[DigestItem]:
    """Default resolver — returns no items.

    Track F replaces this via `set_filter_resolver(...)` once the
    `saved_lists` table + filter snapshot resolver is in place.
    """
    return []


_resolver: FilterResolver = _empty_resolver


def set_filter_resolver(fn: FilterResolver) -> None:
    """Register the resolver that maps a `filter_ref` to candidate DigestItems."""
    global _resolver
    _resolver = fn


def get_filter_resolver() -> FilterResolver:
    return _resolver


# ────────────────────────────────────────────────────────────────────
# Deliverer protocol — Track C coordination point
# ────────────────────────────────────────────────────────────────────


class DigestDeliverer(Protocol):
    """Track C will provide concrete implementations.

    Today we only need the call shape so the dispatch step type-checks.
    """

    async def deliver(
        self, subscription: DigestSubscription, body: str, items: list[DigestItem]
    ) -> dict[str, Any]:  # pragma: no cover — protocol
        ...


class _LogOnlyDeliverer:
    """Stub deliverer. Logs what would have been sent and returns ok=True.

    Track C swaps this for the real Slack/Discord/Webhook registry.
    """

    async def deliver(
        self, subscription: DigestSubscription, body: str, items: list[DigestItem]
    ) -> dict[str, Any]:
        logger.info(
            "digest_dispatch_stub",
            subscription_id=str(subscription.id),
            channel_kind=subscription.channel_kind,
            item_count=len(items),
            body_bytes=len(body),
        )
        return {"ok": True, "delivered": False, "stub": True}


_deliverers: dict[str, DigestDeliverer] = {}


def register_deliverer(kind: str, impl: DigestDeliverer) -> None:
    """Track C calls this to wire its real channel implementations."""
    _deliverers[kind] = impl


def get_deliverer(kind: str) -> DigestDeliverer:
    if kind in _deliverers:
        return _deliverers[kind]
    return _LogOnlyDeliverer()


# ────────────────────────────────────────────────────────────────────
# Concurrency guard — one active run per subscription
# ────────────────────────────────────────────────────────────────────


_active_subs: set[UUID] = set()
_active_lock = asyncio.Lock()


async def _try_acquire(subscription_id: UUID) -> bool:
    async with _active_lock:
        if subscription_id in _active_subs:
            return False
        _active_subs.add(subscription_id)
        return True


async def _release(subscription_id: UUID) -> None:
    async with _active_lock:
        _active_subs.discard(subscription_id)


# ────────────────────────────────────────────────────────────────────
# Cron + due detection
# ────────────────────────────────────────────────────────────────────


def _resolve_zone(name: str) -> timezone | Any:
    """Resolve IANA timezone string; fall back to UTC if unavailable."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:
        return UTC


def is_due(
    sub: DigestSubscription, now: datetime, *, grace_seconds: int = 0
) -> bool:
    """Return True if the next fire is at-or-before `now`.

    `last_run_at` anchors the cron evaluation; for a fresh subscription
    we treat created_at as the anchor instead. Times are evaluated in
    the subscription's timezone, then compared in UTC.
    """
    if not sub.active:
        return False
    tz = _resolve_zone(sub.timezone or DEFAULT_TIMEZONE)
    anchor = sub.last_run_at or sub.created_at or now - timedelta(days=1)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=UTC)
    anchor_local = anchor.astimezone(tz)
    try:
        nxt_local = croniter(sub.schedule_cron, anchor_local).get_next(datetime)
    except (ValueError, KeyError):
        logger.warning(
            "digest_invalid_cron",
            subscription_id=str(sub.id),
            schedule_cron=sub.schedule_cron,
        )
        return False
    nxt_utc = nxt_local.astimezone(UTC)
    now_utc = now if now.tzinfo else now.replace(tzinfo=UTC)
    return (nxt_utc - now_utc).total_seconds() <= grace_seconds


async def compute_due_subscriptions(
    session: AsyncSession, now: datetime
) -> list[DigestSubscription]:
    """Return the active subscriptions whose schedule is due."""
    stmt = select(DigestSubscription).where(DigestSubscription.active.is_(True))
    result = await session.execute(stmt)
    subs = list(result.scalars().all())
    return [s for s in subs if is_due(s, now)]


# ────────────────────────────────────────────────────────────────────
# Ranking
# ────────────────────────────────────────────────────────────────────


def score_item(item: DigestItem) -> float:
    """Spec formula:

        0.4 * recency
      + 0.3 * size_bucket_weight
      + 0.2 * change_significance
      + 0.1 * subscription_match_strength

    All input components are expected in [0, 1].
    """
    score = (
        0.4 * _clamp01(item.recency)
        + 0.3 * _clamp01(item.size_bucket)
        + 0.2 * _clamp01(item.change_significance)
        + 0.1 * _clamp01(item.match_strength)
    )
    return round(score, 6)


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


def rank_items(items: Sequence[DigestItem], *, limit: int = MAX_ITEMS) -> list[DigestItem]:
    scored = []
    for it in items:
        it.score = score_item(it)
        scored.append(it)
    scored.sort(key=lambda i: i.score, reverse=True)
    return scored[:limit]


# ────────────────────────────────────────────────────────────────────
# Building the digest payload
# ────────────────────────────────────────────────────────────────────


async def build_digest(
    session: AsyncSession, subscription: DigestSubscription, *, now: datetime | None = None
) -> DigestPayload:
    now = now or datetime.now(UTC)
    resolver = get_filter_resolver()
    raw = await resolver(session, subscription.filter_ref, subscription.last_run_at)
    items = rank_items(raw, limit=MAX_ITEMS)
    return DigestPayload(
        subscription_id=subscription.id,
        title=subscription.name or "Mark Analytics digest",
        items=items,
        generated_at=now,
    )


# ────────────────────────────────────────────────────────────────────
# LLM rendering with strict JSON schema + fallback
# ────────────────────────────────────────────────────────────────────


class LLMDigestEntry(BaseModel):
    """One ranked item, as rendered by the LLM."""

    title: str = Field(..., min_length=1, max_length=120)
    summary: str = Field(..., min_length=1, max_length=400)
    entity_id: str = Field(...)
    url: str | None = None


class LLMDigestPayload(BaseModel):
    """Top-level LLM output. Strict — we reject anything else."""

    headline: str = Field(..., min_length=1, max_length=120)
    items: list[LLMDigestEntry]


def _jinja_env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(Path(__file__).parent / "templates")),
        undefined=StrictUndefined,
        autoescape=select_autoescape(default=False),
        trim_blocks=True,
        lstrip_blocks=True,
    )


def render_fallback(payload: DigestPayload) -> str:
    """Deterministic Markdown render. Always works."""
    env = _jinja_env()
    tpl = env.get_template("digest_fallback.md.j2")
    return tpl.render(
        title=payload.title,
        items=[
            {
                "title": it.title,
                "summary": it.summary,
                "url": it.url,
                "entity_id": it.entity_id,
            }
            for it in payload.items
        ],
        generated_at=payload.generated_at.isoformat(),
    )


def _llm_messages(payload: DigestPayload, subscription: DigestSubscription) -> list[ChatMessage]:
    items_block = "\n".join(
        f"- id={it.entity_id} | title={it.title} | summary={it.summary} "
        f"| url={it.url or ''} | score={it.score:.3f}"
        for it in payload.items
    )
    system = (
        "You write concise BD-lead digests for the Mark Analytics platform. "
        "Always respond with valid JSON matching the provided schema — no prose, "
        "no markdown fencing, no commentary. "
        "Each item gets a 5-7 word title and a one-line summary (<=160 chars). "
        "Preserve the entity_id and url fields exactly as given."
    )
    user = (
        f"Digest title: {payload.title}\n"
        f"Subscription: {subscription.name or 'Digest'}\n"
        f"Generated at (UTC): {payload.generated_at.isoformat()}\n"
        f"Items (already ranked, highest first):\n{items_block}\n\n"
        "Return JSON: {\"headline\": str, \"items\": ["
        "{\"title\": str, \"summary\": str, \"entity_id\": str, \"url\": str|null}"
        "]}"
    )
    return [
        ChatMessage(role="system", content=system),
        ChatMessage(role="user", content=user),
    ]


async def render_body_via_llm(
    payload: DigestPayload, subscription: DigestSubscription
) -> str:
    """Render a Markdown body. LLM-first; deterministic fallback on any failure."""
    if not payload.items:
        # Empty digest — never call the LLM.
        return render_fallback(payload)

    req = GenerateRequest(
        task=Task.SUMMARIZE_NEWS,
        messages=_llm_messages(payload, subscription),
        max_tokens=1024,
        temperature=0.2,
        json_schema=LLMDigestPayload.model_json_schema(),
        agent="digest",
        metadata={"prompt_version": PROMPT_VERSION},
    )

    try:
        resp = await gateway.generate(req)
    except AIGatewayUnavailable as e:
        logger.warning(
            "digest_llm_unavailable",
            subscription_id=str(subscription.id),
            error=str(e),
        )
        return render_fallback(payload)
    except Exception as e:
        logger.warning(
            "digest_llm_error",
            subscription_id=str(subscription.id),
            error=str(e),
        )
        return render_fallback(payload)

    try:
        parsed = LLMDigestPayload.model_validate_json(resp.text)
    except PydanticValidationError as e:
        logger.warning(
            "digest_llm_bad_json",
            subscription_id=str(subscription.id),
            error=str(e)[:240],
        )
        return render_fallback(payload)
    except ValueError as e:
        logger.warning(
            "digest_llm_parse_error",
            subscription_id=str(subscription.id),
            error=str(e)[:240],
        )
        return render_fallback(payload)

    # Render LLM output through the same template family so the surface is consistent.
    env = _jinja_env()
    tpl = env.get_template("digest_fallback.md.j2")
    rendered = tpl.render(
        title=parsed.headline or payload.title,
        items=[it.model_dump() for it in parsed.items],
        generated_at=payload.generated_at.isoformat(),
    )
    return rendered


# ────────────────────────────────────────────────────────────────────
# Dispatch
# ────────────────────────────────────────────────────────────────────


async def dispatch(
    subscription: DigestSubscription, payload: DigestPayload
) -> dict[str, Any]:
    """Hand the rendered body to the channel deliverer.

    Pre-condition: `payload.body` is populated.
    """
    body = payload.body or render_fallback(payload)
    deliverer = get_deliverer(subscription.channel_kind)
    return await deliverer.deliver(subscription, body, payload.items)


# ────────────────────────────────────────────────────────────────────
# Top-level: run one subscription end-to-end
# ────────────────────────────────────────────────────────────────────


async def run_subscription(
    session: AsyncSession,
    subscription: DigestSubscription,
    *,
    now: datetime | None = None,
) -> DigestRun:
    """Idempotent per active run — concurrency-guarded.

    Returns a (not-yet-committed) DigestRun row. The caller is
    responsible for `session.add(run)` + commit.
    """
    now = now or datetime.now(UTC)

    acquired = await _try_acquire(subscription.id)
    if not acquired:
        logger.info(
            "digest_run_skipped_concurrent",
            subscription_id=str(subscription.id),
        )
        # Caller should treat this as a no-op; we still return a marker.
        return DigestRun(
            subscription_id=subscription.id,
            started_at=now,
            finished_at=now,
            item_count=0,
            status=DigestRunStatus.ERROR.value,
            error="concurrent_run_active",
        )

    run = DigestRun(
        subscription_id=subscription.id,
        started_at=now,
        item_count=0,
        status=DigestRunStatus.SUCCESS.value,
    )
    try:
        payload = await build_digest(session, subscription, now=now)

        if not payload.items and not subscription.send_when_empty:
            run.status = DigestRunStatus.EMPTY.value
            run.item_count = 0
            run.finished_at = datetime.now(UTC)
            subscription.last_run_at = run.finished_at
            return run

        payload.body = await render_body_via_llm(payload, subscription)
        payload.used_llm = True  # informational

        await dispatch(subscription, payload)

        run.item_count = len(payload.items)
        run.status = (
            DigestRunStatus.SUCCESS.value if payload.items else DigestRunStatus.EMPTY.value
        )
        run.finished_at = datetime.now(UTC)
        subscription.last_run_at = run.finished_at
        return run
    except Exception as e:
        logger.exception(
            "digest_run_failed",
            subscription_id=str(subscription.id),
        )
        run.status = DigestRunStatus.ERROR.value
        run.error = str(e)[:500]
        run.finished_at = datetime.now(UTC)
        return run
    finally:
        await _release(subscription.id)
