"""Channel-kind → deliverer factory."""

from __future__ import annotations

from app.models.alert import ChannelKind
from app.notifications.base import Deliverer
from app.notifications.discord import DiscordDeliverer
from app.notifications.email import EmailDeliverer
from app.notifications.slack import SlackDeliverer
from app.notifications.telegram import TelegramDeliverer
from app.notifications.webhook import WebhookDeliverer

_REGISTRY: dict[ChannelKind, Deliverer] = {
    ChannelKind.EMAIL: EmailDeliverer(),
    ChannelKind.TELEGRAM: TelegramDeliverer(),
    ChannelKind.SLACK: SlackDeliverer(),
    ChannelKind.DISCORD: DiscordDeliverer(),
    ChannelKind.WEBHOOK: WebhookDeliverer(),
}


def get_deliverer(channel_kind: ChannelKind) -> Deliverer:
    """Return the singleton deliverer for ``channel_kind``.

    Raises :class:`KeyError` if the kind is not registered — this should be
    impossible for valid DB rows since :class:`ChannelKind` is a closed enum.
    """
    return _REGISTRY[channel_kind]
