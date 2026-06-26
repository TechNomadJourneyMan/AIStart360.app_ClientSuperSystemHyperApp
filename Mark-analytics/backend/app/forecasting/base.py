"""Base classes for the Forecasting Engine. See docs/aistart360/03-forecasting-engine.md."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar, Generic, TypeVar

from pydantic import BaseModel

from app.core.errors import ValidationError

InputsT = TypeVar("InputsT", bound=BaseModel)
OutputsT = TypeVar("OutputsT", bound=BaseModel)


@dataclass(slots=True)
class ForecastCtx:
    user_id: str | None = None
    tier: str = "free"
    locale: str = "ru"
    industry_context: dict[str, Any] = field(default_factory=dict)


class Assumption(BaseModel):
    key: str
    value: Any
    source: str                          # 'user' | 'data:industry_median' | 'default'
    editable: bool = True
    note: str | None = None


class Forecast(ABC, Generic[InputsT, OutputsT]):
    type: ClassVar[str]
    title: ClassVar[str]
    description: ClassVar[str]
    inputs_schema: ClassVar[type[BaseModel]]
    outputs_schema: ClassVar[type[BaseModel]]

    @abstractmethod
    async def defaults(self, ctx: ForecastCtx) -> dict[str, Any]:
        """Return a dict of suggested defaults for the inputs schema, given context."""

    @abstractmethod
    async def compute(self, inputs: InputsT, ctx: ForecastCtx) -> OutputsT:
        """Pure deterministic computation. No LLM calls here."""

    async def explain(self, inputs: InputsT, outputs: OutputsT, ctx: ForecastCtx) -> str:
        """Optional AI-generated narrative. Default: empty. Override per type."""
        return ""

    def chart_shape(self, outputs: OutputsT) -> dict[str, Any]:
        """Return chart-renderable shape. Override if a chart is meaningful."""
        return {}

    def validate_inputs(self, raw: dict[str, Any]) -> InputsT:
        try:
            return self.inputs_schema.model_validate(raw)  # type: ignore[return-value]
        except Exception as e:
            raise ValidationError(f"Invalid inputs: {e}") from e


# ── Registry ───────────────────────────────────────────────────────

FORECAST_REGISTRY: dict[str, type[Forecast[Any, Any]]] = {}


def register(cls: type[Forecast[Any, Any]]) -> type[Forecast[Any, Any]]:
    """Decorator: register a Forecast type."""
    if cls.type in FORECAST_REGISTRY:
        raise ValueError(f"Forecast type {cls.type} already registered")
    FORECAST_REGISTRY[cls.type] = cls
    return cls


def get_forecast(type_slug: str) -> Forecast[Any, Any]:
    cls = FORECAST_REGISTRY.get(type_slug)
    if cls is None:
        raise ValidationError(f"Unknown forecast type: {type_slug}", code="UNKNOWN_FORECAST")
    return cls()


def list_forecasts() -> list[dict[str, str]]:
    return [
        {"type": cls.type, "title": cls.title, "description": cls.description}
        for cls in FORECAST_REGISTRY.values()
    ]
