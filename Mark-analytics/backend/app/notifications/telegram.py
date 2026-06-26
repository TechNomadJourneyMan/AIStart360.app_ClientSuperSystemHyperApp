"""Telegram deliverer.

Wires through the same Bot API endpoint as the existing AlertAgent stub
(:mod:`app.agents.alert`) but reads the bot token from ``app.config.settings``
when available, falling back to the ``TELEGRAM_BOT_TOKEN`` env var so existing
local setups keep working.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

import httpx

from app.notifications.base import DeliveryResult

if TYPE_CHECKING:
    from app.models.alert import AlertRule


TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


def _bot_token() -> str | None:
    # ``settings`` does not yet expose TELEGRAM_BOT_TOKEN; check env directly
    # so behaviour matches the existing stub.
    return os.getenv("TELEGRAM_BOT_TOKEN")


class TelegramDeliverer:
    channel = "TELEGRAM"

    async def send(
        self, rule: AlertRule, payload: dict[str, Any]
    ) -> DeliveryResult:
        cfg = dict(rule.channel_config or {})
        chat_id = cfg.get("chat_id")
        if not chat_id:
            return DeliveryResult(
                ok=False,
                channel=self.channel,
                error="missing channel_config.chat_id",
            )

        token = _bot_token()
        if not token:
            return DeliveryResult(
                ok=False,
                channel=self.channel,
                error="TELEGRAM_BOT_TOKEN not set",
            )

        text = payload.get("text") or payload.get("message") or ""
        url = TELEGRAM_API.format(token=token)
        body = {"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=body)
            ok = 200 <= resp.status_code < 300
            return DeliveryResult(
                ok=ok,
                channel=self.channel,
                status_code=resp.status_code,
                error=None if ok else resp.text[:200],
                meta={"chat_id": chat_id},
            )
