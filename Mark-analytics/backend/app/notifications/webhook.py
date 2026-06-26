"""Generic HTTP webhook deliverer with HMAC body signing.

POSTs the alert payload as JSON to ``channel_config.url`` and signs the raw
serialized body with the per-rule webhook secret.

Signature scheme
----------------
Header name: ``X-MK-Signature``.
Format: ``sha256=<hex>``.
Value: ``HMAC_SHA256(secret_plaintext, raw_body_bytes)``.

The ``raw_body_bytes`` are the exact bytes of the request body as sent on the
wire — receivers MUST recompute the HMAC over the bytes they received, NOT
over a re-serialized JSON object (key order or whitespace would diverge).

Receivers verify via :func:`app.notifications.secrets.verify_signature`,
which uses :func:`hmac.compare_digest` for constant-time comparison.

The per-rule secret is generated once on rule creation, returned to the API
caller in plaintext once, and stored encrypted-at-rest in
``channel_config["secret_ciphertext"]`` (Fernet). The hash in
``channel_config["secret_hash"]`` is kept for receiver / audit verification
of a presented plaintext.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import httpx

from app.notifications.base import DeliveryResult
from app.notifications.secrets import (
    SIGNATURE_HEADER,
    safe_decrypt,
    sign_body,
)

if TYPE_CHECKING:
    from app.models.alert import AlertRule


class WebhookDeliverer:
    """HMAC-signed generic webhook.

    Receivers must verify the ``X-MK-Signature`` header. See module docstring.
    """

    channel = "WEBHOOK"

    async def send(
        self, rule: AlertRule, payload: dict[str, Any]
    ) -> DeliveryResult:
        cfg = dict(rule.channel_config or {})
        url = cfg.get("url")
        if not url:
            return DeliveryResult(
                ok=False,
                channel=self.channel,
                error="missing channel_config.url",
            )

        ciphertext = cfg.get("secret_ciphertext")
        if not ciphertext:
            return DeliveryResult(
                ok=False,
                channel=self.channel,
                error="missing channel_config.secret_ciphertext",
            )

        secret = safe_decrypt(ciphertext)
        if secret is None:
            return DeliveryResult(
                ok=False,
                channel=self.channel,
                error="webhook secret unreadable (SECRET_KEY rotated?)",
            )

        # Serialize once so the bytes we sign match what httpx sends.
        body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode(
            "utf-8"
        )
        signature = sign_body(secret, body)

        headers = {
            "Content-Type": "application/json",
            SIGNATURE_HEADER: signature,
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, content=body, headers=headers)
            ok = 200 <= resp.status_code < 300
            return DeliveryResult(
                ok=ok,
                channel=self.channel,
                status_code=resp.status_code,
                error=None if ok else resp.text[:200],
                meta={"signature": signature},
            )
