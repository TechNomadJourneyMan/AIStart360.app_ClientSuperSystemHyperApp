"""Shared fixtures — a :class:`MarkClient` wired to a respx mock transport."""

from __future__ import annotations

import httpx
import pytest
import respx

from mark_analytics_mcp.client import MarkClient


@pytest.fixture
def mock_router() -> respx.Router:
    """A respx router that intercepts httpx calls."""
    router = respx.Router(assert_all_called=False)
    return router


@pytest.fixture
async def client(mock_router: respx.Router):
    """A MarkClient backed by the respx mock router."""
    transport = httpx.MockTransport(handler=mock_router.handler)
    c = MarkClient(
        base_url="https://api.test.mark-analytics.kz",
        token="test-token",
        transport=transport,
    )
    yield c
    await c.aclose()
