"""Discord webhook deliverer.

Posts a Discord-compatible JSON payload. Discord expects ``content`` (string,
max 2000 chars) and/or ``embeds`` (list). We forward ``embeds`` verbatim when
present and otherwise pack ``payload["text"]`` (or ``message``) into
``content``, truncating to 2000 chars to stay within the API limit.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import httpx

from app.notifications.base import DeliveryResult

if TYPE_CHECKING:
    from app.models.alert import AlertRule


DISCORD_MAX_CONTENT = 2000


def _build_body(payload: dict[str, Any]) -> dict[str, Any]:
    body: dict[str, Any] = {}
    if "embeds" in payload:
        body["embeds"] = payload["embeds"]
    content = payload.get("content") or payload.get("text") or payload.get("message")
    if content:
        body["content"] = content[:DISCORD_MAX_CONTENT]
    if not body:
        body["content"] = ""
    return body


class DiscordDeliverer:
    channel = "DISCORD"

    async def send(
        self, rule: AlertRule, payload: dict[str, Any]
    ) -> DeliveryResult:
        cfg = dict(rule.channel_config or {})
        url = cfg.get("webhook_url")
        if not url:
            return DeliveryResult(
                ok=False,
                channel=self.channel,
                error="missing channel_config.webhook_url",
            )

        body = _build_body(payload)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=body)
            # Discord returns 204 No Content on success.
            ok = 200 <= resp.status_code < 300
            return DeliveryResult(
                ok=ok,
                channel=self.channel,
                status_code=resp.status_code,
                error=None if ok else resp.text[:200],
            )
