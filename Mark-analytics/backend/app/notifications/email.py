"""Email deliverer — wires to existing email path when present, else logs.

The project does not yet expose a dedicated email client; the AlertAgent stub
in :mod:`app.agents.alert` only handles Telegram. Until a SMTP/SES backend
lands, this deliverer structures the message and emits a structured log line
that an operator can grep. The shape matches what an external mailer will
consume (``{to, subject, body}``) so swap-in is a one-line change.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from app.notifications.base import DeliveryResult

if TYPE_CHECKING:
    from app.models.alert import AlertRule


log = logging.getLogger(__name__)


class EmailDeliverer:
    channel = "EMAIL"

    async def send(
        self, rule: AlertRule, payload: dict[str, Any]
    ) -> DeliveryResult:
        cfg = dict(rule.channel_config or {})
        to = cfg.get("to")
        if not to:
            return DeliveryResult(
                ok=False, channel=self.channel, error="missing channel_config.to"
            )

        subject = payload.get("subject") or f"[mark] {rule.name}"
        body = payload.get("body") or payload.get("message") or ""

        # Stub path: log a structured record. Replace with real SMTP/SES call
        # once `app.core.email` exists.
        log.info(
            "alert.email.stub",
            extra={
                "rule_id": str(rule.id),
                "to": to,
                "subject": subject,
                "body_len": len(body),
            },
        )
        return DeliveryResult(
            ok=True,
            channel=self.channel,
            meta={"to": to, "stub": True},
        )
