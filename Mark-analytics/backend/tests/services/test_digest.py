"""Tests for `app.services.digest` (Track B of WM parity).

Spec: docs/aistart360/08-world-monitor-feature-parity.md §5 Track B

Covers:
  - cron parsing → due detection respects last_run_at and timezone
  - ranking formula → highest-score item comes first
  - LLM render: valid JSON → Markdown body
  - LLM render: garbage → deterministic fallback template
  - empty-digest behaviour with send_when_empty toggle
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.services import digest as digest_svc
from app.services.digest import (
    DigestItem,
    DigestPayload,
    build_digest,
    is_due,
    rank_items,
    render_body_via_llm,
    render_fallback,
    run_subscription,
    score_item,
    set_filter_resolver,
)

# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────


class _StubSession:
    """Minimal AsyncSession stand-in for tests that don't touch the DB."""

    def __init__(self) -> None:
        self.execute = AsyncMock()
        self.add = lambda *_a, **_kw: None
        self.delete = AsyncMock()
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.rollback = AsyncMock()


def _make_subscription(
    *,
    schedule_cron: str = "*/5 * * * *",
    last_run_at: datetime | None = None,
    timezone_str: str = "UTC",
    send_when_empty: bool = False,
    active: bool = True,
    name: str = "Test digest",
) -> Any:
    """Return an object that quacks like DigestSubscription for the service."""

    class _Sub:
        pass

    sub = _Sub()
    sub.id = uuid.uuid4()
    sub.user_id = uuid.uuid4()
    sub.filter_ref = "list:demo"
    sub.name = name
    sub.channel_kind = "email"
    sub.channel_config = {}
    sub.schedule_cron = schedule_cron
    sub.timezone = timezone_str
    sub.last_run_at = last_run_at
    sub.active = active
    sub.send_when_empty = send_when_empty
    sub.created_at = datetime.now(UTC) - timedelta(days=1)
    sub.updated_at = sub.created_at
    return sub


# ────────────────────────────────────────────────────────────────────
# Cron parsing → due
# ────────────────────────────────────────────────────────────────────


def test_is_due_returns_true_when_next_fire_in_past() -> None:
    now = datetime(2026, 5, 28, 12, 0, tzinfo=UTC)
    sub = _make_subscription(
        schedule_cron="*/5 * * * *",
        last_run_at=now - timedelta(minutes=10),
        timezone_str="UTC",
    )
    assert is_due(sub, now) is True


def test_is_due_returns_false_when_next_fire_in_future() -> None:
    now = datetime(2026, 5, 28, 12, 0, tzinfo=UTC)
    sub = _make_subscription(
        schedule_cron="0 9 * * *",  # daily at 09:00 UTC
        last_run_at=now - timedelta(minutes=10),
        timezone_str="UTC",
    )
    # Next fire is tomorrow 09:00 UTC — clearly in the future.
    assert is_due(sub, now) is False


def test_is_due_false_for_inactive_subscription() -> None:
    now = datetime(2026, 5, 28, 12, 0, tzinfo=UTC)
    sub = _make_subscription(active=False)
    assert is_due(sub, now) is False


def test_is_due_invalid_cron_returns_false() -> None:
    now = datetime(2026, 5, 28, 12, 0, tzinfo=UTC)
    sub = _make_subscription(schedule_cron="not a cron")
    assert is_due(sub, now) is False


# ────────────────────────────────────────────────────────────────────
# Ranking formula
# ────────────────────────────────────────────────────────────────────


def test_score_item_formula_components() -> None:
    item = DigestItem(
        entity_id="x",
        title="t",
        summary="s",
        recency=1.0,
        size_bucket=1.0,
        change_significance=1.0,
        match_strength=1.0,
    )
    # 0.4 + 0.3 + 0.2 + 0.1 = 1.0
    assert score_item(item) == pytest.approx(1.0)

    zero = DigestItem(entity_id="y", title="t", summary="s")
    assert score_item(zero) == pytest.approx(0.0)


def test_score_clamps_out_of_range_inputs() -> None:
    item = DigestItem(
        entity_id="x",
        title="t",
        summary="s",
        recency=2.0,
        size_bucket=-1.0,
        change_significance=0.5,
        match_strength=0.5,
    )
    # recency clamps to 1.0, size to 0.0
    assert score_item(item) == pytest.approx(0.4 + 0.0 + 0.1 + 0.05)


def test_rank_items_orders_by_score_desc() -> None:
    high = DigestItem(
        entity_id="A",
        title="winner",
        summary="...",
        recency=1.0,
        size_bucket=1.0,
        change_significance=1.0,
        match_strength=1.0,
    )
    mid = DigestItem(
        entity_id="B",
        title="middle",
        summary="...",
        recency=0.5,
        size_bucket=0.5,
        change_significance=0.5,
        match_strength=0.5,
    )
    low = DigestItem(
        entity_id="C",
        title="loser",
        summary="...",
        recency=0.0,
        size_bucket=0.0,
        change_significance=0.0,
        match_strength=0.0,
    )
    ranked = rank_items([low, high, mid])
    assert [i.entity_id for i in ranked] == ["A", "B", "C"]
    assert ranked[0].score > ranked[1].score > ranked[2].score


def test_rank_items_caps_at_max() -> None:
    items = [
        DigestItem(
            entity_id=str(i),
            title=f"t{i}",
            summary="s",
            recency=i / 100,
        )
        for i in range(30)
    ]
    ranked = rank_items(items, limit=20)
    assert len(ranked) == 20


# ────────────────────────────────────────────────────────────────────
# Build digest (uses filter resolver)
# ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_build_digest_uses_resolver_and_ranks() -> None:
    sub = _make_subscription()
    items_in = [
        DigestItem(entity_id="B", title="b", summary="s", recency=0.2),
        DigestItem(entity_id="A", title="a", summary="s", recency=0.9),
    ]

    async def _resolver(
        _session: Any, filter_ref: str, _since: datetime | None
    ) -> Sequence[DigestItem]:
        assert filter_ref == sub.filter_ref
        return items_in

    set_filter_resolver(_resolver)
    try:
        payload = await build_digest(_StubSession(), sub)
    finally:
        set_filter_resolver(digest_svc._empty_resolver)

    assert isinstance(payload, DigestPayload)
    assert [i.entity_id for i in payload.items] == ["A", "B"]


@pytest.mark.asyncio
async def test_build_digest_default_resolver_returns_empty() -> None:
    sub = _make_subscription()
    payload = await build_digest(_StubSession(), sub)
    assert payload.items == []


# ────────────────────────────────────────────────────────────────────
# LLM rendering: success path + fallback path
# ────────────────────────────────────────────────────────────────────


def _items_fixture() -> list[DigestItem]:
    return [
        DigestItem(
            entity_id="kz-bin-001",
            title="ТОО Alpha",
            summary="New tender win in Almaty",
            url="https://example.com/c/1",
            recency=0.9,
            size_bucket=0.7,
            change_significance=0.6,
            match_strength=0.8,
        ),
        DigestItem(
            entity_id="kz-bin-002",
            title="ТОО Beta",
            summary="Liquidation notice",
            url="https://example.com/c/2",
            recency=0.4,
            size_bucket=0.5,
            change_significance=0.9,
            match_strength=0.6,
        ),
    ]


@pytest.mark.asyncio
async def test_render_via_llm_valid_json_renders_markdown(monkeypatch: pytest.MonkeyPatch) -> None:
    sub = _make_subscription(name="BD daily")
    items = _items_fixture()
    rank_items(items)
    payload = DigestPayload(
        subscription_id=sub.id,
        title="BD daily",
        items=items,
        generated_at=datetime(2026, 5, 28, 9, 0, tzinfo=UTC),
    )

    fake_json = (
        '{"headline": "BD daily — 2 new signals",'
        ' "items": ['
        '  {"title": "Alpha wins city tender", "summary": "ТОО Alpha awarded contract.",'
        '   "entity_id": "kz-bin-001", "url": "https://example.com/c/1"},'
        '  {"title": "Beta files liquidation", "summary": "ТОО Beta exits market.",'
        '   "entity_id": "kz-bin-002", "url": "https://example.com/c/2"}'
        ' ]}'
    )

    async def _fake_generate(req: Any) -> Any:
        class _Resp:
            text = fake_json

        return _Resp()

    monkeypatch.setattr("app.services.digest.gateway.generate", _fake_generate)

    body = await render_body_via_llm(payload, sub)
    assert "BD daily — 2 new signals" in body
    assert "Alpha wins city tender" in body
    assert "Beta files liquidation" in body
    # No raw JSON keys leaked into output.
    assert '"headline"' not in body


@pytest.mark.asyncio
async def test_render_via_llm_garbage_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    sub = _make_subscription(name="BD daily")
    items = _items_fixture()
    rank_items(items)
    payload = DigestPayload(
        subscription_id=sub.id,
        title="BD daily",
        items=items,
        generated_at=datetime(2026, 5, 28, 9, 0, tzinfo=UTC),
    )

    async def _fake_generate(req: Any) -> Any:
        class _Resp:
            text = "this is not JSON, just chatter"

        return _Resp()

    monkeypatch.setattr("app.services.digest.gateway.generate", _fake_generate)

    body = await render_body_via_llm(payload, sub)
    # Fallback Jinja template uses the digest title + the raw item titles.
    assert "BD daily" in body
    assert "ТОО Alpha" in body
    assert "ТОО Beta" in body


@pytest.mark.asyncio
async def test_render_via_llm_gateway_unavailable_falls_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.errors import AIGatewayUnavailable

    sub = _make_subscription()
    items = _items_fixture()
    rank_items(items)
    payload = DigestPayload(
        subscription_id=sub.id,
        title="Digest",
        items=items,
        generated_at=datetime.now(UTC),
    )

    async def _boom(_req: Any) -> Any:
        raise AIGatewayUnavailable("provider exhausted")

    monkeypatch.setattr("app.services.digest.gateway.generate", _boom)
    body = await render_body_via_llm(payload, sub)
    # Fallback always works; output is non-empty Markdown.
    assert body.strip()
    assert "ТОО Alpha" in body


# ────────────────────────────────────────────────────────────────────
# Empty digest behaviour
# ────────────────────────────────────────────────────────────────────


def test_render_fallback_empty_emits_empty_state() -> None:
    sub = _make_subscription()
    payload = DigestPayload(
        subscription_id=sub.id,
        title="My digest",
        items=[],
        generated_at=datetime(2026, 5, 28, 9, 0, tzinfo=UTC),
    )
    body = render_fallback(payload)
    assert "My digest" in body
    assert "No new matches" in body


@pytest.mark.asyncio
async def test_run_subscription_empty_skip_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sub = _make_subscription(send_when_empty=False)

    async def _empty_resolver(_s: Any, _f: str, _since: Any) -> list[DigestItem]:
        return []

    set_filter_resolver(_empty_resolver)
    try:
        run = await run_subscription(_StubSession(), sub)
    finally:
        set_filter_resolver(digest_svc._empty_resolver)

    assert run.status == "empty"
    assert run.item_count == 0
    assert sub.last_run_at is not None


@pytest.mark.asyncio
async def test_run_subscription_empty_sends_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sub = _make_subscription(send_when_empty=True)
    delivered: dict[str, Any] = {}

    async def _empty_resolver(_s: Any, _f: str, _since: Any) -> list[DigestItem]:
        return []

    class _RecordingDeliverer:
        async def deliver(
            self, subscription: Any, body: str, items: list[DigestItem]
        ) -> dict[str, Any]:
            delivered["body"] = body
            delivered["item_count"] = len(items)
            return {"ok": True}

    set_filter_resolver(_empty_resolver)
    digest_svc.register_deliverer(sub.channel_kind, _RecordingDeliverer())
    try:
        run = await run_subscription(_StubSession(), sub)
    finally:
        set_filter_resolver(digest_svc._empty_resolver)
        digest_svc._deliverers.pop(sub.channel_kind, None)

    # When send_when_empty=True we go through render+dispatch with zero items.
    assert run.item_count == 0
    assert delivered["item_count"] == 0
    assert "No new matches" in delivered["body"]


@pytest.mark.asyncio
async def test_run_subscription_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    sub = _make_subscription(send_when_empty=False)
    items = _items_fixture()

    async def _resolver(_s: Any, _f: str, _since: Any) -> list[DigestItem]:
        return list(items)

    class _RecordingDeliverer:
        def __init__(self) -> None:
            self.calls: list[dict[str, Any]] = []

        async def deliver(
            self, subscription: Any, body: str, items_: list[DigestItem]
        ) -> dict[str, Any]:
            self.calls.append({"body": body, "n": len(items_)})
            return {"ok": True}

    fake_json = (
        '{"headline": "Daily digest",'
        ' "items": ['
        '  {"title": "Alpha wins city tender", "summary": "x",'
        '   "entity_id": "kz-bin-001", "url": null},'
        '  {"title": "Beta files", "summary": "y",'
        '   "entity_id": "kz-bin-002", "url": null}'
        ' ]}'
    )

    async def _fake_generate(_req: Any) -> Any:
        class _Resp:
            text = fake_json

        return _Resp()

    monkeypatch.setattr("app.services.digest.gateway.generate", _fake_generate)
    set_filter_resolver(_resolver)
    rec = _RecordingDeliverer()
    digest_svc.register_deliverer(sub.channel_kind, rec)
    try:
        run = await run_subscription(_StubSession(), sub)
    finally:
        set_filter_resolver(digest_svc._empty_resolver)
        digest_svc._deliverers.pop(sub.channel_kind, None)

    assert run.status == "success"
    assert run.item_count == 2
    assert rec.calls and rec.calls[0]["n"] == 2
    assert sub.last_run_at is not None
