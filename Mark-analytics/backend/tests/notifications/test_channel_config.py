"""Tests for build/redact of channel_config payloads."""

from __future__ import annotations

import pytest

from app.models.alert import ChannelKind
from app.notifications.channel_config import (
    ChannelConfigError,
    build_channel_config,
    redact_for_response,
)
from app.notifications.secrets import decrypt_secret, hash_secret


def test_build_email_requires_to() -> None:
    with pytest.raises(ChannelConfigError):
        build_channel_config(ChannelKind.EMAIL, {})


def test_build_email_round_trip() -> None:
    out = build_channel_config(ChannelKind.EMAIL, {"to": "ops@example.com"})
    assert out.stored == {"to": "ops@example.com"}
    assert out.one_time_response is None


def test_build_telegram_round_trip() -> None:
    out = build_channel_config(ChannelKind.TELEGRAM, {"chat_id": "12345"})
    assert out.stored == {"chat_id": "12345"}


def test_build_slack_round_trip() -> None:
    url = "https://hooks.slack.com/services/T/B/X"
    out = build_channel_config(ChannelKind.SLACK, {"webhook_url": url})
    assert out.stored == {"webhook_url": url}


def test_build_webhook_generates_secret_and_returns_once() -> None:
    out = build_channel_config(
        ChannelKind.WEBHOOK, {"url": "https://example.com/hook"}
    )
    # Stored has hash + ciphertext, never plaintext key.
    assert set(out.stored.keys()) == {"url", "secret_hash", "secret_ciphertext"}
    assert "secret" not in out.stored

    # The one-time response carries the plaintext.
    assert out.one_time_response is not None
    plaintext = out.one_time_response["secret"]
    assert isinstance(plaintext, str) and len(plaintext) > 20

    # Hash matches the plaintext.
    assert out.stored["secret_hash"] == hash_secret(plaintext)
    # Ciphertext decrypts back to the same plaintext.
    assert decrypt_secret(out.stored["secret_ciphertext"]) == plaintext


def test_redact_webhook_strips_ciphertext() -> None:
    out = build_channel_config(
        ChannelKind.WEBHOOK, {"url": "https://example.com/hook"}
    )
    redacted = redact_for_response(ChannelKind.WEBHOOK, out.stored)
    assert "secret_ciphertext" not in redacted
    assert redacted["secret_hash"] == out.stored["secret_hash"]
    assert redacted["url"] == "https://example.com/hook"
