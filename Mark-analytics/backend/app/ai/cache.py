"""Two-stage cache for AI Gateway: key cache (exact) + semantic cache (cosine).

Both backed by Redis.

KeyCache:
  key = sha256(provider:model:prompt:params)
  value = JSON-serialized GenerateResponse
  TTL from RoutePolicy.cache_ttl

SemanticCache (MVP):
  - one Redis sorted set per Task (key: 'aicache:sem:{task}')
  - each member: ulid; payload stored at 'aicache:sem:payload:{task}:{ulid}'
  - separately, embeddings stored at 'aicache:sem:emb:{task}:{ulid}' as packed floats
  - on lookup: brute-force cosine across recent N=200 members (cheap for MVP)
  - graduate to RediSearch / pgvector when count > 5k per task

Cache disabled when:
  - temperature > 0.3
  - force_refresh=True
  - policy.cache_ttl is None
  - PII detected in prompt (caller's responsibility to flag)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import struct
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import redis.asyncio as redis_aio

from app.ai.types import GenerateRequest, GenerateResponse, Provider, Task, Usage
from app.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


# Module-global pool, lazy-init.
_redis: redis_aio.Redis | None = None
_lock = asyncio.Lock()


async def get_redis() -> redis_aio.Redis:
    global _redis
    if _redis is None:
        async with _lock:
            if _redis is None:
                _redis = redis_aio.from_url(settings.REDIS_URL, decode_responses=False)
    return _redis


# ────────────────────────────────────────────────────────────────────
# Key cache
# ────────────────────────────────────────────────────────────────────


def _fingerprint(req: GenerateRequest, model: str) -> str:
    payload = {
        "model": model,
        "messages": [m.model_dump() for m in req.messages],
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
        "json_schema": req.json_schema,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


@dataclass(slots=True)
class KeyCache:
    enabled: bool = True

    async def get(self, req: GenerateRequest, model: str) -> GenerateResponse | None:
        if not self.enabled or not settings.AI_FEATURE_KEY_CACHE:
            return None
        if req.force_refresh or req.temperature > 0.3:
            return None
        r = await get_redis()
        fp = _fingerprint(req, model)
        raw = await r.get(f"aicache:key:{fp}")
        if not raw:
            return None
        try:
            data = json.loads(raw)
            resp = GenerateResponse.model_validate(data)
            resp.usage.cache_hit = True
            resp.usage.cache_type = "key"
            return resp
        except Exception:
            logger.warning("key_cache_decode_failed", fp=fp)
            return None

    async def put(self, req: GenerateRequest, model: str, resp: GenerateResponse,
                  ttl: timedelta) -> None:
        if not self.enabled or not settings.AI_FEATURE_KEY_CACHE:
            return
        if req.temperature > 0.3:
            return
        r = await get_redis()
        fp = _fingerprint(req, model)
        await r.setex(
            f"aicache:key:{fp}",
            int(ttl.total_seconds()),
            json.dumps(resp.model_dump(mode="json"), ensure_ascii=False),
        )


# ────────────────────────────────────────────────────────────────────
# Semantic cache (MVP brute-force)
# ────────────────────────────────────────────────────────────────────


def _pack_vec(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def _unpack_vec(b: bytes, dim: int) -> list[float]:
    return list(struct.unpack(f"{dim}f", b))


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


@dataclass(slots=True)
class SemanticCache:
    enabled: bool = True
    max_members_per_task: int = 200
    embed_dim: int = 1024                # BGE-M3 default

    async def _embed(self, text: str) -> list[float] | None:
        """Embed via local provider. Imported lazily to avoid circular import."""
        try:
            from app.ai.providers.local_embed import LocalEmbedProvider

            provider = LocalEmbedProvider()
            vecs = await provider.embed_texts([text])
            return vecs[0] if vecs else None
        except Exception as e:
            logger.debug("semantic_cache_embed_failed", err=str(e))
            return None

    async def get(self, task: Task, prompt_text: str, threshold: float) -> dict[str, Any] | None:
        if not self.enabled or not settings.AI_FEATURE_SEMANTIC_CACHE:
            return None
        emb = await self._embed(prompt_text)
        if emb is None:
            return None
        r = await get_redis()
        members: list[bytes] = await r.lrange(f"aicache:sem:{task.value}", 0, self.max_members_per_task)
        for ulid_b in members:
            ulid = ulid_b.decode()
            cached_emb_b = await r.get(f"aicache:sem:emb:{task.value}:{ulid}")
            if not cached_emb_b:
                continue
            try:
                cached_emb = _unpack_vec(cached_emb_b, self.embed_dim)
            except struct.error:
                continue
            sim = _cosine(emb, cached_emb)
            if sim >= threshold:
                payload_b = await r.get(f"aicache:sem:payload:{task.value}:{ulid}")
                if payload_b:
                    return json.loads(payload_b)
        return None

    async def put(self, task: Task, prompt_text: str, resp: GenerateResponse,
                  ttl: timedelta) -> None:
        if not self.enabled or not settings.AI_FEATURE_SEMANTIC_CACHE:
            return
        emb = await self._embed(prompt_text)
        if emb is None:
            return
        import ulid as ulid_mod   # type: ignore[import-untyped]
        ulid = str(ulid_mod.new())
        r = await get_redis()
        ttl_s = int(ttl.total_seconds())
        pipe = r.pipeline()
        pipe.lpush(f"aicache:sem:{task.value}", ulid.encode())
        pipe.ltrim(f"aicache:sem:{task.value}", 0, self.max_members_per_task - 1)
        pipe.setex(f"aicache:sem:emb:{task.value}:{ulid}", ttl_s, _pack_vec(emb))
        pipe.setex(
            f"aicache:sem:payload:{task.value}:{ulid}",
            ttl_s,
            json.dumps(resp.model_dump(mode="json"), ensure_ascii=False),
        )
        await pipe.execute()


# Module singletons
key_cache = KeyCache()
semantic_cache = SemanticCache()


def hydrate_from_semantic(payload: dict[str, Any]) -> GenerateResponse:
    """Build a response from semantic-cache payload and mark cache_hit."""
    resp = GenerateResponse.model_validate(payload)
    resp.usage = Usage(
        tokens_in=resp.usage.tokens_in,
        tokens_out=resp.usage.tokens_out,
        cost_usd=0.0,
        latency_ms=0,
        cache_hit=True,
        cache_type="semantic",
    )
    return resp
