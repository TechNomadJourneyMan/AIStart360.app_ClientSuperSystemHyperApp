"""Slack incoming-webhook deliverer.

Posts a JSON body to the user-provided webhook URL. Slack accepts either
``{"text": "..."}`` or a full Block-Kit payload — we forward ``payload``
verbatim if it already contains ``blocks`` or ``attachments``, otherwise we
wrap ``payload["text"]`` (or ``message``) into a plain text message.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import httpx

from app.notifications.base import DeliveryResult

if TYPE_CHECKING:
    from app.models.alert import AlertRule


def _build_body(payload: dict[str, Any]) -> dict[str, Any]:
    if "blocks" in payload or "attachments" in payload:
        return payload
    text = payload.get("text") or payload.get("message") or ""
    return {"text": text}


class SlackDeliverer:
    channel = "SLACK"

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
            ok = 200 <= resp.status_code < 300
            return DeliveryResult(
                ok=ok,
                channel=self.channel,
                status_code=resp.status_code,
                error=None if ok else resp.text[:200],
            )
