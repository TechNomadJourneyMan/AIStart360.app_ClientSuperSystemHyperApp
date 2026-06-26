"""Pytest configuration and shared fixtures."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator

import pytest

# Ensure tests use a sane default before settings is imported anywhere.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/mark_test")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-secret")
os.environ.setdefault("APP_ENV", "development")


@pytest.fixture(scope="session")
def event_loop() -> AsyncIterator[asyncio.AbstractEventLoop]:
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
