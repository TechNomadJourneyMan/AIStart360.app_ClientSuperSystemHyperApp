"""AI Gateway public surface.

Usage:
    from app.ai import gateway
    response = await gateway.generate(GenerateRequest(task=Task.SUMMARIZE_NEWS, messages=[...]))
"""

from app.ai.gateway import gateway
from app.ai.types import (
    ChatMessage,
    EmbedRequest,
    EmbedResponse,
    GenerateRequest,
    GenerateResponse,
    Provider,
    RoutePolicy,
    Task,
    Usage,
)

__all__ = [
    "gateway",
    "ChatMessage",
    "EmbedRequest",
    "EmbedResponse",
    "GenerateRequest",
    "GenerateResponse",
    "Provider",
    "RoutePolicy",
    "Task",
    "Usage",
]
