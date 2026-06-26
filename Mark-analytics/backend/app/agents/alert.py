"""AlertAgent — evaluate rules against recent events, deliver notifications."""

from __future__ import annotations

import os
from typing import Any

import httpx

from app.agents.base import AgentJob, AgentResult, BaseAgent

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


class AlertAgent(BaseAgent):
    name = "alert"
    task_topic = "events:alert"

    async def handle(self, job: AgentJob) -> AgentResult:
        # Real impl: query DomainEvents since last cursor, evaluate AlertRule.filter
        # against each, write AlertEvent rows, deliver via channels.
        # Stub: only handles direct delivery if job.payload has 'channels'.
        delivered: list[dict[str, Any]] = []
        channels = job.payload.get("channels", [])
        message = job.payload.get("message", "")
        for ch in channels:
            try:
                if ch["type"] == "telegram":
                    await _send_telegram(ch["target"], message)
                    delivered.append({"channel": "telegram", "target": ch["target"], "ok": True})
                # email/webhook stubs go here
            except Exception as e:  # noqa: BLE001
                delivered.append({"channel": ch["type"], "target": ch.get("target"),
                                   "ok": False, "error": str(e)})
        return AgentResult(ok=True, output={"delivered": delivered})


async def _send_telegram(chat: str, text: str) -> None:
    # TODO: migrate TELEGRAM_BOT_TOKEN to app.config.settings
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN not set")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            TELEGRAM_API.format(token=token),
            json={"chat_id": chat, "text": text, "parse_mode": "Markdown"},
        )
        resp.raise_for_status()
