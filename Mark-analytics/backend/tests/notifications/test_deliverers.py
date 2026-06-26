"""Per-channel deliverer tests.

Each test patches ``httpx.AsyncClient`` so no real HTTP happens. We assert:

* the deliverer hits the right URL,
* the body has the right shape,
* failure modes are reported as ``DeliveryResult(ok=False)``.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from app.models.alert import ChannelKind
from app.notifications.discord import DiscordDeliverer
from app.notifications.email import EmailDeliverer
from app.notifications.registry import get_deliverer
from app.notifications.secrets import (
    SIGNATURE_HEADER,
    encrypt_secret,
    generate_secret,
    hash_secret,
)
from app.notifications.slack import SlackDeliverer
from app.notifications.telegram import TelegramDeliverer
from app.notifications.webhook import WebhookDeliverer
from tests.notifications.conftest import make_rule

# ---------------------------------------------------------------------------
# helpers


class _FakeAsyncClient:
    """Captures the last ``.post`` call and returns a canned response."""

    def __init__(self, *, status_code: int = 200, text: str = "ok"):
        self.calls: list[dict[str, Any]] = []
        self._status = status_code
        self._text = text

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def post(
        self,
        url: str,
        *,
        json: Any = None,
        content: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> MagicMock:
        self.calls.append(
            {"url": url, "json": json, "content": content, "headers": headers}
        )
        resp = MagicMock()
        resp.status_code = self._status
        resp.text = self._text
        return resp


def _patch_client(fake: _FakeAsyncClient, module_path: str):
    return patch(f"{module_path}.httpx.AsyncClient", return_value=fake)


# ---------------------------------------------------------------------------
# registry


def test_registry_returns_singleton_per_kind() -> None:
    a = get_deliverer(ChannelKind.SLACK)
    b = get_deliverer(ChannelKind.SLACK)
    assert a is b
    assert get_deliverer(ChannelKind.WEBHOOK).__class__.__name__ == "WebhookDeliverer"


# ---------------------------------------------------------------------------
# Slack


async def test_slack_posts_plain_text() -> None:
    fake = _FakeAsyncClient()
    rule = make_rule(
        channel_kind=ChannelKind.SLACK,
        channel_config={"webhook_url": "https://hooks.slack.com/services/T/B/X"},
    )
    with _patch_client(fake, "app.notifications.slack"):
        result = await SlackDeliverer().send(rule, {"message": "hello"})
    assert result.ok is True
    assert fake.calls[0]["url"].startswith("https://hooks.slack.com/")
    assert fake.calls[0]["json"] == {"text": "hello"}


async def test_slack_forwards_blocks_verbatim() -> None:
    fake = _FakeAsyncClient()
    rule = make_rule(
        channel_kind=ChannelKind.SLACK,
        channel_config={"webhook_url": "https://hooks.slack.com/services/T/B/X"},
    )
    payload = {"blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": "*hi*"}}]}
    with _patch_client(fake, "app.notifications.slack"):
        result = await SlackDeliverer().send(rule, payload)
    assert result.ok is True
    assert fake.calls[0]["json"] == payload


async def test_slack_missing_url_is_reported() -> None:
    rule = make_rule(channel_kind=ChannelKind.SLACK, channel_config={})
    result = await SlackDeliverer().send(rule, {"message": "x"})
    assert result.ok is False
    assert "webhook_url" in (result.error or "")


# ---------------------------------------------------------------------------
# Discord


async def test_discord_packs_content() -> None:
    fake = _FakeAsyncClient(status_code=204)
    rule = make_rule(
        channel_kind=ChannelKind.DISCORD,
        channel_config={"webhook_url": "https://discord.com/api/webhooks/1/abc"},
    )
    with _patch_client(fake, "app.notifications.discord"):
        result = await DiscordDeliverer().send(rule, {"text": "boom"})
    assert result.ok is True
    assert fake.calls[0]["url"].startswith("https://discord.com/")
    assert fake.calls[0]["json"]["content"] == "boom"


async def test_discord_truncates_content_to_2000() -> None:
    fake = _FakeAsyncClient(status_code=204)
    rule = make_rule(
        channel_kind=ChannelKind.DISCORD,
        channel_config={"webhook_url": "https://discord.com/api/webhooks/1/abc"},
    )
    big = "x" * 3000
    with _patch_client(fake, "app.notifications.discord"):
        await DiscordDeliverer().send(rule, {"content": big})
    assert len(fake.calls[0]["json"]["content"]) == 2000


# ---------------------------------------------------------------------------
# Telegram


async def test_telegram_uses_chat_id_and_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "fake-token")
    fake = _FakeAsyncClient()
    rule = make_rule(
        channel_kind=ChannelKind.TELEGRAM,
        channel_config={"chat_id": "12345"},
    )
    with _patch_client(fake, "app.notifications.telegram"):
        result = await TelegramDeliverer().send(rule, {"text": "hi"})
    assert result.ok is True
    assert "fake-token" in fake.calls[0]["url"]
    assert fake.calls[0]["json"] == {
        "chat_id": "12345",
        "text": "hi",
        "parse_mode": "Markdown",
    }


async def test_telegram_missing_token_is_reported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    rule = make_rule(
        channel_kind=ChannelKind.TELEGRAM,
        channel_config={"chat_id": "12345"},
    )
    result = await TelegramDeliverer().send(rule, {"text": "hi"})
    assert result.ok is False
    assert "TELEGRAM_BOT_TOKEN" in (result.error or "")


# ---------------------------------------------------------------------------
# Email


async def test_email_stub_logs_and_returns_ok(caplog: pytest.LogCaptureFixture) -> None:
    rule = make_rule(
        channel_kind=ChannelKind.EMAIL,
        channel_config={"to": "ops@example.com"},
    )
    with caplog.at_level("INFO"):
        result = await EmailDeliverer().send(rule, {"subject": "S", "body": "B"})
    assert result.ok is True
    assert result.meta == {"to": "ops@example.com", "stub": True}


async def test_email_missing_to_is_reported() -> None:
    rule = make_rule(channel_kind=ChannelKind.EMAIL, channel_config={})
    result = await EmailDeliverer().send(rule, {"subject": "S"})
    assert result.ok is False


# ---------------------------------------------------------------------------
# Webhook + HMAC


async def test_webhook_signs_body_with_hmac_sha256(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret = "deadbeef-test-secret"
    rule = make_rule(
        channel_kind=ChannelKind.WEBHOOK,
        channel_config={
            "url": "https://example.com/hook",
            "secret_hash": hash_secret(secret),
            "secret_ciphertext": encrypt_secret(secret),
        },
    )
    fake = _FakeAsyncClient(status_code=200)
    with _patch_client(fake, "app.notifications.webhook"):
        result = await WebhookDeliverer().send(rule, {"event": "tender.new"})
    assert result.ok is True

    call = fake.calls[0]
    assert call["url"] == "https://example.com/hook"
    assert call["headers"]["Content-Type"] == "application/json"
    sig = call["headers"][SIGNATURE_HEADER]
    assert sig.startswith("sha256=")

    # Recompute the HMAC ourselves and compare — proves the scheme is
    # documentable + reproducible for receivers.
    import hashlib
    import hmac

    expected_body = json.dumps(
        {"event": "tender.new"}, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    assert call["content"] == expected_body
    expected = "sha256=" + hmac.new(
        secret.encode(), expected_body, hashlib.sha256
    ).hexdigest()
    assert sig == expected


async def test_webhook_missing_secret_ciphertext_is_reported() -> None:
    rule = make_rule(
        channel_kind=ChannelKind.WEBHOOK,
        channel_config={"url": "https://example.com/hook"},
    )
    result = await WebhookDeliverer().send(rule, {"x": 1})
    assert result.ok is False
    assert "secret_ciphertext" in (result.error or "")


async def test_webhook_4xx_is_reported() -> None:
    secret = generate_secret()
    rule = make_rule(
        channel_kind=ChannelKind.WEBHOOK,
        channel_config={
            "url": "https://example.com/hook",
            "secret_hash": hash_secret(secret),
            "secret_ciphertext": encrypt_secret(secret),
        },
    )
    fake = _FakeAsyncClient(status_code=500, text="boom")
    with _patch_client(fake, "app.notifications.webhook"):
        result = await WebhookDeliverer().send(rule, {"x": 1})
    assert result.ok is False
    assert result.status_code == 500
