"""AI Gateway live-test endpoint — handy to verify API keys + routing.

Restricted to development/staging environments.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.ai import ChatMessage, GenerateRequest, Task, gateway
from app.config import settings
from app.core.errors import envelope

router = APIRouter()


@router.post("/ping", summary="Send a tiny prompt through the AI Gateway")
async def ai_ping(prompt: str = "Скажи одно слово: тест", task: Task = Task.CLASSIFY_INDUSTRY) -> dict[str, Any]:
    if settings.is_prod:
        raise HTTPException(status_code=404)
    resp = await gateway.generate(
        GenerateRequest(
            task=task,
            messages=[ChatMessage(role="user", content=prompt)],
            max_tokens=64,
            agent="ai_test",
        )
    )
    return envelope(data={
        "text": resp.text,
        "model_used": resp.model_used,
        "provider": resp.provider.value,
        "usage": resp.usage.model_dump(),
    })
