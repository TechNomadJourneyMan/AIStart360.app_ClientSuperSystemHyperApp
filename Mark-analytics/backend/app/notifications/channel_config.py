"""Helpers for building per-channel ``channel_config`` JSON.

Used by the alert-rule create service to:

* validate the incoming channel-specific shape;
* generate + store the WEBHOOK secret (hashed + encrypted);
* return the **once-only** create-time response that exposes the plaintext
  secret to the API caller.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.alert import ChannelKind
from app.notifications.secrets import (
    encrypt_secret,
    generate_secret,
    hash_secret,
)


class ChannelConfigError(ValueError):
    """Raised when the user-supplied config is missing required keys."""


@dataclass(slots=True)
class BuiltConfig:
    """Result of building a channel config for create.

    ``stored`` is what goes into ``alert_rules.channel_config`` (DB).
    ``one_time_response`` carries the secret plaintext for WEBHOOK channels —
    returned in the create response and then forgotten. For non-webhook
    channels this is ``None``.
    """

    stored: dict[str, Any]
    one_time_response: dict[str, Any] | None = None


def _required(cfg: dict[str, Any], key: str, channel: ChannelKind) -> str:
    val = cfg.get(key)
    if not val or not isinstance(val, str):
        raise ChannelConfigError(
            f"{channel.value} channel_config requires '{key}'"
        )
    return val


def build_channel_config(
    channel_kind: ChannelKind, raw_config: dict[str, Any]
) -> BuiltConfig:
    """Validate + transform user-supplied config into the DB representation."""
    if channel_kind is ChannelKind.EMAIL:
        to = _required(raw_config, "to", channel_kind)
        return BuiltConfig(stored={"to": to})

    if channel_kind is ChannelKind.TELEGRAM:
        chat_id = _required(raw_config, "chat_id", channel_kind)
        return BuiltConfig(stored={"chat_id": chat_id})

    if channel_kind in (ChannelKind.SLACK, ChannelKind.DISCORD):
        url = _required(raw_config, "webhook_url", channel_kind)
        return BuiltConfig(stored={"webhook_url": url})

    if channel_kind is ChannelKind.WEBHOOK:
        url = _required(raw_config, "url", channel_kind)
        # Always auto-generate — we never accept a user-supplied secret so
        # the lifecycle is unambiguous.
        plaintext = generate_secret()
        stored = {
            "url": url,
            "secret_hash": hash_secret(plaintext),
            "secret_ciphertext": encrypt_secret(plaintext),
        }
        return BuiltConfig(
            stored=stored,
            one_time_response={"url": url, "secret": plaintext},
        )

    raise ChannelConfigError(f"unknown channel kind: {channel_kind!r}")


def redact_for_response(
    channel_kind: ChannelKind, stored: dict[str, Any]
) -> dict[str, Any]:
    """Return the safe-to-expose version of a stored config.

    For WEBHOOK we strip the ciphertext and only echo the hash so consumers
    can audit but never recover the secret via the API.
    """
    if channel_kind is ChannelKind.WEBHOOK:
        return {
            "url": stored.get("url"),
            "secret_hash": stored.get("secret_hash"),
        }
    return dict(stored)
