"""Abstract AI provider. Concrete implementations: OpenRouter, Google AI Studio, Local embeddings."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.ai.types import (
    EmbedRequest,
    EmbedResponse,
    GenerateRequest,
    GenerateResponse,
    Provider,
)


class ProviderError(Exception):
    pass


class ProviderRateLimit(ProviderError):
    pass


class Provider5xx(ProviderError):
    pass


class ProviderTimeout(ProviderError):
    pass


class AIProvider(ABC):
    provider: Provider

    @abstractmethod
    async def chat(self, model: str, req: GenerateRequest) -> GenerateResponse:
        """Send a chat-completion request. Must convert provider errors to ProviderError subclasses."""

    async def embed(self, model: str, req: EmbedRequest) -> EmbedResponse:  # pragma: no cover
        """Override if provider supports embeddings."""
        raise NotImplementedError(f"{self.__class__.__name__} does not support embeddings")
