"""Core types for AI Gateway. Stable contract — used by routers, providers, agents, callers."""

from __future__ import annotations

from datetime import timedelta
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class Provider(StrEnum):
    OPENROUTER = "openrouter"
    GOOGLE_AI_STUDIO = "google"
    LOCAL = "local"          # fastembed for embeddings
    MOCK = "mock"             # tests


class Task(StrEnum):
    # Cheap, high-volume
    CLASSIFY_INDUSTRY = "classify_industry"
    EXTRACT_CONTACTS = "extract_contacts"
    NORMALIZE_ADDRESS = "normalize_address"
    DETECT_LANGUAGE = "detect_language"
    DEDUPE_DECISION = "dedupe_decision"

    # Medium
    EXTRACT_COMPANY = "extract_company"
    EXTRACT_TENDER = "extract_tender"
    EXTRACT_PERSON = "extract_person"
    EXTRACT_QUERY_FILTERS = "extract_query_filters"
    SUMMARIZE_NEWS = "summarize_news"
    SUMMARIZE_REVIEWS = "summarize_reviews"
    TAG_CONTENT = "tag_content"

    # Complex reasoning
    GRAPH_REASONING = "graph_reasoning"
    INVESTMENT_THESIS = "investment_thesis"
    ANOMALY_EXPLANATION = "anomaly_explanation"
    OSINT_ENTITY_LINKING = "osint_entity_linking"

    # Vision / OCR
    OCR_DOCUMENT = "ocr_document"
    VISION_LOGO = "vision_logo"

    # Embeddings
    EMBED_COMPANY_PROFILE = "embed_company_profile"
    EMBED_QUERY = "embed_query"
    EMBED_NEWS = "embed_news"


Role = Literal["system", "user", "assistant", "tool"]


class ChatMessage(BaseModel):
    role: Role
    content: str
    # Optional image_url for vision
    image_url: str | None = None
    name: str | None = None


class Usage(BaseModel):
    tokens_in: int = 0
    tokens_out: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    cache_hit: bool = False
    cache_type: Literal["key", "semantic", "none"] = "none"


class GenerateRequest(BaseModel):
    task: Task
    messages: list[ChatMessage]
    temperature: float = 0.0
    max_tokens: int = 1024
    json_schema: dict[str, Any] | None = None      # for structured output
    timeout_s: int | None = None
    agent: str | None = None                       # for telemetry (which runtime agent called)
    request_id: str | None = None
    force_refresh: bool = False                    # skip cache
    force_model: str | None = None                 # override Router (testing)
    metadata: dict[str, Any] = Field(default_factory=dict)


class GenerateResponse(BaseModel):
    text: str
    parsed: Any = None                              # set if json_schema or generate_structured
    model_used: str
    provider: Provider
    usage: Usage
    finish_reason: str | None = None


class EmbedRequest(BaseModel):
    texts: list[str]
    task: Task = Task.EMBED_COMPANY_PROFILE
    request_id: str | None = None


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    model_used: str
    provider: Provider
    usage: Usage


class RoutePolicy(BaseModel):
    """Per-Task routing policy. Lives in app.ai.router.ROUTING_POLICY."""

    primary: str                                    # 'google/gemini-2.5-flash'
    fallback: list[str] = Field(default_factory=list)
    max_tokens: int = 1024
    temperature: float = 0.0
    timeout_s: int = 60
    structured_output: bool = False
    cache_ttl: timedelta | None = None              # None = no cache
    semantic_cache_threshold: float | None = None   # e.g. 0.97
    cost_ceiling_usd: float | None = None
    cache_pii_safe: bool = True


def model_qualified_name(provider: Provider, model_id: str) -> str:
    """Canonical 'provider/model' identifier."""
    if "/" in model_id:
        return model_id
    return f"{provider.value}/{model_id}"


def split_model(qualified: str) -> tuple[Provider, str]:
    if "/" not in qualified:
        raise ValueError(f"Expected 'provider/model', got {qualified!r}")
    head, tail = qualified.split("/", 1)
    try:
        provider = Provider(head)
    except ValueError as e:
        raise ValueError(f"Unknown provider: {head}") from e
    return provider, tail
