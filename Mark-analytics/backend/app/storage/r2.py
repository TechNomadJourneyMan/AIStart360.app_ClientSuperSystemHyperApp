"""Async S3-compatible client wrapper (R2 in prod, MinIO locally).

Uses aiobotocore directly to avoid the sync boto3 in the event loop.
"""

from __future__ import annotations

import gzip
from contextlib import asynccontextmanager
from typing import AsyncIterator

from aiobotocore.session import AioSession

from app.config import settings
from app.core.logging import get_logger

logger = get_logger("storage.r2")


class R2Client:
    """Thin async wrapper. One instance shared per-process is fine."""

    def __init__(self) -> None:
        self._session = AioSession()

    @asynccontextmanager
    async def _client(self) -> AsyncIterator:
        async with self._session.create_client(
            "s3",
            endpoint_url=settings.R2_ENDPOINT_URL,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name=settings.R2_REGION,
        ) as c:
            yield c

    async def put_gz_html(self, key: str, html: str) -> str:
        body = gzip.compress(html.encode("utf-8"))
        async with self._client() as c:
            await c.put_object(
                Bucket=settings.R2_BUCKET, Key=key, Body=body,
                ContentEncoding="gzip", ContentType="text/html; charset=utf-8",
            )
        return key

    async def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        async with self._client() as c:
            await c.put_object(Bucket=settings.R2_BUCKET, Key=key, Body=data, ContentType=content_type)
        return key

    async def get_object(self, key: str) -> bytes:
        async with self._client() as c:
            resp = await c.get_object(Bucket=settings.R2_BUCKET, Key=key)
            return await resp["Body"].read()

    async def presigned_url(self, key: str, expires_s: int = 3600) -> str:
        async with self._client() as c:
            return await c.generate_presigned_url(
                "get_object",
                Params={"Bucket": settings.R2_BUCKET, "Key": key},
                ExpiresIn=expires_s,
            )


r2 = R2Client()
